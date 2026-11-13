import type { Task } from './model';
import { toInstant } from './time';

/**
 * When each reminder fires. Shared by the in-app scheduler (web/desktop) and the phone's OS
 * notifications. Tasks with a time but no explicit reminder fire at that time when
 * `atTimeByDefault` is set. Keys change when a task moves, so a moved task notifies again.
 */
export interface DueReminder {
  key: string;
  at: number;
  task: Task;
  minutesBefore: number;
}

export function dueReminders(
  tasks: readonly Task[],
  timeZone: string,
  atTimeByDefault: boolean,
): DueReminder[] {
  const out: DueReminder[] = [];
  for (const t of tasks) {
    if (t.completedAt || t.deletedAt || !t.scheduled) continue;
    const reminders = t.reminders.length
      ? t.reminders
      : atTimeByDefault && t.scheduled.time
        ? [{ id: 'default', kind: 'relative' as const, minutesBefore: 0 }]
        : [];
    for (const r of reminders) {
      if (r.kind === 'relative') {
        if (!t.scheduled.time) continue;
        const at =
          toInstant(t.scheduled.date, t.scheduled.time, timeZone).getTime() - r.minutesBefore * 60_000;
        out.push({
          key: `${t.id}@${t.scheduled.date}T${t.scheduled.time}-${r.minutesBefore}`,
          at,
          task: t,
          minutesBefore: r.minutesBefore,
        });
      } else {
        const at = toInstant(r.date, r.at, timeZone).getTime();
        out.push({ key: `${t.id}@${r.date}T${r.at}`, at, task: t, minutesBefore: 0 });
      }
    }
  }
  return out.sort((a, b) => a.at - b.at);
}
