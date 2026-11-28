import { describe, expect, it } from 'vitest';
import { fixHref } from '../fix-href';

describe('export preview fix links (W3-05b)', () => {
  it('one invoice → that invoice; many → its queue', () => {
    expect(fixHref('notChecked', ['a'], 1)).toBe('/dashboard/invoices/a');
    expect(fixHref('notChecked', ['a', 'b'], 7)).toBe('/dashboard/invoices?view=awaiting');
    expect(fixHref('undated', ['a'], 1)).toBe('/dashboard/invoices/a');
    expect(fixHref('notInUniform', ['a', 'b'], 2)).toBe('/dashboard/invoices/a');
  });
  it('duplicates are decided in approvals', () => {
    expect(fixHref('duplicate', ['a'], 1)).toBe('/dashboard/approvals');
  });
});
