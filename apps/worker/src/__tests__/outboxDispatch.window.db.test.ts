import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDb,
  DEMO_EMAIL_DOMAIN,
  eq,
  inArray,
  memberships,
  notificationsOutbox,
  restaurants,
  sql,
  testDbUrl,
  users,
} from '@restomatch/db';
import {
  DEMO_EMAIL_DOMAIN_FOR_SENDING,
  MockWhatsAppNotifier,
  SKIPPED_NO_PROVIDER,
  recipientsForRestaurant,
  resetSendWindowWarnings,
} from '@restomatch/api';
import { processOutboxDispatch, SKIPPED_UNDELIVERABLE } from '../jobs/outboxDispatch';
import type { WorkerJob } from '../queue';

/**
 * The dispatcher enforces the owner's rules for staff alerts: no alert
 * 23:00–06:00 or on Shabbat (Fri 15:00 → Sat 19:00), at most 6 per person per
 * Israel day. A held row waits in `queued` — no attempt used, never dropped.
 * November 2026 is IST (UTC+2).
 */
process.env.DATABASE_URL ??= testDbUrl();
const db = createDb(process.env.DATABASE_URL);

const KEYS = ['RESEND_API_KEY', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN', 'NOTIFY_SHABBAT_WINDOW'] as const;
let saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};
let restaurantId = '';
const tag = `${process.pid}`;
const ALICE = `alice-${tag}@example.com`;
const BOB = `bob-${tag}@example.com`;
const SUPPLIER = `orders-${tag}@supplier.example.com`;

const job = (now: string): WorkerJob<{ now: string }> => ({
  id: 'test',
  name: 'outbox-dispatch',
  data: { now },
  attemptsMade: 0,
  opts: { attempts: 1 },
});

/** Resend answers 200 for every send; the stub records who was sent to. */
let sentTo: string[] = [];
let resendStatus = 200;
let resendBody = '{"id":"re_1"}';
const fetchStub = vi.fn(async (_url: unknown, init?: { body?: string }) => {
  const to = JSON.parse(init?.body ?? '{}').to as string;
  if (resendStatus === 200) sentTo.push(to);
  return new Response(resendStatus === 200 ? resendBody : resendBody.replace('$TO', to), { status: resendStatus });
});

async function alert(target: string, scheduledAt: string, extra: Partial<typeof notificationsOutbox.$inferInsert> = {}) {
  const [row] = await db
    .insert(notificationsOutbox)
    .values({
      restaurantId,
      channel: 'email',
      target,
      subject: 'התראה',
      body: 'גוף',
      status: 'queued',
      relatedEntityType: 'restaurant',
      scheduledAt: new Date(scheduledAt),
      ...extra,
    })
    .returning();
  return row!;
}

const rowOf = async (id: string) =>
  (await db.select().from(notificationsOutbox).where(eq(notificationsOutbox.id, id)))[0]!;

beforeAll(async () => {
  const [r] = await db.insert(restaurants).values({ name: `Send window ${tag}` }).returning({ id: restaurants.id });
  restaurantId = r!.id;
});

beforeEach(async () => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  process.env.RESEND_API_KEY = 're_test_dummy';
  sentTo = [];
  resendStatus = 200;
  resendBody = '{"id":"re_1"}';
  fetchStub.mockClear();
  vi.stubGlobal('fetch', fetchStub);
  // The claim takes every due queued row in the DB: start each case from none.
  await db.execute(sql`DELETE FROM ${notificationsOutbox} WHERE status IN ('queued', 'sending')`);
  await db.delete(notificationsOutbox).where(eq(notificationsOutbox.restaurantId, restaurantId));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetSendWindowWarnings();
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

afterAll(async () => {
  await db.delete(notificationsOutbox).where(eq(notificationsOutbox.restaurantId, restaurantId));
  await db.delete(restaurants).where(eq(restaurants.id, restaurantId));
});

describe('quiet hours and Shabbat', () => {
  it('Tue 23:30: a staff alert waits for 06:00 with its attempt count and last error kept; a PO send goes now', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const held = await alert(ALICE, '2026-11-03T21:00:00Z', { attemptCount: 2, lastError: 'Resend HTTP send failed (503)' });
    const po = await alert(SUPPLIER, '2026-11-03T21:00:00Z', {
      relatedEntityType: 'purchase_order',
      relatedEntityId: '00000000-0000-4000-8000-0000000000aa',
      dedupeKey: `po:${tag}-quiet:placed`,
    });

    const r = await processOutboxDispatch(job('2026-11-03T21:30:00Z'));

    expect(r).toMatchObject({ dispatched: 1, deferred: { quiet: 1, shabbat: 0, cap: 0 } });
    const h = await rowOf(held.id);
    expect(h).toMatchObject({ status: 'queued', attemptCount: 2, lastError: 'Resend HTTP send failed (503)', claimedAt: null });
    expect(h.scheduledAt).toEqual(new Date('2026-11-04T04:00:00Z'));
    expect((await rowOf(po.id)).status).toBe('sent');
    expect(sentTo).toEqual([SUPPLIER]);
    expect(log).toHaveBeenCalledWith('[outbox-dispatch] deferred quiet=1 shabbat=0 cap=0');
  });

  it('Fri 15:01 waits for Sat 19:00 (no attempt used); Sat 19:00 delivers it', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const held = await alert(ALICE, '2026-11-06T13:00:00Z');

    const fri = await processOutboxDispatch(job('2026-11-06T13:01:00Z'));
    expect(fri).toMatchObject({ dispatched: 0, deferred: { quiet: 0, shabbat: 1, cap: 0 } });
    expect(await rowOf(held.id)).toMatchObject({ status: 'queued', attemptCount: 0, scheduledAt: new Date('2026-11-07T17:00:00Z') });

    // Sat 18:59: not due yet — not even claimed.
    expect(await processOutboxDispatch(job('2026-11-07T16:59:00Z'))).toEqual({ dispatched: 0, failed: 0 });

    const sat = await processOutboxDispatch(job('2026-11-07T17:00:00Z'));
    expect(sat).toMatchObject({ dispatched: 1 });
    expect(await rowOf(held.id)).toMatchObject({ status: 'sent', attemptCount: 0, sentAt: new Date('2026-11-07T17:00:00Z') });
  });
});

describe('at most 6 staff alerts per person per day', () => {
  it('the 7th alert of the day waits for the next 06:00; another person is counted on their own', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const alice = [];
    for (let i = 0; i < 7; i++) alice.push(await alert(ALICE, `2026-11-04T07:0${i}:00Z`));
    const bob = await alert(BOB, '2026-11-04T07:30:00Z');

    const r = await processOutboxDispatch(job('2026-11-04T08:00:00Z')); // Wed 10:00
    expect(r).toMatchObject({ dispatched: 7, deferred: { quiet: 0, shabbat: 0, cap: 1 } });
    const seventh = await rowOf(alice[6]!.id);
    expect(seventh).toMatchObject({ status: 'queued', attemptCount: 0, scheduledAt: new Date('2026-11-05T04:00:00Z') });
    for (const a of alice.slice(0, 6)) expect((await rowOf(a.id)).status).toBe('sent');
    expect((await rowOf(bob.id)).status).toBe('sent');
  });

  it('counts alerts already sent earlier today, and an exempt PO send is not counted', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    for (let i = 0; i < 6; i++) {
      await alert(ALICE, '2026-11-04T05:00:00Z', { status: 'sent', sentAt: new Date(`2026-11-04T05:0${i}:00Z`) });
    }
    // Yesterday's alerts do not count toward today.
    await alert(ALICE, '2026-11-03T08:00:00Z', { status: 'sent', sentAt: new Date('2026-11-03T08:00:00Z') });
    const po = await alert(ALICE, '2026-11-04T07:00:00Z', {
      relatedEntityType: 'purchase_order',
      dedupeKey: `po:${tag}-cap:placed`,
    });
    const next = await alert(ALICE, '2026-11-04T07:00:00Z');

    const r = await processOutboxDispatch(job('2026-11-04T08:00:00Z'));
    expect(r).toMatchObject({ dispatched: 1, deferred: { cap: 1 } });
    expect((await rowOf(po.id)).status).toBe('sent');
    expect(await rowOf(next.id)).toMatchObject({ status: 'queued', scheduledAt: new Date('2026-11-05T04:00:00Z') });
  });

  it('a cap deferral that lands on Shabbat moves on to Sat 19:00 and counts toward Saturday', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const fri = [];
    for (let i = 0; i < 8; i++) fri.push(await alert(ALICE, `2026-11-06T06:0${i}:00Z`));

    // Fri 10:00: 6 go, 2 wait — Sat 06:00 is inside Shabbat, so Sat 19:00.
    expect(await processOutboxDispatch(job('2026-11-06T08:00:00Z'))).toMatchObject({ dispatched: 6, deferred: { cap: 2 } });
    for (const late of fri.slice(6)) {
      expect(await rowOf(late.id)).toMatchObject({ status: 'queued', scheduledAt: new Date('2026-11-07T17:00:00Z') });
    }

    // Five more for Saturday 19:00: the 2 carried over go first, then 4 more; the 7th waits for Sunday 06:00.
    const sat = [];
    for (let i = 0; i < 5; i++) sat.push(await alert(ALICE, '2026-11-07T17:00:30Z'));
    expect(await processOutboxDispatch(job('2026-11-07T17:01:00Z'))).toMatchObject({ dispatched: 6, deferred: { cap: 1 } });
    for (const late of fri.slice(6)) expect((await rowOf(late.id)).status).toBe('sent');
    const waiting = (await Promise.all(sat.map((s) => rowOf(s.id)))).filter((s) => s.status === 'queued');
    expect(waiting).toHaveLength(1);
    expect(waiting[0]!.scheduledAt).toEqual(new Date('2026-11-08T04:00:00Z'));
  });
});

describe('failures are visible and never show the address', () => {
  it('one log line per failed row: 8-char id, channel, the redacted error', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    resendStatus = 422;
    resendBody = '{"message":"Invalid `to` field: $TO is not valid; call +972 50 123 4567"}';
    const row = await alert(ALICE, '2026-11-04T07:00:00Z');

    expect(await processOutboxDispatch(job('2026-11-04T08:00:00Z'))).toMatchObject({ dispatched: 0 });
    expect(err).toHaveBeenCalledTimes(1);
    const line = String(err.mock.calls[0]![0]);
    expect(line).toMatch(new RegExp(`^\\[outbox-dispatch\\] failed id=${row.id.slice(0, 8)} channel=email attempt=1/5 error="Resend HTTP send failed \\(422\\)`));
    expect(line).not.toContain('@');
    expect(line).not.toContain(ALICE);
    expect(line).not.toContain('123 4567');
    const error = line.slice(line.indexOf('error="') + 7, -1);
    expect(error.length).toBeLessThanOrEqual(160);
    // The row itself still carries the full error for the admin, and retries with backoff.
    expect(await rowOf(row.id)).toMatchObject({ status: 'queued', attemptCount: 1 });
  });
});

describe('undeliverable addresses never reach a real provider', () => {
  it('a .test / demo-domain target is parked, not handed to Resend', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const demo = await alert(`owner@${DEMO_EMAIL_DOMAIN}`, '2026-11-04T07:00:00Z');
    const test = await alert(`orders@supplier-${tag}.test`, '2026-11-04T07:00:00Z', {
      relatedEntityType: 'purchase_order',
      dedupeKey: `po:${tag}-test:placed`,
    });

    await processOutboxDispatch(job('2026-11-04T08:00:00Z'));
    expect(fetchStub).not.toHaveBeenCalled();
    for (const r of [demo, test]) {
      expect(await rowOf(r.id)).toMatchObject({ status: 'failed', lastError: SKIPPED_UNDELIVERABLE });
    }
  });

  it('the send-side copy of the demo domain matches packages/db', () => {
    expect(DEMO_EMAIL_DOMAIN_FOR_SENDING).toBe(DEMO_EMAIL_DOMAIN);
  });

  it('recipients drop demo and .test addresses when a real provider is configured', async () => {
    const emails = [`own-${tag}@example.com`, `mgr-${tag}@${DEMO_EMAIL_DOMAIN}`, `mgr2-${tag}@attack.test`];
    const made = await db.insert(users).values(emails.map((email) => ({ email }))).returning({ id: users.id });
    await db.insert(memberships).values(made.map((u, i) => ({ userId: u.id, restaurantId, role: i === 0 ? 'owner' : 'manager' } as const)));
    try {
      const withProvider = await recipientsForRestaurant(db, restaurantId, ['owner', 'manager'], { RESEND_API_KEY: 'x' });
      expect(withProvider.map((r) => r.email)).toEqual([emails[0]]);
      // No provider = nothing is sent: local runs and tests still see everyone.
      const without = await recipientsForRestaurant(db, restaurantId, ['owner', 'manager'], {});
      expect(without.map((r) => r.email).sort()).toEqual([...emails].sort());
    } finally {
      await db.delete(memberships).where(eq(memberships.restaurantId, restaurantId));
      await db.delete(users).where(inArray(users.email, emails));
    }
  });
});

describe('the WhatsApp mock in production', () => {
  it('parks the row as skipped_no_provider and never says "sent"', async () => {
    const res = await new MockWhatsAppNotifier(true).send(db, {
      restaurantId,
      channel: 'whatsapp',
      target: 'role:manager',
      body: 'דרושה החלטה',
      relatedEntityType: 'match_run',
    });
    expect(res).toEqual({ ok: false, error: SKIPPED_NO_PROVIDER });
    const [row] = await db.select().from(notificationsOutbox).where(eq(notificationsOutbox.restaurantId, restaurantId));
    expect(row).toMatchObject({ status: 'failed', lastError: SKIPPED_NO_PROVIDER, sentAt: null });
  });

  it('outside production it still simulates a send (local demos)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await new MockWhatsAppNotifier(false).send(db, {
      restaurantId,
      channel: 'whatsapp',
      target: 'role:manager',
      body: 'דרושה החלטה',
    });
    expect(res.ok).toBe(true);
  });
});
