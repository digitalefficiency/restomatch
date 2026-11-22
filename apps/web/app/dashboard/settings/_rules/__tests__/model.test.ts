import { describe, expect, it } from 'vitest';
import {
  ALL_FIELDS,
  canStep,
  changesOf,
  errorOf,
  fieldDef,
  isDirty,
  sameAsSnapshot,
  savePatch,
  savedAfter,
  stepValue,
  undoPatch,
  valuesFrom,
  type Defaults,
  type FormValues,
} from '../model';

/** The engines' defaults (tolerances.ts, approvals/engine.ts, ocr DEFAULT_REVIEW_THRESHOLD). */
const D: Defaults = {
  pricePercent: 0.02,
  priceAbsolute: 5,
  qtyPercent: 0.03,
  qtyAbsolute: 1,
  blockPricePercent: 0.1,
  largeInvoiceWithoutPo: 5000,
  unorderedItemSignificant: 100,
  cumulativeLargeAmount: 300,
  cumulativeLargePct: 0.05,
  cumulativeMediumAmountMin: 50,
  cumulativeMediumPctMin: 0.02,
  ocrReviewThreshold: 0.85,
};

const set = (v: FormValues, patch: Partial<FormValues>): FormValues => ({ ...v, ...patch });

describe('stored ⇄ form values', () => {
  it('reads only the stored overrides; everything else is the default (null)', () => {
    const v = valuesFrom({
      tolerances: { pricePercent: 0.075 },
      approvalThresholds: { largeInvoiceWithoutPo: 4000 },
      ocrReviewThreshold: 0.8,
    });
    expect(v.pricePercent).toBe('7.5');
    expect(v.largeInvoiceWithoutPo).toBe('4000');
    expect(v.ocrReviewThreshold).toBe('80');
    expect(v.qtyPercent).toBeNull();
    expect(Object.keys(v)).toHaveLength(ALL_FIELDS.length);
  });
});

describe('the save patch keeps today’s settings.update semantics', () => {
  const saved = valuesFrom({ tolerances: { pricePercent: 0.05, qtyAbsolute: 2 } });

  it('nothing changed → no patch, not dirty', () => {
    expect(savePatch(saved, saved, D)).toBeNull();
    expect(isDirty(saved, saved, D)).toBe(false);
  });

  it('a typed value is stored ("7,5" works); an untouched field is left out', () => {
    const v = set(saved, { qtyPercent: '7,5' });
    expect(savePatch(v, saved, D)).toEqual({ tolerances: { qtyPercent: 0.075 } });
  });

  it('back to default on an override sends null (the server deletes the key)', () => {
    const v = set(saved, { pricePercent: null });
    expect(savePatch(v, saved, D)).toEqual({ tolerances: { pricePercent: null } });
  });

  it('approval thresholds and OCR go in their own groups', () => {
    const v = set(saved, { cumulativeLargeAmount: '450', ocrReviewThreshold: '90' });
    expect(savePatch(v, saved, D)).toEqual({
      approvalThresholds: { cumulativeLargeAmount: 450 },
      ocrReviewThreshold: 0.9,
    });
  });

  it('stepping away from a default and back is no change (no override written)', () => {
    let v = saved;
    v = set(v, { blockPricePercent: stepValue(v, D, fieldDef('blockPricePercent'), 1) });
    expect(v.blockPricePercent).toBe('11');
    expect(isDirty(v, saved, D)).toBe(true);
    v = set(v, { blockPricePercent: stepValue(v, D, fieldDef('blockPricePercent'), -1) });
    expect(v.blockPricePercent).toBe('10');
    expect(isDirty(v, saved, D)).toBe(false);
    expect(savePatch(v, saved, D)).toBeNull();
  });

  it('typing the default over an existing override keeps it as an override (explicit choice)', () => {
    const v = set(saved, { pricePercent: '2' });
    expect(savePatch(v, saved, D)).toEqual({ tolerances: { pricePercent: 0.02 } });
  });

  it('after saving, a default-equal typed value is the default again', () => {
    const v = set(saved, { qtyAbsolute: '1', priceAbsolute: '7' });
    const after = savedAfter(v, saved, D);
    // qtyAbsolute had an override (2) → typed 1 = an explicit override equal to the default.
    expect(after.qtyAbsolute).toBe('1');
    expect(after.priceAbsolute).toBe('7');
  });
});

describe('undo puts back exactly what was there', () => {
  it('changed overrides return to their old values; a new override is removed again (null)', () => {
    const before = valuesFrom({ tolerances: { pricePercent: 0.05 } });
    const after = valuesFrom({ tolerances: { pricePercent: 0.03, qtyPercent: 0.06 } });
    expect(undoPatch(before, after)).toEqual({
      tolerances: { pricePercent: 0.05, qtyPercent: null },
    });
    expect(undoPatch(before, before)).toBeNull();
  });
});

describe('limits are the server’s, said only when broken', () => {
  it('percent 0–100, amounts non-negative within the cap', () => {
    expect(errorOf('170', fieldDef('pricePercent'))).toBe('percentRange');
    expect(errorOf('-1', fieldDef('priceAbsolute'))).toBe('amountInvalid');
    expect(errorOf('abc', fieldDef('largeInvoiceWithoutPo'))).toBe('amountInvalid');
    expect(errorOf('7,5', fieldDef('pricePercent'))).toBeNull();
    expect(errorOf(null, fieldDef('pricePercent'))).toBeNull();
  });

  it('steppers clamp at 0 and at the maximum', () => {
    const zero = set(valuesFrom({}), { qtyAbsolute: '0' });
    expect(canStep(zero, D, fieldDef('qtyAbsolute'), -1)).toBe(false);
    expect(stepValue(zero, D, fieldDef('qtyAbsolute'), -1)).toBe('0');
    const full = set(valuesFrom({}), { pricePercent: '100' });
    expect(canStep(full, D, fieldDef('pricePercent'), 1)).toBe(false);
    expect(stepValue(full, D, fieldDef('pricePercent'), 1)).toBe('100');
  });
});

describe('history diff from the audit rows', () => {
  it('lists each changed field, null = the default', () => {
    const before = {
      tolerances: { pricePercent: 0.05 },
      approvalThresholds: {},
      ocrReviewThreshold: null,
    };
    const after = {
      tolerances: { pricePercent: 0.03, qtyAbsolute: 2 },
      approvalThresholds: {},
      ocrReviewThreshold: 0.9,
    };
    expect(changesOf(before, after)).toEqual([
      { key: 'pricePercent', from: 0.05, to: 0.03 },
      { key: 'qtyAbsolute', from: null, to: 2 },
      { key: 'ocrReviewThreshold', from: null, to: 0.9 },
    ]);
    expect(changesOf(after, after)).toEqual([]);
  });

  it('restore applies only while the saved state still equals the entry’s result', () => {
    const after = {
      tolerances: { pricePercent: 0.03 },
      approvalThresholds: {},
      ocrReviewThreshold: null,
    };
    expect(sameAsSnapshot(valuesFrom(after), after)).toBe(true);
    expect(sameAsSnapshot(valuesFrom({}), after)).toBe(false);
  });
});
