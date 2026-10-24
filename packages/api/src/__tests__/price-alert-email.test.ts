import { describe, expect, it } from 'vitest';
import { priceAlertEmail } from '../priceAlerts/email';
import { formatIlsAgorot } from '../reports/money';

/**
 * The price-alert email prints ₪ through formatIlsAgorot (the server twin of the
 * web's formatIls), never a local toLocaleString — so it reads like the in-app
 * price-alerts panel for the same alert.
 */
describe('priceAlertEmail ₪ formatting', () => {
  const email = priceAlertEmail({
    productName: 'עגבניות',
    supplierName: 'ירקות השרון',
    pctChange: 0.18,
    windowDays: 21,
    startPrice: 6.2,
    endPrice: 7.34,
    cheaperSupplierName: 'חקלאי העמק',
    cheaperPrice: 6.4,
  });
  const fmt = (agorot: number) => formatIlsAgorot(agorot, { maximumFractionDigits: 2 });

  it('start, end and cheaper prices use the shared formatter (2 decimals)', () => {
    for (const a of [620, 734, 640]) {
      expect(email.text).toContain(fmt(a));
      expect(email.html).toContain(fmt(a));
    }
    expect(fmt(620)).toMatch(/6\.20/);
  });

  it('no locally formatted, prefixed "₪6.20"', () => {
    expect(email.text).not.toMatch(/₪\s?\d/);
    expect(email.html).not.toMatch(/₪\s?\d/);
  });

  it('agorot at the boundary: a float price rounds half-up to the agora', () => {
    const e = priceAlertEmail({
      productName: 'x',
      supplierName: 'y',
      pctChange: 0.1,
      windowDays: 14,
      startPrice: 1.005,
      endPrice: 2.675,
      cheaperSupplierName: null,
      cheaperPrice: null,
    });
    expect(e.text).toContain(fmt(Math.round(1.005 * 100)));
    expect(e.text).toContain(fmt(Math.round(2.675 * 100)));
  });
});
