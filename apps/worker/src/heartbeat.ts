import type IORedis from 'ioredis';

/**
 * Worker heartbeat (plan v2, Wave 0 — the worker stays on the owner's Mac for
 * the pilot, so silent death must be impossible).
 *
 * Every HEARTBEAT_INTERVAL_MS the worker writes a small JSON document under
 * HEARTBEAT_KEY with a TTL of HEARTBEAT_TTL_SEC. The web app's cron route
 * (/api/cron/worker-heartbeat) reads it: a missing key or a stale `at` means the
 * worker is down (laptop asleep, process crashed, Redis unreachable) and the
 * owner is emailed. The dashboard banner reads the same key.
 *
 * Kept out of cron.ts (immutability list) on purpose — this is a liveness
 * signal, not a scheduled job.
 */
export const HEARTBEAT_KEY = 'restomatch:worker:heartbeat';
export const HEARTBEAT_INTERVAL_MS = 60_000;
export const HEARTBEAT_TTL_SEC = 300;

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

export async function writeHeartbeat(
  redis: Pick<IORedis, 'set'>,
  doc: HeartbeatDoc,
  ttlSec = HEARTBEAT_TTL_SEC,
): Promise<void> {
  await redis.set(HEARTBEAT_KEY, JSON.stringify(doc), 'EX', ttlSec);
}

/** Start the periodic beat. Returns a stop function for graceful shutdown. */
export function startHeartbeat(
  redis: Pick<IORedis, 'set'>,
  workers: number,
  intervalMs = HEARTBEAT_INTERVAL_MS,
): () => void {
  const startedAt = new Date();
  const beat = () =>
    writeHeartbeat(redis, buildHeartbeat(workers, startedAt)).catch((err: unknown) => {
      console.warn('[worker] heartbeat write failed:', err instanceof Error ? err.message : err);
    });
  void beat();
  const timer = setInterval(beat, intervalMs);
  // Never keep the process alive just for the heartbeat.
  timer.unref();
  return () => clearInterval(timer);
}
