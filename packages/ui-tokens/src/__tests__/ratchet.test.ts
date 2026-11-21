// DS2 ratchet (DS2-SPEC §5.6). REPORT-ONLY in wave 2: a wave-2 PR that adds a
// legacy pattern is printed here, never blocked. It becomes failing in phase 5.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { countMetrics, METRICS, regressions } from '../ratchet/metrics';

const web = fileURLToPath(new URL('../../../../apps/web', import.meta.url));
const baseline = JSON.parse(readFileSync(fileURLToPath(new URL('../../ds-baseline.json', import.meta.url)), 'utf8')) as Record<string, number>;

describe('DS2 ratchet (report-only)', () => {
  it('the baseline names every metric', () => {
    expect(Object.keys(baseline).sort()).toEqual(Object.keys(METRICS).sort());
  });

  it('reports any legacy count above the baseline without failing', () => {
    const up = regressions(baseline, countMetrics(web));
    if (up.length) console.warn(`[ds-ratchet] report-only: ${up.map((r) => `${r.metric} ${r.baseline}→${r.current}`).join(', ')}`);
    expect(Array.isArray(up)).toBe(true);
  });

  it('regressions() flags only increases', () => {
    expect(regressions({ a: 2, b: 2 }, { a: 3, b: 1 })).toEqual([{ metric: 'a', baseline: 2, current: 3 }]);
  });
});
