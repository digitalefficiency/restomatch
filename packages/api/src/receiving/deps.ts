/**
 * W2-05 · the ONE seam to unmerged wave-2 dependencies (orchestrator, 31.10,
 * option a). Each export has the dependency's EXACT published signature and an
 * interim body that behaves identically; integration is a one-line swap per
 * dependency (`// SWAP:`). Nothing else in W2-05 may import those packages'
 * internals: always import from here.
 */
import { createHash } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { and, auditLog, desc, eq, sql, type Database } from '@restomatch/db';

type SqlFragment = ReturnType<typeof sql>;

/* ── G-04 · receiptTruth ───────────────────────────────────────────────── */

// SWAP: G-04 #188 → export { countedLineSql, COUNT_METHODS } from '../match/receiptTruth';
export const COUNT_METHODS = ['bulk_as_ordered', 'spot_check', 'per_line'] as const;

const IDENT = /^[a-z_][a-z0-9_]*$/i;
function ident(alias: string): SqlFragment {
  if (!IDENT.test(alias)) throw new Error(`receiptTruth: bad SQL alias ${JSON.stringify(alias)}`);
  return sql.raw(`"${alias}"`);
}
const METHOD_PG = `(^|[^A-Za-z0-9_])count:(${COUNT_METHODS.join('|')})([^A-Za-z0-9_]|$)`;

/**
 * `<gl>` was counted (G-04's interim marker, verbatim): received > 0, or
 * rejected > 0, or any reject reason, or a note starting `damaged`, or a
 * `count:<method>` token. A free-text note alone on an untouched row is NOT a count.
 */
export function countedLineSql(gl = 'gr_lines'): SqlFragment {
  const t = ident(gl);
  return sql`(${t}."qty_received" > 0 OR ${t}."qty_rejected" > 0 OR ${t}."reject_reason" IS NOT NULL OR coalesce(${t}."condition_notes", '') ~ '^damaged' OR coalesce(${t}."condition_notes", '') ~ ${sql.raw(`'${METHOD_PG}'`)})`;
}

/* ── G-05 · withIdempotency ────────────────────────────────────────────── */

// SWAP: G-05 #185 → export { withIdempotency, requestHash, type IdempotencyCtx, type IdempotencyOptions } from '../lib/idempotency';
export interface IdempotencyCtx {
  db: Database;
  session: { restaurantId: string; userId: string };
}
export interface IdempotencyOptions {
  key: string;
  procedure: string;
  input?: unknown;
}

function canonicalJson(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (v instanceof Date) return v.toISOString();
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as object).sort()) {
        const x = (v as Record<string, unknown>)[k];
        if (x !== undefined) out[k] = norm(x);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(norm(value) ?? null);
}

export function requestHash(procedure: string, input: unknown): string {
  return createHash('sha256').update(canonicalJson({ procedure, input: input ?? null })).digest('hex');
}

const conflict = (m: string) => new TRPCError({ code: 'CONFLICT', message: `idempotency: ${m}` });

/**
 * G-05's audit-row interim (`action = 'idempotency.recorded'`,
 * `after.clientMutationId = key`), behaviour-identical: same key + user +
 * request → the recorded response (fn not re-run); same key, other request or
 * user → CONFLICT. Serialised per (restaurant, key) by an advisory xact lock:
 * run it inside the mutation's transaction.
 */
export async function withIdempotency<T>(ctx: IdempotencyCtx, opts: IdempotencyOptions, fn: () => Promise<T>): Promise<T> {
  const { db } = ctx;
  const { restaurantId, userId } = ctx.session;
  if (!opts.key || opts.key.length > 200) throw new TRPCError({ code: 'BAD_REQUEST', message: 'idempotency: a key of 1–200 characters is required' });
  const hash = requestHash(opts.procedure, opts.input);
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`idem:${restaurantId}:${opts.key}`}, 0))`);
  const [row] = await db
    .select({ after: auditLog.after })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.restaurantId, restaurantId),
        eq(auditLog.action, 'idempotency.recorded'),
        sql`${auditLog.after}->>'clientMutationId' = ${opts.key}`,
      ),
    )
    .orderBy(desc(auditLog.at))
    .limit(1);
  if (row) {
    const a = (row.after ?? {}) as { userId?: string | null; procedure?: string; requestHash?: string; response?: unknown };
    if ((a.userId ?? null) !== userId) throw conflict('this key was used by another user');
    if (a.procedure !== opts.procedure || a.requestHash !== hash) throw conflict('this key was used for a different request');
    return (a.response ?? null) as T;
  }
  const response = await fn();
  const stored = JSON.parse(canonicalJson(response ?? null)) as unknown;
  await db.insert(auditLog).values({
    restaurantId,
    userId,
    action: 'idempotency.recorded',
    entityType: 'idempotency',
    entityId: null,
    after: { clientMutationId: opts.key, procedure: opts.procedure, requestHash: hash, userId, response: stored },
  });
  return response;
}

/* ── G-09 · composeDocument ────────────────────────────────────────────── */

// SWAP: G-09 #190 → export { composeDocument, MAX_DOCUMENT_PAGES, type ComposeDocumentInput, type ComposedDocument } from '../documents';
export const MAX_DOCUMENT_PAGES = 20;
export interface ComposeDocumentInput {
  restaurantId: string;
  clientDocumentId: string;
  pageObjects: string[];
  deletePages?: boolean;
}
export interface ComposedDocument {
  storagePath: string;
  pageCount: number;
  sha256: string;
  created: boolean;
}

/** Until G-09 merges, multi-page capture stays hidden (`MULTI_PAGE_ENABLED`); this never runs in the product. */
export const MULTI_PAGE_ENABLED = false; // SWAP: G-09 #190 → true
export async function composeDocument(_input: ComposeDocumentInput): Promise<ComposedDocument> {
  throw new TRPCError({ code: 'NOT_IMPLEMENTED', message: 'composeDocument arrives with G-09 (#190)' });
}
