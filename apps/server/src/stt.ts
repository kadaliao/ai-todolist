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
    const prompt = transcriptionPrompt(opts.language, opts.hint);
    if (prompt) form.append('prompt', prompt);
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

/**
 * Whisper-style models treat the prompt as preceding text: a Simplified Chinese sentence keeps
 * them from answering in Traditional characters, and the user's project/label names help them
 * spell those right.
 */
export function transcriptionPrompt(language?: string, hint?: string): string {
  const lead = language === 'zh' ? '以下是普通话的句子，使用简体中文。' : '';
  return `${lead}${hint ?? ''}`.trim();
}
