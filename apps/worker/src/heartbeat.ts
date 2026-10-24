import type { Sql } from '@restomatch/queue';

/**
 * Worker heartbeat (plan v2, Wave 0 — the worker stays on the owner's Mac for
 * the pilot, so silent death must be impossible).
 *
 * Every HEARTBEAT_INTERVAL_MS the worker upserts its row in worker_heartbeats
 * (0061; was a Redis key with a TTL). The web app's cron route
 * (/api/cron/worker-heartbeat) and the dashboard banner read the freshest row:
 * none, or a stale `beat_at`, means the worker is down (laptop asleep, process
 * crashed, database unreachable) and the owner is emailed.
 *
 * Kept out of cron.ts (immutability list) on purpose — this is a liveness
 * signal, not a scheduled job.
 */
export const HEARTBEAT_INTERVAL_MS = 60_000;

export interface HeartbeatDoc {
  at: string; // ISO timestamp of the last beat
  pid: number;
  host: string;
  workers: number;
  startedAt: string;
}

export function buildHeartbeat(workers: number, startedAt: Date, now = new Date()): HeartbeatDoc {
  return {
    at: now.toISOString(),
    pid: process.pid,
    host: process.env.HOSTNAME ?? process.env.HOST ?? 'unknown',
    workers,
    startedAt: startedAt.toISOString(),
  };
}

export async function writeHeartbeat(sql: Sql, workerId: string, doc: HeartbeatDoc): Promise<void> {
  await sql`
    INSERT INTO worker_heartbeats (worker_id, host, pid, workers, started_at, beat_at)
    VALUES (${workerId}, ${doc.host}, ${doc.pid}, ${doc.workers}, ${doc.startedAt}, ${doc.at})
    ON CONFLICT (worker_id) DO UPDATE SET
      host = EXCLUDED.host, pid = EXCLUDED.pid, workers = EXCLUDED.workers,
      started_at = EXCLUDED.started_at, beat_at = EXCLUDED.beat_at`;
}

/** Start the periodic beat. Returns a stop function for graceful shutdown. */
export function startHeartbeat(
  sql: Sql,
  workerId: string,
  workers: number,
  intervalMs = HEARTBEAT_INTERVAL_MS,
): () => void {
  const startedAt = new Date();
  const beat = () =>
    writeHeartbeat(sql, workerId, buildHeartbeat(workers, startedAt)).catch((err: unknown) => {
      console.warn('[worker] heartbeat write failed:', err instanceof Error ? err.message : err);
    });
  void beat();
  const timer = setInterval(beat, intervalMs);
  // Never keep the process alive just for the heartbeat.
  timer.unref();
  return () => clearInterval(timer);
}
