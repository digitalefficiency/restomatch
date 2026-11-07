import { describe, expect, it } from 'vitest';
import { createTranslator } from '@/lib/i18n/translate';
import { overview } from '@/lib/i18n/messages/overview';
import { othersLine, taskRow } from '@/lib/components/notifications/rows';
import type { Task } from '@/lib/components/notifications/model';
import { followUps } from '../../recovery/logic';
import { buildBoard, type BoardExpectation } from '../board';
import { todayCutoffs } from '../cutoffs';
// The server task spine's pure rules (packages/api is not exported for these; read by path).
import { claimFollowUps, deliverySummary, todayCutoffs as serverCutoffs } from '../../../../../../packages/api/src/tasks/sources/rules';

const t = createTranslator('he', overview);
const NOW = new Date('2026-10-25T09:40:00Z');

const task = (p: Partial<Task>): Task =>
  ({ type: 'decision', entityId: 'decision:mine', title: 'decision', ilsAgorot: 29_600, count: 4, blocking: 2, tier: 'T2', tone: 'danger', due: null, ageDays: 3, verb: 'decide', deepLink: '/dashboard/approvals', scope: 'mine', detail: { toReview: 1, duplicateAgorot: 0, vatAgorot: 0 }, ...p }) as Task;

describe('server rules = the screens they summarise (W2-08 parity)', () => {
  it('claim follow-ups: tasks claimFollowUps = recovery followUps, to the agora', () => {
    const claims = [
      { status: 'claimed' as const, outstandingAgorot: 12_345, letterSentAt: null, claimedAt: '2026-10-20T08:00:00Z', supplierName: 'א' },
      { status: 'letter_sent' as const, outstandingAgorot: 5_000, letterSentAt: '2026-10-10T08:00:00Z', claimedAt: '2026-10-09T08:00:00Z', supplierName: 'ב' },
      { status: 'letter_sent' as const, outstandingAgorot: 7_000, letterSentAt: '2026-10-22T08:00:00Z', claimedAt: '2026-10-21T08:00:00Z', supplierName: 'ג' },
      { status: 'acknowledged' as const, outstandingAgorot: 9_000, letterSentAt: '2026-10-01T08:00:00Z', claimedAt: '2026-10-01T08:00:00Z', supplierName: 'ד' },
    ];
    for (const now of ['2026-10-25T09:40:00Z', '2026-10-17T21:30:00Z', '2026-10-18T00:30:00Z']) {
      const web = followUps(claims, now);
      const srv = claimFollowUps(claims, now);
      expect({ u: srv.unsent.count, ua: srv.unsent.agorot, w: srv.waiting.count, wa: srv.waiting.agorot }, now).toEqual({
        u: web.unsent.count, ua: web.unsent.agorot, w: web.waiting.count, wa: web.waiting.agorot,
      });
    }
  });

  it('deliveries: tasks deliverySummary = the receiving board summary', () => {
    const po = (over: Partial<BoardExpectation>): BoardExpectation => ({
      poId: Math.random().toString(36), supplierName: 'ס', supplierNameEn: null, expectedAt: '2026-10-25T07:00:00Z', hasDeliveryDate: true,
      lineCount: 3, receiptId: null, receiptStatus: null, late: false, closedAt: null, ...over,
    });
    const rows = [
      po({}),
      po({ expectedAt: '2026-10-25T12:00:00Z' }),
      po({ receiptStatus: 'completed' }),
      po({ receiptStatus: 'rejected' }),
      po({ receiptStatus: 'pending', expectedAt: '2026-10-25T06:00:00Z' }),
      po({ late: true, expectedAt: '2026-10-23T07:00:00Z' }),
      po({ hasDeliveryDate: false, expectedAt: '2026-10-25T00:00:00Z' }),
    ];
    expect(deliverySummary(rows, NOW)).toEqual(buildBoard(rows, NOW).summary);
  });

  it('order cutoffs: the server copy = home/cutoffs', () => {
    const suppliers = [
      { id: 'a', name: 'א', orderSchedule: { windows: [{ orderDays: [0], cutoff: '14:00' }] } },
      { id: 'b', name: 'ב', orderSchedule: { windows: [{ orderDays: [0, 3], cutoff: '12:30' }] } },
      { id: 'c', name: 'ג', orderSchedule: { windows: [{ orderDays: [1], cutoff: '10:00' }] } },
    ];
    expect(serverCutoffs(suppliers, NOW)).toEqual(todayCutoffs(suppliers, NOW));
  });
});

describe('"מחכה לך" rows from tasks (W2-08 §5.2)', () => {
  it('the decision row carries the task ₪ untouched, the blockers and the review count — no age (I1 density)', () => {
    const r = taskRow(task({}), t, 'he', () => '₪0')!;
    expect(r.agorot).toBe(29_600);
    expect(r.tone).toBe('danger');
    expect(r.href).toBe('/dashboard/approvals');
    expect(r.sub).toContain('2 חוסמים תשלום');
    expect(r.sub).toContain('1 לבדיקה');
    // Owner decision I1: the age ranks the row on the server but is not printed.
    expect(r.sub).not.toContain('לפני');
  });

  it('a count task has no ₪; a staff (redacted) decision would show a count, never ₪', () => {
    const d = taskRow(task({ type: 'delivery_due', entityId: 'receiving:today', ilsAgorot: null, detail: { total: 5, received: 2, late: 1 } }), t, 'he', () => '')!;
    expect(d.agorot).toBeNull();
    expect(d.countText).toContain('5');
    expect(taskRow(task({ ilsAgorot: null }), t, 'he', () => '')!.countText).toBe('4');
  });

  it('claims show the agora (2 dp, like the recovery page)', () => {
    expect(taskRow(task({ type: 'claim_to_send', entityId: 'claims:unsent', ilsAgorot: 12_345 }), t, 'he', () => '')!.decimals).toBe(2);
  });

  it('"אצלך הכול מטופל · 4 ממתינים אצל הבעלים · ₪296" names the whole restaurant', () => {
    const line = othersLine([task({ type: 'waiting_on_others', scope: 'others', withRole: 'owner', count: 4, ilsAgorot: 29_600 })], t, 'he', (a) => `₪${a / 100}`);
    expect(line).toBe('אצלך הכול מטופל · 4 ממתינים אצל הבעלים · ₪296');
    expect(othersLine([task({})], t, 'he', () => '')).toBeNull();
  });
});
