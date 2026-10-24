import { hostname } from 'node:os';
import { startOfDayInTz } from '@restomatch/api';
import { captureException } from '@restomatch/observability';
import {
  claimJob,
  completeJob,
  failJob,
  failedJobs,
  insertJob,
  pruneJobs,
  queueCounts,
  queueDbUrl,
  queueSql,
  recoverStalled,
  renewLocks,
  type JobRow,
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
 *    uses (add, getJobCounts, getFailed, upsertJobScheduler, removeJobScheduler),
 *    so cron.ts, the health digest and the OCR sweep did not change shape.
 *  - Schedules run in-process; a slot is turned into a job with
 *    dedupe_key 'cron:<schedulerId>:<slot>' — the unique index admits exactly one
 *    per slot, so two workers never run the same 06:00 twice.
 */

export const WORKER_ID = `${hostname()}:${process.pid}`;

/** A job whose lock was not renewed for this long belongs to a dead worker. */
export const STALL_AFTER_MS = 2 * 60_000;
const LOCK_RENEW_MS = 30_000;
const MAINTENANCE_MS = 60_000;
const PRUNE_EVERY_MS = 60 * 60_000;
/** Finished jobs (and the cron-slot dedupe rows) are kept this long. */
export const KEEP_FINISHED_MS = 7 * 24 * 3600_000;

/** Latency-sensitive queues poll every second; the rest every 5 s. */
const FAST_QUEUES = new Set(['ocr-invoice', 'match-invoice', 'import-catalog']);

export function workerSql(): Sql {
  const url = queueDbUrl();
  if (!url) throw new Error('DATABASE_URL is required');
  return queueSql(url);
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

export interface WorkerJob<T> {
  id: string;
  name: string;
  data: T;
  attemptsMade: number;
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
    const job: WorkerJob<T> = { id: row.id, name, data: row.payload, attemptsMade: row.attempts };
    inFlight.set(row.id, name);
    try {
      const result = await processor(job);
      await completeJob(sql, row.id, WORKER_ID, result);
    } catch (err) {
      console.error(formatJobFailure(name, job, err));
      captureException(err, { queue: name, jobId: row.id });
      await failJob(sql, row, err instanceof Error ? err.message : String(err), WORKER_ID).catch((e: unknown) =>
        console.error(`[${name}] could not record the failure of job=${row.id}: ${e instanceof Error ? e.message : e}`),
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

type Repeat = { every: number } | { pattern: string; tz?: string };
interface Schedule {
  queue: string;
  id: string;
  repeat: Repeat;
  template: { name: string; data: unknown };
  lastSlot?: number;
}
const schedules = new Map<string, Schedule>();
/** Run a missed daily slot if the worker comes up within this long after it. */
const DAILY_GRACE_MS = 2 * 3600_000;

/** 'M H * * *' only — the only shape cron.ts uses. */
export function parseDailyPattern(pattern: string): { minute: number; hour: number } {
  const m = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(pattern.trim());
  if (!m) throw new Error(`[cron] unsupported pattern "${pattern}" (only "M H * * *" daily patterns)`);
  const minute = Number(m[1]);
  const hour = Number(m[2]);
  if (minute > 59 || hour > 23) throw new Error(`[cron] invalid time in "${pattern}"`);
  return { minute, hour };
}

/** Local hour of `d` in `tz`. */
function hourIn(d: Date, tz: string): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(d));
}

/**
 * The slot (UTC ms) a schedule is due for at `now`, or null when nothing is due.
 * every N: floor(now / N) · N. Daily: today's H:M in `tz` (DST-corrected), due
 * from that instant for DAILY_GRACE_MS.
 */
export function dueSlot(repeat: Repeat, now: Date): number | null {
  if ('every' in repeat) return Math.floor(now.getTime() / repeat.every) * repeat.every;
  const tz = repeat.tz ?? 'UTC';
  const { minute, hour } = parseDailyPattern(repeat.pattern);
  let slot = startOfDayInTz(now, tz).getTime() + hour * 3600_000 + minute * 60_000;
  const drift = hourIn(new Date(slot), tz) - hour; // DST day: midnight + H hours is off by one
  if (drift !== 0) slot -= Math.sign(drift) * 3600_000;
  const age = now.getTime() - slot;
  return age >= 0 && age < DAILY_GRACE_MS ? slot : null;
}

/** Turn due slots into jobs. Exactly one job per (schedule, slot) across all workers. */
export async function tickSchedules(sql: Sql, now = new Date()): Promise<string[]> {
  const fired: string[] = [];
  for (const s of schedules.values()) {
    const slot = dueSlot(s.repeat, now);
    if (slot === null || slot === s.lastSlot) continue;
    const inserted = await insertJob(sql, s.queue, s.template.data, {
      dedupeKey: `cron:${s.id}:${new Date(slot).toISOString()}`,
    });
    s.lastSlot = slot;
    if (inserted) fired.push(s.id);
  }
  return fired;
}

/* ── maintenance: stall recovery, lock renewal, pruning ──────────────────── */

let maintenanceTimer: ReturnType<typeof setInterval> | null = null;
let renewTimer: ReturnType<typeof setInterval> | null = null;
let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let lastPruneAt = 0;

export async function runMaintenance(sql: Sql, now = Date.now()): Promise<void> {
  const { requeued, failed } = await recoverStalled(sql, STALL_AFTER_MS);
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
    async getJobCounts(..._types: string[]): Promise<Record<string, number>> {
      return { ...(await queueCounts(workerSql(), name)) };
    },
    getFailed(start = 0, end = 99) {
      return failedJobs(workerSql(), name, start, end);
    },
    async upsertJobScheduler(id: string, repeat: Repeat, template: { name: string; data: T }) {
      if ('pattern' in repeat) parseDailyPattern(repeat.pattern); // fail at registration, not at 06:00
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
