import type { SttConfig } from './ai';

/**
 * Cloud speech-to-text through an OpenAI-compatible `/audio/transcriptions` endpoint
 * (gpt-4o-transcribe, whisper, …). Optional: devices use the system recognizer by default.
 */
export class Stt {
  constructor(readonly config: SttConfig) {}

  get model(): string {
    return this.config.model;
  }

  /**
   * `hint` is vocabulary that helps recognition (project and label names); `language` is an
   * ISO-639-1 code like `zh`.
   */
  async transcribe(
    audio: Blob,
    filename: string,
    opts: { language?: string; hint?: string; signal?: AbortSignal } = {},
  ): Promise<string> {
    const form = new FormData();
    form.append('file', audio, filename);
    form.append('model', this.config.model);
    if (opts.language) form.append('language', opts.language);
    if (opts.hint) form.append('prompt', opts.hint);
    const res = await fetch(`${this.config.baseURL.replace(/\/+$/, '')}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.config.apiKey}` },
      body: form,
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      throw new Error(`transcription failed: HTTP ${res.status}${detail ? ` ${detail}` : ''}`);
    }
    return ((await res.json()) as { text: string }).text.trim();
  }
}
