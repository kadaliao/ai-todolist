import { type Actor, DEFAULTS, ENTITY_TYPES, type EntityMap, type EntityType } from '../model';
import type { Hlc } from './hlc';

/**
 * Field-level last-writer-wins store.
 *
 * Every write is an {@link Op} setting one field of one entity. A field's value is the one with
 * the greatest HLC, so the materialized state is a pure function of the *set* of ops: applying
 * them in any order, any number of times, gives the same result on every device. That property
 * is what the convergence fuzz test checks.
 *
 * `value: null` means "unset". An entity exists while its `createdAt` field is set, so undoing a
 * creation is just writing `createdAt = null`.
 */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface Op {
  /** Unique per op (HLC node + counter); doubles as the op id. */
  hlc: Hlc;
  entity: EntityType;
  entityId: string;
  field: string;
  value: Json;
  /** Transaction id: ops written by one command share it, undo works per transaction. */
  tx: string;
  actor: Actor;
}

/** An op before it is stamped by a replica. */
export interface Mutation {
  entity: EntityType;
  entityId: string;
  field: string;
  value: Json;
}

export interface Cell {
  value: Json;
  hlc: Hlc;
}

type Row = Map<string, Cell>;

/** Cached entities are shared between readers, so nested arrays/objects must be immutable too. */
function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const child of Object.values(v)) deepFreeze(child);
  }
  return v;
}

export class Store {
  private readonly tables = new Map<EntityType, Map<string, Row>>(ENTITY_TYPES.map((t) => [t, new Map()]));
  private readonly cache = new Map<EntityType, Map<string, unknown>>(ENTITY_TYPES.map((t) => [t, new Map()]));
  /** Bumped on every effective change; cheap change detection for UI subscriptions. */
  version = 0;

  /** Applies an op. Returns `true` if it changed the stored state. */
  apply(op: Op): boolean {
    const table = this.table(op.entity);
    let row = table.get(op.entityId);
    if (!row) {
      row = new Map();
      table.set(op.entityId, row);
    }
    const current = row.get(op.field);
    if (current && current.hlc >= op.hlc) return false;
    row.set(op.field, { value: op.value, hlc: op.hlc });
    this.cache.get(op.entity)?.delete(op.entityId);
    this.version++;
    return true;
  }

  cell(entity: EntityType, id: string, field: string): Cell | undefined {
    return this.tables.get(entity)?.get(id)?.get(field);
  }

  /** Materialized entity with defaults applied, or `undefined` if it doesn't exist. */
  get<K extends EntityType>(entity: K, id: string): EntityMap[K] | undefined {
    const cache = this.cache.get(entity) as Map<string, EntityMap[K] | null>;
    const hit = cache.get(id);
    if (hit !== undefined) return hit ?? undefined;
    const row = this.tables.get(entity)?.get(id);
    const created = row?.get('createdAt')?.value;
    if (!row || created === null || created === undefined) {
      cache.set(id, null);
      return undefined;
    }
    const obj: Record<string, unknown> = { ...structuredClone(DEFAULTS[entity]), id };
    for (const [field, c] of row) {
      if (c.value !== null) obj[field] = structuredClone(c.value);
    }
    const value = deepFreeze(obj) as unknown as EntityMap[K];
    cache.set(id, value);
    return value;
  }

  /** All existing entities of a type (including soft-deleted ones). */
  all<K extends EntityType>(entity: K): EntityMap[K][] {
    const out: EntityMap[K][] = [];
    for (const id of this.table(entity).keys()) {
      const e = this.get(entity, id);
      if (e) out.push(e);
    }
    return out;
  }

  /** Every cell as an op-like record, for snapshots and state comparison in tests. */
  *cells(): Generator<{ entity: EntityType; entityId: string; field: string; cell: Cell }> {
    for (const [entity, table] of this.tables) {
      for (const [entityId, row] of table) {
        for (const [field, cell] of row) yield { entity, entityId, field, cell };
      }
    }
  }

  private table(entity: EntityType): Map<string, Row> {
    const t = this.tables.get(entity);
    if (!t) throw new Error(`unknown entity type: ${entity}`);
    return t;
  }
}
