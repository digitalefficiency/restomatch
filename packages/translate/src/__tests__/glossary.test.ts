import { describe, expect, it } from 'vitest';
import { ALL_GLOSSARY_ENTRIES } from '../glossary';
import { defaultGlossary } from '../composite';
import { hasHebrew, matchKey } from '../normalize';

const g = defaultGlossary();

describe('built-in restaurant-supply glossary', () => {
  it('has 400+ entries with unique, Hebrew-only keys and no units-with-digits', () => {
    expect(ALL_GLOSSARY_ENTRIES.length).toBeGreaterThanOrEqual(400);
    const seen = new Map<string, string>();
    for (const [he, en, kind] of ALL_GLOSSARY_ENTRIES) {
      expect(hasHebrew(he), he).toBe(true);
      expect(/\d|[A-Za-z]/.test(he), he).toBe(false);
      expect(en.trim().length, he).toBeGreaterThan(0);
      expect(hasHebrew(en), `${he} → ${en}`).toBe(false);
      expect(kind === undefined || ['n', 'a', 'x'].includes(kind)).toBe(true);
      const key = matchKey(he);
      expect(seen.has(key), `duplicate key ${he} (also ${seen.get(key)})`).toBe(false);
      seen.set(key, he);
    }
  });

  // Every name in the seeded demo tenant (כפר הזיתים) + typical invoice lines.
  it.each([
    ['עגבניה שרי', 'Cherry tomatoes'],
    ['מלפפון חממה', 'Greenhouse cucumber'],
    ['חזה עוף', 'Chicken breast'],
    ['סלמון פילה טרי', 'Fresh salmon fillet'],
    ['שמן זית כתית', 'Extra virgin olive oil'],
    ['מלח ים גס', 'Coarse sea salt'],
    ['חלב 3%', 'Milk 3%'],
    ['שמנת מתוקה 38%', 'Whipping cream 38%'],
    ['דניס שלם', 'Whole sea bream'],
    ['פלפל אדום', 'Red pepper'],
    ['חסה אייסברג', 'Iceberg lettuce'],
    ['פטרוזיליה', 'Parsley'],
    ['כוסברה', 'Cilantro'],
    ['אנטריקוט אנגוס', 'Angus entrecote'],
    ['שום קלוף', 'Peeled garlic'],
    ['מפיות נייר', 'Paper napkins'],
    ['כפיות פלסטיק', 'Plastic teaspoons'],
    ['בירה גולדסטאר', 'Goldstar beer'],
  ])('%s → %s', (he, en) => {
    expect(g.translate(he)).toBe(en);
  });

  it('covers the spelling variants receivers actually see', () => {
    expect(g.translate('עגבנייה שרי')).toBe(g.translate('עגבניה שרי'));
    expect(g.translate('קוטג׳')).toBe(g.translate("קוטג'"));
    expect(g.translate('חזה עוף 2.5 ק״ג')).toBe('Chicken breast 2.5 kg');
    expect(g.translate('חזה עוף 2.5 ק"ג')).toBe('Chicken breast 2.5 kg');
  });
});
