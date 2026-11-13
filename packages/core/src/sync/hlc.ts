/**
 * Hybrid Logical Clock (Kulkarni et al.). Timestamps are fixed-width strings so plain string
 * comparison gives a total order:
 *
 *   `<wall ms, base36, 9 chars>-<counter, base36, 4 chars>-<node id>`
 *
 * The node id makes timestamps from different devices unique, which is what lets field-level
 * last-writer-wins merge deterministically.
 */

export type Hlc = string;

export interface HlcState {
  wall: number;
  counter: number;
  node: string;
}

const WALL_WIDTH = 9;
const COUNTER_WIDTH = 4;
const MAX_COUNTER = 36 ** COUNTER_WIDTH - 1;
/** Remote clocks further ahead than this are rejected rather than dragging ours forward. */
export const MAX_DRIFT_MS = 24 * 60 * 60 * 1000;

const NODE_RE = /^[A-Za-z0-9_]{1,32}$/;

export function createClock(node: string, wall = 0): HlcState {
  if (!NODE_RE.test(node)) throw new Error(`invalid HLC node id: ${node}`);
  return { wall, counter: 0, node };
}

export function encode(s: HlcState): Hlc {
  return `${s.wall.toString(36).padStart(WALL_WIDTH, '0')}-${s.counter
    .toString(36)
    .padStart(COUNTER_WIDTH, '0')}-${s.node}`;
}

export function decode(h: Hlc): HlcState {
  const [wall, counter, node] = h.split('-');
  if (wall === undefined || counter === undefined || node === undefined) {
    throw new Error(`malformed HLC: ${h}`);
  }
  return { wall: Number.parseInt(wall, 36), counter: Number.parseInt(counter, 36), node };
}

function bump(s: HlcState, wall: number, counter: number): HlcState {
  if (counter > MAX_COUNTER) throw new Error('HLC counter overflow');
  return { wall, counter, node: s.node };
}

/** Advance for a local event. Returns the new state and the timestamp to stamp the event with. */
export function tick(s: HlcState, nowMs: number): [HlcState, Hlc] {
  const next = nowMs > s.wall ? bump(s, nowMs, 0) : bump(s, s.wall, s.counter + 1);
  return [next, encode(next)];
}

/** Merge a remote timestamp so later local events sort after it. */
export function receive(s: HlcState, remote: Hlc, nowMs: number): HlcState {
  const r = decode(remote);
  if (r.wall - nowMs > MAX_DRIFT_MS) {
    throw new Error(`remote clock drift too large (${r.wall - nowMs}ms ahead)`);
  }
  const wall = Math.max(s.wall, r.wall, nowMs);
  if (wall === s.wall && wall === r.wall) return bump(s, wall, Math.max(s.counter, r.counter) + 1);
  if (wall === s.wall) return bump(s, wall, s.counter + 1);
  if (wall === r.wall) return bump(s, wall, r.counter + 1);
  return bump(s, wall, 0);
}

export function nodeOf(h: Hlc): string {
  return h.slice(WALL_WIDTH + COUNTER_WIDTH + 2);
}
