import {
  and,
  eq,
  inArray,
  memberships,
  recoveryClaims,
  restaurants,
  sql,
  type Database,
} from '@restomatch/db';
import { isFeatureOn } from '../lib/featureGate';
import { enqueueNotification } from '../notifications/outbox';
import { recipientsForRestaurant } from '../notifications/recipients';
import { renderEmail, ilsSpan, type RenderedEmail } from '../notifications/templates';
import { formatIlsAgorot, type ReportLocale } from '../reports/money';
import { AWAITING_SUPPLIER } from './lifecycle';
import { OVERDUE_DAYS, REMIND_EVERY_DAYS, syncClaims } from './service';

/**
 * Overdue-claim reminders: a claim still waiting on the supplier more than
 * OVERDUE_DAYS after the letter (or the claim, if no letter went out) is
 * chased once every REMIND_EVERY_DAYS. One email per manager per restaurant per
 * day, listing the suppliers to chase — delivered through the outbox
 * (enqueueNotification; outbox-dispatch sends it), deduped by day.
 */

export interface OverdueSupplier {
  supplierName: string;
  supplierNameEn: string | null;
  count: number;
  outstandingAgorot: number;
  oldestDays: number;
}

export async function findOverdue(
  db: Database,
  restaurantId: string,
  now: Date,
): Promise<{ claimIds: string[]; suppliers: OverdueSupplier[] }> {
  const res = await db.execute(sql`
    SELECT c.id, c.supplier_id, COALESCE(s.name, '—') AS supplier_name, s.name_en AS supplier_name_en,
           GREATEST(0, c.amount_agorot - c.credited_agorot) AS outstanding,
           floor(extract(epoch FROM (${now.toISOString()}::timestamptz - COALESCE(c.letter_sent_at, c.claimed_at))) / 86400)::int AS waiting
    FROM recovery_claims c
    LEFT JOIN suppliers s ON s.id = c.supplier_id AND s.restaurant_id = ${restaurantId}
    WHERE c.restaurant_id = ${restaurantId}
      AND c.status IN (${sql.join(AWAITING_SUPPLIER.map((s) => sql`${s}`), sql`, `)})
      AND COALESCE(c.letter_sent_at, c.claimed_at) < ${now.toISOString()}::timestamptz - make_interval(days => ${OVERDUE_DAYS})
      AND (c.last_reminder_at IS NULL
           OR c.last_reminder_at < ${now.toISOString()}::timestamptz - make_interval(days => ${REMIND_EVERY_DAYS}))
    ORDER BY waiting DESC
  `);
  const rows = (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>;
  const bySupplier = new Map<string, OverdueSupplier>();
  for (const r of rows) {
    const key = String(r.supplier_id ?? r.supplier_name);
    const s = bySupplier.get(key) ?? {
      supplierName: String(r.supplier_name),
      supplierNameEn: (r.supplier_name_en as string | null) ?? null,
      count: 0,
      outstandingAgorot: 0,
      oldestDays: 0,
    };
    s.count += 1;
    s.outstandingAgorot += Number(r.outstanding);
    s.oldestDays = Math.max(s.oldestDays, Number(r.waiting));
    bySupplier.set(key, s);
  }
  return {
    claimIds: rows.map((r) => String(r.id)),
    suppliers: [...bySupplier.values()].sort((a, b) => b.outstandingAgorot - a.outstandingAgorot),
  };
}

export function recoveryReminderEmail(args: {
  suppliers: OverdueSupplier[];
  locale?: ReportLocale;
  trackerUrl?: string;
}): RenderedEmail {
  const en = args.locale === 'en';
  const locale: ReportLocale = en ? 'en' : 'he';
  const total = args.suppliers.reduce((s, x) => s + x.outstandingAgorot, 0);
  const count = args.suppliers.reduce((s, x) => s + x.count, 0);
  const ils = (a: number) => formatIlsAgorot(a, { locale });
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const name = (s: OverdueSupplier) => (en && s.supplierNameEn ? s.supplierNameEn : s.supplierName);
  const subject = en
    ? `${count} credit requests are overdue (${ils(total)})`
    : `${count} דרישות זיכוי באיחור (${ils(total)})`;
  const items = args.suppliers
    .map((s) =>
      en
        ? `<li><strong>${esc(name(s))}</strong> — ${ilsSpan(ils(s.outstandingAgorot), 'danger')} · ${s.count} · ${s.oldestDays} days</li>`
        : `<li><strong>${esc(name(s))}</strong> — ${ilsSpan(ils(s.outstandingAgorot), 'danger')} · ${s.count} · ${s.oldestDays} ימים</li>`,
    )
    .join('');
  const html = renderEmail({
    locale,
    accent: '#dc2626',
    preview: subject,
    heading: en ? 'Suppliers still owe you money' : 'ספקים עדיין חייבים לך כסף',
    bodyHtml: `<p style="margin:0 0 8px">${
      en
        ? `No credit note has arrived for more than ${OVERDUE_DAYS} days. A short call usually closes it:`
        : `לא התקבלה תעודת זיכוי כבר יותר מ-${OVERDUE_DAYS} ימים. שיחה קצרה בדרך כלל סוגרת את זה:`
    }</p><ul style="margin:6px 0 10px">${items}</ul>`,
    cta: args.trackerUrl ? { label: en ? 'Open the ₪-back tracker' : 'פתיחת מעקב ה-₪ החוזר', url: args.trackerUrl } : undefined,
  });
  const text = [
    subject,
    '',
    ...args.suppliers.map((s) => `• ${name(s)} — ${ils(s.outstandingAgorot)} (${s.count})`),
    ...(args.trackerUrl ? ['', args.trackerUrl] : []),
  ].join('\n');
  return { subject, html, text };
}

/**
 * Enqueue today's reminders for every restaurant with the `recovery` flag on
 * (or one restaurant). Runs on the worker's service connection; every query is
 * filtered by the restaurant being processed.
 */
export async function enqueueRecoveryReminders(
  db: Database,
  opts: { now?: Date; restaurantId?: string; appUrl?: string } = {},
): Promise<{ restaurants: number; emails: number; claims: number; failed: string[] }> {
  const now = opts.now ?? new Date();
  const day = now.toISOString().slice(0, 10);
  const rows = opts.restaurantId
    ? await db.select({ id: restaurants.id }).from(restaurants).where(eq(restaurants.id, opts.restaurantId))
    : await db.select({ id: restaurants.id }).from(restaurants);
  let emails = 0;
  let claims = 0;
  let processed = 0;
  const failed: string[] = [];
  for (const r of rows) {
    // One bad tenant must not stop the reminders of every restaurant after it.
    try {
      if (!(await isFeatureOn(db, r.id, 'recovery'))) continue;
      processed += 1;
      // Interim catch-up (a job, not a read): claims are materialised at
      // decision time once W2-04 calls materializeClaims inside approve; until
      // then this daily pass creates the missing ones, attributed to the
      // decider (resolved_by) and dated at the decision (resolved_at).
      // TODO(W2-04/W2-10): drop this call once approve materialises claims.
      await syncClaims(db, r.id);
      const overdue = await findOverdue(db, r.id, now);
      if (overdue.claimIds.length === 0) continue;
      const recipients = await recipientsForRestaurant(db, r.id);
      const locales = new Map(
        (
          await db
            .select({ userId: memberships.userId, locale: memberships.preferredLocale })
            .from(memberships)
            .where(eq(memberships.restaurantId, r.id))
        ).map((m) => [m.userId, m.locale]),
      );
      for (const to of recipients) {
        const email = recoveryReminderEmail({
          suppliers: overdue.suppliers,
          locale: locales.get(to.userId) === 'en' ? 'en' : 'he',
          trackerUrl: opts.appUrl ? `${opts.appUrl}/dashboard/recovery` : undefined,
        });
        const { deduped } = await enqueueNotification(db, {
          restaurantId: r.id,
          channel: 'email',
          target: to.email,
          subject: email.subject,
          body: email.text,
          html: email.html,
          relatedEntityType: 'restaurant',
          relatedEntityId: r.id,
          dedupeKey: `recovery-reminder:${r.id}:${day}:${to.email}`,
        });
        if (!deduped) emails += 1;
      }
      await db
        .update(recoveryClaims)
        .set({ lastReminderAt: now })
        .where(and(eq(recoveryClaims.restaurantId, r.id), inArray(recoveryClaims.id, overdue.claimIds)));
      claims += overdue.claimIds.length;
    } catch (err) {
      failed.push(r.id);
      console.error(`[recovery-reminders] restaurant=${r.id} failed`, err);
    }
  }
  return { restaurants: processed, emails, claims, failed };
}
