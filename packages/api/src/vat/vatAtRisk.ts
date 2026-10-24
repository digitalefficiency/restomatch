import { sql, type Database } from '@restomatch/db';
import { mulIls, quantizeIls, sumIls } from '@restomatch/matching';

/**
 * VAT at risk (flag `vatAtRisk`) — Israel Invoices reform ("חשבוניות ישראל").
 *
 * A supplier TAX invoice whose amount BEFORE VAT is above the threshold in
 * force on its date, and that carries no valid allocation number (מספר הקצאה),
 * does not entitle the buyer to deduct its input VAT (VAT Law §38(א1)). Input
 * VAT must be claimed within 6 months of the invoice date, so each row carries
 * the days left to get a corrected invoice from the supplier.
 *
 * This is a SEPARATE figure from the leak: it is never added to the leak
 * hero, the leak report or claim letters (money rule — the leak is the
 * matching engine's Σ|delta|, this is a tax-compliance exposure).
 *
 * Read-only. The format check is local (9 digits); there is no Tax Authority
 * API call — a well-formed but unissued number is not detected.
 */

/** Thresholds by INVOICE DATE (Israel calendar day), most recent first. Strictly "above" the amount. */
export const ALLOCATION_THRESHOLDS: ReadonlyArray<{ from: string; aboveIls: number }> = [
  { from: '2026-06-01', aboveIls: 5_000 },
  { from: '2026-01-01', aboveIls: 10_000 },
  { from: '2025-01-01', aboveIls: 20_000 },
  // The reform's first stage started on 5 May 2024.
  { from: '2024-05-05', aboveIls: 25_000 },
];

/** Months an input-VAT deduction stays claimable after the invoice date. */
export const VAT_DEDUCTION_WINDOW_MONTHS = 6;

/** The threshold for an invoice dated `isoDay` (YYYY-MM-DD, Israel), or null before the reform. */
export function allocationThreshold(isoDay: string): number | null {
  for (const t of ALLOCATION_THRESHOLDS) if (isoDay >= t.from) return t.aboveIls;
  return null;
}

/** An allocation number is 9 digits (spaces / dashes as printed are ignored). Format only. */
export function isValidAllocationNumber(raw: string | null | undefined): boolean {
  if (!raw) return false;
  return /^\d{9}$/.test(raw.replace(/[\s-]/g, ''));
}

/** Last day the input VAT can be deducted: invoice day + 6 months (clamped to month end). */
export function deductionDeadline(isoDay: string): string {
  const [y, m, d] = isoDay.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + VAT_DEDUCTION_WINDOW_MONTHS, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** Whole days from `todayIso` to `deadlineIso` (negative once the window closed). */
export function daysBetween(todayIso: string, deadlineIso: string): number {
  return Math.round((Date.parse(`${deadlineIso}T00:00:00Z`) - Date.parse(`${todayIso}T00:00:00Z`)) / 86_400_000);
}

export type VatAtRiskPeriod = 'open' | 'this_month' | 'all';

export interface VatAtRiskRow {
  invoiceId: string;
  invoiceNumber: string | null;
  supplierId: string | null;
  supplierName: string | null;
  supplierNameEn: string | null;
  /** Israel calendar day of the invoice. */
  invoiceDate: string;
  totalExclVat: number;
  /** The VAT that cannot be deducted without an allocation number (₪). */
  vatAtRisk: number;
  thresholdIls: number;
  /** null = no number on the invoice; otherwise the (malformed) value as read. */
  allocationNumber: string | null;
  deductionDeadline: string;
  daysLeft: number;
}

export interface VatAtRiskResult {
  rows: VatAtRiskRow[];
  count: number;
  totalVatAtRisk: number;
  /** The threshold for an invoice dated today (shown in the "all clear" copy). */
  currentThresholdIls: number | null;
}

/**
 * Invoices of `restaurantId` at risk. Runs inside the caller's restaurant
 * transaction (RLS). Excluded: invoices not read yet (ocr_pending), credit
 * invoices (amount ≤ 0 — the sources disagree on whether credits need a
 * number, so we never flag them), VAT-exempt invoices (no VAT to lose), and
 * copies that the latest match run flagged DUPLICATE_INVOICE unless a manager
 * rejected that flag (same rule as the accounting export: a duplicate is not a
 * second deductible invoice).
 */
export async function vatAtRisk(
  db: Database,
  restaurantId: string,
  period: VatAtRiskPeriod,
  opts: { invoiceId?: string; now?: Date } = {},
): Promise<VatAtRiskResult> {
  const now = opts.now ?? new Date();
  const rows = (await db.execute(sql`
    select i.id, i.invoice_number, i.supplier_id, s.name as supplier_name, s.name_en as supplier_name_en,
           to_char(i.invoice_date at time zone coalesce(r.timezone, 'Asia/Jerusalem'), 'YYYY-MM-DD') as invoice_day,
           i.total_excl_vat::float8 as total_excl_vat, i.vat_amount::float8 as vat_amount,
           coalesce(s.vat_rate, r.vat_rate)::float8 as vat_rate, i.allocation_number
    from invoices i
    join restaurants r on r.id = i.restaurant_id
    left join suppliers s on s.id = i.supplier_id and s.restaurant_id = i.restaurant_id
    where i.restaurant_id = ${restaurantId}
      and i.status <> 'ocr_pending'
      and i.invoice_date is not null
      and i.total_excl_vat > 0
      and i.invoice_date >= '2024-05-05'
      and (${opts.invoiceId ?? null}::uuid is null or i.id = ${opts.invoiceId ?? null}::uuid)
      and not exists (
        select 1 from discrepancies d
        where d.restaurant_id = i.restaurant_id
          and d.type = 'DUPLICATE_INVOICE'
          and d.resolution_status <> 'rejected'
          and d.match_run_id = (
            select mr.id from match_runs mr
            where mr.invoice_id = i.id and mr.restaurant_id = i.restaurant_id
            order by mr.run_at desc limit 1
          )
      )
    order by i.invoice_date desc
    limit 2000
  `)) as unknown as Array<{
    id: string;
    invoice_number: string | null;
    supplier_id: string | null;
    supplier_name: string | null;
    supplier_name_en: string | null;
    invoice_day: string;
    total_excl_vat: number;
    vat_amount: number | null;
    vat_rate: number | null;
    allocation_number: string | null;
  }>;

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const out: VatAtRiskRow[] = [];
  for (const r of rows) {
    const threshold = allocationThreshold(r.invoice_day);
    if (threshold == null || !(r.total_excl_vat > threshold)) continue;
    if (isValidAllocationNumber(r.allocation_number)) continue;
    const vat = r.vat_amount != null && r.vat_amount > 0 ? quantizeIls(r.vat_amount) : mulIls(r.total_excl_vat, r.vat_rate ?? 0);
    if (!(vat > 0)) continue;
    const deadline = deductionDeadline(r.invoice_day);
    const daysLeft = daysBetween(today, deadline);
    if (period === 'open' && daysLeft < 0) continue;
    if (period === 'this_month' && r.invoice_day.slice(0, 7) !== today.slice(0, 7)) continue;
    out.push({
      invoiceId: r.id,
      invoiceNumber: r.invoice_number,
      supplierId: r.supplier_id,
      supplierName: r.supplier_name,
      supplierNameEn: r.supplier_name_en,
      invoiceDate: r.invoice_day,
      totalExclVat: quantizeIls(r.total_excl_vat),
      vatAtRisk: vat,
      thresholdIls: threshold,
      allocationNumber: r.allocation_number?.trim() ? r.allocation_number.trim() : null,
      deductionDeadline: deadline,
      daysLeft,
    });
  }
  // Most urgent first: the window closing soonest.
  out.sort((a, b) => a.daysLeft - b.daysLeft || b.vatAtRisk - a.vatAtRisk);
  return {
    rows: out,
    count: out.length,
    totalVatAtRisk: sumIls(out.map((r) => r.vatAtRisk)),
    currentThresholdIls: allocationThreshold(today),
  };
}
