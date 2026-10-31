import { NextResponse } from 'next/server';
import { JOBS_DEADLINE_MS, JOBS_FRESH_SEC, jobsReportFromRaw } from './jobs';

// Liveness probe for the web app (deploy verification + uptime monitoring).
// Intentionally dependency-free and unauthenticated: it answers 200 whenever the
// Next.js server is serving, with no database coupling so a downstream outage
// can't make the platform mark the web app itself unhealthy.
//
// `?jobs=1` (uptime monitor U3, docs/MONITORING.md) ALSO reports whether the job
// runner is alive: the age of the freshest worker_heartbeats row, which the
// /api/cron/jobs runner writes every minute. Still public and secret-free — only
// "ok"/"stale"/"unknown" and an age in seconds leave the server. A database
// error answers jobs:"unknown" with HTTP 200 (the monitor's keyword check fails,
// the probe itself never 500s). The base probe never touches the database.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function jobsReport(): Promise<ReturnType<typeof jobsReportFromRaw>> {
  try {
    const { readHeartbeatRaw } = await import('@/lib/workerHeartbeatStore');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const raw = await Promise.race([
      readHeartbeatRaw(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('heartbeat read timed out')), JOBS_DEADLINE_MS);
      }),
    ]).finally(() => clearTimeout(timer));
    return jobsReportFromRaw(raw, Date.now(), JOBS_FRESH_SEC);
  } catch (err) {
    console.warn('[healthz] jobs check failed:', err instanceof Error ? err.message : err);
    return { jobs: 'unknown', heartbeatAgeSec: null };
  }
}

export async function GET(req: Request) {
  const base = {
    status: 'ok',
    service: 'restomatch-web',
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    time: new Date().toISOString(),
  };
  const wantsJobs = new URL(req.url).searchParams.get('jobs') === '1';
  if (!wantsJobs) return NextResponse.json(base);
  return NextResponse.json({ ...base, ...(await jobsReport()) }, { headers: { 'Cache-Control': 'no-store' } });
}
