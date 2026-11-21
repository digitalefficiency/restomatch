import { describe, expect, it } from 'vitest';
import { nextUncounted, type NavLine } from '../count/nav';
import { AREAS } from '../inventory-ui';

const L = (productId: string, area: string, counted = false): NavLine => ({ productId, area, counted });

describe('Enter / Next → the next uncounted line (W2-07, mobile-field-10)', () => {
  const lines = [L('a1', 'fridge', true), L('a2', 'fridge'), L('a3', 'fridge'), L('b1', 'freezer'), L('c1', 'dry', true), L('c2', 'dry')];

  it('skips counted lines inside the area', () => {
    expect(nextUncounted(lines, 'a1', AREAS)).toBe('a2');
    expect(nextUncounted(lines, 'a2', AREAS)).toBe('a3');
  });

  it('at the end of an area, goes to the next area in walk order', () => {
    expect(nextUncounted(lines, 'a3', AREAS)).toBe('b1');
    expect(nextUncounted(lines, 'b1', AREAS)).toBe('c2');
  });

  it('wraps to the first uncounted line, and returns null when everything is counted', () => {
    expect(nextUncounted(lines, 'c2', AREAS)).toBe('a2');
    expect(nextUncounted(lines.map((l) => ({ ...l, counted: true })), 'a1', AREAS)).toBeNull();
  });

  it('orders by the walk order of the areas, not by the input order', () => {
    const shuffled = [L('d', 'dry'), L('f', 'fridge')];
    expect(nextUncounted(shuffled, null, AREAS)).toBe('f');
  });
});
