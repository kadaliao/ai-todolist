import qrcode from 'qrcode-generator';
import { normalizeServerUrl } from './client';

/**
 * Adding a device without a terminal: a device that is already connected asks the server for a
 * one-time code (`POST /api/devices/pair`, 10 minutes) and shows it as a QR code and a link,
 * `docket://pair?url=…&code=…`. The new device trades the code for its own token
 * (`POST /api/pair`). Servers before 1.4 have no pairing; their health has no `pair`.
 */

export interface DeviceInfo {
  name: string;
  createdAt: string;
  lastSeen: string | null;
  current: boolean;
}

export interface PairingLink {
  url: string;
  code: string;
}

const CODE = /^[A-Z0-9]{4}-?[A-Z0-9]{4}$/;

export function pairingLink(url: string, code: string): string {
  return `docket://pair?url=${encodeURIComponent(normalizeServerUrl(url))}&code=${encodeURIComponent(code)}`;
}

/** Reads a pairing link pasted or opened from anywhere; null when it isn't one. */
export function parsePairingLink(text: string): PairingLink | null {
  const m = text.trim().match(/^docket:\/\/pair\?(.+)$/i);
  if (!m?.[1]) return null;
  const params = new URLSearchParams(m[1]);
  const url = params.get('url');
  const code = params.get('code');
  if (!url || !code || !/^https?:\/\//i.test(url) || !isPairingCode(code)) return null;
  return { url: normalizeServerUrl(url), code: code.toUpperCase() };
}

/** A pairing code (`ABCD-EFGH`), as opposed to a device token (`dk_…`). */
export function isPairingCode(text: string): boolean {
  return CODE.test(text.trim().toUpperCase());
}

async function call(url: string, path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${normalizeServerUrl(url)}${path}`, init);
  } catch {
    throw new Error('unreachable');
  }
}

/** New device: trade a pairing code for a token. Throws `unreachable`, `invalid-code`, `unsupported`. */
export async function redeemPairing(
  url: string,
  code: string,
  name: string,
): Promise<{ token: string; name: string }> {
  const res = await call(url, '/api/pair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: code.trim(), name }),
  });
  if (res.status === 404) throw new Error('unsupported');
  if (res.status === 401 || res.status === 429) {
    // A server without pairing sends the request through its token check instead.
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error === 'invalid token' ? 'unsupported' : 'invalid-code');
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { token: string; name: string };
}

function auth(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* not json */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

/** Connected device: a fresh one-time code for another device. */
export async function createPairing(
  url: string,
  token: string,
): Promise<{ code: string; expiresAt: number }> {
  return json(await call(url, '/api/devices/pair', { method: 'POST', headers: auth(token) }));
}

export async function listDevices(url: string, token: string): Promise<DeviceInfo[]> {
  const body = await json<{ devices: DeviceInfo[] }>(
    await call(url, '/api/devices', { headers: auth(token) }),
  );
  return body.devices;
}

export async function removeDevice(url: string, token: string, name: string): Promise<void> {
  await json(
    await call(url, `/api/devices/${encodeURIComponent(name)}`, { method: 'DELETE', headers: auth(token) }),
  );
}

/** QR modules for `text`, row by row (true = dark), without the quiet zone. */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/** The dark modules as one SVG path in module units (draw it in a `0 0 n n` viewBox). */
export function qrPath(matrix: boolean[][]): string {
  let d = '';
  matrix.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x++;
        continue;
      }
      let w = 1;
      while (row[x + w]) w++;
      d += `M${x} ${y}h${w}v1h-${w}z`;
      x += w;
    }
  });
  return d;
}
