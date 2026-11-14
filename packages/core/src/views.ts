import {
  type Completion,
  type DayParts,
  DEFAULT_DAY_PARTS,
  type Label,
  type Memory,
  type Project,
  type Section,
  type Task,
} from './model';
import { compareOrder, sortByOrder } from './order';
import type { ReadStore } from './overlay';
import { addDays, compareDates, isLocalTime, type LocalDate } from './time';

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

/**
 * Tasks visible in date-based views: open, with a date or a deadline, top-level or not, in Inbox
 * or an active project.
 */
function datedOpenTasks(store: ReadStore): Task[] {
  const active = activeProjectIds(store);
  return store
    .all('task')
    .filter(
      (t) => isOpen(t) && (t.scheduled || t.deadline) && (t.projectId === null || active.has(t.projectId)),
    );
}

/**
 * The day a task is listed under: its scheduled date, or its deadline when it has none. A task
 * whose deadline comes before its date is listed on the deadline.
 */
export function listedDate(t: Task): LocalDate | null {
  const d = t.scheduled?.date ?? null;
  if (!t.deadline) return d;
  return !d || compareDates(t.deadline, d) < 0 ? t.deadline : d;
}

/** Open and past its listed day (date or deadline). */
export function isOverdue(t: Task, day: LocalDate): boolean {
  const d = t.scheduled?.date ?? t.deadline;
  return !!d && compareDates(d, day) < 0;
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

/**
 * Today: tasks scheduled for today, plus tasks due today or with a missed deadline even if they
 * are planned for later. Overdue: the scheduled date has passed, or, without one, the deadline.
 */
export function today(store: ReadStore, day: LocalDate): { overdue: Task[]; today: Task[] } {
  const tasks = datedOpenTasks(store);
  const overdue = tasks.filter((t) => isOverdue(t, day));
  const todays = tasks.filter(
    (t) =>
      !isOverdue(t, day) &&
      ((t.scheduled ? t.scheduled.date === day : t.deadline === day) ||
        (!!t.deadline && compareDates(t.deadline, day) <= 0)),
  );
  const key = (t: Task) => t.scheduled?.date ?? t.deadline ?? '';
  overdue.sort((a, b) => compareDates(key(a), key(b)) || compareForDay(a, b));
  todays.sort(compareForDay);
  return { overdue, today: todays };
}

/**
 * Next `days` days starting at `from` (inclusive), one bucket per day, empty days included. Each
 * task is listed once, on {@link listedDate}.
 */
export function upcoming(store: ReadStore, from: LocalDate, days = 14): { date: LocalDate; tasks: Task[] }[] {
  const end = addDays(from, days);
  const buckets = new Map<LocalDate, Task[]>();
  for (let i = 0; i < days; i++) buckets.set(addDays(from, i), []);
  for (const t of datedOpenTasks(store)) {
    const d = listedDate(t) as string;
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

/** What the assistant remembers, oldest first. */
export function memories(store: ReadStore): Memory[] {
  return store
    .all('memory')
    .filter((m) => !m.deletedAt && m.text.trim())
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1));
}

export const DAY_PARTS_KEY = 'dayParts';

/** Day-part times, with the defaults filled in for any the user hasn't set. */
export function dayParts(store: ReadStore): DayParts {
  const v = store.get('setting', DAY_PARTS_KEY)?.value as Partial<DayParts> | null | undefined;
  const out = { ...DEFAULT_DAY_PARTS };
  if (v && typeof v === 'object') {
    for (const k of Object.keys(out) as (keyof DayParts)[]) {
      const x = v[k];
      if (typeof x === 'string' && isLocalTime(x)) out[k] = x;
    }
  }
  return out;
}
