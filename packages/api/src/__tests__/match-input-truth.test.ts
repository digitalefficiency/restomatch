import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  discrepancies,
  eq,
  goodsReceipts,
  grLines,
  invoiceLines,
  invoices,
  matchRuns,
  poLines,
  products,
  purchaseOrders,
  sql,
  suppliers,
  testDbUrl,
} from '@restomatch/db';
import { runMatch, type Discrepancy } from '@restomatch/matching';
import { appRouter } from '../index';
import type { AppContext } from '../context';
import { buildMatchInputForInvoice } from '../match/buildMatchInput';
import {
  closedReceiptSql,
  COUNTED_MARKER,
  countedLineSql,
  isPoMatchable,
  PO_MATCHABLE,
  PO_PINNABLE,
  poMatchableSql,
} from '../match/receiptTruth';
// The client's definition of "counted" — the interim SQL must agree with it exactly.
import { fromGrLine } from '../../../../apps/web/app/dashboard/receiving/[poId]/_count';
import { resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

/**
 * G-04 · match-input truth: the 3-way match reads only what someone actually
 * counted, on receipts that are closed, against POs that are real.
 */
const db = createDb(testDbUrl());
const DAY = 24 * 60 * 60 * 1000;
const D0 = new Date('2026-06-10T09:00:00Z'); // 12:00 local, DST-free

beforeEach(async () => {
  await resetDb(db);
  await seedPlans(db);
});
afterAll(() => resetDb(db));

function ownerCaller(t: Tenant) {
  const ctx: AppContext = { db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role: 'owner' } };
  return appRouter.createCaller(ctx);
}

type PoStatus = 'draft' | 'sent' | 'confirmed' | 'partial' | 'closed' | 'cancelled';
type GrStatus = 'pending' | 'partial' | 'completed' | 'rejected';
type LineCount = {
  qtyReceived?: string;
  qtyRejected?: string;
  rejectReason?: string | null;
  conditionNotes?: string | null;
};

let seq = 0;
/** A fresh supplier of T (so the fixture's own PO never competes). */
async function supplierOf(T: Tenant): Promise<string> {
  seq += 1;
  const [s] = await db
    .insert(suppliers)
    .values({ restaurantId: T.restaurantId, name: `ספק ${seq}`, businessId: `5199${String(seq).padStart(5, '0')}` })
    .returning();
  return s!.id;
}

/** A PO of `n` lines (10 × ₪12 each, one product per line) for a supplier, optionally with a receipt. */
async function order(
  T: Tenant,
  supplierId: string,
  opts: {
    n?: number;
    status?: PoStatus;
    at?: Date;
    gr?: GrStatus | null;
    /** The saved state of line i (undefined = the untouched 0/0 row W1-06 creates). */
    count?: (i: number) => LineCount | undefined;
  } = {},
) {
  const n = opts.n ?? 1;
  const [po] = await db
    .insert(purchaseOrders)
    .values({
      restaurantId: T.restaurantId,
      supplierId,
      expectedDeliveryAt: opts.at ?? D0,
      status: opts.status ?? 'sent',
      source: 'manual',
    })
    .returning();
  const lines: Array<{ productId: string; poLineId: string; grLineId: string | null }> = [];
  let grId: string | null = null;
  if (opts.gr !== null) {
    const [gr] = await db
      .insert(goodsReceipts)
      .values({ restaurantId: T.restaurantId, poId: po!.id, receivedBy: T.ownerUserId, receivedAt: opts.at ?? D0, status: opts.gr ?? 'completed' })
      .returning();
    grId = gr!.id;
  }
  for (let i = 0; i < n; i++) {
    const [p] = await db
      .insert(products)
      .values({ restaurantId: T.restaurantId, canonicalName: `מוצר ${seq}-${i}`, category: 'ירקות', defaultUnit: 'kg' })
      .returning();
    const [pl] = await db
      .insert(poLines)
      .values({ poId: po!.id, productId: p!.id, rawDescription: `מוצר ${i}`, qtyOrdered: '10', unit: 'kg', unitPriceExpected: '12' })
      .returning();
    let grLineId: string | null = null;
    if (grId) {
      const c = opts.count?.(i);
      const [gl] = await db
        .insert(grLines)
        .values({
          grId,
          poLineId: pl!.id,
          qtyReceived: c?.qtyReceived ?? '0',
          qtyRejected: c?.qtyRejected ?? '0',
          rejectReason: c?.rejectReason ?? null,
          conditionNotes: c?.conditionNotes ?? null,
        })
        .returning();
      grLineId = gl!.id;
    }
    lines.push({ productId: p!.id, poLineId: pl!.id, grLineId });
  }
  return { poId: po!.id, grId, lines };
}

/** An invoice of the supplier billing `qty` × `price` of each product. */
async function invoiceFor(
  T: Tenant,
  supplierId: string,
  productIds: string[],
  opts: { qty?: number; price?: number; at?: Date; source?: 'photo' | 'email' | 'platform' | 'manual' } = {},
) {
  const qty = opts.qty ?? 10;
  const price = opts.price ?? 12;
  const lineAg = Math.round(qty * price * 100);
  const exclAg = lineAg * productIds.length;
  const vatAg = Math.round(exclAg * 0.18);
  seq += 1;
  const [inv] = await db
    .insert(invoices)
    .values({
      restaurantId: T.restaurantId,
      supplierId,
      invoiceNumber: `G04-${seq}`,
      invoiceDate: opts.at ?? D0,
      totalExclVat: (exclAg / 100).toFixed(2),
      vatAmount: (vatAg / 100).toFixed(2),
      totalInclVat: ((exclAg + vatAg) / 100).toFixed(2),
      status: 'parsed',
      source: opts.source ?? 'photo',
      createdBy: T.ownerUserId,
    })
    .returning();
  for (const productId of productIds) {
    await db.insert(invoiceLines).values({
      invoiceId: inv!.id,
      productId,
      rawDescription: 'x',
      qtyBilled: String(qty),
      unit: 'kg',
      unitPriceBilled: price.toFixed(2),
      lineTotal: (lineAg / 100).toFixed(2),
    });
  }
  return inv!.id;
}

const build = (T: Tenant, invoiceId: string, pinnedPoId?: string | null) =>
  buildMatchInputForInvoice(db, T.restaurantId, invoiceId, { pinnedPoId });
const engine = async (T: Tenant, invoiceId: string, pinnedPoId?: string | null) => {
  const built = await build(T, invoiceId, pinnedPoId);
  return { built: built!, result: runMatch(built!.input) };
};
const QTY = new Set(['QTY_SHORT', 'QTY_OVER']);
const qtyAg = (ds: Discrepancy[]) => ds.filter((d) => QTY.has(d.type)).reduce((s, d) => s + Math.round(Math.abs(d.deltaAmount) * 100), 0);

describe('receipt truth: only counted lines of closed receipts reach the engine', () => {
  it('ordered 10, billed 10 @ ₪12, counted 8 on a closed receipt → a ₪24 qty finding (DEEP-FIX example)', async () => {
    const T = await seedTenant(db, 'A');
    const s = await supplierOf(T);
    const o = await order(T, s, { gr: 'partial', count: () => ({ qtyReceived: '8' }) });
    const inv = await invoiceFor(T, s, [o.lines[0]!.productId]);
    const { built, result } = await engine(T, inv);
    expect(built.poId).toBe(o.poId);
    expect(built.input.grLines).toEqual([expect.objectContaining({ poLineId: o.lines[0]!.poLineId, qtyReceived: 8 })]);
    expect(qtyAg(result.discrepancies)).toBe(2400);
  });

  it('a pending receipt with 5 of 12 lines saved feeds 0 GR lines and changes no match run or leak ₪', async () => {
    const T = await seedTenant(db, 'A');
    const s = await supplierOf(T);
    const o = await order(T, s, { n: 12, gr: 'pending' });
    const inv = await invoiceFor(T, s, o.lines.map((l) => l.productId));
    const caller = ownerCaller(T);
    const snapshot = async () => {
      const [run] = await db
        .select({ id: matchRuns.id, total: matchRuns.totalDiscrepancyAmount, status: matchRuns.overallStatus, poId: matchRuns.poId })
        .from(matchRuns)
        .where(eq(matchRuns.invoiceId, inv));
      const ds = await db
        .select({ type: discrepancies.type, delta: discrepancies.deltaAmount })
        .from(discrepancies)
        .where(eq(discrepancies.matchRunId, run!.id));
      return { total: run!.total, status: run!.status, poId: run!.poId, findings: ds.map((d) => `${d.type}|${d.delta}`).sort() };
    };
    await caller.match.runForInvoice({ invoiceId: inv });
    const before = await snapshot();

    // The receiver autosaves 5 lines (3 of 10 each — a would-be ₪84 shortfall per line).
    for (const l of o.lines.slice(0, 5)) {
      await db.update(grLines).set({ qtyReceived: '3' }).where(eq(grLines.id, l.grLineId!));
    }
    expect((await build(T, inv))!.input.grLines).toHaveLength(0);
    await caller.match.runForInvoice({ invoiceId: inv });
    expect(await snapshot()).toEqual(before);
  });

  it('closed as partial with 7 lines uncounted → only the 5 counted lines are fed; the 7 have no qty finding (unknown ≠ 0)', async () => {
    const T = await seedTenant(db, 'A');
    const s = await supplierOf(T);
    const o = await order(T, s, { n: 12, gr: 'partial', count: (i) => (i < 5 ? { qtyReceived: '10' } : undefined) });
    const inv = await invoiceFor(T, s, o.lines.map((l) => l.productId));
    const { built, result } = await engine(T, inv);
    expect(built.input.grLines.map((g) => g.poLineId).sort()).toEqual(o.lines.slice(0, 5).map((l) => l.poLineId).sort());
    const uncounted = new Set(o.lines.slice(5).map((l) => l.poLineId));
    expect(result.discrepancies.filter((d) => QTY.has(d.type) && d.poLineId && uncounted.has(d.poLineId))).toEqual([]);
    expect(qtyAg(result.discrepancies)).toBe(0);
  });

  it('a bulk_as_ordered line counts; a `missing` line (0/0/missing) counts as 0 received; a free-text note alone does not', async () => {
    const T = await seedTenant(db, 'A');
    const s = await supplierOf(T);
    const o = await order(T, s, {
      n: 3,
      gr: 'completed',
      count: (i) =>
        i === 0
          ? { qtyReceived: '10', conditionNotes: 'count:bulk_as_ordered' }
          : i === 1
            ? { rejectReason: 'missing' }
            : { conditionNotes: 'ארגז רטוב' }, // touched by a note, never counted
    });
    const inv = await invoiceFor(T, s, o.lines.map((l) => l.productId));
    const { built, result } = await engine(T, inv);
    const fed = new Map(built.input.grLines.map((g) => [g.poLineId, g.qtyReceived]));
    expect(fed.get(o.lines[0]!.poLineId)).toBe(10);
    expect(fed.get(o.lines[1]!.poLineId)).toBe(0);
    expect(fed.has(o.lines[2]!.poLineId)).toBe(false);
    // The missing line is billed 10 and received 0 → its ₪120 is a qty finding; the note-only line is not.
    expect(result.discrepancies.some((d) => QTY.has(d.type) && d.poLineId === o.lines[1]!.poLineId)).toBe(true);
    expect(result.discrepancies.some((d) => QTY.has(d.type) && d.poLineId === o.lines[2]!.poLineId)).toBe(false);
    expect(qtyAg(result.discrepancies)).toBe(12000);
  });
});

describe('draft POs never enter the match; a confirmed one does', () => {
  it('a pin to a DRAFT PO is skipped (pinSkipped: po_draft) → UNORDERED_ARRIVAL; once confirmed, the re-match pins it with line findings', async () => {
    const T = await seedTenant(db, 'A');
    const s = await supplierOf(T);
    // A receiver's walk-in: a retro draft PO, its receipt counted 8 of 10, a scan billing 10 @ ₪13.
    const o = await order(T, s, { status: 'draft', gr: 'partial', count: () => ({ qtyReceived: '8' }) });
    const inv = await invoiceFor(T, s, [o.lines[0]!.productId], { price: 13 });

    const draft = await engine(T, inv, o.poId);
    expect(draft.built.pinSkipped).toBe('po_draft');
    expect(draft.built.poId).toBeNull();
    expect(draft.result.discrepancies.map((d) => d.type)).toContain('UNORDERED_ARRIVAL');

    await db.update(purchaseOrders).set({ status: 'confirmed' }).where(eq(purchaseOrders.id, o.poId)); // W2-05 confirmWalkIn
    const confirmed = await engine(T, inv, o.poId);
    expect(confirmed.built.pinSkipped).toBeUndefined();
    expect(confirmed.built.poId).toBe(o.poId);
    const types = confirmed.result.discrepancies.map((d) => d.type);
    expect(types).not.toContain('UNORDERED_ARRIVAL');
    expect(types).toContain('PRICE_HIGHER');
    expect(types.some((t) => QTY.has(t))).toBe(true);
  });

  it('discovery never picks a draft or a cancelled PO (no pin)', async () => {
    const T = await seedTenant(db, 'A');
    for (const status of ['draft', 'cancelled'] as const) {
      const s = await supplierOf(T);
      const o = await order(T, s, { status, count: () => ({ qtyReceived: '10' }) });
      const inv = await invoiceFor(T, s, [o.lines[0]!.productId]);
      const { built, result } = await engine(T, inv);
      expect(built.poId).toBeNull();
      expect(built.pinSkipped).toBeUndefined();
      expect(result.discrepancies.map((d) => d.type)).toContain('UNORDERED_ARRIVAL');
    }
  });

  it('a cancelled pin is dropped (never pinned), without a pinSkipped reason', async () => {
    const T = await seedTenant(db, 'A');
    const s = await supplierOf(T);
    const o = await order(T, s, { status: 'cancelled', count: () => ({ qtyReceived: '10' }) });
    const inv = await invoiceFor(T, s, [o.lines[0]!.productId]);
    const { built } = await engine(T, inv, o.poId);
    expect(built.poId).toBeNull();
    expect(built.pinSkipped).toBeUndefined();
  });
});

describe('closed POs still match (the Zester case)', () => {
  it('a platform PO synced as CLOSED before its invoice is discovered for that invoice', async () => {
    const T = await seedTenant(db, 'A');
    const s = await supplierOf(T);
    const o = await order(T, s, { status: 'closed', gr: 'completed', count: () => ({ qtyReceived: '8' }) });
    const inv = await invoiceFor(T, s, [o.lines[0]!.productId], { source: 'platform', at: new Date(D0.getTime() + DAY) });
    const { built, result } = await engine(T, inv);
    expect(built.poId).toBe(o.poId);
    expect(result.discrepancies.map((d) => d.type)).not.toContain('UNORDERED_ARRIVAL');
    expect(qtyAg(result.discrepancies)).toBe(2400);
  });

  it('photo: a closed, received PO beats a closer undelivered one (received first)', async () => {
    const T = await seedTenant(db, 'A');
    const s = await supplierOf(T);
    const closed = await order(T, s, { status: 'closed', gr: 'completed', count: () => ({ qtyReceived: '10' }) });
    const closer = await order(T, s, { status: 'sent', gr: null, at: new Date(D0.getTime() + 2 * DAY) });
    void closer;
    const inv = await invoiceFor(T, s, [closed.lines[0]!.productId], { at: new Date(D0.getTime() + 2 * DAY), source: 'photo' });
    expect((await build(T, inv))!.poId).toBe(closed.poId);
  });

  it('email: a closed old PO does not attract an invoice from the nearer open PO it belongs to (nearest day kept)', async () => {
    const T = await seedTenant(db, 'A');
    const s = await supplierOf(T);
    await order(T, s, { status: 'closed', gr: 'completed', at: new Date(D0.getTime() - 5 * DAY), count: () => ({ qtyReceived: '10' }) });
    const open = await order(T, s, { status: 'sent', gr: null });
    const inv = await invoiceFor(T, s, [open.lines[0]!.productId], { source: 'email' });
    expect((await build(T, inv))!.poId).toBe(open.poId);
  });
});

describe('receiptTruth helpers', () => {
  it('PO_MATCHABLE / PO_PINNABLE = every status but draft and cancelled; the SQL agrees', async () => {
    expect([...PO_MATCHABLE].sort()).toEqual(['closed', 'confirmed', 'partial', 'sent']);
    expect(PO_PINNABLE).toEqual(PO_MATCHABLE);
    const statuses: PoStatus[] = ['draft', 'sent', 'confirmed', 'partial', 'closed', 'cancelled'];
    const T = await seedTenant(db, 'A');
    const s = await supplierOf(T);
    for (const status of statuses) {
      const o = await order(T, s, { status, gr: null, n: 0 });
      const [row] = await db
        .select({ ok: poMatchableSql() })
        .from(purchaseOrders)
        .where(eq(purchaseOrders.id, o.poId));
      expect(row!.ok).toBe(isPoMatchable(status));
    }
  });

  it('closedReceiptSql = completed / partial', async () => {
    const T = await seedTenant(db, 'A');
    const s = await supplierOf(T);
    for (const status of ['pending', 'partial', 'completed', 'rejected'] as const) {
      const o = await order(T, s, { gr: status, n: 0 });
      const [row] = await db
        .select({ ok: closedReceiptSql() })
        .from(goodsReceipts)
        .where(eq(goodsReceipts.id, o.grId!));
      expect(row!.ok).toBe(status === 'completed' || status === 'partial');
      // …and with an alias, as W2-07 / W2-11 raw SQL use it.
      const raw = await db.execute(sql`select ${closedReceiptSql('gr')} as ok from goods_receipts gr where gr.id = ${o.grId}`);
      const rows = (Array.isArray(raw) ? raw : (raw as { rows: unknown[] }).rows) as Array<{ ok: boolean }>;
      expect(rows[0]!.ok).toBe(status === 'completed' || status === 'partial');
    }
  });

  it('the interim countedLineSql ≡ fromGrLine (_count.ts) over 12 row shapes', async () => {
    expect(COUNTED_MARKER).toBe('interim');
    const shapes: LineCount[] = [
      {}, // the fresh 0/0 row W1-06 creates (and an undo writes back)
      { qtyReceived: '8' },
      { qtyReceived: '0.001' }, // the smallest NUMERIC(12,3) step
      { qtyRejected: '2' },
      { rejectReason: 'missing' },
      { rejectReason: 'damaged' },
      { conditionNotes: 'damaged: ארגז שבור' },
      { conditionNotes: 'count:bulk_as_ordered' },
      { conditionNotes: 'קרטון רטוב count:spot_check' },
      { conditionNotes: 'count:per_line' },
      { conditionNotes: 'ארגז רטוב' }, // a free-text note alone is not a count
      { conditionNotes: 'recount:spot_checks · not damaged' }, // tokens inside words / mid-text "damaged" are not counts
    ];
    const T = await seedTenant(db, 'A');
    const s = await supplierOf(T);
    const o = await order(T, s, { n: shapes.length, gr: 'pending', count: (i) => shapes[i] });
    const answers: boolean[] = [];
    for (const [i, shape] of shapes.entries()) {
      const [row] = await db
        .select({
          counted: countedLineSql(),
          qtyReceived: grLines.qtyReceived,
          qtyRejected: grLines.qtyRejected,
          rejectReason: grLines.rejectReason,
          conditionNotes: grLines.conditionNotes,
        })
        .from(grLines)
        .where(eq(grLines.id, o.lines[i]!.grLineId!));
      const client = fromGrLine(row!, null).kind === 'counted';
      answers.push(client);
      expect({ shape, counted: row!.counted }).toEqual({ shape, counted: client });
      const raw = await db.execute(sql`select ${countedLineSql('gl')} as c from gr_lines gl where gl.id = ${o.lines[i]!.grLineId}`);
      const rows = (Array.isArray(raw) ? raw : (raw as { rows: unknown[] }).rows) as Array<{ c: boolean }>;
      expect(rows[0]!.c).toBe(client);
    }
    // The table covers both answers: the untouched row, the note-only row and the look-alike are not counts.
    expect(answers.filter((c) => !c)).toHaveLength(3);
    expect(answers.filter((c) => c)).toHaveLength(9);
  });
});
