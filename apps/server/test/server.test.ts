import { createTask, type Op, Replica } from '@ai-todo/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Db } from '../src/db';
import { Hub } from '../src/hub';

let db: Db;
let hub: Hub;
let app: ReturnType<typeof createApp>;
let token: string;

beforeEach(() => {
  db = new Db(':memory:');
  hub = new Hub(db, 'Asia/Shanghai');
  app = createApp({ db, hub, ai: null });
  token = db.createToken('laptop');
});

const auth = () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

function device(id: string) {
  let n = 0;
  return new Replica({ deviceId: id, timeZone: 'Asia/Shanghai', newId: () => `${id}_${++n}` });
}

async function push(ops: Op[]) {
  return app.request('/api/sync/push', { method: 'POST', headers: auth(), body: JSON.stringify({ ops }) });
}

async function pull(since: number, deviceId?: string) {
  const res = await app.request(`/api/sync/pull?since=${since}${deviceId ? `&device=${deviceId}` : ''}`, {
    headers: auth(),
  });
  return (await res.json()) as { ops: Op[]; cursor: number; more: boolean };
}

async function mcp(method: string, params: unknown, id = 1) {
  const res = await app.request('/mcp', {
    method: 'POST',
    headers: { ...auth(), Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  return {
    status: res.status,
    body: (await res.json()) as {
      result?: { content?: { text: string }[]; isError?: boolean; tools?: { name: string }[] };
      error?: unknown;
    },
  };
}

async function callTool(name: string, args: Record<string, unknown>) {
  const { body } = await mcp('tools/call', { name, arguments: args });
  const text = body.result?.content?.[0]?.text ?? '';
  return {
    isError: !!body.result?.isError,
    text,
    data: (() => {
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    })(),
  };
}

describe('auth', () => {
  it('rejects missing or wrong tokens', async () => {
    expect((await app.request('/api/health')).status).toBe(401);
    expect((await app.request('/api/health', { headers: { Authorization: 'Bearer nope' } })).status).toBe(
      401,
    );
    expect((await app.request('/mcp', { method: 'POST' })).status).toBe(401);
    const ok = await app.request('/api/health', { headers: auth() });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, device: 'laptop', ai: { available: false } });
  });

  it('revoked tokens stop working', async () => {
    db.revokeToken('laptop');
    expect((await app.request('/api/health', { headers: auth() })).status).toBe(401);
  });
});

describe('sync', () => {
  it('relays ops between devices with cursors and dedupe', async () => {
    const a = device('a');
    const b = device('b');
    const { result: id } = a.dispatch(createTask({ title: 'from a' }));
    const res = await push(a.pending());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { acked: string[]; cursor: number };
    expect(body.acked).toHaveLength(a.pending().length);
    a.ack(body.acked);

    // Pushing the same ops again is harmless.
    const again = (await (await push(a.pending().length ? a.pending() : [])).json()) as { cursor: number };
    expect(again.cursor).toBe(body.cursor);

    const got = await pull(0, 'b');
    b.receive(got.ops);
    expect(b.store.get('task', id)?.title).toBe('from a');
    expect((await pull(got.cursor)).ops).toHaveLength(0);
    // A device's own ops are skipped on pull.
    expect((await pull(0, 'a')).ops).toHaveLength(0);
  });

  it('applies pushed ops to the server replica', async () => {
    const a = device('a');
    const { result: id } = a.dispatch(createTask({ title: 'seen by server' }));
    await push(a.pending());
    expect(hub.replica.store.get('task', id)?.title).toBe('seen by server');
  });

  it('rejects malformed ops and clocks far in the future', async () => {
    expect((await push([{ hlc: 'x' } as unknown as Op])).status).toBe(400);
    const future = (Date.now() + 3 * 86_400_000).toString(36).padStart(9, '0');
    const op: Op = {
      hlc: `${future}-0000-zz`,
      entity: 'task',
      entityId: 't',
      field: 'title',
      value: 'x',
      tx: 't',
      actor: 'user',
    };
    const res = await push([op]);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/clock/);
  });

  it('survives a restart by replaying the log', async () => {
    const a = device('a');
    const { result: id } = a.dispatch(createTask({ title: 'durable' }));
    await push(a.pending());
    const reloaded = new Hub(db, 'Asia/Shanghai');
    expect(reloaded.replica.store.get('task', id)?.title).toBe('durable');
  });
});

describe('MCP', () => {
  it('lists the workflow tools', async () => {
    const { status, body } = await mcp('tools/list', {});
    expect(status).toBe(200);
    expect(body.result?.tools?.map((t) => t.name).sort()).toEqual(
      [
        'add-tasks',
        'complete-tasks',
        'create-project',
        'delete-tasks',
        'find-tasks',
        'find-tasks-by-date',
        'get-overview',
        'reschedule-tasks',
        'undo-last-change',
        'update-tasks',
      ].sort(),
    );
  });

  it('adds tasks with parsed dates and syncs them to devices', async () => {
    const r = await callTool('add-tasks', {
      tasks: [
        { title: '写周报', when: '明天下午3点', project: '工作', priority: 'p1' },
        { title: 'Water plants every 3 days' },
      ],
    });
    expect(r.isError).toBe(false);
    expect(r.data.created).toHaveLength(2);
    expect(r.data.created[0]).toMatchObject({
      title: '写周报',
      time: '15:00',
      project: '工作',
      priority: 'p1',
    });
    expect(r.data.created[1]).toMatchObject({ title: 'Water plants', repeat: 'FREQ=DAILY;INTERVAL=3' });
    expect(r.data.alsoCreated).toEqual(['project “工作”']);

    const b = device('b');
    b.receive((await pull(0, 'b')).ops);
    const tasks = b.store.all('task');
    expect(tasks.map((t) => t.title).sort()).toEqual(['Water plants', '写周报']);
    expect(tasks.every((t) => t.origin === 'mcp')).toBe(true);
  });

  it('finds, completes, reschedules and undoes', async () => {
    const added = await callTool('add-tasks', {
      tasks: [{ title: 'Buy milk', when: 'today' }, { title: 'Call bank' }],
    });
    const [milk, bank] = added.data.created.map((t: { id: string }) => t.id);
    const found = await callTool('find-tasks', { query: 'milk' });
    expect(found.data.tasks.map((t: { id: string }) => t.id)).toEqual([milk]);

    const overview = await callTool('get-overview', {});
    expect(overview.data.todayTasks.map((t: { title: string }) => t.title)).toContain('Buy milk');
    expect(overview.data.inboxOpen).toBe(2);

    await callTool('complete-tasks', { ids: [milk] });
    expect(hub.replica.store.get('task', milk)?.completedAt).toBeTruthy();
    await callTool('undo-last-change', {});
    expect(hub.replica.store.get('task', milk)?.completedAt).toBeNull();

    const moved = await callTool('reschedule-tasks', { ids: [bank], when: '2026-12-24' });
    expect(moved.data.tasks[0].date).toBe('2026-12-24');
    const byDate = await callTool('find-tasks-by-date', { startDate: '2026-12-24', days: 1 });
    expect(byDate.data.days[0].tasks[0].id).toBe(bank);
  });

  it('cannot delete tasks the user created', async () => {
    const a = device('a');
    const { result: mine } = a.dispatch(createTask({ title: 'mine' }));
    await push(a.pending());
    const r = await callTool('delete-tasks', { ids: [mine] });
    expect(r.isError).toBe(true);
    expect(hub.replica.store.get('task', mine)?.deletedAt).toBeNull();

    const added = await callTool('add-tasks', { tasks: [{ title: 'agent made' }] });
    const del = await callTool('delete-tasks', { ids: [added.data.created[0].id] });
    expect(del.isError).toBe(false);
  });

  it('explains bad input instead of guessing', async () => {
    const r = await callTool('add-tasks', { tasks: [{ title: 'x', when: 'whenever-ish' }] });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/Could not understand/);
    const p = await callTool('find-tasks', { project: 'Nope' });
    expect(p.isError).toBe(true);
  });
});
