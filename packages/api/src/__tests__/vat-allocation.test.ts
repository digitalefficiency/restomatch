import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { and, auditLog, createDb, eq, invoices, notificationsOutbox, restaurants, suppliers } from '@restomatch/db';
import { appRouter } from '../index';
import { router } from '../trpc';
import type { AppContext, Session } from '../context';
import { vatRouter } from '../routers/vat';
import {
  allocationDeadlineItems,
  allocationRequestDraft,
  allocationRequestText,
  cleanEmail,
  deadlineBucket,
  waDigits,
} from '../vat/allocationCase';
import { israelDay, normaliseAllocationNumber, stageFor } from '../vat/caseState';
import { ITA_VERIFY_URL, itaVerifyFields } from '../vat/itaVerify';
import { vatAtRisk } from '../vat/vatAtRisk';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/** AU-08 (A13): allocation-number guard and chase. */

// `vat` is mounted locally until its appRouter line lands (orchestrator-serialised).
const testRouter = router({ vat: vatRouter });

const db = createDb(testDbUrl());
let A: Tenant;
const TODAY = israelDay(new Date());
const dayOffset = (n: number) => {
  const d = new Date(`${TODAY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000);

async function invoice(
  t: Tenant,
  v: { day: string; exVat: string; vat?: string | null; alloc?: string | null; supplierId?: string; number?: string | null; duplicateOf?: string },
) {
  const [row] = await db
    .insert(invoices)
    .values({
      restaurantId: t.restaurantId,
      supplierId: v.supplierId ?? t.supplierId,
      invoiceNumber: v.number === null ? null : (v.number ?? `AL-${Math.random().toString(36).slice(2, 10)}`),
      invoiceDate: new Date(`${v.day}T10:00:00+03:00`),
      totalExclVat: v.exVat,
      vatAmount: v.vat === undefined ? null : v.vat,
      allocationNumber: v.alloc ?? null,
      status: 'parsed',
      source: 'photo',
      ocrPayload: v.duplicateOf ? ({ raw: { duplicateOf: { invoiceId: v.duplicateOf, invoiceNumber: 'X-1' } } } as never) : null,
    })
    .returning({ id: invoices.id });
  return row!.id;
}

function callerFor(t: Tenant, role: Session['role'] = 'owner') {
  const session: Session = { userId: t.ownerUserId, restaurantId: t.restaurantId, role };
  const ctx: AppContext = { db, session };
  return { app: appRouter.createCaller(ctx), vat: testRouter.createCaller(ctx).vat };
}

const cmid = () => `cm-${Math.random().toString(36).slice(2, 12)}`;

describe('AU-08 pure helpers', () => {
  it('normalises the printed number and checks the format only', () => {
    expect(normaliseAllocationNumber(' 123-456 789 ')).toBe('123456789');
    expect(normaliseAllocationNumber('12345678')).toBeNull();
    expect(normaliseAllocationNumber('12345678a')).toBeNull();
  });

  it('stage precedence: expired > closing > overdue request > requested > new', () => {
    const t = '2026-11-20';
    expect(stageFor({ daysLeft: -1, requestedAt: null, todayIso: t })).toBe('expired');
    expect(stageFor({ daysLeft: 14, requestedAt: '2026-11-01T08:00:00Z', todayIso: t })).toBe('closing');
    expect(stageFor({ daysLeft: 60, requestedAt: '2026-11-12T08:00:00Z', todayIso: t })).toBe('overdue_request'); // 8 days
    expect(stageFor({ daysLeft: 60, requestedAt: '2026-11-13T08:00:00Z', todayIso: t })).toBe('requested'); // 7 days
    expect(stageFor({ daysLeft: 60, requestedAt: null, todayIso: t })).toBe('new');
  });

  it('deadline buckets 30/14/7/3/1 (a missed day still lands in the next bucket once)', () => {
    expect(deadlineBucket(31)).toBeNull();
    expect(deadlineBucket(30)).toBe(30);
    expect(deadlineBucket(15)).toBe(30);
    expect(deadlineBucket(14)).toBe(14);
    expect(deadlineBucket(8)).toBe(14);
    expect(deadlineBucket(7)).toBe(7);
    expect(deadlineBucket(3)).toBe(3);
    expect(deadlineBucket(1)).toBe(1);
    expect(deadlineBucket(0)).toBe(1);
    expect(deadlineBucket(-1)).toBeNull();
  });

  it('wa.me digits only from a plausible Israeli number; mailto only from an e-mail', () => {
    expect(waDigits('054-123 4567')).toBe('972541234567');
    expect(waDigits('+972 54 1234567')).toBe('972541234567');
    expect(waDigits('03-6123456')).toBe('97236123456');
    for (const bad of [null, '', '12345', '054-123', '+1 212 555 0100', 'abc']) expect(waDigits(bad), String(bad)).toBeNull();
    expect(cleanEmail(' orders@supplier.co.il ')).toBe('orders@supplier.co.il');
    expect(cleanEmail('not-an-email')).toBeNull();
    expect(cleanEmail('a@b.co, c@d.co')).toBeNull();
  });

  it('request text: Hebrew, partner tone, ₪ before VAT per invoice, the deadline date', () => {
    const text = allocationRequestText({
      supplierName: 'טרי בע״מ',
      restaurantName: 'ציקטי',
      invoices: [{ invoiceNumber: '881', invoiceDate: '2026-10-05', totalExclVat: 6000, deductionDeadline: '2027-04-05' }],
    });
    expect(text).toContain('שלום טרי בע״מ');
    expect(text).toContain('מס׳ 881');
    expect(text).toContain('05.10.2026');
    expect(text).toMatch(/6,000\.00.*₪|₪.*6,000\.00/);
    expect(text).toContain('לפני 05.04.2027');
    for (const banned of ['דרישה', 'תביעה', 'מחלוקת', 'חוב', 'באיחור', 'דליפה']) expect(text).not.toContain(banned);
  });

  it('reminder text: a small, polite chase that names the earlier request and keeps the facts', () => {
    const inv = [{ invoiceNumber: '881', invoiceDate: '2026-10-05', totalExclVat: 6000, deductionDeadline: '2027-04-05' }];
    const text = allocationRequestText({ supplierName: 'טרי בע״מ', restaurantName: 'ציקטי', invoices: inv, kind: 'reminder', requestedOn: '2026-10-20' });
    expect(text).toContain('תזכורת קטנה');
    expect(text).toContain('ב-20.10.2026');
    expect(text).toContain('מס׳ 881');
    expect(text).toContain('לפני 05.04.2027');
    expect(text).toContain('תודה');
    for (const banned of ['דרישה', 'תביעה', 'מחלוקת', 'חוב', 'באיחור', 'דליפה']) expect(text).not.toContain(banned);
    // The first ask is unchanged when kind is omitted.
    expect(allocationRequestText({ supplierName: 'טרי בע״מ', restaurantName: 'ציקטי', invoices: inv })).not.toContain('תזכורת');
  });

  it('ITA fields: six copy-ready values in order; URL not guessed', () => {
    const f = itaVerifyFields(
      { allocationNumber: '123-456-789', invoiceNumber: '881', invoiceDate: '2026-10-05', totalExclVat: 6000, vatAmount: 1080 },
      { businessId: '512345671' },
    );
    expect(f.map((x) => x.labelHe)).toEqual(['מספר הקצאה', 'ח״פ ספק', 'מספר חשבונית', 'תאריך', 'סכום לפני מע״מ', 'מע״מ']);
    expect(f.map((x) => x.value)).toEqual(['123456789', '512345671', '881', '05/10/2026', '6000.00', '1080.00']);
    expect(itaVerifyFields({ allocationNumber: null, invoiceNumber: null, invoiceDate: '2026-10-05', totalExclVat: 6000, vatAmount: null }, null)[1]!.value).toBeNull();
    expect(ITA_VERIFY_URL).toBeNull();
  });
});

describe('AU-08 allocation case (DB)', () => {
  beforeEach(async () => {
    await resetDb(db);
    A = await seedTenant(db, 'A');
    await db
      .update(restaurants)
      .set({ settings: { features: { vatAtRisk: true, payRun: true } } as never })
      .where(eq(restaurants.id, A.restaurantId));
  });
  afterAll(async () => {
    await resetDb(db);
  });

  it('setAllocationNumber: the row leaves vatAtRisk(); one audit row; replay returns the recorded result', async () => {
    const id = await invoice(A, { day: dayOffset(-10), exVat: '6000.00', vat: '1080.00' });
    const { vat } = callerFor(A);
    expect((await vatAtRisk(db, A.restaurantId, 'open')).rows.map((r) => r.invoiceId)).toEqual([id]);
    const m = cmid();
    const res = await vat.setAllocationNumber({ invoiceId: id, allocationNumber: '123 456 789', source: 'typed', clientMutationId: m });
    expect(res).toEqual({ invoiceId: id, allocationNumber: '123456789', replayed: false });
    expect((await vatAtRisk(db, A.restaurantId, 'open')).count).toBe(0);
    const [inv] = await db.select({ a: invoices.allocationNumber }).from(invoices).where(eq(invoices.id, id));
    expect(inv!.a).toBe('123456789');

    const again = await vat.setAllocationNumber({ invoiceId: id, allocationNumber: '999999999', source: 'typed', clientMutationId: m });
    expect(again).toEqual({ invoiceId: id, allocationNumber: '123456789', replayed: true });
    const audits = await db.select().from(auditLog).where(and(eq(auditLog.restaurantId, A.restaurantId), eq(auditLog.action, 'vat.allocation_set')));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      entityType: 'invoice',
      entityId: id,
      before: { allocationNumber: null },
      after: { allocationNumber: '123456789', source: 'typed', automationId: 'A13' },
    });
  });

  it('invoiceCase reports the stored number and its format state, at risk or not', async () => {
    const { vat } = callerFor(A);
    const bad = await invoice(A, { day: dayOffset(-10), exVat: '6000.00', vat: '1080.00', alloc: '1234' });
    expect(await vat.invoiceCase({ invoiceId: bad })).toMatchObject({ allocationNumber: '1234', numberState: 'invalid' });
    const good = await invoice(A, { day: dayOffset(-10), exVat: '6000.00', vat: '1080.00', alloc: '123-456-789' });
    const ok = await vat.invoiceCase({ invoiceId: good });
    expect(ok).toMatchObject({ allocationNumber: '123-456-789', numberState: 'valid', row: null });
    expect(ok!.ita.fields).toEqual([]);
  });

  it('invalid format → BAD_REQUEST and no write', async () => {
    const id = await invoice(A, { day: dayOffset(-10), exVat: '6000.00', vat: '1080.00' });
    await expect(
      callerFor(A).vat.setAllocationNumber({ invoiceId: id, allocationNumber: '12345', source: 'typed', clientMutationId: cmid() }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    const [inv] = await db.select({ a: invoices.allocationNumber }).from(invoices).where(eq(invoices.id, id));
    expect(inv!.a).toBeNull();
    expect(await db.select().from(auditLog).where(eq(auditLog.action, 'vat.allocation_set'))).toHaveLength(0);
  });

  it('suggestedNumber comes from a corrected copy of THIS invoice with a valid number only', async () => {
    const orig = await invoice(A, { day: dayOffset(-10), exVat: '6000.00', vat: '1080.00' });
    const other = await invoice(A, { day: dayOffset(-9), exVat: '7000.00', vat: '1260.00' });
    // A copy without a number → no suggestion.
    await invoice(A, { day: dayOffset(-10), exVat: '6000.00', vat: '1080.00', number: null, duplicateOf: orig });
    let rows = (await vatAtRisk(db, A.restaurantId, 'open')).rows;
    expect(rows.find((r) => r.invoiceId === orig)!.suggestedNumber).toBeNull();
    // A corrected copy with a valid number → suggestion on the original only.
    const copy = await invoice(A, { day: dayOffset(-10), exVat: '6000.00', vat: '1080.00', number: null, alloc: '987654321', duplicateOf: orig });
    rows = (await vatAtRisk(db, A.restaurantId, 'open')).rows;
    expect(rows.find((r) => r.invoiceId === orig)!.suggestedNumber).toEqual({ value: '987654321', fromInvoiceId: copy });
    expect(rows.find((r) => r.invoiceId === other)!.suggestedNumber).toBeNull();

    // The chip: corrected_copy accepts only the suggested number.
    const { vat } = callerFor(A);
    await expect(
      vat.setAllocationNumber({ invoiceId: other, allocationNumber: '987654321', source: 'corrected_copy', clientMutationId: cmid() }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await vat.setAllocationNumber({ invoiceId: orig, allocationNumber: '987654321', source: 'corrected_copy', clientMutationId: cmid() });
    const left = (await vatAtRisk(db, A.restaurantId, 'open')).rows.map((r) => r.invoiceId);
    expect(left).toContain(other);
    expect(left).not.toContain(orig);
  });

  it('markRequested → stage requested; 8 days later → overdue_request; nothing sent', async () => {
    const id = await invoice(A, { day: dayOffset(-5), exVat: '6000.00', vat: '1080.00' });
    const { vat } = callerFor(A);
    const before = await db.select().from(notificationsOutbox);
    const m = cmid();
    const res = await vat.markRequested({ supplierId: A.supplierId, invoiceIds: [id], channel: 'whatsapp', clientMutationId: m });
    expect(res).toMatchObject({ supplierId: A.supplierId, invoiceIds: [id], replayed: false });
    expect((await vat.markRequested({ supplierId: A.supplierId, invoiceIds: [id], channel: 'whatsapp', clientMutationId: m }))!.replayed).toBe(true);

    const row = (await vatAtRisk(db, A.restaurantId, 'open')).rows[0]!;
    expect(row).toMatchObject({ stage: 'requested', requestCount: 1 });
    expect(row.requestedAt).not.toBeNull();
    expect((await vatAtRisk(db, A.restaurantId, 'open', { now: plusDays(8) })).rows[0]!.stage).toBe('overdue_request');

    const audits = await db.select().from(auditLog).where(eq(auditLog.action, 'vat.allocation_requested'));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.after).toMatchObject({ channel: 'whatsapp', automationId: 'A13' });
    expect(await db.select().from(notificationsOutbox)).toHaveLength(before.length);

    const ic = await vat.invoiceCase({ invoiceId: id });
    expect(ic).toMatchObject({ allocationNumber: null, numberState: 'missing', daysSinceRequest: 0, canWrite: true, ita: { url: null } });
    expect(ic!.ita.fields).toHaveLength(6);
  });

  it('deadline items: buckets with a stable dedupe key; no ₪ unless asked; 31st clamped', async () => {
    const id = await invoice(A, { day: '2026-08-31', exVat: '6000.00', vat: '1080.00' }); // deadline 2027-02-28
    const at = (iso: string) => new Date(`${iso}T09:00:00+02:00`);
    const at30 = await allocationDeadlineItems(db, A.restaurantId, at('2027-01-29'));
    expect(at30).toHaveLength(1);
    expect(at30[0]).toMatchObject({ invoiceId: id, bucket: 30, daysLeft: 30, deductionDeadline: '2027-02-28' });
    expect(at30[0]!.dedupeKey).toBe(`au:A13:${A.restaurantId}:${id}:30`);
    expect(at30[0]).not.toHaveProperty('vatAtRisk');
    expect(JSON.stringify(at30)).not.toContain('₪');
    expect((await allocationDeadlineItems(db, A.restaurantId, at('2027-01-28'))).length).toBe(0); // 31 days
    for (const [day, bucket] of [['2027-02-14', 14], ['2027-02-21', 7], ['2027-02-25', 3], ['2027-02-27', 1]] as const) {
      const items = await allocationDeadlineItems(db, A.restaurantId, at(day), { withMoney: true });
      expect(items[0], day).toMatchObject({ bucket, vatAtRisk: 1080 });
    }
    // The same day twice → the same key (the outbox dedupes it).
    const k1 = (await allocationDeadlineItems(db, A.restaurantId, at('2027-02-14')))[0]!.dedupeKey;
    const k2 = (await allocationDeadlineItems(db, A.restaurantId, at('2027-02-16')))[0]!.dedupeKey;
    expect(k1).toBe(k2);
  });

  it('requestDraft: wa.me only from a valid number, mailto only from an e-mail, copy-only hint otherwise', async () => {
    const id = await invoice(A, { day: dayOffset(-5), exVat: '6000.00', vat: '1080.00', number: '881' });
    const { vat } = callerFor(A);
    let d = await vat.requestDraft({ supplierId: A.supplierId });
    expect(d!.invoices.map((i) => i.invoiceId)).toEqual([id]);
    expect(d!.text).toContain('מס׳ 881');

    await db.update(suppliers).set({ contactWhatsapp: '12', contactEmail: null }).where(eq(suppliers.id, A.supplierId));
    d = await vat.requestDraft({ supplierId: A.supplierId });
    expect(d).toMatchObject({ waHref: null, mailtoHref: null, needsContact: true, supplierHref: `/dashboard/suppliers/${A.supplierId}` });

    await db.update(suppliers).set({ contactWhatsapp: '054-1234567', contactEmail: 'orders@supplier.co.il' }).where(eq(suppliers.id, A.supplierId));
    d = await vat.requestDraft({ supplierId: A.supplierId });
    expect(d!.waHref).toMatch(/^https:\/\/wa\.me\/972541234567\?text=/);
    expect(decodeURIComponent(d!.waHref!.split('text=')[1]!)).toBe(d!.text);
    expect(d!.mailtoHref).toMatch(/^mailto:orders%40supplier\.co\.il\?subject=/);
    expect(d!.needsContact).toBe(false);
  });

  it('requestDraft turns into a reminder after markRequested, with days since the request', async () => {
    const id = await invoice(A, { day: dayOffset(-5), exVat: '6000.00', vat: '1080.00', number: '881' });
    await db.update(suppliers).set({ contactEmail: 'orders@supplier.co.il' }).where(eq(suppliers.id, A.supplierId));
    const { vat } = callerFor(A);
    const first = await vat.requestDraft({ supplierId: A.supplierId });
    expect(first).toMatchObject({ kind: 'request', lastRequestedAt: null, daysSinceRequest: null });
    expect(first!.text).not.toContain('תזכורת');

    await vat.markRequested({ supplierId: A.supplierId, invoiceIds: [id], channel: 'email', clientMutationId: cmid() });
    const now = await vat.requestDraft({ supplierId: A.supplierId });
    expect(now).toMatchObject({ kind: 'reminder', daysSinceRequest: 0 });
    expect(now!.text).toContain('תזכורת קטנה');
    expect(decodeURIComponent(now!.mailtoHref!.split('subject=')[1]!.split('&')[0]!)).toMatch(/^תזכורת: /);

    const later = await allocationRequestDraft(db, A.restaurantId, A.supplierId, { now: plusDays(9) });
    expect(later).toMatchObject({ kind: 'reminder', daysSinceRequest: 9 });
  });

  it('a 0%-VAT produce invoice never appears; thresholds measured on the invoice date', async () => {
    const [exempt] = await db.insert(suppliers).values({ restaurantId: A.restaurantId, name: 'ירקות', vatRate: '0' }).returning();
    await invoice(A, { day: '2026-10-10', exVat: '6000.00', supplierId: exempt!.id });
    const may31 = await invoice(A, { day: '2026-05-31', exVat: '10000.01', vat: '1800.00' });
    await invoice(A, { day: '2026-06-01', exVat: '5000.00', vat: '900.00' });
    const jun1 = await invoice(A, { day: '2026-06-01', exVat: '5000.01', vat: '900.00' });
    const r = await vatAtRisk(db, A.restaurantId, 'all', { now: new Date('2026-10-25T09:00:00Z') });
    expect(r.rows.map((x) => x.invoiceId).sort()).toEqual([may31, jun1].sort());
  });

  it('flag off: every vat.* returns null (the UI hides)', async () => {
    const id = await invoice(A, { day: dayOffset(-5), exVat: '6000.00', vat: '1080.00' });
    await db.update(restaurants).set({ settings: {} as never }).where(eq(restaurants.id, A.restaurantId));
    const { vat } = callerFor(A);
    expect(await vat.invoiceCase({ invoiceId: id })).toBeNull();
    expect(await vat.requestDraft({ supplierId: A.supplierId })).toBeNull();
    expect(await vat.setAllocationNumber({ invoiceId: id, allocationNumber: '123456789', source: 'typed', clientMutationId: cmid() })).toBeNull();
    expect(await vat.markRequested({ supplierId: A.supplierId, invoiceIds: [id], channel: 'copy', clientMutationId: cmid() })).toBeNull();
    const [inv] = await db.select({ a: invoices.allocationNumber }).from(invoices).where(eq(invoices.id, id));
    expect(inv!.a).toBeNull();
  });

  it('no leak ₪ moves: leak hero and pay-run totals are identical before and after setting the number', async () => {
    const id = await invoice(A, { day: dayOffset(-3), exVat: '6000.00', vat: '1080.00' });
    const { app, vat } = callerFor(A);
    const heroBefore = await app.owner.leakHero();
    const payBefore = await app.payRun.month();
    await vat.setAllocationNumber({ invoiceId: id, allocationNumber: '123456789', source: 'typed', clientMutationId: cmid() });
    expect(await app.owner.leakHero()).toEqual(heroBefore);
    expect(await app.payRun.month()).toEqual(payBefore);
  });
});
