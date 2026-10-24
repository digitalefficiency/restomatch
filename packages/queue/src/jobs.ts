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

export function queueSql(url: string, max = 1): Sql {
  memo.__restomatchQueueSql ??= new Map();
  const key = `${max}|${url}`;
  let sql = memo.__restomatchQueueSql.get(key);
  if (!sql) {
    sql = postgres(url, {
      max,
      prepare: false, // Supabase pooler (transaction mode)
      idle_timeout: 20,
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

/** Insert a job. Returns null when a job with the same (queue, dedupeKey) exists. */
export async function insertJob(sql: Sql, queue: string, payload: unknown, opts: EnqueueOptions = {}): Promise<{ id: string } | null> {
  const rows = await sql<Array<{ id: string }>>`
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
    RETURNING id`;
  return rows[0] ? { id: String(rows[0].id) } : null;
}

/** Claim the next runnable job of `queue` for `workerId`, or null. */
export async function claimJob<T = unknown>(sql: Sql, queue: string, workerId: string): Promise<JobRow<T> | null> {
  const rows = await sql<RawRow[]>`
    UPDATE job_queue
       SET status = 'active', locked_at = now(), locked_by = ${workerId}, attempts = attempts + 1
     WHERE id = (
       SELECT id FROM job_queue
        WHERE queue = ${queue} AND status = 'queued' AND run_at <= now()
        ORDER BY run_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
    RETURNING *`;
  return rows[0] ? toJob<T>(rows[0]) : null;
}

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

/** Record a failure: retry after a backoff while attempts remain, else 'failed'. */
export async function failJob(sql: Sql, job: Pick<JobRow, 'id' | 'attempts' | 'maxAttempts'>, error: string, workerId: string): Promise<'retry' | 'failed'> {
  const retry = job.attempts < job.maxAttempts;
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
  const rows = await sql<Array<{ status: JobStatus }>>`
    UPDATE job_queue
       SET status = CASE WHEN stalled_count < ${MAX_STALLED} THEN 'queued' ELSE 'failed' END,
           finished_at = CASE WHEN stalled_count < ${MAX_STALLED} THEN NULL ELSE now() END,
           attempts = CASE WHEN stalled_count < ${MAX_STALLED} THEN greatest(attempts - 1, 0) ELSE attempts END,
           stalled_count = stalled_count + 1,
           last_error = 'stalled: worker lost its lock (crashed or killed)',
           locked_at = NULL, locked_by = NULL
     WHERE status = 'active' AND locked_at < now() - ${staleMs} * interval '1 millisecond'
       AND NOT (id = ANY(${excludeIds}::bigint[]))
    RETURNING status`;
  return {
    requeued: rows.filter((r) => r.status === 'queued').length,
    failed: rows.filter((r) => r.status === 'failed').length,
  };
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
