import { NextResponse } from 'next/server';
import { cronAuthorized } from '@/lib/cronAuth';
import { JOBS_BUDGET_MS, JOBS_HEARTBEAT_HOST } from '@/lib/cronJobs';

/**
 * The job runner — production needs no separate worker process (no Mac, no
 * Redis). Vercel Cron calls this every minute (apps/web/vercel.json):
 *
 *   1. beat: worker_heartbeats row 'vercel-cron', so the watchdog
 *      (/api/cron/worker-heartbeat) and the dashboard banner see a live runner;
 *   2. stall recovery + pruning (a runner killed mid-job is re-queued);
 *   3. due scheduled tasks — the worker's cron.ts, Asia/Jerusalem wall time,
 *      each slot at most once (its job row is the marker);
 *   4. the queue, until it is empty or ~240 s are spent (maxDuration 300 s).
 *
 * Uploads do not wait for this: the after() kick (lib/jobKick.ts) runs OCR /
 * match / catalog jobs right after the request that enqueued them. A worker
 * process may still run next to this (claims are SKIP LOCKED + serialized per
 * queue and tenant).
 *
 * Auth: exactly like /api/cron/worker-heartbeat — `Authorization: Bearer
 * $CRON_SECRET` (Vercel sends it when CRON_SECRET is set), else 401; outside
 * production with no CRON_SECRET the check is skipped.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const { runServerlessTick } = await import('@restomatch/worker/serverless');
    const r = await runServerlessTick({ budgetMs: JOBS_BUDGET_MS, heartbeatHost: JOBS_HEARTBEAT_HOST });
    return NextResponse.json(
      {
        ok: r.ok,
        scheduled: r.scheduled,
        ran: r.jobs.ran,
        done: r.jobs.done,
        retried: r.jobs.retried,
        failed: r.jobs.failed,
        byQueue: r.jobs.byQueue,
        stoppedBy: r.jobs.stoppedBy,
        maintenance: r.maintenance,
        ms: r.ms,
        checkedAt: new Date().toISOString(),
      },
      { status: r.ok ? 200 : 500 },
    );
  } catch (err) {
    console.error('[cron/jobs] tick failed', err);
    return NextResponse.json({ ok: false, error: 'tick failed' }, { status: 500 });
  }
}
