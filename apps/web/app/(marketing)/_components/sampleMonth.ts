/**
 * W3-06 · ONE figure set for the public site (mkt-11/-13, design-system-23).
 *
 * The landing math, the proof strip, the ROI calculator's defaults, the
 * showcase leak hero, its Needs-you rows and the showcase end card all read
 * this one sample month, so a visitor never sees two different "examples".
 * Every surface that renders it labels it "דוגמה" — it is an illustration,
 * not a promise (docs/COSTS.md, GTM §5.2: the visitor's real number appears
 * after two weeks of scanning).
 *
 * Shekels, ex-VAT. Pure data + derivations: no React, no DOM, no formatting
 * (₪ is rendered at the edge through formatIls() / <Money>).
 */

/** Purchases from suppliers in the sample month (ex-VAT). The calculator default. */
export const SAMPLE_PURCHASING_ILS = 150_000;

/** The illustrative leak rate, in percent (the North Star floor; never a target). */
export const SAMPLE_LEAK_PCT = 1.5;

/** The sample month's leak = purchases × rate. ₪2,250. */
export const SAMPLE_LEAK_ILS = Math.round(SAMPLE_PURCHASING_ILS * SAMPLE_LEAK_PCT) / 100;

/**
 * The leak's partition (G-14 / M6 vocabulary): what was stopped before the
 * invoice was paid, and what was already paid and now waits for a credit
 * note. The two parts sum to the hero to the agora (locked by a test).
 */
export const SAMPLE_CAUGHT_BEFORE_PAYMENT_ILS = 1_530;
export const SAMPLE_AWAITING_CREDIT_ILS = SAMPLE_LEAK_ILS - SAMPLE_CAUGHT_BEFORE_PAYMENT_ILS;

/** "35 חשבוניות נבדקו · 13 עם פער". */
export const SAMPLE_INVOICES_CHECKED = 35;
export const SAMPLE_INVOICES_WITH_GAP = 13;

/** Day span of the sample month as the hero eyebrow names it ("1–25 באוקטובר"). */
export const SAMPLE_MONTH_DAYS = { from: 1, to: 25, month: 10 } as const;

/**
 * The T2 "מחכה לך" rows of the sample owner: one verb each, ranked by ₪ ×
 * urgency. Their ₪ is the part of the leak that still needs a hand
 * (awaiting approval + credit requests to send) — never more than the leak.
 */
export const SAMPLE_NEEDS = [
  { key: 'approve', tone: 'danger', amountIls: 940, count: 2 },
  { key: 'credit', tone: 'warn', amountIls: 720, count: 3 },
  { key: 'pending', tone: 'neutral', amountIls: null, count: 7 },
] as const;

/** One T3 good-news line: caught before payment this month. */
export const SAMPLE_GOOD_NEWS_ILS = SAMPLE_CAUGHT_BEFORE_PAYMENT_ILS;
