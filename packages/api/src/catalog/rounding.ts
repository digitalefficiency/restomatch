/**
 * W3-10 integer helpers shared by the catalog preview modules. All ₪ here is
 * integer: "price units" (NUMERIC(12,4) = 1/100 agorot) for unit prices and
 * agorot for amounts. Rounding is explicit: half away from zero, so a price
 * rise and the matching fall mirror each other to the agora.
 */

/** round(n / d) with ties away from zero; d > 0. BigInt so price × qty can never lose precision. */
export function divRoundHalfAway(n: bigint, d: bigint): bigint {
  if (d <= 0n) throw new RangeError('divisor must be positive');
  const neg = n < 0n;
  const a = neg ? -n : n;
  const q = (2n * a + d) / (2n * d);
  return neg ? -q : q;
}

/** A quantity (may be fractional: 12.5 kg) → integer thousandths, half away from zero. */
export function qtyToMilli(qty: number): bigint {
  if (!Number.isFinite(qty)) throw new RangeError('quantity must be finite');
  return BigInt(Math.sign(qty) * Math.round(Math.abs(qty) * 1000));
}

/** price units (1/100 agorot) × quantity → agorot, rounded once at the end. */
export function priceUnitsTimesQtyToAgorot(priceUnits: number, qty: number): number {
  if (!Number.isInteger(priceUnits)) throw new RangeError('priceUnits must be an integer');
  return Number(divRoundHalfAway(BigInt(priceUnits) * qtyToMilli(qty), 100n * 1000n));
}

/** Hebrew/English product-name key: lowercase, no punctuation or geresh, single spaces. */
export function nameKey(raw: string): string {
  return raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[֑-ׇ]/g, '') // niqqud / cantillation
    .replace(/["'`.,;:()\[\]{}\-_/\\|*+׳״]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
