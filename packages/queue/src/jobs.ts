import postgres from 'postgres';

/**
 * The Postgres work queue (0061 job_queue) — replaces BullMQ/Redis.
 *
 * Producers INSERT (index.ts); the worker claims with one statement:
 *   UPDATE job_queue SET status='active' … WHERE id = (SELECT id … FOR UPDATE SKIP LOCKED LIMIT 1)
 * which is atomic on its own (no explicit transaction), so it works through the
 * Supabase pooler in transaction mode and two workers can never claim the same row.
 *
 * Lifecycle: queued → active → done | (attempts left: queued again after a
 * backoff) | failed. An active row whose lock is not renewed is "stalled"
 * (crashed worker) and recoverStalled() puts it back.
 */

export type Sql = postgres.Sql;
export type JobStatus = 'queued' | 'active' | 'done' | 'failed';

export interface JobRow<T = unknown> {
  id: string;
  queue: string;
  payload: T;
  restaurantId: string | null;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  runAt: Date;
  lockedAt: Date | null;
  lockedBy: string | null;
  lastError: string | null;
  /** The processor's return value (JSON), like BullMQ's returnvalue. */
  result: unknown;
  dedupeKey: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}

export interface EnqueueOptions {
  restaurantId?: string | null;
  /** At most one job per (queue, dedupeKey) — ever, until the row is cleaned up. */
  dedupeKey?: string;
  runAt?: Date;
  maxAttempts?: number;
}

/** The connection the queue uses: QUEUE_DATABASE_URL, else the owner DATABASE_URL. */
export function queueDbUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const url = env.QUEUE_DATABASE_URL || env.DATABASE_URL;
  return url && url.length > 0 ? url : null;
}

// One small, lazy pool per process, URL and size. Web: max 1 per serverless
// instance (many instances share the Supabase pooler); the worker asks for a few
// more for its claim loops. globalThis so `next dev` reloads don't leak pools.
const memo = globalThis as unknown as { __restomatchQueueSql?: Map<string, Sql> };

export function queueSql(url: string, max = 1, idleTimeoutSec = 20): Sql {
  memo.__restomatchQueueSql ??= new Map();
  const key = `${max}|${idleTimeoutSec}|${url}`;
  let sql = memo.__restomatchQueueSql.get(key);
  if (!sql) {
    sql = postgres(url, {
      max,
      prepare: false, // Supabase pooler (transaction mode)
      idle_timeout: idleTimeoutSec,
      connect_timeout: 5,
      onnotice: () => {},
    });
    memo.__restomatchQueueSql.set(key, sql);
  }
  return sql;
}

export async function closeQueueSql(): Promise<void> {
  const pools = memo.__restomatchQueueSql;
  if (!pools) return;
  memo.__restomatchQueueSql = new Map();
  await Promise.all([...pools.values()].map((s) => s.end({ timeout: 5 })));
}

interface RawRow {
  id: string;
  queue: string;
  payload: unknown;
  restaurant_id: string | null;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  run_at: Date;
  locked_at: Date | null;
  locked_by: string | null;
  last_error: string | null;
  result: unknown;
  dedupe_key: string | null;
  created_at: Date;
  finished_at: Date | null;
}

function toJob<T>(r: RawRow): JobRow<T> {
  return {
    id: String(r.id),
    queue: r.queue,
    payload: r.payload as T,
    restaurantId: r.restaurant_id,
    status: r.status,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    runAt: r.run_at,
    lockedAt: r.locked_at,
    lockedBy: r.locked_by,
    lastError: r.last_error,
    result: r.result ?? null,
    dedupeKey: r.dedupe_key,
    createdAt: r.created_at,
    finishedAt: r.finished_at,
  };
}

/** NOTIFY channel a new job is announced on (payload: the queue name). */
export const JOB_CHANNEL = 'job_queue';

/**
 * Insert a job. Returns null when a job with the same (queue, dedupeKey) exists.
 * The same statement NOTIFYs JOB_CHANNEL (delivered on commit; works through the
 * transaction pooler), so a LISTENing worker picks the job up at once instead of
 * waiting for its next idle poll.
 */
export async function insertJob(sql: Sql, queue: string, payload: unknown, opts: EnqueueOptions = {}): Promise<{ id: string } | null> {
  const rows = await sql<Array<{ id: string }>>`
    WITH ins AS (
      INSERT INTO job_queue (queue, payload, restaurant_id, dedupe_key, run_at, max_attempts)
      VALUES (
        ${queue},
        ${sql.json(payload as postgres.JSONValue)},
        ${opts.restaurantId ?? null},
        ${opts.dedupeKey ?? null},
        ${opts.runAt ?? new Date()},
        ${opts.maxAttempts ?? 1}
      )
      ON CONFLICT (queue, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
      RETURNING id, queue
    )
    SELECT id, pg_notify(${JOB_CHANNEL}, queue) FROM ins`;
  return rows[0] ? { id: String(rows[0].id) } : null;
}

/** Claim the next runnable job of `queue` for `workerId`, or null. */
export async function claimJob<T = unknown>(sql: Sql, queue: string, workerId: string): Promise<JobRow<T> | null> {
  return claimAny<T>(sql, [queue], workerId);
}

/**
 * Claim the next runnable job of ANY of `queues` (oldest run_at first) — one
 * query per poll for the whole worker, however many queues it serves.
 */
export async function claimAny<T = unknown>(sql: Sql, queues: string[], workerId: string): Promise<JobRow<T> | null> {
  if (queues.length === 0) return null;
  const rows = await sql<RawRow[]>`
    UPDATE job_queue
       SET status = 'active', locked_at = now(), locked_by = ${workerId}, attempts = attempts + 1
     WHERE id = (
       SELECT id FROM job_queue
        WHERE queue = ANY(${queues}::text[]) AND status = 'queued' AND run_at <= now()
        ORDER BY run_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
    RETURNING *`;
  return rows[0] ? toJob<T>(rows[0]) : null;
}

/**
 * claimAny, but never while another job of the same queue AND tenant
 * (restaurant_id; NULL for the scheduled all-tenant jobs) is running — the
 * worker's per-queue concurrency of 1, kept across processes.
 *
 * Within one worker process its dispatcher already runs one job per queue at a
 * time; across processes — serverless runners (the web's cron route and its
 * after() kicks) and a worker process, all at once — only this claim keeps it.
 * Both the serverless runner and the worker's dispatcher claim through here: two
 * match-invoice jobs of the same invoice running side by side could both write a
 * match run (the job checks for an earlier run, then inserts — fine
 * sequentially, not in parallel).
 *
 * Claims are serialized by a transaction-scoped advisory lock taken in its OWN
 * statement first: under READ COMMITTED each statement sees the data committed
 * before it starts, so the claim statement that follows sees every claim that
 * committed while it waited for the lock (a single-statement check could not).
 * A short explicit transaction works through the Supabase transaction pooler.
 * An active job whose lock is older than `stallMs` belongs to a dead runner and
 * does not block its group (stall recovery re-queues it).
 *
 * The price, accepted: a runner killed mid-job (a worker restart, a function cut
 * off at maxDuration) blocks that queue + tenant — for the all-tenant jobs, the
 * whole queue — until its lock is `stallMs` old (2 min). Latency only: nothing is
 * lost or run twice. Treating a younger lock as dead would let two jobs of one
 * tenant run side by side after a single slow lock renewal (renewed every 30 s).
 */
export async function claimAnySerial<T = unknown>(
  sql: Sql,
  queues: string[],
  workerId: string,
  stallMs: number,
): Promise<JobRow<T> | null> {
  if (queues.length === 0) return null;
  const rows = await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${CLAIM_LOCK}))`;
    return tx<RawRow[]>`
      UPDATE job_queue
         SET status = 'active', locked_at = now(), locked_by = ${workerId}, attempts = attempts + 1
       WHERE id = (
         SELECT j.id FROM job_queue j
          WHERE j.queue = ANY(${queues}::text[]) AND j.status = 'queued' AND j.run_at <= now()
            AND NOT EXISTS (
              SELECT 1 FROM job_queue a
               WHERE a.queue = j.queue AND a.status = 'active'
                 AND a.restaurant_id IS NOT DISTINCT FROM j.restaurant_id
                 AND a.locked_at > now() - ${stallMs} * interval '1 millisecond'
            )
          ORDER BY j.run_at, j.id
          FOR UPDATE SKIP LOCKED
          LIMIT 1
       )
      RETURNING *`;
  });
  const row = (rows as unknown as RawRow[])[0];
  return row ? toJob<T>(row) : null;
}

/** The advisory-lock name claimAnySerial serializes on. */
const CLAIM_LOCK = 'restomatch:job_queue:claim';

/** JSON-safe copy of a processor's return value (undefined → null; unserializable → a note). */
function toJsonResult(value: unknown): postgres.JSONValue {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value)) as postgres.JSONValue;
  } catch {
    return { note: 'result not serializable' };
  }
}

export async function completeJob(sql: Sql, id: string, workerId: string, result?: unknown): Promise<void> {
  await sql`
    UPDATE job_queue
       SET status = 'done', finished_at = now(), locked_at = NULL, last_error = NULL,
           result = ${sql.json(toJsonResult(result))}
     WHERE id = ${id} AND locked_by = ${workerId} AND status = 'active'`;
}

/** Status + result of one job (smoke scripts and tests poll this). */
export async function getJob<T = unknown>(sql: Sql, id: string): Promise<JobRow<T> | null> {
  const rows = await sql<RawRow[]>`SELECT * FROM job_queue WHERE id = ${id}`;
  return rows[0] ? toJob<T>(rows[0]) : null;
}

/** Exponential backoff: 5 s, 10 s, 20 s … capped at 10 min. */
export function backoffMs(attempt: number): number {
  return Math.min(5_000 * 2 ** Math.max(0, attempt - 1), 10 * 60_000);
}

/**
 * A processor that knows a retry can only fail the same way (quota, tenant guard,
 * an unreadable format) prefixes its error message with this mark: failJob then
 * dead-letters the job at once instead of retrying it (OCR-A PR-OCR-3 — a retry
 * of an OCR job is a second paid call). The processor sees only `throw`, and the
 * runner passes the message through, so the mark travels in the message.
 */
export const TERMINAL_JOB_ERROR = '[terminal] ';

export function isTerminalJobError(message: string): boolean {
  return message.startsWith(TERMINAL_JOB_ERROR);
}

/** Record a failure: retry after a backoff while attempts remain (and the error is not terminal), else 'failed'. */
export async function failJob(sql: Sql, job: Pick<JobRow, 'id' | 'attempts' | 'maxAttempts'>, error: string, workerId: string): Promise<'retry' | 'failed'> {
  const retry = job.attempts < job.maxAttempts && !isTerminalJobError(error);
  const msg = error.slice(0, 2_000);
  if (retry) {
    await sql`
      UPDATE job_queue
         SET status = 'queued', locked_at = NULL, locked_by = NULL, last_error = ${msg},
             run_at = now() + ${backoffMs(job.attempts)} * interval '1 millisecond'
       WHERE id = ${job.id} AND locked_by = ${workerId} AND status = 'active'`;
    return 'retry';
  }
  await sql`
    UPDATE job_queue SET status = 'failed', finished_at = now(), locked_at = NULL, last_error = ${msg}
     WHERE id = ${job.id} AND locked_by = ${workerId} AND status = 'active'`;
  return 'failed';
}

/** Keep the locks of in-flight jobs fresh so they are not taken for stalled. */
export async function renewLocks(sql: Sql, ids: string[], workerId: string): Promise<void> {
  if (ids.length === 0) return;
  await sql`
    UPDATE job_queue SET locked_at = now()
     WHERE id = ANY(${ids}::bigint[]) AND locked_by = ${workerId} AND status = 'active'`;
}

/** Times a job may be taken back from a dead worker before it fails (BullMQ maxStalledCount). */
export const MAX_STALLED = 1;

/**
 * Active jobs whose lock is older than `staleMs` belong to a dead worker. As in
 * BullMQ, a stall does not use up an attempt: the job is queued again (the claim's
 * attempt is given back) up to MAX_STALLED times, then failed. `excludeIds` are
 * the caller's own in-flight jobs — alive by definition, even if their lock
 * renewal lagged (laptop sleep, DB blip). Returns the counts.
 */
export async function recoverStalled(
  sql: Sql,
  staleMs: number,
  excludeIds: string[] = [],
): Promise<{ requeued: number; failed: number }> {
  const rows = await sql<Array<{ status: JobStatus; queue: string; payload: unknown; restaurant_id: string | null }>>`
    UPDATE job_queue
       SET status = CASE WHEN stalled_count < ${MAX_STALLED} THEN 'queued' ELSE 'failed' END,
           finished_at = CASE WHEN stalled_count < ${MAX_STALLED} THEN NULL ELSE now() END,
           attempts = CASE WHEN stalled_count < ${MAX_STALLED} THEN greatest(attempts - 1, 0) ELSE attempts END,
           stalled_count = stalled_count + 1,
           last_error = 'stalled: worker lost its lock (crashed or killed)',
           locked_at = NULL, locked_by = NULL
     WHERE status = 'active' AND locked_at < now() - ${staleMs} * interval '1 millisecond'
       AND NOT (id = ANY(${excludeIds}::bigint[]))
    RETURNING status, queue, payload, restaurant_id::text`;
  const ocrDead = rows.filter((r) => r.status === 'failed' && r.queue === 'ocr-invoice');
  if (ocrDead.length) await markStalledOcrInvoicesFailed(sql, ocrDead);
  const importDead = rows.filter((r) => r.status === 'failed' && r.queue === 'import-catalog');
  if (importDead.length) await markStalledCatalogImportsFailed(sql, importDead);
  return {
    requeued: rows.filter((r) => r.status === 'queued').length,
    failed: rows.filter((r) => r.status === 'failed').length,
  };
}

/**
 * An ocr-invoice job dead-lettered by stall recovery (its runner died twice
 * mid-read — e.g. a serverless function hit maxDuration) never reached the job's
 * own failure handling, so its invoice stayed 'ocr_pending' and the receiver's
 * screen spun forever. Give the invoice the same terminal state a failed read
 * gets (apps/worker ocrInvoice.ts markOcrFailed): status 'parsed', confidence 0,
 * `raw.ocrFailed` with reason 'stalled', no lines. Only while still
 * 'ocr_pending', only the job's own tenant. A failure here is logged, never
 * thrown: the queue's maintenance must keep running.
 */
async function markStalledOcrInvoicesFailed(
  sql: Sql,
  jobs: Array<{ payload: unknown; restaurant_id: string | null }>,
): Promise<void> {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const j of jobs) {
    const invoiceId = (j.payload as { invoiceId?: unknown } | null)?.invoiceId;
    if (typeof invoiceId !== 'string' || !UUID.test(invoiceId) || !j.restaurant_id) continue;
    try {
      await sql`
        UPDATE invoices
           SET status = 'parsed', ocr_confidence = 0, updated_at = now(),
               ocr_payload = jsonb_build_object(
                 'provider', 'claude_vision',
                 -- merged, like markOcrFailed: raw.scanGrId (stamped before the read) survives
                 'raw', (CASE WHEN jsonb_typeof(ocr_payload -> 'raw') = 'object' THEN ocr_payload -> 'raw' ELSE '{}'::jsonb END)
                        || jsonb_build_object('ocrFailed', true, 'reason', 'stalled'),
                 'reconciledAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
         WHERE id = ${invoiceId}::uuid AND restaurant_id = ${j.restaurant_id}::uuid AND status = 'ocr_pending'`;
    } catch (err) {
      console.warn(`[queue] could not mark the invoice of a stalled OCR job failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}

/**
 * W3-10 round 3 · an import-catalog job dead-lettered by stall recovery (its
 * runner was killed twice mid-chunk) never reached the job's own failure path,
 * so its import would stay 'pending' — neither resumable nor revertable, and
 * blocking the supplier's "undo the latest import". Mark it failed (only while
 * still pending / mapped, only the job's own tenant) and queue a small
 * `finalize` job (no file) that writes the import's partial summary, so the
 * chunks that went live are announced and can be undone. Logged, never thrown.
 */
async function markStalledCatalogImportsFailed(
  sql: Sql,
  jobs: Array<{ payload: unknown; restaurant_id: string | null }>,
): Promise<void> {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const j of jobs) {
    const p = (j.payload ?? {}) as { importId?: unknown; supplierId?: unknown; mapping?: unknown; file?: { filename?: unknown } };
    if (typeof p.importId !== 'string' || !UUID.test(p.importId) || !j.restaurant_id) continue;
    try {
      const marked = await sql`
        UPDATE catalog_imports
           SET status = 'failed', error = 'stalled: the import run was cut off twice'
         WHERE id = ${p.importId}::uuid AND restaurant_id = ${j.restaurant_id}::uuid AND status IN ('pending', 'mapped')
        RETURNING id`;
      if (marked.length === 0) continue;
      await insertJob(
        sql,
        'import-catalog',
        {
          restaurantId: j.restaurant_id,
          supplierId: p.supplierId,
          importId: p.importId,
          file: { filename: typeof p.file?.filename === 'string' ? p.file.filename : '' },
          mapping: p.mapping ?? {},
          finalize: true,
        },
        { restaurantId: j.restaurant_id, maxAttempts: 3, dedupeKey: `import-catalog:finalize:${p.importId}` },
      );
    } catch (err) {
      console.warn(`[queue] could not mark the import of a stalled import-catalog job failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}

/** W3-10 round 4: an import with no job and no activity for this long is orphaned (api LIVE_IMPORT_CUTOFF_MINUTES). */
export const CATALOG_IMPORT_ORPHAN_MINUTES = 30;

/**
 * W3-10 round 4 · queue maintenance for price-list imports (it sees job_queue,
 * which the tenant connection cannot):
 *  - an import still pending / mapped with no queued or active import-catalog
 *    job and no activity (created, or a chunk recorded) for
 *    CATALOG_IMPORT_ORPHAN_MINUTES is orphaned: it ends failed;
 *  - an import that ended failed with chunks but no summary (its finalize could
 *    not run) is finalized;
 * both by queueing one `finalize` job per import (dedupe key), which writes the
 * partial summary. Returns how many were queued. Logged, never thrown.
 */
export async function failOrphanedCatalogImports(sql: Sql, cutoffMinutes = CATALOG_IMPORT_ORPHAN_MINUTES): Promise<number> {
  try {
    const rows = await sql<Array<{ id: string; restaurant_id: string; supplier_id: string; filename: string; column_mapping: unknown }>>`
      WITH cand AS (
        SELECT i.id, i.restaurant_id, i.supplier_id, i.filename, i.column_mapping, i.status
          FROM catalog_imports i
         WHERE NOT EXISTS (SELECT 1 FROM job_queue j
                            WHERE j.queue = 'import-catalog' AND j.status IN ('queued', 'active')
                              AND j.payload ->> 'importId' = i.id::text)
           AND (
             (i.status IN ('pending', 'mapped')
              AND greatest(i.created_at, coalesce((SELECT max(a.at) FROM audit_log a
                    WHERE a.entity_type = 'catalog_import' AND a.entity_id = i.id AND a.restaurant_id = i.restaurant_id
                      AND a.action = 'catalog.import_chunk_committed'), i.created_at))
                  < now() - ${cutoffMinutes} * interval '1 minute')
             OR
             (i.status = 'failed' AND i.created_at > now() - interval '7 days'
              -- once: never again after its finalize job ran (done or failed)
              AND NOT EXISTS (SELECT 1 FROM job_queue f WHERE f.queue = 'import-catalog'
                                AND f.dedupe_key = 'import-catalog:finalize:' || i.id::text)
              AND EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_type = 'catalog_import' AND a.entity_id = i.id AND a.restaurant_id = i.restaurant_id
                            AND a.action = 'catalog.import_chunk_committed')
              AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_type = 'catalog_import' AND a.entity_id = i.id AND a.restaurant_id = i.restaurant_id
                                AND a.action IN ('catalog.import_committed', 'catalog.import_reverted')))
           )
         ORDER BY i.created_at, i.id
         LIMIT 100
         -- never wait behind a tenant transaction holding the import row
         FOR UPDATE OF i SKIP LOCKED
      ), marked AS (
        UPDATE catalog_imports c
           SET status = 'failed', error = coalesce(c.error, 'orphaned: no job and no progress')
          FROM cand
         WHERE c.id = cand.id AND c.status IN ('pending', 'mapped')
      )
      SELECT id::text, restaurant_id::text, supplier_id::text, filename, column_mapping FROM cand`;
    let queued = 0;
    for (const r of rows) {
      const job = await insertJob(
        sql,
        'import-catalog',
        {
          restaurantId: r.restaurant_id,
          supplierId: r.supplier_id,
          importId: r.id,
          file: { filename: r.filename },
          mapping: r.column_mapping ?? {},
          finalize: true,
        },
        { restaurantId: r.restaurant_id, maxAttempts: 3, dedupeKey: `import-catalog:finalize:${r.id}` },
      );
      if (job) queued += 1;
    }
    return queued;
  } catch (err) {
    console.warn(`[queue] orphaned catalog import sweep failed: ${err instanceof Error ? err.message : err}`);
    return 0;
  }
}

export interface QueueCounts {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  done: number;
}

export async function queueCounts(sql: Sql, queue: string): Promise<QueueCounts> {
  const [r] = await sql<Array<Record<keyof QueueCounts, string>>>`
    SELECT
      count(*) FILTER (WHERE status = 'queued' AND run_at <= now()) AS waiting,
      count(*) FILTER (WHERE status = 'active') AS active,
      count(*) FILTER (WHERE status = 'queued' AND run_at > now()) AS delayed,
      count(*) FILTER (WHERE status = 'failed') AS failed,
      count(*) FILTER (WHERE status = 'done') AS done
    FROM job_queue WHERE queue = ${queue}`;
  return {
    waiting: Number(r?.waiting ?? 0),
    active: Number(r?.active ?? 0),
    delayed: Number(r?.delayed ?? 0),
    failed: Number(r?.failed ?? 0),
    done: Number(r?.done ?? 0),
  };
}

/** Failed jobs of a queue, newest first (rows start..end inclusive). */
export async function failedJobs(
  sql: Sql,
  queue: string,
  start = 0,
  end = 99,
): Promise<Array<{ id: string; name: string; finishedOn?: number; failedReason?: string }>> {
  const rows = await sql<Array<{ id: string; finished_at: Date | null; last_error: string | null }>>`
    SELECT id, finished_at, last_error FROM job_queue
     WHERE queue = ${queue} AND status = 'failed'
     ORDER BY finished_at DESC NULLS LAST, id DESC
     OFFSET ${start} LIMIT ${Math.max(0, end - start + 1)}`;
  return rows.map((r) => ({
    id: String(r.id),
    name: queue,
    finishedOn: r.finished_at ? r.finished_at.getTime() : undefined,
    failedReason: r.last_error ?? undefined,
  }));
}

/** BullMQ-style job states a caller can list. */
export type ListState = 'waiting' | 'active' | 'delayed' | 'failed' | 'completed';

export interface ListedJob<T = unknown> {
  id: string;
  name: string;
  data: T;
  attemptsMade: number;
  timestamp: number;
  finishedOn?: number;
  failedReason?: string;
  returnvalue: unknown;
}

/** Jobs of a queue in the given states, newest first (rows start..end inclusive). */
export async function listJobs<T = unknown>(
  sql: Sql,
  queue: string,
  states: ListState[],
  start = 0,
  end = 99,
): Promise<Array<ListedJob<T>>> {
  const want = new Set(states);
  const rows = await sql<RawRow[]>`
    SELECT * FROM job_queue
     WHERE queue = ${queue}
       AND (
         (${want.has('waiting')} AND status = 'queued' AND run_at <= now())
         OR (${want.has('delayed')} AND status = 'queued' AND run_at > now())
         OR (${want.has('active')} AND status = 'active')
         OR (${want.has('failed')} AND status = 'failed')
         OR (${want.has('completed')} AND status = 'done')
       )
     ORDER BY created_at DESC, id DESC
     OFFSET ${start} LIMIT ${Math.max(0, end - start + 1)}`;
  return rows.map((r) => {
    const j = toJob<T>(r);
    return {
      id: j.id,
      name: queue,
      data: j.payload,
      attemptsMade: j.attempts,
      timestamp: j.createdAt.getTime(),
      finishedOn: j.finishedAt ? j.finishedAt.getTime() : undefined,
      failedReason: j.lastError ?? undefined,
      returnvalue: j.result,
    };
  });
}

/** Cron-slot rows are history for missed-slot catch-up: keep them longer than a month. */
export const KEEP_CRON_HISTORY_MS = 40 * 24 * 3600_000;

/**
 * Delete finished jobs older than `olderThanMs` (done + failed). Schedule slots
 * (dedupe_key 'cron:…') are kept KEEP_CRON_HISTORY_MS so a monthly job still
 * knows it has run before.
 */
export async function pruneJobs(sql: Sql, olderThanMs: number): Promise<number> {
  const rows = await sql`
    DELETE FROM job_queue
     WHERE status IN ('done', 'failed')
       AND finished_at < now() - ${olderThanMs} * interval '1 millisecond'
       AND (dedupe_key IS NULL OR NOT starts_with(dedupe_key, 'cron:')
            OR finished_at < now() - ${Math.max(olderThanMs, KEEP_CRON_HISTORY_MS)} * interval '1 millisecond')
    RETURNING 1`;
  return rows.length;
}
