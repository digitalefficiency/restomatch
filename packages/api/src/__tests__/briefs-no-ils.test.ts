import { describe, expect, it } from 'vitest';
import {
  lateTruckReceiverBrief,
  orderReminderBrief,
  receiverMorningBrief,
  type BriefLocale,
  type BriefMessage,
} from '../briefs';

/**
 * AU-04 · owner: the receiver sees NO ₪ anywhere, notifications included; the chef
 * sees ₪ only on orders and recipes, and the order reminder carries none anyway.
 * Every brief a receiver or chef can get is checked here, in every locale.
 */
const ctx = { restaurantId: '11111111-1111-4111-8111-111111111111', baseUrl: 'https://app.example.test' };
const LOCALES: BriefLocale[] = ['he', 'en'];
const MONEY_KEY = /ils|agorot|amount|total|price/i;

/**
 * Visible text of the html: everything inside a tag (incl. inline CSS, whose numbers
 * are not amounts) is dropped. Test-only, never a sanitiser; the frame has no <style>.
 */
function visible(html: string): string {
  return html
    .split('<')
    .map((chunk, i) => (i === 0 ? chunk : chunk.slice(chunk.indexOf('>') + 1)))
    .join(' ');
}

function keysDeep(v: unknown, out: string[] = []): string[] {
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      keysDeep(x, out);
    }
  }
  return out;
}

function assertNoIls(m: BriefMessage, input: unknown) {
  for (const s of [m.subject, m.text, visible(m.html)]) {
    expect(s).not.toContain('₪');
    expect(s).not.toMatch(/\bILS\b|ש"ח|ש״ח/);
    expect(s).not.toMatch(/\d+[.,]\d{2}(?!\d)/);
  }
  expect(keysDeep(input).filter((k) => MONEY_KEY.test(k))).toEqual([]);
  expect(keysDeep(m).filter((k) => MONEY_KEY.test(k))).toEqual([]);
}

describe.each(LOCALES)('no ₪ for the receiver / chef (%s)', (locale) => {
  it('A3 receiver morning brief', () => {
    const input = {
      ...ctx,
      locale,
      ilDate: '2026-10-25',
      deliveries: [
        { supplierName: 'תנובה', expectedAt: new Date('2026-10-25T06:00:00Z'), lineCount: 12 },
        { supplierName: 'שטראוס', expectedAt: null, lineCount: 1 },
      ],
    };
    assertNoIls(receiverMorningBrief(input)!, input);
  });

  it('A6 receiver late-truck notice', () => {
    const input = { ...ctx, locale, poId: 'po-1', supplierName: 'תנובה', expectedAt: new Date('2026-10-24T06:00:00Z'), daysLate: 1, lineCount: 3 };
    assertNoIls(lateTruckReceiverBrief(input)!, input);
  });

  it('A5 order reminder (the chef is a recipient), draft and no-draft', () => {
    for (const draftPoId of ['po-9', null]) {
      const input = { ...ctx, locale, ilDate: '2026-10-25', supplierId: 's-1', supplierName: 'ירקות השרון', orderDayLabel: 'יום ראשון', cutoffLabel: '16:00', draftPoId };
      assertNoIls(orderReminderBrief(input), input);
    }
  });
});
