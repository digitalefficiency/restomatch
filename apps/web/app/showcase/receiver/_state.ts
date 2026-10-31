/**
 * Wizard state machine. Single useReducer drives the whole flow so each
 * step component is purely presentational. Stages are linear except for
 * the (PROCESSING → RECONCILIATION_REVIEW) async transition and the
 * retake path back to SCAN_INVOICE.
 */

import { lineTotalIls } from '@/app/dashboard/orders/order-logic';
import type { MockSupplierExpectation, ReconciliationLine, ReconciliationResult } from './_mock';

export type WizardStep =
  | 'SELECT_SUPPLIER'
  | 'SCAN_INVOICE'
  | 'PROCESSING'
  | 'RECONCILIATION_REVIEW'
  | 'ADJUST_QUANTITIES'
  | 'CONFIRMED';

export interface CapturedImage {
  url: string; // object URL or remote URL (for in-wizard preview)
  filename: string;
  /**
   * If the image was uploaded to Supabase Storage, the wizard records
   * the generated invoice id + the public /scans/<id> route so the
   * Confirmed step can offer "view scan" linking to the real file.
   */
  invoiceId?: string;
  scanRouteUrl?: string;
  publicUrl?: string;
  mimeType?: string;
}

export interface LineMark {
  poLineId: string | null;
  invoiceLineIndex: number | null;
  productId: string | null;
  productName: string;
  qtyReceived: number;
  qtyRejected: number;
  condition: 'ok' | 'damaged' | 'rejected';
  /** Why less arrived: 'missing' (never arrived — not a rejection) or 'damaged'. */
  rejectReason?: string | null;
  notes?: string;
  /** The receiver resolved this line (✓ as ordered, a count, missing, damaged). */
  touched: boolean;
}

export interface WizardState {
  step: WizardStep;
  selectedSupplier: MockSupplierExpectation | null;
  image: CapturedImage | null;
  reconciliation: ReconciliationResult | null;
  marks: Record<string, LineMark>; // keyed by stable line id (poLineId || `inv-${invoiceLineIndex}`)
  confirmedAt: string | null;
}

export type WizardAction =
  | { type: 'SELECT_SUPPLIER'; supplier: MockSupplierExpectation }
  | { type: 'CONTINUE_TO_SCAN' }
  | { type: 'BACK' }
  | { type: 'CAPTURE_IMAGE'; image: CapturedImage }
  | { type: 'RETAKE' }
  | { type: 'PROCESSING_COMPLETE'; result: ReconciliationResult }
  | { type: 'CONTINUE_TO_ADJUST' }
  | { type: 'QUICK_CONFIRM' }
  | { type: 'UPDATE_MARK'; lineKey: string; patch: Partial<LineMark> }
  | { type: 'SUBMIT_RECEIPT' }
  | { type: 'RESET' };

export const initialState: WizardState = {
  step: 'SELECT_SUPPLIER',
  selectedSupplier: null,
  image: null,
  reconciliation: null,
  marks: {},
  confirmedAt: null,
};

export function lineKey(line: { poLineId: string | null; invoiceLineIndex: number | null }): string {
  if (line.poLineId) return `po-${line.poLineId}`;
  if (line.invoiceLineIndex !== null) return `inv-${line.invoiceLineIndex}`;
  return `orphan-${Math.random()}`;
}

export function reducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'SELECT_SUPPLIER':
      return { ...state, selectedSupplier: action.supplier };

    case 'CONTINUE_TO_SCAN':
      return state.selectedSupplier ? { ...state, step: 'SCAN_INVOICE' } : state;

    case 'CAPTURE_IMAGE':
      return { ...state, image: action.image, step: 'PROCESSING' };

    case 'RETAKE':
      return { ...state, image: null, step: 'SCAN_INVOICE' };

    case 'PROCESSING_COMPLETE': {
      const initialMarks: Record<string, LineMark> = {};
      for (const l of action.result.lines) {
        const key = lineKey(l);
        // Pre-filled with what was ordered; nothing is resolved until the
        // receiver says so (RCV-01: "invoice = order" is not "arrived").
        const defaultQty = l.poQty ?? l.invoiceQty ?? 0;
        initialMarks[key] = {
          poLineId: l.poLineId,
          invoiceLineIndex: l.invoiceLineIndex,
          productId: l.productId,
          productName: l.productName,
          qtyReceived: defaultQty,
          qtyRejected: 0,
          condition: 'ok',
          touched: false,
        };
      }
      return {
        ...state,
        reconciliation: action.result,
        marks: initialMarks,
        step: 'RECONCILIATION_REVIEW',
      };
    }

    case 'CONTINUE_TO_ADJUST':
      return { ...state, step: 'ADJUST_QUANTITIES' };

    case 'QUICK_CONFIRM':
      return { ...state, step: 'CONFIRMED', confirmedAt: new Date().toISOString() };

    case 'UPDATE_MARK': {
      const existing = state.marks[action.lineKey];
      if (!existing) return state;
      return {
        ...state,
        marks: {
          ...state.marks,
          [action.lineKey]: {
            ...existing,
            ...action.patch,
            // An explicit `touched: false` is an undo; every other change resolves the line.
            touched: action.patch.touched ?? true,
          },
        },
      };
    }

    case 'SUBMIT_RECEIPT':
      return { ...state, step: 'CONFIRMED', confirmedAt: new Date().toISOString() };

    case 'BACK': {
      const prev: Record<WizardStep, WizardStep> = {
        SELECT_SUPPLIER: 'SELECT_SUPPLIER',
        SCAN_INVOICE: 'SELECT_SUPPLIER',
        PROCESSING: 'SCAN_INVOICE',
        RECONCILIATION_REVIEW: 'SCAN_INVOICE',
        ADJUST_QUANTITIES: 'RECONCILIATION_REVIEW',
        CONFIRMED: 'CONFIRMED',
      };
      return { ...state, step: prev[state.step] };
    }

    case 'RESET':
      return initialState;

    default:
      return state;
  }
}

/** Delivery Check progress: how many of the lines the receiver has resolved ("9 מתוך 12 אושרו"). */
export function countProgress(
  reconciliation: ReconciliationResult | null,
  marks: Record<string, LineMark>,
): { resolved: number; total: number } {
  if (!reconciliation) return { resolved: 0, total: 0 };
  let resolved = 0;
  for (const l of reconciliation.lines) if (marks[lineKey(l)]?.touched) resolved += 1;
  return { resolved, total: reconciliation.lines.length };
}

/** A line the receiver still has to resolve, in the order the bulk action resolves it. */
export function unresolvedOrderLines(
  result: ReconciliationResult | null,
  marks: Record<string, LineMark>,
): ReconciliationLine[] {
  if (!result) return [];
  return result.lines.filter((l) => l.poLineId !== null && !marks[lineKey(l)]?.touched);
}

/** ✓ as ordered. */
export function asOrderedPatch(line: ReconciliationLine): Partial<LineMark> {
  return { qtyReceived: line.poQty ?? 0, qtyRejected: 0, condition: 'ok', rejectReason: null };
}

/** Nothing of it arrived: 0 received, NOTHING rejected (the slip says "חסר", never "נפסל/פגום"). */
export const MISSING_PATCH: Partial<LineMark> = { qtyReceived: 0, qtyRejected: 0, condition: 'ok', rejectReason: 'missing' };

/** Arrived damaged (kept as a quality note; the count stays what was counted). */
export const DAMAGED_PATCH: Partial<LineMark> = { condition: 'damaged', rejectReason: 'damaged' };

/** A typed / stepped count. 0 is "missing"; a count clears an earlier "missing". */
export function qtyPatch(mark: LineMark, qty: number): Partial<LineMark> {
  if (qty === 0) return MISSING_PATCH;
  return {
    qtyReceived: qty,
    qtyRejected: 0,
    condition: mark.condition === 'rejected' ? 'ok' : mark.condition,
    rejectReason: mark.rejectReason === 'missing' ? null : (mark.rejectReason ?? null),
  };
}

/**
 * "✓ סמנו את השאר כמו בהזמנה": every unresolved ORDER line becomes "as
 * ordered". Lines that are only on the invoice (not ordered) are left for the
 * receiver — "as ordered" says nothing about them. Returns the new marks and
 * the previous marks of the lines it changed (for the 10 s undo).
 */
export function markRestAsOrdered(
  result: ReconciliationResult | null,
  marks: Record<string, LineMark>,
): { next: Record<string, LineMark>; previous: Record<string, LineMark> } {
  const next = { ...marks };
  const previous: Record<string, LineMark> = {};
  for (const line of unresolvedOrderLines(result, marks)) {
    const key = lineKey(line);
    const prev = marks[key];
    if (!prev) continue;
    previous[key] = prev;
    next[key] = { ...prev, ...asOrderedPatch(line), touched: true };
  }
  return { next, previous };
}

/**
 * Not one invoice line paired with an order line, though both sides have
 * lines, and no invoice-only line even shares a word with the order (4-letter
 * stems, so עגבניה/עגבניות meet): almost always another supplier's invoice or
 * the wrong order opened. Shared wording means "same supplier, lines not
 * linked yet", which stays the calm pending-review case.
 */
export function noLinePaired(lines: ReconciliationLine[]): boolean {
  const ordered = lines.filter((l) => l.poLineId !== null);
  const invoiceOnly = lines.filter((l) => l.poLineId === null && l.invoiceLineIndex !== null);
  if (ordered.length === 0 || invoiceOnly.length === 0) return false;
  if (ordered.some((l) => l.invoiceLineIndex !== null)) return false;
  const orderStems = new Set(ordered.flatMap((l) => stems(l.productName)));
  return !invoiceOnly.some((l) => stems(l.productName).some((w) => orderStems.has(w)));
}

function stems(name: string): string[] {
  return name
    .replace(/[\u0591-\u05C7"'\u05F3\u05F4]/g, '')
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((w) => w.length >= 3)
    .map((w) => w.slice(0, 4));
}

export type ReconSectionKey = 'both' | 'invoiceOnly' | 'orderOnly';
export interface ReconSection {
  key: ReconSectionKey;
  /** Lines with their index in the flat list (stable React keys). */
  items: Array<{ line: ReconciliationLine; index: number }>;
  /** What the section's lines come to: billed (invoice only) or ordered (order only). */
  totalIls: number | null;
}

/**
 * The review split into what is on both the order and the invoice, on the
 * invoice only, and on the order only, so the receiver sees what the supplier
 * billed apart from what was ordered. Null when no invoice line was read
 * (order-only receiving): every line would land in "order only".
 */
export function reconSections(lines: ReconciliationLine[]): ReconSection[] | null {
  if (!lines.some((l) => l.invoiceLineIndex !== null)) return null;
  const both: ReconSection['items'] = [];
  const invoiceOnly: ReconSection['items'] = [];
  const orderOnly: ReconSection['items'] = [];
  lines.forEach((line, index) => {
    if (line.poLineId === null) invoiceOnly.push({ line, index });
    else if (line.invoiceLineIndex === null) orderOnly.push({ line, index });
    else both.push({ line, index });
  });
  // Summed in integer agorot.
  const sum = (items: ReconSection['items'], total: (l: ReconciliationLine) => number) =>
    items.reduce((acc, { line }) => acc + Math.round(total(line) * 100), 0) / 100;
  const sections: ReconSection[] = [
    { key: 'both', items: both, totalIls: null },
    {
      key: 'invoiceOnly',
      items: invoiceOnly,
      totalIls: sum(
        invoiceOnly,
        (l) => l.invoiceLineTotal ?? lineTotalIls(l.invoiceQty ?? 0, l.invoiceUnitPrice ?? undefined),
      ),
    },
    {
      key: 'orderOnly',
      items: orderOnly,
      totalIls: sum(orderOnly, (l) => lineTotalIls(l.poQty ?? 0, l.poUnitPrice ?? undefined)),
    },
  ];
  return sections.filter((s) => s.items.length > 0);
}
