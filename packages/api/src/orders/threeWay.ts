import { and, asc, desc, discrepancies, eq, goodsReceipts, grLines, inArray, invoiceLines, matchRuns, poLines, sql, type Database } from '@restomatch/db';

/**
 * The order's 3-way view (W2-06 §5.5, orders-11): per PO line, what was
 * ordered, received and billed, and the gap in ₪, so the detail page is not an
 * island. Read-only; the caller has already checked the PO is the tenant's.
 *
 * - received = Σ (received − rejected) over the PO's goods receipts;
 * - billed   = the invoice line a discrepancy pairs with this PO line, else the
 *              invoice line of the same product+unit, in the invoices the match
 *              runs tie to this PO (latest run per invoice);
 * - gap ₪    = Σ |deltaAmount| of that line's discrepancies in those runs.
 * Unknown stays null (never ₪0).
 */
export interface ThreeWayLine {
  poLineId: string;
  name: string;
  unit: string;
  ordered: number;
  received: number | null;
  billed: number | null;
  unitPriceExpected: number | null;
  unitPriceBilled: number | null;
  gapIls: number | null;
}

export async function buildThreeWay(
  db: Database,
  args: { restaurantId: string; poId: string },
): Promise<{ lines: ThreeWayLine[]; hasReceipt: boolean; hasInvoice: boolean; gapTotalIls: number | null }> {
  const lines = await db
    .select()
    .from(poLines)
    .where(eq(poLines.poId, args.poId))
    .orderBy(sql`${poLines.rawDescription} ASC NULLS LAST`, asc(poLines.id));

  const grRows = await db
    .select({
      poLineId: grLines.poLineId,
      received: sql<string>`sum(${grLines.qtyReceived} - coalesce(${grLines.qtyRejected}, 0))`,
    })
    .from(grLines)
    .innerJoin(goodsReceipts, eq(goodsReceipts.id, grLines.grId))
    .where(and(eq(goodsReceipts.poId, args.poId), eq(goodsReceipts.restaurantId, args.restaurantId)))
    .groupBy(grLines.poLineId);
  const receivedBy = new Map(grRows.filter((r) => r.poLineId).map((r) => [r.poLineId!, Number(r.received)] as const));
  const hasReceipt =
    (
      await db
        .select({ id: goodsReceipts.id })
        .from(goodsReceipts)
        .where(and(eq(goodsReceipts.poId, args.poId), eq(goodsReceipts.restaurantId, args.restaurantId)))
        .limit(1)
    ).length > 0;

  // Latest match run per invoice for this PO.
  const runs = await db
    .selectDistinctOn([matchRuns.invoiceId], { id: matchRuns.id, invoiceId: matchRuns.invoiceId })
    .from(matchRuns)
    .where(and(eq(matchRuns.poId, args.poId), eq(matchRuns.restaurantId, args.restaurantId)))
    .orderBy(matchRuns.invoiceId, desc(matchRuns.runAt), desc(matchRuns.id));
  const invoiceIds = runs.map((r) => r.invoiceId).filter((id): id is string => !!id);
  const runIds = runs.map((r) => r.id);

  const invLines = invoiceIds.length
    ? await db.select().from(invoiceLines).where(inArray(invoiceLines.invoiceId, invoiceIds))
    : [];
  const discs = runIds.length
    ? await db
        .select({
          poLineId: discrepancies.poLineId,
          invoiceLineId: discrepancies.invoiceLineId,
          delta: discrepancies.deltaAmount,
        })
        .from(discrepancies)
        .where(inArray(discrepancies.matchRunId, runIds))
    : [];

  const invById = new Map(invLines.map((l) => [l.id, l] as const));
  const used = new Set<string>();
  let gapTotal: number | null = invoiceIds.length ? 0 : null;
  const out: ThreeWayLine[] = lines.map((l) => {
    const mine = discs.filter((d) => d.poLineId === l.id);
    let inv = mine.map((d) => (d.invoiceLineId ? invById.get(d.invoiceLineId) : undefined)).find(Boolean);
    if (!inv && l.productId) {
      inv = invLines.find((x) => !used.has(x.id) && x.productId === l.productId && x.unit === l.unit) ??
        invLines.find((x) => !used.has(x.id) && x.productId === l.productId);
    }
    if (inv) used.add(inv.id);
    const gap = invoiceIds.length
      ? Math.round(mine.reduce((s, d) => s + Math.abs(Number(d.delta ?? 0)) * 100, 0)) / 100
      : null;
    if (gap !== null && gapTotal !== null) gapTotal = Math.round((gapTotal + gap) * 100) / 100;
    return {
      poLineId: l.id,
      name: l.rawDescription?.trim() || '',
      unit: l.unit,
      ordered: Number(l.qtyOrdered),
      received: hasReceipt ? (receivedBy.get(l.id) ?? 0) : null,
      billed: invoiceIds.length ? (inv ? Number(inv.qtyBilled) : 0) : null,
      unitPriceExpected: l.unitPriceExpected == null ? null : Number(l.unitPriceExpected),
      unitPriceBilled: inv ? Number(inv.unitPriceBilled) : null,
      gapIls: gap,
    };
  });
  return { lines: out, hasReceipt, hasInvoice: invoiceIds.length > 0, gapTotalIls: gapTotal };
}
