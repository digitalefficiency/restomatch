import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDb,
  discrepancies,
  eq,
  invoiceLines,
  invoices,
  matchRuns,
  poLines,
  productAliases,
  products,
  purchaseOrders,
  supplierCatalogItems,
  suppliers,
  testDbUrl,
} from '@restomatch/db';
type Job = { restaurantId: string; invoiceId: string; rematch?: boolean };
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { rematchHoldReason } from '../receiving/matchTriggers';
import { signAnswerUndo, UNDO_TTL_MS, verifyAnswerUndo } from '../catalog/answerUndo';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * G-08 review fixes (warden + money lenses, 31.10):
 *   CRITICAL-1 an unlinked (question) line holds the invoice; the answer releases it and it matches clean;
 *   HIGH-3     a PO-line-only answer re-matches the invoice matched against that PO;
 *   MEDIUM-1   NBSP / thin-space spellings answer the same question;
 *   MEDIUM-2   undo restores a raised legacy alias;
 *   MEDIUM-3   a second, different product for a confirmed key is a CONFLICT; no open question → NOT_FOUND;
 *   LOW-1      answerLink learns on the question's own server-side spelling.
 */
const enqueued: Array<{ queue: string; payload: Job }> = [];
vi.mock('@restomatch/queue', async (orig) => {
  const real = await orig<typeof import('@restomatch/queue')>();
  return {
    ...real,
    enqueue: async (queue: string, payload: Job) => {
      enqueued.push({ queue, payload });
      return true;
    },
  };
});

const db = createDb(testDbUrl());
let A: Tenant;
let S: string; // a second supplier of A, so the match discovers exactly one order
let P: string; // the product S sells

function callerFor(t: Tenant, role: Session['role'] = 'owner') {
  return appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } } as AppContext);
}
const rematched = () => enqueued.map((e) => (e.payload as { invoiceId?: string }).invoiceId);

async function order(lines: Array<{ productId: string | null; raw: string }>) {
  const [po] = await db
    .insert(purchaseOrders)
    .values({ restaurantId: A.restaurantId, supplierId: S, status: 'sent', source: 'manual', expectedDeliveryAt: new Date() })
    .returning({ id: purchaseOrders.id });
  const ids: string[] = [];
  for (const l of lines) {
    const [pl] = await db
      .insert(poLines)
      .values({ poId: po!.id, productId: l.productId, rawDescription: l.raw, qtyOrdered: '2', unit: 'ק״ג', unitPriceExpected: '11' })
      .returning({ id: poLines.id });
    ids.push(pl!.id);
  }
  return { poId: po!.id, lineIds: ids };
}

/** An OCR'd invoice held ONLY because the link policy left a line unlinked. */
async function heldInvoice(raw: string, reasons: string[] = ['unlinked']) {
  const [inv] = await db
    .insert(invoices)
    .values({
      restaurantId: A.restaurantId,
      supplierId: S,
      status: 'parsed',
      source: 'photo',
      invoiceDate: new Date(),
      totalExclVat: '22.00',
      ocrPayload: { provider: 'reconciled', raw: { reviewReasons: reasons } } as never,
    })
    .returning({ id: invoices.id });
  const [line] = await db
    .insert(invoiceLines)
    .values({ invoiceId: inv!.id, productId: null, rawDescription: raw, qtyBilled: '2', unit: 'ק״ג', unitPriceBilled: '11', lineTotal: '22' })
    .returning({ id: invoiceLines.id });
  return { invoiceId: inv!.id, lineId: line!.id };
}

async function invoiceRow(id: string) {
  const [r] = await db.select({ status: invoices.status, ocrPayload: invoices.ocrPayload }).from(invoices).where(eq(invoices.id, id));
  return r!;
}
async function findingTypes(invoiceId: string) {
  const runs = await db.select({ id: matchRuns.id }).from(matchRuns).where(eq(matchRuns.invoiceId, invoiceId));
  const out: string[] = [];
  for (const r of runs) {
    const ds = await db.select({ type: discrepancies.type }).from(discrepancies).where(eq(discrepancies.matchRunId, r.id));
    out.push(...ds.map((d) => d.type));
  }
  return out;
}

beforeEach(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  enqueued.length = 0;
  const [s] = await db.insert(suppliers).values({ restaurantId: A.restaurantId, name: 'ירקות הגליל' }).returning({ id: suppliers.id });
  S = s!.id;
  const [p] = await db
    .insert(products)
    .values({ restaurantId: A.restaurantId, supplierId: S, canonicalName: 'פלפל אדום', defaultUnit: 'ק״ג' })
    .returning({ id: products.id });
  P = p!.id;
  await db.insert(supplierCatalogItems).values({ restaurantId: A.restaurantId, supplierId: S, productId: P, supplierNameRaw: 'פלפל אדום', unit: 'ק״ג' });
});
afterAll(() => resetDb(db));

describe('CRITICAL-1: a question line never reaches the engine unlinked', () => {
  it('held (no match, no MISSING/UNORDERED) → the answer releases it → it matches clean; undo puts it back on hold', async () => {
    await order([{ productId: P, raw: 'פלפל אדום' }]);
    const inv = await heldInvoice('פלפל אדום חריף');

    // Held: the OCR gate keeps a never-matched 'parsed' invoice away from the engine.
    expect(rematchHoldReason(await invoiceRow(inv.invoiceId), false)).toBe('awaiting_review');
    expect(await findingTypes(inv.invoiceId)).toEqual([]);

    const r = await callerFor(A).mapping.confirm({ supplierId: S, rawName: 'פלפל אדום חריף', productId: P });
    expect(r.invoiceLinesUpdated).toBe(1);
    const released = await invoiceRow(inv.invoiceId);
    expect(released.status).toBe('matched');
    expect(rematchHoldReason(released, false)).toBeNull();
    expect(rematched()).toContain(inv.invoiceId);

    // The queued re-match, run here through the manager action: no false pair.
    await callerFor(A).match.runForInvoice({ invoiceId: inv.invoiceId });
    const types = await findingTypes(inv.invoiceId);
    expect(types).not.toContain('MISSING_ON_INVOICE');
    expect(types).not.toContain('UNORDERED_ITEM');

    // Undo: the line is unlinked again → back on hold, the run is dropped, no re-match.
    enqueued.length = 0;
    await callerFor(A).mapping.confirm({ supplierId: S, rawName: 'פלפל אדום חריף', revert: r.undo! });
    const back = await invoiceRow(inv.invoiceId);
    expect(back.status).toBe('parsed');
    expect(await db.select().from(matchRuns).where(eq(matchRuns.invoiceId, inv.invoiceId))).toEqual([]);
    expect(rematched()).not.toContain(inv.invoiceId);
  });

  it('an invoice held for low OCR confidence too is NOT released by an answer', async () => {
    const inv = await heldInvoice('פלפל אדום חריף', ['confidence', 'unlinked']);
    await callerFor(A).mapping.confirm({ supplierId: S, rawName: 'פלפל אדום חריף', productId: P });
    expect((await invoiceRow(inv.invoiceId)).status).toBe('parsed');
  });
});

describe('HIGH-3: a PO-line-only answer re-matches the invoice matched against that PO', () => {
  it('linking an order line (no invoice line) re-queues the invoice whose latest run is on that order', async () => {
    const po = await order([{ productId: null, raw: 'בצל סגול' }]);
    const [inv] = await db
      .insert(invoices)
      .values({ restaurantId: A.restaurantId, supplierId: S, status: 'matched', source: 'photo' })
      .returning({ id: invoices.id });
    await db.insert(matchRuns).values({ restaurantId: A.restaurantId, poId: po.poId, invoiceId: inv!.id, overallStatus: 'minor' });
    const r = await callerFor(A).mapping.confirm({ supplierId: S, rawName: 'בצל סגול', productId: P });
    expect(r.poLinesUpdated).toBe(1);
    expect(r.invoiceLinesUpdated).toBe(0);
    expect(rematched()).toContain(inv!.id);

    enqueued.length = 0;
    await callerFor(A).mapping.confirm({ supplierId: S, rawName: 'בצל סגול', revert: r.undo! });
    expect(rematched()).toContain(inv!.id);
  });
});

describe('MEDIUM-1: NBSP / thin-space spellings are the same question', () => {
  it('answerLink and the count agree on a line spelled with NBSP and a thin space', async () => {
    const inv = await heldInvoice('פלפל אדום חריף');
    const before = (await callerFor(A, 'chef').mapping.questionCount()).count;
    const r = await callerFor(A, 'chef').mapping.answerLink({ supplierId: S, rawName: 'פלפל אדום חריף', productId: P });
    expect(r.invoiceLinesUpdated).toBe(1);
    expect((await callerFor(A, 'chef').mapping.questionCount()).count).toBe(before - 1);
    const [l] = await db.select({ productId: invoiceLines.productId }).from(invoiceLines).where(eq(invoiceLines.id, inv.lineId));
    expect(l?.productId).toBe(P);
  });
});

describe('MEDIUM-2: undo restores a legacy alias it raised', () => {
  it('a 0.950 legacy alias raised to 0.999 by the answer is back at 0.950 after the undo', async () => {
    const [legacy] = await db
      .insert(productAliases)
      .values({ productId: P, supplierId: S, supplierNameRaw: 'פלפל אדום חריף', confidence: '0.950' })
      .returning({ id: productAliases.id });
    await heldInvoice('פלפל אדום חריף');
    const r = await callerFor(A, 'chef').mapping.answerLink({ supplierId: S, rawName: 'פלפל אדום חריף', productId: P });
    const raised = await db.select({ c: productAliases.confidence }).from(productAliases).where(eq(productAliases.id, legacy!.id));
    expect(raised[0]?.c).toBe('0.999');
    await callerFor(A, 'chef').mapping.answerLink({ supplierId: S, rawName: 'פלפל אדום חריף', productId: P, revert: r.undoToken! });
    const back = await db.select({ c: productAliases.confidence }).from(productAliases).where(eq(productAliases.id, legacy!.id));
    expect(back[0]?.c).toBe('0.950');
  });
});

describe('MEDIUM-3: one key, one confirmed product', () => {
  it('a second, different product for a key with a ≥0.999 alias → CONFLICT; nothing linked', async () => {
    const [p2] = await db
      .insert(products)
      .values({ restaurantId: A.restaurantId, supplierId: S, canonicalName: 'פלפל חריף', defaultUnit: 'ק״ג' })
      .returning({ id: products.id });
    await db.insert(productAliases).values({ productId: P, supplierId: S, supplierNameRaw: 'פלפל אדום חריף', confidence: '1.000' });
    const inv = await heldInvoice('פלפל  אדום חריף');
    await expect(
      callerFor(A).mapping.confirm({ supplierId: S, rawName: 'פלפל אדום חריף', productId: p2!.id }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const [l] = await db.select({ productId: invoiceLines.productId }).from(invoiceLines).where(eq(invoiceLines.id, inv.lineId));
    expect(l?.productId).toBeNull();
  });

  it('a name confirm with no open question → NOT_FOUND, no alias learned', async () => {
    await expect(
      callerFor(A).mapping.confirm({ supplierId: S, rawName: 'שם שלא הופיע', productId: P }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await db.select().from(productAliases).where(eq(productAliases.supplierNameRaw, 'שם שלא הופיע'))).toEqual([]);
  });
});

describe("LOW-1: answerLink learns on the question's own spelling", () => {
  it('a client-side spacing variant learns the alias on the server-side sample', async () => {
    await heldInvoice('פלפל אדום חריף');
    await callerFor(A, 'chef').mapping.answerLink({ supplierId: S, rawName: '  פלפל   אדום   חריף ', productId: P });
    const aliases = await db.select({ raw: productAliases.supplierNameRaw }).from(productAliases).where(eq(productAliases.productId, P));
    expect(aliases.map((a) => a.raw)).toEqual(['פלפל אדום חריף']);
  });
});

describe('HIGH-1: the answer undo token', () => {
  const who = { userId: 'u1', restaurantId: 'r1' };
  const change = { productId: 'p', poLineIds: [], invoiceLineIds: ['l1'], catalogItemIds: [], aliasId: null, aliasRestore: null };
  it('verifies only for the same user and restaurant, before it expires', () => {
    const t = signAnswerUndo(who, { supplierId: 's', nameKey: 'k' }, change, 1_000)!;
    expect(verifyAnswerUndo(t, who, 1_000 + UNDO_TTL_MS - 1)).toMatchObject({ supplierId: 's', nameKey: 'k', change });
    expect(verifyAnswerUndo(t, who, 1_000 + UNDO_TTL_MS + 1)).toBeNull();
    expect(verifyAnswerUndo(t, { ...who, userId: 'u2' }, 1_000)).toBeNull();
    expect(verifyAnswerUndo(t, { ...who, restaurantId: 'r2' }, 1_000)).toBeNull();
    expect(verifyAnswerUndo(`${t}x`, who, 1_000)).toBeNull();
  });
});
