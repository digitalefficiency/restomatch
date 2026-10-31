import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { and, auditLog, creditNotes, createDb, discrepancies, eq, goodsReceipts, grLines, invoiceLines, invoices, matchRuns, poLines, productAliases, products, purchaseOrders, recoveryClaims, restaurants, testDbUrl } from '@restomatch/db';
import { computeInvoiceLeak } from '@restomatch/charts';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

/**
 * B8 — when OCR fails the invoice page says "הזינו את השורות ידנית": the manager
 * adds / deletes lines by hand. The header totals follow the lines to the agora
 * (integer agorot, NUMERIC strings in the DB), the invoice is re-matched, and
 * every invoice edit leaves one audit row with before / after.
 */
const db = createDb(testDbUrl());
let A: Tenant;
let failedId: string;

const as = (role: Session['role']) =>
  appRouter.createCaller({ db, session: { userId: A.ownerUserId, restaurantId: A.restaurantId, role } } as AppContext);
const audits = (action: string) => db.select().from(auditLog).where(and(eq(auditLog.restaurantId, A.restaurantId), eq(auditLog.action, action)));
const header = async (id: string) =>
  (await db.select({ excl: invoices.totalExclVat, vat: invoices.vatAmount, incl: invoices.totalInclVat }).from(invoices).where(eq(invoices.id, id)))[0]!;

beforeEach(async () => {
  await resetDb(db);
  await seedPlans(db);
  A = await seedTenant(db, 'ML');
  await db.update(restaurants).set({ vatRate: '0.18' }).where(eq(restaurants.id, A.restaurantId));
  // The delivery was counted (receipt closed): a re-match after an edit is allowed
  // (an OPEN receipt holds it — M-2, tested on its own below).
  await db.update(goodsReceipts).set({ status: 'completed' }).where(eq(goodsReceipts.id, A.grId));
  // A scan the OCR could not read: 'parsed', confidence 0, no lines, no totals.
  const [inv] = await db
    .insert(invoices)
    .values({
      restaurantId: A.restaurantId,
      supplierId: A.supplierId,
      status: 'parsed',
      source: 'photo',
      rawImageUrl: 'https://example.com/failed.jpg',
      ocrConfidence: '0',
      ocrPayload: { provider: 'claude_vision', raw: { ocrFailed: true, reason: 'extraction_failed' } },
    })
    .returning();
  failedId = inv!.id;
});
afterAll(() => resetDb(db));

describe('manual invoice lines (B8)', () => {
  it('adding lines recomputes the header to the agora and re-matches the invoice', async () => {
    // 2.5 × 12.345 = 30.8625 → 30.86 (half-up); 3 × 9.99 = 29.97.
    const a = await as('manager').receiving.addInvoiceLine({
      invoiceId: failedId,
      line: { rawDescription: 'עגבניות', qtyBilled: 2.5, unit: 'kg', unitPriceBilled: 12.345, productId: A.productId },
    });
    expect(a.totals).toEqual({ totalExclVat: '30.86', vatAmount: '5.55', totalInclVat: '36.41' }); // 30.86 × 18% = 5.5548
    expect(a.rematched).toBe(true);
    const [line] = await db.select().from(invoiceLines).where(eq(invoiceLines.id, a.lineId));
    expect(line).toMatchObject({ qtyBilled: '2.500', unitPriceBilled: '12.3450', lineTotal: '30.86' });

    const b = await as('owner').receiving.addInvoiceLine({
      invoiceId: failedId,
      line: { rawDescription: 'מלפפונים', qtyBilled: 3, unit: 'kg', unitPriceBilled: 9.99 },
    });
    // 60.83 × 18% = 10.9494 → 10.95.
    expect(b.totals).toEqual({ totalExclVat: '60.83', vatAmount: '10.95', totalInclVat: '71.78' });
    expect(await header(failedId)).toEqual({ excl: '60.83', vat: '10.95', incl: '71.78' });
    expect(await db.select().from(matchRuns).where(eq(matchRuns.invoiceId, failedId))).toHaveLength(1);
  });

  it('deleting a line recomputes the totals and re-matches', async () => {
    const a = await as('manager').receiving.addInvoiceLine({
      invoiceId: failedId,
      line: { rawDescription: 'עגבניות', qtyBilled: 2, unit: 'kg', unitPriceBilled: 10 },
    });
    await as('manager').receiving.addInvoiceLine({
      invoiceId: failedId,
      line: { rawDescription: 'בצל', qtyBilled: 1, unit: 'kg', unitPriceBilled: 5.5 },
    });
    const [runBefore] = await db.select({ id: matchRuns.id }).from(matchRuns).where(eq(matchRuns.invoiceId, failedId));
    const del = await as('manager').receiving.deleteInvoiceLine({ lineId: a.lineId });
    expect(del.totals).toEqual({ totalExclVat: '5.50', vatAmount: '0.99', totalInclVat: '6.49' });
    expect(del.rematched).toBe(true);
    const runs = await db.select({ id: matchRuns.id }).from(matchRuns).where(eq(matchRuns.invoiceId, failedId));
    expect(runs).toHaveLength(1);
    expect(runs[0]!.id).not.toBe(runBefore!.id); // a fresh run
    expect(await db.select().from(invoiceLines).where(eq(invoiceLines.id, a.lineId))).toHaveLength(0);
  });

  it('the supplier VAT rate wins over the restaurant default', async () => {
    const { suppliers } = await import('@restomatch/db');
    await db.update(suppliers).set({ vatRate: '0' }).where(eq(suppliers.id, A.supplierId)); // e.g. VAT-exempt produce
    const a = await as('manager').receiving.addInvoiceLine({
      invoiceId: failedId,
      line: { rawDescription: 'פירות', qtyBilled: 1, unit: 'kg', unitPriceBilled: 7.3 },
    });
    expect(a.totals).toEqual({ totalExclVat: '7.30', vatAmount: '0.00', totalInclVat: '7.30' });
  });

  it('a receiver cannot add or delete lines (no ₪ for the receiver)', async () => {
    await expect(
      as('receiver').receiving.addInvoiceLine({ invoiceId: failedId, line: { rawDescription: 'x', qtyBilled: 1, unit: 'kg', unitPriceBilled: 1 } }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(as('receiver').receiving.deleteInvoiceLine({ lineId: A.invoiceLineId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('a read invoice (matched) is corrected with updateInvoiceLine, not by adding/deleting lines', async () => {
    await expect(
      as('manager').receiving.addInvoiceLine({ invoiceId: A.invoiceId, line: { rawDescription: 'x', qtyBilled: 1, unit: 'kg', unitPriceBilled: 1 } }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    await expect(as('manager').receiving.deleteInvoiceLine({ lineId: A.invoiceLineId })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, A.invoiceId))).toHaveLength(1);
  });

  it('each of the four invoice edits writes ONE audit row with before and after', async () => {
    const added = await as('manager').receiving.addInvoiceLine({
      invoiceId: failedId,
      line: { rawDescription: 'עגבניות', qtyBilled: 2, unit: 'kg', unitPriceBilled: 10 },
    });
    await as('manager').receiving.updateInvoiceLine({ lineId: added.lineId, patch: { unitPriceBilled: 11 } });
    await as('manager').receiving.updateInvoiceHeader({ invoiceId: failedId, patch: { invoiceNumber: 'MAN-1' } });
    await as('manager').receiving.deleteInvoiceLine({ lineId: added.lineId });

    const [add] = await audits('receiving.invoice_line_added');
    expect(add).toMatchObject({ entityType: 'invoice_line', entityId: added.lineId, userId: A.ownerUserId });
    expect(add!.before).toEqual({ invoiceId: failedId, totals: { totalExclVat: null, vatAmount: null, totalInclVat: null } });
    expect(add!.after).toMatchObject({ invoiceId: failedId, line: { lineTotal: '20.00' }, totals: { totalExclVat: '20.00' } });

    const [upd] = await audits('receiving.invoice_line_updated');
    expect(upd!.before).toEqual({ invoiceId: failedId, unitPriceBilled: '10.0000' });
    expect(upd!.after).toEqual({ invoiceId: failedId, unitPriceBilled: '11' });

    const [hdr] = await audits('receiving.invoice_header_updated');
    expect(hdr).toMatchObject({ entityType: 'invoice', entityId: failedId });
    expect(hdr!.before).toEqual({ invoiceNumber: null });
    expect(hdr!.after).toEqual({ invoiceNumber: 'MAN-1' });

    const [del] = await audits('receiving.invoice_line_deleted');
    expect(del!.before).toMatchObject({ invoiceId: failedId, line: { rawDescription: 'עגבניות' } });
    expect(del!.after).toEqual({ invoiceId: failedId, totals: { totalExclVat: '0.00', vatAmount: '0.00', totalInclVat: '0.00' } });

    for (const a of ['receiving.invoice_line_added', 'receiving.invoice_line_updated', 'receiving.invoice_header_updated', 'receiving.invoice_line_deleted']) {
      expect(await audits(a)).toHaveLength(1);
    }
  });

  it('a held-for-review read stays editable line by line after the re-match; an approved invoice is locked', async () => {
    await db.update(invoices).set({ ocrPayload: { provider: 'reconciled', raw: { confidence: 0.4 } } }).where(eq(invoices.id, failedId));
    await as('manager').receiving.addInvoiceLine({
      invoiceId: failedId,
      line: { rawDescription: 'עגבניות', qtyBilled: 1, unit: 'kg', unitPriceBilled: 4 },
    });
    const [after] = await db.select({ status: invoices.status, raw: invoices.ocrPayload }).from(invoices).where(eq(invoices.id, failedId));
    expect(after!.status).not.toBe('parsed'); // re-matched
    expect(after!.raw?.raw).toMatchObject({ confidence: 0.4, manualLines: true }); // the read kept, the marker added
    await as('manager').receiving.addInvoiceLine({
      invoiceId: failedId,
      line: { rawDescription: 'בצל', qtyBilled: 1, unit: 'kg', unitPriceBilled: 2 },
    });
    expect((await header(failedId)).excl).toBe('6.00');

    await db.update(invoices).set({ status: 'approved' }).where(eq(invoices.id, failedId));
    await expect(
      as('manager').receiving.addInvoiceLine({ invoiceId: failedId, line: { rawDescription: 'x', qtyBilled: 1, unit: 'kg', unitPriceBilled: 1 } }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect((await header(failedId)).excl).toBe('6.00');
  });

  it('getInvoice tells the page whether lines can be added by hand (one rule with the API)', async () => {
    expect((await as('manager').receiving.getInvoice({ invoiceId: failedId })).linesEditable).toBe(true);
    expect((await as('manager').receiving.getInvoice({ invoiceId: A.invoiceId })).linesEditable).toBe(false); // read + matched
  });

  describe('a hand line pairs with its order line (S16: no false "not ordered" + "not billed")', () => {
    let oilLineId = '';
    const runFindings = (type: string) =>
      db
        .select({ id: discrepancies.id, productId: discrepancies.productId, delta: discrepancies.deltaAmount })
        .from(discrepancies)
        .innerJoin(matchRuns, eq(matchRuns.id, discrepancies.matchRunId))
        .where(and(eq(matchRuns.invoiceId, failedId), eq(discrepancies.type, type as never)));

    async function oilOrder() {
      const [oil] = await db
        .insert(products)
        .values({ restaurantId: A.restaurantId, canonicalName: 'שמן זית 18 ליטר' })
        .returning();
      const [pl] = await db
        .insert(poLines)
        .values({
          poId: A.poId,
          productId: oil!.id,
          rawDescription: 'שמן זית 18 ליטר',
          qtyOrdered: '1',
          unit: 'יח׳',
          unitPriceExpected: '1250',
        })
        .returning();
      oilLineId = pl!.id;
      // The failed scan was taken on A's receipt (registerInvoice stamps it).
      await db
        .update(invoices)
        .set({ ocrPayload: { provider: 'claude_vision', raw: { ocrFailed: true, reason: 'extraction_failed', scanGrId: A.grId } } })
        .where(eq(invoices.id, failedId));
      return oil!.id;
    }
    const findingsOf = (lineId: string) =>
      db
        .select({ type: discrepancies.type, delta: discrepancies.deltaAmount })
        .from(discrepancies)
        .innerJoin(invoiceLines, eq(invoiceLines.id, discrepancies.invoiceLineId))
        .where(eq(invoiceLines.id, lineId));

    it('S16 repro: oil 1 × 1,250 ordered, hand line 1 × 1,320 → a 70.00 price gap, not 1,320 + 1,250', async () => {
      const oilId = await oilOrder();
      const picker = (await as('manager').receiving.getInvoice({ invoiceId: failedId })).orderLines;
      expect(picker.find((l) => l.id === oilLineId)).toMatchObject({ name: 'שמן זית 18 ליטר', qtyOrdered: '1.000', unitPriceExpected: '1250.0000' });
      // Typed by hand: extra space and gershayim noise still match.
      const res = await as('manager').receiving.addInvoiceLine({
        invoiceId: failedId,
        line: { rawDescription: 'שמן  זית 18 ליטר', qtyBilled: 1, unit: 'יח׳', unitPriceBilled: 1320 },
      });
      const [line] = await db.select({ productId: invoiceLines.productId }).from(invoiceLines).where(eq(invoiceLines.id, res.lineId));
      expect(line!.productId).toBe(oilId);
      const f = await findingsOf(res.lineId);
      expect(f.map((x) => x.type)).not.toContain('UNORDERED_ITEM');
      expect(f.find((x) => x.type === 'PRICE_HIGHER')?.delta).toBe('70.00');
      const missingOil = await db
        .select({ id: discrepancies.id })
        .from(discrepancies)
        .innerJoin(matchRuns, eq(matchRuns.id, discrepancies.matchRunId))
        .where(and(eq(matchRuns.invoiceId, failedId), eq(discrepancies.type, 'MISSING_ON_INVOICE'), eq(discrepancies.productId, oilId)));
      expect(missingOil).toHaveLength(0);
    });

    it('no matching order line, or two of them → no product guessed', async () => {
      await oilOrder();
      const other = await as('manager').receiving.addInvoiceLine({
        invoiceId: failedId,
        line: { rawDescription: 'קמח לבן', qtyBilled: 1, unit: 'kg', unitPriceBilled: 5 },
      });
      const [o] = await db.select({ productId: invoiceLines.productId }).from(invoiceLines).where(eq(invoiceLines.id, other.lineId));
      expect(o!.productId).toBeNull();

      const [dup] = await db.insert(products).values({ restaurantId: A.restaurantId, canonicalName: 'שמן זית 18 ליטר (2)' }).returning();
      await db.insert(poLines).values({ poId: A.poId, productId: dup!.id, rawDescription: 'שמן זית 18 ליטר', qtyOrdered: '1', unit: 'יח׳', unitPriceExpected: '1250' });
      const amb = await as('manager').receiving.addInvoiceLine({
        invoiceId: failedId,
        line: { rawDescription: 'שמן זית 18 ליטר', qtyBilled: 1, unit: 'יח׳', unitPriceBilled: 1250 },
      });
      const [a] = await db.select({ productId: invoiceLines.productId }).from(invoiceLines).where(eq(invoiceLines.id, amb.lineId));
      expect(a!.productId).toBeNull();
    });

    it('picked from the order (poLineId) at a higher price → exactly one PRICE gap of 70 and no UNORDERED / MISSING for it', async () => {
      const oilId = await oilOrder();
      const res = await as('manager').receiving.addInvoiceLine({
        invoiceId: failedId,
        line: { poLineId: oilLineId, rawDescription: 'שמן', qtyBilled: 1, unit: 'יח׳', unitPriceBilled: 1320 },
      });
      const [line] = await db.select({ productId: invoiceLines.productId }).from(invoiceLines).where(eq(invoiceLines.id, res.lineId));
      expect(line!.productId).toBe(oilId);
      const gaps = (await runFindings('PRICE_HIGHER')).filter((d) => d.productId === oilId);
      expect(gaps.map((g) => g.delta)).toEqual(['70.00']);
      expect((await runFindings('UNORDERED_ITEM')).filter((d) => d.productId === oilId || d.productId === null)).toHaveLength(0);
      expect((await runFindings('MISSING_ON_INVOICE')).filter((d) => d.productId === oilId)).toHaveLength(0);
    });

    it('a free-text line the catalogue knows (this supplier\'s alias) links to that product', async () => {
      await oilOrder();
      const [flour] = await db.insert(products).values({ restaurantId: A.restaurantId, canonicalName: 'קמח לבן 25 ק״ג' }).returning();
      await db.insert(productAliases).values({ productId: flour!.id, supplierId: A.supplierId, supplierNameRaw: 'קמח לחם' });
      const res = await as('manager').receiving.addInvoiceLine({
        invoiceId: failedId,
        line: { rawDescription: 'קמח לחם', qtyBilled: 1, unit: 'שק', unitPriceBilled: 90 },
      });
      const [line] = await db.select({ productId: invoiceLines.productId }).from(invoiceLines).where(eq(invoiceLines.id, res.lineId));
      expect(line!.productId).toBe(flour!.id);
    });

    it('an unrelated free-text line stays unordered (no product guessed)', async () => {
      await oilOrder();
      const res = await as('manager').receiving.addInvoiceLine({
        invoiceId: failedId,
        line: { rawDescription: 'מגבות נייר', qtyBilled: 2, unit: 'יח׳', unitPriceBilled: 15 },
      });
      const [line] = await db.select({ productId: invoiceLines.productId }).from(invoiceLines).where(eq(invoiceLines.id, res.lineId));
      expect(line!.productId).toBeNull();
      const unordered = await db
        .select({ id: discrepancies.id })
        .from(discrepancies)
        .where(and(eq(discrepancies.invoiceLineId, res.lineId), eq(discrepancies.type, 'UNORDERED_ITEM')));
      expect(unordered).toHaveLength(1);
    });

    it('a foreign productId, or an order line of another order, is NOT_FOUND — nothing added', async () => {
      await oilOrder();
      const before = (await db.select({ id: invoiceLines.id }).from(invoiceLines).where(eq(invoiceLines.invoiceId, failedId))).length;
      const B = await seedTenant(db, 'MLB');
      await expect(
        as('manager').receiving.addInvoiceLine({
          invoiceId: failedId,
          line: { rawDescription: 'x', qtyBilled: 1, unit: 'kg', unitPriceBilled: 1, productId: B.productId },
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        as('manager').receiving.addInvoiceLine({
          invoiceId: failedId,
          line: { rawDescription: 'x', qtyBilled: 1, unit: 'kg', unitPriceBilled: 1, poLineId: B.poLineId },
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect((await db.select({ id: invoiceLines.id }).from(invoiceLines).where(eq(invoiceLines.invoiceId, failedId))).length).toBe(before);
    });

    it('a receiver gets no order-line picker (no ₪ for the receiver)', async () => {
      await oilOrder();
      expect((await as('receiver').receiving.getInvoice({ invoiceId: failedId })).orderLines).toEqual([]);
    });
  });
});

describe('#216 money review', () => {
  const stampOn = (grId: string) =>
    db
      .update(invoices)
      .set({ ocrPayload: { provider: 'claude_vision', raw: { ocrFailed: true, reason: 'extraction_failed', scanGrId: grId } } })
      .where(eq(invoices.id, failedId));

  it('C-1: an invoice typed exactly as ordered and received → computeInvoiceLeak = 0', async () => {
    // #5: an order line with no product / SKU can't pair — not offered, and refused if sent.
    await stampOn(A.grId);
    expect((await as('manager').receiving.getInvoice({ invoiceId: failedId })).orderLines.map((l) => l.id)).not.toContain(A.poLineId);
    await expect(
      as('manager').receiving.addInvoiceLine({
        invoiceId: failedId,
        line: { poLineId: A.poLineId, rawDescription: 'עגבניות', qtyBilled: 10, unit: 'kg', unitPriceBilled: 8.5 },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    // A's order: tomatoes 10 × 8.5 (link it to its product so a hand line can pair) — received 10.
    await db.update(poLines).set({ productId: A.productId }).where(eq(poLines.id, A.poLineId));
    await db.update(grLines).set({ qtyReceived: '10' }).where(eq(grLines.id, A.grLineId));
    await stampOn(A.grId);
    await as('manager').receiving.addInvoiceLine({
      invoiceId: failedId,
      line: { poLineId: A.poLineId, rawDescription: 'עגבניות', qtyBilled: 10, unit: 'kg', unitPriceBilled: 8.5 },
    });
    expect(await db.select().from(matchRuns).where(eq(matchRuns.invoiceId, failedId))).toHaveLength(1);
    const leak = await computeInvoiceLeak(db, A.restaurantId, failedId);
    expect(leak).not.toBeNull();
    expect(leak!.totalInclVat).toBe(100.3); // 85.00 + 18% = 100.30
    expect(leak!.leakIls).toBe(0);
  });

  it('M-2: while the receipt is still being counted, an edit does not re-match (held for the count)', async () => {
    await db.update(goodsReceipts).set({ status: 'pending' }).where(eq(goodsReceipts.id, A.grId));
    await stampOn(A.grId);
    const r = await as('manager').receiving.addInvoiceLine({
      invoiceId: failedId,
      line: { rawDescription: 'עגבניות', qtyBilled: 10, unit: 'kg', unitPriceBilled: 8.5 },
    });
    expect(r).toMatchObject({ rematched: false, rematchSkipped: 'receipt_open' });
    expect(await db.select().from(matchRuns).where(eq(matchRuns.invoiceId, failedId))).toHaveLength(0);
    const [row] = await db.select({ p: invoices.ocrPayload }).from(invoices).where(eq(invoices.id, failedId));
    expect((row!.p?.raw as { heldForReceipts?: string[] }).heldForReceipts).toEqual([A.grId]);
  });

  it('H-2: deleting the LAST line drops the old run (no stale findings on a ₪0 invoice) and goes back to parsed', async () => {
    const a = await as('manager').receiving.addInvoiceLine({
      invoiceId: failedId,
      line: { rawDescription: 'מגבות נייר', qtyBilled: 1, unit: 'יח׳', unitPriceBilled: 15 },
    });
    expect(await db.select().from(matchRuns).where(eq(matchRuns.invoiceId, failedId))).toHaveLength(1);
    const d = await as('manager').receiving.deleteInvoiceLine({ lineId: a.lineId });
    expect(d).toMatchObject({ rematched: false, rematchSkipped: 'no_lines', totals: { totalExclVat: '0.00' } });
    expect(await db.select().from(matchRuns).where(eq(matchRuns.invoiceId, failedId))).toHaveLength(0);
    const [row] = await db.select({ status: invoices.status }).from(invoices).where(eq(invoices.id, failedId));
    expect(row!.status).toBe('parsed');
  });

  it('M-1: a PRINTED header is kept (a hand line never rewrites it); only hand-added lines may be deleted', async () => {
    // A held-for-review read with a printed header 135 / 24.30 / 159.30 and one read line.
    await db
      .update(invoices)
      .set({ ocrPayload: { provider: 'reconciled', raw: { confidence: 0.4 } }, totalExclVat: '135.00', vatAmount: '24.30', totalInclVat: '159.30' })
      .where(eq(invoices.id, failedId));
    const [read] = await db
      .insert(invoiceLines)
      .values({ invoiceId: failedId, rawDescription: 'נקרא', qtyBilled: '1', unit: 'kg', unitPriceBilled: '95', lineTotal: '95.00' })
      .returning();
    const added = await as('manager').receiving.addInvoiceLine({
      invoiceId: failedId,
      line: { rawDescription: 'הוספה ידנית', qtyBilled: 1, unit: 'kg', unitPriceBilled: 40 },
    });
    expect(added.totals).toEqual({ totalExclVat: '135.00', vatAmount: '24.30', totalInclVat: '159.30' });
    expect(await header(failedId)).toEqual({ excl: '135.00', vat: '24.30', incl: '159.30' });
    await expect(as('manager').receiving.deleteInvoiceLine({ lineId: read!.id })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    await as('manager').receiving.deleteInvoiceLine({ lineId: added.lineId }); // a hand-added line may go
    expect(await header(failedId)).toEqual({ excl: '135.00', vat: '24.30', incl: '159.30' });
  });

  it('#9: our own header uses the ENGINE\'s VAT rule (one invoice rate), so it never trips VAT_MISMATCH against itself', async () => {
    const a = await as('manager').receiving.addInvoiceLine({
      invoiceId: failedId,
      line: { rawDescription: 'פירות', qtyBilled: 1, unit: 'kg', unitPriceBilled: 100 },
    });
    await db.update(invoiceLines).set({ vatRate: '0' }).where(eq(invoiceLines.id, a.lineId)); // VAT-exempt produce
    const b = await as('manager').receiving.addInvoiceLine({
      invoiceId: failedId,
      line: { rawDescription: 'שמן', qtyBilled: 1, unit: 'יח׳', unitPriceBilled: 50 },
    });
    // 150.00 × 18% = 27.00 (per-line rates in the engine are a human-PR proposal).
    expect(b.totals).toEqual({ totalExclVat: '150.00', vatAmount: '27.00', totalInclVat: '177.00' });
    const vat = await db
      .select({ id: discrepancies.id })
      .from(discrepancies)
      .innerJoin(matchRuns, eq(matchRuns.id, discrepancies.matchRunId))
      .where(and(eq(matchRuns.invoiceId, failedId), eq(discrepancies.type, 'VAT_MISMATCH')));
    expect(vat).toHaveLength(0);
  });

  it('LOW: VAT precedence is the engine\'s — the ORDER\'s 0% wins over the restaurant\'s 18%', async () => {
    await db.update(purchaseOrders).set({ vatRate: '0' }).where(eq(purchaseOrders.id, A.poId));
    await stampOn(A.grId);
    const r = await as('manager').receiving.addInvoiceLine({
      invoiceId: failedId,
      line: { rawDescription: 'פירות', qtyBilled: 2, unit: 'kg', unitPriceBilled: 42.5 },
    });
    expect(r.totals).toEqual({ totalExclVat: '85.00', vatAmount: '0.00', totalInclVat: '85.00' });
    const vat = await db
      .select({ id: discrepancies.id })
      .from(discrepancies)
      .innerJoin(matchRuns, eq(matchRuns.id, discrepancies.matchRunId))
      .where(and(eq(matchRuns.invoiceId, failedId), eq(discrepancies.type, 'VAT_MISMATCH')));
    expect(vat).toHaveLength(0);
  });

  it('LOW: half-up on the decimal (1.0005 → 1.001); a qty that rounds to 0 and a total past NUMERIC(12,2) are BAD_REQUEST', async () => {
    const r = await as('manager').receiving.addInvoiceLine({
      invoiceId: failedId,
      line: { rawDescription: 'x', qtyBilled: 1.0005, unit: 'kg', unitPriceBilled: 2.00005 },
    });
    const [line] = await db.select().from(invoiceLines).where(eq(invoiceLines.id, r.lineId));
    expect(line).toMatchObject({ qtyBilled: '1.001', unitPriceBilled: '2.0001' });
    await expect(
      as('manager').receiving.addInvoiceLine({ invoiceId: failedId, line: { rawDescription: 'x', qtyBilled: 0.0004, unit: 'kg', unitPriceBilled: 1 } }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      as('manager').receiving.addInvoiceLine({ invoiceId: failedId, line: { rawDescription: 'x', qtyBilled: 1_000_000, unit: 'kg', unitPriceBilled: 10_000_000 } }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('M-3: a claim in progress (letter sent) blocks the edit BEFORE any write', async () => {
    const a = await as('manager').receiving.addInvoiceLine({
      invoiceId: failedId,
      line: { rawDescription: 'מגבות נייר', qtyBilled: 2, unit: 'יח׳', unitPriceBilled: 15 },
    });
    const [d] = await db
      .select({ id: discrepancies.id })
      .from(discrepancies)
      .innerJoin(matchRuns, eq(matchRuns.id, discrepancies.matchRunId))
      .where(eq(matchRuns.invoiceId, failedId))
      .limit(1);
    await db.insert(recoveryClaims).values({
      restaurantId: A.restaurantId,
      discrepancyId: d!.id,
      supplierId: A.supplierId,
      invoiceId: failedId,
      status: 'claimed',
      amountAgorot: 3000,
      letterSentAt: new Date(),
    });
    const lines = async () => (await db.select({ id: invoiceLines.id }).from(invoiceLines).where(eq(invoiceLines.invoiceId, failedId))).length;
    await expect(
      as('manager').receiving.addInvoiceLine({ invoiceId: failedId, line: { rawDescription: 'y', qtyBilled: 1, unit: 'kg', unitPriceBilled: 1 } }),
    ).rejects.toMatchObject({ code: 'CONFLICT', cause: { appCode: 'invoice.linesLocked' } });
    await expect(as('manager').receiving.deleteInvoiceLine({ lineId: a.lineId })).rejects.toMatchObject({
      code: 'CONFLICT',
      cause: { appCode: 'invoice.linesLocked' },
    });
    // #10: the page is told, before anyone tries.
    expect(await as('manager').receiving.getInvoice({ invoiceId: failedId })).toMatchObject({ linesEditable: false, linesLockReason: 'claim', deletableLineIds: [] });
    expect(await lines()).toBe(1);
  });

  it('M-3: a credit note recorded on a line blocks the edit (it would cascade away)', async () => {
    const a = await as('manager').receiving.addInvoiceLine({
      invoiceId: failedId,
      line: { rawDescription: 'מגבות נייר', qtyBilled: 2, unit: 'יח׳', unitPriceBilled: 15 },
    });
    await db.insert(creditNotes).values({
      restaurantId: A.restaurantId,
      supplierId: A.supplierId,
      amountAgorot: 1500,
      issuedOn: '2026-10-31',
      source: 'invoice_line',
      invoiceLineId: a.lineId,
      invoiceId: failedId,
    });
    await expect(as('manager').receiving.deleteInvoiceLine({ lineId: a.lineId })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      cause: { appCode: 'invoice.linesLocked' },
    });
    expect(await db.select().from(creditNotes).where(eq(creditNotes.invoiceLineId, a.lineId))).toHaveLength(1);
    expect(await as('manager').receiving.getInvoice({ invoiceId: failedId })).toMatchObject({ linesEditable: false, linesLockReason: 'credit_note' });
  });
});

describe('#216 money review — round 2', () => {
  const stampOn = (grId: string) =>
    db
      .update(invoices)
      .set({ ocrPayload: { provider: 'claude_vision', raw: { ocrFailed: true, reason: 'extraction_failed', scanGrId: grId } } })
      .where(eq(invoices.id, failedId));
  const typesOf = async () =>
    (
      await db
        .select({ type: discrepancies.type })
        .from(discrepancies)
        .innerJoin(matchRuns, eq(matchRuns.id, discrepancies.matchRunId))
        .where(eq(matchRuns.invoiceId, failedId))
    ).map((r) => r.type);

  it('#2: a header the owner TYPED is kept when a line is added — the gap shows as TOTAL_MISMATCH', async () => {
    await as('manager').receiving.updateInvoiceHeader({ invoiceId: failedId, patch: { totalExclVat: 95, vatAmount: 17.1, totalInclVat: 112.1 } });
    const r = await as('manager').receiving.addInvoiceLine({
      invoiceId: failedId,
      line: { rawDescription: 'עגבניות', qtyBilled: 10, unit: 'kg', unitPriceBilled: 8.5 },
    });
    expect(r.headerRecomputed).toBe(false);
    expect(await header(failedId)).toEqual({ excl: '95.00', vat: '17.10', incl: '112.10' });
    expect(await typesOf()).toContain('TOTAL_MISMATCH');
  });

  it('#3: fixing a hand line (pencil) recomputes its total and our header, and re-matches → leak 0', async () => {
    await db.update(poLines).set({ productId: A.productId }).where(eq(poLines.id, A.poLineId));
    await db.update(grLines).set({ qtyReceived: '10' }).where(eq(grLines.id, A.grLineId));
    await stampOn(A.grId);
    const a = await as('manager').receiving.addInvoiceLine({
      invoiceId: failedId,
      line: { poLineId: A.poLineId, rawDescription: 'עגבניות', qtyBilled: 10, unit: 'kg', unitPriceBilled: 9 }, // typo: 9
    });
    expect(await typesOf()).toContain('PRICE_HIGHER');
    const fix = await as('manager').receiving.updateInvoiceLine({ lineId: a.lineId, patch: { unitPriceBilled: 8.5 } });
    expect(fix).toMatchObject({ headerRecomputed: true, rematched: true, totals: { totalExclVat: '85.00', vatAmount: '15.30', totalInclVat: '100.30' } });
    const [line] = await db.select({ lineTotal: invoiceLines.lineTotal }).from(invoiceLines).where(eq(invoiceLines.id, a.lineId));
    expect(line!.lineTotal).toBe('85.00');
    expect(await typesOf()).not.toContain('TOTAL_MISMATCH');
    expect((await computeInvoiceLeak(db, A.restaurantId, failedId))!.leakIls).toBe(0);
  });

  it('#6: one hand line per order line — a second pick of the same line is refused; the picker marks it billed', async () => {
    await db.update(poLines).set({ productId: A.productId }).where(eq(poLines.id, A.poLineId));
    await stampOn(A.grId);
    await as('manager').receiving.addInvoiceLine({
      invoiceId: failedId,
      line: { poLineId: A.poLineId, rawDescription: 'עגבניות', qtyBilled: 4, unit: 'kg', unitPriceBilled: 8.5 },
    });
    await expect(
      as('manager').receiving.addInvoiceLine({
        invoiceId: failedId,
        line: { poLineId: A.poLineId, rawDescription: 'עגבניות', qtyBilled: 6, unit: 'kg', unitPriceBilled: 8.5 },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    const picker = (await as('manager').receiving.getInvoice({ invoiceId: failedId })).orderLines;
    expect(picker.find((l) => l.id === A.poLineId)?.billed).toBe(true);
  });

  it('#7: on a READ invoice with no printed header, a hand line never makes the printed lines deletable', async () => {
    await db.update(invoices).set({ ocrPayload: { provider: 'reconciled', raw: { confidence: 0.4 } } }).where(eq(invoices.id, failedId));
    const [read] = await db
      .insert(invoiceLines)
      .values({ invoiceId: failedId, rawDescription: 'נקרא', qtyBilled: '1', unit: 'kg', unitPriceBilled: '10', lineTotal: '10.00' })
      .returning();
    const added = await as('manager').receiving.addInvoiceLine({
      invoiceId: failedId,
      line: { rawDescription: 'ידני', qtyBilled: 1, unit: 'kg', unitPriceBilled: 5 },
    });
    await expect(as('manager').receiving.deleteInvoiceLine({ lineId: read!.id })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    const page = await as('manager').receiving.getInvoice({ invoiceId: failedId });
    expect(page.deletableLineIds).toEqual([added.lineId]);
  });

  it('#8: deleting the LAST line while the receipt is being counted still drops the old run', async () => {
    await stampOn(A.grId);
    const a = await as('manager').receiving.addInvoiceLine({
      invoiceId: failedId,
      line: { rawDescription: 'מגבות נייר', qtyBilled: 1, unit: 'יח׳', unitPriceBilled: 15 },
    });
    expect(await db.select().from(matchRuns).where(eq(matchRuns.invoiceId, failedId))).toHaveLength(1);
    await db.update(goodsReceipts).set({ status: 'pending' }).where(eq(goodsReceipts.id, A.grId));
    const d = await as('manager').receiving.deleteInvoiceLine({ lineId: a.lineId });
    expect(d).toMatchObject({ rematched: false, rematchSkipped: 'no_lines' });
    expect(await db.select().from(matchRuns).where(eq(matchRuns.invoiceId, failedId))).toHaveLength(0);
  });

  it('#12: a consolidated invoice takes no hand lines (server-side, not only the page)', async () => {
    await db
      .update(invoices)
      .set({ ocrPayload: { provider: 'reconciled', raw: { kind: 'consolidated', deliveryNotes: [] } } })
      .where(eq(invoices.id, failedId));
    await expect(
      as('manager').receiving.addInvoiceLine({ invoiceId: failedId, line: { rawDescription: 'x', qtyBilled: 1, unit: 'kg', unitPriceBilled: 1 } }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', cause: { appCode: 'invoice.linesLocked' } });
    expect(await as('manager').receiving.getInvoice({ invoiceId: failedId })).toMatchObject({ linesEditable: false, linesLockReason: 'consolidated' });
  });

  it('#13: "הרץ התאמה מחדש" is refused while the invoice\'s receipt is still being counted', async () => {
    await stampOn(A.grId);
    await db.insert(invoiceLines).values({ invoiceId: failedId, rawDescription: 'x', qtyBilled: '1', unit: 'kg', unitPriceBilled: '1', lineTotal: '1.00' });
    await db.update(goodsReceipts).set({ status: 'pending' }).where(eq(goodsReceipts.id, A.grId));
    await expect(as('manager').match.runForInvoice({ invoiceId: failedId })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(await db.select().from(matchRuns).where(eq(matchRuns.invoiceId, failedId))).toHaveLength(0);
    await db.update(goodsReceipts).set({ status: 'completed' }).where(eq(goodsReceipts.id, A.grId));
    expect((await as('manager').match.runForInvoice({ invoiceId: failedId })).matchRunId).not.toBeNull();
  });
  it('addendum (#224): an invoice still being read takes no header or line edit — nothing written, the read lands clean', async () => {
    const [line] = await db
      .insert(invoiceLines)
      .values({ invoiceId: failedId, rawDescription: 'x', qtyBilled: '1', unit: 'kg', unitPriceBilled: '1', lineTotal: '1.00' })
      .returning({ id: invoiceLines.id });
    await db.update(invoices).set({ status: 'ocr_pending', ocrPayload: { provider: 'claude_vision', raw: { scanGrId: A.grId } } }).where(eq(invoices.id, failedId));
    const before = await header(failedId);
    const reading = { code: 'PRECONDITION_FAILED', message: 'החשבונית עדיין נקראת — נסו שוב בעוד דקה' };
    await expect(
      as('manager').receiving.updateInvoiceHeader({ invoiceId: failedId, patch: { totalExclVat: 95, vatAmount: 17.1, totalInclVat: 112.1 } }),
    ).rejects.toMatchObject(reading);
    await expect(as('manager').receiving.updateInvoiceLine({ lineId: line!.id, patch: { qtyBilled: 2 } })).rejects.toMatchObject(reading);
    await expect(
      as('manager').receiving.addInvoiceLine({ invoiceId: failedId, line: { rawDescription: 'y', qtyBilled: 1, unit: 'kg', unitPriceBilled: 1 } }),
    ).rejects.toMatchObject(reading);
    await expect(as('manager').receiving.deleteInvoiceLine({ lineId: line!.id })).rejects.toMatchObject(reading);
    expect(await header(failedId)).toEqual(before);
    const [row] = await db.select({ payload: invoices.ocrPayload }).from(invoices).where(eq(invoices.id, failedId));
    expect(row!.payload?.raw).toEqual({ scanGrId: A.grId }); // no headerEntered left for the read to inherit
    const [l] = await db.select({ qty: invoiceLines.qtyBilled }).from(invoiceLines).where(eq(invoiceLines.id, line!.id));
    expect(Number(l!.qty)).toBe(1);
  });
});
