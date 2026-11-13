import type { Replica } from '../replica';
import type { Op } from './store';

/**
 * Sync client for docket-server, shared by the web/desktop app and the phone app.
 *
 *   POST /api/sync/push   { ops }            → { acked: hlc[], cursor }
 *   GET  /api/sync/pull?since=&device=       → { ops, cursor, more }
 *   WS   /api/sync/ws?token=                 ← { type: 'changed', cursor }
 *
 * Local edits are pushed shortly after they happen; the socket says when to pull; a slow poll
 * covers missed messages. Merging is the replica's job (field-level LWW), so retries and
 * duplicates are harmless. Platform specifics (storage, connectivity) are injected.
 */

export type SyncState = 'connecting' | 'synced' | 'offline' | 'error';

export interface SyncStatus {
  state: SyncState;
  message: string;
  lastSync: number | null;
}

export interface SyncStorage {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
}

export interface SyncClientOptions {
  replica: Replica;
  url: string;
  token: string;
  storage: SyncStorage;
  onStatus?: (status: SyncStatus) => void;
  onHealth?: (health: { ai?: { available: boolean; model?: string; speech?: boolean } }) => void;
  /** Subscribe to connectivity changes; return an unsubscribe function. */
  connectivity?: (onChange: (online: boolean) => void) => () => void;
  isOnline?: () => boolean;
  pollMs?: number;
}

export function normalizeServerUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export class SyncClient {
  private ws: WebSocket | null = null;
  private pushTimer: ReturnType<typeof setTimeout> | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private retry = 0;
  private cursor = 0;
  private stopped = false;
  private paused = false;
  private pulling = false;
  private pushing = false;
  private cleanups: (() => void)[] = [];
  private status: SyncStatus = { state: 'connecting', message: '', lastSync: null };

  constructor(private readonly opts: SyncClientOptions) {}

  private get base(): string {
    return normalizeServerUrl(this.opts.url);
  }

  private get cursorKey(): string {
    return `sync.cursor:${this.base}`;
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.opts.token}`, 'Content-Type': 'application/json' };
  }

  private setStatus(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch };
    this.opts.onStatus?.(this.status);
  }

  async start(): Promise<void> {
    this.cursor = (await this.opts.storage.get<number>(this.cursorKey)) ?? 0;
    this.setStatus({ state: 'connecting' });
    this.cleanups.push(this.opts.replica.subscribe(() => this.schedulePush()));
    if (this.opts.connectivity) {
      this.cleanups.push(
        this.opts.connectivity((online) => {
          if (online) {
            void this.syncNow();
            this.connectSocket();
          } else this.setStatus({ state: 'offline' });
        }),
      );
    }
    this.pollTimer = setInterval(() => void this.syncNow(), this.opts.pollMs ?? 60_000);
    await this.syncNow();
    this.connectSocket();
    void this.probe();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.pushTimer);
    clearInterval(this.pollTimer);
    for (const c of this.cleanups) c();
    this.ws?.close();
  }

  /** Mobile: close the socket while backgrounded; resume syncs right away. */
  pause(): void {
    this.paused = true;
    this.ws?.close();
  }

  resume(): void {
    this.paused = false;
    void this.syncNow();
    this.connectSocket();
  }

  private schedulePush(): void {
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => void this.push().catch(() => {}), 250);
  }

  async syncNow(): Promise<void> {
    if (this.stopped) return;
    try {
      await this.push();
      await this.pull();
      this.setStatus({ state: 'synced', message: '', lastSync: Date.now() });
      this.retry = 0;
    } catch (e) {
      this.fail(e);
    }
  }

  private fail(e: unknown): void {
    const offline = this.opts.isOnline ? !this.opts.isOnline() : false;
    if (offline || e instanceof TypeError) this.setStatus({ state: 'offline' });
    else this.setStatus({ state: 'error', message: (e as Error).message });
  }

  private async push(): Promise<void> {
    if (this.pushing || this.stopped) return;
    const ops = this.opts.replica.pending();
    if (!ops.length) return;
    this.pushing = true;
    try {
      for (let i = 0; i < ops.length; i += 500) {
        const res = await fetch(`${this.base}/api/sync/push`, {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({ ops: ops.slice(i, i + 500) }),
        });
        if (!res.ok) throw new Error(await errorText(res));
        const body = (await res.json()) as { acked: string[] };
        this.opts.replica.ack(body.acked);
      }
      this.setStatus({ state: 'synced', lastSync: Date.now() });
    } catch (e) {
      this.fail(e);
      throw e;
    } finally {
      this.pushing = false;
    }
    if (this.opts.replica.pending().length) this.schedulePush();
  }

  private async pull(): Promise<void> {
    if (this.pulling || this.stopped) return;
    this.pulling = true;
    try {
      for (;;) {
        const res = await fetch(
          `${this.base}/api/sync/pull?since=${this.cursor}&device=${encodeURIComponent(this.opts.replica.deviceId)}`,
          { headers: this.headers() },
        );
        if (!res.ok) throw new Error(await errorText(res));
        const body = (await res.json()) as { ops: Op[]; cursor: number; more: boolean };
        if (body.ops.length) this.opts.replica.receive(body.ops);
        this.cursor = body.cursor;
        await this.opts.storage.set(this.cursorKey, this.cursor);
        if (!body.more) break;
      }
    } finally {
      this.pulling = false;
    }
  }

  private connectSocket(): void {
    if (this.stopped || this.paused || (this.ws && this.ws.readyState <= 1)) return;
    const wsUrl = `${this.base.replace(/^http/, 'ws')}/api/sync/ws?token=${encodeURIComponent(this.opts.token)}`;
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
      if (this.stopped || this.paused) return;
      const delay = Math.min(30_000, 1000 * 2 ** this.retry++);
      setTimeout(() => this.connectSocket(), delay);
    };
  }

  private async probe(): Promise<void> {
    try {
      const res = await fetch(`${this.base}/api/health`, { headers: this.headers() });
      if (res.ok) this.opts.onHealth?.((await res.json()) as { ai?: { available: boolean; model?: string } });
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

/** Check a server URL + token. Resolves with the server's op cursor; throws a readable error. */
export async function checkServer(url: string, token: string): Promise<{ cursor: number }> {
  let res: Response;
  try {
    res = await fetch(`${normalizeServerUrl(url)}/api/health`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new Error('unreachable');
  }
  if (res.status === 401) throw new Error('invalid-token');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { cursor?: number };
  return { cursor: body.cursor ?? 0 };
}
