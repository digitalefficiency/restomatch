import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normText, scoreExtraction, type TruthInvoice } from '../bench/score';

const truth = JSON.parse(
  readFileSync(new URL('../../bench/invoice-1.truth.json', import.meta.url), 'utf8'),
) as TruthInvoice;

describe('OCR benchmark scoring', () => {
  it('a perfect extraction scores 1.0 and money-exact (quote variants tolerated)', () => {
    const got = structuredClone(truth) as unknown as Record<string, unknown>;
    (got.supplier as { name: string }).name = 'ירקות השרון בע״מ'; // gershayim instead of "
    const r = scoreExtraction(truth, got);
    expect(r.failures).toEqual([]);
    expect(r.accuracy).toBe(1);
    expect(r.moneyExact).toBe(true);
  });

  it('one wrong agora on a line breaks moneyExact and is named', () => {
    const got = structuredClone(truth);
    got.lines[2]!.lineTotal = 63.01;
    const r = scoreExtraction(truth, got);
    expect(r.moneyExact).toBe(false);
    expect(r.failures).toEqual(['line 2210.lineTotal']);
  });

  it('a missing line counts every field of it as failed', () => {
    const got = structuredClone(truth);
    got.lines = got.lines.filter((l) => l.sku !== '5031');
    const r = scoreExtraction(truth, got);
    expect(r.missingLines).toEqual(['5031']);
    expect(r.moneyExact).toBe(false);
    expect(r.failures).toContain('lines.count');
  });

  it('the fixture truth is internally consistent (lines × price, 18% VAT)', () => {
    for (const l of truth.lines) expect(Math.round(l.qty * l.unitPrice * 100)).toBe(Math.round(l.lineTotal * 100));
    const sub = truth.lines.reduce((s, l) => s + l.lineTotal, 0);
    expect(Math.round(sub * 100)).toBe(Math.round(truth.totals.subtotal * 100));
    expect(Math.round(truth.totals.subtotal * 18)).toBe(Math.round(truth.totals.vat * 100));
    expect(normText(' בע"מ ')).toBe('בעמ');
  });

  it('the fixture passes the production gate (valid ח״פ, 9-digit allocation number)', async () => {
    const { checkInvoice, isValidIsraeliBusinessId } = await import('../checks');
    expect(isValidIsraeliBusinessId(truth.supplier.businessId)).toBe(true);
    expect(truth.allocationNumber).toMatch(/^\d{9}$/);
    expect(checkInvoice(truth)).toMatchObject({ passed: true, reasons: [] });
  });
});

describe('benchmark matrix', () => {
  it('parses model:effort pairs; empty effort = model default', async () => {
    const { parseMatrix, DEFAULT_MATRIX } = await import('../bench/run');
    expect(parseMatrix('claude-opus-4-8:, claude-sonnet-5-5:low')).toEqual([
      { model: 'claude-opus-4-8' },
      { model: 'claude-sonnet-5-5', effort: 'low' },
    ]);
    expect(parseMatrix(DEFAULT_MATRIX)).toEqual([
      { model: 'claude-opus-5-5', effort: 'low' },
      { model: 'claude-opus-5-5', effort: 'medium' },
      { model: 'claude-sonnet-5-5', effort: 'low' },
    ]);
  });

  it('p95 is nearest-rank; cost uses the list prices', async () => {
    const { percentile, costUsd } = await import('../bench/run');
    const xs = [12, 30, 18, 22, 41, 19, 25, 27, 33, 20];
    expect(percentile(xs, 50)).toBe(22);
    expect(percentile(xs, 95)).toBe(41);
    expect(percentile([], 95)).toBeNaN();
    expect(costUsd('claude-opus-5-5', { inputTokens: 5000, outputTokens: 3000 })).toBeCloseTo(0.08, 6);
    expect(costUsd('claude-sonnet-5-5', { inputTokens: 5000, outputTokens: 3000 })).toBeCloseTo(0.04, 6);
  });

  it('refuses a BENCH_DIR inside the repository (real supplier documents stay out of git)', async () => {
    const { isInside } = await import('../bench/run');
    const repo = new URL('../../../../', import.meta.url).pathname;
    expect(isInside(new URL('../../bench', import.meta.url).pathname, repo)).toBe(true);
    expect(isInside('/tmp/restomatch-bench-docs', repo)).toBe(false);
  });

  it('the truth template parses as a TruthInvoice', () => {
    const t = JSON.parse(readFileSync(new URL('../../bench/truth.template.json', import.meta.url), 'utf8')) as TruthInvoice;
    expect(t.lines).toHaveLength(1);
    expect(Object.keys(t.totals)).toEqual(['subtotal', 'vat', 'total']);
  });
});
