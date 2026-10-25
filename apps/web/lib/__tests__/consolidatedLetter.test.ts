import { describe, expect, it } from 'vitest';
import { letterAskCapped } from '../consolidatedLetter';

describe('letterAskCapped', () => {
  it('is false when the items add up to the ask (the demo: one ₪36 item, ask ₪36 + VAT)', () => {
    expect(letterAskCapped([{ deltaAmount: 36, basis: 'excl' }], { exclIls: 36, inclIls: 0 })).toBe(false);
    expect(
      letterAskCapped([{ deltaAmount: 20.1, basis: 'excl' }, { deltaAmount: 5.5, basis: 'incl' }], { exclIls: 20.1, inclIls: 5.5 }),
    ).toBe(false);
  });

  it('is true when the claim was capped at the invoice total', () => {
    // ₪60 + ₪50 of findings on a ₪100 invoice: the ask is ₪100, not ₪110.
    expect(
      letterAskCapped([{ deltaAmount: 60, basis: 'excl' }, { deltaAmount: 50, basis: 'excl' }], { exclIls: 100, inclIls: 0 }),
    ).toBe(true);
    // Capped on the incl-VAT side only.
    expect(letterAskCapped([{ deltaAmount: 10, basis: 'excl' }, { deltaAmount: 30, basis: 'incl' }], { exclIls: 10, inclIls: 20 })).toBe(true);
  });
});
