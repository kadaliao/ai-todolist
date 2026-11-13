import { describe, expect, it } from 'vitest';
import {
  completeTask,
  createProject,
  createTask,
  createTasks,
  inbox,
  logbook,
  moveTask,
  updateTask,
} from '../src';
import { clock, materialize, replica } from './helpers';

describe('undo / redo', () => {
  it('undo and redo a creation', () => {
    const r = replica();
    const { result: id } = r.dispatch(createTask({ title: 'x' }));
    expect(r.undoLabel()).toBe('create task');
    r.undo();
    expect(r.store.get('task', id)).toBeUndefined();
    r.redo();
    expect(r.store.get('task', id)?.title).toBe('x');
  });

  it('restores the exact previous state for a sequence of edits', () => {
    const r = replica();
    const states = [materialize(r)];
    const { result: p } = r.dispatch(createProject({ name: 'P' }));
    states.push(materialize(r));
    const { result: id } = r.dispatch(
      createTask({ title: 'x', scheduled: { date: '2026-11-13' }, recurrence: { rule: 'FREQ=DAILY' } }),
    );
    states.push(materialize(r));
    r.dispatch(updateTask(id, { title: 'y', priority: 2, labels: [] }));
    states.push(materialize(r));
    r.dispatch(moveTask(id, { projectId: p }));
    states.push(materialize(r));
    r.dispatch(completeTask(id));
    states.push(materialize(r));
    for (let i = states.length - 2; i >= 0; i--) {
      r.undo();
      expect(materialize(r)).toEqual(states[i]);
    }
    expect(r.canUndo()).toBe(false);
    for (let i = 1; i < states.length; i++) {
      r.redo();
      expect(materialize(r)).toEqual(states[i]);
    }
  });

  it('a new edit clears the redo stack', () => {
    const r = replica();
    r.dispatch(createTask({ title: 'a' }));
    r.undo();
    r.dispatch(createTask({ title: 'b' }));
    expect(r.canRedo()).toBe(false);
  });

  it('undo does not clobber a newer edit from another device', () => {
    const c = clock();
    const a = replica('a', c);
    const b = replica('b', c);
    const { result: id } = a.dispatch(createTask({ title: 'v1' }));
    c.advance(1);
    a.dispatch(updateTask(id, { title: 'v2', priority: 1 }));
    b.receive(a.pending());
    c.advance(1);
    b.dispatch(updateTask(id, { title: 'from b' }));
    a.receive(b.pending());
    a.undo(); // reverts a's edit: priority goes back, title keeps b's newer value
    expect(a.store.get('task', id)).toMatchObject({ title: 'from b', priority: 0 });
  });

  it('reverts an AI transaction while keeping later user edits', () => {
    const r = replica();
    const { tx } = r.dispatch(createTasks([{ title: 'ai 1' }, { title: 'ai 2' }]), { actor: 'ai' });
    const { result: mine } = r.dispatch(createTask({ title: 'mine' }));
    expect(r.recent().map((h) => [h.label, h.actor])).toEqual([
      ['create task', 'user'],
      ['create 2 tasks', 'ai'],
    ]);
    expect(r.store.get('task', inbox(r.store)[0]?.id as string)?.origin).toBe('ai');
    r.revert(tx.tx);
    expect(inbox(r.store).map((t) => t.id)).toEqual([mine]);
  });

  it('undo of a recurring completion removes the logbook entry', () => {
    const r = replica();
    const { result: id } = r.dispatch(createTask({ title: 'daily', recurrence: { rule: 'FREQ=DAILY' } }));
    r.dispatch(completeTask(id));
    expect(logbook(r.store)).toHaveLength(1);
    r.undo();
    expect(logbook(r.store)).toHaveLength(0);
    expect(r.store.get('task', id)?.scheduled?.date).toBe('2026-11-13');
  });

  it('preview shows the result without applying it', () => {
    const r = replica();
    const { result: id } = r.dispatch(createTask({ title: 'x' }));
    const { after, mutations } = r.preview(updateTask(id, { title: 'proposed' }));
    expect(after.get('task', id)?.title).toBe('proposed');
    expect(r.store.get('task', id)?.title).toBe('x');
    expect(mutations).toHaveLength(1);
  });
});
