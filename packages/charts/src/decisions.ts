import { sql } from '@restomatch/db';

type SQL = ReturnType<typeof sql>;

/**
 * G-14 · The decision → ₪-effect table. THE ONLY place a discrepancy status (or a
 * decision that writes one) is turned into a money meaning. The leak ledger
 * (leak-ledger.ts) generates its SQL from this table; slice b makes LEAK_FILTER,
 * owner-kpis savings, lib/claims' claimable sets, persist.ts and overContract.ts
 * read it too.
 *
 * Effects:
 *  • `undecided` — counts in the leak; nobody decided yet (open / escalated).
 *  • `claim`     — counts in the leak and is asked back: an offset before payment, a
 *                  credit claim after it (owner decision 19).
 *  • `waive`     — counts in the leak (the money did leak) but is not asked back.
 *  • `excluded`  — not leak at all (an under-charge, a delivery waiting for its PO, a
 *                  "not a duplicate"). Never in the ledger.
 *
 * `resolved` (defined meaning): the team accepted the gap and settled it with the
 * supplier — the same ₪ effect as `accepted` (a claim; syncClaims claims both).
 * `tolerated` is the system decision `tolerate` (engine auto-approve within
 * tolerance): the gap is accepted as paid and NOT asked back. Until slice b makes
 * persist.ts write it explicitly, a tolerated row is an `accepted` row with no
 * `resolved_at` (a person's accept always stamps it — routers/approvals.ts).
 */

/** The 12 engine discrepancy types (packages/matching/src/index.ts; immutable there). */
export const DISCREPANCY_TYPES = [
  'PRICE_HIGHER',
  'PRICE_LOWER',
  'QTY_SHORT',
  'QTY_OVER',
  'UNORDERED_ITEM',
  'MISSING_ON_INVOICE',
  'UNIT_MISMATCH',
  'UNORDERED_ARRIVAL',
  'DUPLICATE_INVOICE',
  'DATE_ANOMALY',
  'VAT_MISMATCH',
  'TOTAL_MISMATCH',
] as const;
export type DiscrepancyType = (typeof DISCREPANCY_TYPES)[number];

/** `resolution_status` values (packages/db schema enum). */
export const RESOLUTION_STATUS_VALUES = ['open', 'accepted', 'rejected', 'escalated', 'resolved'] as const;
export type ResolutionStatusValue = (typeof RESOLUTION_STATUS_VALUES)[number];

/** A status as the money sees it: the five DB values plus the system-accepted `tolerated`. */
export const DECISION_KEYS = [...RESOLUTION_STATUS_VALUES, 'tolerated'] as const;
export type DecisionKey = (typeof DECISION_KEYS)[number];

export const DECISIONS = ['accept', 'reject', 'escalate', 'resolve', 'reopen', 'tolerate'] as const;
export type Decision = (typeof DECISIONS)[number];
/** Decisions only the system takes (never a button). */
export const SYSTEM_DECISIONS: ReadonlySet<Decision> = new Set<Decision>(['tolerate']);

export const EFFECTS = ['undecided', 'claim', 'waive', 'excluded'] as const;
export type Effect = (typeof EFFECTS)[number];

/** What each decision writes: the DB status, and the money key it is read back as. */
export const DECISION_TO_STATUS: Readonly<Record<Decision, { status: ResolutionStatusValue; key: DecisionKey }>> = {
  accept: { status: 'accepted', key: 'accepted' },
  reject: { status: 'rejected', key: 'rejected' },
  escalate: { status: 'escalated', key: 'escalated' },
  resolve: { status: 'resolved', key: 'resolved' },
  reopen: { status: 'open', key: 'open' },
  tolerate: { status: 'accepted', key: 'tolerated' },
};

/** Never leak, whatever is decided: an under-charge and a delivery waiting for its PO link. */
export const NEVER_LEAK_TYPES: ReadonlySet<DiscrepancyType> = new Set<DiscrepancyType>(['PRICE_LOWER', 'UNORDERED_ARRIVAL']);
/**
 * Leak that is never asked back from a supplier (owner 31.10: an ordered line never
 * billed has nothing to credit). Mirrors lib/claims NEVER_CLAIMABLE_TYPES minus the
 * never-leak types; slice b points lib/claims here.
 */
export const NEVER_CLAIMED_LEAK_TYPES: ReadonlySet<DiscrepancyType> = new Set<DiscrepancyType>(['MISSING_ON_INVOICE']);

export interface DecisionRule {
  /** Decisions a person (or, for `tolerate`, the system) may take on this type. */
  allowed: readonly Decision[];
  /** The one primary call to action (T2: one primary CTA). */
  primary: Decision;
  /** Decision → the status it writes. */
  toStatus: Readonly<Record<Decision, ResolutionStatusValue>>;
  /** Status (incl. `tolerated`) → its ₪ effect. */
  effect: Readonly<Record<DecisionKey, Effect>>;
}

const HUMAN: readonly Decision[] = ['accept', 'reject', 'escalate', 'resolve', 'reopen'];
const TO_STATUS = Object.fromEntries(DECISIONS.map((d) => [d, DECISION_TO_STATUS[d].status])) as Record<
  Decision,
  ResolutionStatusValue
>;

function ruleFor(type: DiscrepancyType): DecisionRule {
  if (NEVER_LEAK_TYPES.has(type)) {
    return {
      allowed: HUMAN,
      // A delivery with no PO is resolved by linking it; an under-charge is simply acknowledged.
      primary: type === 'UNORDERED_ARRIVAL' ? 'resolve' : 'accept',
      toStatus: TO_STATUS,
      effect: { open: 'excluded', escalated: 'excluded', accepted: 'excluded', resolved: 'excluded', rejected: 'excluded', tolerated: 'excluded' },
    };
  }
  const decided: Effect = NEVER_CLAIMED_LEAK_TYPES.has(type) ? 'waive' : 'claim';
  return {
    allowed: [...HUMAN, 'tolerate'],
    primary: 'accept',
    toStatus: TO_STATUS,
    effect: {
      open: 'undecided',
      escalated: 'undecided',
      accepted: decided,
      resolved: decided,
      tolerated: 'waive',
      // "Not a duplicate": no money was at risk — it leaves the leak (LEAK_FILTER).
      rejected: type === 'DUPLICATE_INVOICE' ? 'excluded' : 'waive',
    },
  };
}

export const DECISION_RULES: Readonly<Record<DiscrepancyType, DecisionRule>> = Object.fromEntries(
  DISCREPANCY_TYPES.map((t) => [t, ruleFor(t)]),
) as Record<DiscrepancyType, DecisionRule>;

const isDecision = (v: string): v is Decision => (DECISIONS as readonly string[]).includes(v);
const isKey = (v: string): v is DecisionKey => (DECISION_KEYS as readonly string[]).includes(v);

/**
 * The ₪ effect of a type under a status or a decision. THE ONLY status → ₪ mapping.
 * Severity is not part of it: an `info` row never counts (LEAK_FILTER), whatever its status.
 */
export function effectOf(type: string, statusOrDecision: string): Effect {
  const rule = DECISION_RULES[type as DiscrepancyType];
  if (!rule) throw new Error(`effectOf: unknown discrepancy type ${type}`);
  const key: DecisionKey | null = isDecision(statusOrDecision)
    ? DECISION_TO_STATUS[statusOrDecision].key
    : isKey(statusOrDecision)
      ? statusOrDecision
      : null;
  if (!key) throw new Error(`effectOf: unknown status or decision ${statusOrDecision}`);
  return rule.effect[key];
}

/**
 * SQL for the decision key of discrepancy alias `d` (`tolerated` = accepted with no
 * resolved_at, until slice b persists it explicitly).
 */
export const DECISION_KEY_SQL: SQL = sql`(CASE
  WHEN d.resolution_status = 'accepted' AND d.resolved_at IS NULL THEN 'tolerated'
  ELSE d.resolution_status::text END)`;

/** SQL for effectOf(d.type, decision key) — generated from DECISION_RULES, never hand-written. */
export function effectSql(): SQL {
  const arms: SQL[] = [];
  for (const key of DECISION_KEYS) {
    const byEffect = new Map<Effect, string[]>();
    for (const t of DISCREPANCY_TYPES) {
      const e = DECISION_RULES[t].effect[key];
      byEffect.set(e, [...(byEffect.get(e) ?? []), t]);
    }
    for (const [e, types] of byEffect) {
      arms.push(
        sql`WHEN ${DECISION_KEY_SQL} = ${key} AND d.type::text IN (${sql.join(
          types.map((t) => sql`${t}`),
          sql`, `,
        )}) THEN ${e}`,
      );
    }
  }
  return sql`(CASE ${sql.join(arms, sql` `)} END)`;
}

/* ───────────────────────── money states ───────────────────────── */

/** The eight money states. Every agora of the leak is in exactly one. */
export const MONEY_STATES = [
  'undecided',
  'to_offset',
  'to_send',
  'requested',
  'disputed',
  'credited',
  'recovered',
  'waived',
] as const;
export type MoneyState = (typeof MONEY_STATES)[number];

/** recovery_claims.status values (packages/db RECOVERY_STATUSES). */
export type ClaimStatus = 'claimed' | 'letter_sent' | 'acknowledged' | 'credited' | 'recovered' | 'disputed' | 'written_off';

/**
 * A claim that still holds money: anything but a write-off that never received any
 * (the same rule syncClaims uses for the per-invoice cap).
 */
export function isLiveClaim(status: ClaimStatus | null, creditedAgorot: number): boolean {
  return status != null && !(status === 'written_off' && creditedAgorot === 0);
}

/**
 * A row's money state. A live claim is money in motion, so its status wins; otherwise
 * the decision's effect decides. A decided, claimable row whose invoice is not paid yet
 * is offset against the payment; once paid it is a letter to send (decision 19: one
 * channel per state).
 */
export function moneyStateOf(input: {
  effect: Effect;
  claimStatus: ClaimStatus | null;
  creditedAgorot: number;
  invoicePaid: boolean;
}): MoneyState {
  const { effect, claimStatus, creditedAgorot, invoicePaid } = input;
  if (effect === 'excluded') throw new Error('moneyStateOf: an excluded row is not leak');
  if (isLiveClaim(claimStatus, creditedAgorot)) {
    switch (claimStatus) {
      case 'claimed':
        return invoicePaid ? 'to_send' : 'to_offset';
      case 'letter_sent':
      case 'acknowledged':
        return 'requested';
      case 'disputed':
        return 'disputed';
      case 'credited':
      case 'written_off': // written off after part of it was credited
        return 'credited';
      case 'recovered':
        return 'recovered';
    }
  }
  if (effect === 'undecided') return 'undecided';
  if (effect === 'claim') return invoicePaid ? 'to_send' : 'to_offset';
  return 'waived';
}

/**
 * Allocation tier of a row under the one per-invoice-cap allocator: 1 = holds a live
 * claim (reads its persisted amount), 2 = other decided rows, 3 = undecided rows (get
 * only what is left of the cap).
 */
export function allocationTier(effect: Effect, liveClaim: boolean): 1 | 2 | 3 {
  if (liveClaim) return 1;
  return effect === 'undecided' ? 3 : 2;
}
