import { TRPCError } from '@trpc/server';
import {
  and,
  eq,
  inArray,
  memberships,
  recoveryClaims,
  restaurants,
  sql,
  suppliers,
  type Database,
  type UserRole,
} from '@restomatch/db';
import { isFeatureOn } from '../lib/featureGate';
import { enqueueNotification } from '../notifications/outbox';
import { MANAGER_ROLES, recipientsForRestaurant } from '../notifications/recipients';
import { renderEmail, ilsSpan, type RenderedEmail } from '../notifications/templates';
import type { ReportLocale } from '../reports/money';
import { chaseMoney, ddMM, validEmail, waPhoneE164 } from './chase';
import { creditSuggestions } from './creditSuggest';
import { CHASE_DEFAULTS, awaitingChaseSql, chaseKindOf, rechaseDueSql, type ChaseKind, type ChaseOptions } from './overdue';
import { OVERDUE_DAYS, syncClaims } from './service';

/**
 * AU-03 · the 08:30 recovery digest (catalogue A12). A claim still waiting on
 * the supplier MORE than CLAIM_ANSWER_DAYS whole Israel days after the letter
 * (or the claim, if no letter went out) is in the digest — one predicate for
 * the job, the tracker and the web banner (recovery/overdue.ts). A digest goes
 * out only when at least one listed claim was not chased in the last
 * REMIND_EVERY_DAYS; it then lists EVERY waiting claim, so its count and ₪
 * equal the home row's. One e-mail per person per restaurant per Israel day,
 * to owner + manager (+ bookkeeper, opt-in, default on), through the outbox.
 * Nothing is sent to a supplier: each supplier line links to a click-only
 * DRAFT on the recovery desk.
 */

export interface OverdueSupplier {
  supplierId: string | null;
  supplierName: string;
  supplierNameEn: string | null;
  /** How the supplier's waiting claims are shown (no reply / acknowledged). Unsent letters are never chased. */
  kind: ChaseKind;
  count: number;
  outstandingAgorot: number;
  oldestDays: number;
  /** The supplier's latest letter among these claims (display only; membership is per claim). */
  latestLetterAt: string | null;
}

export interface OverdueResult {
  /** Every claim in the digest (stamped `last_reminder_at` when a digest is enqueued). */
  claimIds: string[];
  /** Claims not chased in the last REMIND_EVERY_DAYS: a digest goes out only when this is non-empty. */
  dueClaimIds: string[];
  suppliers: OverdueSupplier[];
  totalAgorot: number;
  count: number;
}

/** AU-01 interim: a restaurant's automation option (settings.automations.<key>), else the AU-03 default. */
export function chaseOptionsFor(settings: unknown): { chaseAcknowledged: boolean; recoveryBookkeeper: boolean } {
  const a = (settings as { automations?: Record<string, unknown> } | null)?.automations ?? {};
  const pick = (k: keyof typeof CHASE_DEFAULTS) => (typeof a[k] === 'boolean' ? (a[k] as boolean) : CHASE_DEFAULTS[k]);
  return { chaseAcknowledged: pick('chaseAcknowledged'), recoveryBookkeeper: pick('recoveryBookkeeper') };
}

export async function findOverdue(
  db: Database,
  restaurantId: string,
  now: Date,
  opts: ChaseOptions = {},
): Promise<OverdueResult> {
  const res = await db.execute(sql`
    SELECT c.id, c.status, c.supplier_id, COALESCE(s.name, '—') AS supplier_name, s.name_en AS supplier_name_en,
           GREATEST(0, c.amount_agorot - c.credited_agorot) AS outstanding,
           c.letter_sent_at,
           ((${now.toISOString()}::timestamptz AT TIME ZONE tz.tz)::date
             - (COALESCE(c.letter_sent_at, c.claimed_at) AT TIME ZONE tz.tz)::date) AS waiting,
           ${rechaseDueSql(now, sql`tz.tz`)} AS due
    FROM recovery_claims c
    CROSS JOIN (SELECT COALESCE(timezone, 'Asia/Jerusalem') AS tz FROM restaurants WHERE id = ${restaurantId}) tz
    JOIN discrepancies d ON d.id = c.discrepancy_id AND d.restaurant_id = ${restaurantId}
    LEFT JOIN suppliers s ON s.id = c.supplier_id AND s.restaurant_id = ${restaurantId}
    WHERE c.restaurant_id = ${restaurantId}
      AND ${awaitingChaseSql(now, sql`tz.tz`, opts)}
    ORDER BY waiting DESC, c.id
  `);
  const rows = (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>;
  const groups = new Map<string, OverdueSupplier>();
  for (const r of rows) {
    const kind = chaseKindOf(String(r.status));
    const key = `${String(r.supplier_id ?? r.supplier_name)}:${kind}`;
    const g = groups.get(key) ?? {
      supplierId: (r.supplier_id as string | null) ?? null,
      supplierName: String(r.supplier_name),
      supplierNameEn: (r.supplier_name_en as string | null) ?? null,
      kind,
      count: 0,
      outstandingAgorot: 0,
      oldestDays: 0,
      latestLetterAt: null,
    };
    g.count += 1;
    g.outstandingAgorot += Number(r.outstanding);
    g.oldestDays = Math.max(g.oldestDays, Number(r.waiting));
    const sent = r.letter_sent_at ? new Date(r.letter_sent_at as string).toISOString() : null;
    if (sent && (!g.latestLetterAt || sent > g.latestLetterAt)) g.latestLetterAt = sent;
    groups.set(key, g);
  }
  const suppliers = [...groups.values()].sort((a, b) => b.outstandingAgorot - a.outstandingAgorot || a.supplierName.localeCompare(b.supplierName));
  return {
    claimIds: rows.map((r) => String(r.id)),
    dueClaimIds: rows.filter((r) => r.due === true || r.due === 't').map((r) => String(r.id)),
    suppliers,
    totalAgorot: suppliers.reduce((s, x) => s + x.outstandingAgorot, 0),
    count: rows.length,
  };
}

const KIND_ORDER: ChaseKind[] = ['no_reply', 'acknowledged'];

/**
 * Desk landing links (train-C gate 11.11: "recovery digest links land on the
 * right desk row"). The recovery desk opens the supplier reminder drafts only
 * on ?tab=track&remind=1 (owner decision 16) and anchors them at
 * #reminder-drafts; the credit lines waiting for a human confirm sit in the
 * desk card anchored at #credit-suggestions (W3-11 "שיוך זיכוי").
 */
export const DESK_REMINDERS_PATH = '/dashboard/recovery?tab=track&remind=1#reminder-drafts';
export const DESK_CREDIT_SUGGESTIONS_PATH = '/dashboard/recovery?tab=track#credit-suggestions';

export function recoveryReminderEmail(args: {
  suppliers: OverdueSupplier[];
  locale?: ReportLocale;
  /** Base URL of the app; supplier draft links go through /dashboard/go so the right restaurant opens. */
  appUrl?: string;
  restaurantId?: string;
  /** Legacy: the tracker link (kept for callers that pass it). */
  trackerUrl?: string;
  /** Credit lines waiting for a human confirm (AU-03 credit suggestion). */
  creditSuggestions?: { count: number; agorot: number };
}): RenderedEmail {
  const en = args.locale === 'en';
  const locale: ReportLocale = en ? 'en' : 'he';
  const total = args.suppliers.reduce((s, x) => s + x.outstandingAgorot, 0);
  const supplierCount = new Set(args.suppliers.map((s) => s.supplierId ?? s.supplierName)).size;
  const ils = (a: number) => chaseMoney(a, locale);
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const name = (s: OverdueSupplier) => (en && s.supplierNameEn ? s.supplierNameEn : s.supplierName);
  const go = (to: string) =>
    args.appUrl
      ? args.restaurantId
        ? `${args.appUrl}/dashboard/go?r=${encodeURIComponent(args.restaurantId)}&to=${encodeURIComponent(to)}`
        : `${args.appUrl}${to}`
      : null;
  const trackerUrl = go('/dashboard/recovery') ?? args.trackerUrl ?? null;
  const subject = en
    ? `Credit requests waiting ${OVERDUE_DAYS}+ days · ${supplierCount} ${supplierCount === 1 ? 'supplier' : 'suppliers'} · ${ils(total)}`
    : `בקשות זיכוי שממתינות ${OVERDUE_DAYS}+ ימים · ${supplierCount === 1 ? 'ספק אחד' : `${supplierCount} ספקים`} · ${ils(total)}`;
  const heading: Record<ChaseKind, string> = en
    ? { no_reply: `No reply for ${OVERDUE_DAYS}+ days`, acknowledged: 'Supplier agreed · credit invoice not received yet' }
    : { no_reply: `אין תשובה ${OVERDUE_DAYS}+ ימים`, acknowledged: 'הספק אישר · ממתינים לחשבונית זיכוי' };
  const lineOf = (s: OverdueSupplier): { text: string; href: string | null; cta: string } => {
    const n = en ? `${s.count} ${s.count === 1 ? 'request' : 'requests'}` : s.count === 1 ? 'בקשה אחת' : `${s.count} בקשות`;
    const when = s.latestLetterAt ? (en ? `letter sent ${ddMM(s.latestLetterAt)}` : `מכתב נשלח ${ddMM(s.latestLetterAt)}`) : '';
    const text = [name(s), n, ils(s.outstandingAgorot), when].filter(Boolean).join(' · ');
    const href = go(DESK_REMINDERS_PATH);
    const cta = en ? 'Prepare a reminder' : 'הכנת תזכורת';
    return { text, href, cta };
  };
  const sections = KIND_ORDER.map((k) => ({ k, rows: args.suppliers.filter((s) => s.kind === k) })).filter((x) => x.rows.length);
  const sectionsHtml = sections
    .map(
      ({ k, rows }) =>
        `<p style="margin:10px 0 4px"><strong>${esc(heading[k])}</strong></p><ul style="margin:0 0 8px">${rows
          .map((s) => {
            const l = lineOf(s);
            const parts = l.text.split(ils(s.outstandingAgorot));
            return `<li>${parts.map(esc).join(ilsSpan(ils(s.outstandingAgorot), 'ink'))}${
              l.href ? ` · <a href="${esc(l.href)}">${esc(l.cta)}</a>` : ''
            }</li>`;
          })
          .join('')}</ul>`,
    )
    .join('');
  const cs = args.creditSuggestions && args.creditSuggestions.count > 0 ? args.creditSuggestions : null;
  const csLine = cs
    ? en
      ? `Credits waiting for your confirmation: ${cs.count} · ${ils(cs.agorot)}`
      : `זיכויים שמחכים לאישור: ${cs.count} · ${ils(cs.agorot)}`
    : null;
  const csHref = cs ? go(DESK_CREDIT_SUGGESTIONS_PATH) : null;
  const html = renderEmail({
    locale,
    accent: '#b45309',
    preview: subject,
    heading: en ? 'Credit requests waiting for a reply' : 'בקשות זיכוי שממתינות לתשובה',
    bodyHtml: `<p style="margin:0 0 8px">${
      en
        ? `No credit invoice has arrived for more than ${OVERDUE_DAYS} days. A reminder draft is ready for each supplier — nothing is sent until you send it:`
        : `לא הגיעה חשבונית זיכוי כבר יותר מ-${OVERDUE_DAYS} ימים. לכל ספק מוכנה טיוטת תזכורת — שום דבר לא נשלח עד שתשלחו בעצמכם:`
    }</p>${sectionsHtml}${
      csLine ? `<p style="margin:10px 0 0">${esc(csLine)}${csHref ? ` · <a href="${esc(csHref)}">${en ? 'Review' : 'לבדיקה'}</a>` : ''}</p>` : ''
    }`,
    cta: trackerUrl ? { label: en ? 'Open credit requests' : 'פתיחת בקשות הזיכוי', url: trackerUrl } : undefined,
  });
  const text = [
    subject,
    ...sections.flatMap(({ k, rows }) => ['', heading[k], ...rows.map((s) => {
      const l = lineOf(s);
      return `• ${l.text}${l.href ? ` — ${l.cta}: ${l.href}` : ''}`;
    })]),
    ...(csLine ? ['', `${csLine}${csHref ? ` — ${csHref}` : ''}`] : []),
    ...(trackerUrl ? ['', trackerUrl] : []),
  ].join('\n');
  return { subject, html, text };
}

/** Israel calendar date (YYYY-MM-DD) of an instant — the digest's dedupe day. */
export function israelDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
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
  const day = israelDate(now);
  const rows = opts.restaurantId
    ? await db.select({ id: restaurants.id, settings: restaurants.settings }).from(restaurants).where(eq(restaurants.id, opts.restaurantId))
    : await db.select({ id: restaurants.id, settings: restaurants.settings }).from(restaurants);
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
      const options = chaseOptionsFor(r.settings);
      const overdue = await findOverdue(db, r.id, now, { chaseAcknowledged: options.chaseAcknowledged });
      if (overdue.dueClaimIds.length === 0) continue;
      // Fixed role list: the receiver and the chef never get a ₪ digest.
      const roles: UserRole[] = options.recoveryBookkeeper ? [...MANAGER_ROLES, 'bookkeeper'] : [...MANAGER_ROLES];
      const recipients = await recipientsForRestaurant(db, r.id, roles);
      const suggestions = await creditSuggestions(db, r.id);
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
          appUrl: opts.appUrl,
          restaurantId: r.id,
          creditSuggestions: {
            count: suggestions.length,
            agorot: suggestions.reduce((s, x) => s + x.amountAgorot, 0),
          },
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
          // AU-07 KPI prefix: au:A12. One digest per person per restaurant per Israel day.
          dedupeKey: `au:A12:${r.id}:${to.userId}:${day}`,
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

export interface SupplierReminderDraft {
  supplierId: string;
  supplierName: string;
  supplierNameEn: string | null;
  /** Where the click may hand off to (wa.me / mailto); null = no contact on file. */
  whatsapp: string | null;
  email: string | null;
  count: number;
  outstandingAgorot: number;
  oldestDays: number;
  /** When the oldest overdue request went out (the letter, else the claim): the reminder's "ששלחנו ב-{date}". */
  oldestSentAt: string | null;
  claimIds: string[];
}

/**
 * Owner decision 16: an overdue reminder to a SUPPLIER is a per-supplier DRAFT
 * that the web opens in wa.me / mailto only on a click. This only reads:
 * nothing is queued, sent or stamped. A foreign or unknown supplier is NOT_FOUND.
 *
 * AU-03 (train-C gate 11.11): the claims are exactly the ONE chase predicate
 * the 08:30 digest uses (recovery/overdue.ts awaitingChaseSql): a sent letter
 * past the answer window in whole restaurant-calendar days, ₪ still owed,
 * never a never-claimable type — and never an UNSENT letter (`claimed`).
 * `acknowledged` claims count only while the restaurant's `chaseAcknowledged`
 * option is on. The hand-off contacts are pre-addressed: the WhatsApp number
 * as E.164 digits (972…; null when it cannot be a phone) and a plausible
 * e-mail (null otherwise), so the wa.me link never goes to the share picker
 * with a local 05x number.
 */
export async function supplierReminderDraft(
  db: Database,
  restaurantId: string,
  supplierId: string,
  now: Date = new Date(),
): Promise<SupplierReminderDraft> {
  const [s] = await db
    .select({ id: suppliers.id, name: suppliers.name, nameEn: suppliers.nameEn, email: suppliers.contactEmail, whatsapp: suppliers.contactWhatsapp })
    .from(suppliers)
    .where(and(eq(suppliers.id, supplierId), eq(suppliers.restaurantId, restaurantId)));
  if (!s) throw new TRPCError({ code: 'NOT_FOUND', message: 'supplier not found' });
  const [r] = await db.select({ settings: restaurants.settings }).from(restaurants).where(eq(restaurants.id, restaurantId));
  const options = chaseOptionsFor(r?.settings);
  const res = await db.execute(sql`
    SELECT c.id, GREATEST(0, c.amount_agorot - c.credited_agorot) AS outstanding,
           COALESCE(c.letter_sent_at, c.claimed_at) AS sent_at,
           ((${now.toISOString()}::timestamptz AT TIME ZONE tz.tz)::date
             - (COALESCE(c.letter_sent_at, c.claimed_at) AT TIME ZONE tz.tz)::date)::int AS waiting
    FROM recovery_claims c
    CROSS JOIN (SELECT COALESCE(timezone, 'Asia/Jerusalem') AS tz FROM restaurants WHERE id = ${restaurantId}) tz
    JOIN discrepancies d ON d.id = c.discrepancy_id AND d.restaurant_id = ${restaurantId}
    WHERE c.restaurant_id = ${restaurantId} AND c.supplier_id = ${supplierId}
      AND ${awaitingChaseSql(now, sql`tz.tz`, { chaseAcknowledged: options.chaseAcknowledged })}
    ORDER BY waiting DESC, c.id
  `);
  const rows = (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>;
  return {
    supplierId: s.id,
    supplierName: s.name,
    supplierNameEn: s.nameEn ?? null,
    whatsapp: waPhoneE164(s.whatsapp),
    email: validEmail(s.email),
    count: rows.length,
    outstandingAgorot: rows.reduce((a, r) => a + Number(r.outstanding), 0),
    oldestDays: rows.length ? Number(rows[0]!.waiting) : 0,
    oldestSentAt: rows.length ? new Date(rows[0]!.sent_at as string | Date).toISOString() : null,
    claimIds: rows.map((r) => String(r.id)),
  };
}
