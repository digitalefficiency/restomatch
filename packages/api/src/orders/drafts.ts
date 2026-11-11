import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, isNull, poLines, purchaseOrders, sql, users, type Database } from '@restomatch/db';
import { orderPriceKey, resolveExpectedPrice } from './expectedPrice';
import { estimateTotal, qty3 } from './totals';

/**
 * Server drafts (W2-06 §5.7, deep-fix class 2, orders-07 P0). The wizard saves
 * at every line; a reload — even in another browser of the same user —
 * resumes from the server. ONE open draft per (restaurant, supplier, author):
 * a supplier switch moves to (or creates) that supplier's draft and keeps the
 * other one.
 *
 * - The version is the row's `xmin` (never `updated_at`: µs precision makes
 *   the first save compare unequal — rootcause trap).
 * - Saves serialise on `pg_advisory_xact_lock(restaurant:supplier:author)`.
 * - The PO is row-locked and refused once a goods receipt exists.
 * - A stale version → CONFLICT naming who saved and when. A replay of the same
 *   content is answered with the current draft (content-equal replay; swaps to
 *   G-05's `withIdempotency(clientMutationId)` in one call when it merges).
 */
export interface DraftLineInput {
  productId?: string | null;
  rawDescription?: string | null;
  qty: number;
  unit: string;
  unitPriceExpected?: number | null;
}

export interface SaveDraftArgs {
  restaurantId: string;
  userId: string;
  draftId?: string | null;
  supplierId: string;
  lines: DraftLineInput[];
  expectedDeliveryAt: Date | null;
  version?: string | null;
  clientMutationId: string;
}

export interface DraftState {
  draftId: string;
  supplierId: string;
  version: string;
  updatedAt: string;
  expectedDeliveryAt: string | null;
  totalEstimated: string | null;
  lines: Array<{
    id: string;
    productId: string | null;
    rawDescription: string | null;
    qty: number;
    unit: string;
    unitPriceExpected: number | null;
  }>;
}

/** The draft error a client can act on: who saved it and when (ISO). */
export function draftConflict(by: string | null, at: Date): TRPCError {
  return new TRPCError({
    code: 'CONFLICT',
    message: `DRAFT_STALE:${by ?? ''}:${at.toISOString()}`,
    cause: { code: 'DRAFT_STALE', by, at: at.toISOString() } as never,
  });
}

const lockKey = (r: string, s: string, u: string) => `po-draft:${r}:${s}:${u}`;

/** A user's open draft for a supplier (W1-11's capture drafts carry a source_ref and are not "the" draft). */
async function findOpenDraft(db: Database, restaurantId: string, supplierId: string, userId: string) {
  const [row] = await db
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(
      and(
        eq(purchaseOrders.restaurantId, restaurantId),
        eq(purchaseOrders.supplierId, supplierId),
        eq(purchaseOrders.createdBy, userId),
        eq(purchaseOrders.status, 'draft'),
        isNull(purchaseOrders.sourceRef),
      ),
    )
    .orderBy(desc(purchaseOrders.updatedAt), desc(purchaseOrders.id))
    .limit(1);
  return row?.id ?? null;
}

export async function loadDraft(db: Database, restaurantId: string, draftId: string): Promise<DraftState | null> {
  const [po] = await db
    .select({
      id: purchaseOrders.id,
      supplierId: purchaseOrders.supplierId,
      status: purchaseOrders.status,
      version: sql<string>`${purchaseOrders}.xmin::text`,
      updatedAt: purchaseOrders.updatedAt,
      expectedDeliveryAt: purchaseOrders.expectedDeliveryAt,
      totalEstimated: purchaseOrders.totalEstimated,
    })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, draftId), eq(purchaseOrders.restaurantId, restaurantId)))
    .limit(1);
  if (!po || po.status !== 'draft') return null;
  const lines = await db
    .select()
    .from(poLines)
    .where(eq(poLines.poId, draftId))
    .orderBy(sql`${poLines.rawDescription} ASC NULLS LAST`, asc(poLines.id)); // = the router's PO_LINE_ORDER (no line_no until H-03)
  return {
    draftId: po.id,
    supplierId: po.supplierId,
    version: po.version,
    updatedAt: po.updatedAt.toISOString(),
    expectedDeliveryAt: po.expectedDeliveryAt?.toISOString() ?? null,
    totalEstimated: po.totalEstimated,
    lines: lines.map((l) => ({
      id: l.id,
      productId: l.productId,
      rawDescription: l.rawDescription,
      qty: Number(l.qtyOrdered),
      unit: l.unit,
      unitPriceExpected: l.unitPriceExpected == null ? null : Number(l.unitPriceExpected),
    })),
  };
}

export async function openDraft(
  db: Database,
  args: { restaurantId: string; userId: string; supplierId: string },
): Promise<DraftState | null> {
  const id = await findOpenDraft(db, args.restaurantId, args.supplierId, args.userId);
  return id ? loadDraft(db, args.restaurantId, id) : null;
}

/** Content identity for the replay check: the same lines (order-insensitive) and date. */
function sameContent(state: DraftState, args: SaveDraftArgs, priced: DraftLineInput[]): boolean {
  const key = (l: { productId?: string | null; rawDescription?: string | null; qty: number; unit: string; unitPriceExpected?: number | null }) =>
    [l.productId ?? '', (l.rawDescription ?? '').trim(), qty3(l.qty), l.unit, l.unitPriceExpected ?? ''].join('|');
  const a = state.lines.map(key).sort();
  const b = priced.map(key).sort();
  const date = (d: Date | string | null) => (d ? new Date(d).getTime() : null);
  return a.length === b.length && a.every((x, i) => x === b[i]) && date(state.expectedDeliveryAt) === date(args.expectedDeliveryAt);
}

export async function saveDraft(db: Database, args: SaveDraftArgs): Promise<DraftState & { replayed: boolean }> {
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${lockKey(args.restaurantId, args.supplierId, args.userId)}, 0))`,
  );

  // Price unpriced, mapped lines with THE expected price before comparing or writing.
  const toPrice = args.lines.filter((l) => l.unitPriceExpected == null && !!l.productId);
  const expected =
    toPrice.length > 0
      ? await resolveExpectedPrice(db, {
          restaurantId: args.restaurantId,
          supplierId: args.supplierId,
          at: new Date(),
          lines: toPrice.map((l) => ({ productId: l.productId!, unit: l.unit })),
        })
      : new Map();
  const priced: DraftLineInput[] = args.lines.map((l) => ({
    ...l,
    unitPriceExpected:
      l.unitPriceExpected ?? (l.productId ? (expected.get(orderPriceKey(l.productId, l.unit))?.unitPrice ?? null) : null),
  }));

  let draftId = args.draftId ?? (await findOpenDraft(db, args.restaurantId, args.supplierId, args.userId));
  if (draftId) {
    // Lock the PO row; refuse if it left draft or a receipt exists.
    const locked = await db.execute(
      sql`select status, supplier_id, created_by, updated_at, xmin::text as version,
                 exists (select 1 from goods_receipts g where g.po_id = ${draftId} and g.restaurant_id = ${args.restaurantId}) as has_gr
          from purchase_orders where id = ${draftId} and restaurant_id = ${args.restaurantId} for update`,
    );
    const row = (locked as unknown as { rows?: Array<Record<string, unknown>> }).rows?.[0] ??
      (locked as unknown as Array<Record<string, unknown>>)[0];
    if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'draft not found' });
    if (row.supplier_id !== args.supplierId) throw new TRPCError({ code: 'NOT_FOUND', message: 'draft not found' });
    if (row.has_gr) throw new TRPCError({ code: 'CONFLICT', message: 'DRAFT_HAS_RECEIPT' });
    if (row.status !== 'draft') throw new TRPCError({ code: 'CONFLICT', message: 'DRAFT_ALREADY_SENT' });

    const current = await loadDraft(db, args.restaurantId, draftId);
    if (!current) throw new TRPCError({ code: 'CONFLICT', message: 'DRAFT_ALREADY_SENT' });
    const stale = args.version ? args.version !== row.version : !args.draftId; // a blind first save onto an existing draft
    if (stale) {
      if (sameContent(current, args, priced)) return { ...current, replayed: true };
      const [who] = row.created_by
        ? await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, String(row.created_by))).limit(1)
        : [];
      throw draftConflict(who?.name ?? who?.email ?? null, new Date(String(row.updated_at)));
    }
    if (sameContent(current, args, priced)) return { ...current, replayed: true };
  } else {
    const [po] = await db
      .insert(purchaseOrders)
      .values({
        restaurantId: args.restaurantId,
        supplierId: args.supplierId,
        status: 'draft',
        source: 'manual',
        createdBy: args.userId,
      })
      .returning({ id: purchaseOrders.id });
    draftId = po!.id;
  }

  await db.delete(poLines).where(eq(poLines.poId, draftId));
  if (priced.length > 0) {
    await db.insert(poLines).values(
      priced.map((l) => ({
        poId: draftId!,
        productId: l.productId ?? null,
        rawDescription: l.rawDescription?.trim() || null,
        qtyOrdered: String(qty3(l.qty)),
        unit: l.unit,
        unitPriceExpected: l.unitPriceExpected == null ? null : String(l.unitPriceExpected),
      })),
    );
  }
  const totalEstimated = estimateTotal(
    priced.map((l) => ({ qty: l.qty, unitPriceExpected: l.unitPriceExpected ?? undefined })),
  );
  await db
    .update(purchaseOrders)
    .set({ expectedDeliveryAt: args.expectedDeliveryAt, totalEstimated, updatedAt: new Date() })
    .where(eq(purchaseOrders.id, draftId));
  const saved = await loadDraft(db, args.restaurantId, draftId);
  return { ...saved!, replayed: false };
}
