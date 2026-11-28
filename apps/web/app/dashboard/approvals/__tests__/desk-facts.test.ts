import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  abs4,
  amountBasisOf,
  barKindOf,
  batchBasisBlock,
  BILLED_OVER_RECEIVED,
  calcOf,
  claimNoteOf,
  costOf,
  decisionBlockOf,
  deltaAgorot,
  effectOf,
  evidenceKindOf,
  groupByTier,
  headParts,
  mulAgorot,
  P90_PREFIX,
  priceBasisOf,
  qtyOverKindOf,
  remainingAfter,
  sameUnit,
  sourcesOf,
  tableOf,
  TIER_ORDER,
  tierOf,
  toNumber4,
  units4,
  type BarKind,
  type CostForm,
  type GapInput,
  type GapType,
} from '../desk-facts';
import { decisionActions } from '../vocab';

/**
 * DS3-04 spec §2.1 / §7.1 (S1): the desk's pure facts. Fixtures are the four owner rows of the demo
 * (SP/map/stack.md §6, data-owner.json) with the S2 router fields, plus one synthetic row per type and variant.
 */

const BASE: GapInput = {
  id: 'g-1',
  type: 'PRICE_HIGHER',
  severity: 'warn',
  deltaAmount: null,
  expectedValue: null,
  actualValue: null,
  toleranceUsed: null,
  qtyBilled: null,
  billedUnit: null,
  qtyOrdered: null,
  orderedUnit: null,
  qtyReceived: null,
  poId: 'po-1',
  poDate: '2026-10-14T04:30:00.000Z',
  invoiceId: 'inv-1',
  invoiceLineId: 'line-1',
  claimable: true,
  claimAgorot: 0,
  invoiceStatus: 'matched',
  hasScan: false,
  unitPriceExpected: null,
  unitPriceBilled: null,
  lineTotal: null,
};
const gap = (o: Partial<GapInput>): GapInput => ({ ...BASE, ...o });

// ── the demo rows (verbatim from data-owner.json) + the S2 fields ──────────────────────────────
const SH_24121 = gap({
  id: 'e6529196-9769-4ac8-9e16-2def6d8342a6',
  type: 'QTY_OVER',
  severity: 'block',
  deltaAmount: '38.70',
  expectedValue: '6.5000',
  actualValue: '9.5000',
  toleranceUsed: 'billed quantity exceeds received quantity',
  qtyBilled: '9.500',
  billedUnit: 'ק״ג',
  qtyOrdered: '9.500',
  orderedUnit: 'ק״ג',
  qtyReceived: '6.500',
  poId: '426a7eb5-65f8-4667-95cc-0bae5037e3b1',
  poDate: '2026-10-14T04:30:00.000Z',
  invoiceId: 'a1fb7b37-7ce2-435e-ad24-cb60fa15aa1a',
  invoiceLineId: 'd514bf18-32e2-4dfc-82be-61bc47733c13',
  claimable: true,
  claimAgorot: 3870,
  invoiceStatus: 'disputed',
  hasScan: false,
  unitPriceExpected: '12.9000',
  unitPriceBilled: '12.9000',
  lineTotal: '122.55',
});
const ST_24108 = gap({
  id: '8ff24c71-0a40-4691-ac90-01e148188de4',
  type: 'PRICE_HIGHER',
  severity: 'block',
  deltaAmount: '104.80',
  expectedValue: '522.6000',
  actualValue: '575.0000',
  toleranceUsed: 'price: ±2% or ₪5',
  qtyBilled: '2.000',
  billedUnit: 'חבית',
  qtyOrdered: '2.000',
  orderedUnit: 'חבית',
  qtyReceived: null,
  poId: '748bf61f-95eb-4a46-b2ad-32790abea2a3',
  poDate: '2026-10-20T08:30:00.000Z',
  invoiceId: '4d4bc28c-2401-40cc-9df0-270a390d7604',
  invoiceLineId: '20ac5b32-6c30-4022-ac12-d426fa90f376',
  claimable: true,
  claimAgorot: 10480,
  invoiceStatus: 'disputed',
  hasScan: false,
  unitPriceExpected: '522.6000',
  unitPriceBilled: '575.0000',
  lineTotal: '1150.00',
});
const HK_24108 = gap({
  id: '0f8773d1-b2f1-46df-b5c2-ad47cae4f2d5',
  type: 'PRICE_HIGHER',
  severity: 'warn',
  deltaAmount: '100.00',
  expectedValue: '139.0000',
  actualValue: '149.0000',
  toleranceUsed: 'price: ±2% or ₪5',
  qtyBilled: '10.000',
  billedUnit: 'ק״ג',
  qtyOrdered: '10.000',
  orderedUnit: 'ק״ג',
  qtyReceived: null,
  poId: '2985c840-d7e5-43fc-bf1f-c555a79b5159',
  poDate: '2026-10-18T06:30:00.000Z',
  invoiceId: '67e93adc-5399-4991-8b39-2e217005e4bf',
  invoiceLineId: 'd6cb2ca8-e488-430b-85b5-7476f8a08b8f',
  claimable: true,
  claimAgorot: 10000,
  invoiceStatus: 'matched',
  hasScan: false,
  unitPriceExpected: '139.0000',
  unitPriceBilled: '149.0000',
  lineTotal: '1490.00',
});
const MF_24108 = gap({
  id: 'ae5b07d6-432e-4cb6-bdfb-651626ad6f5d',
  type: 'PRICE_HIGHER',
  severity: 'warn',
  deltaAmount: '52.50',
  expectedValue: '89.0000',
  actualValue: '96.0000',
  toleranceUsed: 'price: ±2% or ₪5',
  qtyBilled: '7.500',
  billedUnit: 'ק״ג',
  qtyOrdered: '7.500',
  orderedUnit: 'ק״ג',
  qtyReceived: null,
  poId: '9d758940-9fbd-40c0-9f29-0f50154b71bd',
  poDate: '2026-10-19T08:00:00.000Z',
  invoiceId: '7d2017f5-8697-4127-ae9d-4b134f2a42d5',
  invoiceLineId: 'c4a15a19-02ba-4195-ad02-c9a0aad8e0cf',
  claimable: true,
  claimAgorot: 5250,
  invoiceStatus: 'matched',
  hasScan: false,
  unitPriceExpected: '89.0000',
  unitPriceBilled: '96.0000',
  lineTotal: '720.00',
});

// ── synthetic rows: one per type and variant ───────────────────────────────────────────────────
/** The engine priced from a contract (E 522.60) while the PO line says 540.00. */
const PRICE_CONTRACT = gap({ ...ST_24108, id: 'p-contract', unitPriceExpected: '540.0000' });
/** Above the supplier's p90 (₪42): 2 × (48 − 42) = 12.00; the PO's own price is 45.00. */
const PRICE_P90 = gap({
  id: 'p-p90',
  type: 'PRICE_HIGHER',
  severity: 'warn',
  deltaAmount: '12.00',
  expectedValue: '42.0000',
  actualValue: '48.0000',
  toleranceUsed: `${P90_PREFIX} of ₪42`,
  qtyBilled: '2.000',
  billedUnit: 'ק״ג',
  qtyOrdered: '2.000',
  orderedUnit: 'ק״ג',
  unitPriceExpected: '45.0000',
  unitPriceBilled: '48.0000',
  lineTotal: '96.00',
  claimAgorot: 1200,
});
const PRICE_P90_NO_PO_PRICE = gap({ ...PRICE_P90, id: 'p-p90-none', unitPriceExpected: null });
/** An orphan PO (the router nulls the PO side): 3 × (12 − 10) = 6.00, priced per the billed unit. */
const PRICE_ORPHAN = gap({
  id: 'p-orphan',
  type: 'PRICE_HIGHER',
  severity: 'warn',
  deltaAmount: '6.00',
  expectedValue: '10.0000',
  actualValue: '12.0000',
  toleranceUsed: 'price: ±2% or ₪5',
  qtyBilled: '3.000',
  billedUnit: 'יח׳',
  qtyOrdered: null,
  orderedUnit: null,
  poId: null,
  unitPriceExpected: null,
  unitPriceBilled: '12.0000',
  lineTotal: '36.00',
  claimAgorot: 600,
});
const PRICE_LOWER = gap({
  id: 'p-lower',
  type: 'PRICE_LOWER',
  severity: 'info',
  deltaAmount: '4.00',
  expectedValue: '20.0000',
  actualValue: '18.0000',
  toleranceUsed: 'price: ±2% or ₪5',
  qtyBilled: '2.000',
  billedUnit: 'יח׳',
  qtyOrdered: '2.000',
  orderedUnit: 'יח׳',
  unitPriceExpected: '20.0000',
  unitPriceBilled: '18.0000',
  claimable: false,
  claimAgorot: 0,
});
/** QTY_OVER 5a: ordered 10, received 12 → 2 over the order × 5.00 = 10.00. */
const QTY_5A = gap({
  id: 'q-5a',
  type: 'QTY_OVER',
  severity: 'warn',
  deltaAmount: '10.00',
  expectedValue: '10.0000',
  actualValue: '12.0000',
  toleranceUsed: 'qty: ±3% or 1 units',
  qtyBilled: '10.000',
  billedUnit: 'יח׳',
  qtyOrdered: '10.000',
  orderedUnit: 'יח׳',
  qtyReceived: '12.000',
  unitPriceExpected: '5.0000',
  unitPriceBilled: '5.0000',
  lineTotal: '50.00',
  claimAgorot: 1000,
});
const QTY_5A_UNBILLED = gap({
  ...QTY_5A,
  id: 'q-5a-unbilled',
  invoiceLineId: null,
  qtyBilled: null,
  billedUnit: null,
  unitPriceBilled: null,
  lineTotal: null,
});
const QTY_5A_NO_PRICE = gap({ ...QTY_5A, id: 'q-5a-noprice', unitPriceExpected: null });
const QTY_5B_UNITS = gap({ ...SH_24121, id: 'q-5b-units', billedUnit: 'גרם' });
/** QTY_SHORT: ordered 3, received 2 → 1 short × 95.23. */
const QTY_SHORT = gap({
  id: 'q-short',
  type: 'QTY_SHORT',
  severity: 'warn',
  deltaAmount: '95.23',
  expectedValue: '3.0000',
  actualValue: '2.0000',
  toleranceUsed: 'qty: ±3% or 1 units',
  qtyBilled: '3.000',
  billedUnit: 'ק״ג',
  qtyOrdered: '3.000',
  orderedUnit: 'ק״ג',
  qtyReceived: '2.000',
  unitPriceExpected: '95.2300',
  unitPriceBilled: '95.2300',
  lineTotal: '285.69',
  claimAgorot: 9523,
});
/** The engine priced the short unit at a contract's 90.00; the PO line (unitPriceExpected) says 95.23. */
const QTY_SHORT_CONTRACT = gap({ ...QTY_SHORT, id: 'q-short-contract', deltaAmount: '90.00', claimAgorot: 9000 });
/** With a 5b sibling the engine prices (E−A) − overlap: ordered 5, received 3, billed 4 → 2 short, 1 already billed. */
const QTY_SHORT_OVERLAP = gap({
  id: 'q-short-overlap',
  type: 'QTY_SHORT',
  severity: 'warn',
  deltaAmount: '10.00',
  expectedValue: '5.0000',
  actualValue: '3.0000',
  toleranceUsed: 'qty: ±3% or 1 units',
  qtyBilled: '4.000',
  billedUnit: 'יח׳',
  qtyOrdered: '5.000',
  orderedUnit: 'יח׳',
  qtyReceived: '3.000',
  unitPriceExpected: '10.0000',
  unitPriceBilled: '10.0000',
  claimAgorot: 1000,
});
/** MISSING_ON_INVOICE: 4 boxes ordered (and counted in), never billed: 4 × 7.50 = 30.00. */
const MISSING = gap({
  id: 'm-1',
  type: 'MISSING_ON_INVOICE',
  severity: 'warn',
  deltaAmount: '30.00',
  expectedValue: '4.0000',
  actualValue: '0.0000',
  toleranceUsed: 'PO line must appear on invoice',
  qtyOrdered: '4.000',
  orderedUnit: 'ארגז',
  qtyReceived: '4.000',
  invoiceLineId: null,
  unitPriceExpected: '7.5000',
  claimable: false,
  claimAgorot: 0,
});
const MISSING_NO_GR = gap({ ...MISSING, id: 'm-2', qtyReceived: null });
/** UNORDERED_ITEM: 3 × 4.50 = 13.50 = the printed line total. */
const UNORDERED = gap({
  id: 'u-1',
  type: 'UNORDERED_ITEM',
  severity: 'block',
  deltaAmount: '13.50',
  actualValue: '3.0000',
  toleranceUsed: 'invoice line must match a PO line',
  qtyBilled: '3.000',
  billedUnit: 'יח׳',
  unitPriceBilled: '4.5000',
  lineTotal: '13.50',
  claimAgorot: 1350,
});
/** The printed line total is not Qb × Pb (a discount on the line). */
const UNORDERED_DISCOUNT = gap({ ...UNORDERED, id: 'u-2', deltaAmount: '12.00', lineTotal: '12.00', claimAgorot: 1200 });
/** Printed VAT 170.00 against 168.30 by the rate (above), and the other way round (below). */
const VAT_ABOVE = gap({
  id: 'v-up',
  type: 'VAT_MISMATCH',
  severity: 'warn',
  deltaAmount: '1.70',
  expectedValue: '168.3000',
  actualValue: '170.0000',
  toleranceUsed: '17% VAT on subtotal, ±₪0.1',
  invoiceLineId: null,
  claimAgorot: 170,
});
const VAT_BELOW = gap({ ...VAT_ABOVE, id: 'v-down', expectedValue: '170.0000', actualValue: '168.3000' });
/** The lines sum to 1,000.00 (E); the printed subtotal says 1,050.00 (A) — and the other way round. */
const TOTAL_ABOVE = gap({
  id: 't-up',
  type: 'TOTAL_MISMATCH',
  severity: 'block',
  deltaAmount: '50.00',
  expectedValue: '1000.0000',
  actualValue: '1050.0000',
  toleranceUsed: '±₪0.1',
  invoiceLineId: null,
  claimAgorot: 5000,
});
const TOTAL_BELOW = gap({ ...TOTAL_ABOVE, id: 't-down', expectedValue: '1050.0000', actualValue: '1000.0000' });
const DUPLICATE = gap({
  id: 'd-1',
  type: 'DUPLICATE_INVOICE',
  severity: 'block',
  deltaAmount: '1180.00',
  toleranceUsed: 'invoice number uniqueness per supplier',
  invoiceLineId: null,
  claimAgorot: 118000,
});
const ARRIVAL = gap({
  id: 'a-1',
  type: 'UNORDERED_ARRIVAL',
  severity: 'block',
  deltaAmount: '590.00',
  toleranceUsed: 'PO must exist for invoice',
  poId: null,
  invoiceLineId: null,
  claimable: false,
  claimAgorot: 0,
});
const UNIT = gap({
  id: 'un-1',
  type: 'UNIT_MISMATCH',
  severity: 'warn',
  deltaAmount: '0.00',
  toleranceUsed: 'unit must match between PO and invoice',
  qtyBilled: '6.000',
  billedUnit: 'ארגז',
  qtyOrdered: '36.000',
  orderedUnit: 'יח׳',
  claimable: false,
  claimAgorot: 0,
});
const DATE = gap({
  id: 'dt-1',
  type: 'DATE_ANOMALY',
  severity: 'warn',
  deltaAmount: '0.00',
  toleranceUsed: '±7 days from expected delivery',
  invoiceLineId: null,
  claimable: false,
  claimAgorot: 0,
});

const ALL_TYPES: GapType[] = [
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
];

const qty = (v4: bigint, unit: string | null) => ({ kind: 'qty', v4, unit });
const price = (v4: bigint, per: string | null) => ({ kind: 'price', v4, per });
const word = (w: string) => ({ kind: 'word', word: w });

// ── 1 ──────────────────────────────────────────────────────────────────────────────────────────
describe('exact arithmetic (never a float in a calculation)', () => {
  it('units4 reads a NUMERIC string exactly at scale 4', () => {
    expect(units4('0.0050')).toBe(50n);
    expect(units4('99999999.9999')).toBe(999_999_999_999n);
    expect(units4('6.5000')).toBe(65_000n);
    expect(units4('9.500')).toBe(95_000n);
    expect(units4('38.70')).toBe(387_000n);
    expect(units4('-12.50')).toBe(-125_000n);
    expect(units4(' 12.9000 ')).toBe(129_000n);
    expect(units4('abc')).toBeNull();
    expect(units4('')).toBeNull();
    expect(units4('-')).toBeNull();
    expect(units4('--5')).toBeNull();
    expect(units4(null)).toBeNull();
    expect(units4(undefined)).toBeNull();
    // never a guess: grouping is off, and more than 4 decimals is not NUMERIC(12,4)
    expect(units4('1,250')).toBeNull();
    expect(units4('1.23456')).toBeNull();
  });

  it('deltaAgorot is |Δ| in integer agorot', () => {
    expect(deltaAgorot({ deltaAmount: '-104.80' })).toBe(10_480n);
    expect(deltaAgorot({ deltaAmount: '104.80' })).toBe(10_480n);
    expect(deltaAgorot({ deltaAmount: '0.00' })).toBe(0n);
    expect(deltaAgorot({ deltaAmount: '99999999.99' })).toBe(9_999_999_999n);
    expect(deltaAgorot({ deltaAmount: null })).toBeNull();
    expect(deltaAgorot({ deltaAmount: 'x' })).toBeNull();
  });

  it('mulAgorot rounds half-up once, at the agora', () => {
    expect(mulAgorot(5_000n, 100n)).toBe(1n); // 0.5 × ₪0.01 = ₪0.005 → 1 agora
    expect(mulAgorot(4_999n, 100n)).toBe(0n); // just under half an agora
    expect(mulAgorot(30_000n, 129_000n)).toBe(3_870n); // 3 × 12.90
    expect(mulAgorot(20_000n, 524_000n)).toBe(10_480n); // 2 × 52.40
    expect(mulAgorot(0n, 129_000n)).toBe(0n);
  });

  it('abs4 and the display-only toNumber4', () => {
    expect(abs4(-5n)).toBe(5n);
    expect(abs4(5n)).toBe(5n);
    expect(toNumber4(129_000n)).toBe(12.9);
    expect(toNumber4(39_167n)).toBe(3.9167);
    expect(toNumber4(-125_000n)).toBe(-12.5);
  });

  it('sameUnit normalises like the engine', () => {
    expect(sameUnit('ק״ג', 'ק"ג')).toBe(true);
    expect(sameUnit(' KG ', 'kg')).toBe(true);
    expect(sameUnit('יח׳', "יח'")).toBe(true);
    expect(sameUnit('kg', 'ק״ג')).toBe(false);
    expect(sameUnit(null, 'kg')).toBe(false);
    expect(sameUnit('kg', undefined)).toBe(false);
    expect(sameUnit(null, null)).toBe(false);
  });
});

// ── 2 ──────────────────────────────────────────────────────────────────────────────────────────
describe('tiers', () => {
  it('tierOf: block, warn, anything else is info', () => {
    expect(TIER_ORDER).toEqual(['block', 'warn', 'info']);
    expect(tierOf({ severity: 'block' })).toBe('block');
    expect(tierOf({ severity: 'warn' })).toBe('warn');
    expect(tierOf({ severity: 'info' })).toBe('info');
    expect(tierOf({ severity: 'whatever' })).toBe('info');
  });

  type R = { id: string; severity: string; done?: boolean };
  const rows: R[] = [
    { id: 'b1', severity: 'block' },
    { id: 'b2', severity: 'block', done: true },
    { id: 'w1', severity: 'warn' },
    { id: 'w2', severity: 'warn' },
    { id: 'i1', severity: 'info', done: true },
    { id: 'i2', severity: 'info' },
  ];
  const isOpen = (r: R) => !r.done;

  it('block → warn → info, input order kept; open excludes done rows', () => {
    expect(groupByTier(rows, isOpen, false).map((t) => [t.tier, t.rows.map((r) => r.id), t.open])).toEqual([
      ['block', ['b1', 'b2'], 1],
      ['warn', ['w1', 'w2'], 2],
      ['info', ['i1', 'i2'], 1],
    ]);
  });

  it('empty tiers are omitted', () => {
    expect(groupByTier(rows.filter((r) => r.severity !== 'warn'), isOpen, false).map((t) => t.tier)).toEqual(['block', 'info']);
    expect(groupByTier([], isOpen, false)).toEqual([]);
  });

  it('the last tier shows no count while more pages exist', () => {
    expect(groupByTier(rows.slice(0, 4), isOpen, true).map((t) => [t.tier, t.open])).toEqual([
      ['block', 1],
      ['warn', null],
    ]);
    expect(groupByTier(rows, isOpen, true).map((t) => t.open)).toEqual([1, 2, null]);
  });
});

// ── 3 ──────────────────────────────────────────────────────────────────────────────────────────
describe('headParts (from the summary, never from loaded rows)', () => {
  const parts = (count: number, blockers: number, claimableIls = 296) => headParts({ count, blockers, claimableIls });

  it('every clause', () => {
    expect(parts(0, 0)).toEqual({ kind: 'empty' });
    expect(parts(0, 3)).toEqual({ kind: 'empty' });
    expect(parts(4, 0)).toEqual({ kind: 'some', count: 4, blockers: 0, claimableIls: 296, clause: 'none' });
    expect(parts(1, 1)).toEqual({ kind: 'some', count: 1, blockers: 1, claimableIls: 296, clause: 'one' });
    expect(parts(2, 2)).toMatchObject({ clause: 'both', blockers: 2 });
    expect(parts(3, 3)).toMatchObject({ clause: 'all', blockers: 3 });
    expect(parts(7, 7)).toMatchObject({ clause: 'all' });
    expect(parts(4, 1)).toMatchObject({ clause: 'some', blockers: 1 });
    expect(parts(2, 1)).toMatchObject({ clause: 'some', blockers: 1 });
    expect(parts(4, 2)).toMatchObject({ clause: 'some', blockers: 2 }); // the demo: 4 gaps, 2 of them block
    expect(parts(4, 3)).toMatchObject({ clause: 'some', blockers: 3 });
    expect(parts(1, 0, 0)).toEqual({ kind: 'some', count: 1, blockers: 0, claimableIls: 0, clause: 'none' });
  });

  it('blockers above the count clamp to it', () => {
    expect(parts(2, 5)).toMatchObject({ clause: 'both', blockers: 2 });
    expect(parts(1, 3)).toMatchObject({ clause: 'one', blockers: 1 });
    expect(parts(5, 9)).toMatchObject({ clause: 'all', blockers: 5 });
  });
});

// ── 4 ──────────────────────────────────────────────────────────────────────────────────────────
describe('tableOf (§2.1.1: every value from the row)', () => {
  it('PRICE · order basis: E is the order price, the received column is not checked', () => {
    expect(priceBasisOf(ST_24108)).toBe('order');
    expect(tableOf(ST_24108)).toEqual({
      qty: { ordered: qty(20_000n, 'חבית'), received: word('notChecked'), billed: qty(20_000n, 'חבית') },
      price: { ordered: price(5_226_000n, 'חבית'), received: word('noPriceOnReceipt'), billed: price(5_750_000n, 'חבית') },
      flagged: { row: 'price', cell: 'billed' },
      gap: { kind: 'pct', ratio: 0.100267, direction: 'more', p90: false },
      tone: 'leak',
    });
  });

  it('PRICE · contract basis: E carries the contract flag', () => {
    expect(priceBasisOf(PRICE_CONTRACT)).toBe('contract');
    // before S2's router seam lands the field is absent: the basis cannot be proven an order price
    expect(priceBasisOf(gap({ ...ST_24108, unitPriceExpected: undefined }))).toBe('contract');
    const t = tableOf(PRICE_CONTRACT)!;
    expect(t.qty).toEqual(tableOf(ST_24108)!.qty);
    expect(t.price).toEqual({
      ordered: { kind: 'price', v4: 5_226_000n, per: 'חבית', contract: true },
      received: word('noPriceOnReceipt'),
      billed: price(5_750_000n, 'חבית'),
    });
    expect(t.gap).toEqual({ kind: 'pct', ratio: 0.100267, direction: 'more', p90: false });
  });

  it('PRICE · p90 basis: the ordered price is the PO price (or noOrderPrice), never E', () => {
    expect(priceBasisOf(PRICE_P90)).toBe('p90');
    const t = tableOf(PRICE_P90)!;
    expect(t.price.ordered).toEqual(price(450_000n, 'ק״ג'));
    expect(t.price.ordered).not.toEqual(price(420_000n, 'ק״ג'));
    expect(t.price.billed).toEqual(price(480_000n, 'ק״ג'));
    expect(t.gap).toEqual({ kind: 'pct', ratio: 0.142857, direction: 'more', p90: true });
    expect(t.flagged).toEqual({ row: 'price', cell: 'billed' });
    expect(tableOf(PRICE_P90_NO_PO_PRICE)!.price.ordered).toEqual(word('noOrderPrice'));
  });

  it('PRICE · expected basis (orphan PO): the ordered quantity is unknown, prices per the billed unit', () => {
    expect(priceBasisOf(PRICE_ORPHAN)).toBe('expected');
    expect(tableOf(PRICE_ORPHAN)).toEqual({
      qty: { ordered: word('unknown'), received: word('notChecked'), billed: qty(30_000n, 'יח׳') },
      price: { ordered: price(100_000n, 'יח׳'), received: word('noPriceOnReceipt'), billed: price(120_000n, 'יח׳') },
      flagged: { row: 'price', cell: 'billed' },
      gap: { kind: 'pct', ratio: 0.2, direction: 'more', p90: false },
      tone: 'warn',
    });
  });

  it('PRICE_LOWER: the gap is "less", info is neutral', () => {
    expect(tableOf(PRICE_LOWER)).toMatchObject({
      flagged: { row: 'price', cell: 'billed' },
      gap: { kind: 'pct', ratio: 0.1, direction: 'less', p90: false },
      tone: 'neutral',
    });
  });

  it('QTY_OVER 5b (billed over received): received = E, the gap is A − E less', () => {
    expect(qtyOverKindOf(SH_24121)).toBe('5b');
    expect(SH_24121.toleranceUsed).toBe(BILLED_OVER_RECEIVED);
    expect(tableOf(SH_24121)).toEqual({
      qty: { ordered: qty(95_000n, 'ק״ג'), received: qty(65_000n, 'ק״ג'), billed: qty(95_000n, 'ק״ג') },
      price: { ordered: price(129_000n, 'ק״ג'), received: word('noPriceOnReceipt'), billed: price(129_000n, 'ק״ג') },
      flagged: { row: 'qty', cell: 'received' },
      gap: { kind: 'qty', v4: 30_000n, unit: 'ק״ג', direction: 'less' },
      tone: 'leak',
    });
  });

  it('QTY_OVER 5a (received over ordered): ordered = E, received = A, the gap is A − E more', () => {
    expect(qtyOverKindOf(QTY_5A)).toBe('5a');
    expect(qtyOverKindOf(ST_24108)).toBeNull();
    expect(tableOf(QTY_5A)).toEqual({
      qty: { ordered: qty(100_000n, 'יח׳'), received: qty(120_000n, 'יח׳'), billed: qty(100_000n, 'יח׳') },
      price: { ordered: price(50_000n, 'יח׳'), received: word('noPriceOnReceipt'), billed: price(50_000n, 'יח׳') },
      flagged: { row: 'qty', cell: 'received' },
      gap: { kind: 'qty', v4: 20_000n, unit: 'יח׳', direction: 'more' },
      tone: 'warn',
    });
    const unbilled = tableOf(QTY_5A_UNBILLED)!;
    expect(unbilled.qty.billed).toEqual(word('notBilled'));
    expect(unbilled.price.billed).toEqual(word('notBilled'));
    expect(tableOf(QTY_5A_NO_PRICE)!.price.ordered).toEqual(word('noOrderPrice'));
  });

  it('QTY_SHORT: ordered = E, received = A, the gap is E − A less', () => {
    expect(tableOf(QTY_SHORT)).toEqual({
      qty: { ordered: qty(30_000n, 'ק״ג'), received: qty(20_000n, 'ק״ג'), billed: qty(30_000n, 'ק״ג') },
      price: { ordered: price(952_300n, 'ק״ג'), received: word('noPriceOnReceipt'), billed: price(952_300n, 'ק״ג') },
      flagged: { row: 'qty', cell: 'received' },
      gap: { kind: 'qty', v4: 10_000n, unit: 'ק״ג', direction: 'less' },
      tone: 'warn',
    });
  });

  it('MISSING_ON_INVOICE: not billed; the received quantity only from the row (else noReceipt)', () => {
    expect(tableOf(MISSING)).toEqual({
      qty: { ordered: qty(40_000n, 'ארגז'), received: qty(40_000n, 'ארגז'), billed: word('notBilled') },
      price: { ordered: price(75_000n, 'ארגז'), received: word('noPriceOnReceipt'), billed: word('notBilled') },
      flagged: { row: 'qty', cell: 'billed' },
      gap: null,
      tone: 'warn',
    });
    expect(tableOf(MISSING_NO_GR)!.qty.received).toEqual(word('noReceipt'));
  });

  it('UNORDERED_ITEM: not ordered, no receipt, billed = A', () => {
    expect(tableOf(UNORDERED)).toEqual({
      qty: { ordered: word('notOrdered'), received: word('noReceipt'), billed: qty(30_000n, 'יח׳') },
      price: { ordered: word('notOrdered'), received: word('noPriceOnReceipt'), billed: price(45_000n, 'יח׳') },
      flagged: { row: 'qty', cell: 'ordered' },
      gap: null,
      tone: 'leak',
    });
  });

  it('exactly one flagged cell per table type; null for the six other types', () => {
    const flags: Array<[GapInput, string, string]> = [
      [ST_24108, 'price', 'billed'],
      [PRICE_LOWER, 'price', 'billed'],
      [SH_24121, 'qty', 'received'],
      [QTY_5A, 'qty', 'received'],
      [QTY_SHORT, 'qty', 'received'],
      [MISSING, 'qty', 'billed'],
      [UNORDERED, 'qty', 'ordered'],
    ];
    for (const [g, row, cell] of flags) expect(tableOf(g)?.flagged, g.id).toEqual({ row, cell });
    for (const g of [DUPLICATE, ARRIVAL, UNIT, DATE, VAT_ABOVE, TOTAL_ABOVE]) expect(tableOf(g), g.type).toBeNull();
  });

  it('E = 0 → no written gap; the flagged cell keeps its tone', () => {
    const t = tableOf(gap({ ...ST_24108, expectedValue: '0.0000' }))!;
    expect(t.gap).toBeNull();
    expect(t.tone).toBe('leak');
    expect(t.flagged).toEqual({ row: 'price', cell: 'billed' });
  });

  it('a null quantity is a word, never 0', () => {
    expect(tableOf(gap({ ...ST_24108, qtyOrdered: null }))!.qty.ordered).toEqual(word('unknown'));
    expect(tableOf(gap({ ...ST_24108, actualValue: null }))!.price.billed).toEqual(word('unknown'));
  });
});

// ── 5 ──────────────────────────────────────────────────────────────────────────────────────────
describe('calcOf (§2.1.2: the result is always the stored |Δ|)', () => {
  it('the four demo rows factorise to 3870 / 10480 / 10000 / 5250 agorot', () => {
    expect(calcOf(SH_24121)).toEqual({
      kind: 'times',
      left: { kind: 'qty', v4: 30_000n, unit: 'ק״ג', label: 'notReceived' },
      right: { kind: 'price', v4: 129_000n, per: 'ק״ג', source: 'billed' },
      resultAgorot: 3_870n,
      basis: 'excl',
    });
    expect(calcOf(ST_24108)).toEqual({
      kind: 'times',
      left: { kind: 'qty', v4: 20_000n, unit: 'חבית', label: 'billed' },
      right: { kind: 'priceDiff', v4: 524_000n, per: 'חבית', direction: 'more', basis: 'order' },
      resultAgorot: 10_480n,
      basis: 'excl',
    });
    expect(calcOf(HK_24108)).toMatchObject({ kind: 'times', resultAgorot: 10_000n, left: { v4: 100_000n }, right: { v4: 100_000n } });
    expect(calcOf(MF_24108)).toMatchObject({ kind: 'times', resultAgorot: 5_250n, left: { v4: 75_000n }, right: { v4: 70_000n } });
  });

  it('each price basis keeps its own priceDiff; PRICE_LOWER reads "less"; an orphan prices per the billed unit', () => {
    expect(calcOf(PRICE_CONTRACT)).toMatchObject({ kind: 'times', right: { basis: 'contract' } });
    expect(calcOf(PRICE_P90)).toMatchObject({ kind: 'times', resultAgorot: 1_200n, right: { kind: 'priceDiff', v4: 60_000n, basis: 'p90' } });
    expect(calcOf(PRICE_ORPHAN)).toMatchObject({ kind: 'times', resultAgorot: 600n, right: { per: 'יח׳', basis: 'expected' } });
    expect(calcOf(PRICE_LOWER)).toMatchObject({ kind: 'times', resultAgorot: 400n, right: { direction: 'less', v4: 20_000n } });
  });

  it('QTY_SHORT, 5a, MISSING and UNORDERED factorise when the product is the stored Δ', () => {
    expect(calcOf(QTY_SHORT)).toEqual({
      kind: 'times',
      left: { kind: 'qty', v4: 10_000n, unit: 'ק״ג', label: 'short' },
      right: { kind: 'price', v4: 952_300n, per: 'ק״ג', source: 'order' },
      resultAgorot: 9_523n,
      basis: 'excl',
    });
    expect(calcOf(QTY_5A)).toMatchObject({ kind: 'times', left: { label: 'overOrder', v4: 20_000n }, right: { source: 'order' } });
    expect(calcOf(MISSING)).toMatchObject({ kind: 'times', resultAgorot: 3_000n, left: { label: 'notBilled', v4: 40_000n, unit: 'ארגז' } });
    expect(calcOf(UNORDERED)).toEqual({
      kind: 'times',
      left: { kind: 'qty', v4: 30_000n, unit: 'יח׳', label: 'notOrdered' },
      right: { kind: 'price', v4: 45_000n, per: 'יח׳', source: 'billed' },
      resultAgorot: 1_350n,
      basis: 'excl',
    });
  });

  it('the honest fallbacks: mismatch, units, missing, lineTotal', () => {
    const fb = (resultAgorot: bigint, why: string, label = 'fallback') => ({ kind: 'fallback', resultAgorot, label, basis: 'excl', why });
    expect(calcOf(QTY_SHORT_CONTRACT)).toEqual(fb(9_000n, 'mismatch')); // a contract price, not the PO line's
    expect(calcOf(QTY_SHORT_OVERLAP)).toEqual(fb(1_000n, 'mismatch')); // (E−A) − overlap
    expect(calcOf(QTY_5B_UNITS)).toEqual(fb(3_870n, 'units')); // Ub ≠ Uo
    expect(calcOf(gap({ ...HK_24108, billedUnit: 'גרם' }))).toEqual(fb(10_000n, 'units'));
    expect(calcOf(gap({ ...PRICE_ORPHAN, billedUnit: null }))).toEqual(fb(600n, 'units'));
    expect(calcOf(QTY_5A_NO_PRICE)).toEqual(fb(1_000n, 'missing')); // Pexp null
    expect(calcOf(gap({ ...SH_24121, unitPriceBilled: null }))).toEqual(fb(3_870n, 'missing'));
    expect(calcOf(gap({ ...ST_24108, qtyBilled: null }))).toEqual(fb(10_480n, 'missing'));
    expect(calcOf(UNORDERED_DISCOUNT)).toEqual(fb(1_200n, 'mismatch', 'lineTotal')); // Qb × Pb ≠ the printed total
    expect(calcOf(gap({ ...UNORDERED, unitPriceBilled: null }))).toEqual(fb(1_350n, 'missing', 'lineTotal'));
  });

  it('VAT and TOTAL subtract, the larger figure first in both directions, each label kept (R4)', () => {
    expect(calcOf(VAT_ABOVE)).toEqual({
      kind: 'minus',
      left: { kind: 'money', v4: 1_700_000n, label: 'vatPrinted' },
      right: { kind: 'money', v4: 1_683_000n, label: 'vatByRate' },
      resultAgorot: 170n,
      basis: 'vat',
    });
    // "‏170.00 ₪ המע״מ לפי השיעור − ‏168.30 ₪ המע״מ בחשבונית = ‏1.70 ₪", never a false equation
    expect(calcOf(VAT_BELOW)).toEqual({
      kind: 'minus',
      left: { kind: 'money', v4: 1_700_000n, label: 'vatByRate' },
      right: { kind: 'money', v4: 1_683_000n, label: 'vatPrinted' },
      resultAgorot: 170n,
      basis: 'vat',
    });
    expect(calcOf(TOTAL_ABOVE)).toEqual({
      kind: 'minus',
      left: { kind: 'money', v4: 10_500_000n, label: 'subtotal' },
      right: { kind: 'money', v4: 10_000_000n, label: 'sumOfLines' },
      resultAgorot: 5_000n,
      basis: 'excl',
    });
    expect(calcOf(TOTAL_BELOW)).toEqual({
      kind: 'minus',
      left: { kind: 'money', v4: 10_500_000n, label: 'sumOfLines' },
      right: { kind: 'money', v4: 10_000_000n, label: 'subtotal' },
      resultAgorot: 5_000n,
      basis: 'excl',
    });
    expect(calcOf(gap({ ...VAT_ABOVE, deltaAmount: '1.00' }))).toMatchObject({ kind: 'fallback', why: 'mismatch', resultAgorot: 100n });
    expect(calcOf(gap({ ...TOTAL_ABOVE, actualValue: null }))).toMatchObject({ kind: 'fallback', why: 'missing' });
  });

  it('DUPLICATE / ARRIVAL / UNIT / DATE and a missing Δ have no calculation', () => {
    for (const g of [DUPLICATE, ARRIVAL, UNIT, DATE]) expect(calcOf(g), g.type).toEqual({ kind: 'none' });
    expect(calcOf(gap({ ...ST_24108, deltaAmount: null }))).toEqual({ kind: 'none' });
    expect(calcOf(gap({ ...SH_24121, deltaAmount: 'n/a' }))).toEqual({ kind: 'none' });
  });

  it('a seeded loop of 200 random rows of every line type: resultAgorot === deltaAgorot(g) whatever the branch', () => {
    // mulberry32: a deterministic PRNG so the loop is the same on every run.
    let state = 0x5eed_0404;
    const rnd = () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    };
    const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
    /** A scale-4 integer as a NUMERIC string with `dp` decimals (v4 must sit on that grid). */
    const numeric = (v4: bigint, dp: number): string => {
      const neg = v4 < 0n;
      const digits = abs4(v4).toString().padStart(5, '0');
      const whole = digits.slice(0, -4);
      const frac = digits.slice(-4).slice(0, dp);
      return `${neg ? '-' : ''}${whole}${dp > 0 ? `.${frac}` : ''}`;
    };
    const qty4 = () => BigInt(int(1, 99_999)) * 10n; // 0.001 … 999.990, 3 decimals
    const price4 = () => BigInt(int(1, 9_999_999)); // 0.0001 … 999.9999, 4 decimals
    const agorot4 = () => BigInt(int(0, 9_999_999)) * 100n; // 2 decimals
    const maybe = <T,>(v: T): T | null => (rnd() < 0.08 ? null : v);
    const UNITS = ['ק״ג', 'ק"ג', 'יח׳', 'גרם', 'ליטר'];
    const unit = () => UNITS[int(0, UNITS.length - 1)]!;
    const LINE_TYPES = [
      'PRICE_HIGHER',
      'PRICE_LOWER',
      'QTY_OVER',
      'QTY_SHORT',
      'MISSING_ON_INVOICE',
      'UNORDERED_ITEM',
      'UNIT_MISMATCH',
      'VAT_MISMATCH',
      'TOTAL_MISMATCH',
    ] as const;
    const CALC_TYPES = new Set<string>(LINE_TYPES.filter((t) => t !== 'UNIT_MISMATCH'));

    let factorised = 0;
    let fellBack = 0;
    for (let i = 0; i < 200; i++) {
      const type = LINE_TYPES[i % LINE_TYPES.length]!;
      const uo = unit();
      const ub = rnd() < 0.8 ? uo : unit();
      const qb = qty4();
      const e = type.startsWith('PRICE') ? price4() : type === 'VAT_MISMATCH' || type === 'TOTAL_MISMATCH' ? agorot4() : qty4();
      const a = type.startsWith('PRICE') ? price4() : type === 'VAT_MISMATCH' || type === 'TOTAL_MISMATCH' ? agorot4() : qty4();
      const pexp = price4();
      const pb = price4();
      const fivesB = type === 'QTY_OVER' && rnd() < 0.5;
      // Half of the rows carry the Δ the engine would store (so the factorised branch runs), half a random one.
      let consistent: bigint;
      switch (type) {
        case 'PRICE_HIGHER':
        case 'PRICE_LOWER':
          consistent = mulAgorot(qb, abs4(a - e));
          break;
        case 'QTY_OVER':
          consistent = mulAgorot(abs4(a - e), fivesB ? pb : pexp);
          break;
        case 'QTY_SHORT':
          consistent = mulAgorot(abs4(e - a), pexp);
          break;
        case 'MISSING_ON_INVOICE':
          consistent = mulAgorot(e, pexp);
          break;
        case 'UNORDERED_ITEM':
          consistent = mulAgorot(qb, pb);
          break;
        case 'VAT_MISMATCH':
        case 'TOTAL_MISMATCH':
          consistent = abs4(a - e) / 100n;
          break;
        default:
          consistent = 0n;
      }
      const deltaAg = rnd() < 0.5 ? consistent : BigInt(int(0, 999_999));
      const g = gap({
        id: `r-${i}`,
        type,
        severity: ['block', 'warn', 'info'][int(0, 2)]!,
        deltaAmount: maybe(numeric(deltaAg * 100n * (rnd() < 0.3 ? -1n : 1n), 2)),
        expectedValue: maybe(numeric(e, 4)),
        actualValue: maybe(numeric(a, 4)),
        toleranceUsed: fivesB ? BILLED_OVER_RECEIVED : rnd() < 0.15 ? `${P90_PREFIX} of ₪10` : 'price: ±2% or ₪5',
        qtyBilled: maybe(numeric(qb, 3)),
        billedUnit: maybe(ub),
        qtyOrdered: maybe(numeric(qty4(), 3)),
        orderedUnit: maybe(uo),
        poId: rnd() < 0.1 ? null : 'po-1',
        unitPriceExpected: maybe(numeric(pexp, 4)),
        unitPriceBilled: maybe(numeric(pb, 4)),
      });
      const c = calcOf(g);
      const d = deltaAgorot(g);
      if (c.kind === 'none') {
        expect(d == null || !CALC_TYPES.has(type), `${g.id} ${type}`).toBe(true);
        continue;
      }
      expect(c.resultAgorot, `${g.id} ${type} ${c.kind}`).toBe(d);
      if (c.kind === 'times') {
        factorised++;
        expect(mulAgorot(c.left.v4, c.right.v4), g.id).toBe(c.resultAgorot);
      } else if (c.kind === 'minus') {
        factorised++;
        expect(c.left.v4 >= c.right.v4, g.id).toBe(true);
        expect(abs4(c.left.v4 - c.right.v4), g.id).toBe(c.resultAgorot * 100n);
      } else {
        fellBack++;
      }
    }
    // the loop really exercised both branches
    expect(factorised).toBeGreaterThan(20);
    expect(fellBack).toBeGreaterThan(20);
  });
});

// ── 6 ──────────────────────────────────────────────────────────────────────────────────────────
describe('sourcesOf (§2.1.3: keyed by the term, never by its position)', () => {
  it('PRICE: the billed quantity from the invoice (or its scan), the prices by basis', () => {
    expect(sourcesOf(calcOf(ST_24108), ST_24108)).toEqual([
      { term: 'left', key: 'invoice', kind: 'invoice' },
      { term: 'right', key: 'pricesOrder', kind: 'invoice', values: { billed: 5_750_000n, expected: 5_226_000n } },
    ]);
    const scanned = gap({ ...ST_24108, hasScan: true });
    expect(sourcesOf(calcOf(scanned), scanned)[0]).toEqual({ term: 'left', key: 'scan', kind: 'scan' });
    expect(sourcesOf(calcOf(PRICE_CONTRACT), PRICE_CONTRACT)[1]).toMatchObject({ key: 'pricesContract', kind: 'invoice' });
    expect(sourcesOf(calcOf(PRICE_P90), PRICE_P90)[1]).toMatchObject({
      key: 'pricesP90',
      values: { billed: 480_000n, expected: 420_000n },
    });
    expect(sourcesOf(calcOf(PRICE_ORPHAN), PRICE_ORPHAN)[1]).toMatchObject({ key: 'pricesExpected' });
  });

  it('5b: billed and counted, then the billed price', () => {
    expect(sourcesOf(calcOf(SH_24121), SH_24121)).toEqual([
      { term: 'left', key: 'billedCounted', kind: 'count', values: { billed: 95_000n, counted: 65_000n, unit: 'ק״ג' } },
      { term: 'right', key: 'invoice', kind: 'invoice' },
    ]);
  });

  it('5a, QTY_SHORT and MISSING: counts and the order (with its date)', () => {
    const order = (term: 'left' | 'right', poDate: string) => ({ term, key: 'order', kind: 'order', poDate });
    expect(sourcesOf(calcOf(QTY_5A), QTY_5A)).toEqual([
      { term: 'left', key: 'countedOrdered', kind: 'count', values: { counted: 120_000n, ordered: 100_000n, unit: 'יח׳' } },
      order('right', '2026-10-14T04:30:00.000Z'),
    ]);
    expect(sourcesOf(calcOf(QTY_SHORT), QTY_SHORT)).toEqual([
      { term: 'left', key: 'orderedCounted', kind: 'count', values: { ordered: 30_000n, counted: 20_000n, unit: 'ק״ג' } },
      order('right', '2026-10-14T04:30:00.000Z'),
    ]);
    expect(sourcesOf(calcOf(MISSING), MISSING)).toEqual([
      order('left', '2026-10-14T04:30:00.000Z'),
      order('right', '2026-10-14T04:30:00.000Z'),
    ]);
  });

  it('UNORDERED: both factors from the invoice', () => {
    expect(sourcesOf(calcOf(UNORDERED), UNORDERED)).toEqual([
      { term: 'left', key: 'invoice', kind: 'invoice' },
      { term: 'right', key: 'invoice', kind: 'invoice' },
    ]);
  });

  it('a swapped VAT / TOTAL minus keeps each source on its own label', () => {
    const printed = (term: 'left' | 'right') => ({ term, key: 'invoice', kind: 'invoice' });
    const engine = (term: 'left' | 'right') => ({ term, key: 'engine', kind: 'invoice' });
    expect(sourcesOf(calcOf(VAT_ABOVE), VAT_ABOVE)).toEqual([printed('left'), engine('right')]);
    expect(sourcesOf(calcOf(VAT_BELOW), VAT_BELOW)).toEqual([engine('left'), printed('right')]);
    expect(sourcesOf(calcOf(TOTAL_ABOVE), TOTAL_ABOVE)).toEqual([printed('left'), engine('right')]);
    expect(sourcesOf(calcOf(TOTAL_BELOW), TOTAL_BELOW)).toEqual([engine('left'), printed('right')]);
    const scanned = gap({ ...VAT_BELOW, hasScan: true });
    expect(sourcesOf(calcOf(scanned), scanned)[1]).toEqual({ term: 'right', key: 'scan', kind: 'scan' });
  });

  it('[] for a fallback or no calculation', () => {
    expect(sourcesOf(calcOf(QTY_SHORT_CONTRACT), QTY_SHORT_CONTRACT)).toEqual([]);
    expect(sourcesOf(calcOf(UNORDERED_DISCOUNT), UNORDERED_DISCOUNT)).toEqual([]);
    expect(sourcesOf(calcOf(DUPLICATE), DUPLICATE)).toEqual([]);
  });
});

// ── 7 ──────────────────────────────────────────────────────────────────────────────────────────
describe('claimNoteOf', () => {
  it('equal → null; 0 < claim < |Δ| → capped; claim 0 → none; not claimable → null', () => {
    expect(claimNoteOf(ST_24108)).toBeNull();
    expect(claimNoteOf(gap({ ...HK_24108, claimAgorot: 6_000 }))).toEqual({ kind: 'capped', claimAgorot: 6_000, deltaAgorot: 10_000 });
    expect(claimNoteOf(gap({ ...HK_24108, claimAgorot: 0 }))).toEqual({ kind: 'none', claimAgorot: 0, deltaAgorot: 10_000 });
    expect(claimNoteOf(PRICE_LOWER)).toBeNull();
    expect(claimNoteOf(gap({ ...HK_24108, claimable: false, claimAgorot: 6_000 }))).toBeNull();
  });
});

// ── 8 ──────────────────────────────────────────────────────────────────────────────────────────
describe('costOf (what paying as billed costs)', () => {
  it('one case per form, amount = |Δ|', () => {
    const forms: Array<[GapInput, ReturnType<typeof costOf>]> = [
      [ST_24108, { form: 'priceOrder', amountAgorot: 10_480n }],
      [PRICE_CONTRACT, { form: 'priceContract', amountAgorot: 10_480n }],
      [PRICE_P90, { form: 'priceP90', amountAgorot: 1_200n }],
      [SH_24121, { form: 'qtyNotReceived', amountAgorot: 3_870n, qty4: 30_000n, unit: 'ק״ג' }],
      [QTY_5A, { form: 'qtyOverOrder', amountAgorot: 1_000n, qty4: 20_000n, unit: 'יח׳' }],
      [QTY_SHORT, { form: 'qtyShort', amountAgorot: 9_523n, qty4: 10_000n, unit: 'ק״ג' }],
      [UNORDERED, { form: 'unordered', amountAgorot: 1_350n }],
      [DUPLICATE, { form: 'duplicate', amountAgorot: 118_000n }],
      [VAT_ABOVE, { form: 'vat', amountAgorot: 170n }],
      [VAT_BELOW, { form: 'vatBelow', amountAgorot: 170n }],
      [TOTAL_ABOVE, { form: 'total', amountAgorot: 5_000n }],
      [TOTAL_BELOW, { form: 'totalBelow', amountAgorot: 5_000n }],
      [MISSING, { form: 'other', amountAgorot: 3_000n }],
    ];
    for (const [g, want] of forms) expect(costOf(g), g.id).toEqual(want);
    const ALL_FORMS: CostForm[] = [
      'priceOrder',
      'priceContract',
      'priceP90',
      'qtyNotReceived',
      'qtyOverOrder',
      'qtyShort',
      'unordered',
      'duplicate',
      'vat',
      'vatBelow',
      'total',
      'totalBelow',
      'other',
    ];
    expect(new Set(forms.map(([, c]) => c.form))).toEqual(new Set(ALL_FORMS));
  });

  it('falls back to "other": an orphan PRICE, a qty form without a unit, an unparsable VAT/TOTAL, the rest', () => {
    expect(costOf(PRICE_ORPHAN)).toEqual({ form: 'other', amountAgorot: 600n });
    expect(costOf(gap({ ...SH_24121, orderedUnit: null }))).toEqual({ form: 'other', amountAgorot: 3_870n });
    expect(costOf(gap({ ...QTY_SHORT, orderedUnit: ' ' }))).toEqual({ form: 'other', amountAgorot: 9_523n });
    expect(costOf(gap({ ...VAT_ABOVE, actualValue: null }))).toEqual({ form: 'other', amountAgorot: 170n });
    expect(costOf(gap({ ...TOTAL_BELOW, expectedValue: 'x' }))).toEqual({ form: 'other', amountAgorot: 5_000n });
    for (const g of [ARRIVAL, UNIT, DATE]) expect(costOf(g).form, g.type).toBe('other');
    expect(costOf(gap({ ...ST_24108, deltaAmount: null }))).toEqual({ form: 'priceOrder', amountAgorot: 0n });
  });
});

// ── 9 ──────────────────────────────────────────────────────────────────────────────────────────
describe('decision kinds and bases for all 12 types', () => {
  it('barKindOf follows vocab.decisionActions for 12 types × claimable true/false', () => {
    const expected = (type: GapType, claimable: boolean): BarKind =>
      type === 'UNORDERED_ARRIVAL'
        ? 'link'
        : type === 'PRICE_LOWER' || type === 'MISSING_ON_INVOICE' || !claimable
          ? 'review'
          : type === 'DUPLICATE_INVOICE'
            ? 'duplicate'
            : 'claimPay';
    for (const type of ALL_TYPES) {
      for (const claimable of [true, false]) {
        const kind = barKindOf({ type, claimable });
        expect(kind, `${type} claimable=${claimable}`).toBe(expected(type, claimable));
        // …and the actions vocab.ts offers for that row are exactly that bar
        const actions = decisionActions(type, claimable);
        const shape = actions.map((a) => (a.kind === 'approve' ? `approve:${a.withAmount}` : a.kind));
        const want = { link: ['link'], review: ['review'], duplicate: ['approve:false', 'reject'], claimPay: ['approve:true', 'reject'] }[kind];
        expect(shape, `${type} claimable=${claimable}`).toEqual(want);
      }
    }
  });

  it('evidenceKindOf, amountBasisOf and batchBasisBlock', () => {
    const want: Record<GapType, [string, string, 'vat' | null]> = {
      PRICE_HIGHER: ['table', 'excl', null],
      PRICE_LOWER: ['table', 'excl', null],
      QTY_SHORT: ['table', 'excl', null],
      QTY_OVER: ['table', 'excl', null],
      UNORDERED_ITEM: ['table', 'excl', null],
      MISSING_ON_INVOICE: ['table', 'excl', null],
      UNIT_MISMATCH: ['fact', 'excl', null],
      UNORDERED_ARRIVAL: ['fact', 'incl', null],
      DUPLICATE_INVOICE: ['fact', 'incl', null],
      DATE_ANOMALY: ['fact', 'excl', null],
      VAT_MISMATCH: ['calcOnly', 'vat', 'vat'],
      TOTAL_MISMATCH: ['calcOnly', 'excl', null],
    };
    for (const type of ALL_TYPES) {
      expect([evidenceKindOf(type), amountBasisOf(type), batchBasisBlock({ type })], type).toEqual(want[type]);
    }
    expect(evidenceKindOf('SOMETHING_NEW')).toBe('fact');
    expect(amountBasisOf('SOMETHING_NEW')).toBe('excl');
  });
});

// ── 10 ─────────────────────────────────────────────────────────────────────────────────────────
describe('effect, block seam, remaining', () => {
  it('effectOf: claimable rows only; paid → paid, anything else → unpaid', () => {
    expect(effectOf({ claimable: true, invoiceStatus: 'paid' })).toBe('paid');
    expect(effectOf({ claimable: true, invoiceStatus: 'disputed' })).toBe('unpaid');
    expect(effectOf({ claimable: true })).toBe('unpaid');
    expect(effectOf({ claimable: false, invoiceStatus: 'paid' })).toBeNull();
  });

  it('decisionBlockOf is #190’s seam: null today', () => {
    expect(decisionBlockOf({ invoiceId: 'inv-1' })).toBeNull();
    expect(decisionBlockOf({ invoiceId: null })).toBeNull();
  });

  it('remainingAfter(0..3) → 0, 0, 1, 2', () => {
    expect([0, 1, 2, 3].map(remainingAfter)).toEqual([0, 0, 1, 2]);
  });
});

// ── 11 ─────────────────────────────────────────────────────────────────────────────────────────
describe('desk-facts.ts source guards', () => {
  const SRC = readFileSync(new URL('../desk-facts.ts', import.meta.url), 'utf8');

  it('never Number() or parseFloat() on a NUMERIC field (R8)', () => {
    expect(SRC).not.toMatch(/(?:Number|parseFloat)\((g|row)\.(deltaAmount|expectedValue|actualValue|qty\w+|unitPrice\w+|lineTotal)/);
    expect(SRC).not.toMatch(/parseFloat\(/);
  });

  it('imports only @restomatch/types and ./vocab: no React, no tRPC, no translator', () => {
    const imports = [...SRC.matchAll(/^import\s[^;]*?from\s+'([^']+)';$/gm)].map((m) => m[1]);
    expect(imports).toEqual(['@restomatch/types', './vocab']);
    expect(SRC).not.toMatch(/from 'react'|@trpc\/|lib\/trpc|lib\/i18n|\buseT\b|Translator</);
    expect(SRC).not.toMatch(/^['"]use client['"]/m);
  });
});
