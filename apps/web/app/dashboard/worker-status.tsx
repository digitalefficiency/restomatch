import { AlertTriangle } from 'lucide-react';
import { getRedis, redisGetWithDeadline } from '@/lib/redis';
import { getT } from '@/lib/i18n/server';
import { nav } from '@/lib/i18n/messages/nav';
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
    raw = await redisGetWithDeadline(redis, WORKER_HEARTBEAT_KEY);
  } catch {
    return null; // Redis hiccup: don't block the dashboard on a status banner.
  }
  const status = evaluateHeartbeat(raw);
  if (status.state === 'ok') return null;
  const t = await getT(nav);
  const minutes = status.state === 'stale' ? Math.round(status.ageMs / 60_000) : null;
  return (
    <div
      role="status"
      className="mb-6 flex items-start gap-3 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-ink"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
      <p>
        <strong className="font-semibold">{t('worker.title')}</strong> {t('worker.body')}
        {minutes !== null ? <> {t('worker.lastBeat', { minutes })}</> : null} {t('worker.ownerNotified')}
      </p>
    </div>
  );
}
