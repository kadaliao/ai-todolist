import { describe, expect, it } from 'vitest';
import {
  createLabel,
  createProject,
  createTask,
  deleteLabel,
  deleteProject,
  deleteTask,
  inbox,
  moveTask,
  restoreTask,
  Store,
  updateTask,
} from '../src';
import { createClock, decode, encode, receive, tick } from '../src/sync/hlc';
import { clock, materialize, replica } from './helpers';

describe('HLC', () => {
  it('encodes to fixed-width, lexically ordered strings', () => {
    const a = encode({ wall: 5, counter: 0, node: 'a' });
    const b = encode({ wall: 40, counter: 0, node: 'a' });
    const c = encode({ wall: 40, counter: 1, node: 'a' });
    expect(a < b && b < c).toBe(true);
    expect(decode(c)).toEqual({ wall: 40, counter: 1, node: 'a' });
  });

  it('is monotonic even when the wall clock goes backwards', () => {
    let s = createClock('n1');
    const seen: string[] = [];
    for (const t of [1000, 1000, 999, 500, 2000, 1999]) {
      const [next, h] = tick(s, t);
      s = next;
      seen.push(h);
    }
    expect([...seen].sort()).toEqual(seen);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('moves past remote timestamps on receive', () => {
    const local = createClock('a', 1000);
    const remote = encode({ wall: 5000, counter: 7, node: 'b' });
    const s = receive(local, remote, 1200);
    const [, h] = tick(s, 1200);
    expect(h > remote).toBe(true);
  });

  it('rejects remote clocks far in the future', () => {
    const remote = encode({ wall: 10 * 24 * 3600 * 1000, counter: 0, node: 'b' });
    expect(() => receive(createClock('a'), remote, 0)).toThrow(/drift/);
  });

  it('rejects node ids that would break the encoding', () => {
    expect(() => createClock('bad-id')).toThrow();
  });
});

describe('LWW store', () => {
  const op = (hlc: string, value: string) => ({
    hlc,
    entity: 'task' as const,
    entityId: 't1',
    field: 'title',
    value,
    tx: 'x',
    actor: 'user' as const,
  });
  const created = { ...op('000000001-0000-a', ''), field: 'createdAt', value: '2026-01-01T00:00:00Z' };

  it('keeps the value with the greatest HLC regardless of order', () => {
    const ops = [created, op('000000002-0000-a', 'old'), op('000000003-0000-b', 'new')];
    const s1 = new Store();
    const s2 = new Store();
    for (const o of ops) s1.apply(o);
    for (const o of [...ops].reverse()) s2.apply(o);
    expect(s1.get('task', 't1')?.title).toBe('new');
    expect(s2.get('task', 't1')?.title).toBe('new');
  });

  it('is idempotent', () => {
    const s = new Store();
    s.apply(created);
    expect(s.apply(op('000000002-0000-a', 'x'))).toBe(true);
    expect(s.apply(op('000000002-0000-a', 'x'))).toBe(false);
  });

  it('treats an entity without createdAt as absent and fills defaults', () => {
    const s = new Store();
    s.apply(op('000000002-0000-a', 'x'));
    expect(s.get('task', 't1')).toBeUndefined();
    s.apply(created);
    expect(s.get('task', 't1')).toMatchObject({ title: 'x', priority: 0, labels: [], projectId: null });
  });

  it('returns copies that cannot corrupt the store', () => {
    const s = new Store();
    s.apply(created);
    s.apply({ ...op('000000002-0000-a', ''), field: 'labels', value: ['a'] });
    const t = s.get('task', 't1');
    expect(() => {
      (t as { title: string }).title = 'hacked';
    }).toThrow();
    expect(() => (t as { labels: string[] }).labels.push('b')).toThrow();
    expect(s.get('task', 't1')?.labels).toEqual(['a']);
  });
});

describe('replica sync', () => {
  it('converges two devices editing different fields of the same task', () => {
    const c = clock();
    const a = replica('a', c);
    const b = replica('b', c);
    const { result: id } = a.dispatch(createTask({ title: 'draft' }));
    b.receive(a.pending());
    c.advance(10);
    a.dispatch(updateTask(id, { title: 'final' }));
    b.dispatch(updateTask(id, { priority: 3 }));
    a.receive(b.pending());
    b.receive(a.pending());
    expect(materialize(a)).toEqual(materialize(b));
    expect(a.store.get('task', id)).toMatchObject({ title: 'final', priority: 3 });
  });

  it('later edit wins on the same field, even with a slower clock', () => {
    const ca = clock('2026-11-13T02:00:00Z');
    const cb = clock('2026-11-13T01:00:00Z'); // b's clock is an hour behind
    const a = replica('a', ca);
    const b = replica('b', cb);
    const { result: id } = a.dispatch(createTask({ title: 'v1' }));
    b.receive(a.pending()); // b now knows a's time
    b.dispatch(updateTask(id, { title: 'v2 from b' }));
    a.receive(b.pending());
    expect(a.store.get('task', id)?.title).toBe('v2 from b');
  });

  it('outbox holds unacknowledged ops until ack', () => {
    const a = replica('a');
    a.dispatch(createTask({ title: 'x' }));
    const pending = a.pending();
    expect(pending.length).toBeGreaterThan(0);
    a.ack(pending.slice(0, 1).map((o) => o.hlc));
    expect(a.pending()).toHaveLength(pending.length - 1);
  });

  it('round-trips through a snapshot', () => {
    const c = clock();
    const a = replica('a', c);
    a.dispatch(createTask({ title: 'persist me', priority: 2 }));
    const restored = (a.constructor as typeof import('../src').Replica).fromSnapshot(
      JSON.parse(JSON.stringify(a.snapshot())),
      { deviceId: 'a', timeZone: 'Asia/Shanghai', now: c.now },
    );
    expect(materialize(restored)).toEqual(materialize(a));
    expect(restored.pending()).toEqual(a.pending());
    // The restored clock continues after the persisted one.
    const { tx } = restored.dispatch(createTask({ title: 'after' }));
    expect((tx.ops[0]?.hlc ?? '') > (a.pending().at(-1)?.hlc ?? '')).toBe(true);
  });

  it('notifies subscribers on local and remote changes only', () => {
    const a = replica('a');
    const b = replica('b');
    let calls = 0;
    b.subscribe(() => calls++);
    a.dispatch(createTask({ title: 'x' }));
    b.receive(a.pending());
    b.receive(a.pending()); // duplicates change nothing
    expect(calls).toBe(1);
  });
});

describe('merge conflicts are repaired deterministically', () => {
  function pair() {
    const c = clock();
    const a = replica('a', c);
    const b = replica('b', c);
    const sync = () => {
      const fromA = a.pending();
      const fromB = b.pending();
      b.receive(fromA);
      a.receive(fromB);
      // Repairs made while receiving sync too.
      b.receive(a.pending());
      a.receive(b.pending());
    };
    return { a, b, c, sync };
  }

  it('concurrent indents forming a cycle: the smaller id becomes top-level', () => {
    const { a, b, sync } = pair();
    const x = a.dispatch(createTask({ title: 'x' })).result;
    const y = a.dispatch(createTask({ title: 'y' })).result;
    sync();
    a.dispatch(moveTask(x, { parentId: y }));
    b.dispatch(moveTask(y, { parentId: x }));
    sync();
    expect(materialize(a)).toEqual(materialize(b));
    const [first, second] = [x, y].sort();
    expect(a.store.get('task', first as string)?.parentId).toBeNull();
    expect(a.store.get('task', second as string)?.parentId).toBe(first);
  });

  it('task added to a project deleted elsewhere lands in the Inbox', () => {
    const { a, b, sync } = pair();
    const p = a.dispatch(createProject({ name: 'P' })).result;
    sync();
    a.dispatch(deleteProject(p));
    const t = b.dispatch(createTask({ title: 'new idea', projectId: p })).result;
    sync();
    expect(materialize(a)).toEqual(materialize(b));
    expect(inbox(a.store).map((x) => x.id)).toEqual([t]);
  });

  it('subtask added under a parent deleted elsewhere goes to the trash with it, and comes back on restore', () => {
    const { a, b, sync } = pair();
    const parent = a.dispatch(createTask({ title: 'parent' })).result;
    sync();
    a.dispatch(deleteTask(parent));
    const child = b.dispatch(createTask({ title: 'child', parentId: parent })).result;
    sync();
    expect(a.store.get('task', child)?.deletedAt).toBe(a.store.get('task', parent)?.deletedAt);
    a.dispatch(restoreTask(parent));
    expect(a.store.get('task', child)?.deletedAt).toBeNull();
  });

  it('label deleted while another device assigns it is dropped from the task', () => {
    const { a, b, sync } = pair();
    const l = a.dispatch(createLabel({ name: 'x' })).result;
    const t = a.dispatch(createTask({ title: 't' })).result;
    sync();
    a.dispatch(deleteLabel(l));
    b.dispatch(updateTask(t, { labels: [l] }));
    sync();
    expect(a.store.get('task', t)?.labels).toEqual([]);
    expect(materialize(a)).toEqual(materialize(b));
  });
});
