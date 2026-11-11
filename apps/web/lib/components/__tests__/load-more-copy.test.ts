import { describe, expect, it } from 'vitest';
import { components } from '@/lib/i18n/messages/components';

describe('LoadMore copy (W2-15 fix)', () => {
  it('Hebrew uses the neutral noun form, never the masculine-singular imperative', () => {
    expect(components.he.loadMore.label).toBe('טעינת עוד');
    expect(components.he.loadMore.label).not.toMatch(/^טען\b/);
  });

  it('English stays "Load more"', () => {
    expect(components.en.loadMore.label).toBe('Load more');
  });
});
