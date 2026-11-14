import { describe, expect, it } from 'vitest';
import { cutoffBucket, parseCutoff, planCutoffPushes, type CutoffSupplier } from '../jobs/orderCutoff';

/**
 * W3-09 / AU-11 · the order-cutoff 15-minute bucket rule, at fixed Israel clocks.
 * 2026-10-25 is a Sunday (weekday 0); Israel is UTC+2 after 25.10 03:00 (winter).
 */
const IL = (hhmmss: string) => new Date(`2026-10-25T${hhmmss}+02:00`);
const sup = (id: string, cutoff: string, extra: Partial<CutoffSupplier> = {}): CutoffSupplier => ({
  supplierId: id,
  active: true,
  sentToday: false,
  orderSchedule: { windows: [{ orderDays: [0, 3], cutoff, fulfillment: { kind: 'lead_days', leadDays: 1 } }] },
  ...extra,
});
const ids = (p: ReturnType<typeof planCutoffPushes>) => p.pushes.map((x) => x.supplierId);

describe('order-cutoff planner', () => {
  it('parses HH:MM only', () => {
    expect(parseCutoff('14:00')).toBe(840);
    expect(parseCutoff('7:30')).toBeNull();
    expect(parseCutoff('24:00')).toBeNull();
    expect(parseCutoff(undefined)).toBeNull();
  });

  it('floors to the IL 15-minute bucket', () => {
    expect(cutoffBucket(IL('12:14:59'))).toBe(12 * 60);
    expect(cutoffBucket(IL('12:15:30'))).toBe(12 * 60 + 15);
  });

  it('cut-off 14:00 → pushed at the 12:00 tick only', () => {
    expect(ids(planCutoffPushes('r', [sup('a', '14:00')], IL('12:00:00')))).toEqual(['a']);
    expect(ids(planCutoffPushes('r', [sup('a', '14:00')], IL('11:45:00')))).toEqual([]);
    expect(ids(planCutoffPushes('r', [sup('a', '14:00')], IL('12:15:00')))).toEqual([]);
  });

  it('cut-off 14:08 with the 12:00 slot executed at 12:00:40 → pushed; the 12:15:30 run → nothing', () => {
    expect(ids(planCutoffPushes('r', [sup('a', '14:08')], IL('12:00:40')))).toEqual(['a']);
    expect(ids(planCutoffPushes('r', [sup('a', '14:08')], IL('12:15:30')))).toEqual([]);
  });

  it('a late 12:30 tick for 14:00 → nothing', () => {
    expect(ids(planCutoffPushes('r', [sup('a', '14:00')], IL('12:30:00')))).toEqual([]);
  });

  it('cut-off before 08:00 → no intraday push', () => {
    expect(ids(planCutoffPushes('r', [sup('a', '07:30')], IL('05:30:00')))).toEqual([]);
    expect(ids(planCutoffPushes('r', [sup('a', '08:00')], IL('06:00:00')))).toEqual(['a']);
  });

  it('outside IL 06:00–21:59 → skipped (quiet hours, no catch-up)', () => {
    expect(planCutoffPushes('r', [sup('a', '23:59')], IL('22:05:00'))).toEqual({ skipped: 'quiet_hours', pushes: [] });
    expect(planCutoffPushes('r', [sup('a', '07:45')], IL('05:45:00')).skipped).toBe('quiet_hours');
  });

  it('not an order day, inactive, already sent, no schedule → nothing', () => {
    const monday = new Date('2026-10-26T12:00:00+02:00');
    expect(ids(planCutoffPushes('r', [sup('a', '14:00')], monday))).toEqual([]);
    expect(ids(planCutoffPushes('r', [sup('a', '14:00', { active: false })], IL('12:00:00')))).toEqual([]);
    expect(ids(planCutoffPushes('r', [sup('a', '14:00', { sentToday: true })], IL('12:00:00')))).toEqual([]);
    expect(ids(planCutoffPushes('r', [sup('a', '14:00', { orderSchedule: null })], IL('12:00:00')))).toEqual([]);
  });

  it('dedupe key is per restaurant, supplier and IL day', () => {
    const p = planCutoffPushes('r1', [sup('a', '14:00')], IL('12:00:00'));
    expect(p.pushes[0]!.dedupeKey).toBe('au:A16:cutoff:r1:a:2026-10-25');
  });
});
