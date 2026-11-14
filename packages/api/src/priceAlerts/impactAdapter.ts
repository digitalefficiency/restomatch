import type { Database } from '@restomatch/db';
import type { PriceAlertDetail } from './sweep';
import type { Tone } from './digest';

/**
 * INTERIM seam for W2-12's `priceAlerts/impact.ts` (`loadAlertImpacts` +
 * `alertTone`: "≈₪N בחודש (הערכה)" = Δ unit price × the 90-day invoiced qty ÷ 3,
 * integer agorot, one half-up rounding; T2 only at ≥3 % AND ≥₪50/month).
 *
 * AU-13 calls that helper and never re-implements it. Until W2-12 merges to
 * `main`, this adapter returns NO estimate: every line reads "אין מספיק נתונים",
 * ranks after any known one, and stays neutral (T4) — honest, never ₪0 and never
 * a false alarm. Adoption on W2-12's merge (one body, same signature):
 *
 *   const m = await loadAlertImpacts(db, restaurantId, alerts);
 *   return new Map(alerts.map((a) => [a.id, { monthlyAgorot: m.get(a.id)?.monthlyAgorot ?? null, tone: m.get(a.id)?.tone ?? 't4' }]));
 */
export interface DigestImpact {
  monthlyAgorot: number | null;
  tone: Tone;
}

export async function loadDigestImpacts(
  _db: Database,
  _restaurantId: string,
  _alerts: readonly PriceAlertDetail[],
): Promise<Map<string, DigestImpact>> {
  return new Map();
}
