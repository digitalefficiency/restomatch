import { describe, expect, it } from 'vitest';
import {
  heFromLatinLayout,
  latinFromHeLayout,
  matchesHe,
  normalizeHe,
  searchVariants,
} from '../normalizeHe';

describe('normalizeHe', () => {
  it('drops niqqud and cantillation, folds finals', () => {
    expect(normalizeHe('שָׁלוֹם')).toBe('שלומ');
    expect(normalizeHe('\uFB2Aמן')).toBe('שמנ'); // שׁ presentation form
  });
  it('folds every final letter', () => {
    expect(normalizeHe('ךםןףץ')).toBe('כמנפצ');
  });
  it('drops geresh, gershayim and quotes', () => {
    const forms = ['צ׳יפס', "צ'יפס", 'צ’יפס', 'ציפס', 'צ`יפס'];
    expect(new Set(forms.map(normalizeHe)).size).toBe(1);
    expect(normalizeHe('ק״ג')).toBe(normalizeHe('ק"ג'));
    expect(normalizeHe('ק״ג')).toBe('קג');
  });
  it('collapses spacing, maqaf, dashes, NBSP and bidi marks', () => {
    expect(normalizeHe('  בית\u00A0\u00A0קפה  ')).toBe('בית קפה');
    expect(normalizeHe('בית־קפה')).toBe('בית קפה');
    expect(normalizeHe('בית-קפה')).toBe('בית קפה');
    expect(normalizeHe('\u200Fתנובה\u200E')).toBe('תנובה');
  });
  it('lower-cases Latin and keeps digits', () => {
    expect(normalizeHe('PO-1024')).toBe('po 1024');
  });
  it('is idempotent', () => {
    const s = 'צ׳יפס  שָׁלוֹם';
    expect(normalizeHe(normalizeHe(s))).toBe(normalizeHe(s));
  });
});

describe('wrong keyboard layout', () => {
  it('maps EN keys to HE letters', () => {
    expect(heFromLatinLayout('akuo')).toBe('שלום');
    expect(heFromLatinLayout('שלום')).toBeNull();
  });
  it('maps HE letters back to EN keys', () => {
    expect(latinFromHeLayout('םרגקרד')).toBe('orders');
    expect(latinFromHeLayout('orders')).toBeNull();
  });
  it('searchVariants lists the query, then its re-mapping', () => {
    expect(searchVariants('akuo')).toEqual(['akuo', 'שלומ']);
    expect(searchVariants('')).toEqual([]);
  });
  it('matchesHe finds through layout and spelling', () => {
    expect(matchesHe('שלום', 'akuo')).toBe(true);
    expect(matchesHe('צ׳יפס קפואים', 'ציפס')).toBe(true);
    expect(matchesHe('Orders', 'םרגקרד')).toBe(true);
    expect(matchesHe('תנובה', 'שטראוס')).toBe(false);
  });
});
