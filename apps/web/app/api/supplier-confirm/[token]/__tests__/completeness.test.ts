import { describe, expect, it } from 'vitest';
import { incompleteAnswer } from '../completeness';

describe('supplier answer completeness', () => {
  const order = ['a', 'b'];
  it('accepts an answer that gives every line an explicit quantity (0 = out of stock)', () => {
    expect(incompleteAnswer(order, [{ poLineId: 'a', qtyAvailable: 4 }, { poLineId: 'b', qtyAvailable: 0 }])).toBeNull();
  });
  it('a missing line or a line without a quantity is incomplete — never "as ordered" by omission', () => {
    expect(incompleteAnswer(order, [{ poLineId: 'a', qtyAvailable: 4 }])).toBe('incomplete_lines');
    expect(incompleteAnswer(order, [{ poLineId: 'a', qtyAvailable: 4 }, { poLineId: 'b', qtyAvailable: null }])).toBe('incomplete_lines');
    expect(incompleteAnswer(order, [{ poLineId: 'a', qtyAvailable: 4 }, { poLineId: 'b' }])).toBe('incomplete_lines');
  });
  it('a foreign or duplicated line is invalid', () => {
    expect(incompleteAnswer(order, [{ poLineId: 'x', qtyAvailable: 1 }, { poLineId: 'b', qtyAvailable: 1 }])).toBe('invalid_lines');
    expect(incompleteAnswer(order, [{ poLineId: 'a', qtyAvailable: 1 }, { poLineId: 'a', qtyAvailable: 1 }])).toBe('invalid_lines');
  });
});
