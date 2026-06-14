/**
 * Money is integer agorot (1 ₪ = 100 agorot).
 *
 * The matching engine receives shekel `number`s at its boundary (parsed from the
 * DB's NUMERIC(12,2/4) columns) and reports shekel `number`s back (persisted as
 * NUMERIC strings). But it does ALL money arithmetic through these helpers so
 * that every amount is quantized to the agora and every sum is integer-exact —
 * no float drift can creep into the one number the business sells (the ₪ leak).
 *
 * Quantities (kg, liters, units) are NOT money and stay as real numbers; only
 * the monetary product (price × qty) and monetary sums pass through here.
 *
 * Convention matches the existing reconciliation.ts quantization
 * (`Math.round(x * 100) / 100`): shekels → agorot is half-up (toward +∞), agorot
 * → shekels is exact division. Storing the agora-rounded value back as NUMERIC
 * is lossless because it has at most 2 decimal places.
 */

/** Shekels → integer agorot (half-up). */
export function toAgorot(shekels: number): number {
  return Math.round(shekels * 100);
}

/** Integer agorot → shekel number with at most 2 decimal places. */
export function toShekels(agorot: number): number {
  return agorot / 100;
}

/** Quantize a shekel amount to the agora — collapses sub-agora float dust. */
export function quantizeIls(shekels: number): number {
  return toShekels(toAgorot(shekels));
}

/**
 * price × qty, quantized to the agora. `price` may carry scale-4 precision and
 * `qty` may be fractional; the single product is rounded once to integer agorot.
 */
export function mulIls(priceShekels: number, qty: number): number {
  return quantizeIls(priceShekels * qty);
}

/**
 * Sum shekel amounts as integer agorot and return a shekel value. Summing in
 * integer space guarantees the total is exact regardless of how many lines are
 * added (the float-accumulation hazard this whole module exists to remove).
 */
export function sumIls(values: number[]): number {
  return toShekels(values.reduce((acc, v) => acc + toAgorot(v), 0));
}
