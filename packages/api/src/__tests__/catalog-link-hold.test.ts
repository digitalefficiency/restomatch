import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeLeakHero } from '@restomatch/charts';
import {
  and,
  auditLog,
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
  restaurants,
  testDbUrl,
} from '@restomatch/db';
type Job = { restaurantId: string; invoiceId: string; rematch?: boolean };
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { rematchHoldReason } from '../receiving/matchTriggers';
import { signAnswerUndo, UNDO_TTL_MS, verifyAnswerUndo } from '../catalog/answerUndo';
import { resetDb, seedTenant, type Tenant } from './fixtures';
import { applyLearnedCharges, invoiceQuestionCount, orderQuestionCount } from '../catalog/linkQuestions';
import { buildMatchInputForInvoice } from '../match/buildMatchInput';

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
      // A printed VAT (18%), so a clean match is clean (round 5: an undo keeps a run with findings).
      vatAmount: '3.96',
      totalInclVat: '25.96',
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

/* ── G-08 review round 2 (31.10) ─────────────────────────────────────────── */

describe('R2 H-2: an unknown-SKU line prompts owner / manager (the chef keeps name questions)', () => {
  it('a held invoice line with an unlinked מק״ט adds one question for owner and manager, none for the chef', async () => {
    const before = {
      owner: (await callerFor(A).mapping.questionCount()).count,
      manager: (await callerFor(A, 'manager').mapping.questionCount()).count,
      chef: (await callerFor(A, 'chef').mapping.questionCount()).count,
    };
    const inv = await heldInvoice('קישוא');
    await db.update(invoiceLines).set({ supplierSku: 'Q-77' }).where(eq(invoiceLines.id, inv.lineId));
    expect((await callerFor(A).mapping.questionCount()).count).toBe(before.owner + 1);
    expect((await callerFor(A, 'manager').mapping.questionCount()).count).toBe(before.manager + 1);
    expect((await callerFor(A, 'chef').mapping.questionCount()).count).toBe(before.chef);
  });
});

describe('R2 M-3: a manual re-match refuses an invoice with open questions', () => {
  it('runForInvoice → PRECONDITION_FAILED, appCode invoice.unlinkedLines; no run written', async () => {
    await order([{ productId: P, raw: 'פלפל אדום' }]);
    const inv = await heldInvoice('פלפל אדום חריף');
    await db.update(invoices).set({ status: 'matched' }).where(eq(invoices.id, inv.invoiceId));
    const err = await callerFor(A)
      .match.runForInvoice({ invoiceId: inv.invoiceId })
      .then(() => null, (e: unknown) => e as { code: string; cause?: { appCode?: string; appParams?: unknown } });
    expect(err?.code).toBe('PRECONDITION_FAILED');
    expect(err?.cause?.appCode).toBe('invoice.unlinkedLines');
    expect(err?.cause?.appParams).toEqual({ count: 1 });
    expect(await findingTypes(inv.invoiceId)).toEqual([]);
  });
});

/**
 * An invoice: one ordered product line (2 × ₪11 = ₪22, invoice VAT rate) plus one
 * non-product line; header totals as the supplier printed them.
 */
async function invoiceWithCharge(charge: { raw: string; total: number; vatRate: number | null }, rate: number) {
  const chargeVat = Math.round(charge.total * 100 * (charge.vatRate ?? rate)) / 100;
  const excl = 22 + charge.total;
  const vat = Math.round(22 * rate * 100) / 100 + chargeVat;
  const [inv] = await db
    .insert(invoices)
    .values({
      restaurantId: A.restaurantId,
      supplierId: S,
      status: 'parsed',
      source: 'photo',
      invoiceDate: new Date(),
      totalExclVat: excl.toFixed(2),
      vatAmount: vat.toFixed(2),
      totalInclVat: (excl + vat).toFixed(2),
      ocrPayload: { provider: 'reconciled', raw: { reviewReasons: ['unlinked'], keep: 'me' } } as never,
    })
    .returning({ id: invoices.id });
  await db.insert(invoiceLines).values([
    { invoiceId: inv!.id, productId: P, rawDescription: 'פלפל אדום', qtyBilled: '2', unit: 'ק״ג', unitPriceBilled: '11', lineTotal: '22' },
    {
      invoiceId: inv!.id,
      productId: null,
      rawDescription: charge.raw,
      qtyBilled: '1',
      unit: 'יח׳',
      unitPriceBilled: charge.total.toFixed(2),
      lineTotal: charge.total.toFixed(2),
      vatRate: charge.vatRate == null ? null : charge.vatRate.toFixed(4),
    },
  ]);
  return inv!.id;
}

describe('R2 M-2: "שורת חיוב — לא מוצר" keeps a charge line out of the engine, totals reconciled', () => {
  const cases = [
    { name: 'a deposit (פיקדון ארגזים, VAT 0)', charge: { raw: 'פיקדון ארגזים', total: 10, vatRate: 0 } },
    { name: 'a delivery charge at 18% VAT', charge: { raw: 'דמי משלוח', total: 20, vatRate: 0.18 } },
    { name: 'a discount line (negative, the invoice rate)', charge: { raw: 'הנחה', total: -2, vatRate: null } },
  ];
  for (const c of cases) {
    it(`${c.name} → no UNORDERED_ITEM, TOTAL_MISMATCH, VAT_MISMATCH or PRICE finding`, async () => {
      await order([{ productId: P, raw: 'פלפל אדום' }]);
      const invoiceId = await invoiceWithCharge(c.charge, 0.18);
      const r = await callerFor(A).mapping.markCharge({ supplierId: S, rawName: c.charge.raw });
      expect(r.invoiceLinesMarked).toBe(1);
      const row = await invoiceRow(invoiceId);
      expect(row.status).toBe('matched'); // the hold released
      // jsonb merge: the other ocr_payload keys survive.
      expect(row.ocrPayload).toMatchObject({ provider: 'reconciled', raw: { keep: 'me' } });
      expect((row.ocrPayload as unknown as { chargeLineIds: string[] }).chargeLineIds).toHaveLength(1);
      await callerFor(A).match.runForInvoice({ invoiceId });
      const types = await findingTypes(invoiceId);
      for (const t of ['UNORDERED_ITEM', 'TOTAL_MISMATCH', 'VAT_MISMATCH', 'PRICE_HIGHER', 'PRICE_LOWER', 'MISSING_ON_INVOICE']) {
        expect(types).not.toContain(t);
      }
      // No longer a question for anyone.
      expect((await callerFor(A).mapping.unmapped()).some((q) => q.sampleDescription === c.charge.raw)).toBe(false);
    });
  }

  it('the undo puts exactly those lines back as questions and the invoice back on hold', async () => {
    await order([{ productId: P, raw: 'פלפל אדום' }]);
    const invoiceId = await invoiceWithCharge({ raw: 'פיקדון ארגזים', total: 10, vatRate: 0 }, 0.18);
    const r = await callerFor(A).mapping.markCharge({ supplierId: S, rawName: 'פיקדון ארגזים' });
    expect((await invoiceRow(invoiceId)).status).toBe('matched');
    await callerFor(A).mapping.markCharge({ supplierId: S, rawName: 'פיקדון ארגזים', undo: r.undo! });
    const back = await invoiceRow(invoiceId);
    expect(back.status).toBe('parsed');
    expect((back.ocrPayload as unknown as { chargeLineIds: string[] }).chargeLineIds).toEqual([]);
    expect((await callerFor(A).mapping.unmapped()).some((q) => q.sampleDescription === 'פיקדון ארגזים')).toBe(true);
  });

  it('owner / manager only; a B supplier → NOT_FOUND; another supplier of A is untouched; no ₪ returned', async () => {
    const B = await seedTenant(db, 'B');
    const [other] = await db.insert(suppliers).values({ restaurantId: A.restaurantId, name: 'ספק אחר' }).returning({ id: suppliers.id });
    const invoiceId = await invoiceWithCharge({ raw: 'פיקדון ארגזים', total: 10, vatRate: 0 }, 0.18);
    const [oInv] = await db
      .insert(invoices)
      .values({ restaurantId: A.restaurantId, supplierId: other!.id, status: 'parsed', source: 'photo', invoiceDate: new Date() })
      .returning({ id: invoices.id });
    await db.insert(invoiceLines).values({ invoiceId: oInv!.id, productId: null, rawDescription: 'פיקדון ארגזים', qtyBilled: '1', unit: 'יח׳', unitPriceBilled: '10', lineTotal: '10' });

    for (const role of ['chef', 'receiver'] as const) {
      await expect(callerFor(A, role).mapping.markCharge({ supplierId: S, rawName: 'פיקדון ארגזים' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    const [bSup] = await db.insert(suppliers).values({ restaurantId: B.restaurantId, name: 'ספק B' }).returning({ id: suppliers.id });
    await expect(callerFor(A).mapping.markCharge({ supplierId: bSup!.id, rawName: 'פיקדון ארגזים' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await invoiceRow(invoiceId)).ocrPayload).not.toHaveProperty('chargeLineIds');

    const r = await callerFor(A, 'manager').mapping.markCharge({ supplierId: S, rawName: 'פיקדון ארגזים' });
    expect(Object.keys(r).sort()).toEqual(['invoiceLinesMarked', 'learnedKey', 'linesLocked', 'rematch', 'undo']);
    expect((await invoiceRow(oInv!.id)).ocrPayload ?? {}).not.toHaveProperty('chargeLineIds');
    // A foreign undo list never touches lines of another supplier.
    const [oLine] = await db.select({ id: invoiceLines.id }).from(invoiceLines).where(eq(invoiceLines.invoiceId, oInv!.id));
    await callerFor(A).mapping.markCharge({ supplierId: S, rawName: 'פיקדון ארגזים', undo: { invoiceLineIds: [oLine!.id] } });
    expect((await invoiceRow(invoiceId)).ocrPayload).toHaveProperty('chargeLineIds');
  });
});

/* ── G-08 review round 3 (31.10) ─────────────────────────────────────────── */

/** Mark as the mapper does: the question's sample line (its amount was shown) bounds the learned key. */
async function markShown(rawName: string, supplierSku?: string) {
  const sample = await callerFor(A).mapping.chargeSample({ supplierId: S, rawName, ...(supplierSku ? { supplierSku } : {}) });
  const shownLineIds = sample ? [sample.invoiceLineId] : [];
  return callerFor(A).mapping.markCharge({ supplierId: S, rawName, ...(supplierSku ? { supplierSku } : {}), shownLineIds });
}

const reasonsOf = async (id: string) =>
  ((await invoiceRow(id)).ocrPayload as unknown as { raw?: { reviewReasons?: string[] } } | null)?.raw?.reviewReasons ?? [];

describe('R3 HIGH: a manual first match refuses an order with open questions', () => {
  it('runForInvoice on an M-4-held invoice → PRECONDITION_FAILED order.unlinkedLines; no run, no false pair', async () => {
    const po = await order([
      { productId: P, raw: 'פלפל אדום' },
      { productId: null, raw: 'בצל סגול' },
    ]);
    const inv = await heldInvoice('פלפל אדום', ['unlinkedPo']);
    await db.update(invoiceLines).set({ productId: P }).where(eq(invoiceLines.id, inv.lineId));
    const err = await callerFor(A, 'manager')
      .match.runForInvoice({ invoiceId: inv.invoiceId })
      .then(() => null, (e: unknown) => e as { code: string; cause?: { appCode?: string; appParams?: unknown } });
    expect(err?.code).toBe('PRECONDITION_FAILED');
    expect(err?.cause?.appCode).toBe('order.unlinkedLines');
    expect(err?.cause?.appParams).toEqual({ count: 1 });
    expect(await findingTypes(inv.invoiceId)).toEqual([]);
    expect(await orderQuestionCount(db, A.restaurantId, po.poId)).toBe(1);
  });

  it('a blank name-only order line is never a question (LOW): the first match runs', async () => {
    const po = await order([
      { productId: P, raw: 'פלפל אדום' },
      { productId: null, raw: '   ' },
    ]);
    expect(await orderQuestionCount(db, A.restaurantId, po.poId)).toBe(0);
    // Round 4: the first match RUNS — and the blank line is no false MISSING.
    const [inv] = await db
      .insert(invoices)
      .values({ restaurantId: A.restaurantId, supplierId: S, status: 'matched', source: 'photo', invoiceDate: new Date(), totalExclVat: '22.00' })
      .returning({ id: invoices.id });
    await db.insert(invoiceLines).values({ invoiceId: inv!.id, productId: P, rawDescription: 'פלפל אדום', qtyBilled: '2', unit: 'ק״ג', unitPriceBilled: '11', lineTotal: '22' });
    const r = await callerFor(A).match.runForInvoice({ invoiceId: inv!.id });
    expect(r.poMatched).toBe(true);
    expect(await findingTypes(inv!.id)).not.toContain('MISSING_ON_INVOICE');
  });
});

describe('R3 MEDIUM: the "awaiting question" bucket is live', () => {
  it('held for confidence AND a question → answered → leaves the bucket, the answered reason is pruned', async () => {
    await order([{ productId: P, raw: 'פלפל אדום' }]);
    const inv = await heldInvoice('פלפל אדום חריף', ['confidence', 'unlinked']);
    expect((await computeLeakHero(db, A.restaurantId)).awaitingQuestionCount).toBe(1);
    await callerFor(A).mapping.confirm({ supplierId: S, rawName: 'פלפל אדום חריף', productId: P });
    expect((await invoiceRow(inv.invoiceId)).status).toBe('parsed'); // still held for confidence
    expect(await reasonsOf(inv.invoiceId)).toEqual(['confidence']);
    expect((await computeLeakHero(db, A.restaurantId)).awaitingQuestionCount).toBe(0);
  });

  it("a 'consolidated' reason is never released nor pruned by an answer (only link reasons are)", async () => {
    const inv = await heldInvoice('פלפל אדום חריף', ['consolidated', 'unlinked']);
    await callerFor(A).mapping.confirm({ supplierId: S, rawName: 'פלפל אדום חריף', productId: P });
    expect((await invoiceRow(inv.invoiceId)).status).toBe('parsed');
    expect(await reasonsOf(inv.invoiceId)).toEqual(['consolidated']);
  });

  it('a stale reason alone never counts: reasons say unlinked but no line is unlinked → not in the bucket', async () => {
    const inv = await heldInvoice('פלפל אדום', ['lowLines', 'unlinked']);
    await db.update(invoiceLines).set({ productId: P }).where(eq(invoiceLines.id, inv.lineId));
    expect((await computeLeakHero(db, A.restaurantId)).awaitingQuestionCount).toBe(0);
  });
});

describe('R3 MEDIUM: markCharge is visible and accountable', () => {
  it('writes one audit row (who, supplier, key, lines, invoices, ₪) and {by, at} per line; the invoice page shows it', async () => {
    await order([{ productId: P, raw: 'פלפל אדום' }]);
    const invoiceId = await invoiceWithCharge({ raw: 'פיקדון ארגזים', total: 10, vatRate: 0 }, 0.18);
    await callerFor(A).mapping.markCharge({ supplierId: S, rawName: 'פיקדון ארגזים' });
    const audits = await db.select().from(auditLog).where(eq(auditLog.restaurantId, A.restaurantId));
    const mark = audits.find((a) => a.action === 'mapping.markCharge');
    expect(mark).toMatchObject({ userId: A.ownerUserId, entityType: 'supplier', entityId: S });
    expect(mark!.after).toMatchObject({ nameKey: 'פיקדון ארגזים', lineCount: 1, invoiceIds: [invoiceId], chargedIls: 10, learnedKey: true });
    const meta = (await invoiceRow(invoiceId)).ocrPayload as unknown as { chargeLines: Array<{ id: string; by: string; at: string }> };
    expect(meta.chargeLines).toHaveLength(1);
    expect(meta.chargeLines[0]!.by).toBe(A.ownerUserId);
    const page = await callerFor(A).receiving.getInvoice({ invoiceId });
    const charged = page.lines.filter((l) => l.charge);
    expect(charged).toHaveLength(1);
    expect(charged[0]!.rawDescription).toBe('פיקדון ארגזים');
    expect(charged[0]!.charge).toMatchObject({ auto: false });
  });
});

describe('R3 MEDIUM: a charge answer is learned', () => {
  it("week 2's same line is pre-marked a charge line with no hold; its order line is no question either", async () => {
    await order([{ productId: P, raw: 'פלפל אדום' }]);
    await invoiceWithCharge({ raw: 'פיקדון ארגזים', total: 10, vatRate: 0 }, 0.18);
    await markShown('פיקדון ארגזים');
    expect(await callerFor(A).mapping.chargeKeys()).toEqual([
      expect.objectContaining({ supplierId: S, sku: null, nameKey: 'פיקדון ארגזים' }),
    ]);

    // Week 2: OCR wrote the lines and held the invoice for the unlinked deposit line.
    const week2 = await invoiceWithCharge({ raw: '  פיקדון   ארגזים ', total: 10, vatRate: 0 }, 0.18);
    const r = await applyLearnedCharges(db, A.restaurantId, week2);
    expect(r).toEqual({ charged: 1, released: true });
    const row = await invoiceRow(week2);
    expect(row.status).toBe('matched');
    expect((row.ocrPayload as unknown as { chargeLineIds: string[] }).chargeLineIds).toHaveLength(1);
    await callerFor(A).match.runForInvoice({ invoiceId: week2 });
    expect(await findingTypes(week2)).not.toContain('UNORDERED_ITEM');

    // An order line of the learned key is not a question (M-4's escape for "משלוח").
    const po = await order([{ productId: P, raw: 'פלפל אדום' }, { productId: null, raw: 'פיקדון ארגזים' }]);
    expect(await orderQuestionCount(db, A.restaurantId, po.poId)).toBe(0);
  });

  it('removeChargeKey forgets it (audited); the undo of a mark forgets the key it learned; owner/manager only; B isolated', async () => {
    const B = await seedTenant(db, 'B');
    await invoiceWithCharge({ raw: 'פיקדון ארגזים', total: 10, vatRate: 0 }, 0.18);
    const m = await callerFor(A).mapping.markCharge({ supplierId: S, rawName: 'פיקדון ארגזים' });
    expect(m.undo).toMatchObject({ forgetKey: true });
    await expect(callerFor(A, 'chef').mapping.chargeKeys()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      callerFor(A, 'chef').mapping.removeChargeKey({ supplierId: S, sku: null, nameKey: 'פיקדון ארגזים' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await callerFor(B).mapping.chargeKeys()).toEqual([]);
    const [bSup] = await db.insert(suppliers).values({ restaurantId: B.restaurantId, name: 'ספק B' }).returning({ id: suppliers.id });
    await expect(
      callerFor(A).mapping.removeChargeKey({ supplierId: bSup!.id, sku: null, nameKey: 'פיקדון ארגזים' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await callerFor(A).mapping.removeChargeKey({ supplierId: S, sku: null, nameKey: 'פיקדון ארגזים' });
    expect(await callerFor(A).mapping.chargeKeys()).toEqual([]);
    const audits = await db.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.restaurantId, A.restaurantId));
    expect(audits.map((a) => a.action)).toContain('mapping.removeChargeKey');

    // Mark again (learns again), then undo: the key goes with it.
    await db.update(restaurants).set({ settings: {} }).where(eq(restaurants.id, A.restaurantId));
    const inv2 = await invoiceWithCharge({ raw: 'דמי משלוח', total: 20, vatRate: 0.18 }, 0.18);
    const m2 = await callerFor(A).mapping.markCharge({ supplierId: S, rawName: 'דמי משלוח' });
    expect((await callerFor(A).mapping.chargeKeys()).map((k) => k.nameKey)).toEqual(['דמי משלוח']);
    await callerFor(A).mapping.markCharge({ supplierId: S, rawName: 'דמי משלוח', undo: m2.undo! });
    expect(await callerFor(A).mapping.chargeKeys()).toEqual([]);
    expect((await invoiceRow(inv2)).ocrPayload).toMatchObject({ chargeLines: [] });
  });
});

describe('R3 LOWs', () => {
  it('a NULL header total stays 0 after the charge subtraction (never negative)', async () => {
    const [inv] = await db
      .insert(invoices)
      .values({ restaurantId: A.restaurantId, supplierId: S, status: 'matched', source: 'photo', invoiceDate: new Date() })
      .returning({ id: invoices.id });
    const [charge] = await db
      .insert(invoiceLines)
      .values([
        { invoiceId: inv!.id, productId: P, rawDescription: 'פלפל אדום', qtyBilled: '2', unit: 'ק״ג', unitPriceBilled: '11', lineTotal: '22' },
        { invoiceId: inv!.id, productId: null, rawDescription: 'פיקדון ארגזים', qtyBilled: '1', unit: 'יח׳', unitPriceBilled: '10', lineTotal: '10', vatRate: '0' },
      ])
      .returning({ id: invoiceLines.id, raw: invoiceLines.rawDescription });
    void charge;
    await callerFor(A).mapping.markCharge({ supplierId: S, rawName: 'פיקדון ארגזים' });
    const built = await buildMatchInputForInvoice(db, A.restaurantId, inv!.id);
    expect(built!.input.invoice).toMatchObject({ totalExclVat: 0, vatAmount: 0, totalInclVat: 0 });
  });

  it('an invoice whose every line is a charge matches clean (no lines to compare), not "waiting" forever', async () => {
    await order([{ productId: P, raw: 'פלפל אדום' }]);
    const [inv] = await db
      .insert(invoices)
      .values({
        restaurantId: A.restaurantId,
        supplierId: S,
        status: 'parsed',
        source: 'photo',
        invoiceDate: new Date(),
        totalExclVat: '10.00',
        vatAmount: '0.00',
        totalInclVat: '10.00',
        ocrPayload: { provider: 'reconciled', raw: { reviewReasons: ['unlinked'] } } as never,
      })
      .returning({ id: invoices.id });
    await db.insert(invoiceLines).values({ invoiceId: inv!.id, productId: null, rawDescription: 'פיקדון ארגזים', qtyBilled: '1', unit: 'יח׳', unitPriceBilled: '10', lineTotal: '10', vatRate: '0' });
    await callerFor(A).mapping.markCharge({ supplierId: S, rawName: 'פיקדון ארגזים' });
    expect((await invoiceRow(inv!.id)).status).toBe('matched');
    const r = await callerFor(A).match.runForInvoice({ invoiceId: inv!.id });
    expect(r.status).toBe('clean');
    expect(await findingTypes(inv!.id)).toEqual([]);
    const hero = await computeLeakHero(db, A.restaurantId);
    expect(hero.awaitingQuestionCount).toBe(0);
  });

  it('markCharge on a key with only an order line (no invoice line yet) learns it, so the order is no longer held', async () => {
    const po = await order([{ productId: P, raw: 'פלפל אדום' }, { productId: null, raw: 'משלוח' }]);
    expect(await orderQuestionCount(db, A.restaurantId, po.poId)).toBe(1);
    const r = await callerFor(A).mapping.markCharge({ supplierId: S, rawName: 'משלוח' });
    expect(r).toMatchObject({ invoiceLinesMarked: 0, learnedKey: true });
    expect(await orderQuestionCount(db, A.restaurantId, po.poId)).toBe(0);
  });
});

/* ── G-08 review round 4 (1.11) — every money test RUNS A MATCH ─────────── */

async function plainInvoice(opts: { number?: string; excl: string; vat: string; incl: string; status?: 'parsed' | 'matched'; reasons?: string[] }) {
  const [inv] = await db
    .insert(invoices)
    .values({
      restaurantId: A.restaurantId,
      supplierId: S,
      ...(opts.number ? { invoiceNumber: opts.number } : {}),
      status: opts.status ?? 'matched',
      source: 'photo',
      invoiceDate: new Date(),
      totalExclVat: opts.excl,
      vatAmount: opts.vat,
      totalInclVat: opts.incl,
      ...(opts.reasons ? { ocrPayload: { provider: 'reconciled', raw: { reviewReasons: opts.reasons } } as never } : {}),
    })
    .returning({ id: invoices.id });
  return inv!.id;
}
async function addLine(invoiceId: string, l: { productId: string | null; raw: string; total: string; sku?: string; vatRate?: string }) {
  const [row] = await db
    .insert(invoiceLines)
    .values({
      invoiceId,
      productId: l.productId,
      rawDescription: l.raw,
      ...(l.sku ? { supplierSku: l.sku } : {}),
      qtyBilled: l.productId ? '2' : '1',
      unit: 'ק״ג',
      unitPriceBilled: l.productId ? '11' : l.total,
      lineTotal: l.total,
      ...(l.vatRate ? { vatRate: l.vatRate } : {}),
    })
    .returning({ id: invoiceLines.id });
  return row!.id;
}

describe('R4 HIGH: a learned key on an ORDER line never reaches the engine', () => {
  it('order "משלוח" (no product) learned as a charge → the first match runs with no MISSING_ON_INVOICE; an order-held invoice is released by the mark', async () => {
    const po = await order([{ productId: P, raw: 'פלפל אדום' }, { productId: null, raw: 'משלוח' }]);
    // The OCR'd invoice for it waits for the order's question (M-4).
    const inv = await plainInvoice({ excl: '22.00', vat: '3.96', incl: '25.96', status: 'parsed', reasons: ['unlinkedPo'] });
    await addLine(inv, { productId: P, raw: 'פלפל אדום', total: '22' });
    await db
      .update(invoices)
      .set({ ocrPayload: { provider: 'reconciled', raw: { reviewReasons: ['unlinkedPo'] }, heldPoId: po.poId } as never })
      .where(eq(invoices.id, inv));
    await callerFor(A).mapping.markCharge({ supplierId: S, rawName: 'משלוח' });
    expect((await invoiceRow(inv)).status).toBe('matched'); // released by the mark
    await callerFor(A).match.runForInvoice({ invoiceId: inv });
    const types = await findingTypes(inv);
    expect(types).not.toContain('MISSING_ON_INVOICE');
    expect(types).not.toContain('UNORDERED_ITEM');
  });
});

describe('R4 MEDIUM: money truth for charge lines', () => {
  it('an "all-charge" invoice whose printed header is still far from its charges is checked like any invoice (no silent ₪0)', async () => {
    const inv = await plainInvoice({ excl: '5000.00', vat: '900.00', incl: '5900.00', status: 'parsed', reasons: ['unlinked'] });
    await addLine(inv, { productId: null, raw: 'הובלה', total: '50' });
    await callerFor(A).mapping.markCharge({ supplierId: S, rawName: 'הובלה' });
    const r = await callerFor(A).match.runForInvoice({ invoiceId: inv });
    expect(r.totalDiscrepancyAmount).toBeGreaterThan(0);
    expect(await findingTypes(inv)).toContain('TOTAL_MISMATCH');
  });

  it('a learned key auto-marks only within the amount it was answered at (+ the price tolerance); a SKU key needs the same name', async () => {
    const first = await plainInvoice({ excl: '10.00', vat: '0', incl: '10.00', status: 'parsed', reasons: ['unlinked'] });
    await addLine(first, { productId: null, raw: 'פיקדון ארגזים', total: '10', vatRate: '0' });
    await markShown('פיקדון ארגזים');
    expect((await callerFor(A).mapping.chargeKeys())[0]).toMatchObject({ rawName: 'פיקדון ארגזים' });

    // ₪10.20 is within 2% of ₪10 → auto-marked, released, matched.
    const ok = await plainInvoice({ excl: '10.20', vat: '0', incl: '10.20', status: 'parsed', reasons: ['unlinked'] });
    await addLine(ok, { productId: null, raw: 'פיקדון ארגזים', total: '10.20', vatRate: '0' });
    expect(await applyLearnedCharges(db, A.restaurantId, ok)).toEqual({ charged: 1, released: true });

    // ₪100 under the same name is a question, never hidden — and a match is refused.
    const inflated = await plainInvoice({ excl: '100.00', vat: '0', incl: '100.00', status: 'parsed', reasons: ['unlinked'] });
    await addLine(inflated, { productId: null, raw: 'פיקדון ארגזים', total: '100', vatRate: '0' });
    expect(await applyLearnedCharges(db, A.restaurantId, inflated)).toEqual({ charged: 0, released: false });
    expect((await invoiceRow(inflated)).status).toBe('parsed');
    await expect(callerFor(A).match.runForInvoice({ invoiceId: inflated })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });

    // A SKU key: the same מק״ט under another name is a question.
    const skuInv = await plainInvoice({ excl: '20.00', vat: '3.60', incl: '23.60', status: 'parsed', reasons: ['unlinked'] });
    await addLine(skuInv, { productId: null, raw: 'דמי משלוח', total: '20', sku: 'DLV-1' });
    await markShown('דמי משלוח', 'DLV-1');
    expect((await callerFor(A).mapping.chargeKeys()).find((k) => k.sku === 'DLV-1')).toMatchObject({ nameKey: 'דמי משלוח' });
    const misused = await plainInvoice({ excl: '20.00', vat: '3.60', incl: '23.60', status: 'parsed', reasons: ['unlinked'] });
    await addLine(misused, { productId: null, raw: 'גבינה צהובה', total: '20', sku: 'DLV-1' });
    expect(await applyLearnedCharges(db, A.restaurantId, misused)).toEqual({ charged: 0, released: false });
  });

  it('a duplicate copy is never charge-filtered: its DUPLICATE_INVOICE ₪ is the whole printed invoice', async () => {
    const orig = await plainInvoice({ number: 'DUP-7', excl: '50.00', vat: '9.00', incl: '59.00' });
    await addLine(orig, { productId: null, raw: 'הובלה', total: '50' });
    await callerFor(A).mapping.markCharge({ supplierId: S, rawName: 'הובלה' });
    const copy = await plainInvoice({ excl: '50.00', vat: '9.00', incl: '59.00' });
    await addLine(copy, { productId: null, raw: 'הובלה', total: '50' });
    // The copy was stored without its number (invoices_dedupe_idx) and points at the original.
    await db
      .update(invoices)
      .set({ ocrPayload: { provider: 'reconciled', raw: { duplicateOf: { invoiceId: orig, invoiceNumber: 'DUP-7' } }, chargeLineIds: [] } as never })
      .where(eq(invoices.id, copy));
    // Mark the copy's line too (a person did, or a learned key would have).
    const [copyLine] = await db.select({ id: invoiceLines.id }).from(invoiceLines).where(eq(invoiceLines.invoiceId, copy));
    await db
      .update(invoices)
      .set({ ocrPayload: { provider: 'reconciled', raw: { duplicateOf: { invoiceId: orig, invoiceNumber: 'DUP-7' } }, chargeLineIds: [copyLine!.id] } as never })
      .where(eq(invoices.id, copy));
    await callerFor(A).match.runForInvoice({ invoiceId: copy });
    const [dup] = await db
      .select({ delta: discrepancies.deltaAmount })
      .from(discrepancies)
      .innerJoin(matchRuns, eq(matchRuns.id, discrepancies.matchRunId))
      .where(and(eq(matchRuns.invoiceId, copy), eq(discrepancies.type, 'DUPLICATE_INVOICE')));
    expect(Number(dup!.delta)).toBe(59);
  });

  it('removeChargeKey puts the key\'s marked lines on UNPAID invoices back as questions (their ₪ returns); a paid invoice is left alone', async () => {
    const unpaid = await plainInvoice({ excl: '10.00', vat: '0', incl: '10.00', status: 'parsed', reasons: ['unlinked'] });
    await addLine(unpaid, { productId: null, raw: 'פיקדון ארגזים', total: '10', vatRate: '0' });
    const paid = await plainInvoice({ excl: '10.00', vat: '0', incl: '10.00' });
    await addLine(paid, { productId: null, raw: 'פיקדון ארגזים', total: '10', vatRate: '0' });
    await callerFor(A).mapping.markCharge({ supplierId: S, rawName: 'פיקדון ארגזים' });
    await db.update(invoices).set({ status: 'paid' }).where(eq(invoices.id, paid));
    const r = await callerFor(A).mapping.removeChargeKey({ supplierId: S, sku: null, nameKey: 'פיקדון ארגזים' });
    // The paid invoice's mark is signed off: it stays (round 5) and is reported.
    expect(r).toEqual({ removed: true, linesReturned: 1, linesLocked: 1 });
    expect((await invoiceRow(unpaid)).ocrPayload).toMatchObject({ chargeLineIds: [] });
    expect((await invoiceRow(unpaid)).status).toBe('parsed');
    expect(((await invoiceRow(paid)).ocrPayload as unknown as { chargeLineIds: string[] }).chargeLineIds).toHaveLength(1);
    await expect(callerFor(A).match.runForInvoice({ invoiceId: unpaid })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('a wrong mark is reversible from the invoice page any time: getInvoice gives the key, the undo returns that line only', async () => {
    const inv = await plainInvoice({ excl: '32.00', vat: '3.96', incl: '35.96', status: 'parsed', reasons: ['unlinked'] });
    await addLine(inv, { productId: P, raw: 'פלפל אדום', total: '22' });
    const line = await addLine(inv, { productId: null, raw: 'פיקדון ארגזים', total: '10', vatRate: '0', sku: 'DEP-1' });
    await callerFor(A).mapping.markCharge({ supplierId: S, supplierSku: 'DEP-1', rawName: 'פיקדון ארגזים' });
    const page = await callerFor(A).receiving.getInvoice({ invoiceId: inv });
    const l = page.lines.find((x) => x.id === line)!;
    expect(l).toMatchObject({ supplierSku: 'DEP-1', charge: expect.anything() });
    await callerFor(A, 'manager').mapping.markCharge({
      supplierId: S,
      supplierSku: l.supplierSku!,
      rawName: l.rawDescription,
      undo: { invoiceLineIds: [l.id] },
    });
    expect((await callerFor(A).receiving.getInvoice({ invoiceId: inv })).lines.find((x) => x.id === line)!.charge).toBeNull();
  });
});

describe('R4 LOW-8: an undo after a prune puts the question back in the bucket', () => {
  it('held for confidence + a question → answered (pruned) → undone → "unlinked" is back and the bucket counts it', async () => {
    await order([{ productId: P, raw: 'פלפל אדום' }]);
    const inv = await heldInvoice('פלפל אדום חריף', ['confidence', 'unlinked']);
    const r = await callerFor(A).mapping.confirm({ supplierId: S, rawName: 'פלפל אדום חריף', productId: P });
    expect(await reasonsOf(inv.invoiceId)).toEqual(['confidence']);
    await callerFor(A).mapping.confirm({ supplierId: S, rawName: 'פלפל אדום חריף', revert: r.undo! });
    expect(await reasonsOf(inv.invoiceId)).toEqual(['confidence', 'unlinked']);
    expect((await computeLeakHero(db, A.restaurantId)).awaitingQuestionCount).toBe(1);
  });
});

/* ── G-08 review round 5 (1.11) ─────────────────────────────────────────── */

describe('R5 HIGH-2: an undo never deletes a run with findings or the people\'s decisions', () => {
  it('a disputed invoice with a decided finding → undo the charge → the run and the decision stay; it re-matches instead', async () => {
    await order([{ productId: P, raw: 'פלפל אדום' }]);
    // Billed above the order (₪15 vs ₪11) + a deposit line.
    const inv = await plainInvoice({ excl: '40.00', vat: '5.40', incl: '45.40', status: 'parsed', reasons: ['unlinked'] });
    await db.insert(invoiceLines).values({ invoiceId: inv, productId: P, rawDescription: 'פלפל אדום', qtyBilled: '2', unit: 'ק״ג', unitPriceBilled: '15', lineTotal: '30' });
    const dep = await addLine(inv, { productId: null, raw: 'פיקדון ארגזים', total: '10', vatRate: '0' });
    await markShown('פיקדון ארגזים');
    await callerFor(A).match.runForInvoice({ invoiceId: inv });
    const [finding] = await db
      .select({ id: discrepancies.id })
      .from(discrepancies)
      .innerJoin(matchRuns, eq(matchRuns.id, discrepancies.matchRunId))
      .where(and(eq(matchRuns.invoiceId, inv), eq(discrepancies.type, 'PRICE_HIGHER')));
    expect(finding).toBeDefined();
    await callerFor(A).approvals.reject({ discrepancyId: finding!.id, reason: 'agreed by phone' });
    await db.update(invoices).set({ status: 'disputed' }).where(eq(invoices.id, inv));
    enqueued.length = 0;

    await callerFor(A).mapping.markCharge({ supplierId: S, rawName: 'פיקדון ארגזים', undo: { invoiceLineIds: [dep] } });
    const [still] = await db.select({ status: discrepancies.resolutionStatus }).from(discrepancies).where(eq(discrepancies.id, finding!.id));
    expect(still!.status).toBe('rejected'); // the decision is kept
    expect((await invoiceRow(inv)).status).toBe('disputed'); // not re-held
    expect(rematched()).toContain(inv); // re-matched instead (the job keeps decisions)
  });

  it('an approved invoice is never un-marked (linesLocked); its marks stay', async () => {
    const inv = await plainInvoice({ excl: '10.00', vat: '0', incl: '10.00', status: 'parsed', reasons: ['unlinked'] });
    const dep = await addLine(inv, { productId: null, raw: 'פיקדון ארגזים', total: '10', vatRate: '0' });
    await markShown('פיקדון ארגזים');
    await db.update(invoices).set({ status: 'approved' }).where(eq(invoices.id, inv));
    const r = await callerFor(A).mapping.markCharge({ supplierId: S, rawName: 'פיקדון ארגזים', undo: { invoiceLineIds: [dep] } });
    expect(r.linesLocked).toBe(1);
    expect(((await invoiceRow(inv)).ocrPayload as unknown as { chargeLineIds: string[] }).chargeLineIds).toEqual([dep]);
  });
});

describe('R5 MEDIUM-3: a manual SKU mark is SKU + name, like a learned SKU key', () => {
  it('two lines share a מק״ט under different names → marking one name marks only that line', async () => {
    const inv = await plainInvoice({ excl: '70.00', vat: '12.60', incl: '82.60', status: 'parsed', reasons: ['unlinked'] });
    await addLine(inv, { productId: null, raw: 'הובלה', total: '20', sku: 'X-9' });
    await addLine(inv, { productId: null, raw: 'גבינה צהובה', total: '50', sku: 'X-9' });
    const r = await callerFor(A).mapping.markCharge({ supplierId: S, supplierSku: 'X-9', rawName: 'הובלה' });
    expect(r.invoiceLinesMarked).toBe(1);
    expect(await invoiceQuestionCount(db, A.restaurantId, inv)).toBe(1);
  });
});

describe('R5 MEDIUM-4: "all-charge" is clean only when subtotal, VAT and total all reconcile', () => {
  it('a NULL subtotal with a misread VAT is checked (no silent ₪0); nothing printed is checked too', async () => {
    for (const header of [
      { excl: null, vat: '50.00', incl: '100.00' },
      { excl: null, vat: null, incl: null },
    ]) {
      const [row] = await db
        .insert(invoices)
        .values({
          restaurantId: A.restaurantId,
          supplierId: S,
          status: 'parsed',
          source: 'photo',
          invoiceDate: new Date(),
          totalExclVat: header.excl,
          vatAmount: header.vat,
          totalInclVat: header.incl,
          ocrPayload: { provider: 'reconciled', raw: { reviewReasons: ['unlinked'] } } as never,
        })
        .returning({ id: invoices.id });
      await addLine(row!.id, { productId: null, raw: 'הובלה', total: '50', vatRate: '0' });
      await callerFor(A).mapping.markCharge({ supplierId: S, rawName: 'הובלה' }).catch(() => null);
      const r = await callerFor(A).match.runForInvoice({ invoiceId: row!.id });
      expect(r.status).not.toBe('clean');
      expect(r.discrepancyCount).toBeGreaterThan(0);
    }
  });
});

describe('R5 MEDIUM-5: a learned key bounds what it hides', () => {
  it('learns only from the shown line; needs the same sign; at most one auto-mark per key per invoice', async () => {
    // Answered without being shown an amount → learns no range → never auto-marks.
    const a = await plainInvoice({ excl: '10.00', vat: '0', incl: '10.00', status: 'parsed', reasons: ['unlinked'] });
    await addLine(a, { productId: null, raw: 'פיקדון ארגזים', total: '10', vatRate: '0' });
    await callerFor(A).mapping.markCharge({ supplierId: S, rawName: 'פיקדון ארגזים' });
    const b = await plainInvoice({ excl: '10.00', vat: '0', incl: '10.00', status: 'parsed', reasons: ['unlinked'] });
    await addLine(b, { productId: null, raw: 'פיקדון ארגזים', total: '10', vatRate: '0' });
    expect(await applyLearnedCharges(db, A.restaurantId, b)).toEqual({ charged: 0, released: false });

    // Answered on the shown ₪10 line → the range is [₪10, ₪10].
    await markShown('פיקדון ארגזים');
    const flip = await plainInvoice({ excl: '-10.00', vat: '0', incl: '-10.00', status: 'parsed', reasons: ['unlinked'] });
    await addLine(flip, { productId: null, raw: 'פיקדון ארגזים', total: '-10', vatRate: '0' });
    expect(await applyLearnedCharges(db, A.restaurantId, flip)).toEqual({ charged: 0, released: false }); // sign flip → a question

    const twice = await plainInvoice({ excl: '20.00', vat: '0', incl: '20.00', status: 'parsed', reasons: ['unlinked'] });
    await addLine(twice, { productId: null, raw: 'פיקדון ארגזים', total: '10', vatRate: '0' });
    await addLine(twice, { productId: null, raw: 'פיקדון ארגזים', total: '10', vatRate: '0' });
    expect(await applyLearnedCharges(db, A.restaurantId, twice)).toEqual({ charged: 1, released: false }); // the 2nd is a question
    expect(await invoiceQuestionCount(db, A.restaurantId, twice)).toBe(1);
  });
});

describe('R5: mapping.chargeSample (the amount shown with "שורת חיוב")', () => {
  it('owner/manager only; a B supplier → NOT_FOUND; the question list itself carries no ₪', async () => {
    const B = await seedTenant(db, 'B');
    const inv = await plainInvoice({ excl: '10.00', vat: '0', incl: '10.00', status: 'parsed', reasons: ['unlinked'] });
    const line = await addLine(inv, { productId: null, raw: 'פיקדון ארגזים', total: '10', vatRate: '0' });
    expect(await callerFor(A, 'manager').mapping.chargeSample({ supplierId: S, rawName: 'פיקדון ארגזים' })).toMatchObject({
      invoiceLineId: line,
      lineTotal: 10,
    });
    await expect(callerFor(A, 'chef').mapping.chargeSample({ supplierId: S, rawName: 'פיקדון ארגזים' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const [bSup] = await db.insert(suppliers).values({ restaurantId: B.restaurantId, name: 'ספק B' }).returning({ id: suppliers.id });
    await expect(callerFor(A).mapping.chargeSample({ supplierId: bSup!.id, rawName: 'פיקדון ארגזים' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(JSON.stringify(await callerFor(A).mapping.unmapped())).not.toMatch(/lineTotal|₪/);
  });
});
