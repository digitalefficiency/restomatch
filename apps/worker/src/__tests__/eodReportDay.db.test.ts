import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDbUrl } from '@restomatch/db';
import { queueSql } from '@restomatch/queue';
import { eodDedupeKey, eodReportDay, legacyEodKey, processEndOfDayReport } from '../jobs/endOfDayReport';
import type { WorkerJob } from '../queue';

/**
 * The end-of-day report labels (and dedupes) the ISRAEL day it reports on. It used
 * to take the UTC date of Israel midnight — always the previous Israel date — so a
 * catch-up after Israel midnight took the NEXT evening's key and that evening's
 * real digest was deduped away for every recipient.
 */
process.env.DATABASE_URL ??= testDbUrl();
process.env.APP_BASE_URL = 'https://app.example.test';

const sql = queueSql(testDbUrl());
const job = <T>(data: T): WorkerJob<T> => ({ id: 'test', name: 'test', data, attemptsMade: 0, opts: { attempts: 1 } });
const TAG = `eod-day-${process.pid}`;
// Thu 12.11.2026 (IST, UTC+2): 19:00 IL = 17:00Z; the 00:30 IL catch-up = 22:30Z.
const THU_1900 = '2026-11-12T17:00:00Z';
const FRI_0030 = '2026-11-12T22:30:00Z';
const FRI_1900 = '2026-11-13T17:00:00Z';

describe('eodReportDay', () => {
  it.each([
    [THU_1900, '2026-11-12'], // the 19:00 slot reports its own day
    [FRI_0030, '2026-11-12'], // a catch-up after midnight reports the slot's day, not Friday
    ['2026-11-13T03:59:00Z', '2026-11-12'], // 05:59 IL, still the catch-up window
    ['2026-11-13T04:00:00Z', '2026-11-13'], // 06:00 IL, a new day
    ['2026-10-25T17:00:00Z', '2026-10-25'], // the DST-change day (IDT → IST at 02:00)
  ])('%s → %s', (iso, day) => {
    expect(eodReportDay(new Date(iso)).dayKey).toBe(day);
  });

  it('the window is the whole report day in Israel time', () => {
    const w = eodReportDay(new Date(FRI_0030));
    expect(w.startOfDay.toISOString()).toBe('2026-11-11T22:00:00.000Z');
    expect(w.endOfDay.toISOString()).toBe('2026-11-12T22:00:00.000Z');
  });
});

describe('end-of-day report dedupe on the Israel day (DB)', () => {
  let rid = '';
  let uid = '';
  const email = `${TAG}-owner@example.test`;

  async function outbox() {
    return sql<{ dedupe_key: string }[]>`
      select dedupe_key from notifications_outbox where restaurant_id = ${rid} order by created_at`;
  }

  beforeAll(async () => {
    const [r] = await sql<{ id: string }[]>`insert into restaurants (name) values (${TAG}) returning id`;
    rid = r!.id;
    const [u] = await sql<{ id: string }[]>`insert into users (email, name) values (${email}, 'owner') returning id`;
    uid = u!.id;
    await sql`insert into memberships (user_id, restaurant_id, role) values (${uid}, ${rid}, 'owner')`;
    // On a matched invoice, so the open finding carries claimable ₪ (an open credit):
    // a finding with no ₪ makes a quiet day once nothing is caught (Train C r6).
    const [inv] = await sql<{ id: string }[]>`
      insert into invoices (restaurant_id, total_incl_vat, status, source)
      values (${rid}, '100.00', 'matched', 'photo') returning id`;
    const [m] = await sql<{ id: string }[]>`
      insert into match_runs (restaurant_id, invoice_id, overall_status) values (${rid}, ${inv!.id}, 'minor') returning id`;
    // One open finding caught on Thursday afternoon, so no day is "quiet".
    await sql`insert into discrepancies (match_run_id, restaurant_id, type, severity, delta_amount, created_at)
              values (${m!.id}, ${rid}, 'PRICE_HIGHER', 'warn', '12.50', '2026-11-12T10:00:00Z')`;
  });

  afterAll(async () => {
    if (rid) {
      await sql`delete from notifications_outbox where restaurant_id = ${rid}`;
      await sql`delete from memberships where restaurant_id = ${rid}`;
      await sql`delete from restaurants where id = ${rid}`;
    }
    if (uid) await sql`delete from users where id = ${uid}`;
  });

  it('a 00:30 catch-up of Thursday never takes Friday evening’s key', async () => {
    await sql`delete from notifications_outbox where restaurant_id = ${rid}`;
    const thu = await processEndOfDayReport(job({ restaurantId: rid, forDate: THU_1900 }));
    expect(thu).toMatchObject({ date: '2026-11-12', sent: 1 });
    const catchUp = await processEndOfDayReport(job({ restaurantId: rid, forDate: FRI_0030 }));
    expect(catchUp).toMatchObject({ date: '2026-11-12', sent: 0 }); // same day: deduped
    const fri = await processEndOfDayReport(job({ restaurantId: rid, forDate: FRI_1900 }));
    expect(fri).toMatchObject({ date: '2026-11-13', sent: 1 }); // Friday's digest still goes out
    expect((await outbox()).map((o) => o.dedupe_key)).toEqual([
      eodDedupeKey(rid, '2026-11-12', email),
      eodDedupeKey(rid, '2026-11-13', email),
    ]);
  });

  it('a catch-up alone (the 19:00 run missed) is keyed and windowed on Thursday', async () => {
    await sql`delete from notifications_outbox where restaurant_id = ${rid}`;
    const r = await processEndOfDayReport(job({ restaurantId: rid, forDate: FRI_0030 }));
    expect(r).toMatchObject({ date: '2026-11-12', sent: 1 });
    expect((await outbox())[0]!.dedupe_key).toBe(eodDedupeKey(rid, '2026-11-12', email));
  });

  it('deploy day: a recipient already sent the OLD-format key for the report day is not sent again', async () => {
    await sql`delete from notifications_outbox where restaurant_id = ${rid}`;
    const day = eodReportDay(new Date(THU_1900));
    const old = legacyEodKey(rid, day.startOfDay, email);
    expect(old).toBe(`eod-report:${rid}:2026-11-11:${email}`); // what the old code wrote on Thursday
    await sql`insert into notifications_outbox (restaurant_id, channel, target, body, status, dedupe_key)
              values (${rid}, 'email', ${email}, 'old', 'sent', ${old})`;
    expect((await processEndOfDayReport(job({ restaurantId: rid, forDate: THU_1900 }))).sent).toBe(0);
    // …and the new-format Thursday key can never be mistaken for Friday's legacy key.
    expect((await processEndOfDayReport(job({ restaurantId: rid, forDate: FRI_1900 }))).sent).toBe(1);
  });
});
