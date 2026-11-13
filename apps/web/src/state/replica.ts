import {
  addDays,
  createProject,
  createTask,
  createTasks,
  Replica,
  type ReplicaSnapshot,
  type Store,
  todayIn,
} from '@ai-todo/core';
import { t } from '@ai-todo/shared';
import { createStore, del, get, set } from 'idb-keyval';
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

/**
 * The device's replica: loaded from IndexedDB, saved back (debounced, and immediately when the
 * page is hidden), and exposed to React through `useQuery`, which recomputes only when
 * `store.version` changes.
 */

const db = createStore('docket', 'kv');
const SNAPSHOT = 'snapshot';
const DEVICE = 'deviceId';

export const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

function randomDeviceId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return `w${Array.from(bytes, (b) => b.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, 15)}`;
}

export async function loadReplica(): Promise<Replica> {
  let deviceId = await get<string>(DEVICE, db);
  if (!deviceId) {
    deviceId = randomDeviceId();
    await set(DEVICE, deviceId, db);
  }
  const snap = await get<ReplicaSnapshot>(SNAPSHOT, db);
  let replica: Replica;
  try {
    replica = snap
      ? Replica.fromSnapshot(snap, { deviceId, timeZone: timeZone() })
      : new Replica({ deviceId, timeZone: timeZone() });
  } catch (e) {
    console.error('snapshot unreadable, starting fresh', e);
    replica = new Replica({ deviceId, timeZone: timeZone() });
  }
  if (!snap && !(await get<boolean>(NO_SEED, db))) {
    await set(SEED_TX, seedOnboarding(replica), db);
  }
  attachPersistence(replica);
  return replica;
}

const SEED_TX = 'seedTx';
const NO_SEED = 'noSeed';

/**
 * True while this device holds nothing but the untouched onboarding samples (every local op
 * belongs to the seeding). Connecting such a device to an account that already has data should
 * adopt that data rather than merge a second copy of the samples into it.
 */
export async function isPristine(r: Replica): Promise<boolean> {
  const seed = new Set((await get<string[]>(SEED_TX, db)) ?? []);
  const pending = r.pending();
  return seed.size > 0 && pending.length > 0 && pending.every((op) => seed.has(op.tx));
}

/** Drop local data (keeping the device id) so the next load starts empty and pulls everything. */
export async function resetForSync(): Promise<void> {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  discarded = true;
  await del(SNAPSHOT, db);
  await set(NO_SEED, true, db);
}

let discarded = false;

/** A handful of tasks that teach the app by doing. Not undoable, so ⌘Z starts clean. */
function seedOnboarding(r: Replica): string[] {
  const txs: string[] = [];
  const today = todayIn(new Date(), r.timeZone);
  const { result: project, tx: t1 } = r.dispatch(
    createProject({ name: t('onboarding.project'), color: '#3d6fd9' }),
    {
      undoable: false,
    },
  );
  txs.push(t1.tx);
  const { tx: t2 } = r.dispatch(
    createTasks([
      { title: t('onboarding.1'), scheduled: { date: today }, notes: t('onboarding.notes'), priority: 3 },
      { title: t('onboarding.2'), scheduled: { date: today } },
      { title: t('onboarding.3') },
      { title: t('onboarding.4') },
    ]),
    { undoable: false },
  );
  txs.push(t2.tx);
  const { tx: t3 } = r.dispatch(
    createTask({
      title: t('onboarding.5'),
      projectId: project,
      recurrence: { rule: 'FREQ=WEEKLY;BYDAY=MO' },
      scheduled: { date: nextMonday(today), time: '09:00' },
    }),
    { undoable: false },
  );
  txs.push(t3.tx);
  return txs;
}

function nextMonday(today: string): string {
  const wd = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(today, wd === 1 ? 0 : (8 - wd) % 7 || 7);
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

async function save(r: Replica): Promise<void> {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  if (discarded) return;
  await set(SNAPSHOT, r.snapshot(), db);
}

function attachPersistence(r: Replica): void {
  r.subscribe(() => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void save(r), 400);
  });
  const flush = () => {
    if (saveTimer !== undefined) void save(r);
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', flush);
}

export async function resetAllData(): Promise<void> {
  await del(SNAPSHOT, db);
  await del(DEVICE, db);
}

export async function getSetting<T>(key: string): Promise<T | undefined> {
  return get<T>(`setting:${key}`, db);
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  await set(`setting:${key}`, value, db);
}

// ---------------------------------------------------------------------------------------------
// React bindings

export const ReplicaContext = createContext<Replica | null>(null);

export function useReplica(): Replica {
  const r = useContext(ReplicaContext);
  if (!r) throw new Error('useReplica outside ReplicaContext');
  return r;
}

export function useStoreVersion(): number {
  const r = useReplica();
  return useSyncExternalStore(
    (cb) => r.subscribe(cb),
    () => r.store.version,
  );
}

/** Derived data that recomputes when the store changes (or `deps` change). */
export function useQuery<T>(fn: (store: Store) => T, deps: readonly unknown[] = []): T {
  const r = useReplica();
  const version = useStoreVersion();
  // biome-ignore lint/correctness/useExhaustiveDependencies: version is the change signal
  return useMemo(() => fn(r.store), [version, r, ...deps]);
}

/** Today's date in the device zone; rolls over at midnight. */
export function useToday(): string {
  const [today, setToday] = useState(() => todayIn(new Date(), timeZone()));
  useEffect(() => {
    const id = setInterval(() => {
      const now = todayIn(new Date(), timeZone());
      setToday((prev) => (prev === now ? prev : now));
    }, 30_000);
    return () => clearInterval(id);
  }, []);
  return today;
}

/**
 * One editing tab at a time (two tabs writing one device's state would race). Calls `onLost`
 * if another tab takes over. Resolves `false` if another tab holds the lock.
 */
export function acquireInstanceLock(onLost: () => void, steal = false): Promise<boolean> {
  if (!('locks' in navigator)) return Promise.resolve(true);
  return new Promise((resolve) => {
    void navigator.locks
      .request('docket-instance', { ifAvailable: !steal, steal }, (lock) => {
        if (!lock) {
          resolve(false);
          return;
        }
        resolve(true);
        // Hold the lock until the tab closes or someone steals it.
        return new Promise<void>(() => {});
      })
      .catch((e: unknown) => {
        if ((e as Error).name === 'AbortError') onLost();
      });
  });
}
