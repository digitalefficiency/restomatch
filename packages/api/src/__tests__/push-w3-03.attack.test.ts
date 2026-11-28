import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDb, testDbUrl } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import {
  eventsForRole,
  setPushStore,
  type NotificationPrefRecord,
  type Owner,
  type PushStore,
  type PushSubscriptionRecord,
} from '../routers/push';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * W3-03b push router — cross-tenant + own-row attacks. The store is an in-memory
 * stand-in whose rows mirror H-03's push_subscriptions / notification_prefs; the
 * router must always pass the SESSION's (restaurant, user), never an input id.
 */
const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;

function memoryStore() {
  const subs: PushSubscriptionRecord[] = [];
  const prefs: NotificationPrefRecord[] = [];
  const mine = (o: Owner) => (r: { restaurantId: string; userId: string }) => r.restaurantId === o.restaurantId && r.userId === o.userId;
  const store: PushStore = {
    async listSubscriptions(_db, o) {
      return subs.filter((s) => mine(o)(s) && !s.revokedAt);
    },
    async upsertSubscription(_db, o, sub, now) {
      // UNIQUE (restaurant_id, endpoint): another user's row on the same endpoint is taken over (same device, new sign-in).
      const hit = subs.find((s) => s.restaurantId === o.restaurantId && s.endpoint === sub.endpoint);
      if (hit) {
        Object.assign(hit, { userId: o.userId, p256dh: sub.p256dh, auth: sub.auth, userAgent: sub.userAgent, lastSeenAt: now, revokedAt: null });
        return hit;
      }
      const row: PushSubscriptionRecord = { id: randomUUID(), ...o, ...sub, createdAt: now, lastSeenAt: now, revokedAt: null };
      subs.push(row);
      return row;
    },
    async revokeSubscription(_db, o, endpoint, now) {
      const hit = subs.find((s) => mine(o)(s) && s.endpoint === endpoint && !s.revokedAt);
      if (!hit) return false;
      hit.revokedAt = now;
      return true;
    },
    async listPrefs(_db, o) {
      return prefs.filter(mine(o));
    },
    async setPref(_db, o, p, now) {
      const hit = prefs.find((r) => mine(o)(r) && r.channel === p.channel && r.eventKind === p.eventKind);
      if (hit) {
        Object.assign(hit, { enabled: p.enabled, updatedAt: now });
        return hit;
      }
      const row: NotificationPrefRecord = { id: randomUUID(), ...o, ...p, createdAt: now, updatedAt: now };
      prefs.push(row);
      return row;
    },
  };
  return { store, subs, prefs };
}

function callerFor(t: Tenant, role: Session['role'] = 'owner') {
  return appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } } as AppContext);
}
const sub = (endpoint: string) => ({ endpoint, keys: { p256dh: 'BPk1aaaaaaaaaaaaaaaaaaaa', auth: 'authAAAAAAAA' }, userAgent: 'test' });
const EP_A = 'https://fcm.googleapis.com/fcm/send/a-device';
const EP_B = 'https://fcm.googleapis.com/fcm/send/b-device';

let mem: ReturnType<typeof memoryStore>;
beforeEach(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  B = await seedTenant(db, 'B');
  mem = memoryStore();
  setPushStore(mem.store);
});
afterEach(() => setPushStore(null));
afterAll(() => resetDb(db));

describe('W3-03b push.* — cross-tenant', () => {
  it("A never counts, revokes or sees B's subscription", async () => {
    await callerFor(B).push.subscribe(sub(EP_B));
    await callerFor(A).push.subscribe(sub(EP_A));
    expect((await callerFor(A).push.status()).devices).toBe(1);
    expect(await callerFor(A).push.unsubscribe({ endpoint: EP_B })).toEqual({ removed: false });
    expect(mem.subs.find((s) => s.endpoint === EP_B)?.revokedAt).toBeNull();
    expect(mem.subs.every((s) => (s.endpoint === EP_A ? s.restaurantId === A.restaurantId : s.restaurantId === B.restaurantId))).toBe(true);
  });

  it("A's switches never change B's", async () => {
    await callerFor(B).push.setPref({ eventKind: 'approval.waiting', channel: 'push', enabled: true });
    await callerFor(A).push.setPref({ eventKind: 'approval.waiting', channel: 'push', enabled: false });
    const b = await callerFor(B).push.status();
    expect(b.events.find((e) => e.kind === 'approval.waiting')?.push).toBe(true);
    const a = await callerFor(A).push.status();
    expect(a.events.find((e) => e.kind === 'approval.waiting')?.push).toBe(false);
    expect(mem.prefs.filter((p) => p.restaurantId === B.restaurantId).every((p) => p.enabled)).toBe(true);
  });

  it('a role switches only its own events; the receiver never gets money events', async () => {
    expect(eventsForRole('receiver')).not.toContain('approval.waiting');
    expect(eventsForRole('receiver')).not.toContain('claim.overdue');
    await expect(callerFor(A, 'receiver').push.setPref({ eventKind: 'approval.waiting', channel: 'push', enabled: false })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const r = await callerFor(A, 'receiver').push.status();
    expect(r.events.map((e) => e.kind)).toEqual(eventsForRole('receiver'));
  });

  it('rejects a non-https endpoint and malformed keys', async () => {
    await expect(callerFor(A).push.subscribe(sub('http://evil.test/x'))).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      callerFor(A).push.subscribe({ endpoint: EP_A, keys: { p256dh: 'not base64!!', auth: 'x' }, userAgent: null }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mem.subs).toHaveLength(0);
  });

  it('without H-03 storage: reads say unavailable, writes refuse, a test push is skipped, never sent', async () => {
    setPushStore(null);
    const s = await callerFor(A).push.status();
    expect(s.available).toBe(false);
    expect(s.devices).toBe(0);
    await expect(callerFor(A).push.subscribe(sub(EP_A))).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    await expect(callerFor(A).push.setPref({ eventKind: 'approval.waiting', channel: 'push', enabled: false })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    expect(await callerFor(A).push.test()).toEqual({ status: 'skipped_no_provider' });
  });
});
