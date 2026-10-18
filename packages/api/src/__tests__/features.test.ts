import { describe, expect, it } from 'vitest';
import { FEATURE_KEYS, featureEnabled } from '../lib/features';

describe('featureEnabled', () => {
  it('is off by default', () => {
    expect(featureEnabled({}, 'contracts', {})).toBe(false);
    expect(featureEnabled(null, 'contracts', {})).toBe(false);
    expect(featureEnabled({ tolerances: {} }, 'contracts', {})).toBe(false);
  });
  it('turns on one feature or all of them', () => {
    expect(featureEnabled({ features: { contracts: true } }, 'contracts', {})).toBe(true);
    expect(featureEnabled({ features: { contracts: true } }, 'recovery', {})).toBe(false);
    for (const k of FEATURE_KEYS) expect(featureEnabled({ features: { all: true } }, k, {})).toBe(true);
  });
  it('an explicit false beats all', () => {
    expect(featureEnabled({ features: { all: true, aiAssistant: false } }, 'aiAssistant', {})).toBe(false);
  });
  it('FEATURES_OFF is a global kill-switch', () => {
    const on = { features: { all: true } };
    expect(featureEnabled(on, 'contracts', { FEATURES_OFF: 'all' })).toBe(false);
    expect(featureEnabled(on, 'contracts', { FEATURES_OFF: 'aiAssistant, contracts' })).toBe(false);
    expect(featureEnabled(on, 'recovery', { FEATURES_OFF: 'aiAssistant,contracts' })).toBe(true);
  });
});
