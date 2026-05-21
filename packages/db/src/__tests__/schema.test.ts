import { afterAll, describe, expect, it } from 'vitest';
import { createDb, restaurants } from '../index';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://romkoren@localhost:5432/restomatch_test';
const db = createDb(url);

describe('db schema smoke', () => {
  afterAll(async () => {
    await db.delete(restaurants);
  });

  it('inserts and reads a restaurant', async () => {
    const [r] = await db
      .insert(restaurants)
      .values({ name: 'Schema Test', businessId: '999888777' })
      .returning();
    expect(r).toBeDefined();
    expect(r?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(r?.vatRate).toBe('0.1700');
    expect(r?.timezone).toBe('Asia/Jerusalem');
  });

  it('settings json round-trips', async () => {
    const [r] = await db
      .insert(restaurants)
      .values({
        name: 'Settings Test',
        settings: {
          tolerances: {
            pricePercent: 0.05,
            qtyPercent: 0.1,
          },
        },
      })
      .returning();
    expect(r?.settings?.tolerances?.pricePercent).toBe(0.05);
    expect(r?.settings?.tolerances?.qtyPercent).toBe(0.1);
  });
});
