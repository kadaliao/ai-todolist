import type { LocalDate, LocalTime } from './time';

/**
 * Domain model. Every entity is stored as a bag of independently-versioned fields (see
 * `sync/store.ts`), so these interfaces describe the *materialized* shape with defaults applied.
 *
 * `duration` is reserved for time blocking; it is part of the model so enabling it later needs no
 * data migration.
 */

export type EntityType = 'task' | 'project' | 'section' | 'label' | 'completion' | 'memory' | 'setting';

/** Who caused a change. Lets the UI show/undo AI edits separately. */
export type Actor = 'user' | 'ai' | 'mcp' | 'system';

/**
 * 0 = none … 3 = highest. Quick-add `p1`/`!1` maps to 3, `p4` to 0 (Todoist convention, where
 * p1 is the most urgent).
 */
export type Priority = 0 | 1 | 2 | 3;

export interface Scheduled {
  date: LocalDate;
  time?: LocalTime;
  /** Minutes. v2 (time blocking). */
  duration?: number;
}

export type RepeatFrom = 'scheduled' | 'completion';

export interface Recurrence {
  /** RFC 5545 RRULE body without DTSTART, e.g. `FREQ=WEEKLY;BYDAY=MO,WE`. */
  rule: string;
  /** `scheduled`: fixed calendar series. `completion`: next date counts from when it was done. */
  from: RepeatFrom;
  /** Series start (DTSTART). Changed only by "change the rule", never by "this occurrence only". */
  anchor: LocalDate;
  /** Series date of the current occurrence; `scheduled.date` may differ after a one-off move. */
  instance: LocalDate;
}

export type Reminder =
  | { id: string; kind: 'absolute'; at: LocalTime; date: LocalDate }
  | { id: string; kind: 'relative'; minutesBefore: number };

export interface Task {
  id: string;
  title: string;
  /** Markdown. */
  notes: string;
  /** `null` = Inbox. */
  projectId: string | null;
  sectionId: string | null;
  parentId: string | null;
  sortKey: string;
  priority: Priority;
  /** Label ids. */
  labels: string[];
  scheduled: Scheduled | null;
  /** Hard deadline, separate from when you plan to do it (Things' When vs Deadline). */
  deadline: LocalDate | null;
  recurrence: Recurrence | null;
  reminders: Reminder[];
  /** ISO instant. Only set for non-recurring tasks; recurring ones log a `Completion`. */
  completedAt: string | null;
  /** ISO instant. Soft delete (trash). */
  deletedAt: string | null;
  createdAt: string;
  origin: Actor;
}

export interface Project {
  id: string;
  name: string;
  color: string | null;
  /** Folder / area grouping: projects may nest one level under another project. */
  parentId: string | null;
  sortKey: string;
  archivedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
}

export interface Section {
  id: string;
  projectId: string;
  name: string;
  sortKey: string;
  deletedAt: string | null;
  createdAt: string;
}

export interface Label {
  id: string;
  name: string;
  color: string | null;
  sortKey: string;
  deletedAt: string | null;
  createdAt: string;
}

/** Logbook entry for one finished occurrence of a recurring task. */
export interface Completion {
  id: string;
  taskId: string;
  title: string;
  projectId: string | null;
  occurrence: LocalDate | null;
  completedAt: string;
  deletedAt: string | null;
  createdAt: string;
}

/** Something the assistant was asked to remember (“张三是我老板”, “健身的事放生活”). */
export interface Memory {
  id: string;
  text: string;
  deletedAt: string | null;
  createdAt: string;
  origin: Actor;
}

/**
 * A synced preference; the id is its key. Device-only settings (sync server, theme) live in each
 * app's own storage instead.
 */
export interface Setting {
  id: string;
  value: unknown;
  createdAt: string;
}

/** Times that bare day-part words stand for: “明天早上” → morning. */
export interface DayParts {
  morning: string;
  noon: string;
  afternoon: string;
  evening: string;
}

export const DEFAULT_DAY_PARTS: DayParts = {
  morning: '09:00',
  noon: '12:00',
  afternoon: '15:00',
  evening: '20:00',
};

export interface EntityMap {
  task: Task;
  project: Project;
  section: Section;
  label: Label;
  completion: Completion;
  memory: Memory;
  setting: Setting;
}

/**
 * The types servers and clients before schema 2 know. Older apps throw on anything else, so the
 * server leaves newer types out of their pulls and new apps hold them back from older servers.
 */
export const LEGACY_ENTITY_TYPES: readonly EntityType[] = [
  'task',
  'project',
  'section',
  'label',
  'completion',
];
export const ENTITY_TYPES: readonly EntityType[] = [...LEGACY_ENTITY_TYPES, 'memory', 'setting'];
/** Sync schema: 2 added `memory` and `setting`. */
export const SYNC_SCHEMA = 2;

/** Defaults for fields that may be absent in storage. `id`/`createdAt` always exist. */
export const DEFAULTS: { [K in EntityType]: Partial<EntityMap[K]> } = {
  task: {
    title: '',
    notes: '',
    projectId: null,
    sectionId: null,
    parentId: null,
    sortKey: 'a0',
    priority: 0,
    labels: [],
    scheduled: null,
    deadline: null,
    recurrence: null,
    reminders: [],
    completedAt: null,
    deletedAt: null,
    origin: 'user',
  },
  project: { name: '', color: null, parentId: null, sortKey: 'a0', archivedAt: null, deletedAt: null },
  section: { name: '', sortKey: 'a0', deletedAt: null },
  label: { name: '', color: null, sortKey: 'a0', deletedAt: null },
  completion: { projectId: null, occurrence: null, deletedAt: null },
  memory: { text: '', deletedAt: null, origin: 'user' },
  setting: { value: null },
};
