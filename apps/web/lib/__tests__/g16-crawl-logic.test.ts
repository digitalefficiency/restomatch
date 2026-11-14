/** G-16 slice b: the crawl's pure checks (e2e/invariants/logic.ts). */
import { describe, expect, it } from 'vitest';
import { formatIls } from '@/lib/money';
import { drillMismatch, readsAsZero, shekelPlacement, totalMismatch, zeroViolation } from '../../e2e/invariants/logic';

describe('totals match rows (to the agora)', () => {
  it('passes an exact sum and a capped total; fails a drift of one agora', () => {
    expect(totalMismatch({ group: 'g', totalAgorot: 30, rowAgorot: [10, 20] })).toBeNull();
    expect(totalMismatch({ group: 'g', totalAgorot: 25, rowAgorot: [10, 20], capAgorot: 25 })).toBeNull();
    expect(totalMismatch({ group: 'g', totalAgorot: 31, rowAgorot: [10, 20] })).toMatch(/≠ Σ rows 30/);
    expect(totalMismatch({ group: 'g', totalAgorot: 30.5, rowAgorot: [10, 20] })).toMatch(/non-integer/);
  });
});

describe('drill parity', () => {
  it('needs the list total and an exact match', () => {
    expect(drillMismatch({ href: '/x', agorot: 500 }, 500)).toBeNull();
    expect(drillMismatch({ href: '/x', agorot: 500 }, 499)).toMatch(/≠ list 499/);
    expect(drillMismatch({ href: '/x', agorot: 500 }, null)).toMatch(/no \[data-drill-total\]/);
  });
});

describe('₪ left of the first digit', () => {
  it('passes when the glyph box ends before the digit box, fails otherwise', () => {
    expect(shekelPlacement({ text: '₪1,234', shekel: { left: 0, right: 8 }, firstDigit: { left: 9, right: 15 } })).toBeNull();
    expect(shekelPlacement({ text: '1,234 ₪', shekel: { left: 40, right: 48 }, firstDigit: { left: 0, right: 6 } })).toMatch(/right of/);
    expect(shekelPlacement({ text: 'אין', shekel: null, firstDigit: null })).toBeNull();
  });
});

describe('no ₪0 for unknown, no red ₪0', () => {
  it('reads the app formatter’s zero as zero, and a real amount as not', () => {
    expect(readsAsZero(formatIls(0))).toBe(true);
    expect(readsAsZero(formatIls(0, { locale: 'en' }))).toBe(true);
    expect(readsAsZero('₪0.00')).toBe(true);
    expect(readsAsZero(formatIls(10))).toBe(false);
    expect(readsAsZero(formatIls(1050))).toBe(false);
    expect(readsAsZero('0 פריטים')).toBe(false);
  });
  it('flags ₪0 on unmeasured / unavailable and red ₪0; allows a calm measured zero', () => {
    const zero = formatIls(0);
    expect(zeroViolation({ text: zero, state: 'unmeasured', color: 'rgb(20, 20, 20)' })).toMatch(/unmeasured/);
    expect(zeroViolation({ text: zero, state: 'unavailable', color: 'rgb(20, 20, 20)' })).toMatch(/unavailable/);
    expect(zeroViolation({ text: zero, state: 'zero', color: 'rgb(200, 30, 30)' })).toMatch(/red/);
    expect(zeroViolation({ text: zero, state: 'zero', color: 'rgb(30, 120, 60)' })).toBeNull();
    expect(zeroViolation({ text: formatIls(95), state: 'value', color: 'rgb(200, 30, 30)' })).toBeNull();
  });
});
