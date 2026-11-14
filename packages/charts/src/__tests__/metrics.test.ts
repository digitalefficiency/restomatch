import { describe, expect, it } from 'vitest';
import { METRICS, METRIC_IDS, metricValue } from '../metrics';
import { emptyCoverage } from '../coverage';

describe('METRICS registry [G-14]', () => {
  it('one definition per id, every field set', () => {
    expect(Object.keys(METRICS).sort()).toEqual([...METRIC_IDS].sort());
    expect(new Set(METRIC_IDS).size).toBe(METRIC_IDS.length);
    for (const id of METRIC_IDS) {
      const m = METRICS[id];
      expect(m.id).toBe(id);
      for (const k of ['window', 'basis', 'procedure', 'scope', 'drill', 'meaning'] as const) expect(m[k]).toBeTruthy();
      expect(m.procedure).toMatch(/^[a-z][A-Za-z]*\.[a-z][A-Za-z]*$/);
      expect(m.drill.startsWith('/dashboard')).toBe(true);
    }
  });

  it('names the acceptance metrics', () => {
    expect([...METRIC_IDS]).toEqual([
      'leak.month',
      'priceCreep.30d',
      'supplierLeak.90d',
      'atRisk.pending',
      'claims.claimed',
      'claims.outstanding',
      'claims.returned',
      'caught.open',
    ]);
    // Pending invoices are never leak (T4): a different basis from the leak.
    expect(METRICS['atRisk.pending'].basis).not.toBe(METRICS['leak.month'].basis);
  });

  it('metricValue returns {metric, agorot} with integer agorot only', () => {
    expect(metricValue('leak.month', 3763)).toEqual({ metric: 'leak.month', agorot: 3763 });
    expect(() => metricValue('leak.month', 37.63)).toThrow();
    expect(() => metricValue('nope' as never, 1)).toThrow();
  });

  it('coverage.ts is pre-exported for W3-09 (empty until it fills it)', () => {
    expect(emptyCoverage()).toEqual({ rows: [] });
  });
});
