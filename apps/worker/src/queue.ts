import { hostname } from 'node:os';
import cronParser from 'cron-parser';
import { captureException } from '@restomatch/observability';
import {
  claimJob,
  completeJob,
  failJob,
  failedJobs,
  insertJob,
  listJobs,
  pruneJobs,
  queueCounts,
  queueDbUrl,
  queueSql,
  recoverStalled,
  renewLocks,
  type JobRow,
  type ListState,
  type Sql,
} from '@restomatch/queue';

/**
 * The worker's job runtime on Postgres (0061 job_queue) — BullMQ/Redis are gone.
 *
 *  - makeWorker(name, processor): polls its queue, claims with SKIP LOCKED,
 *    runs up to `concurrency` jobs, retries with backoff (max_attempts per job),
 *    renews the locks of in-flight jobs; a crashed worker's jobs are recovered
 *    as "stalled" by any live worker.
 *  - makeQueue(name): the small BullMQ-shaped surface the rest of the worker
 *    uses (add, getJobCounts, getJobs, getFailed, upsertJobScheduler,
 *    removeJobScheduler), so cron.ts and the job modules did not change shape.
 *  - Schedules run in-process (cron-parser, tz-aware like BullMQ); a slot is
 *    turned into a job with dedupe_key 'cron:<schedulerId>:<local wall time>' —
 *    the unique index admits exactly one per slot, so two workers never run the
 *    same 06:00 twice. A slot missed while the worker was down (the Mac slept) is
 *    caught up within a window (daily 6 h, monthly 3 days; every-N: never).
 */

export const WORKER_ID = `${hostname()}:${process.pid}`;

/** A job whose lock was not renewed for this long belongs to a dead worker. */
export const STALL_AFTER_MS = 2 * 60_000;
const LOCK_RENEW_MS = 30_000;
const MAINTENANCE_MS = 60_000;
const PRUNE_EVERY_MS = 60 * 60_000;
/** Finished jobs (and the cron-slot dedupe rows) are kept this long. */
export const KEEP_FINISHED_MS = 7 * 24 * 3600_000;

/** The worker's queue pool: claim loops of ~13 queues + maintenance share it. */
const WORKER_POOL_MAX = 4;

/** Latency-sensitive queues poll every second; the rest every 5 s. */
const FAST_QUEUES = new Set(['ocr-invoice', 'match-invoice', 'import-catalog']);

export function workerSql(): Sql {
  const url = queueDbUrl();
  if (!url) throw new Error('DATABASE_URL is required');
  return queueSql(url, WORKER_POOL_MAX);
}

/**
 * One log line per failed job. Without it a failure is only visible in Sentry
 * (env-gated), i.e. invisible on a laptop/container without SENTRY_DSN.
 */
export function formatJobFailure(
  name: string,
  job: { id?: string; attemptsMade?: number } | undefined,
  err: unknown,
): string {
  const msg = err instanceof Error ? err.message : String(err);
  return `[${name}] job=${job?.id ?? '?'} attempt=${job?.attemptsMade ?? '?'} failed: ${msg}`;
}

/** What a processor receives — the BullMQ Job fields the job modules read. */
export interface WorkerJob<T> {
  id: string;
  name: string;
  data: T;
  /** Attempts made BEFORE this one (0 on the first run), as in BullMQ. */
  attemptsMade: number;
  opts: { attempts: number };
}

export interface PgWorker {
  name: string;
  close(): Promise<void>;
}

const inFlight = new Map<string, string>(); // jobId → queue (lock renewal)

export function makeWorker<T>(
  name: string,
  processor: (job: WorkerJob<T>) => Promise<unknown>,
  options: { concurrency?: number; pollMs?: number; sql?: Sql } = {},
): PgWorker {
  const concurrency = options.concurrency ?? 1;
  const pollMs = options.pollMs ?? (FAST_QUEUES.has(name) ? 1_000 : 5_000);
  const sql = options.sql ?? workerSql();
  let running = true;
  let wake: (() => void) | null = null;
  const active = new Set<Promise<void>>();
  let lastErrorLogAt = 0;

  const runOne = async (row: JobRow<T>) => {
    const job: WorkerJob<T> = {
      id: row.id,
      name,
      data: row.payload,
      attemptsMade: row.attempts - 1, // claimJob already counted this run
      opts: { attempts: row.maxAttempts },
    };
    inFlight.set(row.id, name);
    try {
      let result: unknown;
      try {
        result = await processor(job);
      } catch (err) {
        console.error(formatJobFailure(name, { id: row.id, attemptsMade: row.attempts }, err));
        captureException(err, { queue: name, jobId: row.id });
        await failJob(sql, row, err instanceof Error ? err.message : String(err), WORKER_ID).catch((e: unknown) =>
          console.error(`[${name}] could not record the failure of job=${row.id}: ${e instanceof Error ? e.message : e}`),
        );
        return;
      }
      // Outside the processor's catch: a DB blip here must not turn work that
      // succeeded into a failure. If it cannot be recorded, stall recovery
      // re-queues the job later (consumers are idempotent).
      await completeJob(sql, row.id, WORKER_ID, result).catch((e: unknown) =>
        console.error(`[${name}] could not record the completion of job=${row.id}: ${e instanceof Error ? e.message : e}`),
      );
    } finally {
      inFlight.delete(row.id);
    }
  };

  const loop = async () => {
    while (running) {
      if (active.size >= concurrency) {
        await Promise.race(active);
        continue;
      }
      let row: JobRow<T> | null = null;
      try {
        row = await claimJob<T>(sql, name, WORKER_ID);
      } catch (err) {
        // DB blip: keep polling (the DB watchdog exits the process if it lasts).
        const now = Date.now();
        if (now - lastErrorLogAt > 30_000) {
          lastErrorLogAt = now;
          console.error(`[${name}] claim failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (row) {
        const p: Promise<void> = runOne(row).finally(() => active.delete(p));
        active.add(p);
        continue; // there may be more ready right now
      }
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, pollMs);
        wake = () => {
          clearTimeout(t);
          resolve();
        };
      });
      wake = null;
    }
  };
  const done = loop();

  return {
    name,
    async close() {
      running = false;
      wake?.();
      await done;
      await Promise.all(active); // let in-flight jobs finish (graceful drain)
    },
  };
}

/* ── schedules (BullMQ "job schedulers") ─────────────────────────────────── */

export type Repeat = { every: number } | { pattern: string; tz?: string };
interface Schedule {
  queue: string;
  id: string;
  repeat: Repeat;
  template: { name: string; data: unknown };
  lastSlot?: number;
}
const schedules = new Map<string, Schedule>();

const HOUR_MS = 3600_000;
/** A slot this old is a catch-up, not an on-time fire (the tick runs every 10 s). */
const ON_TIME_MS = 2 * 60_000;

/** Validate a 5-field cron pattern (with its zone) at registration, not at 06:00. */
export function assertPattern(pattern: string, tz?: string): void {
  if (pattern.trim().split(/\s+/).length !== 5) throw new Error(`[cron] unsupported pattern "${pattern}" (5 fields)`);
  cronParser.parseExpression(pattern, { tz });
}

/** How long after a missed slot it is still worth running: monthly 3 days, else 6 h. */
export function catchUpWindowMs(pattern: string): number {
  const [, , dayOfMonth, month] = pattern.trim().split(/\s+/);
  return dayOfMonth !== '*' || month !== '*' ? 72 * HOUR_MS : 6 * HOUR_MS;
}

/** Wall-clock label of `at` in `tz`: '2026-10-25T06:00' (DST-ambiguous hours collapse to one slot). */
function wallClock(at: number, tz: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(at))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export interface DueSlot {
  /** Slot instant (UTC ms). */
  at: number;
  /** Dedupe label: ISO for every-N, local wall time for patterns. */
  label: string;
  /** True when the slot is older than an on-time tick (a missed slot). */
  catchUp: boolean;
}

/**
 * The slot a schedule is due for at `now`, or null when nothing is due.
 * every N: floor(now / N) · N, never caught up (the next one is minutes away).
 * Pattern: the latest slot ≤ now (cron-parser, in `tz`), due until its catch-up
 * window closes.
 */
export function dueSlot(repeat: Repeat, now: Date): DueSlot | null {
  if ('every' in repeat) {
    const at = Math.floor(now.getTime() / repeat.every) * repeat.every;
    return { at, label: new Date(at).toISOString(), catchUp: false };
  }
  const tz = repeat.tz ?? 'UTC';
  // prev() is strictly before currentDate: +1 ms so a slot is due at its own instant.
  const at = cronParser
    .parseExpression(repeat.pattern, { tz, currentDate: new Date(now.getTime() + 1) })
    .prev()
    .getTime();
  const age = now.getTime() - at;
  if (age < 0 || age >= catchUpWindowMs(repeat.pattern)) return null;
  return { at, label: wallClock(at, tz), catchUp: age > ON_TIME_MS };
}

const cronKeyPrefix = (id: string) => `cron:${id}:`;

/**
 * Turn due slots into jobs. Exactly one job per (schedule, slot) across all
 * workers. A missed slot is caught up — except the first time a schedule ever
 * ticks on this database (the cutover from BullMQ, which already ran it): that
 * slot is recorded as skipped, not replayed.
 */
export async function tickSchedules(sql: Sql, now = new Date()): Promise<string[]> {
  const fired: string[] = [];
  for (const s of schedules.values()) {
    const due = dueSlot(s.repeat, now);
    if (due === null || due.at === s.lastSlot) continue;
    const dedupeKey = `${cronKeyPrefix(s.id)}${due.label}`;
    if (due.catchUp) {
      const [seen] = await sql`
        SELECT 1 FROM job_queue WHERE queue = ${s.queue} AND starts_with(dedupe_key, ${cronKeyPrefix(s.id)}) LIMIT 1`;
      if (!seen) {
        await sql`
          INSERT INTO job_queue (queue, payload, status, dedupe_key, finished_at, result)
          VALUES (${s.queue}, ${sql.json(s.template.data as never)}, 'done', ${dedupeKey}, now(),
                  ${sql.json({ skipped: 'first tick of this schedule: a slot before it is not replayed' })})
          ON CONFLICT (queue, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`;
        s.lastSlot = due.at;
        continue;
      }
    }
    const inserted = await insertJob(sql, s.queue, s.template.data, { dedupeKey });
    s.lastSlot = due.at;
    if (inserted) {
      fired.push(s.id);
      if (due.catchUp) console.log(`[cron] ${s.id}: caught up the missed slot ${due.label}`);
    }
  }
  return fired;
}

/* ── maintenance: stall recovery, lock renewal, pruning ──────────────────── */

let maintenanceTimer: ReturnType<typeof setInterval> | null = null;
let renewTimer: ReturnType<typeof setInterval> | null = null;
let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let lastPruneAt = 0;

export async function runMaintenance(sql: Sql, now = Date.now()): Promise<void> {
  // Renew our own locks first and never recover our own in-flight jobs: after a
  // laptop sleep or a DB blip, maintenance can run before the renewal timer.
  const mine = [...inFlight.keys()];
  await renewLocks(sql, mine, WORKER_ID);
  const { requeued, failed } = await recoverStalled(sql, STALL_AFTER_MS, mine);
  if (requeued || failed) console.warn(`[worker] recovered stalled jobs: ${requeued} requeued, ${failed} failed`);
  if (now - lastPruneAt >= PRUNE_EVERY_MS) {
    lastPruneAt = now;
    const pruned = await pruneJobs(sql, KEEP_FINISHED_MS);
    await sql`DELETE FROM rate_limit_counters WHERE expires_at < now()`;
    await sql`DELETE FROM ops_kv WHERE expires_at < now()`;
    await sql`DELETE FROM worker_heartbeats WHERE beat_at < now() - interval '7 days'`;
    if (pruned) console.log(`[worker] pruned ${pruned} finished jobs older than 7 days`);
  }
}

/** Start the scheduler tick, lock renewal and maintenance loops. Returns a stop function. */
export function startRuntime(sql: Sql = workerSql()): () => void {
  const guard = (label: string, fn: () => Promise<unknown>) => () =>
    void fn().catch((err: unknown) => console.error(`[worker] ${label} failed: ${err instanceof Error ? err.message : err}`));
  schedulerTimer = setInterval(guard('scheduler', () => tickSchedules(sql)), 10_000);
  renewTimer = setInterval(guard('lock renewal', () => renewLocks(sql, [...inFlight.keys()], WORKER_ID)), LOCK_RENEW_MS);
  maintenanceTimer = setInterval(guard('maintenance', () => runMaintenance(sql)), MAINTENANCE_MS);
  void guard('scheduler', () => tickSchedules(sql))();
  void guard('maintenance', () => runMaintenance(sql))();
  for (const t of [schedulerTimer, renewTimer, maintenanceTimer]) t.unref();
  return () => {
    for (const t of [schedulerTimer, renewTimer, maintenanceTimer]) if (t) clearInterval(t);
  };
}

/* ── makeQueue: the BullMQ-shaped surface ────────────────────────────────── */

export function makeQueue<T>(name: string) {
  return {
    name,
    async add(_jobName: string, data: T, opts: { jobId?: string; delay?: number; attempts?: number } = {}) {
      const restaurantId = (data as { restaurantId?: unknown } | null)?.restaurantId;
      return insertJob(workerSql(), name, data, {
        dedupeKey: opts.jobId,
        runAt: opts.delay ? new Date(Date.now() + opts.delay) : undefined,
        maxAttempts: opts.attempts,
        restaurantId: typeof restaurantId === 'string' ? restaurantId : null,
      });
    },
    /** Counts per state; BullMQ's 'completed' is also given as 'done'. */
    async getJobCounts(..._types: string[]): Promise<Record<string, number>> {
      const c = await queueCounts(workerSql(), name);
      return { ...c, completed: c.done };
    },
    getJobs(states: ListState | ListState[], start = 0, end = 99) {
      return listJobs<T>(workerSql(), name, Array.isArray(states) ? states : [states], start, end);
    },
    getFailed(start = 0, end = 99) {
      return failedJobs(workerSql(), name, start, end);
    },
    async upsertJobScheduler(id: string, repeat: Repeat, template: { name: string; data: T }) {
      if ('pattern' in repeat) assertPattern(repeat.pattern, repeat.tz); // fail at registration, not at 06:00
      else if (!(repeat.every > 0)) throw new Error(`[cron] ${id}: "every" must be > 0`);
      schedules.set(id, { queue: name, id, repeat, template });
    },
    async removeJobScheduler(id: string) {
      schedules.delete(id);
    },
  };
}

/** Test hook: drop all registered schedules. */
export function resetSchedulesForTests(): void {
  schedules.clear();
}
