import { describe, expect, it } from 'vitest';
import {
  type AgentTransport,
  Assistant,
  createTask,
  Journal,
  type ModelEvent,
  summarize,
  type VoiceCapture,
  type VoiceRecord,
} from '../src';
import { clock, replica } from './helpers';

const NOW = '2026-11-13T02:00:00Z';

/** A model that takes `ms` per step and plays back the given steps. */
function model(c: ReturnType<typeof clock>, steps: ModelEvent[][], ms = 400): AgentTransport {
  let i = 0;
  return async function* () {
    c.advance(ms);
    for (const ev of steps[i++] ?? []) yield ev;
  };
}

let seq = 0;
const call = (name: string, input: unknown): ModelEvent => ({
  type: 'call',
  call: { id: `j${++seq}`, name, input },
});

function setup(steps: ModelEvent[][]) {
  const c = clock(NOW);
  const r = replica('dev1', c);
  const a = new Assistant({ replica: r, transport: model(c, steps), locale: () => 'zh-CN', now: c.now });
  const saved: VoiceRecord[][] = [];
  const j = new Journal([], (records) => saved.push(structuredClone(records)));
  a.subscribe((s) => j.observe(s.turns));
  return { c, r, a, j, saved };
}

const spoken = (c: ReturnType<typeof clock>, text: string): VoiceCapture => {
  const now = c.now();
  return {
    mode: 'cloud',
    system: `${text}（系统）`,
    cloud: text,
    audio: 'a.wav',
    startedAt: now - 3000,
    releasedAt: now - 900,
    textAt: now,
    handsFree: false,
  };
};

describe('voice journal', () => {
  it('records a spoken turn with timings measured from finger-up', async () => {
    const { c, a, j } = setup([[call('add-tasks', { tasks: [{ title: '买菜' }], reply: '加好了' })]]);
    j.willSay(spoken(c, '加一个买菜'));
    await a.say('加一个买菜');
    expect(j.unused()).toBeNull();
    const [rec] = j.list();
    expect(rec).toMatchObject({
      input: 'voice',
      heard: '加一个买菜',
      status: 'applied',
      reply: '加好了',
      steps: 1,
      changes: [{ kind: 'added', title: '买菜' }],
      capture: { mode: 'cloud', cloud: '加一个买菜', audio: 'a.wav', speechMs: 2100, transcribeMs: 900 },
      // 900 ms to transcribe + 400 ms model step.
      firstChangeMs: 1300,
      doneMs: 1300,
    });
  });

  it('marks a record undone, and counts it', async () => {
    const { a, j } = setup([
      [call('add-tasks', { tasks: [{ title: 'a' }], reply: '好' })],
      [call('add-tasks', { tasks: [{ title: 'b' }], reply: '好' })],
    ]);
    await a.say('加 a');
    await a.say('加 b');
    a.undo();
    expect(j.list().map((r) => r.status)).toEqual(['applied', 'undone']);
    expect(summarize(j.list())).toMatchObject({ count: 2, voice: 0, applied: 2, undone: 1 });
  });

  it('a “好” that settles a held proposal updates that record and leaves its capture unused', async () => {
    const { c, r, a, j } = setup([
      [call('delete-tasks', { ids: ['t1'] })],
      [{ type: 'text', text: '要删掉 x 吗？' }],
    ]);
    r.dispatch(createTask({ title: 'x', scheduled: { date: '2026-11-13' } }));
    await a.say('删掉 x');
    expect(j.list()[0]?.status).toBe('pending');
    j.willSay(spoken(c, '好'));
    await a.say('好');
    expect(j.unused()?.cloud).toBe('好');
    expect(j.list()).toHaveLength(1);
    expect(j.list()[0]).toMatchObject({ status: 'applied', answer: '好' });
  });

  it('summarizes latency over voice turns', () => {
    const rec = (firstChangeMs: number): VoiceRecord => ({
      id: String(firstChangeMs),
      at: NOW,
      input: 'voice',
      heard: 'x',
      status: 'applied',
      reply: '',
      tools: [],
      changes: [{ kind: 'added', title: 'x' }],
      steps: 1,
      firstChangeMs,
      doneMs: firstChangeMs + 100,
    });
    const s = summarize([1000, 3000, 2000, 5000].map(rec));
    expect(s.firstChange).toEqual({ p50: 3000, p90: 5000, n: 4 });
    expect(s.done?.p50).toBe(3100);
  });
});
