import {
  checkServer,
  isPairingCode,
  normalizeServerUrl,
  type Replica,
  redeemPairing,
  SyncClient,
  type SyncState,
} from '@ai-todo/core';
import { getLocale, t } from '@ai-todo/shared';
import { create } from 'zustand';
import { isTauri } from '../platform';
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
  ai: { available: boolean; model?: string; agent?: boolean; speech?: boolean; stream?: boolean } | null;
  /** The server hands out pairing codes and lists devices. */
  pair: boolean;
  lastSync: number | null;
}

export const useSyncStore = create<SyncStore>(() => ({
  state: 'off',
  message: '',
  config: null,
  ai: null,
  pair: false,
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
  // What the server could do last time, so a session started right away (push to talk at
  // launch) picks the right recognizer before the first health check answers.
  let known: (SyncStore['ai'] & { url?: string }) | null = null;
  try {
    known = JSON.parse(localStorage.getItem('docket.serverAi') ?? 'null');
  } catch {
    known = null;
  }
  useSyncStore.setState({
    state: 'connecting',
    config,
    ...(known && known.url === config.url && !useSyncStore.getState().ai ? { ai: known } : {}),
  });
  client = new SyncClient({
    replica,
    url: config.url,
    token: config.token,
    storage: { get: getSetting, set: setSetting },
    onStatus: (s) => useSyncStore.setState({ state: s.state, message: s.message, lastSync: s.lastSync }),
    onHealth: (h) => {
      useSyncStore.setState({ ai: h.ai ?? null, pair: !!h.pair });
      try {
        localStorage.setItem('docket.serverAi', JSON.stringify(h.ai ? { ...h.ai, url: config.url } : null));
      } catch {
        /* storage full or blocked */
      }
    },
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

/** What this device calls itself on the server's device list. */
function deviceName(): string {
  if (isTauri) return 'Mac';
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : '';
  return browser ? `Web · ${browser}` : 'Web';
}

/**
 * Verify a server + token (or trade a pairing code for one), then save and start syncing.
 * Throws with a readable message.
 */
export async function connectSync(replica: Replica, config: SyncConfig): Promise<void> {
  const url = normalizeServerUrl(config.url);
  if (isPairingCode(config.token)) {
    try {
      config = { url, token: (await redeemPairing(url, config.token, deviceName())).token };
    } catch (e) {
      const code = (e as Error).message;
      if (code === 'invalid-code') throw new Error(t('settings.sync.invalidCode'));
      if (code === 'unsupported') throw new Error(t('settings.sync.noPairing'));
      if (code === 'unreachable') throw new Error(t('settings.sync.status.offline'));
      throw e;
    }
  }
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
  useSyncStore.setState({ state: 'off', config: null, ai: null, pair: false });
  await setSetting('sync.config', null);
}
