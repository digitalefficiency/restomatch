import { NextResponse } from 'next/server';
import { sendEmail } from '@/lib/email';
import { clearAlerted, getAlerted, readHeartbeatRaw, setAlerted } from '@/lib/workerHeartbeatStore';
import { evaluateHeartbeat, isWorkerDown } from '@/lib/workerHeartbeat';

/**
 * Worker watchdog (plan v2, Wave 0). Vercel Cron calls this every 5 minutes
 * (apps/web/vercel.json). It reads the heartbeat the worker writes to Postgres
 * (worker_heartbeats, 0061) and
 * emails the owner when the worker is down — the pilot worker runs on a laptop,
 * so "it silently stopped" must be impossible.
 *
 * Auth: Vercel sends `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set
 * in the project env. Without the header (or with a wrong one) → 401. In
 * development with no CRON_SECRET configured the check is skipped.
 *
 * Alert dedupe: one email per outage — an `alerted` marker (ops_kv) with a 6h expiry is set
 * after the first alert and cleared when the worker is seen healthy again (a
 * recovery email is sent then).
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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
  const raw = await readHeartbeatRaw();
  const status = evaluateHeartbeat(raw);
  const down = isWorkerDown(status);
  const alreadyAlerted = await getAlerted();
  const to = alertRecipients();
  let emailed: 'down' | 'recovered' | null = null;

  if (down && !alreadyAlerted) {
    if (to.length > 0) {
      const detail =
        status.state === 'stale'
          ? `הפעימה האחרונה לפני ${Math.round(status.ageMs / 60_000)} דקות (${status.doc.host ?? 'unknown host'}, pid ${status.doc.pid ?? '?'})`
          : status.state === 'missing'
            ? 'לא נמצאה פעימה במסד הנתונים (ה-worker לא רץ או שאינו מגיע למסד)'
            : 'פעימה לא תקינה';
      await sendEmail({
        to: to.join(','),
        subject: '⚠️ RestoMatch worker לא מגיב — חשבוניות לא יעברו OCR',
        html: `<div dir="rtl"><p>ה-worker של RestoMatch (OCR, התאמה, מיילים) לא שלח פעימת חיים.</p><p>${detail}</p><p>הפעלה מחדש: ב-Fly <code>fly machine restart -a restomatch-worker</code>; במק <code>launchctl kickstart -k gui/$(id -u)/com.restomatch.worker</code>.</p></div>`,
        text: `RestoMatch worker is not responding. ${detail}. Restart: fly machine restart -a restomatch-worker (Fly) or launchctl kickstart -k gui/$(id -u)/com.restomatch.worker (Mac)`,
      });
      emailed = 'down';
    }
    await setAlerted(ALERT_TTL_SEC);
  } else if (!down && alreadyAlerted) {
    await clearAlerted();
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
