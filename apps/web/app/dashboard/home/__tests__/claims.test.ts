import { describe, expect, it } from 'vitest';
import { followUps } from '../../recovery/logic';
import { claimNeedRows } from '../claims';

/**
 * "דרישות זיכוי" on the home = the recovery page's two follow-up queues, same rule
 * (followUps), same figures, same wording — never the server's "overdue" count,
 * which also calls answered (acknowledged) claims late.
 */
const NOW = '2026-10-25T08:00:00.000Z';
const daysAgo = (d: number) => new Date(Date.parse(NOW) - d * 86_400_000).toISOString();
const claim = (over: Partial<Parameters<typeof followUps>[0][number]>) => ({
  status: 'letter_sent' as const,
  outstandingAgorot: 10_000,
  letterSentAt: daysAgo(20),
  claimedAt: daysAgo(25),
  supplierName: 'ספק א',
  ...over,
});

const fmt = { t: (k: string, v?: Record<string, string | number>) => `${k}|${JSON.stringify(v ?? {})}`, money: (a: number) => `₪${(a / 100).toFixed(2)}`, n: String };

describe('claimNeedRows — the recovery page’s follow-up queues', () => {
  const claims = [
    claim({}), // letter sent 20 days ago → waiting
    claim({ outstandingAgorot: 5_050, supplierName: 'ספק א' }),
    claim({ status: 'acknowledged', letterSentAt: daysAgo(40) }), // answered → never "late"
    claim({ status: 'claimed', letterSentAt: null, outstandingAgorot: 2_500 }), // never sent
    claim({ letterSentAt: daysAgo(3), supplierName: 'ספק ב' }), // still inside the week
  ];

  it('the values are exactly followUps(): waiting and unsent, each with its count', () => {
    const q = followUps(claims, NOW);
    const rows = claimNeedRows(q, fmt);
    expect(rows.map((r) => r.key)).toEqual(['claimsWaiting', 'claimsUnsent']);
    expect(rows[0]!.value).toBe(fmt.money(q.waiting.agorot));
    expect(rows[0]!.value).toBe('₪150.50');
    expect(rows[0]!.sub).toContain('"count":"2"');
    expect(rows[1]!.value).toBe('₪25.00');
    expect(rows[1]!.href).toBe('/dashboard/recovery');
  });

  it('the row says the window it uses — a week (owner 31.10), not 14 days', () => {
    const rows = claimNeedRows(followUps([claim({ letterSentAt: daysAgo(8) })], NOW), fmt);
    expect(rows.map((r) => r.key)).toEqual(['claimsWaiting']);
    expect(rows[0]!.label).toContain('"days":"7"');
  });

  it('nothing waiting, nothing unsent → no rows', () => {
    expect(claimNeedRows(followUps([claim({ letterSentAt: daysAgo(1) })], NOW), fmt)).toEqual([]);
  });
});
