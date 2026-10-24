import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDbUrl } from '@restomatch/db';
import { queueSql } from '@restomatch/queue';
import { dueSlot, makeQueue, resetSchedulesForTests, tickSchedules, type Repeat } from '../queue';

/**
 * The wave-1 schedule (claude/wave1-main cron.ts: 12 schedulers, tz Asia/Jerusalem)
 * registered on the REAL Postgres shim — cron.test.ts mocks ../queue, so this is
 * where the patterns, the zone and the slot → job path are actually exercised.
 */
const sql = queueSql(testDbUrl());
const TZ = 'Asia/Jerusalem';
const P = `w1s-${process.pid}`;

const WAVE1: Array<{ id: string; queue: string; repeat: Repeat }> = [
  { id: 'daily-expectations-06', queue: 'daily-expectations', repeat: { pattern: '0 6 * * *', tz: TZ } },
  { id: 'baselines-02', queue: 'baselines', repeat: { pattern: '0 2 * * *', tz: TZ } },
  { id: 'outbox-dispatch-60s', queue: 'outbox-dispatch', repeat: { every: 60_000 } },
  { id: 'order-reminders-09', queue: 'order-reminders', repeat: { pattern: '0 9 * * *', tz: TZ } },
  { id: 'supplier-delays-10', queue: 'supplier-delays', repeat: { pattern: '0 10 * * *', tz: TZ } },
  { id: 'end-of-day-report-19', queue: 'end-of-day-report', repeat: { pattern: '0 19 * * *', tz: TZ } },
  { id: 'price-alerts-07', queue: 'price-alerts', repeat: { pattern: '0 7 * * *', tz: TZ } },
  { id: 'recovery-reminders-0830', queue: 'recovery-reminders', repeat: { pattern: '30 8 * * *', tz: TZ } },
  { id: 'monthly-report-1st-0745', queue: 'monthly-report', repeat: { pattern: '45 7 1 * *', tz: TZ } },
  { id: 'health-digest-0645', queue: 'health-digest', repeat: { pattern: '45 6 * * *', tz: TZ } },
  { id: 'ocr-sweep-5m', queue: 'ocr-sweep', repeat: { every: 5 * 60_000 } },
  { id: 'retention-0330', queue: 'retention', repeat: { pattern: '30 3 * * *', tz: TZ } },
];

// Each schedule's slot on 2026-11-01 (IST, UTC+2) — the first monthly report after the DST switch.
const NOV_1_SLOT_UTC: Record<string, string> = {
  'daily-expectations-06': '2026-11-01T04:00:00Z',
  'baselines-02': '2026-11-01T00:00:00Z',
  'order-reminders-09': '2026-11-01T07:00:00Z',
  'supplier-delays-10': '2026-11-01T08:00:00Z',
  'end-of-day-report-19': '2026-11-01T17:00:00Z',
  'price-alerts-07': '2026-11-01T05:00:00Z',
  'recovery-reminders-0830': '2026-11-01T06:30:00Z',
  'monthly-report-1st-0745': '2026-11-01T05:45:00Z',
  'health-digest-0645': '2026-11-01T04:45:00Z',
  'retention-0330': '2026-11-01T01:30:00Z',
};

const q = (name: string) => `${P}-${name}`;

beforeEach(async () => {
  resetSchedulesForTests();
  await sql`DELETE FROM job_queue WHERE queue LIKE ${`${P}-%`}`;
});
afterAll(async () => {
  resetSchedulesForTests();
  await sql`DELETE FROM job_queue WHERE queue LIKE ${`${P}-%`}`;
});

describe('wave-1 schedules on the real Postgres shim', () => {
  it('all 12 register (patterns validated at registration)', async () => {
    for (const s of WAVE1) {
      await expect(
        makeQueue(q(s.queue)).upsertJobScheduler(s.id, s.repeat, { name: s.id, data: { from: 'cron' } }),
      ).resolves.toBeUndefined();
    }
  });

  it('every pattern schedule lands on the right UTC instant on 2026-11-01 (IST), monthly at 05:45Z', () => {
    for (const s of WAVE1) {
      if ('every' in s.repeat) continue;
      const at = Date.parse(NOV_1_SLOT_UTC[s.id]!);
      expect(dueSlot(s.repeat, new Date(at + 5_000)), s.id).toMatchObject({ at, catchUp: false });
    }
  });

  it('a tick at 2026-11-01T05:45:05Z turns exactly the due slots into one job each (monthly report included)', async () => {
    for (const s of WAVE1) await makeQueue(q(s.queue)).upsertJobScheduler(s.id, s.repeat, { name: s.id, data: {} });
    // Prior history so the daily slots inside their 6 h window are real catch-ups, not the first-tick cutover skip.
    for (const s of WAVE1) {
      await sql`INSERT INTO job_queue (queue, payload, status, dedupe_key, finished_at)
                VALUES (${q(s.queue)}, '{}', 'done', ${`cron:${s.id}:history`}, now())`;
    }
    const fired = await tickSchedules(sql, new Date('2026-11-01T05:45:05Z'));
    // On time: monthly-report (05:45Z) + both every-N. Caught up (≤ 6 h old): baselines 00:00Z,
    // retention 01:30Z, daily-expectations 04:00Z, health-digest 04:45Z, price-alerts 05:00Z.
    // Not yet due today: order-reminders, supplier-delays, end-of-day (yesterday's 17:00Z is > 6 h), recovery 06:30Z.
    expect(fired.sort()).toEqual(
      [
        'monthly-report-1st-0745',
        'outbox-dispatch-60s',
        'ocr-sweep-5m',
        'baselines-02',
        'retention-0330',
        'daily-expectations-06',
        'health-digest-0645',
        'price-alerts-07',
      ].sort(),
    );
    const [row] = await sql<Array<{ dedupe_key: string }>>`
      SELECT dedupe_key FROM job_queue WHERE queue = ${q('monthly-report')} AND status = 'queued'`;
    expect(row?.dedupe_key).toBe('cron:monthly-report-1st-0745:2026-11-01T07:45');
    // A second worker ticking the same instant adds nothing.
    resetSchedulesForTests();
    for (const s of WAVE1) await makeQueue(q(s.queue)).upsertJobScheduler(s.id, s.repeat, { name: s.id, data: {} });
    expect(await tickSchedules(sql, new Date('2026-11-01T05:45:05Z'))).toEqual([]);
  });
});
