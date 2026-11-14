import { beforeAll, describe, expect, it } from 'vitest';
import { receivedBetween } from '../inventory/data';
import { TZ, db, freshLab, product, receipt, ymdAgo, type Lab } from './inventory-w207-helpers';

/**
 * W2-07 · deep-fix class 1 (interim until G-04's receiptTruth is on this base):
 * "received" reads closed receipts only and is qty_received as is — it is
 * already net of rejections, so qty_rejected is never subtracted a second time.
 */
let A: Lab;
let milk: string;

beforeAll(async () => {
  [A] = (await freshLab(['TA'])) as [Lab];
  milk = await product(A!.t, 'חלב 3%', 'ליטר', 'מוצרי חלב');
  await receipt(A!.t, milk, 'ליטר', 5, '8', '2', 'completed'); // 10 delivered, 2 rejected → 8 accepted
  await receipt(A!.t, milk, 'ליטר', 4, '3', null, 'partial');
  await receipt(A!.t, milk, 'ליטר', 3, '5', null, 'pending'); // half-counted: adds nothing yet
});

describe('receivedBetween', () => {
  it('received 8 + rejected 2 → 8 (not 6); a pending receipt is excluded', async () => {
    const r = await receivedBetween(db, A.t.restaurantId, TZ, ymdAgo(10), ymdAgo(0), [milk]);
    const total = (r.get(milk) ?? []).reduce((a, x) => a + Number(x.qty), 0);
    expect(total).toBe(11);
  });
});
