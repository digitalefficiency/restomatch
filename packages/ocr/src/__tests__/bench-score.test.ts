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
});

describe('benchmark matrix', () => {
  it('parses model:effort pairs; empty effort = model default', async () => {
    const { parseMatrix, DEFAULT_MATRIX } = await import('../bench/run');
    expect(parseMatrix('claude-opus-4-8:, claude-sonnet-5-5:low')).toEqual([
      { model: 'claude-opus-4-8' },
      { model: 'claude-sonnet-5-5', effort: 'low' },
    ]);
    expect(parseMatrix(DEFAULT_MATRIX)[0]).toEqual({ model: 'claude-opus-4-8' });
  });
});
