import { computeLeakBreakdown, computeLeakGrouped } from '@restomatch/charts';
import { eq, restaurants, sql, type Database } from '@restomatch/db';
import { decimalToScaled } from '../orders/document/build';
import { claimableLines, sumClaims } from '../lib/claims';
import { deliveryNoteCoverage, type DeliveryNote, type NoteCoverage } from './coverage';
import { ledgerMonths, monthKeyOf, type LedgerMonth } from './months';

const DEFAULT_TZ = 'Asia/Jerusalem';

/** "מותאם" (T3) · open notes in the current month (T4) · an uncovered note/invoice or unexplained ₪ gap (T2). */
export type LedgerStatus =
  | { kind: 'matched' }
  | { kind: 'open'; uninvoicedNotes: number }
  | { kind: 'diff'; diffAgorot: number }
  | { kind: 'empty' };

export interface LedgerInvoice {
  invoiceId: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  status: string;
  consolidated: boolean;
  exclVatAgorot: number;
  inclVatAgorot: number;
  deliveryNotes: number;
}

export interface LedgerNote {
  grId: string;
  poId: string | null;
  receivedAt: string;
  valueAgorot: number;
  coverage: NoteCoverage;
}

export interface LedgerMonthRow {
  month: string;
  from: string;
  to: string;
  current: boolean;
  notes: { count: number; agorot: number };
  invoices: {
    regular: { count: number; exclVatAgorot: number; inclVatAgorot: number };
    consolidated: { count: number; exclVatAgorot: number; inclVatAgorot: number };
  };
  uninvoicedNotes: { count: number; agorot: number };
  invoicesWithoutNote: { count: number; agorot: number };
  /** The per-invoice capped leak, the same figure as the hero / explorer for this supplier. */
  leakAgorot: number;
  /** Claimable on that month's invoices (the claim letters' rule). */
  creditsAskedAgorot: number;
  paidAgorot: number;
  /** Invoiced (incl. VAT) − paid. */
  openBalanceAgorot: number;
  status: LedgerStatus;
}

export interface SupplierLedger {
  supplierId: string;
  timezone: string;
  months: LedgerMonthRow[];
}

export interface SupplierLedgerDetail extends SupplierLedger {
  /** Drill-down per month key: each delivery note → what covers it, plus the month's invoices. */
  detail: Record<string, { notes: LedgerNote[]; invoices: LedgerInvoice[] }>;
}

interface InvoiceRow {
  id: string;
  supplier_id: string | null;
  invoice_number: string | null;
  invoice_date: Date | string | null;
  status: string;
  total_excl_vat: string | null;
  total_incl_vat: string | null;
  [k: string]: unknown;
}

/** An unexplained billed-vs-delivered gap up to ₪1 is rounding, not a discrepancy. */
const DIFF_TOLERANCE_AGOROT = 100;

async function restaurantTz(db: Database, restaurantId: string): Promise<string> {
  const [r] = await db.select({ tz: restaurants.timezone }).from(restaurants).where(eq(restaurants.id, restaurantId)).limit(1);
  return r?.tz ?? DEFAULT_TZ;
}

async function loadInvoices(
  db: Database,
  restaurantId: string,
  supplierId: string | null,
  from: Date,
  to: Date,
): Promise<InvoiceRow[]> {
  const supplierCond = supplierId ? sql`AND supplier_id = ${supplierId}::uuid` : sql`AND supplier_id IS NOT NULL`;
  return (await db.execute(sql`
    SELECT id, supplier_id, invoice_number, invoice_date, status::text AS status,
           total_excl_vat::text AS total_excl_vat, total_incl_vat::text AS total_incl_vat
    FROM invoices
    WHERE restaurant_id = ${restaurantId}::uuid AND status <> 'ocr_pending'
      AND invoice_date >= ${from.toISOString()}::timestamptz AND invoice_date < ${to.toISOString()}::timestamptz
      ${supplierCond}
    ORDER BY invoice_date DESC, invoice_number
  `)) as unknown as InvoiceRow[];
}

const agorot = (v: string | null) => decimalToScaled(v, 2) ?? 0;

/**
 * T3 matched: every delivery note is billed, every invoice has a note, and the
 * billed-vs-delivered gap is explained by the engine's leak (already shown in
 * ₪). T4 open: the current month still has unbilled notes (consolidated
 * suppliers invoice at month end). T2 diff: a note or invoice left uncovered in
 * a closed month, or a gap the leak doesn't explain.
 */
function statusOf(row: Omit<LedgerMonthRow, 'status'>): LedgerStatus {
  if (row.notes.count === 0 && row.invoices.regular.count + row.invoices.consolidated.count === 0) return { kind: 'empty' };
  if (row.current && row.uninvoicedNotes.count > 0) return { kind: 'open', uninvoicedNotes: row.uninvoicedNotes.count };
  const gap = row.invoices.regular.exclVatAgorot + row.invoices.consolidated.exclVatAgorot - row.notes.agorot;
  const unexplained = gap - row.leakAgorot;
  if (row.uninvoicedNotes.count === 0 && row.invoicesWithoutNote.count === 0 && Math.abs(unexplained) <= DIFF_TOLERANCE_AGOROT) {
    return { kind: 'matched' };
  }
  return { kind: 'diff', diffAgorot: unexplained };
}

function buildMonth(
  m: LedgerMonth,
  current: boolean,
  notes: DeliveryNote[],
  invoices: InvoiceRow[],
  grIdsByInvoice: Map<string, string[]>,
  leakAgorot: number,
  creditsAskedAgorot: number,
): LedgerMonthRow {
  const inv = { regular: { count: 0, exclVatAgorot: 0, inclVatAgorot: 0 }, consolidated: { count: 0, exclVatAgorot: 0, inclVatAgorot: 0 } };
  let paid = 0;
  let incl = 0;
  const withoutNote = { count: 0, agorot: 0 };
  for (const i of invoices) {
    const grIds = grIdsByInvoice.get(i.id) ?? [];
    const bucket = grIds.length >= 2 ? inv.consolidated : inv.regular;
    bucket.count += 1;
    bucket.exclVatAgorot += agorot(i.total_excl_vat);
    bucket.inclVatAgorot += agorot(i.total_incl_vat);
    incl += agorot(i.total_incl_vat);
    if (i.status === 'paid') paid += agorot(i.total_incl_vat);
    if (grIds.length === 0) {
      withoutNote.count += 1;
      withoutNote.agorot += agorot(i.total_excl_vat);
    }
  }
  const uninvoiced = notes.filter((n) => n.coverage.kind === 'none');
  const base = {
    month: m.key,
    from: m.from,
    to: m.to,
    current,
    notes: { count: notes.length, agorot: notes.reduce((s, n) => s + n.valueAgorot, 0) },
    invoices: inv,
    uninvoicedNotes: { count: uninvoiced.length, agorot: uninvoiced.reduce((s, n) => s + n.valueAgorot, 0) },
    invoicesWithoutNote: withoutNote,
    leakAgorot,
    creditsAskedAgorot,
    paidAgorot: paid,
    openBalanceAgorot: incl - paid,
  };
  return { ...base, status: statusOf(base) };
}

/** One supplier's ledger by month (newest first) with the per-month drill-down. */
export async function computeSupplierLedger(
  db: Database,
  restaurantId: string,
  supplierId: string,
  monthsBack: number,
  now = new Date(),
): Promise<SupplierLedgerDetail> {
  const tz = await restaurantTz(db, restaurantId);
  const months = ledgerMonths(now, tz, monthsBack);
  const from = months[months.length - 1]!.start;
  const to = months[0]!.end;
  const [{ notes, invoices: covered }, invoices, perMonth] = await Promise.all([
    deliveryNoteCoverage(db, restaurantId, supplierId, from, to),
    loadInvoices(db, restaurantId, supplierId, from, to),
    Promise.all(
      months.map(async (m) => {
        const view = { period: 'custom' as const, from: m.from, to: m.to, filters: { supplierIds: [supplierId] }, now };
        const [grouped, breakdown] = await Promise.all([
          computeLeakGrouped(db, restaurantId, view, 'supplier'),
          computeLeakBreakdown(db, restaurantId, { view, limit: 200 }),
        ]);
        const row = grouped.find((r) => r.key === supplierId);
        // Credits asked = the claim letters' rule (lib/claims), per supplier-month.
        const credits = Math.round(sumClaims(breakdown.flatMap((inv) => claimableLines(inv))) * 100);
        return { leak: Math.round((row?.leakIls ?? 0) * 100), credits };
      }),
    ),
  ]);
  const grIdsByInvoice = new Map(covered.map((c) => [c.invoiceId, c.grIds]));
  const currentKey = months[0]!.key;

  const detail: SupplierLedgerDetail['detail'] = {};
  const rows = months.map((m, idx) => {
    const mNotes = notes.filter((n) => monthKeyOf(n.receivedAt, tz) === m.key);
    const mInv = invoices.filter((i) => i.invoice_date && monthKeyOf(new Date(i.invoice_date), tz) === m.key);
    detail[m.key] = {
      notes: mNotes.map((n) => ({
        grId: n.grId,
        poId: n.poId,
        receivedAt: n.receivedAt.toISOString(),
        valueAgorot: n.valueAgorot,
        coverage: n.coverage,
      })),
      invoices: mInv.map((i) => {
        const grIds = grIdsByInvoice.get(i.id) ?? [];
        return {
          invoiceId: i.id,
          invoiceNumber: i.invoice_number,
          invoiceDate: i.invoice_date ? new Date(i.invoice_date).toISOString() : null,
          status: i.status,
          consolidated: grIds.length >= 2,
          exclVatAgorot: agorot(i.total_excl_vat),
          inclVatAgorot: agorot(i.total_incl_vat),
          deliveryNotes: grIds.length,
        };
      }),
    };
    return buildMonth(m, m.key === currentKey, mNotes, mInv, grIdsByInvoice, perMonth[idx]!.leak, perMonth[idx]!.credits);
  });
  return { supplierId, timezone: tz, months: rows, detail };
}

export interface LedgerGridCell {
  month: string;
  notesAgorot: number;
  invoicedExclVatAgorot: number;
  leakAgorot: number;
  openBalanceAgorot: number;
  status: LedgerStatus;
}

export interface LedgerGrid {
  timezone: string;
  months: Array<{ key: string; from: string; to: string; current: boolean }>;
  suppliers: Array<{ supplierId: string; name: string; nameEn: string | null; cells: LedgerGridCell[] }>;
}

/** Every supplier × month (the all-suppliers grid). Credits stay on the per-supplier ledger. */
export async function computeLedgerGrid(
  db: Database,
  restaurantId: string,
  monthsBack: number,
  now = new Date(),
): Promise<LedgerGrid> {
  const tz = await restaurantTz(db, restaurantId);
  const months = ledgerMonths(now, tz, monthsBack);
  const from = months[months.length - 1]!.start;
  const to = months[0]!.end;
  const [{ notes, invoices: covered }, invoices, leaks, supplierRows] = await Promise.all([
    deliveryNoteCoverage(db, restaurantId, null, from, to),
    loadInvoices(db, restaurantId, null, from, to),
    Promise.all(
      months.map((m) => computeLeakGrouped(db, restaurantId, { period: 'custom', from: m.from, to: m.to, now }, 'supplier', 'off', 500)),
    ),
    db.execute(sql`
      SELECT id, name, name_en FROM suppliers WHERE restaurant_id = ${restaurantId}::uuid ORDER BY name
    `) as unknown as Promise<Array<{ id: string; name: string; name_en: string | null }>>,
  ]);
  const grIdsByInvoice = new Map(covered.map((c) => [c.invoiceId, c.grIds]));
  const currentKey = months[0]!.key;

  const suppliers = supplierRows
    .map((s) => {
      const cells = months.map((m, idx) => {
        const mNotes = notes.filter((n) => n.supplierId === s.id && monthKeyOf(n.receivedAt, tz) === m.key);
        const mInv = invoices.filter(
          (i) => i.supplier_id === s.id && i.invoice_date && monthKeyOf(new Date(i.invoice_date), tz) === m.key,
        );
        const leak = Math.round((leaks[idx]!.find((r) => r.key === s.id)?.leakIls ?? 0) * 100);
        const row = buildMonth(m, m.key === currentKey, mNotes, mInv, grIdsByInvoice, leak, 0);
        return {
          month: m.key,
          notesAgorot: row.notes.agorot,
          invoicedExclVatAgorot: row.invoices.regular.exclVatAgorot + row.invoices.consolidated.exclVatAgorot,
          leakAgorot: row.leakAgorot,
          openBalanceAgorot: row.openBalanceAgorot,
          status: row.status,
        };
      });
      return { supplierId: s.id, name: s.name, nameEn: s.name_en, cells };
    })
    .filter((s) => s.cells.some((c) => c.status.kind !== 'empty'));
  return {
    timezone: tz,
    months: months.map((m) => ({ key: m.key, from: m.from, to: m.to, current: m.key === currentKey })),
    suppliers,
  };
}
