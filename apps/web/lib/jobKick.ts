import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { after } from 'next/server';
import { setEnqueueListener } from '@restomatch/queue';

/**
 * The immediate kick (serverless jobs, no worker process): when a request
 * enqueues OCR / match / catalog work, run it right after the response —
 * Next's after() keeps the function alive for it — so a photographed invoice is
 * read in seconds, not at the next cron minute (/api/cron/jobs).
 *
 * Registered once per server process from instrumentation.node.ts, as the
 * enqueue listener of @restomatch/queue (packages/api stays framework-agnostic:
 * it only enqueues). The ocr-invoice job enqueues its match-invoice job from
 * INSIDE the run; that one joins the same run (packages/queue kick.ts), so the
 * whole chain completes within this budget when it can.
 *
 * after() outside a request scope (a script, the build, a test) throws — that
 * is caught and ignored: the job stays queued for the cron route (or a worker).
 * JOB_KICK=off turns the kick off (the cron route still runs everything).
 */

/** Queues a user is waiting on. Scheduled work (outbox, reports) stays on the cron minute. */
export const KICK_QUEUES: ReadonlySet<string> = new Set(['ocr-invoice', 'match-invoice', 'import-catalog']);

/**
 * Claims stop this long after the enqueue that started the kick; a job already
 * running finishes (OCR ≈ 10–40 s). Sized for a route on the platform default
 * maxDuration (300 s on Vercel with Fluid compute — the tRPC route): request +
 * 50 s of claims + one job stays far inside it. A route with a shorter
 * maxDuration declares it with withKickBudget().
 */
export const KICK_BUDGET_MS = 50_000;

/**
 * Time a claimed job may still need (a Claude Vision read is ≈ 10–40 s). Inside
 * withKickBudget the kick claims only while this much is left before the route's
 * maxDuration — after() time counts toward it, and a job cut off mid-run waits
 * for stall recovery and can be dead-lettered as 'stalled'.
 */
export const JOB_HEADROOM_MS = 45_000;

/** A live kick with less claim time left than this does not absorb a new enqueue: a fresh kick is started. */
const ABSORB_MIN_MS = 10_000;

type Schedule = (task: () => Promise<void>) => void;
type Runner = (opts: { budgetMs: number; queues: string[] }) => Promise<{ ran: number; stoppedBy: string }>;

/** One live kick per queue per process; a second enqueue meanwhile asks it to look again. */
const active = new Map<string, { again: boolean; deadline: number }>();

/** The invocation's hard end (route maxDuration), per request. globalThis: Next may load this module twice. */
const holder = globalThis as unknown as { __restomatchKickBudget?: AsyncLocalStorage<{ endsAt: number }> };
const routeBudgets = (holder.__restomatchKickBudget ??= new AsyncLocalStorage<{ endsAt: number }>());

/**
 * Run a route handler whose `maxDuration` is short (the 60 s ingest webhooks):
 * a kick started inside it claims only until `maxDuration − JOB_HEADROOM_MS`
 * after the request began, and not at all when that has passed — the job then
 * stays queued for /api/cron/jobs (within a minute).
 */
export function withKickBudget<T>(maxDurationSec: number, fn: () => T, now: () => number = Date.now): T {
  return routeBudgets.run({ endsAt: now() + maxDurationSec * 1000 }, fn);
}

/** When a kick started at `t` must stop claiming (route budget, if declared, else KICK_BUDGET_MS). */
export function kickClaimDeadline(t: number): number {
  const route = routeBudgets.getStore();
  const own = t + KICK_BUDGET_MS;
  return route ? Math.min(own, route.endsAt - JOB_HEADROOM_MS) : own;
}

/**
 * The serverless runner, for the kick and /api/cron/jobs. The jobs read the owner
 * URL from DATABASE_URL themselves (queueDbUrl, jobDb): put the repaired owner URL
 * there first — boot does it too (instrumentation.node.ts); this keeps a runner
 * correct even when it is loaded without that boot step. Idempotent.
 */
export async function loadJobRunner(): Promise<typeof import('@restomatch/worker/serverless')> {
  const { applyRepairedDbEnv } = await import('./env');
  applyRepairedDbEnv();
  return import('@restomatch/worker/serverless');
}

async function loadRunner(): Promise<Runner> {
  return (await loadJobRunner()).runQueuedJobs;
}

/**
 * Schedule a run of `queue` after the current response. Returns true when a run
 * is scheduled (or an already-scheduled one will pick the job up), false when
 * the queue is not kicked or there is no request scope to attach to.
 */
export function kickQueue(
  queue: string,
  schedule: Schedule = after,
  runner: () => Promise<Runner> = loadRunner,
  now: () => number = Date.now,
): boolean {
  if (!KICK_QUEUES.has(queue)) return false;
  // The deadline is fixed now, inside the request: time the response still takes
  // before after() starts counts against it.
  const t = now();
  const deadline = kickClaimDeadline(t);
  if (deadline <= t) return false; // no room left in this invocation — the cron route runs it
  const live = active.get(queue);
  if (live && live.deadline - t >= ABSORB_MIN_MS) {
    live.again = true;
    return true;
  }
  const state = { again: false, deadline };
  try {
    schedule(async () => {
      try {
        const runQueuedJobs = await runner();
        do {
          state.again = false;
          const left = deadline - now();
          if (left <= 0) break;
          const r = await runQueuedJobs({ budgetMs: left, queues: [queue] });
          if (r.ran > 0) console.log(`[jobs] kick ${queue}: ran ${r.ran} (${r.stoppedBy})`);
        } while (state.again);
      } catch (err) {
        // The job is still queued: the cron route retries it within a minute.
        console.error(`[jobs] kick ${queue} failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        if (active.get(queue) === state) active.delete(queue);
      }
    });
  } catch {
    return false; // outside a request scope — nothing to attach to; cron picks it up
  }
  active.set(queue, state);
  return true;
}

/** Install the kick as the queue's enqueue listener (instrumentation.node.ts). */
export function registerJobKick(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.JOB_KICK === 'off') {
    setEnqueueListener(null);
    return false;
  }
  setEnqueueListener((queue) => {
    kickQueue(queue);
  });
  return true;
}

/** Tests: forget live kicks. */
export function __resetJobKicks(): void {
  active.clear();
}
