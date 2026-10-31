import { AlertTriangle } from 'lucide-react';
import { withDeadline } from '@restomatch/queue';
import { getT } from '@/lib/i18n/server';
import { nav } from '@/lib/i18n/messages/nav';
import { evaluateHeartbeat, type HeartbeatStatus } from '@/lib/workerHeartbeat';
import { readHeartbeatRaw } from '@/lib/workerHeartbeatStore';

/** The banner may add at most this much to a dashboard render. */
export const HEARTBEAT_READ_DEADLINE_MS = 1_500;

/**
 * Starts the heartbeat read. It never rejects: a DB hiccup or the deadline
 * resolves to null (no banner), so the layout can start it early and drop it on a
 * redirect.
 */
export function readWorkerStatus(): Promise<HeartbeatStatus | null> {
  return withDeadline(readHeartbeatRaw(), HEARTBEAT_READ_DEADLINE_MS, () => new Error('heartbeat read timed out')).then(
    (raw) => evaluateHeartbeat(raw),
    () => null, // DB hiccup: don't block the dashboard on a status banner.
  );
}

/**
 * "Worker offline" banner (plan v2, Wave 0). Renders nothing while the worker
 * beats. When the heartbeat is missing/stale, tells the receiver that uploaded
 * invoices are queued and will be processed once the worker is back — instead of
 * the silent 30-second spinner the audit found.
 * It renders in the shell, never in a Suspense boundary: streamed in after the
 * page, it pushed every page ~110 px down (CLS 0.10–0.12 at 390 px; W1-06 budget
 * ≤ 0.05).
 */
export async function WorkerStatusBanner({ status: pending }: { status: Promise<HeartbeatStatus | null> }) {
  const status = await pending;
  if (!status || status.state === 'ok') return null;
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
