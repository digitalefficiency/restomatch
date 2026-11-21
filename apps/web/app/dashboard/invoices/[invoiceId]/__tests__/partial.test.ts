import { describe, expect, it } from 'vitest';
import { anyFailed, settled, valueOf } from '../partial';

describe('cockpit optional ₪ reads (G-16: never swallow a failure as ₪0)', () => {
  it('a failed VAT-at-risk read is a failure, not "no VAT at risk"', async () => {
    const vat = await settled(Promise.reject(new Error('db down')));
    expect(vat).toEqual({ ok: false });
    expect(anyFailed(vat, null)).toBe(true);
    expect(valueOf(vat)).toBeNull();
  });

  it('an empty success is "nothing at risk", with no error banner', async () => {
    const vat = await settled(Promise.resolve({ rows: [] }));
    expect(anyFailed(vat)).toBe(false);
    expect(valueOf(vat)?.rows).toEqual([]);
  });

  it('a read that was not asked for (flag/role off) is neither a failure nor a value', () => {
    expect(anyFailed(null, null)).toBe(false);
    expect(valueOf(null)).toBeNull();
  });

  it('either read failing raises the banner', async () => {
    const ok = await settled(Promise.resolve({ rows: [{ vatAtRisk: '12.00' }] }));
    const bad = await settled(Promise.reject(new Error('x')));
    expect(anyFailed(ok, bad)).toBe(true);
    expect(valueOf(ok)?.rows[0]?.vatAtRisk).toBe('12.00');
  });
});
