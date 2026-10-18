import { afterEach, describe, expect, it } from 'vitest';
import {
  CLAUDE_CALLS_PER_RESTAURANT_PER_HOUR,
  __resetClaudeBudget,
  takeClaudeBudget,
} from '../receiving/english';

/** Security review (S2 pass): ensureEnglish's paid Claude leg is budgeted per restaurant. */
describe('takeClaudeBudget', () => {
  afterEach(() => __resetClaudeBudget());
  const A = '11111111-1111-4111-8111-111111111111';
  const B = '22222222-2222-4222-8222-222222222222';

  it('allows N Claude-eligible calls per restaurant per hour, then glossary-only', () => {
    const t = 1_000_000;
    for (let i = 0; i < CLAUDE_CALLS_PER_RESTAURANT_PER_HOUR; i += 1) {
      expect(takeClaudeBudget(A, t + i)).toBe(true);
    }
    expect(takeClaudeBudget(A, t + 100)).toBe(false);
    // Another tenant has its own budget.
    expect(takeClaudeBudget(B, t + 100)).toBe(true);
    // The window rolls over after an hour.
    expect(takeClaudeBudget(A, t + 60 * 60 * 1000)).toBe(true);
  });
});
