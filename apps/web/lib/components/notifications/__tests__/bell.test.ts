import { describe, expect, it } from 'vitest';
import { badgeAria, cappedCount, readSeen, taskSig, toRouteBadges, unseenCount, writeSeen } from '../model';

const words = { items: (c: string) => `${c} פריטים`, atRisk: (a: string) => `${a} בסיכון`, owed: (a: string) => `${a} זיכויים פתוחים`, blocking: 'חוסם תשלום' };
const t = (entityId: string, count = 1, ilsAgorot: number | null = 100, scope: 'mine' | 'others' = 'mine') => ({ entityId, count, ilsAgorot, scope });

describe('bell seen-state (W2-08 §5.4)', () => {
  it('counts unseen mine-tasks; a grown queue is new again; others never count', () => {
    const seen = new Set([taskSig(t('a')), taskSig(t('b', 2))]);
    expect(unseenCount([t('a'), t('b', 3), t('c'), t('o', 1, 1, 'others')], seen)).toBe(2);
  });

  it('a throwing storage reads as nothing seen and never throws on write', () => {
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); } };
    expect(readSeen(throwing).size).toBe(0);
    expect(() => writeSeen(throwing, ['x'])).not.toThrow();
    expect(readSeen(null).size).toBe(0);
    expect(readSeen({ getItem: () => '{not json', setItem: () => {} }).size).toBe(0);
  });

  it('round-trips through a working storage', () => {
    const m = new Map<string, string>();
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    writeSeen(s, ['a:1:100']);
    expect([...readSeen(s)]).toEqual(['a:1:100']);
  });
});

describe('nav badge aria and caps (W2-08 §5.3)', () => {
  it('names count, ₪ at risk and the block', () => {
    const aria = badgeAria('אישורים', { count: 4, ilsAgorot: 29_600, block: true, tone: 'danger' }, 'he', words);
    expect(aria).toMatch(/^אישורים, 4 פריטים, .*296.*₪ בסיכון, חוסם תשלום$/);
  });
  it('a count-only badge (staff) has no ₪; hidden at 0 = the bare label', () => {
    expect(badgeAria('קבלה', { count: 2, ilsAgorot: null, block: false, tone: 'neutral' }, 'he', words)).toBe('קבלה, 2 פריטים');
    expect(badgeAria('קבלה', { count: 0, ilsAgorot: null, block: false, tone: 'neutral' }, 'he', words)).toBe('קבלה');
    // Claims name their ₪ as the recovery page does ("זיכויים פתוחים"), never "בסיכון".
    const claims = badgeAria('זיכויים', { count: 3, ilsAgorot: 142_300, block: false, tone: 'neutral', money: 'owed' }, 'he', words);
    expect(claims).toContain('זיכויים פתוחים');
    expect(claims).not.toContain('בסיכון');
  });
  it('caps at 99+', () => {
    expect(cappedCount(150, 'en')).toBe('99+');
    expect(cappedCount(7, 'en')).toBe('7');
  });
  it('maps server badges onto route keys, dropping zeros', () => {
    const r = toRouteBadges(
      { approvals: { count: 4, ilsAgorot: 1, block: false, tone: 'warn' }, receiving: { count: 0, ilsAgorot: null, block: false, tone: 'neutral' } },
      { approvals: 'approvals', receiving: 'receiving', inventory: 'count' },
    );
    expect(Object.keys(r)).toEqual(['approvals']);
  });
});
