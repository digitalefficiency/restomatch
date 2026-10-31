/**
 * The ?jobs=1 part of /api/healthz (uptime monitor U3): whether the job runner
 * (/api/cron/jobs, beating worker_heartbeats every 60 s) is alive. Pure, so the
 * thresholds are testable without a database.
 */

/** A beat younger than this means the runner is alive (it beats every 60 s). */
export const JOBS_FRESH_SEC = 180;
/** Give up on the database after this long and answer "unknown". */
export const JOBS_DEADLINE_MS = 2_500;

export type JobsReport = { jobs: 'ok' | 'stale' | 'unknown'; heartbeatAgeSec: number | null };

/** The report for the freshest heartbeat document (readHeartbeatRaw), or null when none exists. */
export function jobsReportFromRaw(raw: string | null, now: number, freshSec = JOBS_FRESH_SEC): JobsReport {
  if (!raw) return { jobs: 'stale', heartbeatAgeSec: null }; // never beaten
  let at = Number.NaN;
  try {
    at = Date.parse((JSON.parse(raw) as { at?: string }).at ?? '');
  } catch {
    // fall through: an unreadable row is "unknown", not "stale"
  }
  if (!Number.isFinite(at)) return { jobs: 'unknown', heartbeatAgeSec: null };
  const ageSec = Math.max(0, Math.round((now - at) / 1000));
  return { jobs: ageSec < freshSec ? 'ok' : 'stale', heartbeatAgeSec: ageSec };
}
