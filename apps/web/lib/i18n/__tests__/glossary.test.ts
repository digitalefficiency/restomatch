import { describe, expect, it } from 'vitest';
import { GERSHAYIM_ABBREVIATIONS, GLOSSARY, glossaryEntry } from '../glossary';
import { ALL_NAMESPACES } from '../messages';
import { lookup } from '../translate';

describe('glossary (W2-13)', () => {
  it('every concept has he, en and a one-sentence definition', () => {
    const seen = new Set<string>();
    for (const g of GLOSSARY) {
      expect(g.he.trim(), g.concept).not.toBe('');
      expect(g.en.trim(), g.concept).not.toBe('');
      expect(g.define.trim(), g.concept).not.toBe('');
      expect(g.define.split(/[.!?](\s|$)/).filter((s) => s && s.trim()).length, `${g.concept}: one sentence`).toBe(1);
      expect(seen.has(g.concept), `duplicate ${g.concept}`).toBe(false);
      seen.add(g.concept);
    }
  });

  it('a canonical term never appears in any retire list', () => {
    const canonical = GLOSSARY.flatMap((g) => g.he.split(' · '));
    for (const g of GLOSSARY) {
      for (const retired of g.retireHe) {
        expect(canonical, `${g.concept} retires canonical "${retired}"`).not.toContain(retired);
      }
    }
  });

  it('every allow[] entry points at an existing key', () => {
    const byName = new Map(ALL_NAMESPACES.map((ns) => [ns.name, ns]));
    for (const g of GLOSSARY) {
      for (const where of g.allow as readonly string[]) {
        if (where.startsWith('file:')) continue;
        const [name, key] = where.split(':');
        const ns = byName.get(name!);
        expect(ns, where).toBeDefined();
        expect(lookup(ns!.he, key!), where).toBeDefined();
      }
    }
  });

  it('owner terminology (31.10) is canonical', () => {
    expect(glossaryEntry('consolidatedInvoice').he).toBe('חשבונית מרכזת');
    expect(glossaryEntry('consolidatedInvoice').retireHe).toContain('חשבונית ריכוז');
    expect(glossaryEntry('discrepancy').he).toBe('פער');
    expect(glossaryEntry('discrepancy').retireHe).toEqual(expect.arrayContaining(['חריגה', 'הפרש']));
    expect(glossaryEntry('creditClaim').he).toBe('דרישת זיכוי');
    expect(glossaryEntry('creditClaim').retireHe).toContain('תביעה');
    expect(glossaryEntry('goodsReceipt').he).toBe('קבלת סחורה');
    expect(glossaryEntry('leak').he).toBe('דליפה');
    expect(glossaryEntry('leak').retireHe).toEqual(expect.arrayContaining(['הפסד', 'חיסכון']));
    expect(glossaryEntry('priceCreep').he).toBe('מחירים שעלו');
    expect(glossaryEntry('leakBase').he).toBe('מהרכש שנבדק');
    expect(glossaryEntry('overdueClaim').define).toContain('7 ימים');
  });

  it('abbreviations use gershayim (U+05F4), never ASCII quotes', () => {
    for (const a of GERSHAYIM_ABBREVIATIONS) {
      expect(a).toContain('״');
      expect(a).not.toContain('"');
    }
  });
});
