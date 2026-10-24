/**
 * Scores an OCR extraction against a ground-truth invoice (packages/ocr/bench).
 * Pure, so the model benchmark's grading is unit-tested without an API key.
 *
 * Every check is binary. `moneyExact` is the one that matters for RestoMatch:
 * every line total and the three invoice totals equal to the agora — a wrong
 * amount becomes a wrong leak figure.
 */
export interface TruthLine {
  sku: string;
  rawDescription: string;
  qty: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
}

export interface TruthInvoice {
  supplier: { name: string; businessId?: string };
  invoiceNumber: string;
  invoiceDate: string;
  allocationNumber?: string | null;
  lines: TruthLine[];
  totals: { subtotal: number; vat: number; total: number };
}

export interface ExtractedInvoice {
  supplier?: { name?: string | null; businessId?: string | null } | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  allocationNumber?: string | null;
  lines?: Array<Partial<Omit<TruthLine, 'sku'>> & { sku?: string | null }> | null;
  totals?: Partial<TruthInvoice['totals']> | null;
}

export interface ScoreResult {
  checks: number;
  passed: number;
  /** passed / checks, 0..1 */
  accuracy: number;
  /** All line totals + subtotal/vat/total exact to the agora. */
  moneyExact: boolean;
  /** Lines in the truth with no extracted line of the same SKU. */
  missingLines: string[];
  failures: string[];
}

/** Hebrew text compare: quotes/geresh variants, whitespace and punctuation-insensitive. */
export function normText(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/[׳״'"`׳״]/g, '')
    .replace(/[.,·\-–]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const sameMoney = (a: unknown, b: number) => typeof a === 'number' && Math.round(a * 100) === Math.round(b * 100);

export function scoreExtraction(truth: TruthInvoice, got: ExtractedInvoice): ScoreResult {
  const failures: string[] = [];
  let checks = 0;
  let passed = 0;
  let moneyExact = true;
  const check = (label: string, ok: boolean, money = false) => {
    checks += 1;
    if (ok) passed += 1;
    else {
      failures.push(label);
      if (money) moneyExact = false;
    }
  };

  check('supplier.name', normText(got.supplier?.name) === normText(truth.supplier.name));
  if (truth.supplier.businessId) check('supplier.businessId', (got.supplier?.businessId ?? '').replace(/\D/g, '') === truth.supplier.businessId);
  check('invoiceNumber', (got.invoiceNumber ?? '').trim() === truth.invoiceNumber);
  check('invoiceDate', got.invoiceDate === truth.invoiceDate);
  if (truth.allocationNumber) check('allocationNumber', (got.allocationNumber ?? '').replace(/\D/g, '') === truth.allocationNumber);

  const bySku = new Map((got.lines ?? []).map((l) => [String(l.sku ?? '').trim(), l]));
  const missingLines: string[] = [];
  for (const t of truth.lines) {
    const l = bySku.get(t.sku);
    if (!l) {
      missingLines.push(t.sku);
      for (const f of ['rawDescription', 'qty', 'unit', 'unitPrice', 'lineTotal']) check(`line ${t.sku}.${f} (missing)`, false, f === 'lineTotal');
      continue;
    }
    check(`line ${t.sku}.rawDescription`, normText(l.rawDescription) === normText(t.rawDescription));
    check(`line ${t.sku}.qty`, l.qty === t.qty);
    check(`line ${t.sku}.unit`, normText(l.unit) === normText(t.unit));
    check(`line ${t.sku}.unitPrice`, sameMoney(l.unitPrice, t.unitPrice), true);
    check(`line ${t.sku}.lineTotal`, sameMoney(l.lineTotal, t.lineTotal), true);
  }
  check('lines.count', (got.lines ?? []).length === truth.lines.length);
  for (const k of ['subtotal', 'vat', 'total'] as const) check(`totals.${k}`, sameMoney(got.totals?.[k], truth.totals[k]), true);

  return { checks, passed, accuracy: checks ? passed / checks : 0, moneyExact, missingLines, failures };
}
