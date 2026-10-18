import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { count, createDb, leads, plans } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext } from '../context';
import { seedPlans } from './fixtures';

const url = testDbUrl();
const db = createDb(url);

/** Public caller — no session. */
function publicCaller() {
  const ctx: AppContext = { db, session: null };
  return appRouter.createCaller(ctx);
}

async function leadCount(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(leads);
  return Number(row?.n ?? 0);
}

describe('plans.list (public)', () => {
  beforeAll(async () => {
    await db.delete(plans);
    await seedPlans(db);
  });
  afterAll(async () => {
    await db.delete(plans);
  });

  it('returns active plans ordered by sortOrder with public catalog fields', async () => {
    const list = await publicCaller().plans.list();
    expect(list.length).toBeGreaterThanOrEqual(4);
    const orders = list.map((p) => p.priceAgorotMonthly);
    expect(orders).toEqual([...orders].sort((a, b) => a - b)); // trial(0)..chain
    const trial = list.find((p) => p.key === 'trial');
    expect(trial).toBeDefined();
    expect(trial).toMatchObject({ nameHe: expect.any(String) });
    expect(trial?.limits).toMatchObject({ invoicesPerMonth: expect.any(Number) });
    expect(Array.isArray(trial?.features)).toBe(true);
    // No internal columns leak.
    expect(Object.keys(list[0] ?? {})).toEqual([
      'key',
      'nameHe',
      'priceAgorotMonthly',
      'limits',
      'features',
    ]);
  });
});

describe('leads.create (public, honeypot)', () => {
  beforeEach(async () => {
    await db.delete(leads);
  });
  afterAll(async () => {
    await db.delete(leads);
  });

  it('inserts a valid lead', async () => {
    const res = await publicCaller().leads.create({
      name: 'דנה כהן',
      phone: '050-1234567',
      email: 'dana@example.com',
      restaurantName: 'ביסטרו',
      monthlyProcurementAgorot: 5_000_00,
      source: 'landing',
    });
    expect(res).toEqual({ ok: true });
    expect(await leadCount()).toBe(1);
  });

  it('honeypot: a non-empty hp silently succeeds and inserts NOTHING', async () => {
    const res = await publicCaller().leads.create({ name: 'bot', hp: 'http://spam' });
    expect(res).toEqual({ ok: true });
    expect(await leadCount()).toBe(0);
  });

  it('empty/whitespace hp is treated as not-tripped (inserts)', async () => {
    await publicCaller().leads.create({ name: 'human', hp: '   ' });
    expect(await leadCount()).toBe(1);
  });

  it('rejects an over-long name', async () => {
    await expect(
      publicCaller().leads.create({ name: 'x'.repeat(201) }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('rejects a malformed email', async () => {
    await expect(
      publicCaller().leads.create({ name: 'ok', email: 'not-an-email' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
