import { addDays, type Replica, type Task, today as todayView, upcoming } from '@ai-todo/core';

/**
 * What the home-screen widgets show: overdue, today's and the next few days' tasks. The same shape
 * is read by the iOS widget (targets/widget/WidgetData.swift) and the Android widget.
 */
export interface WidgetTask {
  id: string;
  title: string;
  /** Local date, yyyy-MM-dd. */
  date: string;
  time: string | null;
  /** 0 = none … 3 = highest (shown as P1). */
  priority: number;
  project: string | null;
  color: string | null;
}

export interface WidgetSnapshot {
  locale: string;
  tasks: WidgetTask[];
}

export function buildWidgetSnapshot(r: Replica, locale: string): WidgetSnapshot {
  const day = r.context().today;
  const { overdue, today } = todayView(r.store, day);
  const soon = upcoming(r.store, addDays(day, 1), 3).flatMap((b) => b.tasks);
  const projects = new Map(r.store.all('project').map((p) => [p.id, p]));
  const row = (task: Task): WidgetTask => {
    const project = task.projectId ? projects.get(task.projectId) : undefined;
    return {
      id: task.id,
      title: task.title,
      date: task.scheduled?.date ?? day,
      time: task.scheduled?.time ?? null,
      priority: task.priority,
      project: project?.name ?? null,
      color: project?.color ?? null,
    };
  };
  return { locale, tasks: [...overdue, ...today, ...soon].slice(0, 60).map(row) };
}

/** The device's local date as yyyy-MM-dd. */
export function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Overdue (oldest first) and today's tasks for `day`, plus tomorrow's, in snapshot order. */
export function widgetDays(s: WidgetSnapshot, now: Date) {
  const day = localDay(now);
  const tomorrow = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  return {
    overdue: s.tasks.filter((t) => t.date < day),
    today: s.tasks.filter((t) => t.date === day),
    tomorrow: s.tasks.filter((t) => t.date === tomorrow),
  };
}
