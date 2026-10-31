/**
 * How a receiver enters a quantity at the back door (RCV-10, DoD-7):
 *  - weighed / measured units (ק״ג, גרם, ליטר…) → a decimal keypad: a comma is
 *    a decimal point, up to 3 decimals (gr_lines.qty_received is numeric(12,3));
 *  - counted units (יח׳, ארגז, קרטון…) → a ±1 stepper.
 * A typed weight far from the order asks for one confirm, using the matching
 * engine's own quantity tolerance (never a second rule in the UI).
 *
 * Pure — unit-tested.
 */
import { translateUnit } from '@restomatch/translate/units';

const MEASURED = new Set(['kg', 'g', 'mg', 'L', 'ml', 't', 'm', 'cm']);

export type QtyKind = 'measured' | 'counted';

export function qtyKind(unit: string | null | undefined): QtyKind {
  const en = translateUnit(unit ?? null);
  return en && MEASURED.has(en) ? 'measured' : 'counted';
}

/** Round to the 3 decimals the database keeps. */
export function roundQty(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/**
 * Parse what the receiver typed. Accepts "11,640", "11.64", " 8 "; rejects
 * negatives, letters and two separators. null = not a quantity (yet).
 */
export function parseQty(raw: string): number | null {
  const s = raw.trim().replace(/\s+/g, '').replace(',', '.');
  if (s === '' || !/^\d*\.?\d*$/.test(s) || s === '.') return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? roundQty(n) : null;
}

/** The value shown in the input: plain digits, "." as typed by the keypad, no grouping. */
export function qtyInputText(v: number): string {
  return String(roundQty(v));
}

/** The engine's quantity tolerance (packages/matching DEFAULT_TOLERANCES / restaurant overrides). */
export interface QtyTolerance {
  qtyPercent: number;
  qtyAbsolute: number;
}

/**
 * Does a count leave the engine's "clean" band against the order? Mirrors the
 * engine's rule (|diff| ≤ max(abs, ordered × pct) AND pct ≤ qtyPercent).
 * Returns the relative difference when it does, else null.
 */
export function outsideTolerance(ordered: number | null, counted: number, tol: QtyTolerance): number | null {
  if (ordered === null || ordered <= 0) return null;
  const absDiff = Math.abs(counted - ordered);
  const pct = absDiff / ordered;
  const effectiveTol = Math.max(tol.qtyAbsolute, ordered * tol.qtyPercent);
  return absDiff <= effectiveTol && pct <= tol.qtyPercent ? null : pct;
}
