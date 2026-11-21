import { describe, expect, it } from 'vitest';
import { createTranslator, stripIsolates } from '@/lib/i18n/translate';
import { approvals } from '@/lib/i18n/messages/approvals';
import { formatIls } from '@/lib/money';
import { countWords } from '@/lib/copy/words';
import { costOf, headParts, type CostForm } from '../desk-facts';
import {
  announceDecided,
  basisText,
  batchToastText,
  costText,
  decisionAmount,
  headPlainText,
  ilsText,
  itemName,
  nextLineText,
  qtyText,
  rowSub,
  rowTitle,
  toastText,
  unitText,
} from '../desk-text';
import type { QueueItem } from '../desk-types';

/**
 * DS3-04 spec §2.8 / §7.1 (S3): the desk's strings from facts. Every ₪ is formatIls with the viewer's locale and two
 * decimals (R3), every amount carries its basis (R7), the figure a decision names is one figure (P6, R5).
 */

const he = createTranslator('he', approvals);
const en = createTranslator('en', approvals);
/** The text a reader sees, minus the bidi marks (FSI/PDI isolates, LRM/RLM). */
const plain = (s: string) => stripIsolates(s).replace(/[‎‏]/g, '');
const ilsHe = (v: number) => formatIls(v, { locale: 'he', maximumFractionDigits: 2 });

const BASE: QueueItem = {
  id: 'r-1',
  type: 'PRICE_HIGHER',
  severity: 'warn',
  resolutionStatus: 'open',
  requiredRole: 'owner',
  deltaAmount: '104.80',
  expectedValue: '522.6000',
  actualValue: '575.0000',
  toleranceUsed: 'price: ±2% or ₪5',
  ruleName: null,
  ruleId: null,
  productName: 'בירה מהחבית',
  productNameEn: 'Draught beer',
  supplierName: 'משקאות שטיינברג',
  supplierNameEn: 'Steinberg Drinks',
  invoiceNumber: 'ST-24108',
  invoiceDueDate: null,
  invoiceStatus: 'matched',
  invoiceDate: null,
  hasScan: false,
  message: null,
  createdAt: new Date('2026-10-20T08:00:00.000Z'),
  matchRunId: 'mr-1',
  invoiceId: 'inv-1',
  invoiceLineId: 'line-1',
  lineDescription: null,
  lineDescriptionEn: null,
  qtyBilled: '2.000',
  billedUnit: 'חבית',
  unitPriceBilled: '575.0000',
  lineTotal: '1150.00',
  qtyOrdered: '2.000',
  orderedUnit: 'חבית',
  unitPriceExpected: '522.6000',
  qtyReceived: null,
  poId: 'po-1',
  poRef: null,
  poDate: null,
  claimable: true,
  claimAgorot: 10480,
  canAct: true,
  waitingOn: 'owner',
};
const row = (o: Partial<QueueItem>): QueueItem => ({ ...BASE, ...o });
/** An invoice-level gap: no product, no line. */
const invoiceLevel = (o: Partial<QueueItem>): QueueItem =>
  row({ productName: null, productNameEn: null, lineDescription: null, lineDescriptionEn: null, invoiceLineId: null, ...o });

describe('ilsText (R3): two decimals, the viewer locale', () => {
  it('he: formatIls(…, 2 dp) — 104.80, never "105"', () => {
    expect(ilsText('he', 10480)).toBe(formatIls(104.8, { locale: 'he', maximumFractionDigits: 2 }));
    expect(ilsText('he', 10480)).toContain('104.80');
    expect(ilsText('he', 10480n)).toBe(ilsText('he', 10480));
  });
  it('en: ₪ first', () => {
    expect(ilsText('en', 10480n)).toBe('₪104.80');
    expect(ilsText('en', 0)).toBe('₪0.00');
  });
});

describe('basisText (R7)', () => {
  it('the three bases, he and en', () => {
    expect(basisText(he, 'excl')).toBe('לפני מע״מ');
    expect(basisText(he, 'incl')).toBe('כולל מע״מ');
    expect(basisText(he, 'vat')).toBe('סכום המע״מ עצמו');
    expect(basisText(en, 'excl')).toBe('before VAT');
    expect(basisText(en, 'incl')).toBe('incl. VAT');
    expect(basisText(en, 'vat')).toBe('the VAT itself');
  });
});

describe('headPlainText: the queue head sentence, every clause', () => {
  it('demo: 4 gaps, 2 blocking, ₪296 → the exact Hebrew sentence', () => {
    const parts = headParts({ count: 4, blockers: 2, claimableIls: 296 });
    expect(stripIsolates(headPlainText(he, 'he', parts))).toBe(`4 פערים על ${ilsHe(296)} לפני מע״מ, 2 מהם חוסמים תשלום`);
    expect(stripIsolates(headPlainText(en, 'en', parts))).toBe('4 gaps worth ₪296.00 before VAT, 2 of them block payment');
  });
  it('empty → "אין פערים פתוחים"', () => {
    const parts = headParts({ count: 0, blockers: 0, claimableIls: 0 });
    expect(headPlainText(he, 'he', parts)).toBe('אין פערים פתוחים');
    expect(headPlainText(en, 'en', parts)).toBe('No open gaps');
  });
  it('none: no blockers clause', () => {
    const parts = headParts({ count: 3, blockers: 0, claimableIls: 45 });
    expect(stripIsolates(headPlainText(he, 'he', parts))).toBe(`3 פערים על ${ilsHe(45)} לפני מע״מ`);
    expect(stripIsolates(headPlainText(en, 'en', parts))).toBe('3 gaps worth ₪45.00 before VAT');
  });
  it('one: count 1 reads "פער אחד" (no {n}) and "והוא חוסם תשלום"', () => {
    const parts = headParts({ count: 1, blockers: 1, claimableIls: 38.7 });
    const text = stripIsolates(headPlainText(he, 'he', parts));
    expect(text).toBe(`פער אחד על ${ilsHe(38.7)} לפני מע״מ, והוא חוסם תשלום`);
    expect(text).not.toContain('{n}');
    expect(stripIsolates(headPlainText(en, 'en', parts))).toBe('1 gap worth ₪38.70 before VAT, and it blocks payment');
  });
  it('both / all', () => {
    expect(stripIsolates(headPlainText(he, 'he', headParts({ count: 2, blockers: 2, claimableIls: 271.5 })))).toBe(
      `2 פערים על ${ilsHe(271.5)} לפני מע״מ, שניהם חוסמים תשלום`,
    );
    expect(stripIsolates(headPlainText(en, 'en', headParts({ count: 2, blockers: 2, claimableIls: 271.5 })))).toBe(
      '2 gaps worth ₪271.50 before VAT, both block payment',
    );
    expect(stripIsolates(headPlainText(he, 'he', headParts({ count: 3, blockers: 3, claimableIls: 10 })))).toBe(
      `3 פערים על ${ilsHe(10)} לפני מע״מ, כולם חוסמים תשלום`,
    );
    expect(stripIsolates(headPlainText(en, 'en', headParts({ count: 3, blockers: 3, claimableIls: 10 })))).toBe(
      '3 gaps worth ₪10.00 before VAT, all of them block payment',
    );
  });
  it('some: one of them / n of them', () => {
    expect(stripIsolates(headPlainText(he, 'he', headParts({ count: 5, blockers: 1, claimableIls: 10 })))).toBe(
      `5 פערים על ${ilsHe(10)} לפני מע״מ, אחד מהם חוסם תשלום`,
    );
    expect(stripIsolates(headPlainText(en, 'en', headParts({ count: 5, blockers: 3, claimableIls: 10 })))).toBe(
      '5 gaps worth ₪10.00 before VAT, 3 of them block payment',
    );
  });
  it('₪0: "בלי סכום לבקשת זיכוי"', () => {
    const parts = headParts({ count: 2, blockers: 1, claimableIls: 0 });
    expect(stripIsolates(headPlainText(he, 'he', parts))).toBe('2 פערים בלי סכום לבקשת זיכוי, אחד מהם חוסם תשלום');
    expect(stripIsolates(headPlainText(en, 'en', parts))).toBe('2 gaps with nothing to request, 1 of them blocks payment');
  });
});

describe('costText: the reasons row cost line, every form', () => {
  const SUPPLIER_3 = 'ירקות השרון הטובים';
  const COST: Record<CostForm, ReturnType<typeof costOf>> = {
    priceOrder: { form: 'priceOrder', amountAgorot: 10480n },
    priceContract: { form: 'priceContract', amountAgorot: 15000n },
    priceP90: { form: 'priceP90', amountAgorot: 10000n },
    qtyNotReceived: { form: 'qtyNotReceived', amountAgorot: 3870n, qty4: 30000n, unit: 'ק״ג' },
    qtyOverOrder: { form: 'qtyOverOrder', amountAgorot: 2000n, qty4: 20000n, unit: 'ק״ג' },
    qtyShort: { form: 'qtyShort', amountAgorot: 1200n, qty4: 10000n, unit: 'יח׳' },
    unordered: { form: 'unordered', amountAgorot: 9800n },
    duplicate: { form: 'duplicate', amountAgorot: 118000n },
    vat: { form: 'vat', amountAgorot: 170n },
    vatBelow: { form: 'vatBelow', amountAgorot: 170n },
    total: { form: 'total', amountAgorot: 500n },
    totalBelow: { form: 'totalBelow', amountAgorot: 500n },
    other: { form: 'other', amountAgorot: 1000n },
  };
  const FORMS = Object.keys(COST) as CostForm[];
  const NO_SUPPLIER = new Set<CostForm>(['vatBelow', 'totalBelow']);

  it('he and en: the amount at 2 dp in the locale, no placeholder left, the supplier named', () => {
    for (const form of FORMS) {
      const cost = COST[form];
      const h = costText(he, 'he', cost, SUPPLIER_3);
      const e = costText(en, 'en', cost, 'Sharon Fresh Farms');
      expect(h, form).toContain(ilsText('he', cost.amountAgorot));
      expect(e, form).toContain(ilsText('en', cost.amountAgorot));
      expect(h, form).not.toMatch(/[{}]/);
      expect(e, form).not.toMatch(/[{}]/);
      if (!NO_SUPPLIER.has(form)) {
        expect(h, form).toContain(`ל${SUPPLIER_3}`);
        expect(e, form).toContain('Sharon Fresh Farms');
      }
    }
  });
  it('the basis sits beside the amount (R7): before VAT, incl. VAT, of VAT', () => {
    expect(costText(he, 'he', COST.priceOrder, 'ספק א')).toContain('לפני מע״מ מעל המחיר שבהזמנה');
    expect(costText(he, 'he', COST.duplicate, 'ספק א')).toContain('כולל מע״מ על העותק');
    expect(costText(he, 'he', COST.vat, 'ספק א')).toContain('של מע״מ מעל השיעור');
    expect(costText(en, 'en', COST.qtyNotReceived, 'Acme')).toContain('before VAT for 3 kg that did not arrive');
  });
  it('the demo 5b line, exactly', () => {
    expect(plain(costText(he, 'he', COST.qtyNotReceived, 'ירקות השרון'))).toBe(
      `תשלמו לירקות השרון ${plain(ilsHe(38.7))} לפני מע״מ על 3 ק״ג שלא התקבלו.`,
    );
  });
  it('a lower printed figure is never "מעל" (R4)', () => {
    const below = costText(he, 'he', COST.vatBelow, 'ספק א');
    expect(below).toContain('נמוך מהשיעור');
    expect(below).not.toContain('מעל');
    const total = costText(he, 'he', COST.totalBelow, 'ספק א');
    expect(total).toContain('נמוך מסכום השורות');
    expect(total).not.toContain('מעל');
  });
  it('no supplier → the fallback ("ספק" / "the supplier")', () => {
    expect(plain(costText(he, 'he', COST.priceOrder, null))).toBe(`תשלמו לספק ${plain(ilsHe(104.8))} לפני מע״מ מעל המחיר שבהזמנה.`);
    expect(costText(en, 'en', COST.priceOrder, '  ')).toBe('You will pay the supplier ₪104.80 before VAT above the order price.');
  });
  it('he: ≤ 12 rendered words per form with a three-word supplier', () => {
    for (const form of FORMS) {
      const words = countWords(plain(costText(he, 'he', COST[form], SUPPLIER_3)));
      expect(words, form).toBeLessThanOrEqual(12);
    }
  });
});

describe('nextLineText: what comes after this decision', () => {
  it('desk: 4/3/2/1 open gaps', () => {
    expect(plain(nextLineText(he, 4, 'desk'))).toBe('אחרי ההחלטה עוברים לבא בתור, נשארו עוד 3');
    expect(plain(nextLineText(he, 3, 'desk'))).toBe('אחרי ההחלטה עוברים לבא בתור, נשארו עוד 2');
    expect(plain(nextLineText(he, 2, 'desk'))).toBe('אחרי ההחלטה עוברים לבא בתור, נשאר עוד פער אחד');
    expect(plain(nextLineText(he, 1, 'desk'))).toBe('זה הפער האחרון');
    expect(plain(nextLineText(he, 0, 'desk'))).toBe('זה הפער האחרון');
    expect(nextLineText(en, 4, 'desk')).toBe('After you decide, the next gap comes up, 3 left');
  });
  it('landing: the gaps left on this invoice', () => {
    expect(plain(nextLineText(he, 3, 'single'))).toBe('אחרי ההחלטה נשארו עוד 2 פערים בחשבונית');
    expect(plain(nextLineText(he, 2, 'single'))).toBe('אחרי ההחלטה נשאר עוד פער אחד בחשבונית');
    expect(plain(nextLineText(he, 1, 'single'))).toBe('זה הפער האחרון בחשבונית');
    expect(nextLineText(en, 1, 'single')).toBe('This is the last gap on this invoice');
  });
});

describe('decisionAmount (P6, R5): the figure the button, the toast and the announcer name', () => {
  it('claim → claimAgorot with the row basis; delta → |Δ|', () => {
    const capped = row({ claimAgorot: 11800, deltaAmount: '150.00' });
    expect(decisionAmount(capped, 'claim')).toEqual({ agorot: 11800n, basis: 'excl' });
    expect(decisionAmount(capped, 'delta')).toEqual({ agorot: 15000n, basis: 'excl' });
    expect(decisionAmount(row({ deltaAmount: '-104.80' }), 'delta')).toEqual({ agorot: 10480n, basis: 'excl' });
    expect(decisionAmount(invoiceLevel({ type: 'DUPLICATE_INVOICE', deltaAmount: '1180.00' }), 'delta')).toEqual({
      agorot: 118000n,
      basis: 'incl',
    });
    expect(decisionAmount(invoiceLevel({ type: 'VAT_MISMATCH', claimAgorot: 170, deltaAmount: '1.70' }), 'claim')).toEqual({
      agorot: 170n,
      basis: 'vat',
    });
  });
  it('null for a ₪0 claim and for Δ 0', () => {
    expect(decisionAmount(row({ claimAgorot: 0 }), 'claim')).toBeNull();
    expect(decisionAmount(row({ deltaAmount: '0.00' }), 'delta')).toBeNull();
    expect(decisionAmount(row({ deltaAmount: null }), 'delta')).toBeNull();
  });
});

describe('toastText / batchToastText', () => {
  it('with an amount: "{verb} · {amount} {basis}", ≤ 8 words', () => {
    const text = toastText(he, 'he', he('decision.approved'), { agorot: 3870n, basis: 'excl' });
    expect(plain(text)).toBe(`נוסף לבקשת הזיכוי · ${plain(ilsHe(38.7))} לפני מע״מ`);
    expect(countWords(plain(text))).toBeLessThanOrEqual(8);
    const held = toastText(he, 'he', he('decision.duplicateHeld'), { agorot: 118000n, basis: 'incl' });
    expect(plain(held)).toBe(`העותק מוחזק · לא ישולם · ${plain(ilsHe(1180))} כולל מע״מ`);
    expect(countWords(plain(held))).toBeLessThanOrEqual(8);
    expect(toastText(en, 'en', en('decision.approved'), { agorot: 3870n, basis: 'excl' })).toBe(
      `${en('decision.approved')} · ₪38.70 before VAT`,
    );
  });
  it('null → the verb alone (a ₪0 claim prints no amount, R5)', () => {
    expect(toastText(he, 'he', he('decision.approved'), null)).toBe('נוסף לבקשת הזיכוי');
  });
  it('bulk: the count as a plural and the Σ before VAT', () => {
    expect(plain(batchToastText(he, 'he', 2, 4500))).toBe(`אושרו 2 פערים · ${plain(ilsHe(45))} לפני מע״מ`);
    expect(plain(batchToastText(he, 'he', 1, 3000))).toBe(`אושר פער אחד · ${plain(ilsHe(30))} לפני מע״מ`);
    expect(batchToastText(en, 'en', 2, 4500)).toBe('2 gaps approved · ₪45.00 before VAT');
  });
});

describe('announceDecided (§5.12)', () => {
  const next = row({ id: 'r-2', type: 'QTY_OVER', productName: 'עגבניות שרי', productNameEn: 'Cherry tomatoes' });
  it('with a next gap: the count as an ICU plural, then "הבא:" (P8)', () => {
    const one = announceDecided(he, 'he', he('decision.approved'), BASE, { agorot: 10480n, basis: 'excl' }, next, 1, false);
    expect(plain(one)).toContain('נוסף לבקשת הזיכוי · בירה מהחבית · 104.80');
    expect(one).toContain('לפני מע״מ');
    expect(one).toContain('נותר פער אחד');
    expect(one).toContain('הבא: חיוב על יותר ממה שהתקבל, עגבניות שרי');
    const three = announceDecided(he, 'he', he('decision.approved'), BASE, { agorot: 10480n, basis: 'excl' }, next, 3, false);
    expect(three).toContain('נותרו 3 פערים');
  });
  it('the last gap: "אין עוד פערים"', () => {
    const last = announceDecided(he, 'he', he('decision.rejected'), BASE, { agorot: 10480n, basis: 'excl' }, null, 0, false);
    expect(plain(last)).toBe(`שולם כפי שחויב · בירה מהחבית · ${plain(ilsHe(104.8))} לפני מע״מ. אין עוד פערים`);
  });
  it('the undo key follows only while single keys are on (R15)', () => {
    const on = announceDecided(he, 'he', he('decision.approved'), BASE, null, next, 2, true);
    expect(on.endsWith(' לביטול ההחלטה: Z')).toBe(true);
    const off = announceDecided(he, 'he', he('decision.approved'), BASE, null, next, 2, false);
    expect(off).not.toContain('Z');
  });
  it('a claim of 10480 agorot is "104.80" (he, never "105") and "₪104.80" (en), with its basis (R3, R7d)', () => {
    const amount = decisionAmount(BASE, 'claim');
    const h = plain(announceDecided(he, 'he', he('decision.approved'), BASE, amount, next, 3, false));
    expect(h).toContain('104.80');
    expect(h).not.toMatch(/\b105\b/);
    expect(h).toContain('לפני מע״מ');
    const e = announceDecided(en, 'en', en('decision.approved'), BASE, amount, next, 3, false);
    expect(e).toContain('₪104.80 before VAT');
    expect(e).toContain('Draught beer');
    expect(e).toContain('3 gaps left');
  });
  it('no amount (a ₪0 claim): the title alone', () => {
    const text = announceDecided(he, 'he', he('decision.approved'), BASE, null, null, 0, false);
    expect(text).toBe('נוסף לבקשת הזיכוי · בירה מהחבית. אין עוד פערים');
  });
});

describe('row names and sub-lines', () => {
  it('itemName: the product, else the line text; English when it exists', () => {
    expect(itemName('he', BASE)).toBe('בירה מהחבית');
    expect(itemName('en', BASE)).toBe('Draught beer');
    expect(itemName('he', row({ productName: null, lineDescription: 'שורה חופשית' }))).toBe('שורה חופשית');
    expect(itemName('he', invoiceLevel({}))).toBe('');
  });
  it('rowTitle: the item, else the type label', () => {
    expect(rowTitle(he, 'he', BASE)).toBe('בירה מהחבית');
    expect(rowTitle(he, 'he', invoiceLevel({ type: 'TOTAL_MISMATCH' }))).toBe('סה״כ לא תואם לשורות');
  });
  it('rowSub: item → "{supplier}, {type}"; invoice-level by basis, incl and vat START with their basis (R7a)', () => {
    expect(rowSub(he, 'he', BASE)).toBe('משקאות שטיינברג, מחיר גבוה מהמצופה');
    expect(stripIsolates(rowSub(he, 'he', invoiceLevel({ type: 'TOTAL_MISMATCH' })))).toBe('משקאות שטיינברג, חשבונית ST-24108');
    const incl = stripIsolates(rowSub(he, 'he', invoiceLevel({ type: 'DUPLICATE_INVOICE' })));
    expect(incl.startsWith('כולל מע״מ, ')).toBe(true);
    expect(incl).toBe('כולל מע״מ, משקאות שטיינברג, חשבונית ST-24108');
    const vat = stripIsolates(rowSub(he, 'he', invoiceLevel({ type: 'VAT_MISMATCH' })));
    expect(vat.startsWith('המע״מ עצמו, ')).toBe(true);
    expect(stripIsolates(rowSub(en, 'en', invoiceLevel({ type: 'VAT_MISMATCH' })))).toBe(
      'The VAT itself, Steinberg Drinks, invoice ST-24108',
    );
  });
  it('rowSub: no supplier → the fallback', () => {
    expect(rowSub(he, 'he', row({ supplierName: null, supplierNameEn: null }))).toBe('ספק, מחיר גבוה מהמצופה');
  });
});

describe('units and quantities', () => {
  it('unitText: he as written, en translated when known', () => {
    expect(unitText('he', 'ק״ג')).toBe('ק״ג');
    expect(unitText('en', 'ק״ג')).toBe('kg');
    expect(unitText('en', 'יחידה מוזרה')).toBe('יחידה מוזרה');
    expect(unitText('he', null)).toBe('');
  });
  it('qtyText: up to 3 decimals and the unit; no trailing space without one', () => {
    expect(qtyText('he', 30000n, 'ק״ג')).toBe('3 ק״ג');
    expect(qtyText('he', 95000n, 'ק״ג')).toBe('9.5 ק״ג');
    expect(qtyText('en', 12340n, 'ק״ג')).toBe('1.234 kg');
    expect(qtyText('he', 20000n, null)).toBe('2');
  });
});
