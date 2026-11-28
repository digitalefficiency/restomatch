/**
 * W3-07a · the "חיבורים" nav dot (nav.badges `connections`): 'warn' only while a
 * connection needs action (a live connection not synced for 48 h), otherwise no
 * badge. Never danger, never ₪; owner + manager only; tenant-isolated.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, procurementConnections, restaurants, sql } from '@restomatch/db';
import { connectionsBadge } from '../tasks/badges';
import { isSyncStale, STALE_SYNC_MS } from '../routers/integrations';
import { as, db, fresh, seedStaffed, type Staffed } from './tasks-fixtures';

beforeEach(fresh);
afterAll(fresh);

async function integrationsOn(t: Staffed) {
  await db
    .update(restaurants)
    .set({ settings: sql`jsonb_set(coalesce(${restaurants.settings}, '{}'::jsonb), '{features}', coalesce(${restaurants.settings} -> 'features', '{}'::jsonb) || '{"integrations": true}'::jsonb)` })
    .where(eq(restaurants.id, t.restaurantId));
}

async function connect(t: Staffed, opts: { platform: 'marketman' | 'zester'; live: boolean; lastSyncAt: Date | null }) {
  await db.insert(procurementConnections).values({
    restaurantId: t.restaurantId,
    platform: opts.platform,
    credentialsVaultRef: opts.live ? 'vault:real-account' : 'fixture:sample',
    lastSyncAt: opts.lastSyncAt,
    enabled: true,
  });
}

describe('isSyncStale / connectionsBadge (pure)', () => {
  const now = new Date('2026-10-25T09:40:00Z');
  it('only a live, enabled connection past 48 h needs action', () => {
    const old = new Date(now.getTime() - STALE_SYNC_MS - 1);
    const fresh_ = new Date(now.getTime() - 60_000);
    expect(isSyncStale({ connected: true, mode: 'live', lastSyncAt: old }, now)).toBe(true);
    expect(isSyncStale({ connected: true, mode: 'live', lastSyncAt: null }, now)).toBe(true);
    expect(isSyncStale({ connected: true, mode: 'live', lastSyncAt: fresh_ }, now)).toBe(false);
    expect(isSyncStale({ connected: true, mode: 'sample', lastSyncAt: old }, now)).toBe(false);
    expect(isSyncStale({ connected: false, mode: null, lastSyncAt: null }, now)).toBe(false);
  });
  it('the badge is warn with a count, or nothing', () => {
    expect(connectionsBadge(0)).toBeNull();
    expect(connectionsBadge(2)).toEqual({ count: 2, ilsAgorot: null, block: false, tone: 'warn' });
  });
});

describe('nav.badges connections (DB)', () => {
  it('error → a warn dot for the owner and the manager', async () => {
    const a = await seedStaffed('DotA');
    await integrationsOn(a);
    await connect(a, { platform: 'marketman', live: true, lastSyncAt: new Date(Date.now() - 3 * 86_400_000) });
    for (const role of ['owner', 'manager'] as const) {
      const { badges } = await as(a, role).nav.badges();
      expect(badges.connections, role).toEqual({ count: 1, ilsAgorot: null, block: false, tone: 'warn' });
    }
  });

  it('healthy → no badge (fresh live sync, sample data, nothing connected)', async () => {
    const a = await seedStaffed('DotB');
    await integrationsOn(a);
    expect((await as(a, 'owner').nav.badges()).badges.connections).toBeUndefined();
    await connect(a, { platform: 'marketman', live: true, lastSyncAt: new Date() });
    await connect(a, { platform: 'zester', live: false, lastSyncAt: null });
    expect((await as(a, 'owner').nav.badges()).badges.connections).toBeUndefined();
  });

  it('bookkeeper / receiver / chef never get it; flag off → none; B never lights A', async () => {
    const a = await seedStaffed('DotC');
    const b = await seedStaffed('DotD');
    await integrationsOn(b);
    await connect(b, { platform: 'marketman', live: true, lastSyncAt: null });
    // A has the flag off and no connections; B's stuck connection never reaches A.
    expect((await as(a, 'owner').nav.badges()).badges.connections).toBeUndefined();
    for (const role of ['bookkeeper', 'receiver', 'chef'] as const) {
      expect((await as(b, role).nav.badges()).badges.connections, role).toBeUndefined();
    }
  });
});
