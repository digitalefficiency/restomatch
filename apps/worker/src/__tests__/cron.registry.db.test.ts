import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import cronParser from 'cron-parser';
import { testDbUrl } from '@restomatch/db';
import { queueSql } from '@restomatch/queue';
import { dueSlot, firstTickKey, resetSchedulesForTests, tickSchedules } from '../queue';

/**
 * cron.ts on the REAL Postgres queue shim — no vi.mock('../queue').
 *
 * cron.test.ts pins the arguments cron.ts passes (with a faked queue). This file
 * registers every schedule through the real makeQueue().upsertJobScheduler (which
 * validates each pattern in its zone), then drives the real scheduler tick
 * against the test database at each schedule's own slot and asserts the slot's
 * job row exists: one job per schedule, on the queue its worker listens on.
 *
 * The day is 2026-11-01, after Israel's DST ended (2026-10-25): Asia/Jerusalem is
 * UTC+2, so the monthly report's '45 7 1 * *' slot is 05:45Z (it was 04:45Z on
 * 2026-10-01, under DST).
 */
const sql = queueSql(testDbUrl());
const TZ = 'Asia/Jerusalem';

interface Expected {
  id: string;
  queue: string;
  repeat: { pattern: string; tz: string } | { every: number };
  /** The slot on 2026-11-01 (UTC) and its Asia/Jerusalem wall-clock label. */
  slot?: { at: string; label: string };
}

const EXPECTED: Expected[] = [
  { id: 'baselines-02', queue: 'baselines', repeat: { pattern: '0 2 * * *', tz: TZ }, slot: { at: '2026-11-01T00:00:00.000Z', label: '2026-11-01T02:00' } },
  { id: 'retention-0330', queue: 'retention', repeat: { pattern: '30 3 * * *', tz: TZ }, slot: { at: '2026-11-01T01:30:00.000Z', label: '2026-11-01T03:30' } },
  { id: 'daily-expectations-06', queue: 'daily-expectations', repeat: { pattern: '0 6 * * *', tz: TZ }, slot: { at: '2026-11-01T04:00:00.000Z', label: '2026-11-01T06:00' } },
  { id: 'health-digest-0645', queue: 'health-digest', repeat: { pattern: '45 6 * * *', tz: TZ }, slot: { at: '2026-11-01T04:45:00.000Z', label: '2026-11-01T06:45' } },
  { id: 'price-alerts-07', queue: 'price-alerts', repeat: { pattern: '0 7 * * *', tz: TZ }, slot: { at: '2026-11-01T05:00:00.000Z', label: '2026-11-01T07:00' } },
  { id: 'monthly-report-1st-0745', queue: 'monthly-report', repeat: { pattern: '45 7 1 * *', tz: TZ }, slot: { at: '2026-11-01T05:45:00.000Z', label: '2026-11-01T07:45' } },
  { id: 'recovery-reminders-0830', queue: 'recovery-reminders', repeat: { pattern: '30 8 * * *', tz: TZ }, slot: { at: '2026-11-01T06:30:00.000Z', label: '2026-11-01T08:30' } },
  { id: 'order-reminders-09', queue: 'order-reminders', repeat: { pattern: '0 9 * * *', tz: TZ }, slot: { at: '2026-11-01T07:00:00.000Z', label: '2026-11-01T09:00' } },
  { id: 'supplier-delays-10', queue: 'supplier-delays', repeat: { pattern: '0 10 * * *', tz: TZ }, slot: { at: '2026-11-01T08:00:00.000Z', label: '2026-11-01T10:00' } },
  { id: 'end-of-day-report-19', queue: 'end-of-day-report', repeat: { pattern: '0 19 * * *', tz: TZ }, slot: { at: '2026-11-01T17:00:00.000Z', label: '2026-11-01T19:00' } },
  { id: 'outbox-dispatch-60s', queue: 'outbox-dispatch', repeat: { every: 60_000 } },
  { id: 'ocr-sweep-5m', queue: 'ocr-sweep', repeat: { every: 5 * 60_000 } },
];

let startedAt: Date;
let unregister: () => Promise<void>;

async function slotJob(id: string, label: string) {
  return sql<Array<{ queue: string; status: string; payload: unknown }>>`
    SELECT queue, status, payload FROM job_queue WHERE dedupe_key = ${`cron:${id}:${label}`}`;
}

beforeAll(async () => {
  const [row] = await sql<Array<{ t: Date }>>`SELECT now() AS t`;
  startedAt = row!.t;
  // Retention is opt-in (read when cron.ts loads): opt in so EVERY schedule is covered.
  process.env.RETENTION_CRON_ENABLED = '1';
  vi.spyOn(console, 'log').mockImplementation(() => {});
  resetSchedulesForTests();
  const cron = await import('../cron');
  await cron.registerCronSchedules();
  unregister = cron.unregisterCronSchedules;
});

afterAll(async () => {
  await unregister?.();
  resetSchedulesForTests();
  delete process.env.RETENTION_CRON_ENABLED;
  await sql`DELETE FROM job_queue WHERE starts_with(dedupe_key, 'cron:') AND created_at >= ${startedAt}`;
  // The scheduler's first-tick records (fake 2026-11-01 clock) for these schedules.
  await sql`DELETE FROM ops_kv WHERE key = ANY(${EXPECTED.map((e) => firstTickKey(e.id))}::text[])`;
});

describe('cron.ts on the real Postgres queue shim', () => {
  it("the monthly report's next slot after today is 2026-11-01T05:45Z (07:45 Asia/Jerusalem, after DST)", () => {
    const pattern = '45 7 1 * *';
    const next = cronParser.parseExpression(pattern, { tz: TZ, currentDate: new Date('2026-10-24T12:00:00Z') }).next();
    expect(next.toDate().toISOString()).toBe('2026-11-01T05:45:00.000Z');
    // Under DST a month earlier the same wall time was 04:45Z.
    const prev = cronParser.parseExpression(pattern, { tz: TZ, currentDate: new Date('2026-09-24T12:00:00Z') }).next();
    expect(prev.toDate().toISOString()).toBe('2026-10-01T04:45:00.000Z');
    // The shim agrees: due exactly at its instant, on time, labelled in local wall time …
    expect(dueSlot({ pattern, tz: TZ }, new Date('2026-11-01T05:45:00.000Z'))).toEqual({
      at: Date.parse('2026-11-01T05:45:00.000Z'),
      label: '2026-11-01T07:45',
      catchUp: false,
    });
    // … and not a millisecond before (October's slot is past its 3-day catch-up window).
    expect(dueSlot({ pattern, tz: TZ }, new Date('2026-11-01T05:44:59.999Z'))).toBeNull();
  });

  it('every schedule in cron.ts is registered and fires exactly its own slot on its own queue', async () => {
    const fired = new Set<string>();
    const timed = EXPECTED.filter((e) => e.slot).sort((a, b) => Date.parse(a.slot!.at) - Date.parse(b.slot!.at));

    for (const e of timed) {
      const at = new Date(e.slot!.at);
      // One minute before its slot the schedule is not due yet.
      const early = await tickSchedules(sql, new Date(at.getTime() - 60_000));
      expect(early).not.toContain(e.id);
      early.forEach((id) => fired.add(id));

      const ids = await tickSchedules(sql, at);
      ids.forEach((id) => fired.add(id));
      expect(ids, `${e.id} at ${e.slot!.at}`).toContain(e.id);
      const [job] = await slotJob(e.id, e.slot!.label);
      expect(job, `${e.id}: job row for ${e.slot!.label}`).toMatchObject({ queue: e.queue, status: 'queued', payload: {} });
      // A second tick at the same instant (another worker) adds nothing.
      expect(await tickSchedules(sql, at)).not.toContain(e.id);
      expect(await slotJob(e.id, e.slot!.label)).toHaveLength(1);
    }

    // Interval schedules fire on every tick, labelled with their UTC slot.
    for (const e of EXPECTED.filter((x) => 'every' in x.repeat)) {
      const every = (e.repeat as { every: number }).every;
      const at = new Date(Date.parse('2026-11-01T17:00:00.000Z') + 2 * every);
      const ids = await tickSchedules(sql, at);
      ids.forEach((id) => fired.add(id));
      expect(ids).toContain(e.id);
      const label = new Date(Math.floor(at.getTime() / every) * every).toISOString();
      const [job] = await slotJob(e.id, label);
      expect(job).toMatchObject({ queue: e.queue, status: 'queued', payload: {} });
    }

    // Exactly the expected schedules — nothing missing, nothing unexpected.
    expect([...fired].sort()).toEqual(EXPECTED.map((e) => e.id).sort());
  });

  it('unregisterCronSchedules removes every schedule: a later tick fires nothing', async () => {
    await unregister();
    expect(await tickSchedules(sql, new Date('2026-12-01T05:45:00.000Z'))).toEqual([]);
  });
});
