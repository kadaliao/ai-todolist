import { getLocale, t } from '@ai-todo/shared';
import { useSyncStore } from './sync';

/**
 * Speech capture for the assistant.
 *
 * - **System**: the browser's own recognizer (Web Speech API). Free and live as you speak.
 * - **Cloud**: record with MediaRecorder and let the sync server transcribe it
 *   (`/api/ai/transcribe`, better with names). The system recognizer still runs alongside, when
 *   there is one, so you see words while speaking; the server's text replaces them at the end.
 *
 * Push-to-talk stops when the key/button is released. Hands-free stops after a short silence,
 * judged from the microphone level and from new words arriving.
 */

export type SpeechMode = 'system' | 'cloud';

const KEY = 'docket.speech';

export function speechMode(): SpeechMode {
  return localStorage.getItem(KEY) === 'cloud' ? 'cloud' : 'system';
}

export function setSpeechMode(mode: SpeechMode): void {
  localStorage.setItem(KEY, mode);
}

type SpeechRec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: (e: {
    results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
    resultIndex: number;
  }) => void;
  onend: () => void;
  onerror: (e: { error: string }) => void;
  start(): void;
  stop(): void;
  abort(): void;
};

function recognizerCtor(): (new () => SpeechRec) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRec;
    webkitSpeechRecognition?: new () => SpeechRec;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const systemSpeechAvailable = () => !!recognizerCtor();
export const cloudSpeechAvailable = () =>
  !!useSyncStore.getState().ai?.speech && typeof MediaRecorder !== 'undefined';

export class VoiceError extends Error {}

export interface Listening {
  /** Finish and deliver the text. */
  stop(): void;
  /** Throw away what was heard. */
  cancel(): void;
}

export interface ListenOptions {
  /** Hands-free: stop by itself after a pause. Push-to-talk: stop when released. Read live, so a
   * quick tap can turn push-to-talk into hands-free after it started. */
  handsFree: () => boolean;
  /** Project and label names, to help cloud recognition. */
  hints: string[];
  onPartial(text: string): void;
  /** Microphone level, 0–1, about 30 times a second. */
  onLevel?(level: number): void;
  /** Recording ended and cloud transcription started. */
  onTranscribing?(): void;
  /** Called exactly once. Empty text means nothing was heard. */
  onEnd(result: { text: string } | { error: string }): void;
}

const SILENCE_MS = 1400;
const MAX_MS = 90_000;
const NOTHING_MS = 8_000;

export async function listen(opts: ListenOptions): Promise<Listening> {
  const Ctor = recognizerCtor();
  let mode = speechMode();
  if (mode === 'cloud' && !cloudSpeechAvailable()) mode = 'system';
  if (mode === 'system' && !Ctor) {
    if (cloudSpeechAvailable()) mode = 'cloud';
    else throw new VoiceError(t('agent.speechUnsupported'));
  }
  const lang = getLocale() === 'zh' ? 'zh-CN' : 'en-US';

  let ended = false;
  let cancelled = false;
  let finals = '';
  let interim = '';
  const heard = () => (finals + interim).trim();
  const timers: number[] = [];
  let lastActivity = Date.now();
  let spoke = false;
  const started = Date.now();

  // --- microphone level (and the stream for cloud recording) ---------------------------------
  let stream: MediaStream | null = null;
  let audio: AudioContext | null = null;
  let raf = 0;
  /** Only trust "nothing was said" when the level meter is actually running. */
  let meterOk = false;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
  } catch (e) {
    const name = (e as DOMException).name;
    if (name === 'NotAllowedError' || name === 'SecurityError') throw new VoiceError(t('agent.micDenied'));
    if (mode === 'cloud') throw new VoiceError((e as Error).message);
    // System recognition can still work without our own stream (no level meter then).
  }
  if (stream) {
    try {
      audio = new AudioContext();
      // Created after an await, so the page may consider it un-gestured; ask to run anyway.
      if (audio.state === 'suspended') await audio.resume().catch(() => {});
      meterOk = audio.state === 'running';
      const analyser = audio.createAnalyser();
      analyser.fftSize = 512;
      audio.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        const level = Math.min(1, Math.sqrt(sum / buf.length) * 4);
        opts.onLevel?.(level);
        if (level > 0.12) {
          spoke = true;
          lastActivity = Date.now();
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    } catch {
      /* no level meter */
    }
  }

  const release = () => {
    cancelAnimationFrame(raf);
    for (const id of timers) clearInterval(id);
    for (const tr of stream?.getTracks() ?? []) tr.stop();
    void audio?.close().catch(() => {});
  };
  const finish = (result: { text: string } | { error: string }) => {
    if (ended) return;
    ended = true;
    release();
    opts.onEnd(cancelled ? { text: '' } : result);
  };

  // --- recognizer (system mode, or live preview in cloud mode) -------------------------------
  let rec: SpeechRec | null = null;
  let recDone: Promise<void> = Promise.resolve();
  if (Ctor) {
    rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    let resolveDone = () => {};
    recDone = new Promise<void>((r) => {
      resolveDone = r;
    });
    let recError: string | null = null;
    rec.onresult = (e) => {
      interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const said = r?.[0]?.transcript ?? '';
        if (r?.isFinal) finals += said;
        else interim += said;
      }
      spoke = true;
      lastActivity = Date.now();
      opts.onPartial(heard());
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') recError = t('agent.micDenied');
      else if (e.error === 'network') recError = t('agent.speechNetwork');
      else if (e.error === 'no-speech') recError = t('agent.noSpeech');
      else if (e.error !== 'aborted') recError = e.error;
    };
    rec.onend = () => {
      resolveDone();
      if (mode === 'system') {
        if (recError && !heard()) finish({ error: recError });
        else finish({ text: heard() });
      }
    };
    try {
      rec.start();
    } catch (e) {
      if (mode === 'system') {
        release();
        throw new VoiceError((e as Error).message);
      }
      rec = null;
    }
  }

  // --- cloud recording -----------------------------------------------------------------------
  let recorder: MediaRecorder | null = null;
  if (mode === 'cloud' && stream) {
    const chunks: Blob[] = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.onstop = async () => {
      if (cancelled) return finish({ text: '' });
      const blob = new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' });
      // Whisper-style models invent text for silence, so skip uploads with nothing said.
      if ((meterOk && !spoke) || blob.size < 2000) return finish({ text: heard() });
      opts.onTranscribing?.();
      try {
        const text = await transcribeCloud(blob, lang.slice(0, 2), opts.hints);
        await Promise.race([recDone, new Promise((r) => setTimeout(r, 300))]);
        finish({ text: text || heard() });
      } catch (e) {
        const fallback = heard();
        finish(fallback ? { text: fallback } : { error: (e as Error).message });
      }
    };
    recorder.start(250);
  }

  const stop = () => {
    if (ended) return;
    try {
      rec?.stop();
    } catch {
      /* already stopped */
    }
    // Some recognizers take seconds to wind down (e.g. a slow network); don't make people wait.
    if (mode === 'system') {
      window.setTimeout(() => {
        if (ended) return;
        try {
          rec?.abort();
        } catch {
          /* ignore */
        }
        finish(heard() ? { text: heard() } : { error: t('agent.noSpeech') });
      }, 1500);
    }
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    if (!rec && !recorder) finish({ text: heard() });
  };

  // Hands-free end of speech, and a hard cap for both modes.
  timers.push(
    window.setInterval(() => {
      const now = Date.now();
      if (now - started > MAX_MS) stop();
      else if (opts.handsFree() && spoke && now - lastActivity > SILENCE_MS) stop();
      else if (opts.handsFree() && !spoke && meterOk && now - started > NOTHING_MS) stop();
      else if (opts.handsFree() && !spoke && !meterOk && now - started > NOTHING_MS * 2) stop();
    }, 200),
  );

  return {
    stop,
    cancel() {
      cancelled = true;
      try {
        rec?.abort();
      } catch {
        /* ignore */
      }
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      finish({ text: '' });
    },
  };
}

async function transcribeCloud(audio: Blob, lang: string, hints: string[]): Promise<string> {
  const cfg = useSyncStore.getState().config;
  if (!cfg) throw new VoiceError(t('agent.unavailable'));
  const q = new URLSearchParams({ lang });
  const hint = hints.join('、').slice(0, 600);
  if (hint) q.set('hint', hint);
  const res = await fetch(`${cfg.url.replace(/\/+$/, '')}/api/ai/transcribe?${q}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': audio.type || 'audio/webm' },
    body: audio,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* not json */
    }
    throw new VoiceError(msg);
  }
  return ((await res.json()) as { text: string }).text;
}
