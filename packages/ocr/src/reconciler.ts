import type { InvoiceOcrLine, InvoiceOcrResult } from '@restomatch/types';
import type { OcrConflict, ResolvedInvoice, ResolvedInvoiceLine } from './types';

const NUMERIC_TOLERANCE = 0.1; // ₪0.10 tolerance for numeric reconciliation

export interface ReconcileResult {
  result: ResolvedInvoice;
  conflicts: OcrConflict[];
  confidence: number;
}

/**
 * Reconcile two OCR results. Strategy:
 *   • For each field, if only one provider returned a value → use it (no conflict).
 *   • If both agree (with numeric tolerance) → use it (no conflict).
 *   • If they differ → prefer Claude (better Hebrew handling), flag conflict.
 *
 * Lines are matched between providers by raw_description similarity. Unmatched
 * lines from either provider are kept; matched lines are reconciled field-by-field.
 *
 * Confidence = 1 - (conflicts / fields_compared), bounded to [0, 1].
 */
export function reconcile(
  docAi: InvoiceOcrResult,
  claude: InvoiceOcrResult,
): ReconcileResult {
  const conflicts: OcrConflict[] = [];
  let fieldsCompared = 0;

  // ── Supplier
  const supplierName = pickString(
    docAi.supplier.name,
    claude.supplier.name,
    'supplier.name',
    conflicts,
  );
  if (docAi.supplier.name || claude.supplier.name) fieldsCompared += 1;

  const supplierBusinessId = pickString(
    docAi.supplier.businessId,
    claude.supplier.businessId,
    'supplier.businessId',
    conflicts,
  );
  if (docAi.supplier.businessId || claude.supplier.businessId) fieldsCompared += 1;

  // ── Invoice number / date / allocation
  const invoiceNumber = pickString(
    docAi.invoiceNumber,
    claude.invoiceNumber,
    'invoiceNumber',
    conflicts,
  );
  if (docAi.invoiceNumber || claude.invoiceNumber) fieldsCompared += 1;

  const invoiceDate = pickString(docAi.invoiceDate, claude.invoiceDate, 'invoiceDate', conflicts);
  if (docAi.invoiceDate || claude.invoiceDate) fieldsCompared += 1;

  const allocationNumber = pickString(
    docAi.allocationNumber ?? undefined,
    claude.allocationNumber ?? undefined,
    'allocationNumber',
    conflicts,
  );
  if (docAi.allocationNumber || claude.allocationNumber) fieldsCompared += 1;

  // ── Totals (numeric tolerance)
  const subtotal = pickNumber(
    docAi.totals.subtotal,
    claude.totals.subtotal,
    'totals.subtotal',
    conflicts,
  );
  if (docAi.totals.subtotal !== undefined || claude.totals.subtotal !== undefined) {
    fieldsCompared += 1;
  }

  const vat = pickNumber(docAi.totals.vat, claude.totals.vat, 'totals.vat', conflicts);
  if (docAi.totals.vat !== undefined || claude.totals.vat !== undefined) fieldsCompared += 1;

  const total = pickNumber(docAi.totals.total, claude.totals.total, 'totals.total', conflicts);
  if (docAi.totals.total !== undefined || claude.totals.total !== undefined) fieldsCompared += 1;

  // ── Lines
  const { reconciledLines, lineConflicts, lineFieldsCompared } = reconcileLines(
    docAi.lines,
    claude.lines,
  );
  conflicts.push(...lineConflicts);
  fieldsCompared += lineFieldsCompared;

  const confidence =
    fieldsCompared === 0 ? 0 : Math.max(0, 1 - conflicts.length / fieldsCompared);

  const result: ResolvedInvoice = {
    supplier: {
      name: supplierName,
      businessId: supplierBusinessId,
    },
    invoiceNumber,
    invoiceDate,
    allocationNumber: allocationNumber ?? null,
    lines: reconciledLines,
    totals: { subtotal, vat, total },
    confidence,
  };

  return { result, conflicts, confidence };
}

function pickString(
  a: string | undefined,
  b: string | undefined,
  field: string,
  conflicts: OcrConflict[],
): string | undefined {
  if (a === undefined || a === null) return b;
  if (b === undefined || b === null) return a;
  if (normalize(a) === normalize(b)) return b; // they agree
  conflicts.push({
    field,
    documentAi: a,
    claude: b,
    resolved: b,
    resolvedBy: 'claude_vision',
  });
  return b;
}

function pickNumber(
  a: number | undefined,
  b: number | undefined,
  field: string,
  conflicts: OcrConflict[],
): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  if (Math.abs(a - b) <= NUMERIC_TOLERANCE) return b; // close enough
  conflicts.push({ field, documentAi: a, claude: b, resolved: b, resolvedBy: 'claude_vision' });
  return b;
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

interface ReconcileLinesResult {
  reconciledLines: ResolvedInvoiceLine[];
  lineConflicts: OcrConflict[];
  lineFieldsCompared: number;
}

function reconcileLines(
  docAiLines: InvoiceOcrLine[],
  claudeLines: InvoiceOcrLine[],
): ReconcileLinesResult {
  const conflicts: OcrConflict[] = [];
  let fieldsCompared = 0;
  const matched: ResolvedInvoiceLine[] = [];
  const usedClaudeIdx = new Set<number>();

  for (let i = 0; i < docAiLines.length; i += 1) {
    const docLine = docAiLines[i]!;
    const matchIdx = findBestLineMatch(docLine, claudeLines, usedClaudeIdx);
    if (matchIdx !== null) {
      usedClaudeIdx.add(matchIdx);
      const claudeLine = claudeLines[matchIdx]!;
      const reconciledLine = reconcileLine(docLine, claudeLine, i, conflicts);
      fieldsCompared += 5; // raw_description, qty, unit, unitPrice, lineTotal
      matched.push(reconciledLine);
    } else {
      // Only in document AI
      conflicts.push({
        field: `lines[${i}]`,
        documentAi: docLine,
        claude: null,
        resolved: docLine,
        resolvedBy: 'document_ai',
      });
      fieldsCompared += 1;
      matched.push({ ...docLine, productId: null, productCandidates: [] });
    }
  }

  // Claude lines not matched against any document_ai line
  for (let j = 0; j < claudeLines.length; j += 1) {
    if (!usedClaudeIdx.has(j)) {
      const claudeLine = claudeLines[j]!;
      conflicts.push({
        field: `lines[+${j}]`,
        documentAi: null,
        claude: claudeLine,
        resolved: claudeLine,
        resolvedBy: 'claude_vision',
      });
      fieldsCompared += 1;
      matched.push({ ...claudeLine, productId: null, productCandidates: [] });
    }
  }

  return { reconciledLines: matched, lineConflicts: conflicts, lineFieldsCompared: fieldsCompared };
}

function reconcileLine(
  docLine: InvoiceOcrLine,
  claudeLine: InvoiceOcrLine,
  index: number,
  conflicts: OcrConflict[],
): ResolvedInvoiceLine {
  const rawDescription = pickString(
    docLine.rawDescription,
    claudeLine.rawDescription,
    `lines[${index}].rawDescription`,
    conflicts,
  )!;
  const qty = pickNumber(docLine.qty, claudeLine.qty, `lines[${index}].qty`, conflicts)!;
  const unit = pickString(docLine.unit, claudeLine.unit, `lines[${index}].unit`, conflicts)!;
  const unitPrice = pickNumber(
    docLine.unitPrice,
    claudeLine.unitPrice,
    `lines[${index}].unitPrice`,
    conflicts,
  )!;
  const lineTotal = pickNumber(
    docLine.lineTotal,
    claudeLine.lineTotal,
    `lines[${index}].lineTotal`,
    conflicts,
  )!;
  const vatRate =
    pickNumber(docLine.vatRate, claudeLine.vatRate, `lines[${index}].vatRate`, conflicts);
  // Supplier SKU (מק״ט): prefer Claude (better Hebrew/RTL handling), fall back
  // to Document AI. Carried through so invoice lines can pair by SKU downstream
  // — previously dropped here, which is why SKU matching never fired.
  const sku =
    pickString(
      docLine.sku ?? undefined,
      claudeLine.sku ?? undefined,
      `lines[${index}].sku`,
      conflicts,
    ) ?? null;

  return {
    sku,
    rawDescription,
    qty,
    unit,
    unitPrice,
    lineTotal,
    vatRate,
    confidence: Math.min(docLine.confidence ?? 1, claudeLine.confidence ?? 1),
    productId: null,
    productCandidates: [],
  };
}

/**
 * Match a docAi line to the most-similar unused claude line using
 * Dice coefficient on character bigrams of raw_description. Returns
 * the index in claudeLines, or null if no candidate is similar enough.
 */
function findBestLineMatch(
  docLine: InvoiceOcrLine,
  claudeLines: InvoiceOcrLine[],
  used: Set<number>,
): number | null {
  let bestIdx: number | null = null;
  let bestScore = 0.4; // minimum to consider a match
  for (let i = 0; i < claudeLines.length; i += 1) {
    if (used.has(i)) continue;
    const score = diceSimilarity(docLine.rawDescription, claudeLines[i]!.rawDescription);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function diceSimilarity(a: string, b: string): number {
  const sa = bigrams(a);
  const sb = bigrams(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let intersection = 0;
  for (const x of sa) if (sb.has(x)) intersection += 1;
  return (2 * intersection) / (sa.size + sb.size);
}

function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  const norm = s.toLowerCase().trim();
  for (let i = 0; i < norm.length - 1; i += 1) {
    out.add(norm.slice(i, i + 2));
  }
  return out;
}
