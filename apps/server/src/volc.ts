import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import WebSocket from 'ws';

/**
 * Streaming speech recognition with Volcengine's Doubao speech model (豆包语音 · 大模型流式语音识别,
 * `wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async`). Audio goes up as it is spoken, so
 * the text is ready a moment after the speaker stops instead of after an upload + a batch run.
 *
 * Wire format: every frame is a 4-byte header (version/size, message type/flags,
 * serialization/compression, reserved), an optional sequence number and a 4-byte payload size,
 * all big-endian.
 */

export interface VolcConfig {
  appId: string;
  accessKey: string;
  /** `volc.bigasr.sauc.duration` (model 1.0, billed by duration) or `volc.seedasr.sauc.duration` (2.0). */
  resourceId: string;
  url?: string;
}

export const VOLC_URL = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async';

const FULL_CLIENT_REQUEST = 0b0001;
const AUDIO_ONLY_REQUEST = 0b0010;
const FULL_SERVER_RESPONSE = 0b1001;
const SERVER_ERROR = 0b1111;
const FLAG_LAST = 0b0010;
const JSON_SERIALIZATION = 0b0001;
const GZIP = 0b0001;

function frame(type: number, flags: number, serialization: number, payload: Uint8Array): Buffer {
  const head = Buffer.from([0x11, (type << 4) | flags, serialization << 4, 0]);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(payload.length);
  return Buffer.concat([head, size, payload]);
}

interface Parsed {
  kind: 'result' | 'error';
  last: boolean;
  text?: string;
  code?: number;
  message?: string;
}

export function parseVolcFrame(buf: Buffer): Parsed | null {
  if (buf.length < 8) return null;
  const headerSize = (buf.readUInt8(0) & 0x0f) * 4;
  const type = buf.readUInt8(1) >> 4;
  const flags = buf.readUInt8(1) & 0x0f;
  const compression = buf.readUInt8(2) & 0x0f;
  let off = headerSize;
  if (type === SERVER_ERROR) {
    const code = buf.readUInt32BE(off);
    const size = buf.readUInt32BE(off + 4);
    return {
      kind: 'error',
      last: true,
      code,
      message: buf.subarray(off + 8, off + 8 + size).toString('utf8'),
    };
  }
  if (type !== FULL_SERVER_RESPONSE) return null;
  if (flags & 0b0001) off += 4; // sequence number
  const size = buf.readUInt32BE(off);
  let payload = buf.subarray(off + 4, off + 4 + size);
  if (compression === GZIP && payload.length) payload = gunzipSync(payload);
  const json = payload.length ? (JSON.parse(payload.toString('utf8')) as { result?: { text?: string } }) : {};
  return { kind: 'result', last: (flags & 0b0010) !== 0, text: json.result?.text ?? '' };
}

export interface StreamOptions {
  /** Words to favour: project and label names, names the user said often. */
  hotwords?: string[];
  /** Partial (and finally the full) transcript as it changes. */
  onText?: (text: string) => void;
}

/** A live recognition session, whichever service runs it. */
export interface SpeechStream {
  send(pcm: Uint8Array): void;
  end(timeoutMs?: number): Promise<string>;
  close(): void;
  /** Rejects as soon as the service fails. */
  readonly final: Promise<string>;
}

export type OpenSpeechStream = (opts: StreamOptions) => SpeechStream;

/**
 * One recognition session. Feed 16 kHz mono 16-bit little-endian PCM with {@link send}; {@link end}
 * resolves with the final text.
 */
export class VolcStream implements SpeechStream {
  private ws: WebSocket;
  private queue: Buffer[] = [];
  private open = false;
  private ended = false;
  private text = '';
  private settled = false;
  private resolveFinal!: (text: string) => void;
  private rejectFinal!: (e: Error) => void;
  /** Settles when the service sends its last result (or fails). */
  readonly final: Promise<string>;

  constructor(
    readonly config: VolcConfig,
    private opts: StreamOptions = {},
  ) {
    this.final = new Promise<string>((resolve, reject) => {
      this.resolveFinal = resolve;
      this.rejectFinal = reject;
    });
    // Unhandled until someone awaits `end()`; don't crash the process over it.
    this.final.catch(() => undefined);
    this.ws = new WebSocket(config.url ?? VOLC_URL, {
      headers: {
        'X-Api-App-Key': config.appId,
        'X-Api-Access-Key': config.accessKey,
        'X-Api-Resource-Id': config.resourceId,
        'X-Api-Connect-Id': randomUUID(),
      },
      handshakeTimeout: 8000,
    });
    this.ws.on('open', () => {
      const words = [...new Set((opts.hotwords ?? []).map((w) => w.trim()).filter(Boolean))].slice(0, 100);
      const request = {
        user: { uid: 'docket' },
        audio: { format: 'pcm', codec: 'raw', rate: 16000, bits: 16, channel: 1 },
        request: {
          model_name: 'bigmodel',
          enable_itn: true,
          enable_punc: true,
          enable_ddc: false,
          result_type: 'full',
          // Ends a little sooner after the last word.
          end_window_size: 800,
          ...(words.length
            ? { corpus: { context: JSON.stringify({ hotwords: words.map((word) => ({ word })) }) } }
            : {}),
        },
      };
      this.ws.send(
        frame(FULL_CLIENT_REQUEST, 0, JSON_SERIALIZATION, Buffer.from(JSON.stringify(request), 'utf8')),
      );
      this.open = true;
      for (const b of this.queue) this.ws.send(b);
      this.queue = [];
    });
    this.ws.on('message', (data: Buffer) => {
      let parsed: Parsed | null;
      try {
        parsed = parseVolcFrame(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer));
      } catch (e) {
        return this.fail(new Error(`speech service sent an unreadable frame: ${(e as Error).message}`));
      }
      if (!parsed) return;
      if (parsed.kind === 'error') {
        return this.fail(new Error(`speech service error ${parsed.code}: ${parsed.message}`));
      }
      if (parsed.text !== undefined && parsed.text !== this.text) {
        this.text = parsed.text;
        this.opts.onText?.(this.text);
      }
      if (parsed.last) this.settle(this.text);
    });
    this.ws.on('unexpected-response', (_req, res) => {
      const status = res.statusCode;
      const msg = res.headers['x-api-message'];
      this.fail(new Error(`speech service refused the connection: HTTP ${status}${msg ? ` ${msg}` : ''}`));
    });
    this.ws.on('error', (e) => this.fail(e));
    this.ws.on('close', () => {
      // Closing before the last result: keep what we have if the audio was finished.
      if (this.ended) this.settle(this.text);
      else this.fail(new Error('speech service closed the connection'));
    });
  }

  /** The latest transcript. */
  get current(): string {
    return this.text;
  }

  send(pcm: Uint8Array): void {
    if (this.ended || this.settled || !pcm.length) return;
    const b = frame(AUDIO_ONLY_REQUEST, 0, 0, pcm);
    if (this.open) this.ws.send(b);
    else this.queue.push(b);
  }

  /** No more audio; resolves with the final transcript. */
  end(timeoutMs = 6000): Promise<string> {
    if (!this.ended && !this.settled) {
      this.ended = true;
      const b = frame(AUDIO_ONLY_REQUEST, FLAG_LAST, 0, new Uint8Array(0));
      if (this.open) this.ws.send(b);
      else this.queue.push(b);
    }
    const timer = setTimeout(() => this.settle(this.text), timeoutMs);
    return this.final.finally(() => clearTimeout(timer));
  }

  close(): void {
    this.ended = true;
    this.settle(this.text);
  }

  private settle(text: string): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveFinal(text);
    this.shutdown();
  }

  private fail(e: Error): void {
    if (this.settled) return;
    this.settled = true;
    this.rejectFinal(e);
    this.shutdown();
  }

  private shutdown(): void {
    try {
      if (this.ws.readyState === WebSocket.CONNECTING) this.ws.terminate();
      else this.ws.close();
    } catch {
      /* already closed */
    }
  }
}
