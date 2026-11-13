import {
  addDays,
  createProject,
  createTask,
  createTasks,
  isoWeekday,
  Replica,
  type ReplicaSnapshot,
  type Store,
  todayIn,
} from '@ai-todo/core';
import { t } from '@ai-todo/shared';
import { randomUUID } from 'expo-crypto';
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { getSetting, readJson, removeFile, setSetting, writeJson } from './storage';

/**
 * The phone's replica: a JSON snapshot in the document directory, saved shortly after each
 * change and immediately when the app goes to the background.
 */

const SNAPSHOT = 'snapshot.json';

export const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

function newDeviceId(): string {
  return `m${randomUUID().replace(/-/g, '').slice(0, 15)}`;
}

export function loadReplica(): Replica {
  let deviceId = getSetting<string>('deviceId');
  if (!deviceId) {
    deviceId = newDeviceId();
    setSetting('deviceId', deviceId);
  }
  const opts = { deviceId, timeZone: timeZone(), newId: () => randomUUID() };
  const snap = readJson<ReplicaSnapshot>(SNAPSHOT);
  let replica: Replica;
  try {
    replica = snap ? Replica.fromSnapshot(snap, opts) : new Replica(opts);
  } catch (e) {
    console.warn('snapshot unreadable, starting fresh', e);
    replica = new Replica(opts);
  }
  if (!snap && !getSetting<boolean>('noSeed')) setSetting('seedTx', seed(replica));
  attachPersistence(replica);
  return replica;
}

function seed(r: Replica): string[] {
  const today = todayIn(new Date(), r.timeZone);
  const wd = isoWeekday(today);
  const monday = addDays(today, wd === 1 ? 0 : 8 - wd);
  const opts = { undoable: false } as const;
  const { result: project, tx: a } = r.dispatch(
    createProject({ name: t('onboarding.project'), color: '#3d6fd9' }),
    opts,
  );
  const { tx: b } = r.dispatch(
    createTasks([
      {
        title: t('onboarding.mobile1'),
        scheduled: { date: today },
        priority: 3,
        notes: t('onboarding.notes'),
      },
      { title: t('onboarding.mobile2'), scheduled: { date: today } },
      { title: t('onboarding.mobile3') },
    ]),
    opts,
  );
  const { tx: c } = r.dispatch(
    createTask({
      title: t('onboarding.5'),
      projectId: project,
      recurrence: { rule: 'FREQ=WEEKLY;BYDAY=MO' },
      scheduled: { date: monday, time: '09:00' },
    }),
    opts,
  );
  return [a.tx, b.tx, c.tx];
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let discarded = false;

function save(r: Replica): void {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  if (!discarded) writeJson(SNAPSHOT, r.snapshot());
}

function attachPersistence(r: Replica): void {
  r.subscribe(() => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => save(r), 500);
  });
  AppState.addEventListener('change', (s) => {
    if (s !== 'active' && saveTimer !== undefined) save(r);
  });
}

/** Only untouched sample tasks on this device (see the web app for the reasoning). */
export function isPristine(r: Replica): boolean {
  const seedTx = new Set(getSetting<string[]>('seedTx') ?? []);
  const pending = r.pending();
  return seedTx.size > 0 && pending.length > 0 && pending.every((op) => seedTx.has(op.tx));
}

/** Drop local data so the next load starts empty and pulls the account. */
export function resetForSync(): void {
  clearTimeout(saveTimer);
  discarded = true;
  removeFile(SNAPSHOT);
  setSetting('noSeed', true);
}

// ---------------------------------------------------------------------------------------------

export const ReplicaContext = createContext<Replica | null>(null);

export function useReplica(): Replica {
  const r = useContext(ReplicaContext);
  if (!r) throw new Error('useReplica outside ReplicaContext');
  return r;
}

export function useQuery<T>(fn: (store: Store) => T, deps: readonly unknown[] = []): T {
  const r = useReplica();
  const version = useSyncExternalStore(
    (cb) => r.subscribe(cb),
    () => r.store.version,
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: version is the change signal
  return useMemo(() => fn(r.store), [version, r, ...deps]);
}

export function useToday(): string {
  const [today, setToday] = useState(() => todayIn(new Date(), timeZone()));
  useEffect(() => {
    const tick = () =>
      setToday((prev) => {
        const now = todayIn(new Date(), timeZone());
        return prev === now ? prev : now;
      });
    const id = setInterval(tick, 30_000);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && tick());
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, []);
  return today;
}
