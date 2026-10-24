import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  buildOrderDocument,
  decimalToScaled,
  ilsFromAgorot,
  lineTotalAgorot,
  renderOrderEmailText,
  renderOrderPdf,
  renderOrderWhatsappText,
  visualRtl,
  type BuildOrderDocumentInput,
} from '..';
import { drawChunks } from '../pdf';

const base: BuildOrderDocumentInput = {
  restaurantName: 'מסעדת הדגמה',
  supplierName: 'ירקות השרון',
  poId: '1a2b3c4d-0000-4000-8000-000000000000',
  placedAt: new Date('2026-10-24T22:30:00Z'), // 25.10 01:30 in Israel
  expectedDeliveryAt: new Date('2026-10-26T05:00:00Z'),
  timezone: 'Asia/Jerusalem',
  notes: null,
  showPrices: true,
  lines: [
    { rawDescription: 'עגבניות', supplierSku: 'TOM-01', qtyOrdered: '2.500', unit: 'ק״ג', unitPriceExpected: '7.3330' },
    { rawDescription: 'מלפפונים', supplierSku: null, qtyOrdered: '3.000', unit: 'ק״ג', unitPriceExpected: '4.2000' },
    { rawDescription: 'פטרוזיליה', supplierSku: null, qtyOrdered: '1.000', unit: 'צרור', unitPriceExpected: null },
  ],
};

describe('integer-agorot money', () => {
  it('decimalToScaled is exact and half-up', () => {
    expect(decimalToScaled('12.345', 2)).toBe(1235);
    expect(decimalToScaled('12.344', 2)).toBe(1234);
    expect(decimalToScaled('0.1', 4)).toBe(1000);
    expect(decimalToScaled('-1.005', 2)).toBe(-101);
    expect(decimalToScaled(null, 2)).toBeNull();
    expect(decimalToScaled('abc', 2)).toBeNull();
  });

  it('lineTotalAgorot rounds once, half-up, with no float drift', () => {
    expect(lineTotalAgorot('2.500', '7.3330')).toBe(1833); // 18.3325
    expect(lineTotalAgorot('3', '0.1')).toBe(30); // float: 0.30000000000000004
    expect(lineTotalAgorot('1.001', '0.0050')).toBe(1); // 0.005005 → 1 agora
    expect(lineTotalAgorot('0.333', '1.5000')).toBe(50); // 0.4995 → 0.50
    expect(lineTotalAgorot('3', '')).toBeNull();
  });

  it('the order total is the sum of priced line totals', () => {
    const doc = buildOrderDocument(base);
    expect(doc.lines.map((l) => l.lineTotalAgorot)).toEqual([1833, 1260, null]);
    expect(doc.totalAgorot).toBe(3093);
    expect(doc.hasUnpricedLines).toBe(true);
    expect(doc.orderRef).toBe('1A2B3C4D');
    expect(doc.orderDate).toBe('25.10.2026');
    expect(doc.deliveryDate).toBe('26.10.2026');
  });

  it('ilsFromAgorot prints two decimals with no bidi control marks', () => {
    expect(ilsFromAgorot(3093)).toBe('30.93 ₪');
    expect(ilsFromAgorot(123456)).toBe('1,234.56 ₪');
    expect(ilsFromAgorot(3093)).not.toMatch(/[‎‏؜]/);
  });
});

describe('text renderers', () => {
  it('email text lists SKU, agreed price, line totals and the order total', () => {
    const text = renderOrderEmailText(buildOrderDocument(base));
    expect(text).toContain('• מק״ט TOM-01 · עגבניות — 2.5 ק״ג × 7.33 ₪ = 18.33 ₪');
    expect(text).toContain('• מלפפונים — 3 ק״ג × 4.20 ₪ = 12.60 ₪');
    expect(text).toContain('פטרוזיליה — 1 צרור (ללא מחיר מוסכם)');
    expect(text).toContain('סה״כ הזמנה (לפני מע״מ): 30.93 ₪');
  });

  it('whatsapp text is compact and priced', () => {
    const text = renderOrderWhatsappText(buildOrderDocument(base));
    expect(text).toContain('*הזמנה 1A2B3C4D* — מסעדת הדגמה');
    expect(text).toContain('[TOM-01] עגבניות 2.5 ק״ג × 7.33 ₪ = 18.33 ₪');
    expect(text).toContain('*סה״כ: 30.93 ₪*');
  });

  it('showPrices=false drops every price and total but keeps SKU + quantity', () => {
    const doc = buildOrderDocument({ ...base, showPrices: false });
    for (const text of [renderOrderEmailText(doc), renderOrderWhatsappText(doc)]) {
      expect(text).toContain('TOM-01');
      expect(text).toContain('2.5 ק״ג');
      expect(text).not.toContain('₪');
      expect(text).not.toContain('סה״כ');
    }
  });

  it('extensions append lines to every rendering (S11 hook)', async () => {
    const doc = buildOrderDocument({ ...base, extensions: [(d) => [`אישור: https://x.test/c/${d.orderRef}`]] });
    expect(doc.extraLines).toEqual(['אישור: https://x.test/c/1A2B3C4D']);
    expect(renderOrderEmailText(doc)).toContain('אישור: https://x.test/c/1A2B3C4D');
    expect(renderOrderWhatsappText(doc)).toContain('אישור: https://x.test/c/1A2B3C4D');
  });
});

describe('PDF', () => {
  it('visualRtl keeps numbers/Latin runs and reverses Hebrew runs', () => {
    expect(visualRtl('שלום')).toBe('םולש');
    expect(visualRtl('סה״כ: 30.93 ₪')).toBe('30.93 ₪ :כ״הס');
    expect(visualRtl('מק״ט TOM-01')).toBe('TOM-01 ט״קמ');
    expect(visualRtl('(דלת)')).toBe('(תלד)');
  });

  it('drawChunks isolates each Hebrew glyph so the layout engine cannot re-reverse it', () => {
    expect(drawChunks('30.93 ₪ :כ״הס')).toEqual(['30.93 ₪ :', 'כ', '״', 'ה', 'ס']);
  });

  it('renders a valid PDF with and without prices', async () => {
    for (const showPrices of [true, false]) {
      const bytes = await renderOrderPdf(buildOrderDocument({ ...base, showPrices, notes: 'נא להגיע עד 10:00' }));
      expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe('%PDF-');
      expect(bytes.length).toBeGreaterThan(5_000);
    }
  });

  it('long orders paginate', async () => {
    const lines = Array.from({ length: 80 }, (_, i) => ({ ...base.lines[0]!, rawDescription: `פריט ${i + 1}` }));
    const bytes = await renderOrderPdf(buildOrderDocument({ ...base, lines }));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
  });
});
