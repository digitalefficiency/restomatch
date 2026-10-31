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

  // Owner decision (REVIEW-REPORT §8 item 4): 1.5% is never shown as a target,
  // because it reads as if the leak were the goal.
  it('labels the gap one-time and never presents 1.5% as a target, in both languages', () => {
    for (const m of [landing.he, landing.en]) {
      const note = m.v2.story.note;
      expect(note).toMatch(/חד-פעמי|one-time/);
      expect(note).not.toMatch(/יעד|target/);
      // It is the fictional product tour, never the live demo restaurant.
      expect(note).toMatch(/בדויים|fictional/);
    }
  });
});
