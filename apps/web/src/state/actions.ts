import {
  type Actor,
  type Command,
  CommandError,
  completeTask,
  completeTasks,
  createLabel,
  createProject,
  createTask,
  createTasks,
  deleteProject,
  deleteTasks,
  type LocalDate,
  type MoveTarget,
  moveTasks,
  type NewTask,
  type Priority,
  type Replica,
  rescheduleOverdue,
  rescheduleTasks,
  restoreTask,
  type TaskPatch,
  uncompleteTask,
  updateTask,
} from '@ai-todo/core';
import { formatDay } from '../lib/dates';
import { t } from '../lib/i18n';
import { askRescheduleMode, useUI } from './ui';

/**
 * UI-level actions: run a core command, show the right toast (with Undo), and translate errors.
 * Components call these instead of dispatching directly so feedback is consistent everywhere.
 */

let replica: Replica;
export function bindActions(r: Replica): void {
  replica = r;
}

const toast = (...args: Parameters<ReturnType<typeof useUI.getState>['toast']>) =>
  useUI.getState().toast(...args);

const undoAction = () => ({ label: t('undo'), run: () => undo() });

export function run<R>(cmd: Command<R>, actor: Actor = 'user'): R | undefined {
  try {
    return replica.dispatch(cmd, { actor }).result;
  } catch (e) {
    if (e instanceof CommandError) {
      toast({ message: t('toast.error', { message: e.message }), tone: 'error' });
      return undefined;
    }
    throw e;
  }
}

export function undo(): void {
  const tx = replica.undo();
  toast({ message: tx ? t('toast.undone') : t('toast.nothingToUndo') });
}

export function redo(): void {
  if (replica.redo()) toast({ message: t('toast.redone') });
}

const today = () => replica.context().today;
const title = (id: string) => replica.store.get('task', id)?.title ?? '';

export function addTask(input: NewTask): string | undefined {
  return run(createTask(input));
}

export function addTasks(inputs: NewTask[], actor: Actor = 'user'): string[] | undefined {
  return run(createTasks(inputs), actor);
}

export function editTask(id: string, patch: TaskPatch): void {
  run(updateTask(id, patch));
}

export function toggleComplete(id: string): void {
  const task = replica.store.get('task', id);
  if (!task) return;
  if (task.completedAt) {
    run(uncompleteTask(id));
    return;
  }
  const out = run(completeTask(id));
  if (!out) return;
  toast({
    message: out.next
      ? t('toast.completedNext', { date: formatDay(out.next, today()) })
      : t('toast.completed', { title: task.title }),
    action: undoAction(),
  });
}

export function completeMany(ids: string[]): void {
  if (ids.length === 1) {
    toggleComplete(ids[0] as string);
    return;
  }
  const open = ids.filter((id) => !replica.store.get('task', id)?.completedAt);
  if (!open.length) return;
  run(completeTasks(open));
  toast({ message: t('toast.completedN', { n: open.length }), action: undoAction() });
}

export function removeTasks(ids: string[]): void {
  if (!ids.length) return;
  const name = ids.length === 1 ? title(ids[0] as string) : '';
  run(deleteTasks(ids));
  const ui = useUI.getState();
  if (ui.detailId && ids.includes(ui.detailId)) ui.openDetail(null);
  ui.select([]);
  toast({
    message: ids.length === 1 ? t('toast.deleted', { title: name }) : t('toast.deletedN', { n: ids.length }),
    action: undoAction(),
  });
}

export function restore(id: string): void {
  run(restoreTask(id));
}

/**
 * Reschedule, asking "only this one or the rule?" when any selected task repeats and the day
 * actually changes.
 */
export async function schedule(
  ids: string[],
  date: LocalDate | null,
  opts: { quiet?: boolean } = {},
): Promise<void> {
  const tasks = ids.map((id) => replica.store.get('task', id)).filter((x) => !!x);
  if (!tasks.length) return;
  let mode: 'occurrence' | 'series' = 'occurrence';
  if (date && tasks.some((x) => x.recurrence && x.scheduled?.date !== date)) {
    const answer = await askRescheduleMode();
    if (!answer) return;
    mode = answer;
  }
  run(rescheduleTasks(ids, date, mode));
  if (opts.quiet) return;
  const label = date ? formatDay(date, today()) : t('date.none');
  toast({
    message:
      ids.length === 1
        ? t('toast.rescheduled', { date: label })
        : t('toast.rescheduledN', { n: ids.length, date: label }),
    action: undoAction(),
  });
}

export function rescheduleAllOverdue(): void {
  const n = run(rescheduleOverdue());
  if (n) toast({ message: t('toast.rescheduledN', { n, date: t('date.today') }), action: undoAction() });
}

export function setPriority(ids: string[], priority: Priority): void {
  if (ids.length === 1) {
    run(updateTask(ids[0] as string, { priority }));
    return;
  }
  run({
    label: `priority ${ids.length} tasks`,
    run: (ctx) => {
      const mutations = ids.flatMap((id) => updateTask(id, { priority }).run(ctx).mutations);
      return { mutations, result: undefined };
    },
  });
}

export function move(ids: string[], target: MoveTarget, opts: { quiet?: boolean } = {}): void {
  if (!ids.length) return;
  run(moveTasks(ids, target));
  if (opts.quiet) return;
  const name =
    target.projectId === null
      ? t('nav.inbox')
      : target.projectId
        ? (replica.store.get('project', target.projectId)?.name ?? '')
        : '';
  if (name) toast({ message: t('toast.moved', { name }), action: undoAction() });
}

export function addProject(
  name: string,
  parentId: string | null = null,
  color: string | null = null,
): string | undefined {
  return run(createProject({ name, parentId, color }));
}

export function addLabel(name: string): string | undefined {
  return run(createLabel({ name }));
}

export function removeProject(id: string): void {
  const p = replica.store.get('project', id);
  if (!p) return;
  run(deleteProject(id));
  const ui = useUI.getState();
  if (ui.route.kind === 'project' && ui.route.id === id) ui.navigate({ kind: 'inbox' });
  toast({ message: t('toast.projectDeleted', { name: p.name }), action: undoAction() });
}

export function duplicate(id: string): void {
  const task = replica.store.get('task', id);
  if (!task) return;
  run(
    createTask({
      title: task.title,
      notes: task.notes,
      projectId: task.projectId,
      sectionId: task.sectionId,
      parentId: task.parentId,
      priority: task.priority,
      labels: task.labels,
      scheduled: task.scheduled,
      ...(task.recurrence ? { recurrence: { rule: task.recurrence.rule, from: task.recurrence.from } } : {}),
    }),
  );
}
