import type {
  Actor,
  EntityMap,
  EntityType,
  Priority,
  Project,
  Recurrence,
  Reminder,
  RepeatFrom,
  Scheduled,
  Section,
  Task,
} from './model';
import { keyAtEnd, keyAtStart, placeAt } from './order';
import { Overlay, type ReadStore } from './overlay';
import { nextOccurrence, parseRule, reanchor, startRecurrence } from './recurrence';
import type { Json, Mutation } from './sync/store';
import { compareDates, isLocalDate, isLocalTime, type LocalDate } from './time';

/**
 * Command layer: the only way state changes, used by the UI, AI and MCP alike.
 *
 * A command is a pure function of the current state that returns field mutations; the replica
 * stamps them into ops, applies them, and records how to undo them. Keeping AI behind the same
 * commands is what makes AI edits previewable and undoable like any other edit.
 */

export interface CommandContext {
  readonly store: ReadStore;
  readonly now: Date;
  readonly today: LocalDate;
  readonly timeZone: string;
  readonly actor: Actor;
  newId(): string;
}

export interface CommandOutput<R> {
  mutations: Mutation[];
  result: R;
}

export interface Command<R = void> {
  readonly label: string;
  run(ctx: CommandContext): CommandOutput<R>;
}

export class CommandError extends Error {
  override name = 'CommandError';
}

// ---------------------------------------------------------------------------------------------
// helpers

function toJson(v: unknown): Json {
  return v === undefined ? null : (JSON.parse(JSON.stringify(v)) as Json);
}

/** Collects a command's mutations and stages them so the command reads its own writes. */
class Writer {
  readonly mutations: Mutation[] = [];
  constructor(private readonly overlay: Overlay) {}
  private push(m: Mutation) {
    this.mutations.push(m);
    this.overlay.write(m);
  }
  set<K extends EntityType>(entity: K, entityId: string, field: keyof EntityMap[K] & string, value: unknown) {
    this.push({ entity, entityId, field, value: toJson(value) });
  }
  create<K extends EntityType>(entity: K, entityId: string, fields: Partial<EntityMap[K]>) {
    // createdAt last: an entity "exists" once createdAt is set, so readers never see half of it.
    const entries = Object.entries(fields).filter(([f, v]) => v !== undefined && f !== 'id');
    entries.sort(([a], [b]) => Number(a === 'createdAt') - Number(b === 'createdAt'));
    for (const [field, value] of entries) this.push({ entity, entityId, field, value: toJson(value) });
  }
  /** Run a nested command against the staged state and keep its mutations. */
  include<R>(ctx: CommandContext, cmd: Command<R>): R {
    const out = cmd.run(ctx);
    for (const m of out.mutations) this.push(m);
    return out.result;
  }
}

function command<R>(label: string, run: (ctx: CommandContext, w: Writer) => R): Command<R> {
  return {
    label,
    run(ctx) {
      const overlay = new Overlay(ctx.store);
      const w = new Writer(overlay);
      const result = run({ ...ctx, store: overlay, newId: () => ctx.newId() }, w);
      return { mutations: w.mutations, result };
    },
  };
}

function mustGet<K extends EntityType>(store: ReadStore, entity: K, id: string): EntityMap[K] {
  const e = store.get(entity, id);
  if (!e || (e as { deletedAt?: string | null }).deletedAt) {
    throw new CommandError(`${entity} not found: ${id}`);
  }
  return e;
}

function liveTasks(store: ReadStore): Task[] {
  return store.all('task').filter((t) => !t.deletedAt);
}

/** Tasks sharing a list position scope (same project + section + parent). */
export function siblingsOf(
  store: ReadStore,
  scope: { projectId: string | null; sectionId: string | null; parentId: string | null },
): Task[] {
  return liveTasks(store).filter(
    (t) =>
      t.projectId === scope.projectId && t.sectionId === scope.sectionId && t.parentId === scope.parentId,
  );
}

export function descendantsOf(store: ReadStore, id: string): Task[] {
  const all = store.all('task');
  const out: Task[] = [];
  const seen = new Set([id]); // cycle-safe: concurrent indents can loop until repaired
  const queue = [id];
  while (queue.length) {
    const pid = queue.shift() as string;
    for (const t of all) {
      if (t.parentId === pid && !seen.has(t.id)) {
        seen.add(t.id);
        out.push(t);
        queue.push(t.id);
      }
    }
  }
  return out;
}

function ancestorsOf(store: ReadStore, task: Task): Task[] {
  const out: Task[] = [];
  const seen = new Set<string>([task.id]);
  let pid = task.parentId;
  while (pid && !seen.has(pid)) {
    seen.add(pid);
    const p = store.get('task', pid);
    if (!p) break;
    out.push(p);
    pid = p.parentId;
  }
  return out;
}

function cleanTitle(title: string): string {
  const t = title.replace(/\s+/g, ' ').trim();
  if (!t) throw new CommandError('title must not be empty');
  return t;
}

function checkScheduled(s: Scheduled | null | undefined): Scheduled | null {
  if (!s) return null;
  if (!isLocalDate(s.date)) throw new CommandError(`invalid date: ${s.date}`);
  if (s.time !== undefined && !isLocalTime(s.time)) throw new CommandError(`invalid time: ${s.time}`);
  if (s.duration !== undefined && !(Number.isInteger(s.duration) && s.duration > 0)) {
    throw new CommandError(`invalid duration: ${s.duration}`);
  }
  return {
    date: s.date,
    ...(s.time ? { time: s.time } : {}),
    ...(s.duration ? { duration: s.duration } : {}),
  };
}

function checkLabels(store: ReadStore, ids: readonly string[]): string[] {
  const unique = [...new Set(ids)];
  for (const id of unique) mustGet(store, 'label', id);
  return unique;
}

function checkPriority(p: number | undefined): Priority | undefined {
  if (p === undefined) return undefined;
  if (p !== 0 && p !== 1 && p !== 2 && p !== 3) throw new CommandError(`invalid priority: ${p}`);
  return p;
}

export interface RecurrenceInput {
  rule: string;
  from?: RepeatFrom;
}

/**
 * Explicit date → the series starts there (even if it's off-pattern, e.g. "weekly on Monday,
 * starting this Tuesday"). No date → first matching date on/after today.
 */
function buildRecurrence(input: RecurrenceInput, date: LocalDate | undefined, today: LocalDate): Recurrence {
  try {
    parseRule(input.rule);
  } catch {
    throw new CommandError(`invalid recurrence rule: ${input.rule}`);
  }
  const from = input.from ?? 'scheduled';
  if (date) return { rule: input.rule, from, anchor: date, instance: date };
  const rec = startRecurrence(input.rule, today, from);
  if (!rec) throw new CommandError(`recurrence has no upcoming dates: ${input.rule}`);
  return rec;
}

type Position = 'top' | 'bottom' | { index: number };

const NEW = '\u0000new';

/** Sort key for a new item; re-keys colliding neighbours (rare) through the writer. */
function keyFor(
  w: Writer,
  entity: 'task' | 'project' | 'section',
  siblings: Task[] | Project[] | Section[],
  position: Position | undefined,
): string {
  if (position === 'top') return keyAtStart(siblings);
  if (position === undefined || position === 'bottom') return keyAtEnd(siblings);
  let key = '';
  for (const k of placeAt(siblings, [NEW], position.index)) {
    if (k.id === NEW) key = k.sortKey;
    else w.set(entity, k.id, 'sortKey', k.sortKey);
  }
  return key;
}

// ---------------------------------------------------------------------------------------------
// tasks

export interface NewTask {
  title: string;
  notes?: string;
  projectId?: string | null;
  sectionId?: string | null;
  parentId?: string | null;
  priority?: Priority;
  labels?: string[];
  scheduled?: Scheduled | null;
  deadline?: LocalDate | null;
  recurrence?: RecurrenceInput | null;
  reminders?: Reminder[];
  position?: Position;
}

function resolveScope(
  store: ReadStore,
  input: { projectId?: string | null; sectionId?: string | null; parentId?: string | null },
) {
  if (input.parentId) {
    const parent = mustGet(store, 'task', input.parentId);
    return { projectId: parent.projectId, sectionId: parent.sectionId, parentId: parent.id };
  }
  if (input.sectionId) {
    const section = mustGet(store, 'section', input.sectionId);
    return { projectId: section.projectId, sectionId: section.id, parentId: null };
  }
  if (input.projectId) mustGet(store, 'project', input.projectId);
  return { projectId: input.projectId ?? null, sectionId: null, parentId: null };
}

function buildTask(ctx: CommandContext, w: Writer, input: NewTask): string {
  const id = ctx.newId();
  const scope = resolveScope(ctx.store, input);
  let scheduled = checkScheduled(input.scheduled);
  let recurrence: Recurrence | null = null;
  if (input.recurrence) {
    recurrence = buildRecurrence(input.recurrence, scheduled?.date, ctx.today);
    scheduled = scheduled ?? { date: recurrence.instance };
  }
  if (input.deadline && !isLocalDate(input.deadline)) {
    throw new CommandError(`invalid deadline: ${input.deadline}`);
  }
  w.create('task', id, {
    title: cleanTitle(input.title),
    notes: input.notes || undefined,
    ...scope,
    sortKey: keyFor(w, 'task', siblingsOf(ctx.store, scope), input.position),
    priority: checkPriority(input.priority) || undefined,
    labels: input.labels?.length ? checkLabels(ctx.store, input.labels) : undefined,
    scheduled: scheduled ?? undefined,
    deadline: input.deadline ?? undefined,
    recurrence: recurrence ?? undefined,
    reminders: input.reminders?.length ? input.reminders : undefined,
    origin: ctx.actor,
    createdAt: ctx.now.toISOString(),
  });
  return id;
}

export function createTask(input: NewTask): Command<string> {
  return command('create task', (ctx, w) => buildTask(ctx, w, input));
}

/** Several tasks in one transaction (AI brain dump, multi-line paste). One undo removes all. */
export function createTasks(inputs: NewTask[]): Command<string[]> {
  return command(`create ${inputs.length} tasks`, (ctx, w) => {
    // Staged writes make later tasks see earlier ones as siblings, so sort keys increase.
    return inputs.map((input) => buildTask(ctx, w, input));
  });
}

export interface TaskPatch {
  title?: string;
  notes?: string;
  priority?: Priority;
  labels?: string[];
  /** Time/duration edits. To move a recurring task to another day use {@link rescheduleTask}. */
  scheduled?: Scheduled | null;
  deadline?: LocalDate | null;
  /** `null` stops repeating. */
  recurrence?: RecurrenceInput | null;
  reminders?: Reminder[];
}

export function updateTask(id: string, patch: TaskPatch): Command {
  return command('edit task', (ctx, w) => {
    const task = mustGet(ctx.store, 'task', id);
    if (patch.title !== undefined) w.set('task', id, 'title', cleanTitle(patch.title));
    if (patch.notes !== undefined) w.set('task', id, 'notes', patch.notes);
    if (patch.priority !== undefined) w.set('task', id, 'priority', checkPriority(patch.priority));
    if (patch.labels !== undefined) w.set('task', id, 'labels', checkLabels(ctx.store, patch.labels));
    if (patch.deadline !== undefined) {
      if (patch.deadline !== null && !isLocalDate(patch.deadline)) {
        throw new CommandError(`invalid deadline: ${patch.deadline}`);
      }
      w.set('task', id, 'deadline', patch.deadline);
    }
    if (patch.reminders !== undefined) w.set('task', id, 'reminders', patch.reminders);
    let scheduled = task.scheduled;
    if (patch.scheduled !== undefined) {
      scheduled = checkScheduled(patch.scheduled);
      w.set('task', id, 'scheduled', scheduled);
      if (!scheduled && task.recurrence && patch.recurrence === undefined) {
        w.set('task', id, 'recurrence', null);
      }
    }
    if (patch.recurrence !== undefined) {
      if (patch.recurrence === null) {
        w.set('task', id, 'recurrence', null);
      } else {
        const rec = buildRecurrence(patch.recurrence, scheduled?.date, ctx.today);
        w.set('task', id, 'recurrence', rec);
        if (!scheduled) w.set('task', id, 'scheduled', { date: rec.instance });
      }
    }
  });
}

export function completeTask(id: string): Command<{ next: LocalDate | null }> {
  return command('complete task', (ctx, w) => {
    const task = mustGet(ctx.store, 'task', id);
    if (task.completedAt) return { next: null };
    const now = ctx.now.toISOString();
    if (task.recurrence) {
      const next = nextOccurrence(task.recurrence, ctx.today);
      if (next) {
        w.create('completion', ctx.newId(), {
          taskId: id,
          title: task.title,
          projectId: task.projectId,
          occurrence: task.recurrence.instance,
          completedAt: now,
          createdAt: now,
        });
        w.set('task', id, 'scheduled', { ...(task.scheduled ?? {}), date: next });
        w.set('task', id, 'recurrence', { ...task.recurrence, instance: next });
        // Recurring checklists start fresh each time.
        for (const d of descendantsOf(ctx.store, id)) {
          if (d.completedAt && !d.deletedAt) w.set('task', d.id, 'completedAt', null);
        }
        return { next };
      }
      // Series ended (COUNT/UNTIL reached): fall through and complete for good.
    }
    w.set('task', id, 'completedAt', now);
    for (const d of descendantsOf(ctx.store, id)) {
      if (!d.completedAt && !d.deletedAt) w.set('task', d.id, 'completedAt', now);
    }
    return { next: null };
  });
}

export function uncompleteTask(id: string): Command {
  return command('reopen task', (ctx, w) => {
    const task = mustGet(ctx.store, 'task', id);
    if (task.completedAt) w.set('task', id, 'completedAt', null);
    // A parent can't stay done while one of its subtasks is open again.
    for (const a of ancestorsOf(ctx.store, task)) {
      if (a.completedAt) w.set('task', a.id, 'completedAt', null);
    }
  });
}

export function completeTasks(ids: string[]): Command {
  return command(`complete ${ids.length} tasks`, (ctx, w) => {
    for (const id of ids) w.include(ctx, completeTask(id));
  });
}

export function deleteTask(id: string): Command {
  return deleteTasks([id], 'delete task');
}

export function deleteTasks(ids: string[], label = `delete ${ids.length} tasks`): Command {
  return command(label, (ctx, w) => {
    const now = ctx.now.toISOString();
    const done = new Set<string>();
    for (const id of ids) {
      if (done.has(id)) continue; // already deleted as a subtask of an earlier id
      mustGet(ctx.store, 'task', id);
      for (const t of [{ id }, ...descendantsOf(ctx.store, id)]) {
        const cur = ctx.store.get('task', t.id);
        if (cur && !cur.deletedAt && !done.has(t.id)) {
          done.add(t.id);
          w.set('task', t.id, 'deletedAt', now);
        }
      }
    }
  });
}

/** Restore from trash, together with the subtasks deleted with it and any deleted ancestors. */
export function restoreTask(id: string): Command {
  return command('restore task', (ctx, w) => {
    const task = ctx.store.get('task', id);
    if (!task) throw new CommandError(`task not found: ${id}`);
    if (!task.deletedAt) return;
    w.set('task', id, 'deletedAt', null);
    for (const d of descendantsOf(ctx.store, id)) {
      if (d.deletedAt === task.deletedAt) w.set('task', d.id, 'deletedAt', null);
    }
    for (const a of ancestorsOf(ctx.store, task)) {
      if (a.deletedAt) w.set('task', a.id, 'deletedAt', null);
    }
    if (task.projectId && ctx.store.get('project', task.projectId)?.deletedAt) {
      w.set('task', id, 'projectId', null);
      w.set('task', id, 'sectionId', null);
    }
  });
}

export interface MoveTarget {
  projectId?: string | null;
  sectionId?: string | null;
  parentId?: string | null;
  /** Position among the target siblings; default: end. */
  index?: number;
}

/**
 * Move tasks (keeping their relative order) to a project/section/parent and/or position.
 * Unspecified scope fields keep their current value. Subtasks travel with their parent.
 */
export function moveTasks(ids: string[], target: MoveTarget): Command {
  return command(ids.length === 1 ? 'move task' : `move ${ids.length} tasks`, (ctx, w) => {
    const tasks = ids.map((id) => mustGet(ctx.store, 'task', id));
    const idSet = new Set(ids);
    // If a parent and its child are both selected, only the parent moves (the child follows).
    const roots = tasks.filter((t) => !ancestorsOf(ctx.store, t).some((a) => idSet.has(a.id)));
    if (!roots.length) return;
    const first = roots[0] as Task;
    let scope: { projectId: string | null; sectionId: string | null; parentId: string | null };
    if (target.parentId) {
      const parent = mustGet(ctx.store, 'task', target.parentId);
      for (const r of roots) {
        if (r.id === parent.id || ancestorsOf(ctx.store, parent).some((a) => a.id === r.id)) {
          throw new CommandError('cannot move a task under itself');
        }
      }
      scope = { projectId: parent.projectId, sectionId: parent.sectionId, parentId: parent.id };
    } else if (target.sectionId) {
      const section = mustGet(ctx.store, 'section', target.sectionId);
      scope = { projectId: section.projectId, sectionId: section.id, parentId: null };
    } else if (target.projectId !== undefined) {
      if (target.projectId) mustGet(ctx.store, 'project', target.projectId);
      scope = {
        projectId: target.projectId,
        sectionId:
          target.sectionId === undefined && target.projectId === first.projectId ? first.sectionId : null,
        parentId:
          target.parentId === undefined && target.projectId === first.projectId ? first.parentId : null,
      };
    } else {
      scope = {
        projectId: first.projectId,
        sectionId: target.sectionId === null ? null : first.sectionId,
        parentId: target.parentId === null ? null : first.parentId,
      };
    }
    const siblings = siblingsOf(ctx.store, scope);
    const keys = placeAt(
      siblings,
      roots.map((r) => r.id),
      target.index ?? siblings.length,
    );
    for (const k of keys) w.set('task', k.id, 'sortKey', k.sortKey);
    for (const r of roots) {
      if (r.projectId !== scope.projectId) w.set('task', r.id, 'projectId', scope.projectId);
      if (r.sectionId !== scope.sectionId) w.set('task', r.id, 'sectionId', scope.sectionId);
      if (r.parentId !== scope.parentId) w.set('task', r.id, 'parentId', scope.parentId);
      for (const d of descendantsOf(ctx.store, r.id)) {
        if (d.projectId !== scope.projectId) w.set('task', d.id, 'projectId', scope.projectId);
        if (d.sectionId !== scope.sectionId) w.set('task', d.id, 'sectionId', scope.sectionId);
      }
    }
  });
}

export function moveTask(id: string, target: MoveTarget): Command {
  return moveTasks([id], target);
}

export type RescheduleMode = 'occurrence' | 'series';

/**
 * Move a task to another day (time of day is kept). For recurring tasks the caller must ask
 * "only this one or the whole series?":
 * - `occurrence`: only this occurrence moves; the series continues as before afterwards.
 * - `series`: the rule is re-anchored at the new date.
 * `date: null` removes the date (and stops repeating).
 */
export function rescheduleTask(
  id: string,
  date: LocalDate | null,
  mode: RescheduleMode = 'occurrence',
): Command {
  return rescheduleTasks([id], date, mode, 'reschedule task');
}

export function rescheduleTasks(
  ids: string[],
  date: LocalDate | null,
  mode: RescheduleMode = 'occurrence',
  label = `reschedule ${ids.length} tasks`,
): Command {
  return command(label, (ctx, w) => {
    if (date !== null && !isLocalDate(date)) throw new CommandError(`invalid date: ${date}`);
    for (const id of ids) {
      const task = mustGet(ctx.store, 'task', id);
      if (date === null) {
        w.set('task', id, 'scheduled', null);
        if (task.recurrence) w.set('task', id, 'recurrence', null);
        continue;
      }
      w.set('task', id, 'scheduled', { ...(task.scheduled ?? {}), date });
      if (task.recurrence && mode === 'series') {
        w.set('task', id, 'recurrence', reanchor(task.recurrence, date));
      }
    }
  });
}

export function overdueTasks(store: ReadStore, today: LocalDate): Task[] {
  return liveTasks(store).filter(
    (t) => !t.completedAt && t.scheduled && compareDates(t.scheduled.date, today) < 0,
  );
}

/** "Reschedule all overdue" — moves every overdue task to `date` (default today). */
export function rescheduleOverdue(date?: LocalDate): Command<number> {
  return command('reschedule overdue tasks', (ctx, w) => {
    const target = date ?? ctx.today;
    const ids = overdueTasks(ctx.store, ctx.today).map((t) => t.id);
    if (!ids.length) return 0;
    w.include(ctx, rescheduleTasks(ids, target, 'occurrence'));
    return ids.length;
  });
}

// ---------------------------------------------------------------------------------------------
// projects, sections, labels

export function createProject(input: {
  name: string;
  color?: string | null;
  parentId?: string | null;
  position?: Position;
}): Command<string> {
  return command('create project', (ctx, w) => {
    const name = input.name.trim();
    if (!name) throw new CommandError('project name must not be empty');
    if (input.parentId) {
      const parent = mustGet(ctx.store, 'project', input.parentId);
      if (parent.parentId) throw new CommandError('projects nest only one level deep');
    }
    const siblings = ctx.store
      .all('project')
      .filter((p) => !p.deletedAt && p.parentId === (input.parentId ?? null));
    const id = ctx.newId();
    w.create('project', id, {
      name,
      color: input.color ?? undefined,
      parentId: input.parentId ?? undefined,
      sortKey: keyFor(w, 'project', siblings, input.position),
      createdAt: ctx.now.toISOString(),
    });
    return id;
  });
}

export function updateProject(id: string, patch: { name?: string; color?: string | null }): Command {
  return command('edit project', (ctx, w) => {
    mustGet(ctx.store, 'project', id);
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new CommandError('project name must not be empty');
      w.set('project', id, 'name', name);
    }
    if (patch.color !== undefined) w.set('project', id, 'color', patch.color);
  });
}

export function moveProject(id: string, target: { parentId?: string | null; index: number }): Command {
  return command('move project', (ctx, w) => {
    const project = mustGet(ctx.store, 'project', id);
    const parentId = target.parentId === undefined ? project.parentId : target.parentId;
    if (parentId) {
      const parent = mustGet(ctx.store, 'project', parentId);
      if (parent.parentId || parent.id === id) throw new CommandError('invalid project parent');
      if (ctx.store.all('project').some((p) => p.parentId === id && !p.deletedAt)) {
        throw new CommandError('a project with sub-projects cannot be nested');
      }
    }
    const siblings = ctx.store.all('project').filter((p) => !p.deletedAt && p.parentId === parentId);
    for (const k of placeAt(siblings, [id], target.index)) w.set('project', k.id, 'sortKey', k.sortKey);
    if (parentId !== project.parentId) w.set('project', id, 'parentId', parentId);
  });
}

export function archiveProject(id: string, archived = true): Command {
  return command(archived ? 'archive project' : 'unarchive project', (ctx, w) => {
    mustGet(ctx.store, 'project', id);
    w.set('project', id, 'archivedAt', archived ? ctx.now.toISOString() : null);
  });
}

/** Soft-deletes the project with its sub-projects, sections and tasks. Undoable. */
export function deleteProject(id: string): Command {
  return command('delete project', (ctx, w) => {
    mustGet(ctx.store, 'project', id);
    const now = ctx.now.toISOString();
    const projectIds = [
      id,
      ...ctx.store
        .all('project')
        .filter((p) => p.parentId === id && !p.deletedAt)
        .map((p) => p.id),
    ];
    for (const pid of projectIds) {
      w.set('project', pid, 'deletedAt', now);
      for (const s of ctx.store.all('section')) {
        if (s.projectId === pid && !s.deletedAt) w.set('section', s.id, 'deletedAt', now);
      }
      for (const t of liveTasks(ctx.store)) {
        if (t.projectId === pid) w.set('task', t.id, 'deletedAt', now);
      }
    }
  });
}

export function createSection(input: {
  projectId: string;
  name: string;
  position?: Position;
}): Command<string> {
  return command('create section', (ctx, w) => {
    mustGet(ctx.store, 'project', input.projectId);
    const name = input.name.trim();
    if (!name) throw new CommandError('section name must not be empty');
    const siblings = ctx.store.all('section').filter((s) => !s.deletedAt && s.projectId === input.projectId);
    const id = ctx.newId();
    w.create('section', id, {
      projectId: input.projectId,
      name,
      sortKey: keyFor(w, 'section', siblings, input.position),
      createdAt: ctx.now.toISOString(),
    });
    return id;
  });
}

export function updateSection(id: string, patch: { name?: string }): Command {
  return command('edit section', (ctx, w) => {
    mustGet(ctx.store, 'section', id);
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new CommandError('section name must not be empty');
      w.set('section', id, 'name', name);
    }
  });
}

export function moveSection(id: string, index: number): Command {
  return command('move section', (ctx, w) => {
    const section = mustGet(ctx.store, 'section', id);
    const siblings = ctx.store
      .all('section')
      .filter((s) => !s.deletedAt && s.projectId === section.projectId);
    for (const k of placeAt(siblings, [id], index)) w.set('section', k.id, 'sortKey', k.sortKey);
  });
}

/** Soft-deletes the section and its tasks (Todoist behaviour). Undoable. */
export function deleteSection(id: string): Command {
  return command('delete section', (ctx, w) => {
    mustGet(ctx.store, 'section', id);
    const now = ctx.now.toISOString();
    w.set('section', id, 'deletedAt', now);
    for (const t of liveTasks(ctx.store)) {
      if (t.sectionId === id) w.set('task', t.id, 'deletedAt', now);
    }
  });
}

export function createLabel(input: { name: string; color?: string | null }): Command<string> {
  return command('create label', (ctx, w) => {
    const name = input.name.trim();
    if (!name) throw new CommandError('label name must not be empty');
    const labels = ctx.store.all('label').filter((l) => !l.deletedAt);
    if (labels.some((l) => l.name.toLowerCase() === name.toLowerCase())) {
      throw new CommandError(`label already exists: ${name}`);
    }
    const id = ctx.newId();
    w.create('label', id, {
      name,
      color: input.color ?? undefined,
      sortKey: keyAtEnd(labels),
      createdAt: ctx.now.toISOString(),
    });
    return id;
  });
}

export function updateLabel(id: string, patch: { name?: string; color?: string | null }): Command {
  return command('edit label', (ctx, w) => {
    mustGet(ctx.store, 'label', id);
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new CommandError('label name must not be empty');
      w.set('label', id, 'name', name);
    }
    if (patch.color !== undefined) w.set('label', id, 'color', patch.color);
  });
}

/** Soft-deletes the label and removes it from tasks. Undoable. */
export function deleteLabel(id: string): Command {
  return command('delete label', (ctx, w) => {
    mustGet(ctx.store, 'label', id);
    w.set('label', id, 'deletedAt', ctx.now.toISOString());
    for (const t of liveTasks(ctx.store)) {
      if (t.labels.includes(id))
        w.set(
          'task',
          t.id,
          'labels',
          t.labels.filter((l) => l !== id),
        );
    }
  });
}

// ---------------------------------------------------------------------------------------------
// integrity

/**
 * Fix states that are individually valid edits but conflict once merged, e.g. device A indents X
 * under Y while device B indents Y under X, or a task is added to a project that another device
 * deleted. Run after receiving remote ops.
 *
 * Deterministic and idempotent: every device that has seen the same ops computes the same fixes,
 * so their (identical-valued) repair writes still converge. Never loses user data: orphans move
 * to the Inbox or follow their parent into the trash, where restore brings them back.
 */
export function repairIntegrity(): Command<number> {
  return command('repair', (ctx, w) => {
    const store = ctx.store;
    let fixes = 0;
    const set = <K extends 'task' | 'project' | 'section'>(
      entity: K,
      id: string,
      field: keyof EntityMap[K] & string,
      value: unknown,
    ) => {
      w.set(entity, id, field, value);
      fixes++;
    };

    // Projects: one level of nesting, parents must be alive.
    const projects = () => new Map(store.all('project').map((p) => [p.id, p]));
    for (const p of [...projects().values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (p.deletedAt || !p.parentId) continue;
      const parent = projects().get(p.parentId);
      if (!parent || parent.deletedAt || parent.parentId) set('project', p.id, 'parentId', null);
    }
    for (const s of store.all('section')) {
      if (s.deletedAt) continue;
      const p = store.get('project', s.projectId);
      if (!p || p.deletedAt) set('section', s.id, 'deletedAt', p?.deletedAt ?? ctx.now.toISOString());
    }

    // Task parent links: missing parents and cycles. In a cycle the smallest id becomes a root.
    const tasks = store.all('task').sort((a, b) => (a.id < b.id ? -1 : 1));
    for (const t of tasks) {
      const cur = store.get('task', t.id);
      if (!cur?.parentId) continue;
      if (!store.get('task', cur.parentId)) {
        set('task', cur.id, 'parentId', null);
        continue;
      }
      const path: string[] = [];
      const onPath = new Set<string>();
      let node: Task | undefined = cur;
      while (node?.parentId && !onPath.has(node.id)) {
        onPath.add(node.id);
        path.push(node.id);
        node = store.get('task', node.parentId);
      }
      if (node && onPath.has(node.id)) {
        const cycle = path.slice(path.indexOf(node.id));
        const root = [...cycle].sort()[0] as string;
        set('task', root, 'parentId', null);
      }
    }

    // Scope of live tasks, roots before children so children can follow their parent.
    const depth = (t: Task) => {
      let d = 0;
      let p = t.parentId;
      while (p && d < 1000) {
        d++;
        p = store.get('task', p)?.parentId ?? null;
      }
      return d;
    };
    const live = store
      .all('task')
      .filter((t) => !t.deletedAt)
      .map((t) => ({ t, d: depth(t) }))
      .sort((a, b) => a.d - b.d || (a.t.id < b.t.id ? -1 : 1));
    for (const { t: stale } of live) {
      const t = store.get('task', stale.id) as Task;
      if (t.parentId) {
        const parent = store.get('task', t.parentId) as Task;
        if (parent.deletedAt) {
          set('task', t.id, 'deletedAt', parent.deletedAt);
          continue;
        }
        if (t.projectId !== parent.projectId) set('task', t.id, 'projectId', parent.projectId);
        if (t.sectionId !== parent.sectionId) set('task', t.id, 'sectionId', parent.sectionId);
      } else {
        const project = t.projectId ? store.get('project', t.projectId) : null;
        if (t.projectId && (!project || project.deletedAt)) {
          set('task', t.id, 'projectId', null);
          if (t.sectionId) set('task', t.id, 'sectionId', null);
        } else if (t.sectionId) {
          const section = store.get('section', t.sectionId);
          if (!section || section.deletedAt || section.projectId !== t.projectId) {
            set('task', t.id, 'sectionId', null);
          }
        }
      }
      const labels = t.labels.filter((id) => {
        const l = store.get('label', id);
        return l && !l.deletedAt;
      });
      if (labels.length !== t.labels.length) {
        w.set('task', t.id, 'labels', labels);
        fixes++;
      }
    }
    return fixes;
  });
}
