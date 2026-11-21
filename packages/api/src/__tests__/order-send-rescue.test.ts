import { describe, expect, it } from 'vitest';
import { needsSendRescue, sendRescueDedupeKey, type RescueCandidate } from '../orders/sendRescue';

/** W3-09 / AU-11 c · failed-send rescue selection (pure; never retries). */
const now = new Date('2026-10-25T06:00:00Z');
const base: RescueCandidate = {
  poId: 'po1',
  poStatus: 'sent',
  placedAt: new Date('2026-10-24T10:00:00Z'),
  sendState: 'skipped',
  sentManually: false,
  hasGoodsReceipt: false,
};

describe('needsSendRescue', () => {
  it('skipped (no provider) or failed → rescue', () => {
    expect(needsSendRescue(base, now)).toBe(true);
    expect(needsSendRescue({ ...base, sendState: 'failed' }, now)).toBe(true);
  });
  it('sent, queued or none → no rescue', () => {
    for (const s of ['sent', 'queued', 'none'] as const) expect(needsSendRescue({ ...base, sendState: s }, now)).toBe(false);
  });
  it('sent manually, goods received, older than 48 h, draft or cancelled → no rescue', () => {
    expect(needsSendRescue({ ...base, sentManually: true }, now)).toBe(false);
    expect(needsSendRescue({ ...base, hasGoodsReceipt: true }, now)).toBe(false);
    expect(needsSendRescue({ ...base, placedAt: new Date('2026-10-23T05:59:00Z') }, now)).toBe(false);
    expect(needsSendRescue({ ...base, poStatus: 'draft' }, now)).toBe(false);
    expect(needsSendRescue({ ...base, poStatus: 'cancelled' }, now)).toBe(false);
    expect(needsSendRescue({ ...base, placedAt: null }, now)).toBe(false);
  });
  it('dedupe key per restaurant, person and PO', () => {
    expect(sendRescueDedupeKey('r', 'u', 'po1')).toBe('au:A16c:r:u:po1');
  });
});
