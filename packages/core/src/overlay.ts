import { DEFAULTS, ENTITY_TYPES, type EntityMap, type EntityType } from './model';
import type { Json, Mutation } from './sync/store';

/** Read-only view of entities, implemented by the real store and by {@link Overlay}. */
export interface ReadStore {
  get<K extends EntityType>(entity: K, id: string): EntityMap[K] | undefined;
  all<K extends EntityType>(entity: K): EntityMap[K][];
}

/**
 * Pending mutations layered over a store, so a command (or a batch of commands) reads its own
 * writes without touching real state. Also used to preview what a command *would* do (AI diffs).
 */
export class Overlay implements ReadStore {
  private readonly staged = new Map<EntityType, Map<string, Map<string, Json>>>(
    ENTITY_TYPES.map((t) => [t, new Map()]),
  );

  constructor(private readonly base: ReadStore) {}

  write(m: Mutation): void {
    const table = this.staged.get(m.entity) as Map<string, Map<string, Json>>;
    let row = table.get(m.entityId);
    if (!row) {
      row = new Map();
      table.set(m.entityId, row);
    }
    row.set(m.field, m.value);
  }

  get<K extends EntityType>(entity: K, id: string): EntityMap[K] | undefined {
    const base = this.base.get(entity, id);
    const row = this.staged.get(entity)?.get(id);
    if (!row) return base;
    const createdAt = row.has('createdAt') ? row.get('createdAt') : base?.createdAt;
    if (createdAt === null || createdAt === undefined) return undefined;
    const defaults = DEFAULTS[entity] as Record<string, unknown>;
    const obj: Record<string, unknown> = base ? { ...base } : { ...structuredClone(defaults), id };
    for (const [field, value] of row) {
      obj[field] = value === null ? structuredClone(defaults[field] ?? null) : structuredClone(value);
    }
    return obj as unknown as EntityMap[K];
  }

  all<K extends EntityType>(entity: K): EntityMap[K][] {
    const out: EntityMap[K][] = [];
    const seen = new Set<string>();
    for (const e of this.base.all(entity)) {
      seen.add(e.id);
      const v = this.get(entity, e.id);
      if (v) out.push(v);
    }
    for (const id of this.staged.get(entity)?.keys() ?? []) {
      if (seen.has(id)) continue;
      const v = this.get(entity, id);
      if (v) out.push(v);
    }
    return out;
  }
}
