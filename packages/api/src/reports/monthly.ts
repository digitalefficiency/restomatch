import { computeLeakReport } from '@restomatch/charts';
import { and, eq, monthlyReports, restaurants, sql, type Database } from '@restomatch/db';
import { renderEmail, ilsSpan, type RenderedEmail } from '../notifications/templates';
import { computeRecoverySummary, returnedInMonth } from '../recovery/service';
import { formatIlsAgorot, formatPct, ilsToAgorot, type ReportLocale } from './money';

/**
 * The monthly "one number" report: last month's leak in ₪ and % of spend,
 * what was caught, claimed and actually returned, the top 3 suppliers and the
 * top 3 issues, plus next actions. All money is INTEGER AGOROT in the
 * snapshot; ₪ strings exist only in the renderers below.
 *
 * Numbers come from the same SQL as the dashboard (charts leak-report → the
 * hero), so the email, WhatsApp text, PDF and dashboard always agree.
 */

export interface MonthlyReportSupplier {
  name: string;
  nameEn: string | null;
  leakAgorot: number;
  leakPct: number | null;
}

export interface MonthlyReportIssue {
  type: string;
  count: number;
  amountAgorot: number;
}

export type NextActionCode =
  | 'chaseOverdue'
  | 'decideOpen'
  | 'sendClaims'
  | 'linkPending'
  | 'talkToSupplier'
  | 'allClear';

export interface NextAction {
  code: NextActionCode;
  params: Record<string, string | number>;
}

export interface MonthlyReportData {
  version: 1;
  /** 'YYYY-MM' of the reported month. */
  month: string;
  restaurantName: string;
  leakAgorot: number;
  spendAgorot: number;
  leakPct: number | null;
  caughtAgorot: number;
  claimedAgorot: number;
  /** Money actually back this month (claims that reached `recovered` in the month). */
  returnedAgorot: number;
  /** Still owed by suppliers on all open claims (as of generation). */
  outstandingAgorot: number;
  invoiceCount: number;
  invoicesWithLeak: number;
  pendingLinkCount: number;
  topSuppliers: MonthlyReportSupplier[];
  topIssues: MonthlyReportIssue[];
  nextActions: NextAction[];
  generatedAt: string;
}

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** 'YYYY-MM' of the month before `now` in the restaurant's timezone. */
export function previousMonthKey(now: Date, tz = 'Asia/Jerusalem'): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === 'year')!.value);
  const m = Number(parts.find((p) => p.type === 'month')!.value);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** Whole months between `month` and the local month containing `now` (≤ 0). */
function monthOffsetOf(month: string, now: Date, tz: string): number {
  const mm = MONTH_RE.exec(month);
  if (!mm) throw new Error(`invalid month "${month}"`);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === 'year')!.value);
  const m = Number(parts.find((p) => p.type === 'month')!.value);
  return (Number(mm[1]) - y) * 12 + (Number(mm[2]) - m);
}

/** Leak share at which a supplier earns a "talk to them" action (the North Star 1.5%). */
const SUPPLIER_ALERT_PCT = 0.015;

export async function computeMonthlyReport(
  db: Database,
  restaurantId: string,
  month: string,
  opts: { now?: Date } = {},
): Promise<MonthlyReportData> {
  const now = opts.now ?? new Date();
  const [r] = await db
    .select({ name: restaurants.name, timezone: restaurants.timezone })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  const tz = r?.timezone ?? 'Asia/Jerusalem';
  const report = await computeLeakReport(db, restaurantId, month);
  const [returned, recovery] = await Promise.all([
    returnedInMonth(db, restaurantId, { monthOffset: monthOffsetOf(month, now, tz), now }),
    computeRecoverySummary(db, restaurantId, now),
  ]);

  const topSuppliers = report.bySupplier
    .filter((s) => s.leakIls > 0)
    .slice(0, 3)
    .map((s) => ({
      name: s.supplierName ?? '—',
      nameEn: s.supplierNameEn,
      leakAgorot: ilsToAgorot(s.leakIls),
      leakPct: s.leakPct,
    }));
  const topIssues = report.byType
    .filter((t) => t.amountIls > 0)
    .slice(0, 3)
    .map((t) => ({ type: t.type, count: t.count, amountAgorot: ilsToAgorot(t.amountIls) }));

  const nextActions: NextAction[] = [];
  if (recovery.overdueCount > 0) {
    nextActions.push({ code: 'chaseOverdue', params: { count: recovery.overdueCount, agorot: recovery.overdueAgorot } });
  }
  if (report.status.stillOpenCount > 0) {
    nextActions.push({
      code: 'decideOpen',
      params: { count: report.status.stillOpenCount, agorot: ilsToAgorot(report.status.stillOpenIls) },
    });
  }
  const unsent = recovery.byStatus.claimed;
  if (unsent.count > 0) nextActions.push({ code: 'sendClaims', params: { count: unsent.count, agorot: unsent.agorot } });
  if (report.hero.pendingLinkCount > 0) {
    nextActions.push({ code: 'linkPending', params: { count: report.hero.pendingLinkCount } });
  }
  const loud = topSuppliers.find((s) => (s.leakPct ?? 0) >= SUPPLIER_ALERT_PCT);
  if (loud) {
    nextActions.push({
      code: 'talkToSupplier',
      params: { supplier: loud.name, supplierEn: loud.nameEn ?? loud.name, pct: loud.leakPct ?? 0 },
    });
  }
  if (nextActions.length === 0) nextActions.push({ code: 'allClear', params: {} });

  return {
    version: 1,
    month,
    restaurantName: r?.name ?? '',
    leakAgorot: ilsToAgorot(report.hero.leakIls),
    spendAgorot: ilsToAgorot(report.hero.spendIls),
    leakPct: report.hero.leakPct,
    caughtAgorot: ilsToAgorot(report.hero.caughtBeforePaymentIls),
    claimedAgorot: ilsToAgorot(report.status.claimedIls),
    returnedAgorot: returned.returnedAgorot,
    outstandingAgorot: recovery.outstandingAgorot,
    invoiceCount: report.hero.invoiceCount,
    invoicesWithLeak: report.hero.invoicesWithLeak,
    pendingLinkCount: report.hero.pendingLinkCount,
    topSuppliers,
    topIssues,
    nextActions: nextActions.slice(0, 4),
    generatedAt: now.toISOString(),
  };
}

/**
 * Freeze a month's report (one row per restaurant-month). Re-running returns
 * the stored snapshot unless `refresh` is set — the cron job is idempotent.
 */
export async function ensureMonthlyReport(
  db: Database,
  restaurantId: string,
  month: string,
  opts: { now?: Date; refresh?: boolean } = {},
): Promise<{ id: string; data: MonthlyReportData; sentAt: Date | null; created: boolean }> {
  const monthDate = `${month}-01`;
  const [existing] = await db
    .select()
    .from(monthlyReports)
    .where(and(eq(monthlyReports.restaurantId, restaurantId), eq(monthlyReports.month, monthDate)))
    .limit(1);
  if (existing && !opts.refresh) {
    return { id: existing.id, data: existing.snapshot as unknown as MonthlyReportData, sentAt: existing.sentAt, created: false };
  }
  const data = await computeMonthlyReport(db, restaurantId, month, opts);
  const [row] = await db
    .insert(monthlyReports)
    .values({ restaurantId, month: monthDate, snapshot: data as unknown as Record<string, unknown> })
    .onConflictDoUpdate({
      target: [monthlyReports.restaurantId, monthlyReports.month],
      set: { snapshot: data as unknown as Record<string, unknown>, generatedAt: sql`now()` },
    })
    .returning();
  return { id: row!.id, data, sentAt: row!.sentAt, created: !existing };
}

/* ───────────────────────────── vocabulary ───────────────────────────── */

const ISSUE_LABELS: Record<ReportLocale, Record<string, string>> = {
  he: {
    PRICE_HIGHER: 'מחיר גבוה מהמצופה',
    PRICE_LOWER: 'מחיר נמוך מהמצופה',
    QTY_SHORT: 'חסר בכמות שהתקבלה',
    QTY_OVER: 'חיוב על יותר ממה שהתקבל',
    UNORDERED_ITEM: 'פריט בחשבונית ללא הזמנה',
    MISSING_ON_INVOICE: 'שורת הזמנה לא חויבה',
    UNIT_MISMATCH: 'אי-התאמת יחידות',
    UNORDERED_ARRIVAL: 'ממתינה לשיוך להזמנה',
    DUPLICATE_INVOICE: 'חשבונית כפולה',
    DATE_ANOMALY: 'תאריך חריג',
    VAT_MISMATCH: 'אי-התאמת מע״מ',
    TOTAL_MISMATCH: 'סה״כ לא תואם לשורות',
  },
  en: {
    PRICE_HIGHER: 'Price above expected',
    PRICE_LOWER: 'Price below expected',
    QTY_SHORT: 'Short delivery',
    QTY_OVER: 'Billed for more than received',
    UNORDERED_ITEM: 'Item not on the order',
    MISSING_ON_INVOICE: 'Ordered line not billed',
    UNIT_MISMATCH: 'Unit mismatch',
    UNORDERED_ARRIVAL: 'Waiting for a PO link',
    DUPLICATE_INVOICE: 'Duplicate invoice',
    DATE_ANOMALY: 'Unusual date',
    VAT_MISMATCH: 'VAT mismatch',
    TOTAL_MISMATCH: 'Total does not match lines',
  },
};

export function issueLabel(type: string, locale: ReportLocale): string {
  return ISSUE_LABELS[locale][type] ?? type;
}

const COPY = {
  he: {
    title: 'הדוח החודשי',
    oneNumber: (amount: string, pct: string) => `${amount} דלפו בחודש שעבר · ${pct} מהרכש`,
    leak: 'דליפה',
    ofSpend: 'מהרכש',
    spend: 'רכש שנבדק',
    caught: 'נתפס לפני תשלום',
    claimed: 'נדרש מהספקים',
    returned: 'חזר בפועל',
    outstanding: 'עדיין חייבים לך',
    topSuppliers: '3 הספקים המובילים בדליפה',
    topSupplier: 'הספק המוביל בדליפה',
    topIssues: '3 הבעיות הנפוצות',
    nextActions: 'הצעדים הבאים',
    noLeak: 'לא נמצאה דליפה החודש',
    cta: 'פתיחת הדוח המלא',
    footer: 'RestoMatch · מוקד הבקרה של הכסף',
    action: {
      chaseOverdue: (p: Params, f: Fmt) => `לתזכר ${p.count} דרישות זיכוי באיחור (${f.ils(p.agorot ?? 0)})`,
      decideOpen: (p: Params, f: Fmt) => `להחליט על ${p.count} פערים פתוחים (${f.ils(p.agorot ?? 0)})`,
      sendClaims: (p: Params, f: Fmt) => `לשלוח מכתבי דרישה על ${p.count} פערים (${f.ils(p.agorot ?? 0)})`,
      linkPending: (p: Params) => `לשייך ${p.count} חשבוניות ממתינות להזמנה`,
      talkToSupplier: (p: Params, f: Fmt) => `לשוחח עם ${p.supplier} — דליפה של ${f.pct(Number(p.pct))} מהרכש`,
      allClear: () => 'אין משימות פתוחות — כל הכבוד',
    },
  },
  en: {
    title: 'Monthly report',
    oneNumber: (amount: string, pct: string) => `${amount} leaked last month · ${pct} of spend`,
    leak: 'Leak',
    ofSpend: 'of spend',
    spend: 'Checked spend',
    caught: 'Caught before payment',
    claimed: 'Claimed from suppliers',
    returned: 'Actually returned',
    outstanding: 'Still owed to you',
    topSuppliers: 'Top 3 suppliers by leak',
    topSupplier: 'Top supplier by leak',
    topIssues: 'Top 3 issues',
    nextActions: 'Next actions',
    noLeak: 'No leak found this month',
    cta: 'Open the full report',
    footer: 'RestoMatch · Command center for your money',
    action: {
      chaseOverdue: (p: Params, f: Fmt) => `Chase ${p.count} overdue credit requests (${f.ils(p.agorot ?? 0)})`,
      decideOpen: (p: Params, f: Fmt) => `Decide on ${p.count} open discrepancies (${f.ils(p.agorot ?? 0)})`,
      sendClaims: (p: Params, f: Fmt) => `Send claim letters for ${p.count} discrepancies (${f.ils(p.agorot ?? 0)})`,
      linkPending: (p: Params) => `Link ${p.count} pending invoices to their orders`,
      talkToSupplier: (p: Params, f: Fmt) => `Talk to ${p.supplierEn} — ${f.pct(Number(p.pct))} of spend leaked`,
      allClear: () => 'Nothing open — well done',
    },
  },
} as const;

type Params = Record<string, string | number>;
interface Fmt {
  ils: (agorot: string | number) => string;
  pct: (r: number | null) => string;
}

export function reportCopy(locale: ReportLocale) {
  return COPY[locale];
}

export function reportFormatter(locale: ReportLocale): Fmt {
  return {
    ils: (a) => formatIlsAgorot(Number(a), { locale }),
    pct: (r) => formatPct(r, locale),
  };
}

export function monthLabel(month: string, locale: ReportLocale): string {
  const [y, m] = month.split('-').map(Number);
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'he-IL', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y!, m! - 1, 15)));
}

export function supplierLabel(s: MonthlyReportSupplier, locale: ReportLocale): string {
  return locale === 'en' && s.nameEn ? s.nameEn : s.name;
}

export function nextActionText(a: NextAction, locale: ReportLocale): string {
  const fn = COPY[locale].action[a.code] as (p: Params, f: Fmt) => string;
  return fn(a.params, reportFormatter(locale));
}

/* ───────────────────────────── renderers ───────────────────────────── */

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Email (he RTL / en LTR) through the shared brand frame (notifications/templates). */
export function monthlyReportEmail(
  data: MonthlyReportData,
  opts: { locale?: ReportLocale; reportUrl?: string } = {},
): RenderedEmail {
  const locale = opts.locale ?? 'he';
  const c = COPY[locale];
  const f = reportFormatter(locale);
  const align = locale === 'en' ? 'left' : 'right';
  const opp = locale === 'en' ? 'right' : 'left';
  const month = monthLabel(data.month, locale);
  const headline = c.oneNumber(f.ils(data.leakAgorot), f.pct(data.leakPct));
  const row = (label: string, value: string) =>
    `<tr><td style="padding:7px 0;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:14px;text-align:${align}">${esc(label)}</td>` +
    `<td style="padding:7px 0;border-bottom:1px solid #e2e8f0;font-size:15px;text-align:${opp};white-space:nowrap">${value}</td></tr>`;
  const list = (items: string[]) =>
    items.length
      ? `<ol style="margin:4px 0 10px;padding-${align}:20px">${items.map((i) => `<li style="margin:3px 0">${i}</li>`).join('')}</ol>`
      : `<p style="margin:4px 0 10px;color:#64748b">${esc(c.noLeak)}</p>`;
  const h2 = (t: string) => `<h2 style="margin:16px 0 4px;font-size:15px;color:#0f172a;text-align:${align}">${esc(t)}</h2>`;

  const bodyHtml = `
    <p style="margin:0 0 8px;font-size:17px;font-weight:700">${ilsSpan(f.ils(data.leakAgorot), 'danger')} · ${esc(f.pct(data.leakPct))} ${esc(c.ofSpend)}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0">
      ${row(c.spend, ilsSpan(f.ils(data.spendAgorot)))}
      ${row(c.caught, ilsSpan(f.ils(data.caughtAgorot), 'gold'))}
      ${row(c.claimed, ilsSpan(f.ils(data.claimedAgorot)))}
      ${row(c.returned, ilsSpan(f.ils(data.returnedAgorot), 'gold'))}
      ${row(c.outstanding, ilsSpan(f.ils(data.outstandingAgorot), 'danger'))}
    </table>
    ${h2(c.topSuppliers)}
    ${list(data.topSuppliers.map((s) => `<strong>${esc(supplierLabel(s, locale))}</strong> — ${ilsSpan(f.ils(s.leakAgorot), 'danger')} (${esc(f.pct(s.leakPct))})`))}
    ${h2(c.topIssues)}
    ${list(data.topIssues.map((i) => `${esc(issueLabel(i.type, locale))} — ${ilsSpan(f.ils(i.amountAgorot))} · ${i.count}`))}
    ${h2(c.nextActions)}
    ${list(data.nextActions.map((a) => esc(nextActionText(a, locale))))}`;

  const html = renderEmail({
    locale,
    accent: '#dc2626',
    preview: headline,
    heading: `${c.title} · ${month}`,
    bodyHtml,
    cta: opts.reportUrl ? { label: c.cta, url: opts.reportUrl } : undefined,
  });

  const text = [
    `${c.title} · ${month} · ${data.restaurantName}`,
    '',
    headline,
    `${c.spend}: ${f.ils(data.spendAgorot)}`,
    `${c.caught}: ${f.ils(data.caughtAgorot)}`,
    `${c.claimed}: ${f.ils(data.claimedAgorot)}`,
    `${c.returned}: ${f.ils(data.returnedAgorot)}`,
    `${c.outstanding}: ${f.ils(data.outstandingAgorot)}`,
    '',
    `${c.topSuppliers}:`,
    ...data.topSuppliers.map((s, i) => `${i + 1}. ${supplierLabel(s, locale)} — ${f.ils(s.leakAgorot)} (${f.pct(s.leakPct)})`),
    '',
    `${c.topIssues}:`,
    ...data.topIssues.map((x, i) => `${i + 1}. ${issueLabel(x.type, locale)} — ${f.ils(x.amountAgorot)}`),
    '',
    `${c.nextActions}:`,
    ...data.nextActions.map((a) => `• ${nextActionText(a, locale)}`),
    ...(opts.reportUrl ? ['', opts.reportUrl] : []),
  ].join('\n');

  return { subject: `${c.title} · ${month} — ${headline}`, html, text };
}

/** WhatsApp-length text (≤ 700 chars): the one number, money flow, top supplier, first action. */
export const WHATSAPP_MAX = 700;
export function monthlyReportWhatsApp(
  data: MonthlyReportData,
  opts: { locale?: ReportLocale; reportUrl?: string } = {},
): string {
  const locale = opts.locale ?? 'he';
  const c = COPY[locale];
  const f = reportFormatter(locale);
  const lines = [
    `*${c.title} · ${monthLabel(data.month, locale)}*`,
    c.oneNumber(f.ils(data.leakAgorot), f.pct(data.leakPct)),
    `${c.caught}: ${f.ils(data.caughtAgorot)} · ${c.claimed}: ${f.ils(data.claimedAgorot)} · ${c.returned}: ${f.ils(data.returnedAgorot)}`,
  ];
  const top = data.topSuppliers[0];
  if (top) lines.push(`${c.topSupplier}: ${supplierLabel(top, locale)} (${f.ils(top.leakAgorot)})`);
  const first = data.nextActions[0];
  if (first) lines.push(`➜ ${nextActionText(first, locale)}`);
  if (opts.reportUrl) lines.push(opts.reportUrl);
  let text = lines.join('\n');
  if (text.length > WHATSAPP_MAX) text = `${text.slice(0, WHATSAPP_MAX - 1)}…`;
  return text;
}
