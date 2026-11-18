import { gzipSync } from 'node:zlib';
import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp } from '../src/app';
import { Db } from '../src/db';
import { Hub } from '../src/hub';
import { parseVolcFrame, type SpeechStream, type StreamOptions } from '../src/volc';

/** Records what the route feeds it; says "text" per chunk and the joined text at the end. */
function fakeStream(log: { hotwords?: string[]; bytes: number; ended: boolean; closed: boolean }) {
  return (opts: StreamOptions): SpeechStream => {
    log.hotwords = opts.hotwords;
    let resolve!: (t: string) => void;
    const final = new Promise<string>((r) => {
      resolve = r;
    });
    let n = 0;
    return {
      final,
      send(pcm) {
        log.bytes += pcm.length;
        opts.onText?.(`第${++n}段`);
      },
      end() {
        log.ended = true;
        resolve(`共${n}段`);
        return final;
      },
      close() {
        log.closed = true;
        resolve('');
      },
    };
  };
}

async function start(openStream: ((o: StreamOptions) => SpeechStream) | null) {
  const db = new Db(':memory:');
  const root = new Hono();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app: root });
  root.route(
    '/',
    createApp({ db, hub: new Hub(db, 'Asia/Shanghai'), ai: null, openStream, upgradeWebSocket }),
  );
  const server = serve({ fetch: root.fetch, port: 0, hostname: '127.0.0.1' });
  injectWebSocket(server);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const port = (server.address() as { port: number }).port;
  return { server, port, token: db.createToken('phone'), root };
}

function collect(ws: WebSocket) {
  const msgs: { type: string; text?: string; error?: string }[] = [];
  const closed = new Promise<void>((r) => ws.on('close', () => r()));
  ws.on('message', (d) => msgs.push(JSON.parse(String(d))));
  return { msgs, closed };
}

describe('/api/ai/listen', () => {
  it('relays audio and returns partial and final text', async () => {
    const log = { bytes: 0, ended: false, closed: false } as {
      hotwords?: string[];
      bytes: number;
      ended: boolean;
      closed: boolean;
    };
    const { server, port, token, root } = await start(fakeStream(log));
    const health = await root.request('/api/health', { headers: { Authorization: `Bearer ${token}` } });
    expect(((await health.json()) as { ai: { stream: boolean } }).ai.stream).toBe(true);

    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/api/ai/listen?token=${token}&hint=${encodeURIComponent('工作、王老师')}`,
    );
    const { msgs, closed } = collect(ws);
    await new Promise((r) => ws.once('open', r));
    ws.send(new Uint8Array(3200));
    ws.send(new Uint8Array(3200));
    ws.send(JSON.stringify({ type: 'end' }));
    await closed;
    server.close();
    expect(log.bytes).toBe(6400);
    expect(log.hotwords).toEqual(['工作', '王老师']);
    expect(msgs).toEqual([
      { type: 'text', text: '第1段' },
      { type: 'text', text: '第2段' },
      { type: 'final', text: '共2段' },
    ]);
  });

  it('needs a token', async () => {
    const { server, port } = await start(fakeStream({ bytes: 0, ended: false, closed: false }));
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/ai/listen?token=nope`);
    const status = await new Promise<number>((r) =>
      ws.on('unexpected-response', (_q, res) => r(res.statusCode ?? 0)),
    );
    server.close();
    expect(status).toBe(401);
  });

  it('says so when the server has no streaming recognizer', async () => {
    const { server, port, token } = await start(null);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/ai/listen?token=${token}`);
    const { msgs, closed } = collect(ws);
    await closed;
    server.close();
    expect(msgs[0]?.type).toBe('error');
  });
});

describe('parseVolcFrame', () => {
  const frame = (b1: number, b2: number, payload: Buffer, seq?: number) => {
    const parts: Uint8Array[] = [Buffer.from([0x11, b1, b2, 0])];
    if (seq !== undefined) {
      const s = Buffer.alloc(4);
      s.writeInt32BE(seq);
      parts.push(s);
    }
    const size = Buffer.alloc(4);
    size.writeUInt32BE(payload.length);
    parts.push(size, payload);
    return Buffer.concat(parts);
  };

  it('reads partial and last results, gzip or not', () => {
    const json = (t: string) => Buffer.from(JSON.stringify({ result: { text: t } }));
    expect(parseVolcFrame(frame(0x91, 0x10, json('明天'), 2))).toEqual({
      kind: 'result',
      last: false,
      text: '明天',
    });
    expect(parseVolcFrame(frame(0x93, 0x11, Buffer.from(gzipSync(json('明天下午'))), -3))).toEqual({
      kind: 'result',
      last: true,
      text: '明天下午',
    });
  });

  it('reads errors', () => {
    const b = Buffer.concat([
      Buffer.from([0x11, 0xf0, 0x10, 0]),
      Buffer.from([0, 0x2d, 0xc6, 0xc1]),
      Buffer.from([0, 0, 0, 3]),
      Buffer.from('bad'),
    ]);
    expect(parseVolcFrame(b)).toMatchObject({ kind: 'error', code: 0x2dc6c1, message: 'bad' });
  });
});
