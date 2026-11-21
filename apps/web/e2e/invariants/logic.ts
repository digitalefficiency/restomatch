/**
 * G-16 slice b: the crawl's checks as pure functions over what the page exposes
 * (data-* markers, glyph positions, text). The Playwright wrappers in
 * ../helpers.ts extract the data; the unit test (lib/__tests__/g16-crawl-logic.test.ts)
 * pins the rules. All amounts are integer agorot.
 *
 * Markers the crawl reads (added by the owning screens, W2-08 / W2-09):
 *  - `data-money-agorot="<int>"` on every ₪ row value;
 *  - `data-money-sum-of="<group>"` on a total, with its rows as
 *    `data-money-row-of="<group>"`; optional `data-money-cap-agorot` when the total
 *    is capped (the cap note shown next to it);
 *  - `data-drill` on a link to a list whose page carries `data-drill-total`;
 *  - `data-money-state="unmeasured|unavailable|zero|value"` where a ₪ can be unknown.
 */

export type MoneyState = 'value' | 'zero' | 'unmeasured' | 'unavailable';

export interface TotalCheck {
  group: string;
  totalAgorot: number;
  rowAgorot: readonly number[];
  /** A capped total equals min(Σ rows, cap). */
  capAgorot?: number | null;
}

/** Null when the total equals its rows to the agora (honouring a cap), else why not. */
export function totalMismatch(t: TotalCheck): string | null {
  if (!Number.isInteger(t.totalAgorot) || t.rowAgorot.some((r) => !Number.isInteger(r))) {
    return `${t.group}: non-integer agorot (total ${t.totalAgorot})`;
  }
  const sum = t.rowAgorot.reduce((s, r) => s + r, 0);
  const expected = t.capAgorot != null ? Math.min(sum, t.capAgorot) : sum;
  return expected === t.totalAgorot ? null : `${t.group}: total ${t.totalAgorot} ≠ Σ rows ${sum}${t.capAgorot != null ? ` (cap ${t.capAgorot})` : ''}`;
}

/** Null when the drilled list's total matches the source figure to the agora. */
export function drillMismatch(source: { href: string; agorot: number }, targetTotalAgorot: number | null): string | null {
  if (targetTotalAgorot == null) return `${source.href}: the list has no [data-drill-total]`;
  return source.agorot === targetTotalAgorot ? null : `${source.href}: source ${source.agorot} ≠ list ${targetTotalAgorot}`;
}

/** Horizontal extents (CSS px) of the ₪ glyph and of the first digit, as rendered. */
export interface GlyphBoxes {
  text: string;
  shekel: { left: number; right: number } | null;
  firstDigit: { left: number; right: number } | null;
}

/** In he, the ₪ glyph must sit LEFT of the first digit on screen (visual order, not logical). */
export function shekelPlacement(b: GlyphBoxes): string | null {
  if (!b.shekel || !b.firstDigit) return null; // not a ₪ amount
  return b.shekel.right <= b.firstDigit.left + 0.5 ? null : `"${b.text.trim()}": ₪ is right of the digits`;
}

const ZERO_ILS = /(^|[^\d.,])0([.,]00?)?(?![\d.,])/;

/** A rendered ₪ amount that reads as zero (₪0, 0 ₪, ₪0.00). */
export function readsAsZero(text: string): boolean {
  return text.includes('₪') && ZERO_ILS.test(text.replace(/[‎‏ \s]/g, ' '));
}

export interface ZeroCheck {
  text: string;
  state: MoneyState | null;
  /** Computed CSS colour as rgb(r, g, b). */
  color: string;
}

function isRed(color: string): boolean {
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return false;
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return r >= 150 && r > g * 1.6 && r > b * 1.6;
}

/** No red ₪0, and no ₪0 at all where the state is unmeasured / unavailable. */
export function zeroViolation(z: ZeroCheck): string | null {
  if (!readsAsZero(z.text)) return null;
  if (z.state === 'unmeasured' || z.state === 'unavailable') return `"${z.text.trim()}": ₪0 shown for a ${z.state} figure`;
  if (isRed(z.color)) return `"${z.text.trim()}": red ₪0 (${z.color})`;
  return null;
}
