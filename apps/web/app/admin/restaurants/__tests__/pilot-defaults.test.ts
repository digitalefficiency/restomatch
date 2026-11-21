import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * AU-01 · the pilot flag set lives in two places (the admin "pilot" button and
 * the pilot-setup script). They must never drift. AD1: `priceAlerts` joins
 * both only on the orchestrator's go (held for the ציקטי go-live, 7.11), and
 * `vatAtRisk` only after #219 is on main plus the receiver-null test.
 */
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

function arrayAfter(src: string, name: string): string[] {
  const m = new RegExp(`${name}[^=]*=\\s*\\[([^\\]]*)\\]`).exec(src);
  if (!m) throw new Error(`${name} not found`);
  return [...m[1]!.matchAll(/'([A-Za-z]+)'/g)].map((x) => x[1]!);
}

const panel = arrayAfter(read('../[id]/FeaturesPanel.tsx'), 'PILOT_DEFAULTS');
const script = arrayAfter(read('../../../../../../packages/db/scripts/pilot-config.ts'), 'PILOT_FEATURES');

describe('pilot defaults parity', () => {
  it('FeaturesPanel PILOT_DEFAULTS === pilot-config PILOT_FEATURES (same keys, same order)', () => {
    expect(panel.length).toBeGreaterThanOrEqual(10);
    expect(panel).toEqual(script);
  });

  it('vatAtRisk stays out until #219 is on main and a receiver gets null ₪ (AD1)', () => {
    expect(panel).not.toContain('vatAtRisk');
  });

  it('payRun / consolidatedMatch stay out until W2-03 / G-04 merge', () => {
    expect(panel).not.toContain('payRun');
    expect(panel).not.toContain('consolidatedMatch');
  });
});
