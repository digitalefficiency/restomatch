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
  /** Still owed by suppliers on claims for THIS month's invoices (as of generation). */
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

type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] => (Array.isArray(res) ? (res as Row[]) : ((res as { rows?: Row[] }).rows ?? []));

/**
 * Leak by issue type with the hero's per-invoice cap: inside each invoice the
 * leak lines take, oldest first, only what is left of the invoice total — so
 * the types sum exactly to the hero leak (a ₪1,000 invoice with a ₪1,000
 * DUPLICATE and a ₪50 PRICE_HIGHER counts ₪1,000, not ₪1,050).
 */
async function cappedIssues(db: Database, restaurantId: string, lo: string, hi: string): Promise<MonthlyReportIssue[]> {
  const res = await db.execute(sql`
    WITH lines AS (
      SELECT d.type,
             round(abs(d.delta_amount) * 100)::bigint AS raw,
             round(COALESCE(i.total_incl_vat, 0) * 100)::bigint AS cap,
             SUM(round(abs(d.delta_amount) * 100)::bigint) OVER (PARTITION BY i.id ORDER BY d.created_at, d.id) AS cum
      FROM invoices i
      JOIN match_runs mr ON mr.invoice_id = i.id AND mr.restaurant_id = ${restaurantId}
      JOIN discrepancies d ON d.match_run_id = mr.id AND d.restaurant_id = ${restaurantId}
      WHERE i.restaurant_id = ${restaurantId}
        AND COALESCE(i.invoice_date, i.created_at) >= ${lo}::timestamptz
        AND COALESCE(i.invoice_date, i.created_at) < ${hi}::timestamptz
        AND d.delta_amount IS NOT NULL
        AND d.severity IN ('warn','block') AND d.type NOT IN ('PRICE_LOWER','UNORDERED_ARRIVAL')
    )
    SELECT type, COUNT(*) AS cnt, SUM(LEAST(raw, GREATEST(0, cap - (cum - raw)))) AS agorot
    FROM lines
    GROUP BY type
    HAVING SUM(LEAST(raw, GREATEST(0, cap - (cum - raw)))) > 0
    ORDER BY agorot DESC, type
  `);
  return rowsOf(res).map((r) => ({ type: String(r.type), count: Number(r.cnt), amountAgorot: Number(r.agorot) }));
}

/** What suppliers still owe on claims raised for THIS month's invoices (month-scoped, like the rest of the report). */
async function outstandingForMonth(db: Database, restaurantId: string, lo: string, hi: string): Promise<number> {
  const res = await db.execute(sql`
    SELECT COALESCE(SUM(GREATEST(0, c.amount_agorot - c.credited_agorot)), 0) AS owed
    FROM recovery_claims c
    JOIN invoices i ON i.id = c.invoice_id AND i.restaurant_id = ${restaurantId}
    WHERE c.restaurant_id = ${restaurantId}
      AND c.status IN ('claimed','letter_sent','acknowledged','credited','disputed')
      AND COALESCE(i.invoice_date, i.created_at) >= ${lo}::timestamptz
      AND COALESCE(i.invoice_date, i.created_at) < ${hi}::timestamptz
  `);
  return Number(rowsOf(res)[0]?.owed ?? 0);
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
  const [returned, recovery, issues, owedThisMonth] = await Promise.all([
    returnedInMonth(db, restaurantId, { monthOffset: monthOffsetOf(month, now, tz), now }),
    computeRecoverySummary(db, restaurantId, now),
    cappedIssues(db, restaurantId, report.hero.monthStart, report.hero.monthEnd),
    outstandingForMonth(db, restaurantId, report.hero.monthStart, report.hero.monthEnd),
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
  const topIssues = issues.slice(0, 3);

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
    // The hero's claimed figure: accepted lines, capped per invoice (never Σ raw deltas).
    claimedAgorot: ilsToAgorot(report.hero.recoveredIls),
    returnedAgorot: returned.returnedAgorot,
    outstandingAgorot: owedThisMonth,
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
  // A SENT snapshot is the record of what the owner received: never rewritten.
  if (existing && (!opts.refresh || existing.sentAt)) {
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

/**
 * The report for a month as the owner received it: the frozen snapshot when
 * the worker already generated that month, otherwise computed live (the
 * current month, or a month generated before the flag was on). Read-only.
 */
export async function loadMonthlyReport(
  db: Database,
  restaurantId: string,
  month: string,
  opts: { now?: Date } = {},
): Promise<{ data: MonthlyReportData; frozen: boolean }> {
  const [row] = await db
    .select({ snapshot: monthlyReports.snapshot })
    .from(monthlyReports)
    .where(and(eq(monthlyReports.restaurantId, restaurantId), eq(monthlyReports.month, `${month}-01`)))
    .limit(1);
  if (row) return { data: row.snapshot as unknown as MonthlyReportData, frozen: true };
  return { data: await computeMonthlyReport(db, restaurantId, month, opts), frozen: false };
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
    outstanding: 'עדיין חייבים לך (על חשבוניות החודש)',
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
    outstanding: "Still owed to you (this month's invoices)",
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
  // Truncate the body, never the link (it goes last and must survive).
  const tail = opts.reportUrl ? `\n${opts.reportUrl}` : '';
  let text = lines.join('\n');
  const room = WHATSAPP_MAX - tail.length;
  if (text.length > room) text = `${text.slice(0, Math.max(0, room - 1))}…`;
  text += tail;
  return text;
}
