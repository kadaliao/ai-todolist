import type { Op, Replica } from '@ai-todo/core';
import { create } from 'zustand';
import { t } from '../lib/i18n';
import { getSetting, isPristine, resetForSync, setSetting } from './replica';

/**
 * Sync with docket-server.
 *
 *   POST /api/sync/push   { ops }            → { acked: hlc[], cursor }
 *   GET  /api/sync/pull?since=&device=       → { ops, cursor, more }
 *   WS   /api/sync/ws?token=                 ← { type: 'changed', cursor }
 *
 * Local edits are pushed shortly after they happen; the socket tells us when to pull. Merging is
 * the replica's job (field-level LWW), so retries and duplicates are harmless.
 */

export interface SyncConfig {
  url: string;
  token: string;
}

export type SyncState = 'off' | 'connecting' | 'synced' | 'offline' | 'error';

interface SyncStore {
  state: SyncState;
  message: string;
  config: SyncConfig | null;
  ai: { available: boolean; model?: string } | null;
  lastSync: number | null;
}

export const useSyncStore = create<SyncStore>(() => ({
  state: 'off',
  message: '',
  config: null,
  ai: null,
  lastSync: null,
}));

export function useSyncStatus(): { state: SyncState; label: string } {
  const { state, message } = useSyncStore();
  const label =
    state === 'error'
      ? t('settings.sync.status.error', { message })
      : t(`settings.sync.status.${state}` as 'settings.sync.status.off');
  return { state, label };
}

const set = (patch: Partial<SyncStore>) => useSyncStore.setState(patch);

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export class SyncClient {
  private ws: WebSocket | null = null;
  private pushTimer: ReturnType<typeof setTimeout> | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private retry = 0;
  private cursor = 0;
  private stopped = false;
  private pulling = false;
  private pushing = false;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly replica: Replica,
    private readonly config: SyncConfig,
  ) {}

  private get base(): string {
    return normalizeUrl(this.config.url);
  }

  private headers(): HeadersInit {
    return { Authorization: `Bearer ${this.config.token}`, 'Content-Type': 'application/json' };
  }

  async start(): Promise<void> {
    this.cursor = (await getSetting<number>(`sync.cursor:${this.base}`)) ?? 0;
    set({ state: 'connecting', config: this.config });
    this.unsubscribe = this.replica.subscribe(() => this.schedulePush());
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    this.pollTimer = setInterval(() => void this.syncNow(), 60_000);
    await this.syncNow();
    this.connectSocket();
    void this.probeAi();
  }

  stop(): void {
    this.stopped = true;
    this.unsubscribe?.();
    clearTimeout(this.pushTimer);
    clearInterval(this.pollTimer);
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    this.ws?.close();
    set({ state: 'off', config: null, ai: null });
  }

  private onOnline = () => {
    void this.syncNow();
    this.connectSocket();
  };

  private onOffline = () => set({ state: 'offline' });

  private schedulePush(): void {
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => void this.push(), 250);
  }

  async syncNow(): Promise<void> {
    if (this.stopped) return;
    try {
      await this.push();
      await this.pull();
      set({ state: 'synced', message: '', lastSync: Date.now() });
      this.retry = 0;
    } catch (e) {
      this.fail(e);
    }
  }

  private fail(e: unknown): void {
    if (!navigator.onLine || e instanceof TypeError) set({ state: 'offline' });
    else set({ state: 'error', message: (e as Error).message });
  }

  private async push(): Promise<void> {
    if (this.pushing || this.stopped) return;
    const ops = this.replica.pending();
    if (!ops.length) return;
    this.pushing = true;
    try {
      for (let i = 0; i < ops.length; i += 500) {
        const batch = ops.slice(i, i + 500);
        const res = await fetch(`${this.base}/api/sync/push`, {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({ ops: batch }),
        });
        if (!res.ok) throw new Error(await errorText(res));
        const body = (await res.json()) as { acked: string[] };
        this.replica.ack(body.acked);
      }
      set({ state: 'synced', lastSync: Date.now() });
    } catch (e) {
      this.fail(e);
      throw e;
    } finally {
      this.pushing = false;
    }
    if (this.replica.pending().length) this.schedulePush();
  }

  private async pull(): Promise<void> {
    if (this.pulling || this.stopped) return;
    this.pulling = true;
    try {
      for (;;) {
        const res = await fetch(
          `${this.base}/api/sync/pull?since=${this.cursor}&device=${encodeURIComponent(this.replica.deviceId)}`,
          { headers: this.headers() },
        );
        if (!res.ok) throw new Error(await errorText(res));
        const body = (await res.json()) as { ops: Op[]; cursor: number; more: boolean };
        if (body.ops.length) this.replica.receive(body.ops);
        this.cursor = body.cursor;
        await setSetting(`sync.cursor:${this.base}`, this.cursor);
        if (!body.more) break;
      }
    } finally {
      this.pulling = false;
    }
  }

  private connectSocket(): void {
    if (this.stopped || (this.ws && this.ws.readyState <= 1)) return;
    const wsUrl = `${this.base.replace(/^http/, 'ws')}/api/sync/ws?token=${encodeURIComponent(this.config.token)}`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      return;
    }
    this.ws = ws;
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as { type: string; cursor?: number };
        if (msg.type === 'changed' && (msg.cursor ?? Number.POSITIVE_INFINITY) > this.cursor)
          void this.syncNow();
      } catch {
        /* ignore malformed */
      }
    };
    ws.onopen = () => {
      this.retry = 0;
      void this.syncNow();
    };
    ws.onclose = () => {
      if (this.stopped) return;
      const delay = Math.min(30_000, 1000 * 2 ** this.retry++);
      setTimeout(() => this.connectSocket(), delay);
    };
  }

  private async probeAi(): Promise<void> {
    try {
      const res = await fetch(`${this.base}/api/health`, { headers: this.headers() });
      if (!res.ok) return;
      const body = (await res.json()) as { ai?: { available: boolean; model?: string } };
      set({ ai: body.ai ?? null });
    } catch {
      /* offline */
    }
  }
}

async function errorText(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

let client: SyncClient | null = null;

export async function initSync(replica: Replica): Promise<void> {
  const config = await getSetting<SyncConfig>('sync.config');
  if (config) {
    client = new SyncClient(replica, config);
    void client.start();
  }
}

/** Verify a server + token, then save and start syncing. Throws with a readable message. */
export async function connectSync(replica: Replica, config: SyncConfig): Promise<void> {
  const url = normalizeUrl(config.url);
  const res = await fetch(`${url}/api/health`, {
    headers: { Authorization: `Bearer ${config.token}` },
  }).catch(() => {
    throw new Error(t('settings.sync.status.offline'));
  });
  if (res.status === 401) throw new Error(getLocaleSafe('令牌无效', 'Invalid token'));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const health = (await res.json()) as { cursor?: number };
  client?.stop();
  await setSetting('sync.config', { url, token: config.token });
  if ((health.cursor ?? 0) > 0 && (await isPristine(replica))) {
    // The account already has data and this device only has the sample tasks: start from the
    // account instead of merging a second set of samples into it.
    await resetForSync();
    location.reload();
    return;
  }
  client = new SyncClient(replica, { url, token: config.token });
  await client.start();
}

export async function disconnectSync(): Promise<void> {
  client?.stop();
  client = null;
  await setSetting('sync.config', null);
}

export function syncConfig(): SyncConfig | null {
  return useSyncStore.getState().config;
}

function getLocaleSafe(zh: string, en: string): string {
  return document.documentElement.lang.startsWith('zh') ? zh : en;
}
