/**
 * Arithmetic gate (PR-OCR-2): an OCR'd invoice must add up before any of its
 * digits may become a ₪ leak. A misread "1,250" → "1,750" makes qty × price ≠
 * line total (or Σ lines ≠ subtotal), so the invoice goes to a person instead of
 * showing up as a PRICE_HIGHER / TOTAL_MISMATCH leak.
 *
 * All money math in INTEGER AGOROT (prices at scale 4 = 1/100 agora, quantities
 * at scale 3), half-up rounding at qty × price — the same boundary rules as the
 * matching engine. Pure: no I/O, unit-tested.
 *
 * Tolerances (agorot): line 5, Σ lines vs subtotal 100, VAT 100, subtotal + VAT
 * vs total 5. A line with a printed discount skips the line check; an invoice
 * discount skips the Σ-lines check. Deposit (פיקדון) lines may sit inside or
 * outside the VAT base — both readings are accepted. VAT may be 0% (fresh
 * produce is zero-rated in Israel) or mixed per line (0% produce + 18% goods):
 * the VAT check accepts base × rate, Σ line × line rate, and a printed 0.
 */
import type { DocumentKind, LineKind } from './providers/invoiceSchema';

export const LINE_TOLERANCE_AGOROT = 5;
export const SUBTOTAL_TOLERANCE_AGOROT = 100;
export const VAT_TOLERANCE_AGOROT = 100;
export const TOTAL_TOLERANCE_AGOROT = 5;

export type OcrCheckReason =
  | 'missing_invoice_number'
  | 'missing_invoice_date'
  | 'missing_total'
  | 'missing_subtotal'
  | 'missing_vat'
  | 'no_lines'
  | 'line_math_mismatch'
  | 'subtotal_mismatch'
  | 'vat_mismatch'
  | 'total_mismatch'
  | 'supplier_id_invalid'
  | 'supplier_id_mismatch'
  | 'document_kind_not_invoice'
  | 'continues_on_another_page'
  | 'handwritten_correction';

/** One finding. Indices and deltas only — no invoice text (these reach logs/DB). */
export interface OcrCheckIssue {
  code: OcrCheckReason;
  /** 0-based line index for line_math_mismatch. */
  line?: number;
  /** |expected − printed| in agorot, for the arithmetic mismatches. */
  deltaAgorot?: number;
}

export interface OcrChecks {
  passed: boolean;
  /** Unique reason codes (what S13 stores / shows). */
  reasons: OcrCheckReason[];
  issues: OcrCheckIssue[];
  /** 1 when every check passed, else REVIEW_SCORE — combined as min() with the model's confidence. */
  score: number;
  /** The VAT rate the VAT check used (printed, else per line, else by date). */
  vatRateUsed: number;
}

/** Below DEFAULT_REVIEW_THRESHOLD (0.85) on purpose: a failed check is a review. */
export const REVIEW_SCORE = 0.5;

/** The fields the gate reads (an InvoiceExtractionV2, or a reconciled invoice). */
export interface CheckableInvoice {
  documentKind?: DocumentKind;
  supplier?: { businessId?: string | null } | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  invoiceDiscount?: number | null;
  continuesOnAnotherPage?: boolean;
  handwrittenCorrection?: boolean;
  lines: Array<{
    qty: number;
    unitPrice: number;
    lineTotal: number;
    vatRate?: number;
    lineDiscountPct?: number;
    lineKind?: LineKind;
  }>;
  totals: { subtotal?: number; vat?: number; total?: number; vatRate?: number };
}

export interface CheckOptions {
  /** The supplier's ח״פ on file; a different printed one adds supplier_id_mismatch. */
  expectedSupplierBusinessId?: string | null;
}

/** ₪ → agorot, immune to binary-float noise (1.005 × 100 = 100.49999…). */
export function toAgorot(ils: number): number {
  return Math.round(Number((ils * 100).toPrecision(15)));
}

/** qty × unitPrice in agorot: qty at scale 3, price at scale 4, half-up (away from zero). */
export function lineProductAgorot(qty: number, unitPrice: number): number {
  const q = BigInt(Math.round(Number((qty * 1000).toPrecision(15))));
  const p = BigInt(Math.round(Number((unitPrice * 10000).toPrecision(15))));
  const units = q * p; // 1e-7 ₪ = 1e-5 agora
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const agorot = (abs + 50_000n) / 100_000n;
  return Number(neg ? -agorot : agorot);
}

/**
 * Israeli ID / company number (ת״ז, ח״פ, ע״מ) check digit: 9 digits (shorter
 * ones left-padded with 0), weights 1,2,1,2…, two-digit products summed digit by
 * digit, total divisible by 10.
 */
export function isValidIsraeliBusinessId(raw: string | null | undefined): boolean {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length === 0 || digits.length > 9) return false;
  const id = digits.padStart(9, '0');
  if (/^0+$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let d = Number(id[i]) * (i % 2 === 0 ? 1 : 2);
    if (d > 9) d -= 9;
    sum += d;
  }
  return sum % 10 === 0;
}

const normId = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '').replace(/^0+/, '');

/** Israeli VAT by invoice date: 18% from 2025-01-01, 17% before. */
export function defaultVatRate(isoDate: string | null | undefined): number {
  return isoDate && isoDate < '2025-01-01' ? 0.17 : 0.18;
}

function vatRateFor(inv: CheckableInvoice): number {
  if (inv.totals.vatRate !== undefined) return inv.totals.vatRate;
  // 0 is a real rate (zero-rated produce), not "unknown".
  const rates = inv.lines.map((l) => l.vatRate).filter((r): r is number => r !== undefined && r >= 0);
  if (rates.length) {
    const counts = new Map<number, number>();
    for (const r of rates) counts.set(r, (counts.get(r) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1])[0]![0];
  }
  return defaultVatRate(inv.invoiceDate);
}

const NOT_AN_INVOICE: ReadonlySet<DocumentKind> = new Set(['quote', 'other']);

export function checkInvoice(inv: CheckableInvoice, opts: CheckOptions = {}): OcrChecks {
  const issues: OcrCheckIssue[] = [];
  const add = (code: OcrCheckReason, extra: Omit<OcrCheckIssue, 'code'> = {}) => issues.push({ code, ...extra });

  // ── Presence
  if (!inv.invoiceNumber?.trim()) add('missing_invoice_number');
  if (!inv.invoiceDate?.trim()) add('missing_invoice_date');
  if (inv.totals.total === undefined) add('missing_total');
  if (inv.totals.subtotal === undefined) add('missing_subtotal');
  if (inv.totals.vat === undefined) add('missing_vat');
  if (inv.lines.length === 0) add('no_lines');

  // ── Lines: qty × net unit price = line total (a discounted line is skipped)
  inv.lines.forEach((l, i) => {
    if ((l.lineDiscountPct ?? 0) > 0) return;
    const delta = Math.abs(lineProductAgorot(l.qty, l.unitPrice) - toAgorot(l.lineTotal));
    if (delta > LINE_TOLERANCE_AGOROT) add('line_math_mismatch', { line: i, deltaAgorot: delta });
  });

  const linesAgorot = inv.lines.reduce((s, l) => s + toAgorot(l.lineTotal), 0);
  const depositAgorot = inv.lines
    .filter((l) => l.lineKind === 'deposit')
    .reduce((s, l) => s + toAgorot(l.lineTotal), 0);
  const vatRateUsed = vatRateFor(inv);
  const subtotal = inv.totals.subtotal !== undefined ? toAgorot(inv.totals.subtotal) : undefined;
  const vat = inv.totals.vat !== undefined ? toAgorot(inv.totals.vat) : undefined;
  const total = inv.totals.total !== undefined ? toAgorot(inv.totals.total) : undefined;

  // ── Σ lines = subtotal (deposits inside or outside it); skipped under an invoice discount
  if (subtotal !== undefined && inv.lines.length > 0 && !((inv.invoiceDiscount ?? 0) > 0)) {
    const delta = Math.min(
      Math.abs(linesAgorot - subtotal),
      Math.abs(linesAgorot - depositAgorot - subtotal),
    );
    if (delta > SUBTOTAL_TOLERANCE_AGOROT) add('subtotal_mismatch', { deltaAgorot: delta });
  }

  // ── VAT = base × rate (base = subtotal, or subtotal without VAT-exempt deposits),
  //    or Σ line × its own rate (mixed 0% produce + 18% goods), or a printed 0
  //    on a zero-rated / exempt document (total = subtotal is checked below).
  if (subtotal !== undefined && vat !== undefined) {
    const candidates = [
      Math.round(subtotal * vatRateUsed),
      Math.round((subtotal - depositAgorot) * vatRateUsed),
    ];
    if (inv.lines.some((l) => l.vatRate !== undefined)) {
      candidates.push(
        Math.round(
          inv.lines
            .filter((l) => l.lineKind !== 'deposit')
            .reduce((s, l) => s + toAgorot(l.lineTotal) * (l.vatRate ?? vatRateUsed), 0),
        ),
      );
    }
    if (vat === 0) candidates.push(0);
    const delta = Math.min(...candidates.map((c) => Math.abs(c - vat)));
    if (delta > VAT_TOLERANCE_AGOROT) add('vat_mismatch', { deltaAgorot: delta });
  }

  // ── subtotal + VAT = total (deposits may be added after VAT)
  if (subtotal !== undefined && vat !== undefined && total !== undefined) {
    const delta = Math.min(
      Math.abs(subtotal + vat - total),
      Math.abs(subtotal + vat + depositAgorot - total),
    );
    if (delta > TOTAL_TOLERANCE_AGOROT) add('total_mismatch', { deltaAgorot: delta });
  }

  // ── Supplier ח״פ
  const printedId = inv.supplier?.businessId;
  if (printedId && !isValidIsraeliBusinessId(printedId)) add('supplier_id_invalid');
  const expected = opts.expectedSupplierBusinessId;
  if (expected && normId(expected) !== normId(printedId)) add('supplier_id_mismatch');

  // ── Document flags
  if (inv.documentKind && NOT_AN_INVOICE.has(inv.documentKind)) add('document_kind_not_invoice');
  if (inv.continuesOnAnotherPage) add('continues_on_another_page');
  if (inv.handwrittenCorrection) add('handwritten_correction');

  const reasons = [...new Set(issues.map((i) => i.code))];
  const passed = reasons.length === 0;
  return { passed, reasons, issues, score: passed ? 1 : REVIEW_SCORE, vatRateUsed };
}
