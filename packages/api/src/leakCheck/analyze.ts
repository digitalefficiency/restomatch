/**
 * Free "leak check" analysis (S15 wave 1, flag `leakCheck`).
 *
 * Runs the checks that are possible WITHOUT a purchase order or a goods
 * receipt, over a prospect's sample of up to 10 invoices (plus, optionally,
 * their price list):
 *
 *   vat_overcharge     VAT billed above 18% of the subtotal
 *   line_arithmetic    printed line total above unit price × quantity
 *   total_arithmetic   printed total above subtotal + VAT
 *   price_creep        a product billed above the price the SAME supplier billed
 *                      for it on an earlier invoice in the sample
 *   above_price_list   a product billed above the prospect's own price list
 *
 * Honesty rules (leak-economist — one inflated number kills the deal):
 *   - every number is integer agorot and traceable to one invoice line;
 *   - only OVERCHARGES count toward the leak — an error in the restaurant's
 *     favour is shown, never added;
 *   - the same file uploaded twice is ignored (a prospect's mistake, not a
 *     supplier's);
 *   - a re-sent invoice (same supplier + number) is NOT counted: it is money at
 *     risk only if both copies get paid, and two photos of one paper invoice
 *     look exactly the same. It is shown as a "possible duplicate" note with
 *     its amount, and excluded from every other check so one bill is never
 *     analysed twice;
 *   - a subtotal above Σ lines is a note, not a leak (delivery fees and
 *     surcharges are often printed outside the line table);
 *   - lines with a negative quantity / price / total (returns, credits) are
 *     skipped — OCR often drops the minus sign;
 *   - a line gets at most ONE price finding (the price list wins over creep);
 *   - small rounding noise (≤ ₪1) is never a finding.
 *
 * Pure — no I/O. The leak figure is Σ amountAgorot of the counted findings.
 */
import { toAgorot } from '@restomatch/matching';

/** Israeli VAT since 2025-01-01 (same default as match/buildMatchInput.ts). */
export const LEAK_CHECK_VAT_RATE = 0.18;
/** Rounding noise below this many agorot is never reported. */
export const ARITHMETIC_TOLERANCE_AGOROT = 100;
/** A unit price must rise by more than this share to count as creep. */
export const PRICE_CREEP_MIN_PERCENT = 0.02;

export interface LeakCheckLine {
  description: string;
  qty: number;
  unit: string;
  /** Shekels, up to 4 decimals (NUMERIC(12,4) contract). */
  unitPrice: number;
  /** Shekels as printed. */
  lineTotal: number;
}

export interface LeakCheckInvoice {
  /** 0-based upload order — the stable reference every finding points at. */
  index: number;
  fileName: string;
  fileHash: string;
  supplierName: string | null;
  supplierBusinessId: string | null;
  invoiceNumber: string | null;
  /** ISO date (YYYY-MM-DD) when the OCR read one. */
  invoiceDate: string | null;
  subtotal: number | null;
  vat: number | null;
  total: number | null;
  lines: LeakCheckLine[];
}

export interface PriceListEntry {
  description: string;
  unit: string;
  unitPrice: number;
}

export type LeakFindingKind =
  | 'vat_overcharge'
  | 'line_arithmetic'
  | 'total_arithmetic'
  | 'price_creep'
  | 'above_price_list';

export interface LeakFinding {
  kind: LeakFindingKind;
  invoiceIndex: number;
  /** Null for invoice-level findings (duplicate, VAT, totals). */
  lineIndex: number | null;
  /** Money the restaurant was overcharged, integer agorot (> 0). */
  amountAgorot: number;
  /** What it should have been and what was billed, integer agorot or price units. */
  expectedAgorot: number;
  actualAgorot: number;
  /** For creep: the earlier invoice (and line) it is compared to. */
  refInvoiceIndex?: number;
  refLineIndex?: number;
  /** total_arithmetic: which printed figure is off. */
  field?: 'total';
  /** price findings: quantity the per-unit delta is multiplied by. */
  qty?: number;
}

export interface LeakNote {
  kind: 'same_file_twice' | 'undercharge' | 'possible_duplicate' | 'subtotal_mismatch';
  invoiceIndex: number;
  refInvoiceIndex?: number;
  lineIndex?: number | null;
  amountAgorot?: number;
}

export interface LeakCheckReport {
  findings: LeakFinding[];
  notes: LeakNote[];
  /** Σ amountAgorot of findings. */
  leakAgorot: number;
  /** Σ invoice totals of the invoices that were analysed (duplicates/repeats excluded). */
  spendAgorot: number;
  analysedInvoices: number;
}

/** Normalize a product description for cross-invoice comparison. */
export function normalizeText(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/["'״׳`.,;:()\[\]{}\-_/\\*+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const UNIT_ALIASES: Record<string, string> = {
  'ק"ג': 'kg', קג: 'kg', קילו: 'kg', kg: 'kg', kilo: 'kg',
  ליטר: 'l', 'ל': 'l', l: 'l', lt: 'l', liter: 'l', litre: 'l',
  יחידה: 'unit', יח: 'unit', 'יח\'': 'unit', unit: 'unit', units: 'unit', pcs: 'unit', pc: 'unit',
};

export function normalizeUnit(u: string | null | undefined): string {
  const raw = (u ?? '').trim().toLowerCase();
  return UNIT_ALIASES[raw] ?? normalizeText(raw);
}

function supplierKey(inv: LeakCheckInvoice): string {
  const id = (inv.supplierBusinessId ?? '').replace(/\D/g, '');
  if (id.length >= 5) return `id:${id}`;
  const name = normalizeText(inv.supplierName);
  return name ? `name:${name}` : `unknown:${inv.index}`;
}

/** price × qty → integer agorot, rounded once, half-up (the engine's mulIls rule). */
function lineAmountAgorot(unitPrice: number, qty: number): number {
  return toAgorot(unitPrice * qty);
}

/** Dice coefficient over character bigrams — the OCR reconciler's line matcher. */
export function diceSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  let overlap = 0;
  for (const [g, n] of ga) overlap += Math.min(n, gb.get(g) ?? 0);
  return (2 * overlap) / (a.length - 1 + (b.length - 1));
}

const PRICE_LIST_MATCH = 0.85;

function findListPrice(line: LeakCheckLine, list: PriceListEntry[]): PriceListEntry | null {
  const desc = normalizeText(line.description);
  const unit = normalizeUnit(line.unit);
  let best: PriceListEntry | null = null;
  let bestScore = 0;
  for (const entry of list) {
    if (normalizeUnit(entry.unit) !== unit) continue;
    const score = diceSimilarity(desc, normalizeText(entry.description));
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return bestScore >= PRICE_LIST_MATCH ? best : null;
}

/** Chronological order: invoice date when read, upload order as the tie-break. */
function chronological(a: LeakCheckInvoice, b: LeakCheckInvoice): number {
  const da = a.invoiceDate ?? '';
  const db = b.invoiceDate ?? '';
  if (da && db && da !== db) return da < db ? -1 : 1;
  return a.index - b.index;
}

export function analyzeLeakCheck(
  invoices: LeakCheckInvoice[],
  priceList: PriceListEntry[] = [],
): LeakCheckReport {
  const findings: LeakFinding[] = [];
  const notes: LeakNote[] = [];
  const excluded = new Set<number>();

  // 1. Same file twice → ignored. Same supplier + invoice number → duplicate.
  const byHash = new Map<string, number>();
  const byNumber = new Map<string, LeakCheckInvoice>();
  for (const inv of [...invoices].sort((a, b) => a.index - b.index)) {
    const seen = byHash.get(inv.fileHash);
    if (seen !== undefined) {
      notes.push({ kind: 'same_file_twice', invoiceIndex: inv.index, refInvoiceIndex: seen });
      excluded.add(inv.index);
      continue;
    }
    byHash.set(inv.fileHash, inv.index);
    const number = normalizeText(inv.invoiceNumber);
    if (!number) continue;
    const key = `${supplierKey(inv)}#${number}`;
    const first = byNumber.get(key);
    if (first) {
      notes.push({
        kind: 'possible_duplicate',
        invoiceIndex: inv.index,
        refInvoiceIndex: first.index,
        amountAgorot: toAgorot(inv.total ?? inv.subtotal ?? 0),
      });
      excluded.add(inv.index);
      continue;
    }
    byNumber.set(key, inv);
  }

  const analysed = invoices.filter((inv) => !excluded.has(inv.index));

  // 2. Arithmetic + VAT, per invoice.
  for (const inv of analysed) {
    let printedLinesAgorot = 0;
    inv.lines.forEach((line, lineIndex) => {
      if (line.qty < 0 || line.unitPrice < 0 || line.lineTotal < 0) return;
      const expected = lineAmountAgorot(line.unitPrice, line.qty);
      const actual = toAgorot(line.lineTotal);
      printedLinesAgorot += actual;
      const delta = actual - expected;
      if (delta > ARITHMETIC_TOLERANCE_AGOROT) {
        findings.push({
          kind: 'line_arithmetic',
          invoiceIndex: inv.index,
          lineIndex,
          amountAgorot: delta,
          expectedAgorot: expected,
          actualAgorot: actual,
        });
      } else if (-delta > ARITHMETIC_TOLERANCE_AGOROT) {
        notes.push({ kind: 'undercharge', invoiceIndex: inv.index, lineIndex, amountAgorot: -delta });
      }
    });

    if (inv.subtotal != null && inv.lines.length > 0) {
      const subtotal = toAgorot(inv.subtotal);
      const delta = subtotal - printedLinesAgorot;
      if (delta > ARITHMETIC_TOLERANCE_AGOROT) {
        notes.push({ kind: 'subtotal_mismatch', invoiceIndex: inv.index, amountAgorot: delta });
      }
    }

    if (inv.subtotal != null && inv.vat != null) {
      const subtotal = toAgorot(inv.subtotal);
      const vat = toAgorot(inv.vat);
      const expectedVat = toAgorot(inv.subtotal * LEAK_CHECK_VAT_RATE);
      const vatDelta = vat - expectedVat;
      if (vatDelta > ARITHMETIC_TOLERANCE_AGOROT) {
        findings.push({
          kind: 'vat_overcharge',
          invoiceIndex: inv.index,
          lineIndex: null,
          amountAgorot: vatDelta,
          expectedAgorot: expectedVat,
          actualAgorot: vat,
        });
      }
      if (inv.total != null) {
        const total = toAgorot(inv.total);
        const totalDelta = total - (subtotal + vat);
        if (totalDelta > ARITHMETIC_TOLERANCE_AGOROT) {
          findings.push({
            kind: 'total_arithmetic',
            field: 'total',
            invoiceIndex: inv.index,
            lineIndex: null,
            amountAgorot: totalDelta,
            expectedAgorot: subtotal + vat,
            actualAgorot: total,
          });
        }
      }
    }
  }

  // 3. Price findings — at most one per line: the price list first, then creep
  //    against the first price the same supplier billed in the sample.
  const firstPrice = new Map<string, { price: number; invoiceIndex: number; lineIndex: number }>();
  for (const inv of [...analysed].sort(chronological)) {
    const sk = supplierKey(inv);
    inv.lines.forEach((line, lineIndex) => {
      if (!(line.qty > 0) || !(line.unitPrice > 0) || line.lineTotal < 0) return;
      const billed = lineAmountAgorot(line.unitPrice, line.qty);

      const listed = priceList.length ? findListPrice(line, priceList) : null;
      if (listed && line.unitPrice > listed.unitPrice) {
        const expected = lineAmountAgorot(listed.unitPrice, line.qty);
        const delta = billed - expected;
        if (delta > ARITHMETIC_TOLERANCE_AGOROT) {
          findings.push({
            kind: 'above_price_list',
            invoiceIndex: inv.index,
            lineIndex,
            amountAgorot: delta,
            expectedAgorot: expected,
            actualAgorot: billed,
            qty: line.qty,
          });
        }
      }

      const key = `${sk}|${normalizeText(line.description)}|${normalizeUnit(line.unit)}`;
      const first = firstPrice.get(key);
      if (!first) {
        firstPrice.set(key, { price: line.unitPrice, invoiceIndex: inv.index, lineIndex });
        return;
      }
      if (listed) return; // the price list is the stronger reference for this line
      if (first.invoiceIndex === inv.index) return;
      if (line.unitPrice <= first.price * (1 + PRICE_CREEP_MIN_PERCENT)) return;
      const expected = lineAmountAgorot(first.price, line.qty);
      const delta = billed - expected;
      if (delta > ARITHMETIC_TOLERANCE_AGOROT) {
        findings.push({
          kind: 'price_creep',
          invoiceIndex: inv.index,
          lineIndex,
          amountAgorot: delta,
          expectedAgorot: expected,
          actualAgorot: billed,
          refInvoiceIndex: first.invoiceIndex,
          refLineIndex: first.lineIndex,
          qty: line.qty,
        });
      }
    });
  }

  findings.sort((a, b) => b.amountAgorot - a.amountAgorot || a.invoiceIndex - b.invoiceIndex);
  const leakAgorot = findings.reduce((acc, f) => acc + f.amountAgorot, 0);
  const spendAgorot = analysed.reduce((acc, inv) => acc + toAgorot(inv.total ?? inv.subtotal ?? 0), 0);
  return { findings, notes, leakAgorot, spendAgorot, analysedInvoices: analysed.length };
}

/**
 * Grounded ROI line for a leak-check result: the monthly purchasing volume at
 * which a plan pays for itself IF the sample's leak rate held. Every input is
 * the check's own data (leak and checked spend, integer agorot) plus the plan
 * price from PLAN_SEED — nothing else. Rounded UP to the shekel so the claim is
 * never flattering. Null when the sample found nothing (no rate to extrapolate).
 */
export function breakEvenMonthlySpendAgorot(
  leakAgorot: number,
  spendAgorot: number,
  planPriceAgorot: number,
): number | null {
  if (!(leakAgorot > 0) || !(spendAgorot > 0) || !(planPriceAgorot > 0)) return null;
  const agorot = (planPriceAgorot * spendAgorot) / leakAgorot;
  return Math.ceil(agorot / 100) * 100;
}
