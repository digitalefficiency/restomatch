import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * cron.ts is on the immutability list: this pins its full schedule so any
 * change (wave-1 S12 added recovery-reminders + monthly-report; #49 health-digest +
 * ocr-sweep) is deliberate.
 * Queues are faked — no Redis needed.
 */
const calls: Array<{ queue: string; id: string; repeat: unknown; name: string }> = [];
const removed: string[] = [];

vi.mock('../queue', () => ({
  makeQueue: (queue: string) => ({
    upsertJobScheduler: async (id: string, repeat: unknown, tmpl: { name: string }) => {
      calls.push({ queue, id, repeat, name: tmpl.name });
    },
    removeJobScheduler: async (id: string) => {
      removed.push(id);
    },
  }),
}));

describe('cron schedules', () => {
  beforeEach(() => {
    calls.length = 0;
    removed.length = 0;
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('registers every job with its IL-time pattern (retention only when opted in)', async () => {
    const { registerCronSchedules } = await import('../cron');
    await registerCronSchedules();
    const TZ = 'Asia/Jerusalem';
    expect(calls.map(({ queue, id, repeat }) => ({ queue, id, repeat }))).toEqual([
      { queue: 'daily-expectations', id: 'daily-expectations-06', repeat: { pattern: '0 6 * * *', tz: TZ } },
      { queue: 'baselines', id: 'baselines-02', repeat: { pattern: '0 2 * * *', tz: TZ } },
      { queue: 'outbox-dispatch', id: 'outbox-dispatch-60s', repeat: { every: 60_000 } },
      { queue: 'order-reminders', id: 'order-reminders-09', repeat: { pattern: '0 9 * * *', tz: TZ } },
      { queue: 'supplier-delays', id: 'supplier-delays-10', repeat: { pattern: '0 10 * * *', tz: TZ } },
      { queue: 'end-of-day-report', id: 'end-of-day-report-19', repeat: { pattern: '0 19 * * *', tz: TZ } },
      { queue: 'price-alerts', id: 'price-alerts-07', repeat: { pattern: '0 7 * * *', tz: TZ } },
      { queue: 'recovery-reminders', id: 'recovery-reminders-0830', repeat: { pattern: '30 8 * * *', tz: TZ } },
      { queue: 'monthly-report', id: 'monthly-report-1st-0745', repeat: { pattern: '45 7 1 * *', tz: TZ } },
      { queue: 'health-digest', id: 'health-digest-0645', repeat: { pattern: '45 6 * * *', tz: TZ } },
      { queue: 'ocr-sweep', id: 'ocr-sweep-5m', repeat: { every: 5 * 60_000 } },
    ]);
    // The job name each scheduler enqueues equals its queue name (what the worker listens on).
    for (const c of calls) expect(c.name).toBe(c.queue);
  });

  it('unregisters the new schedulers too', async () => {
    const { unregisterCronSchedules } = await import('../cron');
    await unregisterCronSchedules();
    expect(removed).toEqual(
      expect.arrayContaining([
        'price-alerts-07',
        'recovery-reminders-0830',
        'monthly-report-1st-0745',
        'health-digest-0645',
        'ocr-sweep-5m',
      ]),
    );
  });
});
