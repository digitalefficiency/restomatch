import { describe, expect, it } from 'vitest';
import { changedFields, normalizeReason } from '../staged';

describe('normalizeReason (mirrors the server AdminReason)', () => {
  it('trims and accepts 3–500 characters', () => {
    expect(normalizeReason('  שדרוג  ')).toBe('שדרוג');
    expect(normalizeReason('abc')).toBe('abc');
    expect(normalizeReason('x'.repeat(500))).toHaveLength(500);
  });
  it('rejects empty, whitespace, too short and too long', () => {
    expect(normalizeReason('')).toBeNull();
    expect(normalizeReason('    ')).toBeNull();
    expect(normalizeReason(' ab ')).toBeNull();
    expect(normalizeReason('x'.repeat(501))).toBeNull();
  });
});

describe('changedFields', () => {
  it('keeps only fields whose value changes', () => {
    const out = changedFields([
      { key: 'plan', label: 'תוכנית', before: 'בסיס', after: 'מקצועי' },
      { key: 'status', label: 'סטטוס', before: 'פעיל', after: 'פעיל' },
    ]);
    expect(out.map((f) => f.key)).toEqual(['plan']);
  });
});
