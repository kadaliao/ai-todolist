import { describe, expect, it } from 'vitest';
import {
  type AgentRequest,
  AgentSession,
  type AgentTransport,
  Assistant,
  completeTask,
  createProject,
  createTask,
  createTasks,
  executeTool,
  isAffirmative,
  isNegative,
  type ModelEvent,
  type Replica,
  type ToolEnv,
} from '../src';
import { clock, replica } from './helpers';

// 2026-11-13 10:00 in Shanghai, a Friday.
const NOW = '2026-11-13T02:00:00Z';

type Step = (req: AgentRequest) => ModelEvent[];

/** A fake model that plays back scripted steps and records what it was sent. */
function scripted(steps: Step[]): AgentTransport & { requests: AgentRequest[] } {
  const requests: AgentRequest[] = [];
  let i = 0;
  const t = async function* (req: AgentRequest) {
    requests.push(structuredClone(req));
    const step = steps[i++];
    if (!step) throw new Error('model called more often than scripted');
    for (const ev of step(req)) yield ev;
  };
  return Object.assign(t as AgentTransport, { requests });
}

let callSeq = 0;
const call = (name: string, input: unknown): ModelEvent => ({
  type: 'call',
  call: { id: `c${++callSeq}`, name, input },
});
const say = (text: string): ModelEvent => ({ type: 'text', text });

function setup(steps: Step[]) {
  const c = clock(NOW);
  const r = replica('dev1', c);
  const transport = scripted(steps);
  const a = new Assistant({ replica: r, transport, locale: () => 'zh-CN', now: c.now });
  return { r, a, transport, c };
}

const open = (r: Replica) => r.store.all('task').filter((t) => !t.deletedAt && !t.completedAt);
const lastText = (req: AgentRequest | undefined) => {
  const m = req?.messages.at(-1);
  return m && m.role === 'user' ? m.text : '';
};
const refOf = (req: AgentRequest, title: string) =>
  [...req.context.todayTasks, ...req.context.overdue, ...req.context.inbox, ...req.context.upcoming].find(
    (t) => t.title === title,
  )?.id as string;

describe('assistant turns', () => {
  it('adds tasks in one undoable step, with dates from the app’s parser', async () => {
    const { r, a, transport } = setup([
      () => [
        call('add-tasks', {
          tasks: [
            { title: '给张三打电话', when: '明早九点' },
            { title: '交房租', when: '周五之前' },
          ],
        }),
      ],
      () => [say('好的，加了两条。')],
    ]);
    await a.say('提醒我明早九点给张三打电话，还有周五之前交房租');
    const turn = a.getState().turns.at(-1);
    expect(turn?.status).toBe('applied');
    expect(turn?.reply).toBe('好的，加了两条。');
    expect(turn?.changes.map((c) => c.kind)).toEqual(['added', 'added']);
    const call1 = open(r).find((t) => t.title === '给张三打电话');
    expect(call1?.scheduled).toEqual({ date: '2026-11-14', time: '09:00' });
    expect(call1?.origin).toBe('ai');
    expect(open(r).find((t) => t.title === '交房租')?.scheduled?.date).toBe('2026-11-13');
    // The second request carries the tool results back to the model.
    expect(transport.requests[1]?.messages.at(-1)).toMatchObject({ role: 'tool' });

    expect(a.undo()).toBe(true);
    expect(open(r)).toHaveLength(0);
    expect(a.getState().turns.at(-1)?.status).toBe('undone');
  });

  it('answers questions without changing anything', async () => {
    const { r, a } = setup([() => [say('今天还有 1 件事：写周报。')]]);
    r.dispatch(createTask({ title: '写周报', scheduled: { date: '2026-11-13' } }));
    await a.say('今天还有什么');
    expect(a.getState().turns.at(-1)?.status).toBe('answered');
  });

  it('shows the model today’s tasks with short refs it can act on', async () => {
    const { r, a, transport } = setup([
      (req) => [call('reschedule-tasks', { ids: [refOf(req, '写周报')], when: '下周一' })],
      () => [say('挪到下周一了。')],
    ]);
    const { result: id } = r.dispatch(
      createTask({ title: '写周报', scheduled: { date: '2026-11-13', time: '15:00' } }),
    );
    await a.say('周报改到下周一');
    const ctx = transport.requests[0]?.context;
    expect(ctx?.todayTasks[0]).toMatchObject({ id: 't1', title: '写周报', time: '15:00' });
    expect(ctx?.weekday).toBe(5);
    expect(ctx?.now).toBe('10:00');
    expect(r.store.get('task', id)?.scheduled).toEqual({ date: '2026-11-16', time: '15:00' });
  });

  it('holds big changes until the user says yes', async () => {
    const { r, a } = setup([
      (req) => [
        call('reschedule-tasks', {
          ids: ['a', 'b', 'c', 'd', 'e'].map((x) => refOf(req, x)),
          when: '周四',
        }),
      ],
      () => [say('要把 5 件事挪到周四，确认吗？')],
    ]);
    r.dispatch(
      createTasks(['a', 'b', 'c', 'd', 'e'].map((title) => ({ title, scheduled: { date: '2026-11-13' } }))),
    );
    await a.say('今天的都挪到周四');
    expect(a.pending()?.changes).toHaveLength(5);
    expect(open(r).every((t) => t.scheduled?.date === '2026-11-13')).toBe(true);

    await a.say('好的');
    expect(a.getState().turns.at(-1)?.status).toBe('applied');
    expect(open(r).every((t) => t.scheduled?.date === '2026-11-19')).toBe(true);
    // One undo puts all five back.
    a.undo();
    expect(open(r).every((t) => t.scheduled?.date === '2026-11-13')).toBe(true);
  });

  it('asks before deleting, and "算了" cancels', async () => {
    const { r, a, transport } = setup([
      (req) => [call('delete-tasks', { ids: [refOf(req, '买牛奶')] })],
      () => [say('要删掉“买牛奶”吗？')],
      () => [say('好')],
    ]);
    r.dispatch(createTask({ title: '买牛奶' }));
    await a.say('把买牛奶删了');
    expect(a.pending()).toBeTruthy();
    const toolMsg = transport.requests[1]?.messages.at(-1);
    expect(JSON.stringify(toolMsg)).toMatch(/confirms/);
    await a.say('算了');
    expect(a.getState().turns.at(-1)?.status).toBe('cancelled');
    expect(open(r)).toHaveLength(1);
    // The model hears about it with the next message.
    await a.say('谢谢');
    expect(transport.requests[2]?.messages.at(-1)).toMatchObject({ role: 'user' });
    expect(lastText(transport.requests[2])).toMatch(/cancelled/);
  });

  it('a correction while a proposal is pending replaces it', async () => {
    const { r, a, transport } = setup([
      (req) => [call('delete-tasks', { ids: [refOf(req, 'x')] })],
      () => [say('确认删除 x？')],
      (req) => [call('delete-tasks', { ids: [refOf(req, 'y')] })],
      () => [say('确认删除 y？')],
    ]);
    r.dispatch(createTasks([{ title: 'x' }, { title: 'y' }]));
    await a.say('删掉 x');
    await a.say('不对，是 y');
    const turns = a.getState().turns;
    expect(turns.map((t) => t.status)).toEqual(['cancelled', 'pending']);
    expect(turns[1]?.changes[0]).toMatchObject({ kind: 'deleted', before: { title: 'y' } });
    expect(lastText(transport.requests[2])).toMatch(/NOT applied/);
    a.confirm();
    expect(open(r).map((t) => t.title)).toEqual(['x']);
  });

  it('a failed tool call stages nothing and the model sees the error', async () => {
    const { r, a, transport } = setup([
      () => [call('add-tasks', { tasks: [{ title: 'a' }, { title: 'b', project: '公座' }] })],
      () => [call('add-tasks', { tasks: [{ title: 'a' }, { title: 'b', project: '工作' }] })],
      () => [say('加好了')],
    ]);
    r.dispatch(createProject({ name: '工作' }));
    await a.say('加 a，还有 b 放到工作');
    const err = transport.requests[1]?.messages.at(-1) as { results: { output: string; error?: true }[] };
    expect(err.results[0]?.error).toBe(true);
    expect(err.results[0]?.output).toMatch(/No project named “公座”.*“工作”/);
    expect(r.store.all('project').map((p) => p.name)).toEqual(['工作']);
    expect(
      open(r)
        .map((t) => t.title)
        .sort(),
    ).toEqual(['a', 'b']);
  });

  it('provider errors end the turn without applying anything', async () => {
    const { r, a, transport } = setup([
      () => [call('add-tasks', { tasks: [{ title: 'a' }] })],
      () => [{ type: 'error', error: 'AI provider is rate limiting' }],
      () => [say('ok')],
    ]);
    await a.say('加 a');
    expect(a.getState().turns.at(-1)).toMatchObject({
      status: 'error',
      error: 'AI provider is rate limiting',
    });
    expect(open(r)).toHaveLength(0);
    await a.say('hi');
    // The failed exchange is not in the conversation any more.
    expect(transport.requests[2]?.messages).toEqual([{ role: 'user', text: 'hi' }]);
  });

  it('the model can undo its last change', async () => {
    const { r, a } = setup([
      () => [call('add-tasks', { tasks: [{ title: 'a' }] })],
      () => [say('加了')],
      () => [call('undo-last-change', {})],
      () => [say('撤销了')],
    ]);
    await a.say('加 a');
    await a.say('撤销刚才的');
    expect(open(r)).toHaveLength(0);
    expect(a.getState().turns.map((t) => t.status)).toEqual(['undone', 'answered']);
  });

  it('forgets the conversation after a quiet period', async () => {
    const { a, transport, c } = setup([() => [say('1')], () => [say('2')]]);
    await a.say('one');
    c.advance(11 * 60_000);
    await a.say('two');
    expect(transport.requests[1]?.messages).toEqual([{ role: 'user', text: 'two' }]);
  });
});

describe('yes / no', () => {
  it.each(['好', '好的。', '可以', '确认', '嗯', 'OK', 'yes!', '行吧'])('%s confirms', (s) =>
    expect(isAffirmative(s)).toBe(true),
  );
  it.each(['不用了', '算了', '取消', 'no', '不要'])('%s cancels', (s) => expect(isNegative(s)).toBe(true));
  it.each(['好的，再加一条买菜', '不对，是周五', '可以改到明天吗'])('%s is neither', (s) => {
    expect(isAffirmative(s)).toBe(false);
    expect(isNegative(s)).toBe(false);
  });
});

describe('tools on a staged session', () => {
  function env(_r: Replica, s: AgentSession): ToolEnv {
    const ctx = s.context();
    return {
      store: s.store,
      now: ctx.now,
      today: ctx.today,
      timeZone: ctx.timeZone,
      policy: { createMissing: false, deleteOnlyAgentMade: false },
      run: (cmd) => s.run(cmd),
      newId: ctx.newId,
      ref: (id) => id,
      resolve: (id) => (s.store.get('task', id) ? id : undefined),
      undoLast: () => false,
    };
  }

  it('changing only the time keeps the date', () => {
    const r = replica('d', clock(NOW));
    const { result: id } = r.dispatch(
      createTask({ title: '开会', scheduled: { date: '2026-11-19', time: '10:00' } }),
    );
    const s = new AgentSession(r);
    const out = executeTool(env(r, s), 'update-tasks', {
      tasks: [{ id, time: '16:00', remindMinutesBefore: 30 }],
    });
    expect(out.error).toBeUndefined();
    s.commit();
    const t = r.store.get('task', id);
    expect(t?.scheduled).toEqual({ date: '2026-11-19', time: '16:00' });
    expect(t?.reminders).toMatchObject([{ kind: 'relative', minutesBefore: 30 }]);
  });

  it('a phrase with a time sets the time when rescheduling', () => {
    const r = replica('d', clock(NOW));
    const { result: id } = r.dispatch(createTask({ title: '开会', scheduled: { date: '2026-11-13' } }));
    const s = new AgentSession(r);
    executeTool(env(r, s), 'reschedule-tasks', { ids: [id], when: '下周二下午3点' });
    expect(s.store.get('task', id)?.scheduled).toEqual({ date: '2026-11-17', time: '15:00' });
    expect(s.changes()[0]).toMatchObject({ kind: 'updated', fields: ['date', 'time'] });
  });

  it('subtasks completed with their parent count once', () => {
    const r = replica('d', clock(NOW));
    const { result: parent } = r.dispatch(createTask({ title: 'p' }));
    r.dispatch(createTasks(['a', 'b', 'c'].map((title) => ({ title, parentId: parent }))));
    const s = new AgentSession(r);
    executeTool(env(r, s), 'complete-tasks', { ids: [parent] });
    expect(s.changes().filter((c) => c.kind === 'completed')).toHaveLength(4);
    expect(s.needsConfirmation()).toBe(false);
  });

  it('completing a recurring task reads as completed', () => {
    const r = replica('d', clock(NOW));
    const { result: id } = r.dispatch(
      createTask({ title: '健身', scheduled: { date: '2026-11-13' }, recurrence: { rule: 'FREQ=DAILY' } }),
    );
    const s = new AgentSession(r);
    executeTool(env(r, s), 'complete-tasks', { ids: [id] });
    expect(s.changes()).toMatchObject([{ entity: 'task', kind: 'completed' }]);
    expect(s.store.get('task', id)?.scheduled?.date).toBe('2026-11-14');
  });

  it('rejects invalid input with a readable message', () => {
    const r = replica('d', clock(NOW));
    const s = new AgentSession(r);
    const out = executeTool(env(r, s), 'complete-tasks', { ids: [] });
    expect(out.error).toBe(true);
    expect(String(out.output)).toMatch(/Invalid input/);
    expect(executeTool(env(r, s), 'nope', {}).error).toBe(true);
  });

  it('commits a whole session as one transaction', () => {
    const r = replica('d', clock(NOW));
    const { result: id } = r.dispatch(createTask({ title: 'x' }));
    r.dispatch(completeTask(id));
    const s = new AgentSession(r);
    executeTool(env(r, s), 'complete-tasks', { ids: [id], reopen: true });
    executeTool(env(r, s), 'add-tasks', { tasks: [{ title: 'y' }, { title: 'z', parentId: id }] });
    const before = r.recent().length;
    const tx = s.commit();
    expect(tx).toBeTruthy();
    expect(r.recent().length).toBe(before + 1);
    expect(r.store.all('task').filter((t) => !t.completedAt)).toHaveLength(3);
    r.revert(tx as string);
    expect(r.store.all('task').filter((t) => !t.deletedAt)).toHaveLength(1);
  });
});
