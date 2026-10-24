import 'server-only';
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

/** Claims stop after this long; a job already running finishes (OCR ≈ 10–40 s). */
export const KICK_BUDGET_MS = 50_000;

/** A kick older than this is presumed dead (instance frozen/killed) and no longer absorbs new kicks. */
const KICK_STALE_MS = KICK_BUDGET_MS + 30_000;

type Schedule = (task: () => Promise<void>) => void;
type Runner = (opts: { budgetMs: number; queues: string[] }) => Promise<{ ran: number; stoppedBy: string }>;

/** One live kick per queue per process; a second enqueue meanwhile asks it to look again. */
const active = new Map<string, { again: boolean; since: number }>();

async function loadRunner(): Promise<Runner> {
  return (await import('@restomatch/worker/serverless')).runQueuedJobs;
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
  const live = active.get(queue);
  if (live && now() - live.since < KICK_STALE_MS) {
    live.again = true;
    return true;
  }
  const state = { again: false, since: now() };
  try {
    schedule(async () => {
      const deadline = now() + KICK_BUDGET_MS;
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
