import { type Command, type CommandContext, repairIntegrity } from './commands';
import type { Actor, EntityType } from './model';
import { Overlay } from './overlay';
import { createClock, type HlcState, receive, tick } from './sync/hlc';
import { type Json, type Mutation, type Op, Store } from './sync/store';
import { todayIn } from './time';

/**
 * One device's copy of the data: the LWW store, its clock, ops not yet acknowledged by the sync
 * server (outbox), and local undo history.
 *
 * Sync protocol (transport lives in the app/server): push {@link pending} ops, call {@link ack}
 * with the ones the server stored, and feed ops pulled from the server to {@link receive}. Since
 * merging is per-field LWW, delivery order and duplicates don't matter.
 */

export interface ReplicaOptions {
  /** HLC node id; unique per device, `[A-Za-z0-9_]{1,32}`. */
  deviceId: string;
  timeZone: string;
  now?: () => number;
  newId?: () => string;
  /** Local undo/revert history length. */
  historyLimit?: number;
  /** Fix merge conflicts (cycles, orphans) after receiving ops. Default true. */
  autoRepair?: boolean;
}

export interface Transaction {
  tx: string;
  label: string;
  actor: Actor;
  ops: Op[];
}

interface InverseCell {
  entity: EntityType;
  entityId: string;
  field: string;
  /** Value before the transaction (`null` = was unset). */
  previous: Json;
  /** Value this transaction wrote (needed to redo). */
  value: Json;
  /** HLC this transaction wrote; undo skips cells someone has changed since. */
  written: string;
}

interface HistoryEntry {
  tx: string;
  label: string;
  actor: Actor;
  at: number;
  inverse: InverseCell[];
}

export interface DispatchOptions {
  actor?: Actor;
  /** Record for undo (default true). */
  undoable?: boolean;
}

export interface ReplicaSnapshot {
  version: 1;
  clock: HlcState;
  /** `[entity, entityId, field, value, hlc]` for every stored cell. */
  cells: [EntityType, string, string, Json, string][];
  outbox: Op[];
}

const defaultId = () => globalThis.crypto.randomUUID();

export class Replica {
  readonly store = new Store();
  readonly deviceId: string;
  timeZone: string;
  private clock: HlcState;
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly historyLimit: number;
  private readonly autoRepair: boolean;
  private outbox = new Map<string, Op>();
  private history: HistoryEntry[] = [];
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private listeners = new Set<() => void>();

  constructor(opts: ReplicaOptions) {
    this.deviceId = opts.deviceId;
    this.timeZone = opts.timeZone;
    this.clock = createClock(opts.deviceId);
    this.now = opts.now ?? Date.now;
    this.newId = opts.newId ?? defaultId;
    this.historyLimit = opts.historyLimit ?? 500;
    this.autoRepair = opts.autoRepair ?? true;
  }

  context(actor: Actor = 'user'): CommandContext {
    const now = new Date(this.now());
    return {
      store: this.store,
      now,
      today: todayIn(now, this.timeZone),
      timeZone: this.timeZone,
      actor,
      newId: this.newId,
    };
  }

  /** Run a command and apply it locally. Throws `CommandError` without changing anything. */
  dispatch<R>(cmd: Command<R>, opts: DispatchOptions = {}): { tx: Transaction; result: R } {
    const actor = opts.actor ?? 'user';
    const { mutations, result } = cmd.run(this.context(actor));
    const tx = this.commit(mutations, cmd.label, actor, opts.undoable ?? true);
    return { tx, result };
  }

  /** What a command would change, without applying it (for AI previews / diffs). */
  preview<R>(cmd: Command<R>, actor: Actor = 'ai'): { mutations: Mutation[]; result: R; after: Overlay } {
    const { mutations, result } = cmd.run(this.context(actor));
    const after = new Overlay(this.store);
    for (const m of mutations) after.write(m);
    return { mutations, result, after };
  }

  private commit(mutations: Mutation[], label: string, actor: Actor, undoable: boolean): Transaction {
    const tx = this.newId();
    const ops: Op[] = [];
    const inverse = new Map<string, InverseCell>();
    for (const m of mutations) {
      const cur = this.store.cell(m.entity, m.entityId, m.field);
      const key = `${m.entity}\u0000${m.entityId}\u0000${m.field}`;
      if (!inverse.has(key) && cur && JSON.stringify(cur.value) === JSON.stringify(m.value)) {
        continue; // no-op write
      }
      const [clock, hlc] = tick(this.clock, this.now());
      this.clock = clock;
      const op: Op = { ...m, hlc, tx, actor };
      const prev = inverse.get(key);
      inverse.set(key, {
        entity: m.entity,
        entityId: m.entityId,
        field: m.field,
        previous: prev ? prev.previous : (cur?.value ?? null),
        value: m.value,
        written: hlc,
      });
      this.store.apply(op);
      this.outbox.set(hlc, op);
      ops.push(op);
    }
    if (ops.length && undoable) {
      this.history.push({ tx, label, actor, at: this.now(), inverse: [...inverse.values()] });
      if (this.history.length > this.historyLimit) this.history.shift();
      this.undoStack.push(tx);
      if (this.undoStack.length > this.historyLimit) this.undoStack.shift();
      this.redoStack = [];
    }
    if (ops.length) this.emit();
    return { tx, label, actor, ops };
  }

  /**
   * Revert a transaction. Only cells still holding what that transaction wrote are restored,
   * so changes made since (here or on another device) are not clobbered.
   */
  private revertEntry(entry: HistoryEntry, label: string): { tx: Transaction; entry: HistoryEntry } | null {
    const mutations: Mutation[] = [];
    for (const c of entry.inverse) {
      if (this.store.cell(c.entity, c.entityId, c.field)?.hlc !== c.written) continue;
      mutations.push({ entity: c.entity, entityId: c.entityId, field: c.field, value: c.previous });
    }
    // Restore createdAt last so a re-created entity is complete before it reappears.
    mutations.sort((a, b) => Number(a.field === 'createdAt') - Number(b.field === 'createdAt'));
    if (!mutations.length) return null;
    const tx = this.commit(mutations, label, entry.actor, false);
    // Out-of-order reverts (and undo after remote edits) can orphan things, e.g. un-creating a
    // label another task now uses.
    if (this.autoRepair) this.repair();
    const byCell = new Map(entry.inverse.map((c) => [`${c.entity}\u0000${c.entityId}\u0000${c.field}`, c]));
    const inverse: InverseCell[] = tx.ops.map((op) => ({
      entity: op.entity,
      entityId: op.entityId,
      field: op.field,
      previous: byCell.get(`${op.entity}\u0000${op.entityId}\u0000${op.field}`)?.value ?? null,
      value: op.value,
      written: op.hlc,
    }));
    return { tx, entry: { tx: tx.tx, label: entry.label, actor: entry.actor, at: this.now(), inverse } };
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Label of the transaction {@link undo} would revert (for "Undo complete task" toasts). */
  undoLabel(): string | null {
    const tx = this.undoStack.at(-1);
    return tx ? (this.history.find((h) => h.tx === tx)?.label ?? null) : null;
  }

  undo(): Transaction | null {
    while (this.undoStack.length) {
      const id = this.undoStack.pop() as string;
      const entry = this.history.find((h) => h.tx === id);
      if (!entry) continue;
      const out = this.revertEntry(entry, `undo ${entry.label}`);
      if (!out) continue; // fully superseded by later changes; try the one before
      this.history.push(out.entry);
      this.redoStack.push(out.entry.tx);
      return out.tx;
    }
    return null;
  }

  redo(): Transaction | null {
    while (this.redoStack.length) {
      const id = this.redoStack.pop() as string;
      const entry = this.history.find((h) => h.tx === id);
      if (!entry) continue;
      const out = this.revertEntry(entry, `redo ${entry.label}`);
      if (!out) continue;
      this.history.push(out.entry);
      this.undoStack.push(out.entry.tx);
      return out.tx;
    }
    return null;
  }

  /** Revert one specific transaction (e.g. "undo what the AI did"), not just the latest. */
  revert(txId: string): Transaction | null {
    const entry = this.history.find((h) => h.tx === txId);
    if (!entry) return null;
    const out = this.revertEntry(entry, `revert ${entry.label}`);
    if (!out) return null;
    this.history.push(out.entry);
    this.undoStack = this.undoStack.filter((t) => t !== txId);
    this.undoStack.push(out.entry.tx);
    this.redoStack = [];
    return out.tx;
  }

  /** Recent undoable transactions, newest first (activity log / AI audit). */
  recent(limit = 50): { tx: string; label: string; actor: Actor; at: number }[] {
    return this.history
      .slice(-limit)
      .reverse()
      .map(({ tx, label, actor, at }) => ({ tx, label, actor, at }));
  }

  /** Apply ops from other devices. Returns how many changed local state. */
  receive(ops: readonly Op[]): number {
    let changed = 0;
    const now = this.now();
    for (const op of ops) {
      this.clock = receive(this.clock, op.hlc, now);
      if (this.store.apply(op)) changed++;
    }
    if (changed && this.autoRepair) this.repair();
    if (changed) this.emit();
    return changed;
  }

  /** Run the integrity pass (see `repairIntegrity`); its fixes sync like any other edit. */
  repair(): number {
    const { mutations, result } = repairIntegrity().run(this.context('system'));
    if (mutations.length) this.commit(mutations, 'repair', 'system', false);
    return result;
  }

  /** Local ops the server hasn't acknowledged yet, in HLC order. */
  pending(): Op[] {
    return [...this.outbox.values()].sort((a, b) => (a.hlc < b.hlc ? -1 : 1));
  }

  ack(hlcs: readonly string[]): void {
    for (const h of hlcs) this.outbox.delete(h);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  snapshot(): ReplicaSnapshot {
    const cells: ReplicaSnapshot['cells'] = [];
    for (const { entity, entityId, field, cell } of this.store.cells()) {
      cells.push([entity, entityId, field, cell.value, cell.hlc]);
    }
    return { version: 1, clock: { ...this.clock }, cells, outbox: this.pending() };
  }

  /** Restore persisted state (undo history is intentionally not persisted). */
  static fromSnapshot(snap: ReplicaSnapshot, opts: ReplicaOptions): Replica {
    if (snap.version !== 1) throw new Error(`unsupported snapshot version ${snap.version}`);
    const r = new Replica(opts);
    for (const [entity, entityId, field, value, hlc] of snap.cells) {
      r.store.apply({ entity, entityId, field, value, hlc, tx: '', actor: 'system' });
    }
    if (snap.clock.node !== opts.deviceId) throw new Error('snapshot belongs to another device');
    r.clock = { ...snap.clock };
    for (const op of snap.outbox) r.outbox.set(op.hlc, op);
    return r;
  }
}
