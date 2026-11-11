import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { appRouter } from '@restomatch/api';
import { computeLeakHero } from '@restomatch/charts';
import {
  and,
  auditLog,
  createDb,
  goodsReceipts,
  discrepancies,
  eq,
  invoiceLines,
  invoices,
  matchRuns,
  memberships,
  poLines,
  products,
  purchaseOrders,
  restaurants,
  sql,
  supplierCatalogItems,
  suppliers,
  testDbUrl,
  userCredentials,
  users,
  type Database,
} from '@restomatch/db';
import { matchInvoiceForJob } from '../jobs/matchInvoice';

/**
 * G-08 review round 7 — the undo paths end to end: the REAL appRouter (mapping /
 * approvals) and the REAL queue, drained through the match-invoice job. The
 * api-level suites mock the queue, so they cannot see what the job does next.
 *   HIGH    undo of an ORDER-line answer: the run stays (no false MISSING + UNORDERED);
 *   MEDIUM  undo of an invoice-line answer whose run has only OPEN findings: re-held,
 *           the stale findings go (no PRICE_HIGHER block on a revoked link);
 *   R5 HIGH-2 (worker level) an undo over a DECIDED finding keeps the run, and the
 *           drain never re-matches it over the question line;
 *   LOW-D   the in-tx guard catches an order hold set while the job waits on the lock.
 */
const db = createDb(testDbUrl());
let restaurantId = '';
let userId = '';
let S = '';
let P = '';
let P2 = '';

async function cleanup() {
  await db.execute(sql`delete from job_queue where queue = 'match-invoice'`);
  if (restaurantId) await db.delete(restaurants).where(eq(restaurants.id, restaurantId));
  if (userId) await db.delete(users).where(eq(users.id, userId));
}

beforeEach(async () => {
  await cleanup();
  const [r] = await db.insert(restaurants).values({ name: 'G-08 R7 drain' }).returning();
  restaurantId = r!.id;
  const [u] = await db
    .insert(users)
    .values({ email: `g08-r7-${Date.now()}@drain.test`, name: 'Owner', emailVerified: new Date() })
    .returning();
  userId = u!.id;
  await db.insert(memberships).values({ userId, restaurantId, role: 'owner' });
  const [s] = await db.insert(suppliers).values({ restaurantId, name: 'ירקות הגליל' }).returning();
  S = s!.id;
  const [p] = await db
    .insert(products)
    .values({ restaurantId, supplierId: S, canonicalName: 'פלפל אדום', defaultUnit: 'ק״ג' })
    .returning();
  P = p!.id;
  const [p2] = await db
    .insert(products)
    .values({ restaurantId, supplierId: S, canonicalName: 'בצל סגול', defaultUnit: 'ק״ג' })
    .returning();
  P2 = p2!.id;
  await db.insert(supplierCatalogItems).values({ restaurantId, supplierId: S, productId: P, supplierNameRaw: 'פלפל אדום', unit: 'ק״ג' });
});
afterAll(cleanup);

const owner = () =>
  appRouter.createCaller({ db, session: { userId, restaurantId, role: 'owner' } } as Parameters<typeof appRouter.createCaller>[0]);

/** Run every queued match-invoice job of this restaurant through the job, until none is left. */
async function drain(): Promise<number> {
  let ran = 0;
  for (let round = 0; round < 5; round++) {
    const jobs = (await db.execute(sql`
      delete from job_queue where queue = 'match-invoice' and restaurant_id = ${restaurantId}::uuid returning payload
    `)) as unknown as Array<{ payload: { restaurantId: string; invoiceId: string; rematch?: boolean; poId?: string } }>;
    if (jobs.length === 0) break;
    for (const j of jobs) {
      await matchInvoiceForJob(db, j.payload);
      ran += 1;
    }
  }
  return ran;
}

async function enqueueRematch(invoiceId: string) {
  await db.execute(sql`
    insert into job_queue (queue, payload, restaurant_id)
    values ('match-invoice', ${JSON.stringify({ restaurantId, invoiceId, rematch: true })}::jsonb, ${restaurantId}::uuid)
  `);
}

async function order(lines: Array<{ productId: string | null; raw: string; price?: string }>) {
  const [po] = await db
    .insert(purchaseOrders)
    .values({ restaurantId, supplierId: S, status: 'sent', source: 'manual', expectedDeliveryAt: new Date() })
    .returning({ id: purchaseOrders.id });
  for (const l of lines) {
    await db.insert(poLines).values({
      poId: po!.id,
      productId: l.productId,
      rawDescription: l.raw,
      qtyOrdered: '2',
      unit: 'ק״ג',
      unitPriceExpected: l.price ?? '11',
    });
  }
  return po!.id;
}

/** The ORIGINAL round-2 fixture: subtotal only, no VAT / total printed. */
async function heldInvoice(opts: {
  raw: string;
  productId: string | null;
  price?: string;
  reasons?: string[];
  heldPoId?: string;
  vat?: { vat: string; incl: string };
}) {
  const price = opts.price ?? '11';
  const total = (2 * Number(price)).toFixed(2);
  const [inv] = await db
    .insert(invoices)
    .values({
      restaurantId,
      supplierId: S,
      status: 'parsed',
      source: 'photo',
      invoiceDate: new Date(),
      totalExclVat: total,
      ...(opts.vat ? { vatAmount: opts.vat.vat, totalInclVat: opts.vat.incl } : {}),
      ocrPayload: {
        provider: 'reconciled',
        raw: { reviewReasons: opts.reasons ?? ['unlinked'] },
        ...(opts.heldPoId ? { heldPoId: opts.heldPoId } : {}),
      } as never,
    })
    .returning({ id: invoices.id });
  await db.insert(invoiceLines).values({
    invoiceId: inv!.id,
    productId: opts.productId,
    rawDescription: opts.raw,
    qtyBilled: '2',
    unit: 'ק״ג',
    unitPriceBilled: price,
    lineTotal: total,
  });
  return inv!.id;
}

async function runsOf(invoiceId: string) {
  return db.select({ id: matchRuns.id }).from(matchRuns).where(eq(matchRuns.invoiceId, invoiceId));
}
async function typesOf(invoiceId: string) {
  return (
    await db
      .select({ t: discrepancies.type })
      .from(discrepancies)
      .innerJoin(matchRuns, eq(matchRuns.id, discrepancies.matchRunId))
      .where(eq(matchRuns.invoiceId, invoiceId))
  ).map((d) => d.t);
}
const statusOf = async (id: string) =>
  (await db.select({ s: invoices.status }).from(invoices).where(eq(invoices.id, id)))[0]!.s;

describe('R7 HIGH: undo of an ORDER-line answer keeps the run', () => {
  it('answer the order line → drain (clean) → undo → drain: no MISSING / UNORDERED, the same run, ₪0 leak', async () => {
    const po = await order([{ productId: null, raw: 'בצל סגול' }]);
    // The invoice line is linked (its SKU resolved); the first match waits for the order's question (M-4).
    const inv = await heldInvoice({ raw: 'בצל סגול', productId: P2, reasons: ['unlinkedPo'], heldPoId: po, vat: { vat: '3.96', incl: '25.96' } });

    const answer = await owner().mapping.confirm({ supplierId: S, rawName: 'בצל סגול', productId: P2 });
    expect(answer.poLinesUpdated).toBe(1);
    expect(await drain()).toBeGreaterThan(0);
    const [run] = await runsOf(inv);
    expect(run).toBeDefined();
    expect(await typesOf(inv)).toEqual([]);

    await owner().mapping.confirm({ supplierId: S, rawName: 'בצל סגול', revert: answer.undo! });
    // The router no longer queues it (its run's order has a question again); a
    // re-match queued anyway (a receipt submit, a stale job) is kept off by the job.
    await enqueueRematch(inv);
    await drain();
    expect(await runsOf(inv)).toEqual([run]);
    const types = await typesOf(inv);
    expect(types).not.toContain('MISSING_ON_INVOICE');
    expect(types).not.toContain('UNORDERED_ITEM');
    expect((await computeLeakHero(db, restaurantId)).leakIls).toBe(0);
  });
});

describe('R7 LOW-3: the undo of a link on a never-held invoice re-matches it (mapping.ts re-queue)', () => {
  it('SKU order + invoice lines linked → drain → undo → drain: a NEW run (they pair by מק״ט again), clean', async () => {
    const [po] = await db
      .insert(purchaseOrders)
      .values({ restaurantId, supplierId: S, status: 'sent', source: 'manual', expectedDeliveryAt: new Date() })
      .returning({ id: purchaseOrders.id });
    // A SKU-keyed order line (imported): it pairs by מק״ט while unlinked.
    await db.insert(poLines).values({ poId: po!.id, productId: null, supplierSku: 'X-1', rawDescription: 'פלפל אדום', qtyOrdered: '2', unit: 'ק״ג', unitPriceExpected: '11' });
    const [inv] = await db
      .insert(invoices)
      .values({ restaurantId, supplierId: S, status: 'matched', source: 'photo', invoiceDate: new Date(), totalExclVat: '22.00', vatAmount: '3.96', totalInclVat: '25.96' })
      .returning({ id: invoices.id });
    await db.insert(invoiceLines).values({ invoiceId: inv!.id, productId: null, supplierSku: 'X-1', rawDescription: 'פלפל אדום', qtyBilled: '2', unit: 'ק״ג', unitPriceBilled: '11', lineTotal: '22' });
    const answer = await owner().mapping.confirm({ supplierId: S, supplierSku: 'X-1', rawName: 'פלפל אדום', productId: P });
    await drain();
    const first = await runsOf(inv!.id);
    expect(first).toHaveLength(1);
    await owner().mapping.confirm({ supplierId: S, supplierSku: 'X-1', rawName: 'פלפל אדום', revert: answer.undo! });
    await drain();
    const second = await runsOf(inv!.id);
    expect(second).toHaveLength(1);
    expect(second[0]!.id).not.toBe(first[0]!.id);
    expect(await typesOf(inv!.id)).toEqual([]);
  });
});

describe('R7 MEDIUM: undo over a run with only OPEN findings re-holds and drops them', () => {
  it('link → drain (PRICE_HIGHER ₪8) → undo: parsed, no run, ₪0 leak, 1 awaiting question, myQueue empty', async () => {
    await order([{ productId: P, raw: 'פלפל אדום' }]);
    const inv = await heldInvoice({ raw: 'פלפל אדום חריף', productId: null, price: '15', vat: { vat: '5.40', incl: '35.40' } });
    const answer = await owner().mapping.confirm({ supplierId: S, rawName: 'פלפל אדום חריף', productId: P });
    await drain();
    const [price] = await db
      .select({ amount: discrepancies.deltaAmount })
      .from(discrepancies)
      .innerJoin(matchRuns, eq(matchRuns.id, discrepancies.matchRunId))
      .where(and(eq(matchRuns.invoiceId, inv), eq(discrepancies.type, 'PRICE_HIGHER')));
    expect(Math.abs(Number(price!.amount))).toBe(8);

    await owner().mapping.confirm({ supplierId: S, rawName: 'פלפל אדום חריף', revert: answer.undo! });
    await drain();
    expect(await statusOf(inv)).toBe('parsed');
    expect(await runsOf(inv)).toEqual([]);
    const hero = await computeLeakHero(db, restaurantId);
    expect(hero.leakIls).toBe(0);
    expect(hero.awaitingQuestionCount).toBe(1);
    expect(JSON.stringify(await owner().approvals.myQueue({ limit: 100 }))).not.toContain(inv);
  });

  it('the original no-VAT fixture: link → drain → undo → drain: re-held, never MISSING / UNORDERED', async () => {
    await order([{ productId: P, raw: 'פלפל אדום' }]);
    const inv = await heldInvoice({ raw: 'פלפל אדום חריף', productId: null });
    const answer = await owner().mapping.confirm({ supplierId: S, rawName: 'פלפל אדום חריף', productId: P });
    await drain();
    expect(await runsOf(inv)).toHaveLength(1);
    await owner().mapping.confirm({ supplierId: S, rawName: 'פלפל אדום חריף', revert: answer.undo! });
    await drain();
    expect(await statusOf(inv)).toBe('parsed');
    const types = await typesOf(inv);
    expect(types).not.toContain('MISSING_ON_INVOICE');
    expect(types).not.toContain('UNORDERED_ITEM');
  });
});

describe('R5 HIGH-2 at the worker: a DECIDED finding keeps its run, and the drain never re-matches over the question', () => {
  it('link → drain → reject the finding → undo → drain: the run, the decision stay; no MISSING / UNORDERED', async () => {
    await order([{ productId: P, raw: 'פלפל אדום' }]);
    const inv = await heldInvoice({ raw: 'פלפל אדום חריף', productId: null, price: '15', vat: { vat: '5.40', incl: '35.40' } });
    const answer = await owner().mapping.confirm({ supplierId: S, rawName: 'פלפל אדום חריף', productId: P });
    await drain();
    const [finding] = await db
      .select({ id: discrepancies.id })
      .from(discrepancies)
      .innerJoin(matchRuns, eq(matchRuns.id, discrepancies.matchRunId))
      .where(and(eq(matchRuns.invoiceId, inv), eq(discrepancies.type, 'PRICE_HIGHER')));
    await owner().approvals.reject({ discrepancyId: finding!.id, reason: 'agreed by phone' });
    const before = await runsOf(inv);

    await owner().mapping.confirm({ supplierId: S, rawName: 'פלפל אדום חריף', revert: answer.undo! });
    // Whatever the router queued, the job keeps the run.
    await enqueueRematch(inv);
    await drain();
    expect(await runsOf(inv)).toEqual(before);
    const [still] = await db.select({ s: discrepancies.resolutionStatus }).from(discrepancies).where(eq(discrepancies.id, finding!.id));
    expect(still!.s).toBe('rejected');
    const types = await typesOf(inv);
    expect(types).not.toContain('MISSING_ON_INVOICE');
    expect(types).not.toContain('UNORDERED_ITEM');
  });
});

describe('R7 LOW-D: the in-tx guard catches a hold set while the job waits on the invoice lock', () => {
  it('an order hold committed by the lock holder → the waiting first match persists no run', async () => {
    const po = await order([{ productId: P, raw: 'פלפל אדום' }]);
    const inv = await heldInvoice({ raw: 'פלפל אדום', productId: P, reasons: [], vat: { vat: '3.96', incl: '25.96' } });
    await db.update(invoices).set({ status: 'matched' }).where(eq(invoices.id, inv));

    let job: Promise<Awaited<ReturnType<typeof matchInvoiceForJob>>> | null = null;
    await db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as Database;
      await tx.execute(sql`select id from invoices where id = ${inv}::uuid for no key update`);
      job = matchInvoiceForJob(db, { restaurantId, invoiceId: inv });
      // Wait until the job is blocked on this row lock (its checks before the lock all passed).
      for (let i = 0; i < 200; i++) {
        const [w] = (await tx.execute(sql`select count(*)::int as n from pg_locks where not granted`)) as unknown as Array<{ n: number }>;
        if (Number(w!.n) > 0) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      // Meanwhile an order line became a question again: the invoice is put on hold.
      await tx.execute(sql`
        update invoices
           set status = 'parsed',
               ocr_payload = jsonb_set(ocr_payload, '{raw,reviewReasons}', '["unlinkedPo"]'::jsonb) || jsonb_build_object('heldPoId', ${po}::text)
         where id = ${inv}::uuid
      `);
    });
    const out = await job!;
    expect(out.persisted).toBeNull();
    expect(await runsOf(inv)).toEqual([]);
    expect(await statusOf(inv)).toBe('parsed');
  });
});

/* ── G-08 review round 8 (7.11): the ORDER-question path ─────────────────── */

/** Order: 'בצל סגול' (linked) + a name-only 'משלוח' ₪60 question; the invoice bills the onions only. */
async function orderWithQuestion() {
  const po = await order([
    { productId: P2, raw: 'בצל סגול' },
    { productId: null, raw: 'משלוח', price: '30' },
  ]);
  const inv = await heldInvoice({ raw: 'בצל סגול', productId: P2, reasons: ['unlinkedPo'], heldPoId: po, vat: { vat: '3.96', incl: '25.96' } });
  // A WRONG answer: the delivery line is linked to a product → MISSING_ON_INVOICE (open).
  const wrong = await owner().mapping.confirm({ supplierId: S, rawName: 'משלוח', productId: P });
  await drain();
  expect(await typesOf(inv)).toContain('MISSING_ON_INVOICE');
  return { po, inv, wrong };
}

describe('R8 HIGH: the "re-run match" button refuses a re-opened order question', () => {
  it('answer → drain → undo → match.runForInvoice → PRECONDITION_FAILED order.unlinkedLines; the run is untouched', async () => {
    await order([{ productId: null, raw: 'בצל סגול' }]);
    const po = (await db.select({ id: purchaseOrders.id }).from(purchaseOrders).where(eq(purchaseOrders.restaurantId, restaurantId)))[0]!.id;
    const inv = await heldInvoice({ raw: 'בצל סגול', productId: P2, reasons: ['unlinkedPo'], heldPoId: po, vat: { vat: '3.96', incl: '25.96' } });
    const answer = await owner().mapping.confirm({ supplierId: S, rawName: 'בצל סגול', productId: P2 });
    await drain();
    const before = await runsOf(inv);
    expect(before).toHaveLength(1);
    await owner().mapping.confirm({ supplierId: S, rawName: 'בצל סגול', revert: answer.undo! });
    const err = await owner()
      .match.runForInvoice({ invoiceId: inv })
      .then(() => null, (e: unknown) => e as { code: string; cause?: { appCode?: string } });
    expect(err?.code).toBe('PRECONDITION_FAILED');
    expect(err?.cause?.appCode).toBe('order.unlinkedLines');
    expect(await runsOf(inv)).toEqual(before);
    expect(await typesOf(inv)).toEqual([]);
    expect((await computeLeakHero(db, restaurantId)).leakIls).toBe(0);
  });
});

describe('R8 MEDIUM: undo of a wrong ORDER-line answer drops the run built on it (open findings only)', () => {
  it('wrong answer → drain (MISSING) → undo: parsed (order hold), no run, ₪0 leak, 1 awaiting question', async () => {
    const { po, inv, wrong } = await orderWithQuestion();
    await owner().mapping.confirm({ supplierId: S, rawName: 'משלוח', revert: wrong.undo! });
    await drain();
    const [row] = await db.select({ s: invoices.status, p: invoices.ocrPayload }).from(invoices).where(eq(invoices.id, inv));
    expect(row!.s).toBe('parsed');
    const p = row!.p as unknown as { heldPoId: string; raw: { reviewReasons: string[] } };
    expect(p.heldPoId).toBe(po);
    expect(p.raw.reviewReasons).toContain('unlinkedPo');
    expect(await runsOf(inv)).toEqual([]);
    const hero = await computeLeakHero(db, restaurantId);
    expect(hero.leakIls).toBe(0);
    expect(hero.awaitingQuestionCount).toBe(1);
  });

  it('a finding with a decision keeps the run', async () => {
    const { inv, wrong } = await orderWithQuestion();
    const [f] = await db
      .select({ id: discrepancies.id })
      .from(discrepancies)
      .innerJoin(matchRuns, eq(matchRuns.id, discrepancies.matchRunId))
      .where(and(eq(matchRuns.invoiceId, inv), eq(discrepancies.type, 'MISSING_ON_INVOICE')));
    await owner().approvals.reject({ discrepancyId: f!.id, reason: 'agreed by phone' });
    const before = await runsOf(inv);
    await owner().mapping.confirm({ supplierId: S, rawName: 'משלוח', revert: wrong.undo! });
    await drain();
    expect(await runsOf(inv)).toEqual(before);
  });
});

describe('R8 MEDIUM: answering an order question "charge line" re-matches the invoice on that order', () => {
  it('wrong answer → drain → (decision kept) undo → mark "משלוח" a charge → drain: the run has no MISSING from it', async () => {
    const { inv, wrong } = await orderWithQuestion();
    const [f] = await db
      .select({ id: discrepancies.id })
      .from(discrepancies)
      .innerJoin(matchRuns, eq(matchRuns.id, discrepancies.matchRunId))
      .where(and(eq(matchRuns.invoiceId, inv), eq(discrepancies.type, 'MISSING_ON_INVOICE')));
    await owner().approvals.reject({ discrepancyId: f!.id, reason: 'agreed by phone' });
    await owner().mapping.confirm({ supplierId: S, rawName: 'משלוח', revert: wrong.undo! });
    await drain();
    expect(await typesOf(inv)).toContain('MISSING_ON_INVOICE'); // the old run, kept (a decision)
    const r = await owner().mapping.markCharge({ supplierId: S, rawName: 'משלוח', shownLineIds: [] });
    expect(r.invoiceLinesMarked).toBe(0);
    expect(r.rematch.requeued).toBeGreaterThan(0);
    await drain();
    const types = await typesOf(inv);
    expect(types).not.toContain('MISSING_ON_INVOICE');
    expect(types).not.toContain('UNORDERED_ITEM');
  });
});

/* ── G-08 order-question kill switch (default ON) ────────────────────────── */

describe('kill switch: settings.features.orderQuestions / FEATURES_OFF=orderQuestions', () => {
  const setOrderQuestions = (on: boolean) =>
    db.update(restaurants).set({ settings: { features: { orderQuestions: on } } as never }).where(eq(restaurants.id, restaurantId));

  it('OFF: a name-only order line is no question, an order-held invoice releases on the next re-match; invoice-line questions stay ON', async () => {
    const po = await order([
      { productId: P, raw: 'פלפל אדום' },
      { productId: null, raw: 'בצל סגול' },
    ]);
    const held = await heldInvoice({ raw: 'פלפל אדום', productId: P, reasons: ['unlinkedPo'], heldPoId: po, vat: { vat: '3.96', incl: '25.96' } });
    expect((await computeLeakHero(db, restaurantId)).awaitingQuestionCount).toBe(1);
    expect((await owner().mapping.questionCount()).count).toBe(1);

    await setOrderQuestions(false);
    expect((await owner().mapping.questionCount()).count).toBe(0);
    expect((await computeLeakHero(db, restaurantId)).awaitingQuestionCount).toBe(0);
    const out = await matchInvoiceForJob(db, { restaurantId, invoiceId: held, rematch: true });
    expect(out.persisted).not.toBeNull();
    expect(await statusOf(held)).not.toBe('parsed');

    // Invoice-line questions (and their hold) are unaffected.
    const q = await heldInvoice({ raw: 'פלפל אדום חריף', productId: null });
    expect((await owner().mapping.questionCount()).count).toBe(1);
    expect((await matchInvoiceForJob(db, { restaurantId, invoiceId: q, rematch: true })).skipped).toBe('awaiting_review');
    // …and a charge answer still works and is learned.
    const ch = await heldInvoice({ raw: 'פיקדון ארגזים', productId: null });
    const sample = await owner().mapping.chargeSample({ supplierId: S, rawName: 'פיקדון ארגזים' });
    const r = await owner().mapping.markCharge({ supplierId: S, rawName: 'פיקדון ארגזים', shownLineIds: sample!.lineIds });
    expect(r).toMatchObject({ invoiceLinesMarked: 1, learnedKey: true });
    expect(await runsOf(ch)).toEqual([]); // released + re-queued, not matched inline
  });

  it('ON (default, and explicit true): unchanged — the order line holds the first match', async () => {
    for (const on of [null, true]) {
      if (on != null) await setOrderQuestions(on);
      const po = await order([
        { productId: P, raw: 'פלפל אדום' },
        { productId: null, raw: 'בצל סגול' },
      ]);
      const inv = await heldInvoice({ raw: 'פלפל אדום', productId: P, reasons: [], vat: { vat: '3.96', incl: '25.96' } });
      await db.update(invoices).set({ status: 'matched' }).where(eq(invoices.id, inv));
      const out = await matchInvoiceForJob(db, { restaurantId, invoiceId: inv, poId: po });
      expect(out.skipped).toBe('awaiting_review');
      expect(await statusOf(inv)).toBe('parsed');
    }
  });

  it('FEATURES_OFF=orderQuestions turns it off for every tenant', async () => {
    const po = await order([
      { productId: P, raw: 'פלפל אדום' },
      { productId: null, raw: 'בצל סגול' },
    ]);
    const inv = await heldInvoice({ raw: 'פלפל אדום', productId: P, reasons: [], vat: { vat: '3.96', incl: '25.96' } });
    await db.update(invoices).set({ status: 'matched' }).where(eq(invoices.id, inv));
    const prev = process.env.FEATURES_OFF;
    process.env.FEATURES_OFF = 'orderQuestions';
    try {
      const out = await matchInvoiceForJob(db, { restaurantId, invoiceId: inv, poId: po });
      expect(out.persisted).not.toBeNull();
    } finally {
      if (prev === undefined) delete process.env.FEATURES_OFF;
      else process.env.FEATURES_OFF = prev;
    }
  });
});

/* ── G-08 review round 9 (7.11) ─────────────────────────────────────────── */

const findingIds = async (invoiceId: string, type: string) =>
  (
    await db
      .select({ id: discrepancies.id })
      .from(discrepancies)
      .innerJoin(matchRuns, eq(matchRuns.id, discrepancies.matchRunId))
      .where(and(eq(matchRuns.invoiceId, invoiceId), eq(discrepancies.type, type as never)))
  ).map((d) => d.id);
const poOf = async (invoiceId: string) =>
  (await db.select({ po: matchRuns.poId }).from(matchRuns).where(eq(matchRuns.invoiceId, invoiceId))).map((r) => r.po);

describe('R9 HIGH: a re-hold / release keeps the order pin (a closed order is not lost)', () => {
  it('first match → the order is closed → undo → mark "משלוח" a charge → drain: the same po_id, no UNORDERED_ARRIVAL', async () => {
    const { po, inv, wrong } = await orderWithQuestion();
    expect(await poOf(inv)).toEqual([po]);
    await db.update(purchaseOrders).set({ status: 'closed' }).where(eq(purchaseOrders.id, po));
    await owner().mapping.confirm({ supplierId: S, rawName: 'משלוח', revert: wrong.undo! });
    expect(await runsOf(inv)).toEqual([]); // re-held on the order (R8)
    await owner().mapping.markCharge({ supplierId: S, rawName: 'משלוח', shownLineIds: [] });
    await drain();
    expect(await poOf(inv)).toEqual([po]);
    const types = await typesOf(inv);
    expect(types).not.toContain('UNORDERED_ARRIVAL');
    expect(types).not.toContain('MISSING_ON_INVOICE');
    expect(await statusOf(inv)).not.toBe('parsed');
  });
});

describe('R9 MEDIUM: an engine auto-approval is not a person\'s decision', () => {
  it('order path: an auto-accepted finding (no resolved_at) next to the false MISSING → the undo re-holds; ₪0', async () => {
    const { inv, wrong } = await orderWithQuestion();
    // What the engine writes for an auto-approved finding: 'accepted', no resolved_at / resolved_by.
    await db
      .update(discrepancies)
      .set({ resolutionStatus: 'accepted', resolvedAt: null, resolvedBy: null })
      .where(sql`${discrepancies.id} in (${sql.join((await findingIds(inv, 'MISSING_ON_INVOICE')).map((id) => sql`${id}::uuid`), sql`, `)})`);
    await owner().mapping.confirm({ supplierId: S, rawName: 'משלוח', revert: wrong.undo! });
    await drain();
    expect(await statusOf(inv)).toBe('parsed');
    expect(await runsOf(inv)).toEqual([]);
    expect((await computeLeakHero(db, restaurantId)).leakIls).toBe(0);
  });

  it('invoice-line path: the same rule in reholdLinkHolds', async () => {
    await order([{ productId: P, raw: 'פלפל אדום' }]);
    const inv = await heldInvoice({ raw: 'פלפל אדום חריף', productId: null, price: '15', vat: { vat: '5.40', incl: '35.40' } });
    const answer = await owner().mapping.confirm({ supplierId: S, rawName: 'פלפל אדום חריף', productId: P });
    await drain();
    await db
      .update(discrepancies)
      .set({ resolutionStatus: 'accepted', resolvedAt: null, resolvedBy: null })
      .where(sql`${discrepancies.id} in (${sql.join((await findingIds(inv, 'PRICE_HIGHER')).map((id) => sql`${id}::uuid`), sql`, `)})`);
    await owner().mapping.confirm({ supplierId: S, rawName: 'פלפל אדום חריף', revert: answer.undo! });
    await drain();
    expect(await statusOf(inv)).toBe('parsed');
    expect(await runsOf(inv)).toEqual([]);
    expect((await computeLeakHero(db, restaurantId)).leakIls).toBe(0);
  });
});

describe('R9 MEDIUM: an order re-hold never strands an invoice held for another reason', () => {
  it("held for 'confidence', matched by the manager → wrong order answer undone → the run stays, not stranded in 'parsed'", async () => {
    const po = await order([
      { productId: P2, raw: 'בצל סגול' },
      { productId: null, raw: 'משלוח', price: '30' },
    ]);
    const inv = await heldInvoice({ raw: 'בצל סגול', productId: P2, reasons: ['confidence'], vat: { vat: '3.96', incl: '25.96' } });
    const wrong = await owner().mapping.confirm({ supplierId: S, rawName: 'משלוח', productId: P });
    await owner().match.runForInvoice({ invoiceId: inv });
    const before = await runsOf(inv);
    expect(before).toHaveLength(1);
    await owner().mapping.confirm({ supplierId: S, rawName: 'משלוח', revert: wrong.undo! });
    await owner().mapping.markCharge({ supplierId: S, rawName: 'משלוח', shownLineIds: [] });
    await drain();
    expect(await statusOf(inv)).not.toBe('parsed');
    const runs = await runsOf(inv);
    expect(runs).toHaveLength(1);
    expect(await poOf(inv)).toEqual([po]);
  });
});

describe('R9 MEDIUM: turning order questions OFF releases the invoices already held', () => {
  it('held (unlinkedPo) → admin.setFeatures({ orderQuestions: false }) → drain: 1 run on the order, not parsed', async () => {
    const po = await order([
      { productId: P, raw: 'פלפל אדום' },
      { productId: null, raw: 'בצל סגול' },
    ]);
    const inv = await heldInvoice({ raw: 'פלפל אדום', productId: P, reasons: ['unlinkedPo'], heldPoId: po, vat: { vat: '3.96', incl: '25.96' } });
    const [adm] = await db
      .insert(users)
      .values({ email: `g08-admin-${Date.now()}@drain.test`, name: 'Ops', isPlatformAdmin: true })
      .returning();
    try {
      await db.insert(userCredentials).values({ userId: adm!.id, totpSecretEnc: 'ciphertext', totpEnabledAt: new Date() });
      const admin = appRouter.createCaller({ db, session: { userId: adm!.id, restaurantId: null, role: null } } as Parameters<typeof appRouter.createCaller>[0]);
      await admin.admin.setFeatures({ restaurantId, features: { orderQuestions: false } });
      await drain();
      expect(await poOf(inv)).toEqual([po]);
      expect(await statusOf(inv)).not.toBe('parsed');
    } finally {
      await db.delete(auditLog).where(eq(auditLog.userId, adm!.id));
      await db.delete(users).where(eq(users.id, adm!.id));
    }
  });
});

describe('R9 LOWs: the charge path on order lines', () => {
  it('LOW-6: marking an order line a charge re-queues only invoices whose run has a finding on it', async () => {
    const po = await order([
      { productId: P2, raw: 'בצל סגול' },
      { productId: null, raw: 'משלוח', price: '30' },
    ]);
    const [inv] = await db
      .insert(invoices)
      .values({ restaurantId, supplierId: S, status: 'matched', source: 'photo', invoiceDate: new Date() })
      .returning({ id: invoices.id });
    await db.insert(matchRuns).values({ restaurantId, poId: po, invoiceId: inv!.id, overallStatus: 'clean' });
    const r = await owner().mapping.markCharge({ supplierId: S, rawName: 'משלוח', shownLineIds: [] });
    expect(r.rematch.requeued).toBe(0);
  });

  it('LOW-7 (bounded, round 10): undoing a charge mark re-holds only a run with a finding on that order line', async () => {
    const po = await order([
      { productId: P2, raw: 'בצל סגול' },
      { productId: null, raw: 'משלוח', price: '30' },
    ]);
    // Billed above the order (₪15 vs ₪11) → PRICE_HIGHER, open — a finding on the ONIONS, not on the charge.
    const inv = await heldInvoice({ raw: 'בצל סגול', productId: P2, price: '15', reasons: ['unlinkedPo'], heldPoId: po, vat: { vat: '5.40', incl: '35.40' } });
    const mark = await owner().mapping.markCharge({ supplierId: S, rawName: 'משלוח', shownLineIds: [] });
    expect(mark.learnedKey).toBe(true);
    await drain();
    expect(await typesOf(inv)).toContain('PRICE_HIGHER');
    const before = await runsOf(inv);
    await owner().mapping.markCharge({ supplierId: S, rawName: 'משלוח', undo: mark.undo! });
    await drain();
    // The run has nothing built on the charge answer: it stays (and is not re-matched over the question).
    expect(await runsOf(inv)).toEqual(before);
    expect(await typesOf(inv)).not.toContain('MISSING_ON_INVOICE');

    // A run that DOES carry a finding on the key's order line goes back on the hold.
    const mark2 = await owner().mapping.markCharge({ supplierId: S, rawName: 'משלוח', shownLineIds: [] });
    const [pl] = await db.select({ id: poLines.id }).from(poLines).where(and(eq(poLines.poId, po), eq(poLines.rawDescription, 'משלוח')));
    await db.insert(discrepancies).values({ restaurantId, matchRunId: before[0]!.id, type: 'MISSING_ON_INVOICE', severity: 'warn', poLineId: pl!.id, deltaAmount: '60' } as never);
    await owner().mapping.markCharge({ supplierId: S, rawName: 'משלוח', undo: mark2.undo! });
    await drain();
    expect(await statusOf(inv)).toBe('parsed');
    expect(await runsOf(inv)).toEqual([]);
    expect((await computeLeakHero(db, restaurantId)).awaitingQuestionCount).toBe(1);
  });
});

/* ── G-08 review round 10 (7.11) ────────────────────────────────────────── */

async function adminCaller() {
  const [adm] = await db
    .insert(users)
    .values({ email: `g08-r10-admin-${Date.now()}-${Math.random().toString(36).slice(2)}@drain.test`, name: 'Ops', isPlatformAdmin: true })
    .returning();
  await db.insert(userCredentials).values({ userId: adm!.id, totpSecretEnc: 'ciphertext', totpEnabledAt: new Date() });
  return {
    caller: appRouter.createCaller({ db, session: { userId: adm!.id, restaurantId: null, role: null } } as Parameters<typeof appRouter.createCaller>[0]),
    cleanup: async () => {
      await db.delete(auditLog).where(eq(auditLog.userId, adm!.id));
      await db.delete(users).where(eq(users.id, adm!.id));
    },
  };
}

describe('R10 MED: an invoice-line re-hold keeps the order pin too', () => {
  it('answer → drain (run on the order) → order closed → undo → re-answer → drain: the same po_id, no UNORDERED_ARRIVAL', async () => {
    const po = await order([{ productId: P, raw: 'פלפל אדום' }]);
    const inv = await heldInvoice({ raw: 'פלפל אדום חריף', productId: null, price: '15', vat: { vat: '5.40', incl: '35.40' } });
    const answer = await owner().mapping.confirm({ supplierId: S, rawName: 'פלפל אדום חריף', productId: P });
    await drain();
    expect(await poOf(inv)).toEqual([po]);
    await db.update(purchaseOrders).set({ status: 'closed' }).where(eq(purchaseOrders.id, po));
    await owner().mapping.confirm({ supplierId: S, rawName: 'פלפל אדום חריף', revert: answer.undo! });
    expect(await runsOf(inv)).toEqual([]); // re-held (open findings only)
    await owner().mapping.confirm({ supplierId: S, rawName: 'פלפל אדום חריף', productId: P });
    await drain();
    expect(await poOf(inv)).toEqual([po]);
    expect(await typesOf(inv)).not.toContain('UNORDERED_ARRIVAL');
    expect(await statusOf(inv)).not.toBe('parsed');
  });
});

describe('R10 MED: the pin follows the last run (runForInvoice refreshes it)', () => {
  it('a stale pin on order A; the run moves to B; runForInvoice → pin = B; a run-less re-match stays on B', async () => {
    const poA = await order([{ productId: P, raw: 'פלפל אדום' }]);
    const poB = await order([{ productId: P, raw: 'פלפל אדום' }]);
    // B was delivered (a receipt) a day earlier and is CLOSED — discovery never finds it
    // again; only a pin does. A is open and nearer.
    await db.update(purchaseOrders).set({ expectedDeliveryAt: new Date(Date.now() - 86_400_000) }).where(eq(purchaseOrders.id, poB));
    await db.insert(goodsReceipts).values({ restaurantId, poId: poB, status: 'completed' });
    const inv = await heldInvoice({ raw: 'פלפל אדום', productId: P, reasons: [], vat: { vat: '3.96', incl: '25.96' } });
    await db
      .update(invoices)
      .set({ status: 'matched', ocrPayload: { provider: 'reconciled', raw: { reviewReasons: [] }, linkPinPoId: poA } as never })
      .where(eq(invoices.id, inv));
    // The receipt on B was counted for this invoice → its run is on B.
    await matchInvoiceForJob(db, { restaurantId, invoiceId: inv, poId: poB, rematch: true });
    expect(await poOf(inv)).toEqual([poB]);
    await db.update(purchaseOrders).set({ status: 'closed' }).where(eq(purchaseOrders.id, poB));
    await owner().match.runForInvoice({ invoiceId: inv });
    const [row] = await db.select({ p: invoices.ocrPayload }).from(invoices).where(eq(invoices.id, inv));
    expect((row!.p as unknown as { linkPinPoId?: string }).linkPinPoId).toBe(poB);
    // A run-less re-match (after a re-hold / release) follows the pin, not the nearer A.
    await db.delete(matchRuns).where(eq(matchRuns.invoiceId, inv));
    await matchInvoiceForJob(db, { restaurantId, invoiceId: inv, rematch: true });
    expect(await poOf(inv)).toEqual([poB]);
  });
});

describe('R10 MED: the kill-switch sweep can be retried', () => {
  it('a second OFF save releases a still-held invoice; a released invoice left with no run is re-queued', async () => {
    const { caller, cleanup } = await adminCaller();
    try {
      await caller.admin.setFeatures({ restaurantId, features: { orderQuestions: false } });
      // Held after the flip (e.g. a job that ran before the redeploy).
      const po = await order([
        { productId: P, raw: 'פלפל אדום' },
        { productId: null, raw: 'בצל סגול' },
      ]);
      const held = await heldInvoice({ raw: 'פלפל אדום', productId: P, reasons: ['unlinkedPo'], heldPoId: po, vat: { vat: '3.96', incl: '25.96' } });
      // Released earlier, but its enqueue failed: 'matched', linkReleasedAt, no run.
      const stranded = await heldInvoice({ raw: 'פלפל אדום', productId: P, reasons: ['unlinked'], vat: { vat: '3.96', incl: '25.96' } });
      await db
        .update(invoices)
        .set({ status: 'matched', ocrPayload: { provider: 'reconciled', raw: { reviewReasons: ['unlinked'] }, linkReleasedAt: new Date().toISOString(), linkPinPoId: po } as never })
        .where(eq(invoices.id, stranded));
      const again = await caller.admin.setFeatures({ restaurantId, features: { orderQuestions: false } });
      expect(again).toMatchObject({ release: { ok: true, released: 1, requeued: 2, failed: 0 } });
      await drain();
      expect(await poOf(held)).toEqual([po]);
      expect(await statusOf(held)).not.toBe('parsed');
      expect(await poOf(stranded)).toEqual([po]);
    } finally {
      await cleanup();
    }
  });
});


/* ── G-08 round 11 (7.11): the manager's "re-run match" keeps the pin ───── */

describe('R11: match.runForInvoice pins a run-less invoice to its question-hold order', () => {
  it('(a) an M-4 hold on a CLOSED order → refuses order.unlinkedLines; heldPoId is kept, no run', async () => {
    const po = await order([
      { productId: P, raw: 'פלפל אדום' },
      { productId: null, raw: 'בצל סגול' },
    ]);
    await db.update(purchaseOrders).set({ status: 'closed' }).where(eq(purchaseOrders.id, po));
    const inv = await heldInvoice({ raw: 'פלפל אדום', productId: P, reasons: ['unlinkedPo'], heldPoId: po, vat: { vat: '3.96', incl: '25.96' } });
    const err = await owner()
      .match.runForInvoice({ invoiceId: inv })
      .then(() => null, (e: unknown) => e as { code: string; cause?: { appCode?: string } });
    expect(err?.code).toBe('PRECONDITION_FAILED');
    expect(err?.cause?.appCode).toBe('order.unlinkedLines');
    expect(await runsOf(inv)).toEqual([]);
    const [row] = await db.select({ p: invoices.ocrPayload }).from(invoices).where(eq(invoices.id, inv));
    expect((row!.p as unknown as { heldPoId?: string }).heldPoId).toBe(po);
  });

  it('(b) released, no run, pinned to closed+received B, open nearer A → runs on B; the pin stays B', async () => {
    const poA = await order([{ productId: P, raw: 'פלפל אדום' }]);
    const poB = await order([{ productId: P, raw: 'פלפל אדום' }]);
    await db.update(purchaseOrders).set({ status: 'closed', expectedDeliveryAt: new Date(Date.now() - 86_400_000) }).where(eq(purchaseOrders.id, poB));
    await db.insert(goodsReceipts).values({ restaurantId, poId: poB, status: 'completed' });
    const inv = await heldInvoice({ raw: 'פלפל אדום', productId: P, reasons: ['unlinked'], vat: { vat: '3.96', incl: '25.96' } });
    await db
      .update(invoices)
      .set({ status: 'matched', ocrPayload: { provider: 'reconciled', raw: { reviewReasons: ['unlinked'] }, linkReleasedAt: new Date().toISOString(), linkPinPoId: poB } as never })
      .where(eq(invoices.id, inv));
    await owner().match.runForInvoice({ invoiceId: inv });
    expect(await poOf(inv)).toEqual([poB]);
    expect(await typesOf(inv)).not.toContain('UNORDERED_ARRIVAL');
    const [row] = await db.select({ p: invoices.ocrPayload }).from(invoices).where(eq(invoices.id, inv));
    expect((row!.p as unknown as { linkPinPoId?: string }).linkPinPoId).toBe(poB);
    void poA;
  });

  it('heldPoId and linkPinPoId differ → the hold\'s order wins (the job pins to heldPoId)', async () => {
    const old = await order([{ productId: P, raw: 'פלפל אדום' }]);
    const po = await order([{ productId: P, raw: 'פלפל אדום' }]);
    await db.update(purchaseOrders).set({ status: 'closed' }).where(eq(purchaseOrders.id, po));
    await db.update(purchaseOrders).set({ status: 'closed' }).where(eq(purchaseOrders.id, old));
    const inv = await heldInvoice({ raw: 'פלפל אדום', productId: P, reasons: ['unlinkedPo'], heldPoId: po, vat: { vat: '3.96', incl: '25.96' } });
    await db
      .update(invoices)
      .set({ ocrPayload: { provider: 'reconciled', raw: { reviewReasons: ['unlinkedPo'] }, heldPoId: po, linkPinPoId: old } as never })
      .where(eq(invoices.id, inv));
    const out = await matchInvoiceForJob(db, { restaurantId, invoiceId: inv, rematch: true });
    expect(out.persisted).not.toBeNull();
    expect(await poOf(inv)).toEqual([po]);
  });
});
