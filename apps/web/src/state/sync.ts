import { checkServer, normalizeServerUrl, type Replica, SyncClient, type SyncState } from '@ai-todo/core';
import { getLocale, t } from '@ai-todo/shared';
import { create } from 'zustand';
import { getSetting, isPristine, resetForSync, setSetting } from './replica';

/** Web/desktop wrapper around the shared sync client: settings in IndexedDB, status in a store. */

export interface SyncConfig {
  url: string;
  token: string;
}

interface SyncStore {
  state: SyncState | 'off';
  message: string;
  config: SyncConfig | null;
  ai: { available: boolean; model?: string; agent?: boolean; speech?: boolean } | null;
  lastSync: number | null;
}

export const useSyncStore = create<SyncStore>(() => ({
  state: 'off',
  message: '',
  config: null,
  ai: null,
  lastSync: null,
}));

export function useSyncStatus(): { state: SyncStore['state']; label: string } {
  const { state, message } = useSyncStore();
  const label =
    state === 'error'
      ? t('settings.sync.status.error', { message })
      : t(`settings.sync.status.${state}` as 'settings.sync.status.off');
  return { state, label };
}

let client: SyncClient | null = null;

function startClient(replica: Replica, config: SyncConfig): Promise<void> {
  client?.stop();
  useSyncStore.setState({ state: 'connecting', config });
  client = new SyncClient({
    replica,
    url: config.url,
    token: config.token,
    storage: { get: getSetting, set: setSetting },
    onStatus: (s) => useSyncStore.setState({ state: s.state, message: s.message, lastSync: s.lastSync }),
    onHealth: (h) => useSyncStore.setState({ ai: h.ai ?? null }),
    isOnline: () => navigator.onLine,
    connectivity: (cb) => {
      const on = () => cb(true);
      const off = () => cb(false);
      window.addEventListener('online', on);
      window.addEventListener('offline', off);
      return () => {
        window.removeEventListener('online', on);
        window.removeEventListener('offline', off);
      };
    },
  });
  return client.start();
}

export async function initSync(replica: Replica): Promise<void> {
  const config = await getSetting<SyncConfig | null>('sync.config');
  if (config) void startClient(replica, config);
}

/** Verify a server + token, then save and start syncing. Throws with a readable message. */
export async function connectSync(replica: Replica, config: SyncConfig): Promise<void> {
  const url = normalizeServerUrl(config.url);
  let cursor: number;
  try {
    ({ cursor } = await checkServer(url, config.token));
  } catch (e) {
    const code = (e as Error).message;
    const zh = getLocale() === 'zh';
    if (code === 'invalid-token') throw new Error(zh ? '令牌无效' : 'Invalid token');
    if (code === 'unreachable') throw new Error(t('settings.sync.status.offline'));
    throw e;
  }
  await setSetting('sync.config', { url, token: config.token });
  if (cursor > 0 && (await isPristine(replica))) {
    // The account already has data and this device only has the sample tasks: start from the
    // account instead of merging a second set of samples into it.
    await resetForSync();
    location.reload();
    return;
  }
  await startClient(replica, { url, token: config.token });
}

export async function disconnectSync(): Promise<void> {
  client?.stop();
  client = null;
  useSyncStore.setState({ state: 'off', config: null, ai: null });
  await setSetting('sync.config', null);
}
