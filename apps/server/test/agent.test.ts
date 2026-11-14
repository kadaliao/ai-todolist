import {
  type AgentRequest,
  type AgentTransport,
  Assistant,
  createTask,
  type ModelEvent,
  Replica,
} from '@ai-todo/core';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { Ai, agentPrompt } from '../src/ai';
import { createApp } from '../src/app';
import { Db } from '../src/db';
import { Hub } from '../src/hub';

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

type Chunk = Record<string, unknown>;

function mockModel(steps: ((prompt: unknown) => Chunk[])[]) {
  const prompts: unknown[] = [];
  let i = 0;
  const model = new MockLanguageModelV4({
    doStream: async (options) => {
      prompts.push(options);
      const step = steps[i++];
      if (!step) throw new Error('unexpected model call');
      return { stream: simulateReadableStream({ chunks: step(options) as never[] }) };
    },
  });
  return { model, prompts };
}

const text = (t: string): Chunk[] => [
  { type: 'text-start', id: 'x' },
  { type: 'text-delta', id: 'x', delta: t },
  { type: 'text-end', id: 'x' },
  { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
];
const toolCall = (name: string, input: unknown): Chunk[] => [
  { type: 'tool-call', toolCallId: `call_${name}`, toolName: name, input: JSON.stringify(input) },
  { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage },
];

function setup(steps: ((prompt: unknown) => Chunk[])[]) {
  const db = new Db(':memory:');
  const hub = new Hub(db, 'Asia/Shanghai');
  const { model, prompts } = mockModel(steps);
  const ai = new Ai({ baseURL: 'http://x', apiKey: 'k', model: 'm', structuredOutputs: false }, model);
  const app = createApp({ db, hub, ai });
  const token = db.createToken('phone');
  const transport: AgentTransport = async function* (req: AgentRequest, signal: AbortSignal) {
    const res = await app.request('/api/agent', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    for (const line of (await res.text()).split('\n')) {
      if (!line.trim()) continue;
      const msg = JSON.parse(line) as { type: string; data?: ModelEvent; error?: string };
      if (msg.type === 'item' && msg.data) yield msg.data;
      if (msg.type === 'error') yield { type: 'error', error: msg.error ?? 'error' };
    }
  };
  return { app, token, transport, prompts };
}

describe('/api/agent', () => {
  it('runs a full turn: the model calls a tool, the device runs it, the model replies', async () => {
    const { transport, prompts } = setup([
      () => toolCall('complete-tasks', { ids: ['t1'] }),
      () => text('写周报已经勾掉了。'),
    ]);
    const r = new Replica({ deviceId: 'phone', timeZone: 'Asia/Shanghai' });
    const { result: id } = r.dispatch(createTask({ title: '写周报', scheduled: { date: todayIn() } }));
    const a = new Assistant({ replica: r, transport, locale: () => 'zh-CN' });
    await a.say('周报写完了');
    const turn = a.getState().turns.at(-1);
    expect(turn).toMatchObject({ status: 'applied', reply: '写周报已经勾掉了。', tools: ['complete-tasks'] });
    expect(r.store.get('task', id)?.completedAt).toBeTruthy();

    // First request: the tools are offered and the user's list is in the system prompt.
    const first = prompts[0] as { tools: { name: string }[]; prompt: { role: string; content: unknown }[] };
    expect(first.tools.map((t) => t.name)).toContain('complete-tasks');
    expect(JSON.stringify(first.prompt[0])).toContain('写周报');
    // Second request carries the tool call and its result.
    const second = prompts[1] as { prompt: { role: string; content: { type: string }[] }[] };
    expect(second.prompt.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
    expect(second.prompt[3]?.content[0]?.type).toBe('tool-result');
  });

  it('reports provider errors to the device', async () => {
    const { transport } = setup([() => [{ type: 'error', error: new Error('429 rate limited') }]]);
    const r = new Replica({ deviceId: 'phone', timeZone: 'Asia/Shanghai' });
    const a = new Assistant({ replica: r, transport, locale: () => 'zh-CN' });
    await a.say('hi');
    expect(a.getState().turns.at(-1)).toMatchObject({ status: 'error' });
    expect(a.getState().turns.at(-1)?.error).toMatch(/rate limit/);
  });

  it('rejects malformed requests and needs a token', async () => {
    const { app, token } = setup([]);
    const bad = await app.request('/api/agent', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'robot' }], context: {}, tools: [] }),
    });
    expect(bad.status).toBe(400);
    const anon = await app.request('/api/agent', { method: 'POST', body: '{}' });
    expect(anon.status).toBe(401);
  });

  it('health says the assistant is available', async () => {
    const { app, token } = setup([]);
    const res = await app.request('/api/health', { headers: { Authorization: `Bearer ${token}` } });
    expect(((await res.json()) as { ai: unknown }).ai).toMatchObject({
      available: true,
      agent: true,
      speech: false,
    });
  });
});

describe('agentPrompt', () => {
  it('states the date in words and keeps the lists', () => {
    const p = agentPrompt({
      today: '2026-11-13',
      weekday: 5,
      now: '10:00',
      timeZone: 'Asia/Shanghai',
      locale: 'zh-CN',
      projects: [{ name: '工作' }],
      labels: [],
      overdue: [],
      todayTasks: [{ id: 't1', title: '写周报', project: 'Inbox', priority: 'p4' }],
      upcoming: [],
      inbox: [],
    });
    expect(p).toContain('2026-11-13 (Friday, 周五) 10:00');
    expect(p).toContain('"title":"写周报"');
    expect(p).not.toContain('"weekday"');
  });
});

function todayIn(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}

describe('/api/ai/transcribe', () => {
  it('forwards audio, language and vocabulary to an OpenAI-compatible endpoint', async () => {
    const { createServer } = await import('node:http');
    const { Stt } = await import('../src/stt');
    let seen: { model?: string; language?: string; prompt?: string; size?: number; auth?: string } = {};
    const srv = createServer(async (req, res) => {
      const form = await new Request('http://x', {
        method: 'POST',
        headers: req.headers as HeadersInit,
        body: req as unknown as BodyInit,
        duplex: 'half',
      } as RequestInit).formData();
      seen = {
        model: String(form.get('model')),
        language: String(form.get('language')),
        prompt: String(form.get('prompt')),
        size: (form.get('file') as File).size,
        auth: req.headers.authorization,
      };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ text: ' 提醒我明天九点给张三打电话 ' }));
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as { port: number }).port;
    const db = new Db(':memory:');
    const app = createApp({
      db,
      hub: new Hub(db, 'Asia/Shanghai'),
      ai: null,
      stt: new Stt({ baseURL: `http://127.0.0.1:${port}/v1`, apiKey: 'sk-test', model: 'sense-voice' }),
    });
    const token = db.createToken('phone');
    const res = await app.request(`/api/ai/transcribe?lang=zh&hint=${encodeURIComponent('工作、生活')}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'audio/mp4' },
      body: new Uint8Array(3000),
    });
    srv.close();
    expect(await res.json()).toEqual({ text: '提醒我明天九点给张三打电话' });
    expect(seen).toEqual({
      model: 'sense-voice',
      language: 'zh',
      prompt: '工作、生活',
      size: 3000,
      auth: 'Bearer sk-test',
    });
    // Health reports cloud speech even without a chat model.
    const health = await app.request('/api/health', { headers: { Authorization: `Bearer ${token}` } });
    expect(((await health.json()) as { ai: unknown }).ai).toMatchObject({ available: false, speech: true });
  });
});
