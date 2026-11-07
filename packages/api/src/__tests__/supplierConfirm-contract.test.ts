import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  eq,
  poLines,
  purchaseOrders,
  restaurants,
  supplierConfirmLinks,
  supplierResponses,
  testDbUrl,
  type RestaurantSettings,
} from '@restomatch/db';
import {
  createSupplierLink,
  linesVersionOf,
  loadSupplierOrder,
  resolveSupplierToken,
  submitSupplierAnswer,
  supplierResponseDiff,
  type ResolvedLink,
  type SupplierAnswerInput,
} from '../supplierConfirm/service';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * G-10 (auth-02, P0): the supplier answer contract, one row per rule. The
 * service is the authority — every order line exactly once, an explicit intent
 * that agrees with the lines — so a reported shortage (10 → 6) can never turn
 * back into a silent full-quantity expectation.
 */
const db = createDb(testDbUrl());
let T: Tenant;
let poId: string;
/** A 3-line PO: 10 kg @ 8.5, 4 box @ 20, 2 unit (no price). */
let L: [string, string, string];
let otherPoLine: string;
let link: ResolvedLink;

beforeAll(async () => {
  await resetDb(db);
  T = await seedTenant(db, 'C');
  await db
    .update(restaurants)
    .set({ settings: { features: { supplierConfirm: true } } as RestaurantSettings })
    .where(eq(restaurants.id, T.restaurantId));
  const [po] = await db
    .insert(purchaseOrders)
    .values({ restaurantId: T.restaurantId, supplierId: T.supplierId, status: 'sent', source: 'manual' })
    .returning();
  poId = po!.id;
  const rows = await db
    .insert(poLines)
    .values([
      { poId, rawDescription: 'עגבניות', qtyOrdered: '10', unit: 'kg', unitPriceExpected: '8.5' },
      { poId, rawDescription: 'מלפפונים', qtyOrdered: '4', unit: 'box', unitPriceExpected: '20' },
      { poId, rawDescription: 'פטרוזיליה', qtyOrdered: '2', unit: 'unit', unitPriceExpected: null },
    ])
    .returning({ id: poLines.id, d: poLines.rawDescription });
  const id = (d: string) => rows.find((r) => r.d === d)!.id;
  L = [id('עגבניות'), id('מלפפונים'), id('פטרוזיליה')];
  otherPoLine = T.poLineId;
});

beforeEach(async () => {
  await db.delete(supplierResponses);
  await db.delete(supplierConfirmLinks);
  const r = await resolveSupplierToken(db, (await createSupplierLink(db, T.restaurantId, poId))!.token);
  if (!r.ok) throw new Error(r.error);
  link = r.link;
});

afterAll(async () => {
  await resetDb(db);
});

const asOrderedLines = () => [
  { poLineId: L[0], qtyAvailable: 10 },
  { poLineId: L[1], qtyAvailable: 4 },
  { poLineId: L[2], qtyAvailable: 2 },
];
const stored = () => db.select().from(supplierResponses).where(eq(supplierResponses.poId, poId));

async function refused(input: SupplierAnswerInput, error: string) {
  expect(await submitSupplierAnswer(db, link, input)).toEqual({ ok: false, error });
  expect(await stored()).toEqual([]);
}

describe('supplier answer contract (G-10)', () => {
  it('a missing line → INCOMPLETE_ANSWER, under both intents (and with no intent)', async () => {
    const two = asOrderedLines().slice(0, 2);
    await refused({ intent: 'as_ordered', lines: two }, 'INCOMPLETE_ANSWER');
    await refused({ intent: 'with_changes', lines: [{ poLineId: L[0], qtyAvailable: 6 }, two[1]!] }, 'INCOMPLETE_ANSWER');
    await refused({ intent: 'as_ordered', lines: [] }, 'INCOMPLETE_ANSWER');
    await refused({ lines: [{ poLineId: L[0], qtyAvailable: 6 }] }, 'INCOMPLETE_ANSWER');
  });

  it('a duplicate line or a line of another order → BAD_LINE', async () => {
    await refused({ intent: 'as_ordered', lines: [...asOrderedLines(), { poLineId: L[0], qtyAvailable: 10 }] }, 'BAD_LINE');
    await refused({ intent: 'with_changes', lines: [...asOrderedLines(), { poLineId: otherPoLine, qtyAvailable: 0 }] }, 'BAD_LINE');
  });

  it('with_changes: a line with no quantity → INCOMPLETE_ANSWER (0 = out of stock is a quantity)', async () => {
    await refused(
      {
        intent: 'with_changes',
        lines: [
          { poLineId: L[0], qtyAvailable: 6 },
          { poLineId: L[1], qtyAvailable: null, proposedUnitPrice: 22 },
          { poLineId: L[2], qtyAvailable: 2 },
        ],
      },
      'INCOMPLETE_ANSWER',
    );
  });

  it('as_ordered with a changed quantity → INTENT_MISMATCH (the shortage is never dropped)', async () => {
    const lines = asOrderedLines();
    lines[0] = { poLineId: L[0], qtyAvailable: 6 };
    await refused({ intent: 'as_ordered', lines }, 'INTENT_MISMATCH');
  });

  it('as_ordered with a changed price → INTENT_MISMATCH', async () => {
    await refused(
      { intent: 'as_ordered', lines: [{ poLineId: L[0], qtyAvailable: null, proposedUnitPrice: 9 }, ...asOrderedLines().slice(1)] },
      'INTENT_MISMATCH',
    );
  });

  it('with_changes with no difference and no note → INTENT_MISMATCH', async () => {
    await refused({ intent: 'with_changes', lines: asOrderedLines() }, 'INTENT_MISMATCH');
  });

  it('as_ordered: null quantities read as ordered → confirmed, nothing stored as a change', async () => {
    const res = await submitSupplierAnswer(db, link, {
      intent: 'as_ordered',
      lines: asOrderedLines().map((l) => ({ poLineId: l.poLineId, qtyAvailable: null })),
    });
    expect(res).toEqual({ ok: true, status: 'confirmed' });
    expect(await stored()).toEqual([expect.objectContaining({ status: 'confirmed', lines: [], note: null })]);
  });

  it('a note under as_ordered is carried → status changes, no line changes', async () => {
    expect(await submitSupplierAnswer(db, link, { intent: 'as_ordered', lines: asOrderedLines(), note: ' יגיע מחר ' })).toEqual({
      ok: true,
      status: 'changes',
    });
    expect(await stored()).toEqual([expect.objectContaining({ status: 'changes', lines: [], note: 'יגיע מחר' })]);
  });

  it('with_changes with only a note is valid (the note is the change)', async () => {
    expect(await submitSupplierAnswer(db, link, { intent: 'with_changes', lines: asOrderedLines(), note: 'בלי שקית' })).toEqual({
      ok: true,
      status: 'changes',
    });
  });

  it('a valid 10 → 6 is stored as [{ qtyAvailable: 6, proposedUnitPrice: null }] and the diff restates it', async () => {
    const lines = asOrderedLines();
    lines[0] = { poLineId: L[0], qtyAvailable: 6 };
    expect(await submitSupplierAnswer(db, link, { intent: 'with_changes', lines })).toEqual({ ok: true, status: 'changes' });
    const [row] = await stored();
    expect(row!.lines).toEqual([{ poLineId: L[0], qtyAvailable: 6, proposedUnitPrice: null }]);
    const diff = await supplierResponseDiff(db, T.restaurantId, poId);
    expect(diff.response!.lines).toEqual([
      expect.objectContaining({ poLineId: L[0], qtyOrdered: 10, qtyAvailable: 6, proposedUnitPrice: null }),
    ]);
    // the order itself is never rewritten
    const [po0] = await db.select().from(poLines).where(eq(poLines.id, L[0]));
    expect(po0!.qtyOrdered).toBe('10.000');
  });

  it('replay → ALREADY_ANSWERED with nothing written', async () => {
    const lines = asOrderedLines();
    lines[1] = { poLineId: L[1], qtyAvailable: 0 };
    expect((await submitSupplierAnswer(db, link, { intent: 'with_changes', lines })).ok).toBe(true);
    const before = await stored();
    expect(await submitSupplierAnswer(db, link, { intent: 'as_ordered', lines: asOrderedLines() })).toEqual({
      ok: false,
      error: 'ALREADY_ANSWERED',
    });
    expect(await stored()).toEqual(before);
  });

  it('rounding: a price that rounds to ₪0 and a positive qty that rounds to 0 → BAD_VALUE', async () => {
    const tinyPrice: SupplierAnswerInput['lines'] = asOrderedLines();
    tinyPrice[0] = { poLineId: L[0], qtyAvailable: 10, proposedUnitPrice: 0.00004 };
    await refused({ intent: 'with_changes', lines: tinyPrice }, 'BAD_VALUE');
    const tinyQty = asOrderedLines();
    tinyQty[0] = { poLineId: L[0], qtyAvailable: 0.0004 };
    await refused({ intent: 'with_changes', lines: tinyQty }, 'BAD_VALUE');
  });
});

describe('the order changed after the supplier opened the form (G-10 review #2)', () => {
  /** A fresh 2-line PO (10 @ 8.5, 4 @ 20) + a link, and its view as the supplier saw it. */
  async function freshOrder() {
    const [po] = await db
      .insert(purchaseOrders)
      .values({ restaurantId: T.restaurantId, supplierId: T.supplierId, status: 'sent', source: 'manual' })
      .returning();
    const lines = await db
      .insert(poLines)
      .values([
        { poId: po!.id, rawDescription: 'A', qtyOrdered: '10', unit: 'kg', unitPriceExpected: '8.5' },
        { poId: po!.id, rawDescription: 'B', qtyOrdered: '4', unit: 'box', unitPriceExpected: '20' },
      ])
      .returning({ id: poLines.id, d: poLines.rawDescription });
    const a = lines.find((l) => l.d === 'A')!.id;
    const b = lines.find((l) => l.d === 'B')!.id;
    const r = await resolveSupplierToken(db, (await createSupplierLink(db, T.restaurantId, po!.id))!.token);
    if (!r.ok) throw new Error(r.error);
    const view = (await loadSupplierOrder(db, r.link))!;
    return { poId: po!.id, a, b, link: r.link, version: view.linesVersion };
  }
  const rows = (id: string) => db.select().from(supplierResponses).where(eq(supplierResponses.poId, id));

  it('the view carries a stable linesVersion; an unchanged order accepts the answer', async () => {
    const o = await freshOrder();
    expect(o.version).toBe(
      linesVersionOf([
        { id: o.a, qty: '10', price: '8.5', unit: 'kg', productId: null },
        { id: o.b, qty: 4, price: 20, unit: 'box', productId: null },
      ]),
    );
    expect(
      await submitSupplierAnswer(db, o.link, {
        intent: 'with_changes',
        linesVersion: o.version,
        lines: [{ poLineId: o.a, qtyAvailable: 6 }, { poLineId: o.b, qtyAvailable: 4 }],
      }),
    ).toEqual({ ok: true, status: 'changes' });
  });

  it('a line ADDED since → ORDER_CHANGED (not a 422 "missing quantity" on a full form); nothing stored', async () => {
    const o = await freshOrder();
    await db.insert(poLines).values({ poId: o.poId, rawDescription: 'C', qtyOrdered: '1', unit: 'unit', unitPriceExpected: null });
    const lines = [{ poLineId: o.a, qtyAvailable: 10 }, { poLineId: o.b, qtyAvailable: 4 }];
    expect(await submitSupplierAnswer(db, o.link, { intent: 'as_ordered', linesVersion: o.version, lines })).toEqual({
      ok: false,
      error: 'ORDER_CHANGED',
    });
    expect(await rows(o.poId)).toEqual([]);
  });

  it('a line REMOVED since → ORDER_CHANGED (not a 400 generic); nothing stored', async () => {
    const o = await freshOrder();
    await db.delete(poLines).where(eq(poLines.id, o.b));
    const lines = [{ poLineId: o.a, qtyAvailable: 10 }, { poLineId: o.b, qtyAvailable: 4 }];
    expect(await submitSupplierAnswer(db, o.link, { intent: 'as_ordered', linesVersion: o.version, lines })).toEqual({
      ok: false,
      error: 'ORDER_CHANGED',
    });
    expect(await rows(o.poId)).toEqual([]);
  });

  it('a qty EDITED since (10 → 12) → ORDER_CHANGED: a stale "10" is never stored as a shortage the supplier never typed', async () => {
    const o = await freshOrder();
    await db.update(poLines).set({ qtyOrdered: '12' }).where(eq(poLines.id, o.a));
    const lines = [{ poLineId: o.a, qtyAvailable: 10 }, { poLineId: o.b, qtyAvailable: 0 }];
    expect(await submitSupplierAnswer(db, o.link, { intent: 'with_changes', linesVersion: o.version, lines })).toEqual({
      ok: false,
      error: 'ORDER_CHANGED',
    });
    expect(await rows(o.poId)).toEqual([]);
  });

  it('a UNIT edited since (kg → box) → ORDER_CHANGED', async () => {
    const o = await freshOrder();
    await db.update(poLines).set({ unit: 'box' }).where(eq(poLines.id, o.a));
    const lines = [{ poLineId: o.a, qtyAvailable: 6 }, { poLineId: o.b, qtyAvailable: 4 }];
    expect(await submitSupplierAnswer(db, o.link, { intent: 'with_changes', linesVersion: o.version, lines })).toEqual({
      ok: false,
      error: 'ORDER_CHANGED',
    });
    expect(await rows(o.poId)).toEqual([]);
  });

  it('a ₪0 order line: proposedUnitPrice 0 (its own price) is unchanged, not BAD_VALUE', async () => {
    const o = await freshOrder();
    await db.update(poLines).set({ unitPriceExpected: '0' }).where(eq(poLines.id, o.b));
    const r = await resolveSupplierToken(db, (await createSupplierLink(db, T.restaurantId, o.poId))!.token);
    if (!r.ok) throw new Error(r.error);
    const view = (await loadSupplierOrder(db, r.link))!;
    const lines = [
      { poLineId: o.a, qtyAvailable: 6, proposedUnitPrice: 8.5 },
      { poLineId: o.b, qtyAvailable: 4, proposedUnitPrice: 0 },
    ];
    expect(await submitSupplierAnswer(db, r.link, { intent: 'with_changes', linesVersion: view.linesVersion, lines })).toEqual({
      ok: true,
      status: 'changes',
    });
    expect((await rows(o.poId))[0]!.lines).toEqual([{ poLineId: o.a, qtyAvailable: 6, proposedUnitPrice: null }]);
  });

  it('a replay is ALREADY_ANSWERED even when the lines would now fail validation (checked first)', async () => {
    const o = await freshOrder();
    const ok = [{ poLineId: o.a, qtyAvailable: 10 }, { poLineId: o.b, qtyAvailable: 4 }];
    expect((await submitSupplierAnswer(db, o.link, { intent: 'as_ordered', linesVersion: o.version, lines: ok })).ok).toBe(true);
    await db.update(poLines).set({ qtyOrdered: '12' }).where(eq(poLines.id, o.a));
    expect(await submitSupplierAnswer(db, o.link, { intent: 'as_ordered', linesVersion: o.version, lines: [] })).toEqual({
      ok: false,
      error: 'ALREADY_ANSWERED',
    });
  });

  it('an order back to draft → ORDER_NOT_OPEN; the view says confirmable: false, closed: false', async () => {
    const o = await freshOrder();
    await db.update(purchaseOrders).set({ status: 'draft' }).where(eq(purchaseOrders.id, o.poId));
    const lines = [{ poLineId: o.a, qtyAvailable: 10 }, { poLineId: o.b, qtyAvailable: 4 }];
    expect(await submitSupplierAnswer(db, o.link, { intent: 'as_ordered', linesVersion: o.version, lines })).toEqual({
      ok: false,
      error: 'ORDER_NOT_OPEN',
    });
    expect(await loadSupplierOrder(db, o.link)).toMatchObject({ confirmable: false, closed: false });
  });

  it('a cancelled or closed order → ORDER_CLOSED; the view says confirmable: false, closed: true', async () => {
    for (const status of ['cancelled', 'closed'] as const) {
      const o = await freshOrder();
      await db.update(purchaseOrders).set({ status }).where(eq(purchaseOrders.id, o.poId));
      const lines = [{ poLineId: o.a, qtyAvailable: 10 }, { poLineId: o.b, qtyAvailable: 4 }];
      expect(await submitSupplierAnswer(db, o.link, { intent: 'as_ordered', linesVersion: o.version, lines }), status).toEqual({
        ok: false,
        error: 'ORDER_CLOSED',
      });
      expect(await loadSupplierOrder(db, o.link)).toMatchObject({ confirmable: false, closed: true });
      expect(await rows(o.poId)).toEqual([]);
    }
  });
});
