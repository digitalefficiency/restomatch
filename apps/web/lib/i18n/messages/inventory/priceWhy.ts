/**
 * W3-02b · IA-02 §4: the count line's price source behind one "למה?" fold
 * (only on the focused / selected line — W2-16 allows ≤1 fold per row, ≤3 per
 * screen). A sub-tree of `inventory` (`t('priceWhy.…')`). The body holds the
 * invoice, date and supplier — never ₪ (fold bodies carry no money).
 */
import type { Shape } from '../../translate';

export const priceWhyHe = {
  explain: {
    invoice: 'המחיר נלקח מחשבונית {invoice} מתאריך {date}, של הספק {supplier}.',
    noInvoice: 'המחיר נלקח מרישום מחיר מתאריך {date}, של הספק {supplier}.',
  },
  aria: { about: 'מקור המחיר: {name}' },
};

export const priceWhyEn: Shape<typeof priceWhyHe> = {
  explain: {
    invoice: 'The price comes from invoice {invoice} dated {date}, from {supplier}.',
    noInvoice: 'The price comes from a price record dated {date}, from {supplier}.',
  },
  aria: { about: 'Price source: {name}' },
};
