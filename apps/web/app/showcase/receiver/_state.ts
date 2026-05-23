/**
 * Wizard state machine. Single useReducer drives the whole flow so each
 * step component is purely presentational. Stages are linear except for
 * the (PROCESSING → RECONCILIATION_REVIEW) async transition and the
 * retake path back to SCAN_INVOICE.
 */

import type { MockSupplierExpectation, ReconciliationLine, ReconciliationResult } from './_mock';

export type WizardStep =
  | 'SELECT_SUPPLIER'
  | 'SCAN_INVOICE'
  | 'PROCESSING'
  | 'RECONCILIATION_REVIEW'
  | 'ADJUST_QUANTITIES'
  | 'CONFIRMED';

export interface CapturedImage {
  url: string; // object URL or remote URL
  filename: string;
}

export interface LineMark {
  poLineId: string | null;
  invoiceLineIndex: number | null;
  productId: string | null;
  productName: string;
  qtyReceived: number;
  qtyRejected: number;
  condition: 'ok' | 'damaged' | 'rejected';
  notes?: string;
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
        const defaultQty =
          l.status === 'matched'
            ? (l.invoiceQty ?? l.poQty ?? 0)
            : (l.invoiceQty ?? l.poQty ?? 0);
        initialMarks[key] = {
          poLineId: l.poLineId,
          invoiceLineIndex: l.invoiceLineIndex,
          productId: l.productId,
          productName: l.productName,
          qtyReceived: defaultQty,
          qtyRejected: 0,
          condition: 'ok',
          touched: l.status === 'matched', // auto-touched
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
            touched: true,
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

/** Count how many non-matched lines still need a touch in ADJUST_QUANTITIES. */
export function pendingMarksCount(
  reconciliation: ReconciliationResult | null,
  marks: Record<string, LineMark>,
): { pending: number; total: number; matched: number } {
  if (!reconciliation) return { pending: 0, total: 0, matched: 0 };
  let pending = 0;
  let total = 0;
  let matched = 0;
  for (const l of reconciliation.lines) {
    if (l.status === 'matched') {
      matched += 1;
      continue;
    }
    total += 1;
    const mark = marks[lineKey(l)];
    if (!mark || !mark.touched) pending += 1;
  }
  return { pending, total, matched };
}

/** Returns only the non-matched lines for the AdjustQuantities screen. */
export function nonMatchedLines(result: ReconciliationResult | null): ReconciliationLine[] {
  if (!result) return [];
  return result.lines.filter((l) => l.status !== 'matched');
}
