/**
 * Worker liveness evaluation (plan v2, Wave 0). Pure: the cron route and the
 * dashboard banner both call evaluateHeartbeat() on the JSON the worker writes
 * under WORKER_HEARTBEAT_KEY (see apps/worker/src/heartbeat.ts).
 */
export const WORKER_HEARTBEAT_KEY = 'restomatch:worker:heartbeat';
/** A beat older than this is "down" (the worker beats every 60s, TTL 300s). */
export const WORKER_STALE_AFTER_MS = 10 * 60_000;

export interface HeartbeatDoc {
  at: string;
  pid?: number;
  host?: string;
  workers?: number;
  startedAt?: string;
}

export type HeartbeatStatus =
  | { state: 'ok'; ageMs: number; doc: HeartbeatDoc }
  | { state: 'stale'; ageMs: number; doc: HeartbeatDoc }
  | { state: 'missing' }
  | { state: 'invalid'; raw: string };

export function evaluateHeartbeat(
  raw: string | null | undefined,
  now: Date = new Date(),
  staleAfterMs = WORKER_STALE_AFTER_MS,
): HeartbeatStatus {
  if (raw == null || raw === '') return { state: 'missing' };
  let doc: HeartbeatDoc;
  try {
    doc = JSON.parse(raw) as HeartbeatDoc;
  } catch {
    return { state: 'invalid', raw };
  }
  const at = Date.parse(doc?.at ?? '');
  if (!Number.isFinite(at)) return { state: 'invalid', raw };
  const ageMs = now.getTime() - at;
  return ageMs > staleAfterMs ? { state: 'stale', ageMs, doc } : { state: 'ok', ageMs, doc };
}

export function isWorkerDown(status: HeartbeatStatus): boolean {
  return status.state !== 'ok';
}
