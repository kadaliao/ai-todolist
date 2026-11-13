import type { Completion, Label, Project, Section, Task } from './model';
import { compareOrder, sortByOrder } from './order';
import type { ReadStore } from './overlay';
import { addDays, compareDates, type LocalDate } from './time';

/**
 * Read models for the standard views. Everything is in memory, so these are plain functions
 * over the store; apps memoize on `store.version`.
 */

const isOpen = (t: Task) => !t.deletedAt && !t.completedAt;

function activeProjectIds(store: ReadStore): Set<string> {
  return new Set(
    store
      .all('project')
      .filter((p) => !p.deletedAt && !p.archivedAt)
      .map((p) => p.id),
  );
}

/** Tasks visible in date-based views: open, top-level or not, in Inbox or an active project. */
function datedOpenTasks(store: ReadStore): Task[] {
  const active = activeProjectIds(store);
  return store
    .all('task')
    .filter((t) => isOpen(t) && t.scheduled && (t.projectId === null || active.has(t.projectId)));
}

/** Time-of-day first (untimed last), then priority, then manual order. */
export function compareForDay(a: Task, b: Task): number {
  const ta = a.scheduled?.time;
  const tb = b.scheduled?.time;
  if (ta !== tb) {
    if (!ta) return 1;
    if (!tb) return -1;
    return ta < tb ? -1 : 1;
  }
  if (a.priority !== b.priority) return b.priority - a.priority;
  return compareOrder(a, b);
}

export function inbox(store: ReadStore): Task[] {
  return sortByOrder(
    store.all('task').filter((t) => isOpen(t) && t.projectId === null && t.parentId === null),
  );
}

export function today(store: ReadStore, day: LocalDate): { overdue: Task[]; today: Task[] } {
  const tasks = datedOpenTasks(store);
  const overdue = tasks.filter((t) => compareDates((t.scheduled as { date: string }).date, day) < 0);
  const todays = tasks.filter((t) => t.scheduled?.date === day);
  overdue.sort(
    (a, b) => compareDates(a.scheduled?.date ?? '', b.scheduled?.date ?? '') || compareForDay(a, b),
  );
  todays.sort(compareForDay);
  return { overdue, today: todays };
}

/** Next `days` days starting at `from` (inclusive), one bucket per day, empty days included. */
export function upcoming(store: ReadStore, from: LocalDate, days = 14): { date: LocalDate; tasks: Task[] }[] {
  const end = addDays(from, days);
  const buckets = new Map<LocalDate, Task[]>();
  for (let i = 0; i < days; i++) buckets.set(addDays(from, i), []);
  for (const t of datedOpenTasks(store)) {
    const d = t.scheduled?.date as string;
    if (compareDates(d, from) >= 0 && compareDates(d, end) < 0) buckets.get(d)?.push(t);
  }
  return [...buckets].map(([date, tasks]) => ({ date, tasks: tasks.sort(compareForDay) }));
}

export interface ProjectView {
  project: Project;
  /** Tasks without a section come first, as a `section: null` group. */
  groups: { section: Section | null; tasks: Task[] }[];
}

/** A project's open top-level tasks grouped by section. Subtasks via {@link subtasks}. */
export function projectView(store: ReadStore, projectId: string): ProjectView | null {
  const project = store.get('project', projectId);
  if (!project || project.deletedAt) return null;
  const sections = sortByOrder(store.all('section').filter((s) => s.projectId === projectId && !s.deletedAt));
  const tasks = store
    .all('task')
    .filter((t) => isOpen(t) && t.projectId === projectId && t.parentId === null);
  const groups: ProjectView['groups'] = [{ section: null, tasks: [] }];
  const bySection = new Map<string, Task[]>();
  for (const s of sections) {
    const list: Task[] = [];
    bySection.set(s.id, list);
    groups.push({ section: s, tasks: list });
  }
  for (const t of tasks) {
    const list = (t.sectionId && bySection.get(t.sectionId)) || groups[0]?.tasks;
    list?.push(t);
  }
  for (const g of groups) g.tasks.sort(compareOrder);
  return { project, groups };
}

export function subtasks(store: ReadStore, parentId: string, includeCompleted = true): Task[] {
  return sortByOrder(
    store
      .all('task')
      .filter((t) => t.parentId === parentId && !t.deletedAt && (includeCompleted || !t.completedAt)),
  );
}

/** Sidebar: projects as a one-level tree, plus labels. */
export function sidebar(store: ReadStore): {
  projects: { project: Project; children: Project[] }[];
  labels: Label[];
} {
  const projects = store.all('project').filter((p) => !p.deletedAt && !p.archivedAt);
  const roots = sortByOrder(projects.filter((p) => !p.parentId));
  return {
    projects: roots.map((project) => ({
      project,
      children: sortByOrder(projects.filter((p) => p.parentId === project.id)),
    })),
    labels: sortByOrder(store.all('label').filter((l) => !l.deletedAt)),
  };
}

export type LogbookEntry =
  | { kind: 'task'; completedAt: string; task: Task }
  | { kind: 'occurrence'; completedAt: string; completion: Completion };

/** Completed tasks and finished occurrences of recurring tasks, newest first. */
export function logbook(store: ReadStore, limit = 200): LogbookEntry[] {
  const entries: LogbookEntry[] = [];
  for (const t of store.all('task')) {
    if (t.completedAt && !t.deletedAt) entries.push({ kind: 'task', completedAt: t.completedAt, task: t });
  }
  for (const c of store.all('completion')) {
    if (!c.deletedAt) entries.push({ kind: 'occurrence', completedAt: c.completedAt, completion: c });
  }
  entries.sort((a, b) => (a.completedAt < b.completedAt ? 1 : a.completedAt > b.completedAt ? -1 : 0));
  return entries.slice(0, limit);
}

export function trash(store: ReadStore): Task[] {
  return store
    .all('task')
    .filter((t) => t.deletedAt)
    .sort((a, b) => ((a.deletedAt as string) < (b.deletedAt as string) ? 1 : -1));
}

/** Case-insensitive substring search over titles and notes; open tasks first. */
export function search(store: ReadStore, query: string, limit = 50): Task[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits = store
    .all('task')
    .filter((t) => !t.deletedAt && (t.title.toLowerCase().includes(q) || t.notes.toLowerCase().includes(q)));
  hits.sort((a, b) => {
    if (!a.completedAt !== !b.completedAt) return a.completedAt ? 1 : -1;
    const ai = a.title.toLowerCase().indexOf(q);
    const bi = b.title.toLowerCase().indexOf(q);
    if ((ai === -1) !== (bi === -1)) return ai === -1 ? 1 : -1;
    return compareOrder(a, b);
  });
  return hits.slice(0, limit);
}

export function labelTasks(store: ReadStore, labelId: string): Task[] {
  return sortByOrder(store.all('task').filter((t) => isOpen(t) && t.labels.includes(labelId)));
}
