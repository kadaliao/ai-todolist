import { join } from 'node:path';
import type { AiConfig, SttConfig } from './ai';

export interface Config {
  port: number;
  host: string;
  dbPath: string;
  timeZone: string;
  ai: AiConfig | null;
  stt: SttConfig | null;
  webDir?: string;
}

/**
 * Environment:
 *   DOCKET_PORT (8787) · DOCKET_HOST (0.0.0.0) · DOCKET_DATA_DIR (./data) · DOCKET_TZ (TZ or Asia/Shanghai)
 *   DOCKET_AI_BASE_URL · DOCKET_AI_API_KEY · DOCKET_AI_MODEL
 *   DOCKET_AI_STRUCTURED_OUTPUTS (1/0, default 1; set 0 for providers without json_schema support)
 *   Cloud speech recognition (optional; devices default to the system recognizer):
 *   DOCKET_STT_MODEL (or the older DOCKET_AI_STT_MODEL) · DOCKET_STT_BASE_URL · DOCKET_STT_API_KEY
 *   (the last two default to the DOCKET_AI_* values, for providers that do both)
 *   DOCKET_WEB_DIR (optional: serve the built web app from this directory at `/`)
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = env.DOCKET_DATA_DIR ?? join(process.cwd(), 'data');
  const ai =
    env.DOCKET_AI_BASE_URL && env.DOCKET_AI_API_KEY && env.DOCKET_AI_MODEL
      ? {
          baseURL: env.DOCKET_AI_BASE_URL,
          apiKey: env.DOCKET_AI_API_KEY,
          model: env.DOCKET_AI_MODEL,
          structuredOutputs: env.DOCKET_AI_STRUCTURED_OUTPUTS !== '0',
        }
      : null;
  const sttModel = env.DOCKET_STT_MODEL ?? env.DOCKET_AI_STT_MODEL;
  const sttBase = env.DOCKET_STT_BASE_URL ?? env.DOCKET_AI_BASE_URL;
  const sttKey = env.DOCKET_STT_API_KEY ?? env.DOCKET_AI_API_KEY;
  const stt = sttModel && sttBase && sttKey ? { baseURL: sttBase, apiKey: sttKey, model: sttModel } : null;
  return {
    port: Number(env.DOCKET_PORT ?? 8787),
    host: env.DOCKET_HOST ?? '0.0.0.0',
    dbPath: join(dataDir, 'docket.db'),
    timeZone: env.DOCKET_TZ ?? env.TZ ?? 'Asia/Shanghai',
    ai,
    stt,
    ...(env.DOCKET_WEB_DIR ? { webDir: env.DOCKET_WEB_DIR } : {}),
  };
}
