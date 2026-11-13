import { describe, expect, it } from 'vitest';
import {
  archiveProject,
  CommandError,
  completeTask,
  completeTasks,
  createLabel,
  createProject,
  createSection,
  createTask,
  createTasks,
  deleteLabel,
  deleteProject,
  deleteTask,
  deleteTasks,
  inbox,
  logbook,
  moveTask,
  moveTasks,
  parseQuickAdd,
  projectView,
  rescheduleOverdue,
  rescheduleTask,
  restoreTask,
  search,
  sidebar,
  subtasks,
  today,
  toNewTask,
  trash,
  uncompleteTask,
  upcoming,
} from '../src';
import { clock, materialize, replica } from './helpers';

const titles = (ts: { title: string }[]) => ts.map((t) => t.title);

describe('tasks', () => {
  it('creates in Inbox at the bottom by default, or at the top', () => {
    const r = replica();
    r.dispatch(createTask({ title: 'a' }));
    r.dispatch(createTask({ title: 'b' }));
    r.dispatch(createTask({ title: 'top', position: 'top' }));
    r.dispatch(createTask({ title: 'mid', position: { index: 2 } }));
    expect(titles(inbox(r.store))).toEqual(['top', 'a', 'mid', 'b']);
  });

  it('rejects invalid input without writing anything', () => {
    const r = replica();
    expect(() => r.dispatch(createTask({ title: '   ' }))).toThrow(CommandError);
    expect(() => r.dispatch(createTask({ title: 'x', scheduled: { date: '2026-13-01' } }))).toThrow(
      CommandError,
    );
    expect(() => r.dispatch(createTask({ title: 'x', projectId: 'nope' }))).toThrow(CommandError);
    expect(r.pending()).toEqual([]);
  });

  it('subtasks inherit project and section from their parent', () => {
    const r = replica();
    const { result: p } = r.dispatch(createProject({ name: 'Work' }));
    const { result: s } = r.dispatch(createSection({ projectId: p, name: 'Doing' }));
    const { result: parent } = r.dispatch(createTask({ title: 'parent', sectionId: s }));
    const { result: child } = r.dispatch(createTask({ title: 'child', parentId: parent }));
    expect(r.store.get('task', child)).toMatchObject({ projectId: p, sectionId: s, parentId: parent });
    expect(titles(subtasks(r.store, parent))).toEqual(['child']);
  });

  it('completing a parent completes its subtasks; reopening a subtask reopens the parent', () => {
    const r = replica();
    const { result: parent } = r.dispatch(createTask({ title: 'parent' }));
    const { result: child } = r.dispatch(createTask({ title: 'child', parentId: parent }));
    r.dispatch(completeTask(parent));
    expect(r.store.get('task', child)?.completedAt).toBeTruthy();
    r.dispatch(uncompleteTask(child));
    expect(r.store.get('task', parent)?.completedAt).toBeNull();
  });

  it('completing a recurring task logs the occurrence and moves it to the next date', () => {
    const r = replica();
    const { result: id } = r.dispatch(
      createTask({
        title: '周会',
        scheduled: { date: '2026-11-16', time: '15:00' },
        recurrence: { rule: 'FREQ=WEEKLY;BYDAY=MO' },
      }),
    );
    const { result } = r.dispatch(completeTask(id));
    expect(result.next).toBe('2026-11-23');
    const t = r.store.get('task', id);
    expect(t?.completedAt).toBeNull();
    expect(t?.scheduled).toEqual({ date: '2026-11-23', time: '15:00' });
    expect(t?.recurrence).toMatchObject({ anchor: '2026-11-16', instance: '2026-11-23' });
    const log = logbook(r.store);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      kind: 'occurrence',
      completion: { taskId: id, occurrence: '2026-11-16' },
    });
  });

  it('recurring checklists reset when the parent repeats', () => {
    const r = replica();
    const { result: id } = r.dispatch(createTask({ title: 'routine', recurrence: { rule: 'FREQ=DAILY' } }));
    const { result: step } = r.dispatch(createTask({ title: 'step', parentId: id }));
    r.dispatch(completeTask(step));
    r.dispatch(completeTask(id));
    expect(r.store.get('task', step)?.completedAt).toBeNull();
  });

  it('a finished series completes the task for good', () => {
    const r = replica();
    const { result: id } = r.dispatch(
      createTask({
        title: 'twice',
        scheduled: { date: '2026-11-13' },
        recurrence: { rule: 'FREQ=DAILY;COUNT=1' },
      }),
    );
    expect(r.dispatch(completeTask(id)).result.next).toBeNull();
    expect(r.store.get('task', id)?.completedAt).toBeTruthy();
  });

  it('reschedule a recurring task: this occurrence vs. the whole series', () => {
    const c = clock('2026-11-16T02:00:00Z'); // Monday
    const r = replica('d', c);
    const mk = () =>
      r.dispatch(
        createTask({
          title: 'weekly',
          scheduled: { date: '2026-11-16' },
          recurrence: { rule: 'FREQ=WEEKLY;BYDAY=MO' },
        }),
      ).result;
    const once = mk();
    r.dispatch(rescheduleTask(once, '2026-11-18', 'occurrence'));
    c.set('2026-11-18T02:00:00Z');
    expect(r.dispatch(completeTask(once)).result.next).toBe('2026-11-23'); // back to Mondays

    c.set('2026-11-16T02:00:00Z');
    const series = mk();
    r.dispatch(rescheduleTask(series, '2026-11-18', 'series'));
    expect(r.store.get('task', series)?.recurrence?.rule).toBe('FREQ=WEEKLY;BYDAY=WE');
    c.set('2026-11-18T02:00:00Z');
    expect(r.dispatch(completeTask(series)).result.next).toBe('2026-11-25'); // now Wednesdays
  });

  it('removing the date stops repeating', () => {
    const r = replica();
    const { result: id } = r.dispatch(createTask({ title: 'x', recurrence: { rule: 'FREQ=DAILY' } }));
    r.dispatch(rescheduleTask(id, null));
    expect(r.store.get('task', id)).toMatchObject({ scheduled: null, recurrence: null });
  });

  it('reschedules every overdue task in one undoable step', () => {
    const r = replica();
    const a = r.dispatch(createTask({ title: 'a', scheduled: { date: '2026-11-10', time: '09:00' } })).result;
    const b = r.dispatch(createTask({ title: 'b', scheduled: { date: '2026-11-12' } })).result;
    r.dispatch(createTask({ title: 'future', scheduled: { date: '2026-11-20' } }));
    expect(r.dispatch(rescheduleOverdue()).result).toBe(2);
    expect(r.store.get('task', a)?.scheduled).toEqual({ date: '2026-11-13', time: '09:00' });
    expect(r.store.get('task', b)?.scheduled?.date).toBe('2026-11-13');
    r.undo();
    expect(r.store.get('task', a)?.scheduled?.date).toBe('2026-11-10');
    expect(r.store.get('task', b)?.scheduled?.date).toBe('2026-11-12');
  });

  it('deletes softly with subtasks, restores them together', () => {
    const r = replica();
    const { result: parent } = r.dispatch(createTask({ title: 'parent' }));
    const { result: child } = r.dispatch(createTask({ title: 'child', parentId: parent }));
    r.dispatch(deleteTask(parent));
    expect(inbox(r.store)).toEqual([]);
    expect(titles(trash(r.store)).sort()).toEqual(['child', 'parent']);
    r.dispatch(restoreTask(parent));
    expect(r.store.get('task', child)?.deletedAt).toBeNull();
    expect(titles(inbox(r.store))).toEqual(['parent']);
  });

  it('batch delete tolerates a parent and its child both selected', () => {
    const r = replica();
    const { result: parent } = r.dispatch(createTask({ title: 'parent' }));
    const { result: child } = r.dispatch(createTask({ title: 'child', parentId: parent }));
    r.dispatch(deleteTasks([parent, child]));
    expect(trash(r.store)).toHaveLength(2);
  });

  it('createTasks keeps input order and undoes as one', () => {
    const r = replica();
    r.dispatch(createTask({ title: 'existing' }));
    r.dispatch(createTasks([{ title: 'one' }, { title: 'two' }, { title: 'three' }]));
    expect(titles(inbox(r.store))).toEqual(['existing', 'one', 'two', 'three']);
    r.undo();
    expect(titles(inbox(r.store))).toEqual(['existing']);
  });

  it('completeTasks handles a parent and child together', () => {
    const r = replica();
    const { result: parent } = r.dispatch(createTask({ title: 'p' }));
    const { result: child } = r.dispatch(createTask({ title: 'c', parentId: parent }));
    r.dispatch(completeTasks([parent, child]));
    expect(r.store.get('task', child)?.completedAt).toBeTruthy();
  });
});

describe('moving and ordering', () => {
  it('reorders within a list', () => {
    const r = replica();
    const ids = ['a', 'b', 'c', 'd'].map((title) => r.dispatch(createTask({ title })).result);
    r.dispatch(moveTask(ids[3] as string, { index: 0 }));
    expect(titles(inbox(r.store))).toEqual(['d', 'a', 'b', 'c']);
    r.dispatch(moveTasks([ids[0] as string, ids[1] as string], { index: 3 }));
    expect(titles(inbox(r.store))).toEqual(['d', 'c', 'a', 'b']);
  });

  it('moves to another project with subtasks following', () => {
    const r = replica();
    const { result: p } = r.dispatch(createProject({ name: 'P' }));
    const { result: parent } = r.dispatch(createTask({ title: 'parent' }));
    const { result: child } = r.dispatch(createTask({ title: 'child', parentId: parent }));
    r.dispatch(moveTask(parent, { projectId: p }));
    expect(r.store.get('task', child)?.projectId).toBe(p);
    expect(titles(projectView(r.store, p)?.groups[0]?.tasks ?? [])).toEqual(['parent']);
  });

  it('indents a task under another and refuses cycles', () => {
    const r = replica();
    const a = r.dispatch(createTask({ title: 'a' })).result;
    const b = r.dispatch(createTask({ title: 'b' })).result;
    r.dispatch(moveTask(b, { parentId: a }));
    expect(r.store.get('task', b)?.parentId).toBe(a);
    expect(() => r.dispatch(moveTask(a, { parentId: b }))).toThrow(/under itself/);
    r.dispatch(moveTask(b, { parentId: null }));
    expect(titles(inbox(r.store))).toEqual(['a', 'b']);
  });

  it('re-keys neighbours whose keys collided after a concurrent insert', () => {
    const c = clock();
    const a = replica('a', c);
    const b = replica('b', c);
    a.dispatch(createTask({ title: 'first' }));
    b.receive(a.pending());
    // Both devices append at the same spot while offline; jitter is disabled to force a collision.
    const orig = Math.random;
    Math.random = () => 0;
    try {
      a.dispatch(createTask({ title: 'from a' }));
      b.dispatch(createTask({ title: 'from b' }));
    } finally {
      Math.random = orig;
    }
    a.receive(b.pending());
    const list = inbox(a.store);
    expect(list[1]?.sortKey).toBe(list[2]?.sortKey); // same key, ordered by id
    const firstId = list[0]?.id as string;
    a.dispatch(moveTask(firstId, { index: 1 })); // between the two colliding items
    expect(titles(inbox(a.store))).toEqual(['from a', 'first', 'from b']);
  });
});

describe('projects, sections, labels', () => {
  it('builds a sidebar tree and project view', () => {
    const r = replica();
    const area = r.dispatch(createProject({ name: 'Area' })).result;
    const p = r.dispatch(createProject({ name: 'Child', parentId: area })).result;
    expect(() => r.dispatch(createProject({ name: 'Grandchild', parentId: p }))).toThrow(/one level/);
    const s = r.dispatch(createSection({ projectId: p, name: 'S1' })).result;
    r.dispatch(createTask({ title: 'loose', projectId: p }));
    r.dispatch(createTask({ title: 'in section', sectionId: s }));
    const sb = sidebar(r.store);
    expect(sb.projects.map((x) => [x.project.name, x.children.map((ch) => ch.name)])).toEqual([
      ['Area', ['Child']],
    ]);
    const view = projectView(r.store, p);
    expect(view?.groups.map((g) => [g.section?.name ?? null, titles(g.tasks)])).toEqual([
      [null, ['loose']],
      ['S1', ['in section']],
    ]);
  });

  it('deleting a project trashes its tasks; undo brings everything back', () => {
    const r = replica();
    const p = r.dispatch(createProject({ name: 'P' })).result;
    r.dispatch(createSection({ projectId: p, name: 'S' }));
    r.dispatch(createTask({ title: 't', projectId: p }));
    const before = materialize(r);
    r.dispatch(deleteProject(p));
    expect(projectView(r.store, p)).toBeNull();
    r.undo();
    expect(materialize(r)).toEqual(before);
  });

  it('deleting a label removes it from tasks', () => {
    const r = replica();
    const l = r.dispatch(createLabel({ name: 'home' })).result;
    const t = r.dispatch(createTask({ title: 'x', labels: [l] })).result;
    expect(() => r.dispatch(createLabel({ name: 'HOME' }))).toThrow(/exists/);
    r.dispatch(deleteLabel(l));
    expect(r.store.get('task', t)?.labels).toEqual([]);
  });
});

describe('views', () => {
  it('today: overdue first, then by time, priority, manual order', () => {
    const r = replica();
    r.dispatch(createTask({ title: 'late', scheduled: { date: '2026-11-12' } }));
    r.dispatch(createTask({ title: 'untimed low', scheduled: { date: '2026-11-13' } }));
    r.dispatch(createTask({ title: 'untimed p1', priority: 3, scheduled: { date: '2026-11-13' } }));
    r.dispatch(createTask({ title: '15:00', scheduled: { date: '2026-11-13', time: '15:00' } }));
    r.dispatch(createTask({ title: '09:00', scheduled: { date: '2026-11-13', time: '09:00' } }));
    const v = today(r.store, '2026-11-13');
    expect(titles(v.overdue)).toEqual(['late']);
    expect(titles(v.today)).toEqual(['09:00', '15:00', 'untimed p1', 'untimed low']);
  });

  it('upcoming has one bucket per day, archived projects hidden', () => {
    const r = replica();
    const p = r.dispatch(createProject({ name: 'P' })).result;
    r.dispatch(createTask({ title: 'tomorrow', scheduled: { date: '2026-11-14' } }));
    r.dispatch(createTask({ title: 'hidden', projectId: p, scheduled: { date: '2026-11-14' } }));
    r.dispatch(archiveProject(p));
    const days = upcoming(r.store, '2026-11-13', 3);
    expect(days.map((d) => [d.date, titles(d.tasks)])).toEqual([
      ['2026-11-13', []],
      ['2026-11-14', ['tomorrow']],
      ['2026-11-15', []],
    ]);
  });

  it('search ranks open title matches first', () => {
    const r = replica();
    const done = r.dispatch(createTask({ title: 'report done' })).result;
    r.dispatch(completeTask(done));
    r.dispatch(createTask({ title: 'other', notes: 'see report' }));
    r.dispatch(createTask({ title: 'write report' }));
    expect(titles(search(r.store, 'REPORT'))).toEqual(['write report', 'other', 'report done']);
  });

  it('quick add → task end to end', () => {
    const r = replica();
    const work = r.dispatch(createProject({ name: '工作' })).result;
    const parsed = parseQuickAdd('每周一下午3点 周会 #工作 p1', {
      now: new Date('2026-11-13T02:00:00Z'),
      timeZone: 'Asia/Shanghai',
      projects: [{ id: work, name: '工作' }],
    });
    const id = r.dispatch(createTask(toNewTask(parsed))).result;
    expect(r.store.get('task', id)).toMatchObject({
      title: '周会',
      projectId: work,
      priority: 3,
      scheduled: { date: '2026-11-16', time: '15:00' },
      recurrence: {
        rule: 'FREQ=WEEKLY;BYDAY=MO',
        from: 'scheduled',
        anchor: '2026-11-16',
        instance: '2026-11-16',
      },
    });
  });
});
