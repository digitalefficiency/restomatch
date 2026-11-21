/**
 * The instant fat-finger guard on a count line (W2-07, foodcost-06). Mirrors the
 * server rule in `packages/api/src/inventory/guard.ts` exactly (same thresholds,
 * scale-4 integers, no float compares) so the screen warns on the keystroke and
 * the server's `flags` agree after the save:
 *
 * - `high`: more than 2× (last count + received since);
 * - `low`:  less than 50 % of (last count + received since);
 * - `value`: worth more than ₪2,000 — computed here only for money viewers (who
 *   have the unit cost); for the chef it comes from the server's `valueFlag`.
 */
export type GuardFlag = 'high' | 'low' | 'value';

export const GUARD_HIGH_RATIO = 2n;
export const GUARD_LOW_RATIO_BP = 5000n;
export const GUARD_VALUE_AGOROT = 200_000;

/** "12.5" → 125000n (scale 4); null for null / blank / invalid. */
export function scale4(q: string | null | undefined): bigint | null {
  if (q == null) return null;
  const m = /^(\d{1,12})(?:\.(\d{1,4}))?$/.exec(q.trim());
  if (!m) return null;
  return BigInt(m[1]!) * 10_000n + BigInt((m[2] ?? '').padEnd(4, '0'));
}

/** qty (scale 4) × unit cost (₪, scale 4) → agorot, half-up. Null when either is missing. */
export function lineValueAgorot(qty: string | null, unitCost: string | null | undefined): number | null {
  const q = scale4(qty);
  const c = scale4(unitCost ?? null);
  if (q == null || c == null) return null;
  // q/1e4 × c/1e4 × 100 = q·c / 1e6
  const n = q * c;
  return Number((2n * n + 1_000_000n) / 2_000_000n);
}

export interface GuardInput {
  qty: string | null;
  /** last count + received since, in the line's unit (server `expectedQty`). */
  expectedQty: string | null;
  /** ₪ per line unit — present for money viewers only. */
  unitCost?: string | null;
  /** The server's flag for the saved qty (the chef's ₪2,000 check, computed where the price is). */
  serverValueFlag?: boolean;
  /** The qty the server's flag was computed for: the flag only applies while the screen shows that qty. */
  savedQty?: string | null;
}

export function guardFlags(p: GuardInput): { flags: GuardFlag[]; valueAgorot: number | null } {
  const q = scale4(p.qty);
  if (q == null) return { flags: [], valueAgorot: null };
  const flags: GuardFlag[] = [];
  const b = scale4(p.expectedQty);
  if (b != null && b > 0n) {
    if (q > b * GUARD_HIGH_RATIO) flags.push('high');
    else if (q * 10_000n < b * GUARD_LOW_RATIO_BP) flags.push('low');
  }
  const valueAgorot = lineValueAgorot(p.qty, p.unitCost);
  if (valueAgorot != null) {
    if (valueAgorot > GUARD_VALUE_AGOROT) flags.push('value');
  } else if (p.serverValueFlag && p.savedQty != null && scale4(p.savedQty) === q) {
    flags.push('value');
  }
  return { flags, valueAgorot };
}

/**
 * Which sentence the guard says. Money viewers get the ₪ ("999 תבניות = ₪33,966 — נכון?");
 * the chef never sees ₪: the ratio sentence, or the value sentence without a figure.
 */
export function guardMessageKey(flags: GuardFlag[], money: boolean, valueAgorot: number | null): 'guardMoney' | 'guardHigh' | 'guardLow' | 'guardValue' | null {
  if (flags.length === 0) return null;
  if (money && valueAgorot != null && (flags.includes('value') || flags.includes('high'))) return 'guardMoney';
  if (flags.includes('high')) return 'guardHigh';
  if (flags.includes('low')) return 'guardLow';
  return money && valueAgorot != null ? 'guardMoney' : 'guardValue';
}
