import { join } from 'node:path';
import type { AiConfig } from './ai';

export interface Config {
  port: number;
  host: string;
  dbPath: string;
  timeZone: string;
  ai: AiConfig | null;
  webDir?: string;
}

/**
 * Environment:
 *   DOCKET_PORT (8787) · DOCKET_HOST (0.0.0.0) · DOCKET_DATA_DIR (./data) · DOCKET_TZ (TZ or Asia/Shanghai)
 *   DOCKET_AI_BASE_URL · DOCKET_AI_API_KEY · DOCKET_AI_MODEL · DOCKET_AI_STT_MODEL (optional)
 *   DOCKET_AI_STRUCTURED_OUTPUTS (1/0, default 1; set 0 for providers without json_schema support)
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
          ...(env.DOCKET_AI_STT_MODEL ? { sttModel: env.DOCKET_AI_STT_MODEL } : {}),
          structuredOutputs: env.DOCKET_AI_STRUCTURED_OUTPUTS !== '0',
        }
      : null;
  return {
    port: Number(env.DOCKET_PORT ?? 8787),
    host: env.DOCKET_HOST ?? '0.0.0.0',
    dbPath: join(dataDir, 'docket.db'),
    timeZone: env.DOCKET_TZ ?? env.TZ ?? 'Asia/Shanghai',
    ai,
    ...(env.DOCKET_WEB_DIR ? { webDir: env.DOCKET_WEB_DIR } : {}),
  };
}
