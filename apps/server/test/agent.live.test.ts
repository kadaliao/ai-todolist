import {
  type AgentTransport,
  Assistant,
  addDays,
  createProject,
  createTask,
  createTasks,
  isoWeekday,
  Replica,
  type Task,
  todayIn,
} from '@ai-todo/core';
import { afterAll, describe, expect, it } from 'vitest';
import { Ai } from '../src/ai';
import { loadConfig } from '../src/config';

/**
 * Live evaluation of the voice assistant against the configured model (skipped without
 * DOCKET_AI_* env): pnpm --filter @ai-todo/server eval
 *
 * Each case seeds a list, says one or two things the way people talk to their phone (Chinese,
 * with the odd recognition error), and checks the resulting data, not the wording.
 */

const config = loadConfig();
const live = config.ai ? describe : describe.skip;
const tz = 'Asia/Shanghai';
const today = todayIn(new Date(), tz);
const next = (iso: number) => addDays(today, (iso - isoWeekday(today) + 7) % 7 || 7);

/** Per case: each model step's time to first event and total, in ms. */
const timings = new Map<string, { first: number; total: number; calls: number }[]>();

/** Wraps a transport to time each model step under the running test's name. */
function timed(transport: AgentTransport): AgentTransport {
  return async function* (req, signal) {
    const name = expect.getState().currentTestName ?? '?';
    const start = performance.now();
    let first = 0;
    let calls = 0;
    for await (const ev of transport(req, signal)) {
      if (!first) first = performance.now() - start;
      if (ev.type === 'call') calls++;
      yield ev;
    }
    const steps = timings.get(name) ?? [];
    steps.push({ first: Math.round(first), total: Math.round(performance.now() - start), calls });
    timings.set(name, steps);
  };
}

afterAll(() => {
  if (!timings.size) return;
  const rows = [...timings].map(([name, steps]) => ({
    case: name.replace(/^.*?\) /, '').slice(0, 42),
    steps: steps.length,
    'first ms': steps.map((s) => s.first).join(' / '),
    'step ms': steps.map((s) => s.total).join(' / '),
    'total ms': steps.reduce((n, s) => n + s.total, 0),
  }));
  const totals = rows.map((r) => r['total ms']).sort((a, b) => a - b);
  console.log(`model ${config.ai?.model}`);
  console.table(rows);
  console.log(`median ${totals[Math.floor(totals.length / 2)]} ms, max ${totals.at(-1)} ms`);
});

function setup() {
  const ai = new Ai(config.ai as NonNullable<typeof config.ai>);
  const r = new Replica({ deviceId: 'eval', timeZone: tz });
  const transport = timed((req, signal) => ai.agentStep(req.messages, req.context, req.tools, signal));
  const a = new Assistant({ replica: r, transport, locale: () => 'zh-CN' });
  const open = () => r.store.all('task').filter((t) => !t.deletedAt && !t.completedAt);
  const byTitle = (re: RegExp) => r.store.all('task').find((t) => !t.deletedAt && re.test(t.title)) as Task;
  const last = () => a.getState().turns.at(-1);
  return { r, a, open, byTitle, last };
}

live('voice assistant (live model)', { timeout: 90_000 }, () => {
  it('adds several tasks with the right dates', async () => {
    const { a, open, byTitle, last } = setup();
    await a.say('提醒我明早九点给张三打电话 还有下周五之前把房租交了');
    expect(last()?.status).toBe('applied');
    expect(open()).toHaveLength(2);
    expect(byTitle(/张三/).scheduled).toEqual({ date: addDays(today, 1), time: '09:00' });
    expect(byTitle(/房租/).deadline).toBeTruthy();
    console.log('  →', last()?.reply);
  });

  it('completes a task despite a misrecognized word', async () => {
    const { r, a, byTitle, last } = setup();
    r.dispatch(createTasks([{ title: '写周报', scheduled: { date: today } }, { title: '买牛奶' }]));
    await a.say('粥报已经写完了');
    expect(last()?.status).toBe('applied');
    expect(byTitle(/周报/).completedAt).toBeTruthy();
    expect(byTitle(/牛奶/).completedAt).toBeNull();
    console.log('  →', last()?.reply);
  });

  it('moves today’s unfinished tasks to Thursday', async () => {
    const { r, a, open, last } = setup();
    r.dispatch(createTasks(['回邮件', '整理发票'].map((title) => ({ title, scheduled: { date: today } }))));
    r.dispatch(createTask({ title: '下周的事', scheduled: { date: addDays(today, 9) } }));
    await a.say('把今天没做完的都挪到周四');
    expect(last()?.status).toBe('applied');
    const moved = open().filter((t) => t.title !== '下周的事');
    expect(moved.every((t) => t.scheduled?.date === next(4))).toBe(true);
    expect(open().find((t) => t.title === '下周的事')?.scheduled?.date).toBe(addDays(today, 9));
    console.log('  →', last()?.reply);
  });

  it('changes only the time of a task', async () => {
    const { r, a, byTitle, last } = setup();
    const day = addDays(today, 2);
    r.dispatch(createTask({ title: '和设计团队开会', scheduled: { date: day, time: '10:00' } }));
    await a.say('开会改到下午四点');
    expect(last()?.status).toBe('applied');
    expect(byTitle(/开会/).scheduled).toEqual({ date: day, time: '16:00' });
    console.log('  →', last()?.reply);
  });

  it('asks before deleting, then deletes on “好”', async () => {
    const { r, a, byTitle, last } = setup();
    r.dispatch(createTasks([{ title: '买牛奶' }, { title: '取快递' }]));
    await a.say('把买牛奶那条删掉');
    expect(last()?.status).toBe('pending');
    expect(byTitle(/牛奶/)).toBeTruthy();
    console.log('  →', last()?.reply);
    await a.say('好');
    expect(last()?.status).toBe('applied');
    expect(byTitle(/牛奶/)).toBeUndefined();
    expect(byTitle(/快递/)).toBeTruthy();
  });

  it('answers questions without changing anything', async () => {
    const { r, a, last } = setup();
    r.dispatch(
      createTasks([
        { title: '写周报', scheduled: { date: today } },
        { title: '去健身', scheduled: { date: today, time: '19:00' } },
      ]),
    );
    await a.say('今天还有什么事');
    expect(last()?.status).toBe('answered');
    expect(last()?.reply).toMatch(/周报|健身/);
    console.log('  →', last()?.reply);
  });

  it('breaks a task into subtasks', async () => {
    const { r, a, last } = setup();
    const { result: id } = r.dispatch(createTask({ title: '准备下周的产品发布会' }));
    await a.say('帮我把发布会这个任务拆一下');
    expect(last()?.status).toBe('applied');
    const subs = r.store.all('task').filter((t) => t.parentId === id);
    expect(subs.length).toBeGreaterThanOrEqual(2);
    console.log(
      '  →',
      last()?.reply,
      subs.map((t) => t.title),
    );
  });

  it('adds a task and its steps in one go (needs the new task’s id)', async () => {
    const { r, a, last } = setup();
    await a.say('加一个准备年会的任务 帮我拆成三步');
    expect(last()?.status).toBe('applied');
    const parent = r.store.all('task').find((t) => !t.parentId && /年会/.test(t.title));
    expect(parent).toBeTruthy();
    const subs = r.store.all('task').filter((t) => t.parentId === parent?.id);
    expect(subs.length).toBeGreaterThanOrEqual(2);
    console.log(
      '  →',
      last()?.reply,
      subs.map((t) => t.title),
    );
  });

  it('creates a project when asked and fills it', async () => {
    const { r, a, open, last } = setup();
    await a.say('新建一个装修项目 把买油漆和找师傅放进去');
    expect(last()?.status).toBe('applied');
    const project = r.store.all('project').find((p) => /装修/.test(p.name));
    expect(project).toBeTruthy();
    const inIt = open().filter((t) => t.projectId === project?.id);
    expect(inIt.map((t) => t.title).join()).toMatch(/油漆/);
    expect(inIt.map((t) => t.title).join()).toMatch(/师傅/);
    console.log('  →', last()?.reply);
  });

  it('follows up on the previous turn', async () => {
    const { a, open, last } = setup();
    await a.say('加一个买菜');
    expect(open()).toHaveLength(1);
    await a.say('不对 改成明天晚上');
    expect(last()?.status).toBe('applied');
    expect(open()).toHaveLength(1);
    expect(open()[0]?.scheduled?.date).toBe(addDays(today, 1));
    console.log('  →', last()?.reply);
  });

  it('moves a task to an existing project, and does not invent one', async () => {
    const { r, a, byTitle, last } = setup();
    const { result: life } = r.dispatch(createProject({ name: '生活' }));
    r.dispatch(createTask({ title: '去健身' }));
    await a.say('健身放到生活里面');
    expect(last()?.status).toBe('applied');
    expect(byTitle(/健身/).projectId).toBe(life);
    expect(r.store.all('project')).toHaveLength(1);
    console.log('  →', last()?.reply);
  });

  it('“这个” means the task on screen', async () => {
    const { r, a, byTitle, last } = setup();
    const { result: id } = r.dispatch(createTasks([{ title: '续签护照' }, { title: '修自行车' }]));
    const focus = id[1] as string;
    const b = new Assistant({
      replica: r,
      transport: timed((req, signal) =>
        new Ai(config.ai as NonNullable<typeof config.ai>).agentStep(
          req.messages,
          req.context,
          req.tools,
          signal,
        ),
      ),
      locale: () => 'zh-CN',
      focus: () => ({ taskId: focus }),
    });
    void a;
    await b.say('这个设成最高优先级');
    expect(b.getState().turns.at(-1)?.status).toBe('applied');
    expect(byTitle(/自行车/).priority).toBe(3);
    expect(byTitle(/护照/).priority).toBe(0);
    void last;
  });
});
