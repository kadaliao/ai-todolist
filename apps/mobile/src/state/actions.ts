import {
  type Actor,
  type Command,
  CommandError,
  completeTask,
  createTask,
  createTasks,
  deleteTasks,
  type LocalDate,
  type MoveTarget,
  moveTasks,
  type NewTask,
  type Replica,
  rescheduleOverdue,
  rescheduleTasks,
  type TaskPatch,
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

const undoAction = () => ({ label: t('undo'), run: () => undo() });

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
