import { describe, expect, it } from 'vitest';
import { invoiceAudits } from '@/app/showcase/dashboard/invoices/_mock';
import { landing } from '@/lib/i18n/messages/landing';
import { ORDERS_STORY_EXAMPLE, ordersStoryGapIls } from '../OrdersStory';

/** The landing's worked example must be the line the client finds in the demo. */
describe('landing orders story', () => {
  it('quotes the showcase INV-7821 cherry-tomato line', () => {
    const inv = invoiceAudits().find(
      (r) => r.invoiceNumber === ORDERS_STORY_EXAMPLE.invoiceNumber,
    )!;
    expect(inv.poNumber).toBe(ORDERS_STORY_EXAMPLE.poNumber);
    expect(inv.supplierName).toBe(ORDERS_STORY_EXAMPLE.supplierName);
    const line = inv.lines.find((l) => l.status === 'price_higher')!;
    expect([line.poQty, line.invoiceQty, line.poUnitPrice, line.invoiceUnitPrice]).toEqual([
      ORDERS_STORY_EXAMPLE.qtyKg,
      ORDERS_STORY_EXAMPLE.qtyKg,
      ORDERS_STORY_EXAMPLE.agreedIls,
      ORDERS_STORY_EXAMPLE.billedIls,
    ]);
    expect(ordersStoryGapIls()).toBe(line.variance);
    expect(ordersStoryGapIls()).toBe(30);
  });

  it('labels the gap one-time and the 1.5% as a target, in both languages', () => {
    for (const m of [landing.he, landing.en]) {
      const note = m.v2.story.note;
      expect(note).toMatch(/1\.5%/);
      expect(note).toMatch(/חד-פעמי|one-time/);
      expect(note).toMatch(/יעד|target/);
    }
  });
});
