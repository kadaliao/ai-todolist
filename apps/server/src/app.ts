import { type AgentContext, type AgentMessage, decodeHlc, type Op } from '@ai-todo/core';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import type { UpgradeWebSocket } from 'hono/ws';
import { z } from 'zod';
import type { Ai, AiContext } from './ai';
import type { Db, Device } from './db';
import { type Hub, pushSchema } from './hub';
import { createMcpServer } from './mcp';
import type { Stt } from './stt';

/**
 * HTTP API. Every route except `/` and `/api/ping` needs a device token
 * (`Authorization: Bearer dk_…`, or `?token=` for the WebSocket).
 */

type Env = { Variables: { device: Device } };

const MAX_FUTURE_MS = 24 * 60 * 60 * 1000;

const contextSchema = z.object({
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timeZone: z.string().max(64),
  locale: z.string().max(16).optional(),
  projects: z.array(z.string().max(200)).max(500).default([]),
  labels: z.array(z.string().max(200)).max(500).default([]),
});

export function createApp(opts: {
  db: Db;
  hub: Hub;
  ai: Ai | null;
  stt?: Stt | null;
  upgradeWebSocket?: UpgradeWebSocket;
  /** Built web app to serve at `/` (same origin as the API). */
  webDir?: string;
}) {
  const { db, hub, ai } = opts;
  const stt = opts.stt ?? null;
  const app = new Hono<Env>();

  app.use(
    '*',
    cors({
      origin: '*',
      allowHeaders: ['Authorization', 'Content-Type', 'mcp-session-id', 'mcp-protocol-version'],
      exposeHeaders: ['mcp-session-id'],
    }),
  );

  app.get('/api/ping', (c) => c.json({ ok: true, name: 'docket-server' }));

  app.use('/api/*', async (c, next) => {
    if (c.req.path === '/api/ping') return next();
    const header = c.req.header('Authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : (c.req.query('token') ?? '');
    const device = db.verifyToken(token);
    if (!device) return c.json({ error: 'invalid token' }, 401);
    c.set('device', device);
    await next();
  });
  app.use('/mcp', async (c, next) => {
    const header = c.req.header('Authorization') ?? '';
    const device = db.verifyToken(header.startsWith('Bearer ') ? header.slice(7) : '');
    if (!device) return c.json({ error: 'invalid token' }, 401);
    await next();
  });

  app.get('/api/health', (c) =>
    c.json({
      ok: true,
      device: c.get('device').name,
      cursor: db.maxSeq(),
      ai: ai
        ? { available: true, model: ai.model, agent: true, speech: !!stt }
        : { available: false, speech: !!stt },
    }),
  );

  // --- sync -------------------------------------------------------------------------------------

  app.post('/api/sync/push', bodyLimit({ maxSize: 8 * 1024 * 1024 }), async (c) => {
    const parsed = pushSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: 'invalid ops', detail: parsed.error.issues.slice(0, 3) }, 400);
    const ops = parsed.data.ops as Op[];
    const limit = Date.now() + MAX_FUTURE_MS;
    if (ops.some((op) => decodeHlc(op.hlc).wall > limit)) {
      return c.json({ error: 'clock too far ahead; check this device’s date and time' }, 400);
    }
    return c.json(hub.push(ops));
  });

  app.get('/api/sync/pull', (c) => {
    const since = Math.max(0, Number(c.req.query('since') ?? 0) || 0);
    const limit = Math.min(5000, Math.max(1, Number(c.req.query('limit') ?? 2000) || 2000));
    return c.json(hub.pull(since, limit, c.req.query('device') || undefined));
  });

  if (opts.upgradeWebSocket) {
    app.get(
      '/api/sync/ws',
      opts.upgradeWebSocket(() => {
        let off: (() => void) | null = null;
        return {
          onOpen(_e, ws) {
            ws.send(JSON.stringify({ type: 'hello', cursor: db.maxSeq() }));
            off = hub.onChange((cursor) => ws.send(JSON.stringify({ type: 'changed', cursor })));
          },
          onClose() {
            off?.();
          },
          onError() {
            off?.();
          },
        };
      }),
    );
  }

  // --- AI ----------------------------------------------------------------------------------------

  const ndjson = (gen: (signal: AbortSignal) => AsyncGenerator<unknown>, signal: AbortSignal) => {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (obj: unknown) => controller.enqueue(enc.encode(`${JSON.stringify(obj)}\n`));
        try {
          for await (const data of gen(signal)) send({ type: 'item', data });
          send({ type: 'done' });
        } catch (e) {
          if (!signal.aborted) send({ type: 'error', error: friendlyAiError(e) });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(body, {
      headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  };

  app.post('/api/ai/extract', bodyLimit({ maxSize: 256 * 1024 }), async (c) => {
    if (!ai) return c.json({ error: 'AI is not configured on the server' }, 503);
    const body = z
      .object({ text: z.string().min(1).max(20_000), context: contextSchema })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid request' }, 400);
    return ndjson(
      (signal) => ai.extract(body.data.text, body.data.context as AiContext, signal),
      c.req.raw.signal,
    );
  });

  app.post('/api/ai/breakdown', bodyLimit({ maxSize: 64 * 1024 }), async (c) => {
    if (!ai) return c.json({ error: 'AI is not configured on the server' }, 503);
    const body = z
      .object({
        title: z.string().min(1).max(500),
        notes: z.string().max(8000).default(''),
        existing: z.array(z.string()).max(100).default([]),
        context: contextSchema,
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid request' }, 400);
    const { title, notes, existing, context } = body.data;
    return ndjson(
      (signal) => ai.breakdown({ title, notes, existing }, context as AiContext, signal),
      c.req.raw.signal,
    );
  });

  const agentMessage = z.discriminatedUnion('role', [
    z.object({ role: z.literal('user'), text: z.string().max(20_000) }),
    z.object({
      role: z.literal('assistant'),
      text: z.string().max(20_000),
      calls: z
        .array(z.object({ id: z.string().max(200), name: z.string().max(64), input: z.unknown() }))
        .max(50)
        .optional(),
    }),
    z.object({
      role: z.literal('tool'),
      results: z
        .array(
          z.object({
            id: z.string().max(200),
            name: z.string().max(64),
            output: z.unknown(),
            error: z.literal(true).optional(),
          }),
        )
        .max(50),
    }),
  ]);

  /** One model step for the in-app assistant; the device runs the tools (see core/agent). */
  app.post('/api/agent', bodyLimit({ maxSize: 1024 * 1024 }), async (c) => {
    if (!ai) return c.json({ error: 'AI is not configured on the server' }, 503);
    const body = z
      .object({
        messages: z.array(agentMessage).min(1).max(120),
        context: z.record(z.string(), z.unknown()),
        tools: z.array(z.string().max(64)).max(50),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid request' }, 400);
    const { messages, context, tools } = body.data;
    return ndjson(
      (signal) => ai.agentStep(messages as AgentMessage[], context as unknown as AgentContext, tools, signal),
      c.req.raw.signal,
    );
  });

  app.post('/api/ai/transcribe', bodyLimit({ maxSize: 25 * 1024 * 1024 }), async (c) => {
    if (!stt) return c.json({ error: 'Cloud speech recognition is not configured on the server' }, 503);
    const type = c.req.header('Content-Type') ?? 'audio/webm';
    const ext =
      type.includes('mp4') || type.includes('m4a') || type.includes('aac')
        ? 'm4a'
        : type.includes('wav')
          ? 'wav'
          : type.includes('mpeg')
            ? 'mp3'
            : type.includes('ogg')
              ? 'ogg'
              : 'webm';
    const language = /^[a-z]{2}$/.test(c.req.query('lang') ?? '') ? c.req.query('lang') : undefined;
    const hint = (c.req.query('hint') ?? '').slice(0, 800) || undefined;
    try {
      const text = await stt.transcribe(new Blob([await c.req.arrayBuffer()], { type }), `speech.${ext}`, {
        ...(language ? { language } : {}),
        ...(hint ? { hint } : {}),
        signal: c.req.raw.signal,
      });
      return c.json({ text });
    } catch (e) {
      return c.json({ error: friendlyAiError(e) }, 502);
    }
  });

  // --- MCP ---------------------------------------------------------------------------------------

  app.all('/mcp', async (c) => {
    // Stateless: a fresh server + transport per request; all state lives in the hub.
    const server = createMcpServer(hub);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    const res = await transport.handleRequest(c.req.raw);
    return res;
  });

  if (opts.webDir) mountWeb(app, opts.webDir);
  else app.get('/', (c) => c.text('docket-server'));

  return app;
}

/** Static web app with SPA fallback; hashed assets are immutable, index.html is not cached. */
function mountWeb(app: Hono<Env>, dir: string) {
  const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
    '.webmanifest': 'application/manifest+json',
    '.json': 'application/json',
    '.ico': 'image/x-icon',
    '.map': 'application/json',
  };
  app.get('*', async (c) => {
    const { readFile } = await import('node:fs/promises');
    const { extname, join, normalize } = await import('node:path');
    const rel = normalize(decodeURIComponent(c.req.path)).replace(/^(\.\.[/\\])+/, '');
    const tryFile = async (p: string) => {
      try {
        return await readFile(join(dir, p));
      } catch {
        return null;
      }
    };
    let file = rel !== '/' ? await tryFile(rel) : null;
    let ext = extname(rel);
    if (!file) {
      file = await tryFile('index.html');
      ext = '.html';
    }
    if (!file) return c.notFound();
    const immutable = rel.startsWith('/assets/');
    return c.body(new Uint8Array(file), 200, {
      'Content-Type': types[ext] ?? 'application/octet-stream',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
  });
}

function friendlyAiError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/not allowed to use|model permission|does not have access/i.test(msg)) {
    return `The provider’s key can’t use this model: ${msg.slice(0, 200)}`;
  }
  if (/\b401\b|unauthori[sz]ed|(invalid|incorrect).{0,20}api key/i.test(msg))
    return 'AI provider rejected the API key';
  if (/429|rate/i.test(msg)) return 'AI provider is rate limiting; try again shortly';
  if (/timeout|ETIMEDOUT|ECONNRESET|fetch failed/i.test(msg)) return 'Could not reach the AI provider';
  return msg.slice(0, 300);
}
