import { hostname } from 'node:os';
import cronParser from 'cron-parser';
import { captureException } from '@restomatch/observability';
import {
  claimAny,
  completeJob,
  failJob,
  failedJobs,
  insertJob,
  JOB_CHANNEL,
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

/*
 * One dispatcher per database pool claims for EVERY registered queue with a
 * single query (claimAny), instead of one poll loop per queue: on the Supabase
 * free plan egress is metered, and 13 queues × 1–5 s polls was ~5 queries/s
 * (~6 GB/month) of empty claims. When a claim comes back empty the dispatcher
 * sleeps with exponential backoff (IDLE_MIN_MS → IDLE_MAX_MS); a claimed job,
 * a local insert (wakeDispatchers) or a NOTIFY from another process (LISTEN,
 * startJobListener) resets/wakes it. Per-queue concurrency is enforced here.
 */
export const IDLE_MIN_MS = 1_000;
export const IDLE_MAX_MS = 30_000;

/** The next idle sleep after an empty claim: doubles up to the cap. */
export function nextIdleMs(current: number, max = IDLE_MAX_MS): number {
  return Math.min(Math.max(current, 1) * 2, max);
}

interface Registration {
  name: string;
  processor: (job: WorkerJob<unknown>) => Promise<unknown>;
  concurrency: number;
  active: Set<Promise<void>>;
}

class Dispatcher {
  readonly queues = new Map<string, Registration>();
  private running = true;
  private wakeFn: (() => void) | null = null;
  private pendingWake = false;
  private lastErrorLogAt = 0;
  idleMs: number;
  /** Claim queries issued (for the idle-load measurement in the PR / tests). */
  claims = 0;
  /** With a live LISTEN, an empty claim sleeps the full cap at once. */
  listening = false;
  readonly done: Promise<void>;

  constructor(
    readonly sql: Sql,
    readonly minIdleMs: number,
    readonly maxIdleMs: number,
  ) {
    this.idleMs = minIdleMs;
    this.done = this.loop();
  }

  wake(): void {
    if (this.wakeFn) this.wakeFn();
    else this.pendingWake = true;
  }

  stop(): void {
    this.running = false;
    this.wake();
  }

  private sleep(ms: number): Promise<void> {
    if (this.pendingWake) {
      this.pendingWake = false;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const t = setTimeout(done, ms);
      const self = this;
      function done() {
        clearTimeout(t);
        self.wakeFn = null;
        resolve();
      }
      this.wakeFn = done;
    });
  }

  private async loop(): Promise<void> {
    while (this.running) {
      const open = [...this.queues.values()].filter((r) => r.active.size < r.concurrency);
      if (open.length === 0) {
        await this.sleep(this.maxIdleMs); // all busy (or none registered): a finishing job wakes us
        continue;
      }
      let row: JobRow<unknown> | null = null;
      try {
        this.claims += 1;
        row = await claimAny(this.sql, open.map((r) => r.name), WORKER_ID);
      } catch (err) {
        // DB blip: keep polling (the DB watchdog exits the process if it lasts).
        const now = Date.now();
        if (now - this.lastErrorLogAt > 30_000) {
          this.lastErrorLogAt = now;
          console.error(`[worker] claim failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      const reg = row ? this.queues.get(row.queue) : undefined;
      if (row && reg) {
        this.idleMs = this.minIdleMs;
        const p: Promise<void> = runOne(this.sql, reg, row).finally(() => {
          reg.active.delete(p);
          this.wake(); // capacity freed; there may be more queued
        });
        reg.active.add(p);
        continue; // there may be more ready right now
      }
      await this.sleep(this.listening ? this.maxIdleMs : this.idleMs);
      this.idleMs = nextIdleMs(this.idleMs, this.maxIdleMs);
    }
  }
}

const dispatchers = new Map<Sql, Dispatcher>();

/** Wake every dispatcher in this process (a job was just inserted locally). */
export function wakeDispatchers(): void {
  for (const d of dispatchers.values()) d.wake();
}

/** Test/telemetry hook: the dispatcher serving `sql`, if any. */
export function dispatcherFor(sql: Sql): { claims: number; idleMs: number; listening: boolean } | undefined {
  return dispatchers.get(sql);
}

async function runOne(sql: Sql, reg: Registration, row: JobRow<unknown>): Promise<void> {
  const name = reg.name;
  const job: WorkerJob<unknown> = {
    id: row.id,
    name,
    data: row.payload,
    attemptsMade: row.attempts - 1, // claimAny already counted this run
    opts: { attempts: row.maxAttempts },
  };
  inFlight.set(row.id, name);
  try {
    let result: unknown;
    try {
      result = await reg.processor(job);
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
}

export function makeWorker<T>(
  name: string,
  processor: (job: WorkerJob<T>) => Promise<unknown>,
  options: { concurrency?: number; pollMs?: number; sql?: Sql } = {},
): PgWorker {
  const sql = options.sql ?? workerSql();
  let d = dispatchers.get(sql);
  if (!d) {
    // pollMs (tests) caps both ends of the idle backoff.
    const cap = options.pollMs ?? IDLE_MAX_MS;
    d = new Dispatcher(sql, Math.min(IDLE_MIN_MS, cap), cap);
    dispatchers.set(sql, d);
  }
  const dispatcher = d;
  if (dispatcher.queues.has(name)) throw new Error(`[worker] queue "${name}" already has a worker`);
  const reg: Registration = {
    name,
    processor: processor as Registration['processor'],
    concurrency: options.concurrency ?? 1,
    active: new Set(),
  };
  dispatcher.queues.set(name, reg);
  dispatcher.wake();

  return {
    name,
    async close() {
      dispatcher.queues.delete(name); // stop claiming for this queue
      if (dispatcher.queues.size === 0) {
        dispatcher.stop();
        dispatchers.delete(sql);
        await dispatcher.done;
      }
      await Promise.all(reg.active); // let in-flight jobs finish (graceful drain)
    },
  };
}

/**
 * LISTEN for new-job NOTIFYs so an upload is picked up in ~1 s while the idle
 * poll stays at IDLE_MAX_MS. Needs a session connection: the worker's
 * DATABASE_URL (direct or the Supabase SESSION pooler, port 5432). On the
 * transaction pooler (6543) LISTEN cannot work, so it is skipped and the
 * backoff poll alone applies. WORKER_LISTEN=off disables it.
 */
export async function startJobListener(
  sql: Sql = workerSql(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<() => Promise<void>> {
  const url = queueDbUrl(env) ?? '';
  if (env.WORKER_LISTEN === 'off' || /:6543(\/|$|\?)/.test(url)) {
    console.warn('[worker] LISTEN disabled (transaction pooler or WORKER_LISTEN=off) — polling only, new jobs wait up to 30 s');
    return async () => {};
  }
  const setListening = (on: boolean) => {
    for (const d of dispatchers.values()) d.listening = on;
  };
  try {
    const sub = await sql.listen(
      JOB_CHANNEL,
      () => wakeDispatchers(),
      () => setListening(true), // (re)connected
    );
    console.log('[worker] listening for new jobs (NOTIFY job_queue)');
    return async () => {
      setListening(false);
      await sub.unlisten();
    };
  } catch (err) {
    console.warn(`[worker] LISTEN failed (${err instanceof Error ? err.message : err}) — polling only`);
    return async () => {};
  }
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
      wakeDispatchers();
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
      const inserted = await insertJob(workerSql(), name, data, {
        dedupeKey: opts.jobId,
        runAt: opts.delay ? new Date(Date.now() + opts.delay) : undefined,
        maxAttempts: opts.attempts,
        restaurantId: typeof restaurantId === 'string' ? restaurantId : null,
      });
      wakeDispatchers();
      return inserted;
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

/* ── deploy-order guard ──────────────────────────────────────────────────── */

export const QUEUE_TABLES = ['job_queue', 'worker_heartbeats', 'rate_limit_counters', 'ops_kv'] as const;

/** The 0061 tables this database is missing ([] when the migration has run). */
export async function missingQueueTables(sql: Sql): Promise<string[]> {
  const rows = await sql<Array<{ t: string; present: boolean }>>`
    SELECT t, to_regclass('public.' || t) IS NOT NULL AS present
      FROM unnest(${[...QUEUE_TABLES]}::text[]) AS t`;
  return rows.filter((r) => !r.present).map((r) => r.t);
}

/** The bilingual refusal printed when the worker starts before migration 0061. */
export function missingQueueTablesMessage(missing: string[]): string {
  return [
    `[worker] REFUSING TO START: migration 0061 has not run on this database (missing: ${missing.join(', ')}).`,
    '  Merge/deploy the PR so Supabase applies 0061 (or run `pnpm --filter @restomatch/db migrate`), then start the worker again.',
    `[worker] ה-worker לא עולה: מיגרציה 0061 עוד לא רצה על מסד הנתונים (חסרות הטבלאות: ${missing.join(', ')}).`,
    '  יש למזג את ה-PR כדי ש-Supabase יריץ את 0061, ואז להפעיל את ה-worker מחדש.',
  ].join('\n');
}

/** Test hook: drop all registered schedules. */
export function resetSchedulesForTests(): void {
  schedules.clear();
}
