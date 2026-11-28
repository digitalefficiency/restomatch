import { describe, expect, it } from 'vitest';
import { activeFeatures, featureSource, type FeatureStateLike } from '../featureSource';

const base: FeatureStateLike = {
  stored: { contracts: true, recovery: false },
  all: false,
  defaultOn: ['orderQuestions'],
  effective: { contracts: true, recovery: false, orderQuestions: true, dockSlip: false, leakProof: false },
  killed: ['leakProof'],
};

describe('featureSource', () => {
  it('the kill-switch wins over everything', () => {
    expect(featureSource({ ...base, stored: { leakProof: true } }, 'leakProof')).toBe('killed');
  });
  it('an explicit tenant flag (on or off) comes next', () => {
    expect(featureSource(base, 'contracts')).toBe('stored');
    expect(featureSource(base, 'recovery')).toBe('stored');
  });
  it('then the demo tenant, then a default-on key, else not set', () => {
    expect(featureSource({ ...base, all: true }, 'dockSlip')).toBe('demo');
    expect(featureSource(base, 'orderQuestions')).toBe('default');
    expect(featureSource(base, 'dockSlip')).toBe('none');
  });
});

describe('activeFeatures', () => {
  it('lists only what is in effect, sorted', () => {
    expect(activeFeatures(base)).toEqual(['contracts', 'orderQuestions']);
  });
});
