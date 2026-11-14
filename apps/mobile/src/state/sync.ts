import { checkServer, normalizeServerUrl, type Replica, SyncClient, type SyncState } from '@ai-todo/core';
import { t } from '@ai-todo/shared';
import { AppState } from 'react-native';
import { create } from 'zustand';
import { isPristine, resetForSync } from './replica';
import { getSetting, setSetting, syncStorage } from './storage';

export interface SyncConfig {
  url: string;
  token: string;
}

interface SyncStore {
  state: SyncState | 'off';
  message: string;
  config: SyncConfig | null;
  ai: { available: boolean; model?: string; speech?: boolean; agent?: boolean } | null;
  /** Set when local data was dropped to adopt the account; the app reloads its replica. */
  reloadNonce: number;
}

export const useSync = create<SyncStore>(() => ({
  state: 'off',
  message: '',
  config: null,
  ai: null,
  reloadNonce: 0,
}));

let client: SyncClient | null = null;

function start(replica: Replica, config: SyncConfig): void {
  client?.stop();
  useSync.setState({ state: 'connecting', config });
  client = new SyncClient({
    replica,
    url: config.url,
    token: config.token,
    storage: syncStorage,
    onStatus: (s) => useSync.setState({ state: s.state, message: s.message }),
    onHealth: (h) => useSync.setState({ ai: h.ai ?? null }),
  });
  void client.start();
}

export function initSync(replica: Replica): () => void {
  const config = getSetting<SyncConfig | null>('sync.config');
  if (config) start(replica, config);
  const sub = AppState.addEventListener('change', (s) => {
    if (s === 'active') client?.resume();
    else client?.pause();
  });
  return () => {
    sub.remove();
    client?.stop();
    client = null;
  };
}

export function syncNow(): void {
  void client?.syncNow();
}

export async function connectSync(replica: Replica, config: SyncConfig): Promise<'connected' | 'adopted'> {
  const url = normalizeServerUrl(config.url);
  let cursor: number;
  try {
    ({ cursor } = await checkServer(url, config.token));
  } catch (e) {
    const code = (e as Error).message;
    if (code === 'invalid-token') throw new Error(t('settings.sync.invalidToken'));
    if (code === 'unreachable') throw new Error(t('settings.sync.status.offline'));
    throw e;
  }
  setSetting('sync.config', { url, token: config.token });
  if (cursor > 0 && isPristine(replica)) {
    resetForSync();
    useSync.setState((s) => ({ reloadNonce: s.reloadNonce + 1 }));
    return 'adopted';
  }
  start(replica, { url, token: config.token });
  return 'connected';
}

export function disconnectSync(): void {
  client?.stop();
  client = null;
  setSetting('sync.config', null);
  useSync.setState({ state: 'off', config: null, ai: null });
}
