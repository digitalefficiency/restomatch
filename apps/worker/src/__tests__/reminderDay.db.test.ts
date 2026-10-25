import { describe, expect, it } from 'vitest';
import { testDbUrl } from '@restomatch/db';
import { processOrderReminders } from '../jobs/orderReminders';
import { processSupplierDelays } from '../jobs/supplierDelays';
import { ilDateKey } from '../lib/notifyHelpers';
import type { WorkerJob } from '../queue';

/**
 * order-reminders (09:00 IL) and supplier-delays (10:00 IL) label "today" — in
 * their result and in every outbox dedupe key — with the ISRAEL date. They used
 * the UTC date of Israel midnight (`startOfIlDay(now).toISOString()`), i.e. the
 * day before: on 2026-10-25 both jobs reported "2026-10-24".
 */
process.env.DATABASE_URL ??= testDbUrl();

const NO_RESTAURANT = '00000000-0000-4000-8000-000000000000'; // no rows: only the day label is computed
const job = <T>(data: T): WorkerJob<T> => ({ id: 'test', name: 'test', data, attemptsMade: 0, opts: { attempts: 1 } });

describe('ilDateKey', () => {
  it('is the Israel calendar date, also right after Israel midnight (UTC still on the day before)', () => {
    expect(ilDateKey(new Date('2026-11-09T22:30:00Z'))).toBe('2026-11-10'); // 00:30 IST
    expect(ilDateKey(new Date('2026-10-24T21:30:00Z'))).toBe('2026-10-25'); // 00:30 IDT, the DST-change day
    expect(ilDateKey(new Date('2026-10-25T21:59:59Z'))).toBe('2026-10-25'); // 23:59:59 IST, same day
  });
});

describe('the daily reminder jobs label the Israel day', () => {
  it('order-reminders at 09:00 IL on 2026-10-25 reports 2026-10-25', async () => {
    const r = await processOrderReminders(job({ restaurantId: NO_RESTAURANT, forDate: '2026-10-25T07:00:00Z' }));
    expect(r).toEqual({ date: '2026-10-25', dueToday: 0, enqueued: 0 });
  });

  it('supplier-delays at 10:00 IL on 2026-10-25 reports 2026-10-25', async () => {
    const r = await processSupplierDelays(job({ restaurantId: NO_RESTAURANT, forDate: '2026-10-25T08:00:00Z' }));
    expect(r).toEqual({ date: '2026-10-25', overdue: 0, enqueued: 0 });
  });

  it('a winter day: 09:00 IL on 2026-11-10 reports 2026-11-10 (both jobs)', async () => {
    expect((await processOrderReminders(job({ restaurantId: NO_RESTAURANT, forDate: '2026-11-10T07:00:00Z' }))).date).toBe('2026-11-10');
    expect((await processSupplierDelays(job({ restaurantId: NO_RESTAURANT, forDate: '2026-11-10T08:00:00Z' }))).date).toBe('2026-11-10');
  });
});
