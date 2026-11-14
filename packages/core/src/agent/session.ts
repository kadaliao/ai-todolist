import type { Command, CommandContext } from '../commands';
import type { Actor, EntityType, Task } from '../model';
import { Overlay, type ReadStore } from '../overlay';
import type { Replica } from '../replica';
import type { Mutation } from '../sync/store';

/**
 * One agent turn's edits, staged on an {@link Overlay} so later tool calls read earlier ones,
 * then committed as a single transaction (one undo) or thrown away.
 */

export type TaskField =
  | 'title'
  | 'notes'
  | 'priority'
  | 'labels'
  | 'date'
  | 'time'
  | 'repeat'
  | 'project'
  | 'section'
  | 'parent'
  | 'reminders';

export type TaskChangeKind = 'added' | 'completed' | 'reopened' | 'deleted' | 'restored' | 'updated';

export type Change =
  | {
      entity: 'task';
      id: string;
      kind: TaskChangeKind;
      before: Task | null;
      after: Task | null;
      /** For `updated`: which fields changed. */
      fields: TaskField[];
    }
  | {
      entity: 'project' | 'section' | 'label';
      id: string;
      kind: 'added' | 'updated' | 'deleted';
      name: string;
    };

/** Above these, a turn waits for the user's "yes" instead of applying right away. */
export const CONFIRM_COMPLETE_AT = 3;
export const CONFIRM_UPDATE_AT = 5;

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function taskFields(a: Task, b: Task): TaskField[] {
  const out: TaskField[] = [];
  if (a.title !== b.title) out.push('title');
  if (a.notes !== b.notes) out.push('notes');
  if (a.priority !== b.priority) out.push('priority');
  if (!same([...a.labels].sort(), [...b.labels].sort())) out.push('labels');
  if (a.scheduled?.date !== b.scheduled?.date) out.push('date');
  if (a.scheduled?.time !== b.scheduled?.time) out.push('time');
  if (a.recurrence?.rule !== b.recurrence?.rule || a.recurrence?.from !== b.recurrence?.from)
    out.push('repeat');
  if (a.projectId !== b.projectId) out.push('project');
  if (a.sectionId !== b.sectionId) out.push('section');
  if (a.parentId !== b.parentId) out.push('parent');
  if (!same(a.reminders, b.reminders)) out.push('reminders');
  return out;
}

/** Differences between `base` and `after` for the touched entities, in first-touched order. */
export function diffChanges(
  base: ReadStore,
  after: ReadStore,
  touched: Iterable<{ entity: EntityType; id: string }>,
): Change[] {
  const changes: Change[] = [];
  const completedVia = new Set<string>();
  const seen = new Set<string>();
  const list = [...touched].filter(({ entity, id }) => {
    const k = `${entity}:${id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  for (const { entity, id } of list) {
    if (entity !== 'completion') continue;
    const c = after.get('completion', id);
    if (c && !base.get('completion', id)) completedVia.add(c.taskId);
  }
  for (const { entity, id } of list) {
    if (entity === 'completion') continue;
    if (entity === 'task') {
      const before = base.get('task', id) ?? null;
      const now = after.get('task', id) ?? null;
      if (!before && !now) continue;
      let kind: TaskChangeKind;
      let fields: TaskField[] = [];
      if (!before) kind = 'added';
      else if (!now || (!before.deletedAt && now.deletedAt)) kind = 'deleted';
      else if (before.deletedAt && !now.deletedAt) kind = 'restored';
      else if ((!before.completedAt && now.completedAt) || completedVia.has(id)) kind = 'completed';
      else if (before.completedAt && !now.completedAt) kind = 'reopened';
      else {
        fields = taskFields(before, now);
        if (!fields.length) continue;
        kind = 'updated';
      }
      if (kind === 'added' && now?.deletedAt) continue; // created and trashed in the same turn
      changes.push({ entity, id, kind, before, after: now, fields });
      continue;
    }
    const before = base.get(entity, id);
    const now = after.get(entity, id);
    if (!before && !now) continue;
    const kind = !before ? 'added' : !now || (!before.deletedAt && now.deletedAt) ? 'deleted' : 'updated';
    if (kind === 'updated' && same(before, now)) continue;
    changes.push({ entity, id, kind, name: (now ?? before)?.name ?? '' });
  }
  return changes;
}

/** Does this set of changes need an explicit "yes" before it applies? */
export function needsConfirmation(changes: Change[]): boolean {
  let completed = 0;
  let updated = 0;
  const completedIds = new Set(
    changes.flatMap((c) => (c.entity === 'task' && c.kind === 'completed' ? [c.id] : [])),
  );
  for (const c of changes) {
    if (c.entity !== 'task') {
      if (c.kind === 'deleted') return true;
      continue;
    }
    if (c.kind === 'deleted') return true;
    // Subtasks completed along with their parent count once, as the parent.
    if (c.kind === 'completed' && !(c.before?.parentId && completedIds.has(c.before.parentId))) completed++;
    if (c.kind === 'updated' || c.kind === 'reopened' || c.kind === 'restored') updated++;
  }
  return completed >= CONFIRM_COMPLETE_AT || updated >= CONFIRM_UPDATE_AT;
}

export class AgentSession {
  private overlay: Overlay;
  private mutations: Mutation[] = [];
  private touched: { entity: EntityType; id: string }[] = [];

  constructor(
    private readonly replica: Replica,
    readonly actor: Actor = 'ai',
  ) {
    this.overlay = new Overlay(replica.store);
  }

  /** The data as it will be after this session commits. */
  get store(): ReadStore {
    return this.overlay;
  }

  get dirty(): boolean {
    return this.mutations.length > 0;
  }

  context(): CommandContext {
    return { ...this.replica.context(this.actor), store: this.overlay };
  }

  /** Run a command against the staged state. Throws (and stages nothing) if the command fails. */
  run<R>(cmd: Command<R>): R {
    const { mutations, result } = cmd.run(this.context());
    for (const m of mutations) {
      this.overlay.write(m);
      this.mutations.push(m);
      this.touched.push({ entity: m.entity, id: m.entityId });
    }
    return result;
  }

  /** Remember the current point so a failed tool call can be rolled back as a whole. */
  checkpoint(): number {
    return this.mutations.length;
  }

  rollback(point: number): void {
    if (point >= this.mutations.length) return;
    const keep = this.mutations.slice(0, point);
    const touched = this.touched.slice(0, point);
    this.discard();
    for (const m of keep) this.overlay.write(m);
    this.mutations = keep;
    this.touched = touched;
  }

  changes(): Change[] {
    return diffChanges(this.replica.store, this.overlay, this.touched);
  }

  needsConfirmation(): boolean {
    return needsConfirmation(this.changes());
  }

  /**
   * Apply everything staged as one transaction. `dispatch` lets the server route it through its
   * hub so the ops are stored and broadcast.
   */
  commit(
    label = 'agent changes',
    dispatch: (cmd: Command<void>) => { tx: string } = (cmd) => ({
      tx: this.replica.dispatch(cmd, { actor: this.actor }).tx.tx,
    }),
  ): string | null {
    if (!this.mutations.length) return null;
    const mutations = this.mutations;
    this.discard();
    return dispatch({ label, run: () => ({ mutations, result: undefined }) }).tx;
  }

  discard(): void {
    this.overlay = new Overlay(this.replica.store);
    this.mutations = [];
    this.touched = [];
  }
}
