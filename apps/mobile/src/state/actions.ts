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
  deleteTasks,
  type LocalDate,
  type MoveTarget,
  moveTasks,
  type NewTask,
  parseQuickAdd,
  type Replica,
  rescheduleOverdue,
  rescheduleTasks,
  type TaskPatch,
  toNewTask,
  uncompleteTask,
  updateTask,
} from '@ai-todo/core';
import { formatDay, t } from '@ai-todo/shared';
import * as Haptics from 'expo-haptics';
import { Alert } from 'react-native';
import { create } from 'zustand';

/** UI actions with haptics, toasts and undo — the phone counterpart of the web's actions. */

let replica: Replica;
export function bindActions(r: Replica): void {
  replica = r;
}
/** False in a headless task (the Android widget) when the app itself isn't running. */
export function hasReplica(): boolean {
  return replica !== undefined;
}

export function getReplica(): Replica {
  return replica;
}

export interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

export const useToasts = create<{ toasts: Toast[] }>(() => ({ toasts: [] }));
let seq = 0;

export function toast(message: string, action?: Toast['action']): void {
  const id = ++seq;
  useToasts.setState((s) => ({
    toasts: [...s.toasts.filter((x) => x.message !== message).slice(-1), { id, message, action }],
  }));
  setTimeout(() => useToasts.setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), 4500);
}

export function dismissToast(id: number): void {
  useToasts.setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
}

export const undoAction = () => ({ label: t('undo'), run: () => undo() });

export function run<R>(cmd: Command<R>, actor: Actor = 'user'): R | undefined {
  try {
    return replica.dispatch(cmd, { actor }).result;
  } catch (e) {
    if (e instanceof CommandError) {
      toast(t('toast.error', { message: e.message }));
      return undefined;
    }
    throw e;
  }
}

export function undo(): void {
  if (replica.undo()) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

const today = () => replica.context().today;

export function addTasks(inputs: NewTask[], actor: Actor = 'user'): string[] | undefined {
  const ids = run(createTasks(inputs), actor);
  if (ids?.length) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  return ids;
}

export function addTask(input: NewTask): string | undefined {
  return run(createTask(input));
}

/**
 * Add a task from Quick Add text (dates, #project, @label, p1 are recognized), creating projects
 * and labels that don't exist yet. Used for text that arrives from outside the add sheet.
 */
export function addFromText(text: string, extra: Partial<NewTask> = {}): string | undefined {
  const s = replica.store;
  const live = <T extends { deletedAt: string | null }>(xs: T[]) => xs.filter((x) => !x.deletedAt);
  const parsed = parseQuickAdd(text, {
    now: new Date(),
    timeZone: replica.timeZone,
    projects: live(s.all('project')).map((p) => ({ id: p.id, name: p.name })),
    sections: live(s.all('section')).map((x) => ({ id: x.id, name: x.name, projectId: x.projectId })),
    labels: live(s.all('label')).map((l) => ({ id: l.id, name: l.name })),
  });
  if (!parsed.title) return undefined;
  const projectId = parsed.project
    ? (parsed.project.id ?? run(createProject({ name: parsed.project.name })) ?? null)
    : undefined;
  const labelIds = parsed.labels
    .map((l) => l.id ?? run(createLabel({ name: l.name })))
    .filter((x): x is string => !!x);
  return run(createTask({ ...toNewTask(parsed, { projectId, labelIds }), ...extra }));
}

/** Complete tasks checked off somewhere else (the widget); one undo step for all of them. */
export function completeFromElsewhere(ids: string[]): void {
  const open = ids.filter((id) => {
    const task = replica.store.get('task', id);
    return task && !task.completedAt && !task.deletedAt;
  });
  if (!open.length) return;
  const title = replica.store.get('task', open[0] as string)?.title ?? '';
  try {
    replica.dispatch(completeTasks(open), { actor: 'user' });
  } catch (e) {
    if (e instanceof CommandError) return;
    throw e;
  }
  toast(
    open.length === 1 ? t('toast.completed', { title }) : t('toast.completedN', { n: open.length }),
    undoAction(),
  );
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
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  toast(
    out.next
      ? t('toast.completedNext', { date: formatDay(out.next, today()) })
      : t('toast.completed', { title: task.title }),
    undoAction(),
  );
}

export function removeTasks(ids: string[]): void {
  if (!ids.length) return;
  const name = replica.store.get('task', ids[0] as string)?.title ?? '';
  run(deleteTasks(ids));
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  toast(
    ids.length === 1 ? t('toast.deleted', { title: name }) : t('toast.deletedN', { n: ids.length }),
    undoAction(),
  );
}

function askMode(): Promise<'occurrence' | 'series' | null> {
  return new Promise((resolve) =>
    Alert.alert(t('reschedule.title'), t('reschedule.body'), [
      { text: t('cancel'), style: 'cancel', onPress: () => resolve(null) },
      { text: t('reschedule.series'), onPress: () => resolve('series') },
      {
        text: t('reschedule.occurrence'),
        style: 'default',
        isPreferred: true,
        onPress: () => resolve('occurrence'),
      },
    ]),
  );
}

export async function schedule(
  ids: string[],
  date: LocalDate | null,
  opts: { quiet?: boolean } = {},
): Promise<void> {
  const tasks = ids.map((id) => replica.store.get('task', id)).filter((x) => !!x);
  let mode: 'occurrence' | 'series' = 'occurrence';
  if (date && tasks.some((x) => x.recurrence && x.scheduled?.date !== date)) {
    const answer = await askMode();
    if (!answer) return;
    mode = answer;
  }
  run(rescheduleTasks(ids, date, mode));
  void Haptics.selectionAsync();
  if (!opts.quiet)
    toast(t('toast.rescheduled', { date: date ? formatDay(date, today()) : t('date.none') }), undoAction());
}

export function rescheduleAllOverdue(): void {
  const n = run(rescheduleOverdue());
  if (n) toast(t('toast.rescheduledN', { n, date: t('date.today') }), undoAction());
}

export function move(ids: string[], target: MoveTarget): void {
  run(moveTasks(ids, target));
}
