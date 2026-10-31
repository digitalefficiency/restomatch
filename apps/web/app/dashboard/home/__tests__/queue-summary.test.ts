import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';
import { decideSummary, type QueueItemLike } from '../queue-summary';

const item = (i: number, over: Partial<QueueItemLike> = {}): QueueItemLike => ({
  id: `d${i}`,
  type: 'PRICE_HIGHER',
  severity: 'warn',
  deltaAmount: '1.10',
  createdAt: new Date(Date.UTC(2026, 9, 1) + i * 60_000),
  ...over,
});

/** A myQueue stand-in: newest first, `limit`, strictly-older `cursor` — like the router. */
function pagedQueue(all: QueueItemLike[]) {
  const sorted = [...all].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return async ({ limit, cursor }: { limit: number; cursor?: string }) =>
    sorted.filter((d) => !cursor || d.createdAt.getTime() < Date.parse(cursor)).slice(0, limit);
}
const noSummary = async () => {
  throw new TRPCError({ code: 'NOT_FOUND', message: 'No procedure found on path "approvals.queueSummary"' });
};

describe('decideSummary — the whole queue, never one page', () => {
  it('250 items: count and Σ₪ cover all of them (not the first 100)', async () => {
    const all = Array.from({ length: 250 }, (_, i) => item(i, i < 3 ? { severity: 'block' } : {}));
    const s = await decideSummary({ queueSummary: noSummary, myQueue: pagedQueue(all) });
    expect(s).toEqual({ count: 250, atRiskIls: 275, blocking: 3 });
  });

  it('ties on createdAt across a page boundary are neither skipped nor double-counted', async () => {
    const same = new Date(Date.UTC(2026, 9, 2));
    const all = Array.from({ length: 130 }, (_, i) => item(i, { createdAt: i >= 90 ? same : item(i).createdAt }));
    const s = await decideSummary({ queueSummary: noSummary, myQueue: pagedQueue(all) });
    expect(s.count).toBe(130);
  });

  it('PRICE_LOWER is never ₪ at risk (same rule as the approvals strip)', async () => {
    const s = await decideSummary({
      queueSummary: noSummary,
      myQueue: pagedQueue([item(1, { deltaAmount: '-5', type: 'PRICE_LOWER' }), item(2, { deltaAmount: '-2.5' })]),
    });
    expect(s).toEqual({ count: 2, atRiskIls: 2.5, blocking: 0 });
  });

  it('when the server has approvals.queueSummary, its totals win (the landing shows the same ₪)', async () => {
    const s = await decideSummary({
      queueSummary: async () => ({ count: 57, blockers: 1, claimableIls: 150 }),
      myQueue: async () => {
        throw new Error('must not page when the server aggregates');
      },
    });
    expect(s).toEqual({ count: 57, atRiskIls: 150, blocking: 1 });
  });

  it('a real failure is not swallowed (the card shows "לא נטען", never a missing row)', async () => {
    await expect(
      decideSummary({
        queueSummary: noSummary,
        myQueue: async () => {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'db down' });
        },
      }),
    ).rejects.toThrow('db down');
    await expect(
      decideSummary({
        queueSummary: async () => {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'db down' });
        },
        myQueue: pagedQueue([]),
      }),
    ).rejects.toThrow('db down');
  });
});
