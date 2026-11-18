import {
  createPairing,
  isPairingCode,
  listDevices,
  pairingLink,
  parsePairingLink,
  qrMatrix,
  qrPath,
  redeemPairing,
  removeDevice,
} from '@ai-todo/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { Db } from '../src/db';
import { Hub } from '../src/hub';

const BASE = 'https://docket.example.com';
let db: Db;
let app: ReturnType<typeof createApp>;
let token: string;

beforeEach(() => {
  db = new Db(':memory:');
  app = createApp({ db, hub: new Hub(db, 'Asia/Shanghai'), ai: null });
  token = db.createToken('iPhone');
  // The core client calls fetch with absolute URLs; answer them in-process.
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) => app.request(input.replace(BASE, ''), init));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('pairing', () => {
  it('a connected device makes a code the new device trades for its own token', async () => {
    const { code, expiresAt } = await createPairing(BASE, token);
    expect(isPairingCode(code)).toBe(true);
    expect(expiresAt).toBeGreaterThan(Date.now() + 9 * 60_000);

    const paired = await redeemPairing(BASE, code.toLowerCase().replace('-', ''), 'Mac');
    expect(paired.name).toBe('Mac');
    expect(db.verifyToken(paired.token)?.name).toBe('Mac');

    // Once only.
    await expect(redeemPairing(BASE, code, 'Mac')).rejects.toThrow('invalid-code');
  });

  it('names are made unique', async () => {
    const a = await redeemPairing(BASE, (await createPairing(BASE, token)).code, 'iPhone');
    const b = await redeemPairing(BASE, (await createPairing(BASE, token)).code, 'iPhone');
    expect([a.name, b.name]).toEqual(['iPhone 2', 'iPhone 3']);
  });

  it('codes expire', async () => {
    const { code } = db.createPairing('test', 1000);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 2000);
    await expect(redeemPairing(BASE, code, 'Mac')).rejects.toThrow('invalid-code');
  });

  it('making a code needs a token; redeeming one does not', async () => {
    expect((await app.request('/api/devices/pair', { method: 'POST' })).status).toBe(401);
    const res = await app.request('/api/pair', {
      method: 'POST',
      body: JSON.stringify({ code: 'AAAA-BBBB', name: 'x' }),
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toMatch(/pairing code/);
  });

  it('guessing is cut off after 30 misses a minute', async () => {
    for (let i = 0; i < 30; i++)
      await app.request('/api/pair', { method: 'POST', body: JSON.stringify({ code: 'AAAA-BBBB' }) });
    const { code } = db.createPairing('test');
    const res = await app.request('/api/pair', { method: 'POST', body: JSON.stringify({ code, name: 'x' }) });
    expect(res.status).toBe(429);
  });

  it('an old server (no pairing route) reads as unsupported', async () => {
    vi.stubGlobal(
      'fetch',
      async () => new Response(JSON.stringify({ error: 'invalid token' }), { status: 401 }),
    );
    await expect(redeemPairing(BASE, 'AAAA-BBBB', 'Mac')).rejects.toThrow('unsupported');
  });

  it('health says the server pairs', async () => {
    const res = await app.request('/api/health', { headers: { Authorization: `Bearer ${token}` } });
    expect(((await res.json()) as { pair?: boolean }).pair).toBe(true);
  });
});

describe('devices', () => {
  it('lists devices, marks this one, removes others but not itself', async () => {
    await redeemPairing(BASE, (await createPairing(BASE, token)).code, 'Mac');
    const list = await listDevices(BASE, token);
    expect(list.map((d) => [d.name, d.current])).toEqual([
      ['iPhone', true],
      ['Mac', false],
    ]);
    await expect(removeDevice(BASE, token, 'iPhone')).rejects.toThrow(/device you are using/);
    await removeDevice(BASE, token, 'Mac');
    expect((await listDevices(BASE, token)).map((d) => d.name)).toEqual(['iPhone']);
    await expect(removeDevice(BASE, token, 'Mac')).rejects.toThrow('no such device');
  });
});

describe('links and QR', () => {
  it('round-trips a pairing link', () => {
    const link = pairingLink('https://docket.example.com/', 'ABCD-EFGH');
    expect(link).toBe('docket://pair?url=https%3A%2F%2Fdocket.example.com&code=ABCD-EFGH');
    expect(parsePairingLink(` ${link} `)).toEqual({ url: 'https://docket.example.com', code: 'ABCD-EFGH' });
    expect(parsePairingLink('https://docket.example.com')).toBeNull();
    expect(parsePairingLink('docket://pair?url=javascript:alert(1)&code=ABCD-EFGH')).toBeNull();
    expect(isPairingCode('dk_abcdefgh')).toBe(false);
  });

  it('draws a square QR code', () => {
    const m = qrMatrix(pairingLink('https://docket.example.com', 'ABCD-EFGH'));
    expect(m.length).toBeGreaterThanOrEqual(21);
    expect(m.every((row) => row.length === m.length)).toBe(true);
    // Finder pattern in the top-left corner.
    expect(m[0]?.slice(0, 7).every(Boolean)).toBe(true);
    expect(qrPath(m)).toMatch(/^M0 0h7v1h-7z/);
  });
});
