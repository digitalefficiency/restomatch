import { NextResponse } from 'next/server';
import { cronAuthorized } from '@/lib/cronAuth';
import { sendEmail } from '@/lib/email';
import { clearAlerted, getAlerted, readHeartbeatRaw, setAlerted } from '@/lib/workerHeartbeatStore';
import { evaluateHeartbeat, isWorkerDown } from '@/lib/workerHeartbeat';

/**
 * Job-runner watchdog (plan v2, Wave 0). Vercel Cron calls this every 5 minutes
 * (apps/web/vercel.json). It reads the latest heartbeat in Postgres
 * (worker_heartbeats, 0061) — written every minute by /api/cron/jobs (host
 * 'vercel-cron'; production needs no worker process) or by a worker process —
 * and emails WORKER_ALERT_EMAILS (else PLATFORM_ADMIN_EMAILS) when it is down,
 * so "the jobs silently stopped" must be impossible. With neither set it can
 * only log the outage.
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

function alertRecipients(): string[] {
  const raw = process.env.WORKER_ALERT_EMAILS ?? process.env.PLATFORM_ADMIN_EMAILS ?? '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function GET(req: Request) {
  if (!cronAuthorized(req)) {
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
            ? 'לא נמצאה פעימה במסד הנתונים (ה-cron /api/cron/jobs או ה-worker לא רצים, או שאינם מגיעים למסד)'
            : 'פעימה לא תקינה';
      // Serverless first: production runs its jobs from the /api/cron/jobs cron
      // (beats as 'vercel-cron'); a worker process is optional.
      await sendEmail({
        to: to.join(','),
        subject: '⚠️ RestoMatch: מריץ המשימות לא מגיב — חשבוניות לא יעברו OCR',
        html: `<div dir="rtl"><p>מריץ המשימות של RestoMatch (OCR, התאמה, מיילים) לא שלח פעימת חיים.</p><p>${detail}</p><p>בלי worker (ברירת המחדל): ב-Vercel ← Cron Jobs בדקו שה-cron <code>/api/cron/jobs</code> (כל דקה) רץ ועונה 200, ובלוגים של הפונקציה; ובסביבת Production את <code>CRON_SECRET</code> ואת <code>DATABASE_URL</code>.</p><p>אם רץ גם worker נפרד: ב-Fly <code>fly machine restart -a restomatch-worker</code>; במק <code>launchctl kickstart -k gui/$(id -u)/com.restomatch.worker</code>.</p></div>`,
        text: `RestoMatch job runner is not responding. ${detail}. No worker (default): in Vercel → Cron Jobs check that /api/cron/jobs (every minute) runs and answers 200, and its function logs; check CRON_SECRET and DATABASE_URL in Production. If a worker process also runs: fly machine restart -a restomatch-worker (Fly) or launchctl kickstart -k gui/$(id -u)/com.restomatch.worker (Mac)`,
      });
      emailed = 'down';
    } else {
      // Nobody to tell: at least say it in the function log.
      console.error(
        `[cron/worker-heartbeat] job runner ${status.state} — no WORKER_ALERT_EMAILS / PLATFORM_ADMIN_EMAILS set, no alert e-mailed`,
      );
    }
    await setAlerted(ALERT_TTL_SEC);
  } else if (!down && alreadyAlerted) {
    await clearAlerted();
    if (to.length > 0) {
      await sendEmail({
        to: to.join(','),
        subject: '✅ RestoMatch: מריץ המשימות חזר לפעילות',
        html: `<div dir="rtl"><p>מריץ המשימות שולח שוב פעימות חיים (${status.state === 'ok' ? status.doc.host ?? '' : ''}).</p></div>`,
        text: 'RestoMatch job runner is back.',
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
