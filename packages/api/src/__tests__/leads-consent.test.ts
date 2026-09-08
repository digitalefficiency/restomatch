import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, leads } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext } from '../context';

const url = testDbUrl();
const db = createDb(url);

function publicCaller() {
  const ctx: AppContext = { db, session: null };
  return appRouter.createCaller(ctx);
}

describe('leads.create — marketing consent capture (E.7)', () => {
  beforeEach(async () => {
    await db.delete(leads);
  });
  afterAll(async () => {
    await db.delete(leads);
  });

  it('stamps consent evidence (flag + text + timestamp) when opted in', async () => {
    const consentText = 'אני מאשר/ת קבלת תכנים שיווקיים';
    await publicCaller().leads.create({
      name: 'דנה כהן',
      email: 'dana@example.com',
      source: 'landing',
      marketingConsent: true,
      consentText,
    });
    const [row] = await db.select().from(leads);
    expect(row?.marketingConsent).toBe(true);
    expect(row?.consentText).toBe(consentText);
    expect(row?.consentAt).toBeInstanceOf(Date);
    // Every lead gets a stable opt-out token.
    expect(row?.unsubscribeToken).toBeTruthy();
  });

  it('does NOT stamp consent when the box is unchecked (default false)', async () => {
    await publicCaller().leads.create({
      name: 'משה לוי',
      source: 'landing',
      marketingConsent: false,
      consentText: 'הוצג אך לא סומן',
    });
    const [row] = await db.select().from(leads);
    expect(row?.marketingConsent).toBe(false);
    expect(row?.consentText).toBeNull();
    expect(row?.consentAt).toBeNull();
  });

  it('treats omitted consent as not-consented', async () => {
    await publicCaller().leads.create({ name: 'אורח', source: 'landing' });
    const [row] = await db.select().from(leads);
    expect(row?.marketingConsent).toBe(false);
    expect(row?.consentAt).toBeNull();
  });

  it('honeypot still suppresses the insert regardless of consent', async () => {
    await publicCaller().leads.create({ name: 'bot', marketingConsent: true, hp: 'spam' });
    expect(await db.select().from(leads)).toHaveLength(0);
  });
});
