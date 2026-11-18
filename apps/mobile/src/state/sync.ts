import {
  checkServer,
  isPairingCode,
  normalizeServerUrl,
  type Replica,
  redeemPairing,
  SyncClient,
  type SyncState,
} from '@ai-todo/core';
import { t } from '@ai-todo/shared';
import { AppState, Platform } from 'react-native';
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
  ai: { available: boolean; model?: string; speech?: boolean; stream?: boolean; agent?: boolean } | null;
  /** The server hands out pairing codes and lists devices. */
  pair: boolean;
  /** Set when local data was dropped to adopt the account; the app reloads its replica. */
  reloadNonce: number;
}

export const useSync = create<SyncStore>(() => ({
  state: 'off',
  message: '',
  config: null,
  ai: null,
  pair: false,
  reloadNonce: 0,
}));

let client: SyncClient | null = null;

function start(replica: Replica, config: SyncConfig): void {
  client?.stop();
  // What the server could do last time, so a session that starts at launch (Siri, Control
  // Center, a widget) picks the right recognizer before the first health check answers.
  const known = getSetting<SyncStore['ai'] & { url?: string }>('sync.ai');
  useSync.setState({
    state: 'connecting',
    config,
    ...(known && known.url === config.url && !useSync.getState().ai ? { ai: known } : {}),
  });
  client = new SyncClient({
    replica,
    url: config.url,
    token: config.token,
    storage: syncStorage,
    onStatus: (s) => useSync.setState({ state: s.state, message: s.message }),
    onHealth: (h) => {
      useSync.setState({ ai: h.ai ?? null, pair: !!h.pair });
      const known = h.ai ? { ...h.ai, url: config.url } : null;
      if (JSON.stringify(known) !== JSON.stringify(getSetting('sync.ai') ?? null))
        setSetting('sync.ai', known);
    },
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

/** What this device calls itself on the server's device list. */
export function deviceName(): string {
  if (Platform.OS === 'ios') {
    const idiom = (Platform.constants as { interfaceIdiom?: string }).interfaceIdiom;
    return idiom === 'pad' ? 'iPad' : 'iPhone';
  }
  if (Platform.OS === 'android') return (Platform.constants as { Model?: string }).Model || 'Android';
  return 'Web';
}

/**
 * Connect with a device token, or with a pairing code (`ABCD-EFGH`) that is traded for one first.
 * Returns the name the server gave this device when it paired.
 */
export async function connectSync(
  replica: Replica,
  config: SyncConfig,
): Promise<{ result: 'connected' | 'adopted'; name?: string }> {
  const url = normalizeServerUrl(config.url);
  let name: string | undefined;
  if (isPairingCode(config.token)) {
    try {
      const paired = await redeemPairing(url, config.token, deviceName());
      config = { url, token: paired.token };
      name = paired.name;
    } catch (e) {
      const code = (e as Error).message;
      if (code === 'invalid-code') throw new Error(t('settings.sync.invalidCode'));
      if (code === 'unsupported') throw new Error(t('settings.sync.noPairing'));
      if (code === 'unreachable') throw new Error(t('settings.sync.status.offline'));
      throw e;
    }
  }
  const result = await connectWithToken(replica, { url, token: config.token });
  return { result, ...(name ? { name } : {}) };
}

async function connectWithToken(replica: Replica, config: SyncConfig): Promise<'connected' | 'adopted'> {
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
  useSync.setState({ state: 'off', config: null, ai: null, pair: false });
}
