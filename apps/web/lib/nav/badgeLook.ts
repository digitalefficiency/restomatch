/**
 * How one nav badge reads in the side menu (sidebar SPEC §5.1 grammar, §6
 * states). Pure (no React, no DOM): the panel row, the rail dot, the flyout
 * and the closed group header all ask this one module, so a badge can never
 * look solid in one place and calm in another.
 *
 * - A ₪ T2 badge is a pill: solid `danger` only when a payment is blocked,
 *   `warn` otherwise. Anything else is a count pill (plus a 6 px danger dot
 *   when a blocking item hides inside it).
 * - No value (loading), a failed source and an empty count all give NO pill:
 *   the menu never shows "0" and never a spinner (§6).
 * - ₪ never reaches a field role (chef, receiver). `nav.badges` already strips
 *   it on the server; this is the client's second guard (§5.3).
 */

/**
 * The slice of a server nav badge this module reads: `NavBadge` in
 * packages/api/src/tasks/badges.ts, which the web sees as `NavBadgeValue`
 * (lib/components/notifications/model.ts). Declared structurally so a pure
 * module never imports the router types; a `NavBadgeValue` is assignable to it
 * (pinned by the type check in __tests__/badgeLook.test.ts).
 */
export interface BadgeValueLike {
  /** Items behind the badge. */
  count: number;
  /** ₪ in agorot on money items; null on capture items and for field roles. */
  ilsAgorot: number | null;
  /** Something blocks a payment: the only case a badge turns danger. */
  block: boolean;
  tone: 'danger' | 'warn' | 'neutral';
  /**
   * What the ₪ means ('atRisk', or 'owed' = the claims page's open-credits figure). Typed open so a
   * kind added later stays assignable; only 'atRisk' and 'owed' render as ₪ (see T2_MONEY).
   */
  money?: string;
}

/** `solid`: ₪ with a blocked payment · `warn`: ₪, not blocking · `count`: a neutral count pill. */
export type PillKind = 'solid' | 'warn' | 'count';

/** Colour of the 8 px dot an item becomes in the rail (§1.2). */
export type DotTone = 'danger' | 'warn' | 'neutral';

/** Everything a row, its rail dot and its group header need to draw one badge, decided once. */
export interface BadgeLook {
  pill: PillKind;
  /** ₪ in agorot to print on a ₪ pill; null on a count pill (always null for field roles). */
  agorot: number | null;
  /** Items behind the badge: the count pill's number, and part of the link's accessible name either way. */
  count: number;
  /** A count pill that hides a blocking item gets the 6 px danger dot. */
  innerDot: boolean;
  /** The item's rail dot. */
  railDot: DotTone;
  /** The T2 ₪ tone that bubbles to a closed group / rail group tile; null for counts (counts never bubble). */
  t2: 'danger' | 'warn' | null;
}

/** Money kinds that are T2 (act now). Anything else keeps its count and drops the ₪. */
const T2_MONEY: ReadonlySet<string> = new Set(['atRisk', 'owed']);

/**
 * The look for one badge value, or null when nothing should show.
 *
 * `fieldRole` (chef, receiver) drops the ₪ before anything else, so a
 * ₪-only badge (count 0) shows nothing for them rather than a bare pill.
 * A non-finite count or amount reads as absent, and a negative count as 0: a
 * broken figure must not render as a number, in the pill or in the link's
 * accessible name.
 */
export function badgeLook(v: BadgeValueLike | undefined, opts: { fieldRole: boolean }): BadgeLook | null {
  if (!v) return null;
  const count = Number.isFinite(v.count) && v.count > 0 ? v.count : 0;
  const agorot = opts.fieldRole || v.ilsAgorot === null || !Number.isFinite(v.ilsAgorot) ? null : v.ilsAgorot;
  // ₪ shows only as T2 (§5.1): money at risk or owed that waits for a person. Any other kind of
  // amount a badge may carry later (open PRs add a neutral "not checked yet" total) shows its count
  // only — T1, T3 and T4 never appear in the menu. The server's `tone` is not the test: a manager's
  // non-blocking approvals are `neutral` there and still a warn ₪ pill here.
  const t2Money = agorot !== null && agorot > 0 && (v.money === undefined || T2_MONEY.has(v.money));
  if (t2Money) {
    const t2 = v.block ? 'danger' : 'warn';
    return { pill: v.block ? 'solid' : 'warn', agorot, count, innerDot: false, railDot: t2, t2 };
  }
  if (count <= 0) return null;
  return {
    pill: 'count',
    agorot: null,
    count,
    innerDot: v.block,
    railDot: v.block ? 'danger' : v.tone === 'warn' ? 'warn' : 'neutral',
    t2: null,
  };
}

/**
 * At most one solid pill in the whole menu (§5.1: red means "a payment is
 * blocked", and two reds compete). Takes `[key, look]` in visual order; the
 * first solid stays, every later solid becomes a warn pill but keeps
 * `t2: 'danger'` and its danger rail dot, so the group dot and the rail still
 * say "blocked". Null looks are dropped. A repeated key keeps its first look
 * (a favourite copy reads the same look as its row). Inputs are not mutated.
 */
export function withSingleSolid(entries: ReadonlyArray<readonly [string, BadgeLook | null]>): Map<string, BadgeLook> {
  const out = new Map<string, BadgeLook>();
  let solidShown = false;
  for (const [key, look] of entries) {
    if (!look || out.has(key)) continue;
    if (look.pill === 'solid') {
      if (solidShown) {
        out.set(key, { ...look, pill: 'warn' });
        continue;
      }
      solidShown = true;
    }
    out.set(key, look);
  }
  return out;
}

/**
 * The dot a closed group header or a rail group tile shows for its items.
 * Only T2 ₪ bubbles (§5.1): any blocked ₪ → danger, else any ₪ → warn (a
 * manager's non-blocking ₪153 still marks כסף), else nothing. Counts never
 * bubble, even a count hiding a blocking item.
 */
export function groupDot(keys: readonly string[], looks: ReadonlyMap<string, BadgeLook>): 'danger' | 'warn' | null {
  let dot: 'warn' | null = null;
  for (const key of keys) {
    const t2 = looks.get(key)?.t2;
    if (t2 === 'danger') return 'danger';
    if (t2 === 'warn') dot = 'warn';
  }
  return dot;
}
