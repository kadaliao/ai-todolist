import { type Actor, type Command, ENTITY_TYPES, type Op, Replica } from '@ai-todo/core';
import { z } from 'zod';
import type { Db } from './db';

/**
 * The server's view of the data: every op ever pushed is stored, and also applied to a server
 * replica so MCP tools can run the same commands the apps do. Ops the server itself creates
 * (MCP edits) go into the same log and reach devices like any other device's ops.
 */

const opSchema = z.object({
  hlc: z.string().regex(/^[0-9a-z]{9}-[0-9a-z]{4}-[A-Za-z0-9_]{1,32}$/),
  entity: z.enum(ENTITY_TYPES as [string, ...string[]]),
  entityId: z.string().min(1).max(100),
  field: z.string().min(1).max(64),
  value: z.unknown(),
  tx: z.string().max(100),
  actor: z.enum(['user', 'ai', 'mcp', 'system']),
});

export const pushSchema = z.object({ ops: z.array(opSchema).max(2000) });

export class Hub {
  readonly replica: Replica;
  private listeners = new Set<(cursor: number) => void>();

  constructor(
    private readonly db: Db,
    timeZone: string,
  ) {
    this.replica = new Replica({ deviceId: 'server', timeZone, autoRepair: false, historyLimit: 200 });
    for (const batch of db.allOps()) this.replica.receive(batch);
  }

  /** Store and apply ops from a device. Returns all hlcs (duplicates are acked too). */
  push(ops: Op[]): { acked: string[]; cursor: number } {
    const fresh = this.db.insertOps(ops);
    if (fresh.length) this.replica.receive(fresh);
    const cursor = this.db.maxSeq();
    if (fresh.length) this.emit(cursor);
    return { acked: ops.map((o) => o.hlc), cursor };
  }

  pull(since: number, limit: number, excludeNode?: string): { ops: Op[]; cursor: number; more: boolean } {
    const rows = this.db.opsSince(since, limit);
    const cursor = rows.at(-1)?.seq ?? since;
    const suffix = excludeNode ? `-${excludeNode}` : null;
    return {
      ops: rows.map((r) => r.op).filter((op) => !suffix || !op.hlc.endsWith(suffix)),
      cursor,
      more: rows.length === limit,
    };
  }

  /** Run a command on the server replica (MCP) and publish its ops. */
  dispatch<R>(cmd: Command<R>, actor: Actor = 'mcp'): { result: R; tx: string } {
    const { result, tx } = this.replica.dispatch(cmd, { actor });
    this.flush();
    return { result, tx: tx.tx };
  }

  revert(txId?: string): boolean {
    const target = txId ?? this.replica.recent(50).find((h) => h.actor === 'mcp')?.tx;
    if (!target) return false;
    const tx = this.replica.revert(target);
    this.flush();
    return !!tx;
  }

  private flush(): void {
    const pending = this.replica.pending();
    if (!pending.length) return;
    this.db.insertOps(pending);
    this.replica.ack(pending.map((o) => o.hlc));
    this.emit(this.db.maxSeq());
  }

  onChange(fn: (cursor: number) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(cursor: number): void {
    for (const l of this.listeners) l(cursor);
  }
}
