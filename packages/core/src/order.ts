import { generateJitteredKeyBetween, generateNJitteredKeysBetween } from 'fractional-indexing-jittered';

/**
 * Manual ordering with fractional index keys.
 *
 * Each item stores its own `sortKey`; moving an item rewrites only that item's key. Order is
 * `(sortKey, id)`, so even two devices inserting at the same spot concurrently (same key) still
 * sort identically everywhere. Jitter makes such collisions unlikely in the first place.
 *
 * Never store order as an id array on the parent: concurrent edits to that array diverge
 * (Super Productivity's fuzz tests diverged in 71 of 120 seeds).
 */

export interface Ordered {
  id: string;
  sortKey: string;
}

export function compareOrder(a: Ordered, b: Ordered): number {
  if (a.sortKey !== b.sortKey) return a.sortKey < b.sortKey ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function sortByOrder<T extends Ordered>(items: readonly T[]): T[] {
  return [...items].sort(compareOrder);
}

export function keyBetween(lower: string | null, upper: string | null): string {
  return generateJitteredKeyBetween(lower, upper);
}

export interface KeyAssignment {
  id: string;
  sortKey: string;
}

/**
 * Keys needed to place `movingIds` (in that order) at `index` among `siblings` (the target list
 * *without* the moving items, any order). Usually returns one key per moving item; when the
 * neighbours share a key (a concurrent-insert collision) it also re-keys the colliding run so the
 * new position is representable.
 */
export function placeAt(
  siblings: readonly Ordered[],
  movingIds: readonly string[],
  index: number,
): KeyAssignment[] {
  const moving = new Set(movingIds);
  const list = sortByOrder(siblings.filter((s) => !moving.has(s.id)));
  const at = Math.max(0, Math.min(index, list.length));
  let lo = at;
  let hi = at;
  // Widen the window over neighbours with identical keys; they get re-keyed along with the move.
  const lowerKey = list[at - 1]?.sortKey;
  const upperKey = list[at]?.sortKey;
  if (lowerKey !== undefined && lowerKey === upperKey) {
    while (lo > 0 && list[lo - 1]?.sortKey === lowerKey) lo--;
    while (hi < list.length && list[hi]?.sortKey === lowerKey) hi++;
  }
  const before = list.slice(lo, at).map((s) => s.id);
  const after = list.slice(at, hi).map((s) => s.id);
  const ids = [...before, ...movingIds, ...after];
  const keys = generateNJitteredKeysBetween(
    list[lo - 1]?.sortKey ?? null,
    list[hi]?.sortKey ?? null,
    ids.length,
  );
  return ids.map((id, i) => ({ id, sortKey: keys[i] as string }));
}

/** Key for appending after every item in `siblings`. */
export function keyAtEnd(siblings: readonly Ordered[]): string {
  const last = sortByOrder(siblings).at(-1);
  return keyBetween(last?.sortKey ?? null, null);
}

/** Key for inserting before every item in `siblings`. */
export function keyAtStart(siblings: readonly Ordered[]): string {
  const first = sortByOrder(siblings)[0];
  return keyBetween(null, first?.sortKey ?? null);
}
