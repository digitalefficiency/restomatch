import { describe, expect, it } from 'vitest';
import { landingFlag } from '../landingFlags';

describe('landingFlag', () => {
  it('is off unless LANDING_FLAGS lists it', () => {
    expect(landingFlag('landingOrdersStory', {})).toBe(false);
    expect(landingFlag('landingOrdersStory', { LANDING_FLAGS: '' })).toBe(false);
    expect(landingFlag('landingOrdersStory', { LANDING_FLAGS: 'somethingElse' })).toBe(false);
    expect(landingFlag('landingOrdersStory', { LANDING_FLAGS: 'landingOrdersStory' })).toBe(true);
    expect(landingFlag('landingOrdersStory', { LANDING_FLAGS: ' x , landingOrdersStory ' })).toBe(
      true,
    );
  });

  it('FEATURES_OFF wins', () => {
    const on = { LANDING_FLAGS: 'landingOrdersStory' };
    expect(landingFlag('landingOrdersStory', { ...on, FEATURES_OFF: 'all' })).toBe(false);
    expect(
      landingFlag('landingOrdersStory', { ...on, FEATURES_OFF: 'contracts,landingOrdersStory' }),
    ).toBe(false);
    expect(landingFlag('landingOrdersStory', { ...on, FEATURES_OFF: 'contracts' })).toBe(true);
  });
});
