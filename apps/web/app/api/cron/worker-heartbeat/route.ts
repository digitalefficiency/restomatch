import { NextResponse } from 'next/server';
import { sendEmail } from '@/lib/email';
import { getRedis } from '@/lib/redis';
import { evaluateHeartbeat, isWorkerDown, WORKER_HEARTBEAT_KEY } from '@/lib/workerHeartbeat';

/**
 * Worker watchdog (plan v2, Wave 0). Vercel Cron calls this every 5 minutes
 * (apps/web/vercel.json). It reads the heartbeat the worker writes to Redis and
 * emails the owner when the worker is down — the pilot worker runs on a laptop,
 * so "it silently stopped" must be impossible.
 *
 * Auth: Vercel sends `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set
 * in the project env. Without the header (or with a wrong one) → 401. In
 * development with no CRON_SECRET configured the check is skipped.
 *
 * Alert dedupe: one email per outage — an `alerted` marker with a 6h TTL is set
 * after the first alert and cleared when the worker is seen healthy again (a
 * recovery email is sent then).
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ALERTED_KEY = 'restomatch:worker:alerted';
const ALERT_TTL_SEC = 6 * 60 * 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== 'production';
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

function alertRecipients(): string[] {
  const raw = process.env.WORKER_ALERT_EMAILS ?? process.env.PLATFORM_ADMIN_EMAILS ?? '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const redis = getRedis();
  if (!redis) {
    return NextResponse.json({ status: 'unknown', reason: 'REDIS_URL not configured' }, { status: 200 });
  }

  const raw = await redis.get(WORKER_HEARTBEAT_KEY);
  const status = evaluateHeartbeat(raw);
  const down = isWorkerDown(status);
  const alreadyAlerted = (await redis.get(ALERTED_KEY)) === '1';
  const to = alertRecipients();
  let emailed: 'down' | 'recovered' | null = null;

  if (down && !alreadyAlerted) {
    if (to.length > 0) {
      const detail =
        status.state === 'stale'
          ? `הפעימה האחרונה לפני ${Math.round(status.ageMs / 60_000)} דקות (${status.doc.host ?? 'unknown host'}, pid ${status.doc.pid ?? '?'})`
          : status.state === 'missing'
            ? 'לא נמצאה פעימה ב-Redis (ה-worker לא רץ או Redis לא זמין)'
            : 'פעימה לא תקינה';
      await sendEmail({
        to: to.join(','),
        subject: '⚠️ RestoMatch worker לא מגיב — חשבוניות לא יעברו OCR',
        html: `<div dir="rtl"><p>ה-worker של RestoMatch (OCR, התאמה, מיילים) לא שלח פעימת חיים.</p><p>${detail}</p><p>הפעל מחדש במק: <code>launchctl kickstart -k gui/$(id -u)/com.restomatch.worker</code> או <code>bash apps/worker/scripts/start-worker.sh</code>.</p></div>`,
        text: `RestoMatch worker is not responding. ${detail}. Restart: launchctl kickstart -k gui/$(id -u)/com.restomatch.worker`,
      });
      emailed = 'down';
    }
    await redis.set(ALERTED_KEY, '1', 'EX', ALERT_TTL_SEC);
  } else if (!down && alreadyAlerted) {
    await redis.del(ALERTED_KEY);
    if (to.length > 0) {
      await sendEmail({
        to: to.join(','),
        subject: '✅ RestoMatch worker חזר לפעילות',
        html: `<div dir="rtl"><p>ה-worker שולח שוב פעימות חיים (${status.state === 'ok' ? status.doc.host ?? '' : ''}).</p></div>`,
        text: 'RestoMatch worker is back.',
      });
      emailed = 'recovered';
    }
  }

  return NextResponse.json({
    status: status.state,
    ageMs: status.state === 'ok' || status.state === 'stale' ? status.ageMs : null,
    alerted: down ? true : false,
    emailed,
    recipients: to.length,
    checkedAt: new Date().toISOString(),
  });
}
