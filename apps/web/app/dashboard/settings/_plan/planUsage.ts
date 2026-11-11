/**
 * W3-07a slice 2 · "תוכנית ושימוש": a READ-ONLY view of what getEntitlements /
 * getQuota already return. Nothing here redefines a limit or a price; it only
 * turns the server's numbers into rows. No ₪ (plans show names only).
 */

export interface PlanUsageInput {
  planKey: 'trial' | 'basic' | 'pro' | 'chain';
  status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'none';
  trialEndsAt: Date | string | null;
  limits: { invoicesPerMonth: number | null; restaurants: number | null; seatsPerRestaurant: number | null };
  /** getQuota(..., 'ocr_scans'). */
  scans: { metered: boolean; used: number; limit: number | null; withinLimit: boolean };
  restaurantsUsed: number;
  seatsUsed: number;
}

export type UsageTone = 'T4' | 'T2';

export interface UsageRow {
  key: 'scans' | 'restaurants' | 'seats';
  used: number;
  /** null = unlimited, or not metered (implicit trial). */
  limit: number | null;
  /** 0–100, null when there is no limit. */
  pct: number | null;
  /** T2 only when blocked or at ≥ 90%; otherwise neutral. */
  tone: UsageTone;
}

const WARN_AT = 0.9;

function row(key: UsageRow['key'], used: number, limit: number | null, blocked = false): UsageRow {
  const pct = limit === null || limit <= 0 ? null : Math.min(100, Math.round((used / limit) * 100));
  const tone: UsageTone = blocked || (limit !== null && limit > 0 && used >= limit * WARN_AT) ? 'T2' : 'T4';
  return { key, used, limit, pct, tone };
}

export function planUsageRows(input: PlanUsageInput): UsageRow[] {
  return [
    row('scans', input.scans.used, input.scans.metered ? input.scans.limit : null, !input.scans.withinLimit),
    row('restaurants', input.restaurantsUsed, input.limits.restaurants),
    row('seats', input.seatsUsed, input.limits.seatsPerRestaurant),
  ];
}

/** Whole days left in a trial, counted from `now`; null when not trialing. */
export function trialDaysLeft(input: Pick<PlanUsageInput, 'status' | 'trialEndsAt'>, now: Date): number | null {
  if (input.status !== 'trialing' || !input.trialEndsAt) return null;
  const ms = new Date(input.trialEndsAt).getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}
