import { describe, expect, it } from 'vitest';
import { normalizeExtraction } from '../providers/normalizeExtraction';

const lineWithVat = (vatRate: unknown) =>
  (normalizeExtraction({
    lines: [{ rawDescription: 'x', qty: 1, unit: 'kg', unitPrice: 10, lineTotal: 10, vatRate }],
  }) as { lines: Array<{ vatRate?: number }> }).lines[0]!;

describe('normalizeExtraction vatRate', () => {
  it('keeps a fractional rate', () => {
    expect(lineWithVat(0.18).vatRate).toBe(0.18);
  });

  it('converts a percent rate to a fraction (NUMERIC(5,4) overflow guard)', () => {
    expect(lineWithVat(18).vatRate).toBe(0.18);
  });

  it('drops an impossible rate', () => {
    expect(lineWithVat(1800).vatRate).toBeUndefined();
    expect(lineWithVat(-0.1).vatRate).toBeUndefined();
  });
});
