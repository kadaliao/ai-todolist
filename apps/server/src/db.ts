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

  close(): void {
    this.db.close();
  }
}

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
