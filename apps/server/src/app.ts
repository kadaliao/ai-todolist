import { decodeHlc, type Op } from '@ai-todo/core';
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

export function createApp(opts: { db: Db; hub: Hub; ai: Ai | null; upgradeWebSocket?: UpgradeWebSocket }) {
  const { db, hub, ai } = opts;
  const app = new Hono<Env>();

  app.use(
    '*',
    cors({
      origin: '*',
      allowHeaders: ['Authorization', 'Content-Type', 'mcp-session-id', 'mcp-protocol-version'],
      exposeHeaders: ['mcp-session-id'],
    }),
  );

  app.get('/', (c) => c.text('docket-server'));
  app.get('/api/ping', (c) => c.json({ ok: true }));

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
      ai: ai ? { available: true, model: ai.model, speech: !!ai.config.sttModel } : { available: false },
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

  app.post('/api/ai/transcribe', bodyLimit({ maxSize: 25 * 1024 * 1024 }), async (c) => {
    if (!ai) return c.json({ error: 'AI is not configured on the server' }, 503);
    const type = c.req.header('Content-Type') ?? 'audio/webm';
    const ext =
      type.includes('mp4') || type.includes('m4a')
        ? 'm4a'
        : type.includes('wav')
          ? 'wav'
          : type.includes('mpeg')
            ? 'mp3'
            : 'webm';
    try {
      const text = await ai.transcribe(new Blob([await c.req.arrayBuffer()], { type }), `speech.${ext}`);
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

  return app;
}

function friendlyAiError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/401|unauthor|api key/i.test(msg)) return 'AI provider rejected the API key';
  if (/429|rate/i.test(msg)) return 'AI provider is rate limiting; try again shortly';
  if (/timeout|ETIMEDOUT|ECONNRESET|fetch failed/i.test(msg)) return 'Could not reach the AI provider';
  return msg.slice(0, 300);
}
