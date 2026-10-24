import { describe, expect, it } from 'vitest';
import { agorotToInput, convertsTo, shekelInputToAgorot, unitOptions } from '../recipes/recipe-ui';

describe('recipes UI helpers', () => {
  it('parses a menu price to integer agorot; a decimal comma is rejected, not ×100', () => {
    expect(shekelInputToAgorot('68')).toBe(6800);
    expect(shekelInputToAgorot('₪ 68.5')).toBe(6850);
    expect(shekelInputToAgorot('1,250.50')).toBe(125050);
    expect(shekelInputToAgorot('')).toBeNull();
    expect(shekelInputToAgorot('68,50')).toBeNaN();
    expect(shekelInputToAgorot('100001')).toBeNaN();
    for (const a of [0, 1, 99, 6800, 125050]) expect(shekelInputToAgorot(agorotToInput(a))).toBe(a);
  });

  it('offers convertible units and knows the count synonyms', () => {
    expect(unitOptions('ק״ג')).toEqual(['גרם', 'ק״ג']);
    expect(unitOptions('ליטר')).toEqual(['מ״ל', 'ליטר']);
    expect(convertsTo('גרם', 'ק"ג')).toBe(true);
    expect(convertsTo('יח׳', 'pcs')).toBe(true);
    expect(convertsTo('יח׳', 'תבנית')).toBe(false);
  });
});
