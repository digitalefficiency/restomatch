import { createHash } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { and, auditLog, desc, eq, sql, type Database } from '@restomatch/db';
import { recordAudit } from '../audit';
import { hasTable, rowsOf } from '../lifecycle/capabilities';
import { canonicalJson } from '../lifecycle/kernel';

/**
 * Client-mutation replay (G-05; mobile-field-02, receiving-02, orders-07).
 *
 *   withIdempotency(ctx, { key, procedure, input }, fn)
 *
 *   - first call with `key` → runs `fn` and records its response;
 *   - same key + same user + same request hash → the RECORDED response, `fn`
 *     does not run again;
 *   - same key with a different request (hash, procedure or user) → CONFLICT.
 *
 * Storage: G-03's `idempotency_keys` once deployed (≥ 10.11); until then one
 * append-only `audit_log` row per key (`action = 'idempotency.recorded'`,
 * `after.clientMutationId = key`). Both paths take a transaction-scoped
 * advisory lock on (restaurant, key), so two concurrent replays serialise:
 * the second waits and then returns the first one's response.
 *
 * The response must be JSON-serialisable; a replay returns it as parsed JSON
 * (a Date comes back as an ISO string). Run inside the tenant transaction
 * (`ctx.db`), so the record commits or rolls back with the mutation.
 */

export interface IdempotencyCtx {
  db: Database;
  session: { restaurantId: string; userId: string };
}

export interface IdempotencyOptions {
  /** The client mutation id (a UUID the client generates once per user intent). */
  key: string;
  /** The procedure path, e.g. `receiving.confirmLine`. */
  procedure: string;
  /** The request input that the hash covers (omit only for input-less mutations). */
  input?: unknown;
}

export function requestHash(procedure: string, input: unknown): string {
  return createHash('sha256').update(canonicalJson({ procedure, input: input ?? null })).digest('hex');
}

interface Recorded {
  userId: string | null;
  procedure: string;
  requestHash: string;
  response: unknown;
}

function conflict(message: string): TRPCError {
  return new TRPCError({ code: 'CONFLICT', message: `idempotency: ${message}` });
}

async function findInterim(db: Database, restaurantId: string, key: string): Promise<Recorded | null> {
  const [row] = await db
    .select({ after: auditLog.after })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.restaurantId, restaurantId),
        eq(auditLog.action, 'idempotency.recorded'),
        sql`${auditLog.after}->>'clientMutationId' = ${key}`,
      ),
    )
    .orderBy(desc(auditLog.at))
    .limit(1);
  if (!row) return null;
  const a = (row.after ?? {}) as Partial<Recorded>;
  return { userId: a.userId ?? null, procedure: a.procedure ?? '', requestHash: a.requestHash ?? '', response: a.response ?? null };
}

async function findTable(db: Database, restaurantId: string, key: string): Promise<Recorded | null> {
  const [r] = rowsOf(
    await db.execute(sql`
      SELECT user_id, procedure, request_hash, response FROM idempotency_keys
      WHERE restaurant_id = ${restaurantId}::uuid AND key = ${key}
      LIMIT 1
    `),
  );
  if (!r) return null;
  return {
    userId: (r.user_id as string | null) ?? null,
    procedure: String(r.procedure ?? ''),
    requestHash: String(r.request_hash ?? ''),
    response: r.response ?? null,
  };
}

/** Which store is live: G-03's table, or the audit-row interim. */
export async function idempotencyStore(db: Database): Promise<'table' | 'audit'> {
  return (await hasTable(db, 'idempotency_keys')) ? 'table' : 'audit';
}

export async function withIdempotency<T>(ctx: IdempotencyCtx, opts: IdempotencyOptions, fn: () => Promise<T>): Promise<T> {
  const { db } = ctx;
  const { restaurantId, userId } = ctx.session;
  if (!opts.key || opts.key.length > 200) throw new TRPCError({ code: 'BAD_REQUEST', message: 'idempotency: a key of 1–200 characters is required' });
  const hash = requestHash(opts.procedure, opts.input);
  const store = await idempotencyStore(db);

  // Serialise concurrent requests carrying the same key (released at commit/rollback).
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`idem:${restaurantId}:${opts.key}`}, 0))`);

  const seen = store === 'table' ? await findTable(db, restaurantId, opts.key) : await findInterim(db, restaurantId, opts.key);
  if (seen) {
    if (seen.userId !== userId) throw conflict('this key was used by another user');
    if (seen.procedure !== opts.procedure || seen.requestHash !== hash) throw conflict('this key was used for a different request');
    return seen.response as T;
  }

  const response = await fn();
  const stored = JSON.parse(canonicalJson(response ?? null)) as unknown;
  if (store === 'table') {
    await db.execute(sql`
      INSERT INTO idempotency_keys (restaurant_id, key, procedure, user_id, request_hash, response)
      VALUES (${restaurantId}::uuid, ${opts.key}, ${opts.procedure}, ${userId}::uuid, ${hash}, ${JSON.stringify(stored)}::jsonb)
    `);
  } else {
    await recordAudit(db, {
      restaurantId,
      userId,
      action: 'idempotency.recorded',
      entityType: 'idempotency',
      entityId: null,
      after: { clientMutationId: opts.key, procedure: opts.procedure, requestHash: hash, userId, response: stored },
    });
  }
  return response;
}
