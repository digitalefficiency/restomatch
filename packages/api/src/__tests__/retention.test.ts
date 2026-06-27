import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, leads, verificationTokens } from '@restomatch/db';
import { runRetention } from '../retention';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://romkoren@localhost:5432/restomatch_test';
const db = createDb(url);

const DAY = 24 * 60 * 60 * 1000;

async function cleanup() {
  await db.delete(verificationTokens);
  await db.delete(leads);
}

describe('runRetention (E.8)', () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  it('dry-run reports counts but deletes NOTHING', async () => {
    const now = new Date();
    await db.insert(verificationTokens).values({
      identifier: 'old@x.test',
      token: 'expired',
      expires: new Date(now.getTime() - 10 * DAY),
    });

    const report = await runRetention(db, { now });
    expect(report.dryRun).toBe(true);
    expect(report.expiredVerificationTokens).toBe(1);
    // Still present — dry-run is non-destructive.
    expect(await db.select().from(verificationTokens)).toHaveLength(1);
  });

  it('live run purges expired tokens and stale/unsubscribed leads, keeps in-window rows', async () => {
    const now = new Date();
    await db.insert(verificationTokens).values([
      { identifier: 'old@x.test', token: 'expired', expires: new Date(now.getTime() - 10 * DAY) },
      { identifier: 'live@x.test', token: 'live', expires: new Date(now.getTime() + 10 * DAY) },
    ]);
    // A stale, never-consented lead (older than the stale window).
    await db.insert(leads).values({
      name: 'stale',
      source: 'landing',
      marketingConsent: false,
      createdAt: new Date(now.getTime() - 800 * DAY),
    });
    // A recently unsubscribed lead older than the unsubscribed window.
    await db.insert(leads).values({
      name: 'unsubbed',
      source: 'landing',
      marketingConsent: true,
      unsubscribedAt: new Date(now.getTime() - 40 * DAY),
      createdAt: new Date(now.getTime() - 60 * DAY),
    });
    // A fresh consented lead that must be KEPT.
    await db.insert(leads).values({ name: 'fresh', source: 'landing', marketingConsent: true });

    const report = await runRetention(db, { now, dryRun: false });
    expect(report.expiredVerificationTokens).toBe(1);
    expect(report.staleLeads).toBe(1);
    expect(report.unsubscribedLeads).toBe(1);

    expect(await db.select().from(verificationTokens)).toHaveLength(1); // only the live one
    const remaining = await db.select().from(leads);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.name).toBe('fresh');
  });
});
