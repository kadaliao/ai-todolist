import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Op } from '@ai-todo/core';

/**
 * Persistence: an append-only op log (the sync server's whole job) and device tokens.
 * Tokens are stored as SHA-256 hashes; the plain token is shown once when created.
 */

export interface Device {
  name: string;
  createdAt: string;
  lastSeen: string | null;
}

export class Db {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS ops (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        hlc TEXT NOT NULL UNIQUE,
        body TEXT NOT NULL,
        received_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS devices (
        token_hash TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        last_seen TEXT
      );
      CREATE TABLE IF NOT EXISTS pairings (
        code_hash TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL,
        created_by TEXT
      );
    `);
  }

  /** Inserts ops not seen before. Returns the new ones (in input order). */
  insertOps(ops: readonly Op[]): Op[] {
    const stmt = this.db.prepare('INSERT OR IGNORE INTO ops (hlc, body, received_at) VALUES (?, ?, ?)');
    const now = new Date().toISOString();
    const inserted: Op[] = [];
    this.db.exec('BEGIN');
    try {
      for (const op of ops) {
        const r = stmt.run(op.hlc, JSON.stringify(op), now);
        if (r.changes) inserted.push(op);
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return inserted;
  }

  opsSince(since: number, limit: number): { seq: number; op: Op }[] {
    const rows = this.db
      .prepare('SELECT seq, body FROM ops WHERE seq > ? ORDER BY seq LIMIT ?')
      .all(since, limit) as {
      seq: number;
      body: string;
    }[];
    return rows.map((r) => ({ seq: Number(r.seq), op: JSON.parse(r.body) as Op }));
  }

  maxSeq(): number {
    const row = this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM ops').get() as { m: number };
    return Number(row.m);
  }

  *allOps(batch = 5000): Generator<Op[]> {
    let since = 0;
    for (;;) {
      const rows = this.opsSince(since, batch);
      if (!rows.length) return;
      yield rows.map((r) => r.op);
      since = rows.at(-1)?.seq ?? since;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // device tokens

  createToken(name: string): string {
    const token = `dk_${randomBytes(24).toString('base64url')}`;
    this.db
      .prepare('INSERT INTO devices (token_hash, name, created_at) VALUES (?, ?, ?)')
      .run(hash(token), name, new Date().toISOString());
    return token;
  }

  verifyToken(token: string): Device | null {
    if (!token) return null;
    const row = this.db
      .prepare('SELECT name, created_at, last_seen FROM devices WHERE token_hash = ?')
      .get(hash(token)) as { name: string; created_at: string; last_seen: string | null } | undefined;
    if (!row) return null;
    this.db
      .prepare('UPDATE devices SET last_seen = ? WHERE token_hash = ?')
      .run(new Date().toISOString(), hash(token));
    return { name: row.name, createdAt: row.created_at, lastSeen: row.last_seen };
  }

  listDevices(): Device[] {
    return (
      this.db.prepare('SELECT name, created_at, last_seen FROM devices ORDER BY created_at').all() as {
        name: string;
        created_at: string;
        last_seen: string | null;
      }[]
    ).map((r) => ({ name: r.name, createdAt: r.created_at, lastSeen: r.last_seen }));
  }

  revokeToken(name: string): boolean {
    return this.db.prepare('DELETE FROM devices WHERE name = ?').run(name).changes > 0;
  }

  // ---------------------------------------------------------------------------------------------
  // pairing: a short one-time code a new device trades for its own token

  /** A new pairing code (`ABCD-EFGH`), usable once until it expires. */
  createPairing(createdBy: string | null, ttlMs = PAIRING_TTL_MS): { code: string; expiresAt: number } {
    const now = Date.now();
    this.db.prepare('DELETE FROM pairings WHERE expires_at <= ?').run(now);
    const bytes = randomBytes(8);
    let raw = '';
    for (const b of bytes) raw += PAIRING_ALPHABET[b % PAIRING_ALPHABET.length];
    const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
    const expiresAt = now + ttlMs;
    this.db
      .prepare('INSERT INTO pairings (code_hash, expires_at, created_by) VALUES (?, ?, ?)')
      .run(hash(normalizePairingCode(code)), expiresAt, createdBy);
    return { code, expiresAt };
  }

  /**
   * Trades a pairing code for a token on a new device. The name is made unique (“iPhone 2”).
   * Returns null when the code is unknown, used or expired.
   */
  redeemPairing(code: string, wantedName: string): { token: string; name: string } | null {
    const key = hash(normalizePairingCode(code));
    this.db.exec('BEGIN');
    try {
      const row = this.db.prepare('SELECT expires_at FROM pairings WHERE code_hash = ?').get(key) as
        | { expires_at: number }
        | undefined;
      if (!row || Number(row.expires_at) <= Date.now()) {
        this.db.exec('COMMIT');
        return null;
      }
      this.db.prepare('DELETE FROM pairings WHERE code_hash = ?').run(key);
      const taken = new Set(this.listDevices().map((d) => d.name));
      const base = wantedName.trim().slice(0, 60) || 'Device';
      let name = base;
      for (let i = 2; taken.has(name); i++) name = `${base} ${i}`;
      const token = this.createToken(name);
      this.db.exec('COMMIT');
      return { token, name };
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  /** Consistent copy of the database while the server keeps running. */
  backup(path: string): void {
    this.db.prepare('VACUUM INTO ?').run(path);
  }

  close(): void {
    this.db.close();
  }
}

export const PAIRING_TTL_MS = 10 * 60 * 1000;
/** No 0/O, 1/I/L, 5/S, 2/Z: easy to read off one screen and type on another. */
const PAIRING_ALPHABET = 'ABCDEFGHJKMNPQRTUVWXY346789';

export function normalizePairingCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
