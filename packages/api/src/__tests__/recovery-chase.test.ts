import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, creditNotes, eq, notificationsOutbox, recoveryClaims, recoveryEvents, suppliers, testDbUrl } from '@restomatch/db';
import { supplierReminderDraft, waPhoneE164, type DraftClaim } from '../recovery/chase';
import { DESK_CREDIT_SUGGESTIONS_PATH, DESK_REMINDERS_PATH, enqueueRecoveryReminders, recoveryReminderEmail } from '../recovery/reminders';
import { addClaim, addMember, setSettings } from './au03-helpers';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/** Owner 7.11 (W1/W2 + GLOSSARY §1–2): words that never reach a supplier, nor the digest about credits. */
const BANNED = ['דרישה', 'דרישת', 'דרישות', 'תביעה', 'חוב', 'חייבים', 'מחלוקת', 'באיחור', 'עליכם', 'לאלתר'];
const NOW = '2026-10-25T10:00:00.000Z';

const sent = (id: string, over: Partial<DraftClaim> = {}): DraftClaim => ({
  id,
  status: 'letter_sent',
  outstandingAgorot: 15_000,
  letterSentAt: '2026-10-12T09:00:00.000Z',
  claimedAt: '2026-10-11T09:00:00.000Z',
  discrepancyType: 'PRICE_HIGHER',
  ...over,
});
const base = {
  supplier: { name: 'ירקות השרון', contactWhatsapp: '052-123-4567', contactEmail: 'office@sharon.test' },
  restaurant: { name: 'ציקטי' },
  nowIso: NOW,
};

describe('AU-03 · supplierReminderDraft (pure)', () => {
  it('he: a small reminder with partner wording, ₪ before VAT, sent and reply-by dates', () => {
    const d = supplierReminderDraft({ ...base, claims: [sent('a'), sent('b', { outstandingAgorot: 5_150 })] })!;
    expect(d.variant).toBe('reminder');
    expect(d.text).toContain('שלום ירקות השרון, תזכורת קטנה לגבי בקשת הזיכוי ששלחנו ב-12.10');
    expect(d.text).toContain('2 שורות');
    expect(d.text).toMatch(/201\.50/);
    expect(d.text).toContain('לפני מע״מ');
    expect(d.text).toContain('חשבונית זיכוי');
    expect(d.text).toContain('עד 01.11');
    expect(d.text).toContain('תודה, ציקטי');
    for (const w of BANNED) expect(d.text, w).not.toContain(w);
    expect(d.claimIds).toEqual(['a', 'b']);
    expect(d.outstandingAgorot).toBe(20_150);
  });

  it('en variant', () => {
    const d = supplierReminderDraft({ ...base, locale: 'en', claims: [sent('a')] })!;
    expect(d.text).toMatch(/^Hi ירקות השרון, a small reminder about the credit request we sent on 12\.10/);
    expect(d.text).toContain('credit invoice');
    expect(d.text).not.toMatch(/overdue|owe|debt|dispute|claim/i);
  });

  it('pre-addressed: wa.me to the normalised 972 number and mailto to the supplier address, both encoded', () => {
    const d = supplierReminderDraft({ ...base, claims: [sent('a')] })!;
    expect(d.waHref!.startsWith('https://wa.me/972521234567?text=')).toBe(true);
    expect(decodeURIComponent(d.waHref!.split('?text=')[1]!)).toBe(d.text);
    expect(d.mailtoHref!.startsWith('mailto:office@sharon.test?subject=')).toBe(true);
    const q = new URLSearchParams(d.mailtoHref!.split('?')[1]!);
    expect(q.get('body')).toBe(d.text);
    expect(q.get('subject')).toBe(d.subject);
    expect(d.subject).toContain('תזכורת קטנה');
  });

  it('an invalid phone or e-mail gives null links (never the share picker)', () => {
    const d = supplierReminderDraft({ ...base, supplier: { name: 'X', contactWhatsapp: '123', contactEmail: 'not an email' }, claims: [sent('a')] })!;
    expect(d.waHref).toBeNull();
    expect(d.mailtoHref).toBeNull();
  });

  it('waPhoneE164 normalises Israeli forms and rejects junk', () => {
    expect(waPhoneE164('052-1234567')).toBe('972521234567');
    expect(waPhoneE164('+972 52 123 4567')).toBe('972521234567');
    expect(waPhoneE164('00972521234567')).toBe('972521234567');
    expect(waPhoneE164('03-6123456')).toBe('97236123456');
    expect(waPhoneE164('12345')).toBeNull();
    expect(waPhoneE164('')).toBeNull();
    expect(waPhoneE164(null)).toBeNull();
  });

  it('never lists MISSING_ON_INVOICE, and never reminds about a letter that was not sent', () => {
    const d = supplierReminderDraft({
      ...base,
      claims: [sent('a'), sent('moi', { discrepancyType: 'MISSING_ON_INVOICE' }), sent('u', { status: 'claimed', letterSentAt: null })],
    })!;
    expect(d.claimIds).toEqual(['a']);
    expect(supplierReminderDraft({ ...base, claims: [sent('u', { status: 'claimed', letterSentAt: null })] })).toBeNull();
    expect(supplierReminderDraft({ ...base, claims: [sent('moi', { discrepancyType: 'MISSING_ON_INVOICE' })] })).toBeNull();
  });

  it('acknowledged variant thanks the supplier and asks for the credit invoice', () => {
    const d = supplierReminderDraft({
      ...base,
      claims: [sent('a', { status: 'acknowledged', acknowledgedAt: '2026-10-14T09:00:00.000Z' })],
    })!;
    expect(d.variant).toBe('acknowledged');
    expect(d.text).toContain('תודה שאישרתם את בקשת הזיכוי מ-14.10');
    expect(d.text).toContain('חשבונית הזיכוי עוד לא הגיעה');
    for (const w of BANNED) expect(d.text, w).not.toContain(w);
  });

  it('a duplicate invoice (incl. VAT) drops the "before VAT" suffix', () => {
    const d = supplierReminderDraft({ ...base, claims: [sent('a', { discrepancyType: 'DUPLICATE_INVOICE' })] })!;
    expect(d.text).not.toContain('לפני מע״מ');
  });
});

describe('AU-03 · digest e-mail (pure)', () => {
  it('title, sections, per-supplier draft deep links through /dashboard/go; no banned words', () => {
    const e = recoveryReminderEmail({
      appUrl: 'https://app.test',
      restaurantId: 'r1',
      suppliers: [
        { supplierId: 's1', supplierName: 'ירקות', supplierNameEn: null, kind: 'no_reply', count: 2, outstandingAgorot: 20_150, oldestDays: 13, latestLetterAt: '2026-10-12T09:00:00Z' },
        { supplierId: 's1', supplierName: 'ירקות', supplierNameEn: null, kind: 'acknowledged', count: 1, outstandingAgorot: 1_000, oldestDays: 9, latestLetterAt: '2026-10-14T09:00:00Z' },
      ],
      creditSuggestions: { count: 1, agorot: 4_000 },
    });
    expect(e.subject).toMatch(/^בקשות זיכוי שממתינות 7\+ ימים · ספק אחד · /);
    expect(e.subject).toMatch(/211\.50/);
    expect(e.text).toContain('אין תשובה 7+ ימים');
    expect(e.text).toContain('ירקות · 2 בקשות · ');
    expect(e.text).toContain('מכתב נשלח 12.10');
    expect(e.text).toContain('הספק אישר · ממתינים לחשבונית זיכוי');
    // Train-C gate 11.11: a request whose letter never went out is never in a chase figure.
    expect(e.text).not.toContain('טרם נשלח מכתב');
    expect(e.text).toContain('זיכויים שמחכים לאישור: 1 · ');
    // Links land on the desk row that acts on them: the reminder drafts, and W3-11's credit suggestions.
    expect(e.text).toContain(`https://app.test/dashboard/go?r=r1&to=${encodeURIComponent(DESK_REMINDERS_PATH)}`);
    expect(e.text).toContain(`https://app.test/dashboard/go?r=r1&to=${encodeURIComponent(DESK_CREDIT_SUGGESTIONS_PATH)}`);
    expect(e.text).not.toContain('draft=1');
    for (const w of BANNED) {
      expect(e.subject, w).not.toContain(w);
      expect(e.text, w).not.toContain(w);
    }
  });
});

describe('AU-03 · 08:30 digest (DB)', () => {
  const db = createDb(testDbUrl());
  let T: Tenant;
  let ids: Record<string, string>;
  const now = new Date(NOW);
  const old = new Date('2026-10-10T08:00:00.000Z');

  beforeAll(async () => {
    await resetDb(db);
    T = await seedTenant(db, 'C');
    ids = {
      manager: await addMember(db, T, 'manager', 'c'),
      bookkeeper: await addMember(db, T, 'bookkeeper', 'c'),
      receiver: await addMember(db, T, 'receiver', 'c'),
      chef: await addMember(db, T, 'chef', 'c'),
    };
    await db.update(suppliers).set({ contactEmail: 'supplier@c.test', contactWhatsapp: '0521234567' } as never).where(eq(suppliers.id, T.supplierId));
  });
  beforeEach(async () => {
    await db.delete(notificationsOutbox).where(eq(notificationsOutbox.restaurantId, T.restaurantId));
    await db.delete(recoveryEvents).where(eq(recoveryEvents.restaurantId, T.restaurantId));
    await db.delete(recoveryClaims).where(eq(recoveryClaims.restaurantId, T.restaurantId));
    await db.delete(creditNotes).where(eq(creditNotes.restaurantId, T.restaurantId));
    await setSettings(db, T, { features: { all: true } });
  });
  afterAll(async () => {
    await resetDb(db);
  });

  const outbox = () => db.select().from(notificationsOutbox).where(eq(notificationsOutbox.restaurantId, T.restaurantId));

  it('owner + manager + bookkeeper (default on); never receiver or chef; never a supplier address', async () => {
    const c = await addClaim(db, T, { status: 'letter_sent', letterSentAt: old, claimedAt: old, amountAgorot: 4_500 });
    const r = await enqueueRecoveryReminders(db, { restaurantId: T.restaurantId, now, appUrl: 'https://app.test' });
    expect(r).toMatchObject({ restaurants: 1, emails: 3, claims: 1 });
    const rows = await outbox();
    const targets = rows.map((x) => x.target).sort();
    expect(targets).toEqual(['bookkeeper-c@au03.test', 'manager-c@au03.test', 'owner-C@attack.test'].sort());
    expect(rows.every((x) => x.target !== 'supplier@c.test' && !x.target.includes('972521234567'))).toBe(true);
    const keys = rows.map((x) => x.dedupeKey).sort();
    for (const k of keys) expect(k).toMatch(new RegExp(`^au:A12:${T.restaurantId}:[0-9a-f-]{36}:2026-10-25$`));
    expect(keys.some((k) => k!.includes(ids.receiver!) || k!.includes(ids.chef!))).toBe(false);
    const [claim] = await db.select().from(recoveryClaims).where(eq(recoveryClaims.id, c));
    expect(claim!.lastReminderAt?.toISOString()).toBe(NOW);
  });

  it('bookkeeper opt-out (automations.recoveryBookkeeper = false) → owner + manager only', async () => {
    await setSettings(db, T, { features: { all: true }, automations: { recoveryBookkeeper: false } });
    await addClaim(db, T, { status: 'letter_sent', letterSentAt: old, claimedAt: old });
    await enqueueRecoveryReminders(db, { restaurantId: T.restaurantId, now });
    expect((await outbox()).map((x) => x.target).sort()).toEqual(['manager-c@au03.test', 'owner-C@attack.test'].sort());
  });

  it('a same-day replay adds nothing; a claim chased < 7 days ago alone sends nothing', async () => {
    await addClaim(db, T, { status: 'letter_sent', letterSentAt: old, claimedAt: old });
    await enqueueRecoveryReminders(db, { restaurantId: T.restaurantId, now });
    const again = await enqueueRecoveryReminders(db, { restaurantId: T.restaurantId, now: new Date('2026-10-25T14:00:00Z') });
    expect(again.emails).toBe(0);
    expect(await outbox()).toHaveLength(3);
  });

  it('the digest lists every waiting claim (count and ₪ = the home row), stamps them all', async () => {
    const fresh = await addClaim(db, T, { status: 'letter_sent', letterSentAt: old, claimedAt: old, amountAgorot: 1_000 });
    const chased = await addClaim(db, T, {
      status: 'letter_sent',
      letterSentAt: old,
      claimedAt: old,
      amountAgorot: 2_000,
      lastReminderAt: new Date('2026-10-22T06:30:00Z'),
    });
    const unrelated = await addClaim(db, T, { status: 'letter_sent', letterSentAt: new Date('2026-10-24T08:00:00Z'), claimedAt: old });
    await enqueueRecoveryReminders(db, { restaurantId: T.restaurantId, now });
    const [row] = await outbox();
    expect(row!.body).toContain('2 בקשות');
    expect(row!.body).toMatch(/30\.00/);
    const stamped = await db.select({ id: recoveryClaims.id, at: recoveryClaims.lastReminderAt }).from(recoveryClaims).where(eq(recoveryClaims.restaurantId, T.restaurantId));
    const at = Object.fromEntries(stamped.map((s) => [s.id, s.at?.toISOString() ?? null]));
    expect(at[fresh]).toBe(NOW);
    expect(at[chased]).toBe(NOW);
    expect(at[unrelated]).toBeNull();
  });

  it('quiet hours / Shabbat (sendWindow): the digest row is a staff alert, held on Shabbat 08:30, open on a weekday', async () => {
    const { isStaffAlert, staffAlertWindow } = await import('../notifications/sendWindow');
    await addClaim(db, T, { status: 'letter_sent', letterSentAt: old, claimedAt: old });
    const sat = new Date('2026-11-14T06:30:00Z'); // Sat 14.11 08:30 IL
    await enqueueRecoveryReminders(db, { restaurantId: T.restaurantId, now: sat });
    const rows = await outbox();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(isStaffAlert(r), r.dedupeKey ?? '').toBe(true);
    const held = staffAlertWindow(sat);
    expect(held).toMatchObject({ open: false, reason: 'shabbat' });
    // Released at the end of Shabbat (Sat 19:00 IL = 17:00Z in November), never at 08:30 on Saturday.
    expect((held as { nextAllowedAt: Date }).nextAllowedAt.toISOString()).toBe('2026-11-14T17:00:00.000Z');
    expect(staffAlertWindow(new Date('2026-11-16T06:30:00Z'))).toEqual({ open: true }); // Mon 08:30 IL
  });

  it('recovery flag off → no digest', async () => {
    await setSettings(db, T, { features: {} });
    await addClaim(db, T, { status: 'letter_sent', letterSentAt: old, claimedAt: old });
    expect((await enqueueRecoveryReminders(db, { restaurantId: T.restaurantId, now })).restaurants).toBe(0);
    expect(await outbox()).toHaveLength(0);
  });
});

describe('AU-03 · validEmail (linear, CodeQL js/polynomial-redos)', () => {
  it('accepts a plain address, rejects junk, and stays fast on adversarial input', async () => {
    const { validEmail } = await import('../recovery/chase');
    expect(validEmail(' office@sharon.test ')).toBe('office@sharon.test');
    for (const bad of ['', 'a@b', '@b.c', 'a@@b.c', 'a@b.c.', 'a b@c.d', 'a@.c', 'a"@b.c']) expect(validEmail(bad), bad).toBeNull();
    const evil = '!@!.' + '!.'.repeat(50_000);
    const t = Date.now();
    validEmail(evil);
    expect(Date.now() - t).toBeLessThan(50);
  });
});
