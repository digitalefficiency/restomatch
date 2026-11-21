import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, eq, notificationsOutbox, restaurants, testDbUrl } from '@restomatch/db';
import { EmailNotifier } from '../email';
import { WhatsAppCloudNotifier } from '../whatsappCloud';
import { inviteEmail, magicLinkEmail, passwordResetEmail } from '../templates';
import type { NotificationPayload } from '../types';

/**
 * The notifiers that send INLINE (Resend email, WhatsApp Cloud) hold a staff
 * alert that lands in quiet hours / Shabbat / over the daily cap: the row is
 * only enqueued, due at the next allowed instant, and the dispatcher delivers
 * it. Transactional mail is never held. November 2026 is IST (UTC+2).
 */
const db = createDb(process.env.DATABASE_URL ?? testDbUrl());
let restaurantId = '';
const tag = `${process.pid}`;
const MANAGER = `manager-${tag}@example.com`;

const TUE_2330 = new Date('2026-11-03T21:30:00Z');
const WED_0600 = new Date('2026-11-04T04:00:00Z');
const WED_1000 = new Date('2026-11-04T08:00:00Z');
const FRI_1600 = new Date('2026-11-06T14:00:00Z');
const SAT_1900 = new Date('2026-11-07T17:00:00Z');

const rows = () => db.select().from(notificationsOutbox).where(eq(notificationsOutbox.restaurantId, restaurantId));

function mailer(at: Date) {
  const dispatch = vi.fn(async (_p: NotificationPayload) => ({ externalId: 're_test' }));
  return { dispatch, notifier: new EmailNotifier(dispatch, () => at) };
}

const staffAlert = (extra: Partial<NotificationPayload> = {}): NotificationPayload => ({
  restaurantId,
  channel: 'email',
  target: MANAGER,
  subject: 'דוח סוף יום',
  body: 'סיכום היום',
  relatedEntityType: 'restaurant',
  relatedEntityId: restaurantId,
  dedupeKey: `eod-report:${restaurantId}:2026-11-03:${MANAGER}`,
  ...extra,
});

beforeAll(async () => {
  const [r] = await db.insert(restaurants).values({ name: `Notifier window ${tag}` }).returning({ id: restaurants.id });
  restaurantId = r!.id;
});
beforeEach(async () => {
  delete process.env.NOTIFY_SHABBAT_WINDOW;
  await db.delete(notificationsOutbox).where(eq(notificationsOutbox.restaurantId, restaurantId));
});
afterEach(() => {
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await db.delete(notificationsOutbox).where(eq(notificationsOutbox.restaurantId, restaurantId));
  await db.delete(restaurants).where(eq(restaurants.id, restaurantId));
});

describe('EmailNotifier with a real sender — staff alerts', () => {
  it('23:30: enqueued only, due 06:00, dedupe key kept; the next cron run cannot make a second message', async () => {
    const { dispatch, notifier } = mailer(TUE_2330);
    expect(await notifier.send(db, staffAlert())).toEqual({ ok: true });
    expect(dispatch).not.toHaveBeenCalled();
    const [row] = await rows();
    expect(row).toMatchObject({ status: 'queued', attemptCount: 0, scheduledAt: WED_0600, dedupeKey: staffAlert().dedupeKey });

    // The job runs again (retry / next tick) with the same alert: swallowed by the dedupe key.
    const again = mailer(TUE_2330);
    expect(await again.notifier.send(db, staffAlert())).toEqual({ ok: true });
    // Even inside an open window a deduped enqueue never sends inline: the held row is the message.
    const open = mailer(WED_1000);
    await open.notifier.send(db, staffAlert());
    expect(again.dispatch).not.toHaveBeenCalled();
    expect(open.dispatch).not.toHaveBeenCalled();
    expect(await rows()).toHaveLength(1);
  });

  it('Fri 16:00 (Shabbat): due Sat 19:00', async () => {
    const { dispatch, notifier } = mailer(FRI_1600);
    await notifier.send(db, staffAlert({ relatedEntityType: 'match_run', dedupeKey: undefined }));
    expect(dispatch).not.toHaveBeenCalled();
    expect((await rows())[0]).toMatchObject({ status: 'queued', scheduledAt: SAT_1900 });
  });

  it('an open window sends inline as before', async () => {
    const { dispatch, notifier } = mailer(WED_1000);
    expect(await notifier.send(db, staffAlert())).toEqual({ ok: true, externalId: 're_test' });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect((await rows())[0]!.status).toBe('sent');
  });

  it('the 7th alert of the day to the same person is due the next 06:00', async () => {
    for (let i = 0; i < 6; i++) {
      await db.insert(notificationsOutbox).values({
        restaurantId, channel: 'email', target: MANAGER, body: 'x', status: 'sent',
        relatedEntityType: 'price_alert', sentAt: new Date(`2026-11-04T05:0${i}:00Z`),
      });
    }
    const { dispatch, notifier } = mailer(WED_1000);
    await notifier.send(db, staffAlert({ dedupeKey: `eod-report:${restaurantId}:2026-11-04:${MANAGER}` }));
    expect(dispatch).not.toHaveBeenCalled();
    const held = (await rows()).find((r) => r.status === 'queued');
    expect(held?.scheduledAt).toEqual(new Date('2026-11-05T04:00:00Z'));
  });
});

describe('transactional mail is never held (23:30, on Shabbat, over the cap)', () => {
  const url = 'https://restomatchrrr.vercel.app/x?token=t';
  const types: Array<[string, () => NotificationPayload]> = [
    ['password reset', () => ({ restaurantId, channel: 'email', target: MANAGER, ...pick(passwordResetEmail({ url, locale: 'he' })) })],
    ['magic link', () => ({ restaurantId, channel: 'email', target: MANAGER, ...pick(magicLinkEmail({ url, locale: 'he' })) })],
    ['invite', () => ({ restaurantId, channel: 'email', target: MANAGER, ...pick(inviteEmail({ url, locale: 'he', restaurantName: 'ציקטי', roleLabel: 'מנהל', inviterName: 'רום' })) })],
    ['2FA code', () => ({ restaurantId, channel: 'email', target: MANAGER, subject: 'קוד אימות', body: 'הקוד שלך: 123456' })],
    ['email verification', () => ({ restaurantId, channel: 'email', target: MANAGER, subject: 'אימות כתובת', body: url, relatedEntityType: 'user' })],
    ['supplier PO the user sent', () => ({
      restaurantId, channel: 'email', target: `orders-${tag}@supplier.example.com`, subject: 'הזמנה', body: 'הזמנה לספק',
      relatedEntityType: 'purchase_order', relatedEntityId: restaurantId, dedupeKey: `po:${tag}:placed`,
    })],
  ];

  beforeEach(async () => {
    // The person is already over today's cap: transactional mail still goes.
    for (let i = 0; i < 7; i++) {
      await db.insert(notificationsOutbox).values({
        restaurantId, channel: 'email', target: MANAGER, body: 'x', status: 'sent',
        relatedEntityType: 'restaurant', sentAt: new Date('2026-11-03T08:00:00Z'),
      });
    }
  });

  for (const [name, payload] of types) {
    it(`${name}: sent at once`, async () => {
      const times = [TUE_2330, FRI_1600, new Date('2026-11-03T10:00:00Z')];
      for (const [i, at] of times.entries()) {
        const { dispatch, notifier } = mailer(at);
        const p = payload();
        // A distinct PO per run (one PO is sent once; its key would dedupe the second).
        const res = await notifier.send(db, p.dedupeKey ? { ...p, dedupeKey: `po:${tag}-${i}:placed` } : p);
        expect(res.ok).toBe(true);
        expect(dispatch).toHaveBeenCalledTimes(1);
      }
    });
  }
});

describe('WhatsAppCloudNotifier — staff alerts', () => {
  const fetchStub = vi.fn(async () => new Response('{"messages":[{"id":"wamid.1"}]}', { status: 200 }));
  const wa = (at: Date) => new WhatsAppCloudNotifier({ phoneNumberId: 'pn', accessToken: 'tok' }, () => at);
  const alert = (): NotificationPayload => ({
    restaurantId, channel: 'whatsapp', target: 'role:manager', subject: 'דרושה החלטה', body: '3 חריגות',
    relatedEntityType: 'match_run', relatedEntityId: restaurantId,
  });

  beforeEach(() => {
    fetchStub.mockClear();
    vi.stubGlobal('fetch', fetchStub);
  });

  it('on Shabbat: no API call, the row is due Sat 19:00', async () => {
    expect(await wa(FRI_1600).send(db, alert())).toEqual({ ok: true });
    expect(fetchStub).not.toHaveBeenCalled();
    expect((await rows())[0]).toMatchObject({ status: 'queued', scheduledAt: SAT_1900 });
  });

  it('an open window sends inline as before', async () => {
    expect(await wa(WED_1000).send(db, alert())).toEqual({ ok: true, externalId: 'wamid.1' });
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('a deduped enqueue (the alert is already in flight) never calls the API again', async () => {
    const keyed = { ...alert(), dedupeKey: `monthly-report:${restaurantId}:2026-10:whatsapp` };
    await wa(FRI_1600).send(db, keyed); // held
    await wa(WED_1000).send(db, keyed); // the next run: deduped
    expect(fetchStub).not.toHaveBeenCalled();
    expect(await rows()).toHaveLength(1);
  });
});

function pick(e: { subject: string; text: string; html: string }) {
  return { subject: e.subject, body: e.text, html: e.html };
}
