/**
 * W3-06 · ONE figure set for the public site (mkt-11/-13, design-system-23).
 *
 * The landing math, the proof strip, the ROI calculator's defaults, the
 * showcase leak hero, its Needs-you rows and the showcase end card all read
 * this one sample month, so a visitor never sees two different "examples".
 * Every surface that renders it labels it "דוגמה" — it is an illustration,
 * not a promise and never a target (docs/COSTS.md, GTM §5.2: the visitor's
 * real number appears after two weeks of scanning).
 *
 * A whole sample month, shekels, ex-VAT. Pure data + derivations: no React,
 * no DOM, no formatting (₪ is rendered at the edge through formatIls() /
 * <Money>). Reviewed by leak-economist (orchestrator, 7.11): numbers kept.
 */

/** Purchases from suppliers in the sample month (ex-VAT). The calculator default. */
export const SAMPLE_PURCHASING_ILS = 150_000;

/** The illustrative leak rate, in percent (an example only, never a target). */
export const SAMPLE_LEAK_PCT = 1.5;

/** The sample month's leak = purchases × rate. ₪2,250. */
export const SAMPLE_LEAK_ILS = Math.round(SAMPLE_PURCHASING_ILS * SAMPLE_LEAK_PCT) / 100;

/**
 * The hero's split BY PAYMENT STATUS for this static month, the same split the
 * product hero makes (`lib/components/hero/model.ts` leakSplit): the leak on
 * invoices not yet paid, where payment can still be held, and the leak on
 * invoices already paid, where a credit is the only way back. It is NOT the
 * G-14 partition (the 8 money states) and says nothing about decisions.
 * The two parts sum to the hero to the agora (locked by a test).
 */
export const SAMPLE_UNPAID_ILS = 1_530;
export const SAMPLE_PAID_ILS = SAMPLE_LEAK_ILS - SAMPLE_UNPAID_ILS;

/** "נתפסו לפני תשלום" (the M6-signed term) = the leak on unpaid invoices. */
export const SAMPLE_CAUGHT_BEFORE_PAYMENT_ILS = SAMPLE_UNPAID_ILS;

/** "35 חשבוניות נבדקו · 13 עם פער". */
export const SAMPLE_INVOICES_CHECKED = 35;
export const SAMPLE_INVOICES_WITH_GAP = 13;

/** Invoices still being checked: a neutral T4 note under the hero, never a task. */
export const SAMPLE_INVOICES_IN_CHECK = 7;

/**
 * The T2 "מחכה לך" rows of the sample owner: one verb each, ranked by ₪ ×
 * urgency. `decide` = gaps on unpaid invoices still waiting for the owner's
 * decision (inside the unpaid part); `credit` = credit requests to send on
 * paid invoices (the paid part).
 */
export const SAMPLE_NEEDS = [
  { key: 'decide', tone: 'danger', amountIls: 910, count: 2 },
  { key: 'credit', tone: 'warn', amountIls: 720, count: 3 },
] as const;

/** Still undecided money on unpaid invoices (the `decide` row). */
export const SAMPLE_UNDECIDED_ILS = SAMPLE_NEEDS[0].amountIls;

/**
 * The one T3 good-news line quotes only DECIDED money: what was caught before
 * payment minus what still waits for a decision. ₪620 — kept off the Pro price
 * on purpose (₪590 would look staged).
 */
export const SAMPLE_GOOD_NEWS_ILS = SAMPLE_CAUGHT_BEFORE_PAYMENT_ILS - SAMPLE_UNDECIDED_ILS;
