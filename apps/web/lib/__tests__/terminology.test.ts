import { describe, expect, it } from 'vitest';
import { he as approvals } from '../i18n/messages/approvals/he';
import { he as components } from '../i18n/messages/components/he';
import { he as leakProof } from '../i18n/messages/leakProof/he';
import { he as consolidated } from '../i18n/messages/consolidated/he';
import { he as accounting } from '../i18n/messages/accounting/he';
import { he as overview } from '../i18n/messages/overview/he';
import { he as recipes } from '../i18n/messages/recipes/he';
import { he as inventory } from '../i18n/messages/inventory/he';
import { he as suppliers } from '../i18n/messages/suppliers/he';

/**
 * Owner terminology (31.10): מרכזת · פער · דרישת זיכוי · קבלת סחורה, and
 * "עלות מזון רצויה" — never "יעד". Every string VALUE of these pilot-screen
 * namespaces is checked (keys may keep their old English names).
 */
const values = (o: unknown): string[] =>
  typeof o === 'string' ? [o] : o && typeof o === 'object' ? Object.values(o).flatMap(values) : [];

const NAMESPACES = { approvals, components, leakProof, consolidated, accounting, overview, recipes, inventory };
const OFF = [
  { re: /ריכוז/, use: 'מרכזת' },
  { re: /חריג(ה|ות)(?![א-ת])/, use: 'פער' },
  { re: /תביע/, use: 'דרישת זיכוי' },
  { re: /יעד/, use: 'עלות מזון רצויה' },
];

describe('pilot terminology', () => {
  for (const [ns, msgs] of Object.entries(NAMESPACES)) {
    it(`${ns}: no off-vocabulary word`, () => {
      const hits = values(msgs).flatMap((v) => OFF.filter((o) => o.re.test(v)).map((o) => `${o.re} → ${o.use}: ${v}`));
      expect(hits).toEqual([]);
    });
  }

  it('suppliers: the delivery schedule has no "שעת יעד"', () => {
    expect(values(suppliers).filter((v) => /יעד/.test(v))).toEqual([]);
  });

  it('the chef home and the food-cost alert say "עלות מזון רצויה"', () => {
    expect(overview.homeSubtitle.chef).toBe('ספירה ועלות מנות.');
    expect(recipes.alert.crossed).toContain('מעל עלות המזון הרצויה');
  });
});
