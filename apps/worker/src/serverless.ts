import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { claimAnySerial, queueDbUrl, queueSql, renewLocks, withRunScope, type Sql } from '@restomatch/queue';
import { registerCronSchedules } from './cron';
import { CRON_SKIP_ENV, isCronSkipped, parseCronSkip, unknownCronSkipNames } from './cronSkip';
import { useServerlessPools } from './db';
import { HANDLED_QUEUES, JOB_HANDLERS } from './handlers';
import { writeHeartbeat } from './heartbeat';
import { registeredSchedules, runClaimedJob, runMaintenance, STALL_AFTER_MS, tickSchedules, type WorkerJob } from './queue';

/**
 * Serverless job execution: the worker's jobs, run by the web app itself — no
 * separate worker process (no Mac, no Redis). Imported ONLY as
 * `@restomatch/worker/serverless` (never the package root, which boots a worker).
 *
 *  - runQueuedJobs: claim + run jobs until the queue is empty or the budget is
 *    spent. Same processors (handlers.ts) and the same done / retry-with-backoff
 *    / dead-letter recording (runClaimedJob) as the worker loop.
 *  - runDueSchedules: the worker's cron.ts schedules, unchanged, turned into jobs
 *    when due. The per-task "last run" marker is the job row itself: dedupe_key
 *    'cron:<schedule>:<slot in Asia/Jerusalem wall time>' under job_queue's unique
 *    index, so each slot runs at most once — across every runner AND a worker
 *    process running at the same time. SERVERLESS_CRON_SKIP (cronSkip.ts: task ids
 *    or queue names, comma-separated, or `all`; unset = nothing skipped) pauses
 *    tasks without a code change — the operational switch next to JOB_KICK.
 *  - runServerlessTick: what /api/cron/jobs does every minute: heartbeat, stall
 *    recovery + pruning, due schedules, then the queue.
 *
 * Safe next to a running worker: claims are FOR UPDATE SKIP LOCKED (a job runs
 * once), and both this runner and the worker's dispatcher claim through
 * claimAnySerial, which never starts a job while another job of the same
 * queue + tenant is running anywhere — the worker's per-queue concurrency of 1.
 * Every job runs on the owner DATABASE_URL (jobDb / queueDbUrl), exactly like
 * the worker — never on the RLS app role.
 */

useServerlessPools();

/** This process's claimer id: unique per instance (serverless hosts can share hostname + pid). */
export const SERVERLESS_WORKER_ID = `serverless:${hostname()}:${process.pid}:${randomBytes(3).toString('hex')}`;

const STARTED_AT = new Date();

/** Lock renewal while a job runs (the worker renews every 30 s; stalled after 2 min). */
const LOCK_RENEW_MS = 30_000;

/** The queue connection: the web's small pool (QUEUE_DATABASE_URL, else the owner DATABASE_URL). */
export function serverlessSql(): Sql {
  const url = queueDbUrl();
  if (!url) throw new Error('DATABASE_URL is required to run jobs');
  return queueSql(url);
}

export interface RunQueuedJobsOptions {
  /** Stop claiming new jobs after this long (a job already running is finished). */
  budgetMs: number;
  /** Only these queues (default: every queue). Jobs they enqueue join the run. */
  queues?: readonly string[];
  sql?: Sql;
  workerId?: string;
  /** Tests: lock renewal period. */
  renewEveryMs?: number;
  /** Told when a claimed job starts (true) and ends (false): the after() kick reads it (apps/web/lib/jobKick.ts). */
  onJob?: (running: boolean) => void;
}

export interface RunQueuedJobsResult {
  ran: number;
  done: number;
  retried: number;
  failed: number;
  byQueue: Record<string, number>;
  /** 'empty': nothing runnable left; 'budget': out of time; 'error': a claim failed. */
  stoppedBy: 'empty' | 'budget' | 'error';
  error?: string;
  ms: number;
}

/** Renew `id`'s lock while `fn` runs, so a long job is not taken for stalled. */
async function withLockRenewal<T>(sql: Sql, id: string, workerId: string, everyMs: number, fn: () => Promise<T>): Promise<T> {
  const timer = setInterval(() => {
    renewLocks(sql, [id], workerId).catch((err: unknown) =>
      console.warn(`[jobs] lock renewal of job=${id} failed: ${err instanceof Error ? err.message : err}`),
    );
  }, everyMs);
  timer.unref?.();
  try {
    return await fn();
  } finally {
    clearInterval(timer);
  }
}

/**
 * Claim and run jobs until none is runnable or `budgetMs` is spent. A job a
 * processor enqueues (ocr-invoice → match-invoice) joins this run's queues, so
 * a chain completes in the same budget. Sequential, one job at a time.
 */
export async function runQueuedJobs(opts: RunQueuedJobsOptions): Promise<RunQueuedJobsResult> {
  const sql = opts.sql ?? serverlessSql();
  const workerId = opts.workerId ?? SERVERLESS_WORKER_ID;
  const t0 = Date.now();
  const deadline = t0 + Math.max(0, opts.budgetMs);
  const scope = { queues: new Set<string>(opts.queues ?? HANDLED_QUEUES) };
  const res: RunQueuedJobsResult = { ran: 0, done: 0, retried: 0, failed: 0, byQueue: {}, stoppedBy: 'empty', ms: 0 };

  await withRunScope(scope, async () => {
    for (;;) {
      if (Date.now() >= deadline) {
        res.stoppedBy = 'budget';
        return;
      }
      const queues = [...scope.queues].filter((q) => Object.hasOwn(JOB_HANDLERS, q));
      let row;
      try {
        row = await claimAnySerial(sql, queues, workerId, STALL_AFTER_MS);
      } catch (err) {
        res.stoppedBy = 'error';
        res.error = `claim failed: ${err instanceof Error ? err.message : String(err)}`;
        console.error(`[jobs] ${res.error}`);
        return;
      }
      if (!row) return;
      const processor = JOB_HANDLERS[row.queue] as (job: WorkerJob<unknown>) => Promise<unknown>;
      const claimed = row;
      opts.onJob?.(true);
      const outcome = await withLockRenewal(sql, claimed.id, workerId, opts.renewEveryMs ?? LOCK_RENEW_MS, () =>
        runClaimedJob(sql, claimed.queue, processor, claimed, workerId),
      ).finally(() => opts.onJob?.(false));
      res.ran += 1;
      res.byQueue[claimed.queue] = (res.byQueue[claimed.queue] ?? 0) + 1;
      if (outcome === 'done') res.done += 1;
      else if (outcome === 'retry') res.retried += 1;
      else res.failed += 1;
    }
  });
  res.ms = Date.now() - t0;
  return res;
}

let registered: Promise<void> | null = null;
/** The SERVERLESS_CRON_SKIP value whose unknown names were last warned about (once per value). */
let warnedSkip: string | undefined;

/**
 * Turn the due slots of cron.ts's schedules into jobs (tickSchedules — the
 * worker's own scheduler). Daily/monthly patterns are Asia/Jerusalem wall time;
 * a missed slot is caught up within its window (daily 6 h, monthly 3 days).
 * Tasks named in SERVERLESS_CRON_SKIP (or all, with `all`) do not fire; their
 * daily/monthly slots are recorded as skipped (cronSkip.ts). Returns the
 * schedule ids that fired.
 */
export async function runDueSchedules(
  sql: Sql = serverlessSql(),
  now: Date = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<string[]> {
  registered ??= registerCronSchedules().catch((err: unknown) => {
    registered = null;
    throw err;
  });
  await registered;
  const raw = env[CRON_SKIP_ENV];
  const skip = parseCronSkip(raw);
  if (!skip) return tickSchedules(sql, now);
  if (warnedSkip !== raw) {
    warnedSkip = raw;
    const unknown = unknownCronSkipNames(skip, registeredSchedules());
    console.warn(
      `[cron] ${CRON_SKIP_ENV}=${raw}: ${skip.all ? 'every scheduled task is' : 'these scheduled tasks are'} skipped` +
        (unknown.length ? ` — no such task: ${unknown.join(', ')}` : ''),
    );
  }
  return tickSchedules(sql, now, { skip: (s) => isCronSkipped(skip, s), skipReason: CRON_SKIP_ENV });
}

/** Write the job runner's liveness beat (worker_heartbeats) — the watchdog and the dashboard banner read it. */
export async function writeServerlessHeartbeat(sql: Sql, host: string, now: Date = new Date()): Promise<void> {
  await writeHeartbeat(sql, host, {
    at: now.toISOString(),
    pid: process.pid,
    host,
    workers: HANDLED_QUEUES.length,
    startedAt: STARTED_AT.toISOString(),
  });
}

export interface ServerlessTickOptions {
  budgetMs: number;
  /** worker_heartbeats row (worker_id + host), e.g. 'vercel-cron'. */
  heartbeatHost: string;
  sql?: Sql;
  now?: Date;
}

export interface ServerlessTickResult {
  ok: boolean;
  maintenance: 'ok' | string;
  scheduled: string[];
  jobs: RunQueuedJobsResult;
  ms: number;
}

/**
 * One cron tick: beat, recover stalled jobs (a runner killed mid-job) and prune,
 * turn due schedules into jobs, then run the queue within `budgetMs`. A failing
 * step is reported, not thrown, so the beat and the queue still run.
 */
export async function runServerlessTick(opts: ServerlessTickOptions): Promise<ServerlessTickResult> {
  const t0 = Date.now();
  const sql = opts.sql ?? serverlessSql();
  // The beat first: it proves the cron fires and the database answers even when a
  // long run follows. A database that does not answer fails the tick (→ 500).
  await writeServerlessHeartbeat(sql, opts.heartbeatHost);
  let ok = true;
  let maintenance = 'ok';
  try {
    await runMaintenance(sql);
  } catch (err) {
    ok = false;
    maintenance = `maintenance failed: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`[jobs] ${maintenance}`);
  }
  let scheduled: string[] = [];
  try {
    scheduled = await runDueSchedules(sql, opts.now);
  } catch (err) {
    ok = false;
    console.error(`[jobs] schedules failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const jobs = await runQueuedJobs({ budgetMs: Math.max(0, opts.budgetMs - (Date.now() - t0)), sql });
  if (jobs.stoppedBy === 'error') ok = false;
  await writeServerlessHeartbeat(sql, opts.heartbeatHost).catch(() => {});
  return { ok, maintenance, scheduled, jobs, ms: Date.now() - t0 };
}

export { HANDLED_QUEUES, JOB_HANDLERS } from './handlers';
