import { ENTITY_TYPES, Replica } from '../src';

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface TestClock {
  now: () => number;
  advance(ms: number): void;
  set(iso: string): void;
}

export function clock(iso = '2026-11-13T02:00:00Z'): TestClock {
  let t = Date.parse(iso);
  return {
    now: () => t,
    advance(ms) {
      t += ms;
    },
    set(s) {
      t = Date.parse(s);
    },
  };
}

export function replica(deviceId = 'dev1', c: TestClock = clock(), timeZone = 'Asia/Shanghai'): Replica {
  let n = 0;
  return new Replica({ deviceId, timeZone, now: c.now, newId: () => `${deviceId}_${(++n).toString(36)}` });
}

/** Materialized state of every entity type, for equality checks across replicas. */
export function materialize(r: Replica): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const t of ENTITY_TYPES) {
    out[t] = r.store
      .all(t)
      .map((e) => ({ ...e }))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
  }
  return out;
}

/** Raw cells (value + hlc) — stronger than materialized equality. */
export function cells(r: Replica): string[] {
  return r
    .snapshot()
    .cells.map((c) => JSON.stringify(c))
    .sort();
}
