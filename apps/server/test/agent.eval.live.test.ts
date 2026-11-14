import { writeFileSync } from 'node:fs';
import {
  type AgentTransport,
  Assistant,
  addDays,
  addMemory,
  completeTask,
  createLabel,
  createProject,
  createSection,
  createTask,
  DAY_PARTS_KEY,
  dayParts,
  Replica,
  setSetting,
  type Task,
  todayIn,
} from '@ai-todo/core';
import { describe, expect, it } from 'vitest';
import { Ai } from '../src/ai';
import { loadConfig } from '../src/config';
import { CASES, type CheckContext, CheckFailed, type EvalCase, lastWeekDaysAgo, phrase } from './agent-cases';

/**
 * The assistant's evaluation set against the configured model (skipped without DOCKET_AI_* env):
 *
 *   pnpm --filter @ai-todo/server eval:agent
 *   EVAL_ONLY=deadline EVAL_OUT=/tmp/eval.json pnpm --filter @ai-todo/server eval:agent
 *
 * Every case runs on a fresh list; the run passes at 90% or better. EVAL_ONLY filters by group or
 * name (a regular expression), EVAL_OUT writes every result as JSON, EVAL_CONCURRENCY sets how
 * many cases talk to the model at once (default 6).
 */

const config = loadConfig();
const live = config.ai ? describe : describe.skip;
const tz = 'Asia/Shanghai';
const DAY = 86_400_000;

interface Result {
  group: string;
  name: string;
  pass: boolean;
  reason?: string;
  replies: string[];
  tools: string[];
  steps: number;
  ms: number;
}

async function runCase(c: EvalCase, transport: AgentTransport): Promise<Result> {
  let clock = Date.now();
  const r = new Replica({ deviceId: 'eval', timeZone: tz, now: () => clock });
  const today = todayIn(new Date(clock), tz);
  const seed = c.seed ?? {};
  const projectIds = new Map<string, string>();
  for (const p of seed.projects ?? []) {
    const name = typeof p === 'string' ? p : p.name;
    const { result: id } = r.dispatch(createProject({ name }));
    projectIds.set(name, id);
    if (typeof p !== 'string')
      for (const s of p.sections) r.dispatch(createSection({ projectId: id, name: s }));
  }
  const labelIds = new Map<string, string>();
  for (const l of seed.labels ?? []) labelIds.set(l, r.dispatch(createLabel({ name: l })).result);
  const taskIds = new Map<string, string>();
  for (const t of seed.tasks ?? []) {
    const { result: id } = r.dispatch(
      createTask({
        title: t.title,
        projectId: t.project ? (projectIds.get(t.project) ?? null) : null,
        ...(t.section && t.project
          ? {
              sectionId:
                r.store
                  .all('section')
                  .find((s) => s.name === t.section && s.projectId === projectIds.get(t.project as string))
                  ?.id ?? null,
            }
          : {}),
        ...(t.parent ? { parentId: taskIds.get(t.parent) } : {}),
        ...(t.day !== undefined
          ? { scheduled: { date: addDays(today, t.day), ...(t.time ? { time: t.time } : {}) } }
          : {}),
        ...(t.deadline !== undefined ? { deadline: addDays(today, t.deadline) } : {}),
        ...(t.labels ? { labels: t.labels.map((l) => labelIds.get(l) as string) } : {}),
        ...(t.priority ? { priority: t.priority } : {}),
        ...(t.repeat ? { recurrence: { rule: t.repeat } } : {}),
      }),
    );
    taskIds.set(t.title, id);
    if (t.doneDaysAgo !== undefined) {
      const back = t.doneDaysAgo === 'last-week' ? lastWeekDaysAgo(today) : t.doneDaysAgo;
      const real = clock;
      clock = real - back * DAY;
      r.dispatch(completeTask(id));
      clock = real;
    }
  }
  for (const m of seed.memory ?? []) r.dispatch(addMemory(m));
  if (seed.dayParts) r.dispatch(setSetting(DAY_PARTS_KEY, { ...dayParts(r.store), ...seed.dayParts }));
  const focus = seed.focus ? taskIds.get(seed.focus) : undefined;

  const a = new Assistant({
    replica: r,
    transport,
    locale: () => (/^[\x20-\x7e]+$/.test(c.say[0] ?? '') ? 'en-US' : 'zh-CN'),
    ...(focus ? { focus: () => ({ taskId: focus }) } : {}),
  });
  const start = performance.now();
  let reason: string | undefined;
  try {
    for (const u of c.say) await a.say(u);
    const turns = a.getState().turns;
    const last = turns.at(-1);
    if (!last) throw new CheckFailed('no turn');
    const live = () => r.store.all('task').filter((t) => !t.deletedAt);
    const ctx: CheckContext = {
      r,
      today,
      turns,
      last,
      task: (re) => live().find((t) => re.test(t.title)) as Task | undefined,
      open: () => live().filter((t) => !t.completedAt),
      P: (text) => phrase(text, new Date(clock), tz, dayParts(r.store)),
      d: (n) => addDays(today, n),
      project: (id) => (id ? (r.store.get('project', id)?.name ?? '?') : 'Inbox'),
      memory: () =>
        r.store
          .all('memory')
          .filter((m) => !m.deletedAt)
          .map((m) => m.text),
      called: (name) => turns.some((t) => t.tools.includes(name)),
    };
    c.check(ctx);
  } catch (e) {
    reason = e instanceof CheckFailed ? e.message : `error: ${(e as Error).message}`;
  }
  const turns = a.getState().turns;
  return {
    group: c.group,
    name: c.name,
    pass: !reason,
    ...(reason ? { reason } : {}),
    replies: turns.map((t) => t.reply || t.error || ''),
    tools: turns.flatMap((t) => t.tools),
    steps: turns.reduce((n, t) => n + t.steps, 0),
    ms: Math.round(performance.now() - start),
  };
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i] as T);
      }
    }),
  );
  return out;
}

live('assistant evaluation set (live model)', () => {
  it(
    'passes at least 90% of the cases',
    async () => {
      const ai = new Ai(config.ai as NonNullable<typeof config.ai>);
      const transport: AgentTransport = (req, signal) =>
        ai.agentStep(req.messages, req.context, req.tools, signal);
      const only = process.env.EVAL_ONLY ? new RegExp(process.env.EVAL_ONLY) : null;
      const cases = CASES.filter((c) => !only || only.test(c.group) || only.test(c.name));
      const results = await pool(cases, Number(process.env.EVAL_CONCURRENCY) || 6, (c) =>
        runCase(c, transport),
      );

      const groups = new Map<string, { pass: number; total: number }>();
      for (const r of results) {
        const g = groups.get(r.group) ?? { pass: 0, total: 0 };
        g.total++;
        if (r.pass) g.pass++;
        groups.set(r.group, g);
      }
      console.log(`model ${config.ai?.model}, ${results.length} cases`);
      console.table([...groups].map(([group, g]) => ({ group, pass: `${g.pass}/${g.total}` })));
      const failed = results.filter((r) => !r.pass);
      if (failed.length) {
        console.table(
          failed.map((r) => ({
            case: `${r.group} · ${r.name}`.slice(0, 40),
            reason: r.reason?.slice(0, 120),
            reply: r.replies.join(' | ').slice(0, 80),
            tools: r.tools.join(','),
          })),
        );
      }
      const ms = results.map((r) => r.ms / Math.max(1, r.steps ? 1 : 1)).sort((a, b) => a - b);
      const steps = results.map((r) => r.steps).sort((a, b) => a - b);
      const passRate = (results.length - failed.length) / results.length;
      console.log(
        `pass ${results.length - failed.length}/${results.length} (${(passRate * 100).toFixed(1)}%), ` +
          `per case median ${ms[Math.floor(ms.length / 2)]} ms, model calls median ${steps[Math.floor(steps.length / 2)]}`,
      );
      if (process.env.EVAL_OUT) writeFileSync(process.env.EVAL_OUT, JSON.stringify(results, null, 2));
      if (!only) expect(results.length).toBeGreaterThanOrEqual(100);
      expect(passRate).toBeGreaterThanOrEqual(0.9);
    },
    30 * 60_000,
  );
});
