/**
 * The fat-finger guard of a count line (W2-07). One rule, used by the server
 * (the chef's `valueFlag`, `complete`'s audit) and mirrored by the web's
 * instant client check (`apps/web/app/dashboard/inventory/count/guard.ts`):
 *
 * - `high`: more than 2× (last count + received since);
 * - `low`:  less than 50 % of (last count + received since);
 * - `value`: the line is worth more than ₪2,000.
 *
 * Quantities are exact at scale 4 (integers in 1/10,000 of the line unit); no
 * float compares. A line without a usable base (no previous count, or a unit
 * that doesn't convert) is never judged on the ratio — only on value.
 */
export type GuardFlag = 'high' | 'low' | 'value';

export const GUARD_HIGH_RATIO = 2;
export const GUARD_LOW_RATIO_BP = 5000;
export const GUARD_VALUE_AGOROT = 200_000;

/** "12.5" → 125000 (scale 4); null for null / invalid. */
export function scale4(q: string | null | undefined): bigint | null {
  if (q == null) return null;
  const m = /^(\d{1,12})(?:\.(\d{1,4}))?$/.exec(q.trim());
  if (!m) return null;
  return BigInt(m[1]!) * 10_000n + BigInt((m[2] ?? '').padEnd(4, '0'));
}

export function guardLine(p: {
  qty: string | null;
  /** Last count + received since, in the line's unit (scale-4 string), or null when unknown. */
  base: string | null;
  valueAgorot: number | null;
}): GuardFlag[] {
  const q = scale4(p.qty);
  if (q == null) return [];
  const out: GuardFlag[] = [];
  const b = scale4(p.base);
  if (b != null && b > 0n) {
    if (q > b * BigInt(GUARD_HIGH_RATIO)) out.push('high');
    else if (q * 10_000n < b * BigInt(GUARD_LOW_RATIO_BP)) out.push('low');
  }
  if (p.valueAgorot != null && p.valueAgorot > GUARD_VALUE_AGOROT) out.push('value');
  return out;
}


export function fromScale4(v: bigint): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const s = `${a / 10_000n}.${(a % 10_000n).toString().padStart(4, '0')}`;
  return neg ? `-${s}` : s;
}
