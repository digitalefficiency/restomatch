import { getRedis } from '@/lib/redis';
import { evaluateHeartbeat, WORKER_HEARTBEAT_KEY } from '@/lib/workerHeartbeat';

/**
 * "Worker offline" banner (plan v2, Wave 0). Renders nothing while the worker
 * beats. When the heartbeat is missing/stale, tells the receiver that uploaded
 * invoices are queued and will be processed once the worker is back — instead of
 * the silent 30-second spinner the audit found.
 */
export async function WorkerStatusBanner() {
  const redis = getRedis();
  if (!redis) return null;
  let raw: string | null = null;
  try {
    raw = await redis.get(WORKER_HEARTBEAT_KEY);
  } catch {
    return null; // Redis hiccup: don't block the dashboard on a status banner.
  }
  const status = evaluateHeartbeat(raw);
  if (status.state === 'ok') return null;
  const minutes = status.state === 'stale' ? Math.round(status.ageMs / 60_000) : null;
  return (
    <div
      role="status"
      className="mb-6 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-ink"
    >
      <strong className="font-semibold">מנוע העיבוד לא זמין כרגע.</strong>{' '}
      חשבוניות שתעלו יישמרו ויעברו OCR והתאמה ברגע שהוא יחזור
      {minutes !== null ? ` (פעימה אחרונה לפני ${minutes} דק׳)` : ''}. הבעלים קיבל התראה.
    </div>
  );
}
