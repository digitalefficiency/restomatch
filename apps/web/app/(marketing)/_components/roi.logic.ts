/**
 * The ROI calculator's math, pure and in integer agorot (W3-06 review M3/M4).
 *
 * The visitor types purchasing; it is parsed by the one input parser
 * (parseNumberInput, scale 2 → exact agorot, never a hand-stripped comma),
 * clamped to ROI_MAX_MONTHLY_ILS, and every ₪ figure is computed in agorot
 * with an explicit half-up rounding, then rounded to whole shekels for the
 * headline (₪30,500 × 0.7% = ₪213.50 → ₪214, never a float's ₪213).
 *
 * An empty, zero, negative or unreadable amount is NOT a ₪0 leak: the result
 * is `{ kind: 'prompt' }` and the card shows a neutral prompt instead of a
 * danger-styled ₪0 / 0%. The same holds while the visitor is still typing a
 * tiny amount ('1', '15', '20'): a leak that rounds to ₪0 is a prompt, too.
 *
 * The annual line is 12 × the DISPLAYED monthly figure, so the two numbers on
 * screen always reconcile (₪214 → ₪2,568, never a separately rounded ₪2,562).
 */
import { parseNumberInput } from '@restomatch/types';

/** ₪100,000,000 a month — far above any restaurant group; anything larger is clamped. */
export const ROI_MAX_MONTHLY_ILS = 100_000_000;
const MAX_AGOROT = ROI_MAX_MONTHLY_ILS * 100;

/** Half-up integer division for non-negative integers. */
export function divHalfUp(n: number, d: number): number {
  return Math.floor((2 * n + d) / (2 * d));
}

/** Typed purchasing → integer agorot (clamped), or null when there is nothing to compute. */
export function monthlyAgorotFromInput(raw: string): number | null {
  const cell = parseNumberInput(raw, { scale: 2 });
  if (cell.kind !== 'ok' || !Number.isSafeInteger(cell.scaled) || cell.scaled <= 0) return null;
  return Math.min(cell.scaled, MAX_AGOROT);
}

export type RoiResult =
  | { kind: 'prompt' }
  | {
      kind: 'ok';
      monthlyAgorot: number;
      /** Whole shekels, half-up from the agorot leak. */
      monthlyLeakIls: number;
      annualLeakIls: number;
      /** Break-even share of purchasing in hundredths of a percent (59 = 0.59%). */
      breakevenHundredths: number;
      /** True when the break-even rounds below 0.01% — shown as "<0.01%". */
      breakevenBelowFloor: boolean;
      /** The leak exceeds the plan price. */
      pays: boolean;
      /** Plan price as a % of the estimated leak (only meaningful when `pays`). */
      coveredPct: number;
      /**
       * Show "רק X% מהדליפה" only when it reads honestly: 0.5 ≤ X < 99.5, i.e. it
       * never rounds to "0%" (huge purchasing) or "100%" (leak ≈ the plan price).
       */
      showCovered: boolean;
    };

/**
 * @param raw        the typed purchasing (any locale grouping; ₪ ignored)
 * @param leakPct    the slider's leak rate in percent (0.5–5, step 0.1)
 * @param proAgorot  the Pro plan's monthly price, integer agorot (PLAN_SEED)
 */
export function computeRoi(raw: string, leakPct: number, proAgorot: number): RoiResult {
  const monthlyAgorot = monthlyAgorotFromInput(raw);
  if (monthlyAgorot === null || !Number.isFinite(leakPct) || leakPct <= 0) return { kind: 'prompt' };
  const leakTenths = Math.round(leakPct * 10); // 1.5% → 15 tenths of a percent
  const leakAgorot = divHalfUp(monthlyAgorot * leakTenths, 1000);
  const monthlyLeakIls = divHalfUp(leakAgorot, 100);
  if (monthlyLeakIls === 0) return { kind: 'prompt' };
  const breakevenHundredths = divHalfUp(proAgorot * 10_000, monthlyAgorot);
  const pays = leakAgorot > proAgorot;
  return {
    kind: 'ok',
    monthlyAgorot,
    monthlyLeakIls,
    annualLeakIls: monthlyLeakIls * 12,
    breakevenHundredths,
    breakevenBelowFloor: breakevenHundredths < 1,
    pays,
    coveredPct: divHalfUp(proAgorot * 100, leakAgorot),
    // Exact integer form of 0.5 ≤ 100·pro/leak < 99.5.
    showCovered: pays && 200 * proAgorot >= leakAgorot && 200 * proAgorot < 199 * leakAgorot,
  };
}
