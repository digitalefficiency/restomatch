import type { Task, TaskType } from './types';

/**
 * Nav badges from the task spine (W2-08 §5.3): the SAME tasks the home shows,
 * folded per nav source. The keys mirror `apps/web/lib/nav/types.ts`
 * `BADGE_KEYS` (the web registry test pins every key).
 */
export const NAV_BADGE_KEYS = ['approvals', 'payRun', 'claims', 'receiving', 'count', 'intake', 'priceAlerts'] as const;
export type NavBadgeKey = (typeof NAV_BADGE_KEYS)[number];

export interface NavBadge {
  /** Items behind the badge (shown as a count on capture items; capped at 99+ by the UI). */
  count: number;
  /** ₪ in agorot on money items; null on capture items and for staff. */
  ilsAgorot: number | null;
  /** Something blocks a payment: the only case the badge turns danger. */
  block: boolean;
  /** Neutral only (e.g. a price alert below materiality). */
  tone: 'danger' | 'warn' | 'neutral';
}

/** Which badge a task type adds into. `waiting_on_others` adds into none: it is not mine. */
export const BADGE_OF: Partial<Record<TaskType, NavBadgeKey>> = {
  decision: 'approvals',
  payment_due: 'payRun',
  claim_to_send: 'claims',
  credit_to_match: 'claims',
  delivery_due: 'receiving',
  delivery_late: 'receiving',
  close_step: 'count',
  doc_review: 'intake',
};

/** Money badges show ₪; the rest show a count. */
export const MONEY_BADGES: ReadonlySet<NavBadgeKey> = new Set(['approvals', 'payRun', 'claims']);

export function foldBadges(tasks: readonly Task[], extra: Partial<Record<NavBadgeKey, number>> = {}): Partial<Record<NavBadgeKey, NavBadge>> {
  const out: Partial<Record<NavBadgeKey, NavBadge>> = {};
  for (const t of tasks) {
    if (t.scope !== 'mine') continue;
    const key = BADGE_OF[t.type];
    if (!key || t.count <= 0) continue;
    const b = out[key] ?? { count: 0, ilsAgorot: null, block: false, tone: 'neutral' as const };
    b.count += t.count;
    if (MONEY_BADGES.has(key) && t.ilsAgorot !== null) b.ilsAgorot = (b.ilsAgorot ?? 0) + t.ilsAgorot;
    if (t.blocking > 0) b.block = true;
    b.tone = b.block ? 'danger' : t.tone === 'warn' || b.tone === 'warn' ? 'warn' : 'neutral';
    out[key] = b;
  }
  for (const [key, count] of Object.entries(extra) as [NavBadgeKey, number][]) {
    // W2-12 materiality (≥3 % and ≥₪50/month) is not on main: every price alert stays neutral.
    if (count > 0) out[key] = { count, ilsAgorot: null, block: false, tone: 'neutral' };
  }
  return out;
}
