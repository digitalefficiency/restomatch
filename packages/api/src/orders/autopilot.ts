/**
 * W3-09 / AU-11 · Order autopilot, the DB side: a prepared draft before the
 * order day, a backorder draft after a short delivery, and the list of placed
 * orders whose send failed.
 *
 * Nothing here sends to a supplier. A draft is inserted with `created_by NULL`
 * and stays a draft until a person opens it (adoption, `drafts.ts`) and sends
 * it through W2-06 (`placeOrder` / `markSentManually` / `sendMany`). No outbox
 * row is ever written here.
 *
 * Every query is restaurant-scoped; callers pass the tenant transaction.
 */
import {
  and,
  auditLog,
  desc,
  discrepancies,
  eq,
  goodsReceipts,
  grLines,
  gte,
  inArray,
  invoiceLines,
  isNotNull,
  isNull,
  lt,
  matchRuns,
  ne,
  notificationsOutbox,
  or,
  poLines,
  purchaseOrders,
  restaurants,
  sql,
  suppliers,
  users,
  type Database,
} from '@restomatch/db';
import { buildOrderGuide } from './guide';
import { planBackorder, type BackorderLineInput, type BackorderPlan } from './backorder';
import {
  AUTOPILOT_REF_LIKES,
  PREPARED_NOTE,
  backorderSourceRef,
  buildPreparedLines,
  preparedSkipReason,
  preparedSourceRef,
  type GuideRow,
  type PreparedSkip,
} from './prepared';
import { needsSendRescue, RESCUE_LOOKBACK_MS } from './sendRescue';
import { estimateTotal } from './totals';
import { ordersAutopilotHe } from './messages/he';
import { ordersAutopilotEn } from './messages/en';
import { notify, type Rendered, type RenderInput } from '../notifications/notify';
import { SKIPPED_NO_PROVIDER } from '../notifications/delivery';
import { poRefOf } from './supplierMessage';
import { automationOption } from '../automations/options';
import type { AuditAction } from '../audit';
import type { SendState } from '../routers/orders';

export { ordersAutopilotEn, ordersAutopilotHe } from './messages';

// ─── options (AU-01 registry rows A16 / A16b / A16c) ──────────────────────────

export type AutopilotOptionKey = 'preparedOrderDraft' | 'backorderDraft' | 'sendRescue';

/** The AU-01 reader: the stored boolean, else the registry default (prepared OFF, the others ON). */
export function autopilotOption(settings: unknown, key: AutopilotOptionKey): boolean {
  return automationOption(settings, key);
}

async function restaurantSettings(db: Database, restaurantId: string): Promise<unknown> {
  const [r] = await db.select({ settings: restaurants.settings }).from(restaurants).where(eq(restaurants.id, restaurantId)).limit(1);
  return r?.settings ?? null;
}

// ─── shared ─────────────────────────────────────────────────────────────────

async function lockRef(db: Database, restaurantId: string, ref: string): Promise<void> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${restaurantId}:${ref}`}, 0))`);
}

async function poByRef(db: Database, restaurantId: string, ref: string): Promise<{ id: string; status: string } | null> {
  const [row] = await db
    .select({ id: purchaseOrders.id, status: purchaseOrders.status })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.restaurantId, restaurantId), eq(purchaseOrders.sourceRef, ref)))
    .limit(1);
  return row ?? null;
}

/** Audit row: append-only insert, typed by the AuditAction taxonomy. */
async function audit(
  db: Database,
  row: { restaurantId: string; userId: string | null; action: AuditAction; entityId: string; after: Record<string, unknown> },
): Promise<void> {
  await db.insert(auditLog).values({
    restaurantId: row.restaurantId,
    userId: row.userId,
    action: row.action,
    entityType: 'purchase_order',
    entityId: row.entityId,
    after: row.after,
  });
}

const autopilotRefSql = sql`(${purchaseOrders.sourceRef} like ${AUTOPILOT_REF_LIKES[0]} or ${purchaseOrders.sourceRef} like ${AUTOPILOT_REF_LIKES[1]})`;

// ─── A16a · prepared draft ──────────────────────────────────────────────────

export type PrepareResult =
  | { status: 'created' | 'exists'; poId: string; lineCount: number }
  | { status: 'skipped'; reason: PreparedSkip | 'option_off' | 'handled' };

export interface PrepareArgs {
  restaurantId: string;
  supplierId: string;
  /** The Israel order day, 'YYYY-MM-DD'. */
  orderDay: string;
  /** [dayStart, dayEnd) of that day (UTC instants) — "a PO today" is created inside it. */
  dayStart: Date;
  dayEnd: Date;
  now: Date;
  expectedDeliveryAt?: Date | null;
  /** Skip the option check (the caller already read it). */
  optionChecked?: boolean;
}

/**
 * One prepared draft per supplier per order day. Never changes another PO,
 * never enqueues anything. Idempotent: a second run the same day returns it.
 */
export async function prepareOrderDraft(db: Database, args: PrepareArgs): Promise<PrepareResult> {
  if (!args.optionChecked && !autopilotOption(await restaurantSettings(db, args.restaurantId), 'preparedOrderDraft')) {
    return { status: 'skipped', reason: 'option_off' };
  }
  const ref = preparedSourceRef(args.supplierId, args.orderDay);
  await lockRef(db, args.restaurantId, ref);
  const existing = await poByRef(db, args.restaurantId, ref);
  // Dismissed or already sent: never announce it again, never prepare a second one.
  if (existing && existing.status !== 'draft') return { status: 'skipped', reason: 'handled' };
  if (existing) {
    const [c] = await db.select({ n: sql<number>`count(*)::int` }).from(poLines).where(eq(poLines.poId, existing.id));
    return { status: 'exists', poId: existing.id, lineCount: Number(c?.n ?? 0) };
  }

  const [supplier] = await db
    .select({ active: suppliers.active })
    .from(suppliers)
    .where(and(eq(suppliers.id, args.supplierId), eq(suppliers.restaurantId, args.restaurantId)))
    .limit(1);
  if (!supplier) return { status: 'skipped', reason: 'inactive' };

  const [today] = await db
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(
      and(
        eq(purchaseOrders.restaurantId, args.restaurantId),
        eq(purchaseOrders.supplierId, args.supplierId),
        ne(purchaseOrders.status, 'cancelled'),
        gte(purchaseOrders.createdAt, args.dayStart),
        lt(purchaseOrders.createdAt, args.dayEnd),
      ),
    )
    .limit(1);
  const [human] = await db
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(
      and(
        eq(purchaseOrders.restaurantId, args.restaurantId),
        eq(purchaseOrders.supplierId, args.supplierId),
        eq(purchaseOrders.status, 'draft'),
        isNotNull(purchaseOrders.createdBy),
      ),
    )
    .limit(1);

  const guide = await buildOrderGuide(db, { restaurantId: args.restaurantId, supplierId: args.supplierId, at: args.now });
  const rows: GuideRow[] = guide.rows.map((r) => ({
    productId: r.productId,
    description: r.name,
    unit: r.unit,
    usualQty: r.usualQty > 0 ? r.usualQty : null,
    frequency: r.timesOrdered,
  }));
  const skip = preparedSkipReason(
    { supplierActive: supplier.active, hasPoToday: !!today, hasOpenHumanDraft: !!human },
    rows,
  );
  if (skip) return { status: 'skipped', reason: skip };

  // The guide's price IS resolveExpectedPrice (contract > last sent > list), never the invoice.
  const priceByKey = new Map(guide.rows.map((r) => [`${r.productId ?? ''}|${r.name}|${r.unit}`, r] as const));
  const lines = buildPreparedLines(rows, (row) => {
    const g = priceByKey.get(`${row.productId ?? ''}|${row.description}|${row.unit}`);
    return { unitPrice: g?.unitPrice ?? null, source: g?.priceSource ?? null };
  });

  const [po] = await db
    .insert(purchaseOrders)
    .values({
      restaurantId: args.restaurantId,
      supplierId: args.supplierId,
      status: 'draft',
      source: 'recurring',
      sourceRef: ref,
      createdBy: null,
      notes: PREPARED_NOTE,
      expectedDeliveryAt: args.expectedDeliveryAt ?? null,
      totalEstimated: estimateTotal(lines.map((l) => ({ qty: l.qty, unitPriceExpected: l.unitPriceExpected }))),
    })
    .returning({ id: purchaseOrders.id });
  if (!po) throw new Error('failed to insert the prepared draft');
  await db.insert(poLines).values(
    lines.map((l) => ({
      poId: po.id,
      productId: l.productId,
      rawDescription: l.rawDescription,
      qtyOrdered: l.qty.toString(),
      unit: l.unit,
      unitPriceExpected: l.unitPriceExpected == null ? null : l.unitPriceExpected.toString(),
    })),
  );
  await audit(db, {
    restaurantId: args.restaurantId,
    userId: null,
    action: 'order.prepared_draft_created',
    entityId: po.id,
    after: { sourceRef: ref, lines: lines.length, orderDay: args.orderDay },
  });
  return { status: 'created', poId: po.id, lineCount: lines.length };
}

// ─── adoption (called from drafts.openDraft) ─────────────────────────────────

/**
 * The newest unowned autopilot draft for this supplier becomes the caller's:
 * a guarded `UPDATE … WHERE created_by IS NULL` so of two orderers opening it
 * at once exactly one wins. Returns the adopted id, or null.
 */
export async function adoptAutopilotDraft(
  db: Database,
  args: { restaurantId: string; supplierId: string; userId: string },
): Promise<string | null> {
  const candidates = await db
    .select({ id: purchaseOrders.id, sourceRef: purchaseOrders.sourceRef })
    .from(purchaseOrders)
    .where(
      and(
        eq(purchaseOrders.restaurantId, args.restaurantId),
        eq(purchaseOrders.supplierId, args.supplierId),
        eq(purchaseOrders.status, 'draft'),
        isNull(purchaseOrders.createdBy),
        autopilotRefSql,
      ),
    )
    .orderBy(desc(purchaseOrders.createdAt), desc(purchaseOrders.id));
  for (const c of candidates) {
    const won = await db
      .update(purchaseOrders)
      .set({ createdBy: args.userId, updatedAt: new Date() })
      .where(
        and(
          eq(purchaseOrders.id, c.id),
          eq(purchaseOrders.restaurantId, args.restaurantId),
          eq(purchaseOrders.status, 'draft'),
          isNull(purchaseOrders.createdBy),
        ),
      )
      .returning({ id: purchaseOrders.id });
    if (won.length > 0) {
      await audit(db, {
        restaurantId: args.restaurantId,
        userId: args.userId,
        action: c.sourceRef?.startsWith('au:A16b:') ? 'order.backorder_draft_opened' : 'order.prepared_draft_opened',
        entityId: c.id,
        after: { sourceRef: c.sourceRef },
      });
      return c.id;
    }
  }
  return null;
}

// ─── board: the unopened autopilot drafts ────────────────────────────────────

export interface AutopilotDraftRow {
  poId: string;
  supplierId: string;
  supplierName: string;
  kind: 'prepared' | 'backorder';
  lineCount: number;
  totalEstimated: string | null;
  createdAt: string;
  /** Who opened it; null = still unopened. */
  openedBy: string | null;
  notes: string | null;
}

export async function listAutopilotDrafts(db: Database, restaurantId: string): Promise<AutopilotDraftRow[]> {
  const rows = await db
    .select({
      poId: purchaseOrders.id,
      supplierId: purchaseOrders.supplierId,
      supplierName: suppliers.name,
      sourceRef: purchaseOrders.sourceRef,
      totalEstimated: purchaseOrders.totalEstimated,
      createdAt: purchaseOrders.createdAt,
      notes: purchaseOrders.notes,
      openedByName: users.name,
      openedByEmail: users.email,
      lineCount: sql<number>`(select count(*)::int from ${poLines} where ${poLines.poId} = ${purchaseOrders.id})`,
    })
    .from(purchaseOrders)
    .innerJoin(suppliers, and(eq(suppliers.id, purchaseOrders.supplierId), eq(suppliers.restaurantId, restaurantId)))
    .leftJoin(users, eq(users.id, purchaseOrders.createdBy))
    .where(and(eq(purchaseOrders.restaurantId, restaurantId), eq(purchaseOrders.status, 'draft'), autopilotRefSql))
    .orderBy(desc(purchaseOrders.createdAt), desc(purchaseOrders.id));
  return rows.map((r) => ({
    poId: r.poId,
    supplierId: r.supplierId,
    supplierName: r.supplierName,
    kind: r.sourceRef?.startsWith('au:A16b:') ? 'backorder' : 'prepared',
    lineCount: Number(r.lineCount),
    totalEstimated: r.totalEstimated,
    createdAt: r.createdAt.toISOString(),
    openedBy: r.openedByName ?? r.openedByEmail ?? null,
    notes: r.notes,
  }));
}

export type DismissResult = { status: 'cancelled' | 'already_cancelled' } | { status: 'not_found' } | { status: 'conflict'; reason: 'not_draft' | 'not_autopilot' | 'opened' };

/**
 * Cancel an UNOPENED autopilot draft (draft → cancelled). A sent PO, a draft a
 * person already opened, or a draft that is not the autopilot's → conflict.
 */
export async function dismissAutopilotDraft(
  db: Database,
  args: { restaurantId: string; poId: string; userId: string },
): Promise<DismissResult> {
  const [po] = await db
    .select({ status: purchaseOrders.status, sourceRef: purchaseOrders.sourceRef, createdBy: purchaseOrders.createdBy })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, args.poId), eq(purchaseOrders.restaurantId, args.restaurantId)))
    .limit(1);
  if (!po) return { status: 'not_found' };
  if (!po.sourceRef || !(po.sourceRef.startsWith('au:A16:') || po.sourceRef.startsWith('au:A16b:'))) {
    return { status: 'conflict', reason: 'not_autopilot' };
  }
  if (po.status === 'cancelled') return { status: 'already_cancelled' };
  if (po.status !== 'draft') return { status: 'conflict', reason: 'not_draft' };
  if (po.createdBy) return { status: 'conflict', reason: 'opened' };
  const moved = await db
    .update(purchaseOrders)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(
      and(
        eq(purchaseOrders.id, args.poId),
        eq(purchaseOrders.restaurantId, args.restaurantId),
        eq(purchaseOrders.status, 'draft'),
        isNull(purchaseOrders.createdBy),
      ),
    )
    .returning({ id: purchaseOrders.id });
  if (moved.length === 0) return { status: 'conflict', reason: 'opened' };
  await audit(db, {
    restaurantId: args.restaurantId,
    userId: args.userId,
    action: po.sourceRef.startsWith('au:A16b:') ? 'order.backorder_draft_dismissed' : 'order.prepared_draft_dismissed',
    entityId: args.poId,
    after: { sourceRef: po.sourceRef, status: 'cancelled' },
  });
  return { status: 'cancelled' };
}

// ─── A16b · backorder draft ──────────────────────────────────────────────────

export type BackorderResult =
  | { status: 'created' | 'exists'; poId: string; lineCount: number; plan?: BackorderPlan }
  | { status: 'skipped'; reason: 'option_off' | 'not_found' | 'not_partial' | 'no_po' | 'nothing_to_reorder' };

/**
 * After a receipt closed PARTIAL: one draft with the missing quantities, never
 * the units the supplier billed (they belong to a credit request). The receipt
 * is re-read under this restaurant id; nothing in a payload is trusted.
 * Idempotent per receipt.
 */
export async function prepareBackorderDraft(
  db: Database,
  args: { restaurantId: string; goodsReceiptId: string; now: Date; expectedDeliveryAt?: Date | null },
): Promise<BackorderResult> {
  if (!autopilotOption(await restaurantSettings(db, args.restaurantId), 'backorderDraft')) {
    return { status: 'skipped', reason: 'option_off' };
  }
  const [gr] = await db
    .select({ id: goodsReceipts.id, status: goodsReceipts.status, poId: goodsReceipts.poId })
    .from(goodsReceipts)
    .where(and(eq(goodsReceipts.id, args.goodsReceiptId), eq(goodsReceipts.restaurantId, args.restaurantId)))
    .limit(1);
  if (!gr) return { status: 'skipped', reason: 'not_found' };
  if (gr.status !== 'partial') return { status: 'skipped', reason: 'not_partial' };
  if (!gr.poId) return { status: 'skipped', reason: 'no_po' };

  const ref = backorderSourceRef(gr.id);
  await lockRef(db, args.restaurantId, ref);
  const existing = await poByRef(db, args.restaurantId, ref);
  if (existing) {
    const [c] = await db.select({ n: sql<number>`count(*)::int` }).from(poLines).where(eq(poLines.poId, existing.id));
    return { status: 'exists', poId: existing.id, lineCount: Number(c?.n ?? 0) };
  }

  const [po] = await db
    .select({ id: purchaseOrders.id, supplierId: purchaseOrders.supplierId, sourceRef: purchaseOrders.sourceRef })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, gr.poId), eq(purchaseOrders.restaurantId, args.restaurantId)))
    .limit(1);
  if (!po) return { status: 'skipped', reason: 'no_po' };

  const ordered = await db
    .select({
      id: poLines.id,
      productId: poLines.productId,
      rawDescription: poLines.rawDescription,
      unit: poLines.unit,
      qtyOrdered: poLines.qtyOrdered,
      unitPriceExpected: poLines.unitPriceExpected,
    })
    .from(poLines)
    .where(eq(poLines.poId, po.id));
  if (ordered.length === 0) return { status: 'skipped', reason: 'nothing_to_reorder' };

  const received = await db
    .select({ poLineId: grLines.poLineId, qty: sql<string>`sum(${grLines.qtyReceived})` })
    .from(grLines)
    .where(and(eq(grLines.grId, gr.id), isNotNull(grLines.poLineId)))
    .groupBy(grLines.poLineId);
  const receivedBy = new Map(received.map((r) => [r.poLineId!, Number(r.qty)]));

  // Billed-not-received (engine.ts, read-only): a QTY_OVER on this order line
  // stores the billed quantity in `actual_value`, ALREADY CONVERTED to the order's
  // unit. Every status but 'rejected' counts (an escalated/resolved one is a
  // credit request in progress). Per invoice the newest run's value wins (a
  // re-match is not a second bill); across invoices the bills ADD UP.
  const over = await db
    .select({ poLineId: discrepancies.poLineId, invoiceId: matchRuns.invoiceId, actual: discrepancies.actualValue })
    .from(discrepancies)
    .innerJoin(matchRuns, and(eq(matchRuns.id, discrepancies.matchRunId), eq(matchRuns.restaurantId, args.restaurantId)))
    .where(
      and(
        eq(discrepancies.restaurantId, args.restaurantId),
        eq(discrepancies.type, 'QTY_OVER'),
        ne(discrepancies.resolutionStatus, 'rejected'),
        inArray(
          discrepancies.poLineId,
          ordered.map((l) => l.id),
        ),
      ),
    );
  const overByLineInvoice = new Map<string, number>(); // `${poLineId}|${invoiceId}` → billed
  for (const o of over) {
    if (!o.poLineId || o.actual == null) continue;
    const k = `${o.poLineId}|${o.invoiceId ?? ''}`;
    overByLineInvoice.set(k, Math.max(overByLineInvoice.get(k) ?? 0, Number(o.actual)));
  }
  const billedBy = new Map<string, number>();
  for (const [k, v] of overByLineInvoice) {
    const line = k.split('|')[0]!;
    billedBy.set(line, (billedBy.get(line) ?? 0) + v);
  }

  // Invoices already matched against this receipt: what each billed per product,
  // in case a stale run lacks the QTY_OVER. Only lines in the ORDER's unit are
  // summed; a line in another unit (case vs unit, g vs kg) cannot be compared
  // here, so the order line is treated as billed in full — never re-ordered.
  const runs = await db
    .select({ invoiceId: matchRuns.invoiceId })
    .from(matchRuns)
    .where(and(eq(matchRuns.restaurantId, args.restaurantId), eq(matchRuns.grId, gr.id)));
  const invoiceIds = [...new Set(runs.map((r) => r.invoiceId).filter((x): x is string => !!x))];
  const billedByProductUnit = new Map<string, number>(); // `${productId}|${unit}` → Σ over invoices
  const productsWithOtherUnit = new Set<string>(); // `${productId}|${orderUnit}` billed in a different unit
  if (invoiceIds.length > 0) {
    const lines = await db
      .select({ productId: invoiceLines.productId, unit: invoiceLines.unit, qty: invoiceLines.qtyBilled })
      .from(invoiceLines)
      .where(and(inArray(invoiceLines.invoiceId, invoiceIds), isNotNull(invoiceLines.productId)));
    for (const r of lines) {
      const k = `${r.productId}|${r.unit}`;
      billedByProductUnit.set(k, (billedByProductUnit.get(k) ?? 0) + Number(r.qty));
    }
    for (const l of ordered) {
      if (!l.productId) continue;
      if (lines.some((r) => r.productId === l.productId && r.unit !== l.unit)) productsWithOtherUnit.add(`${l.productId}|${l.unit}`);
    }
  }
  const matched = invoiceIds.length > 0;

  const input: BackorderLineInput[] = ordered.map((l) => {
    const rec = receivedBy.get(l.id) ?? 0;
    const qtyOrdered = Number(l.qtyOrdered);
    const key = l.productId ? `${l.productId}|${l.unit}` : null;
    const otherUnit = key ? productsWithOtherUnit.has(key) : false;
    const fromInvoice = key ? (billedByProductUnit.get(key) ?? 0) : 0;
    const billed = otherUnit ? qtyOrdered : Math.max(billedBy.get(l.id) ?? 0, fromInvoice);
    return {
      poLineId: l.id,
      productId: l.productId,
      description: l.rawDescription ?? '',
      unit: l.unit,
      qtyOrdered,
      qtyReceived: rec,
      // null = no invoice yet; a matched receipt without a billed line billed nothing for it.
      qtyBilled: matched || billedBy.has(l.id) ? billed : null,
    };
  });
  const plan = planBackorder(input);
  if (plan.lines.length === 0) return { status: 'skipped', reason: 'nothing_to_reorder' };

  const priceOf = new Map(ordered.map((l) => [l.id, l.unitPriceExpected]));
  const poRef = poRefOf(po.id);
  const noteLines = [
    ordersAutopilotHe.backorderNotes(poRef),
    ...plan.notes.map((n) =>
      n.kind === 'billed_in_full' ? ordersAutopilotHe.backorderBilledInFull(n.description) : ordersAutopilotHe.backorderBilledInPart(n.description),
    ),
    ...(plan.invoiceNotMatched ? [ordersAutopilotHe.backorderInvoiceNotMatched] : []),
  ];

  const [draft] = await db
    .insert(purchaseOrders)
    .values({
      restaurantId: args.restaurantId,
      supplierId: po.supplierId,
      status: 'draft',
      source: 'manual',
      sourceRef: ref,
      createdBy: null,
      notes: noteLines.join('\n'),
      expectedDeliveryAt: args.expectedDeliveryAt ?? null,
      // The order's own expected price for the same line (it was resolveExpectedPrice when ordered).
      totalEstimated: estimateTotal(plan.lines.map((l) => ({ qty: l.qty, unitPriceExpected: priceOf.get(l.poLineId) ?? null }))),
    })
    .returning({ id: purchaseOrders.id });
  if (!draft) throw new Error('failed to insert the backorder draft');
  await db.insert(poLines).values(
    plan.lines.map((l) => ({
      poId: draft.id,
      productId: l.productId,
      rawDescription: l.rawDescription,
      qtyOrdered: l.qty.toString(),
      unit: l.unit,
      unitPriceExpected: priceOf.get(l.poLineId) ?? null,
    })),
  );
  await audit(db, {
    restaurantId: args.restaurantId,
    userId: null,
    action: 'order.backorder_draft_created',
    entityId: draft.id,
    after: { sourceRef: ref, fromPo: po.id, lines: plan.lines.length, excluded: plan.notes.length, invoiceNotMatched: plan.invoiceNotMatched },
  });
  return { status: 'created', poId: draft.id, lineCount: plan.lines.length, plan };
}

// ─── A16c · failed-send rescue ───────────────────────────────────────────────

export interface RescueRow {
  poId: string;
  supplierId: string;
  supplierName: string;
  createdBy: string | null;
}

/**
 * Placed orders (last 48 h) whose `po:<id>:placed` message failed or had no
 * provider, not sent by hand and with no goods receipt. Reads only.
 */
export async function findSendRescues(db: Database, restaurantId: string, now: Date): Promise<RescueRow[]> {
  const since = new Date(now.getTime() - RESCUE_LOOKBACK_MS);
  const rows = await db
    .select({
      poId: purchaseOrders.id,
      supplierId: purchaseOrders.supplierId,
      supplierName: suppliers.name,
      status: purchaseOrders.status,
      sentAt: purchaseOrders.sentAt,
      createdBy: purchaseOrders.createdBy,
      msgStatus: notificationsOutbox.status,
      msgError: notificationsOutbox.lastError,
      manual: sql<boolean>`exists (select 1 from ${auditLog} a where a.restaurant_id = ${restaurantId} and a.entity_id = ${purchaseOrders.id} and a.action = 'order.sent_manually')`,
      hasGr: sql<boolean>`exists (select 1 from ${goodsReceipts} g where g.restaurant_id = ${restaurantId} and g.po_id = ${purchaseOrders.id})`,
    })
    .from(purchaseOrders)
    .innerJoin(suppliers, and(eq(suppliers.id, purchaseOrders.supplierId), eq(suppliers.restaurantId, restaurantId)))
    .innerJoin(
      notificationsOutbox,
      and(
        eq(notificationsOutbox.restaurantId, restaurantId),
        eq(notificationsOutbox.dedupeKey, sql`'po:' || ${purchaseOrders.id}::text || ':placed'`),
      ),
    )
    .where(
      and(
        eq(purchaseOrders.restaurantId, restaurantId),
        or(eq(notificationsOutbox.status, 'failed'), eq(notificationsOutbox.lastError, SKIPPED_NO_PROVIDER)),
        gte(purchaseOrders.sentAt, since),
      ),
    );
  return rows
    .filter((r) =>
      needsSendRescue(
        {
          poId: r.poId,
          poStatus: r.status,
          placedAt: r.sentAt,
          sendState: (r.msgError === SKIPPED_NO_PROVIDER ? 'skipped' : r.msgStatus === 'failed' ? 'failed' : 'queued') as SendState,
          sentManually: !!r.manual,
          hasGoodsReceipt: !!r.hasGr,
        },
        now,
      ),
    )
    .map((r) => ({ poId: r.poId, supplierId: r.supplierId, supplierName: r.supplierName, createdBy: r.createdBy }));
}

// ─── notices (G-06 notify(): quiet hours, ≤6/day, never to receivers, no ₪) ──

/** The go-link so the right restaurant opens (multi-restaurant users). */
export function autopilotDeepLink(restaurantId: string, poId: string): string {
  return `/dashboard/go?r=${encodeURIComponent(restaurantId)}&to=${encodeURIComponent(`/dashboard/orders/${poId}`)}`;
}

/** Orderers only: the receiver never hears about drafts or sends. */
export const AUTOPILOT_ROLES = ['owner', 'manager', 'chef'] as const;

function renderNotice(title: { he: string; en: string }, cta: { he: string; en: string }) {
  return (i: RenderInput): Rendered | null => {
    if (!(AUTOPILOT_ROLES as readonly string[]).includes(i.role)) return null;
    const t = i.locale === 'en' ? title.en : title.he;
    const c = i.locale === 'en' ? cta.en : cta.he;
    const link = i.deepLink ? `\n${c}: ${i.deepLink}` : '';
    return { subject: t, body: `${t}${link}` };
  };
}

/** "חסרו 2 פריטים מ<ספק> · הכנו טיוטת השלמה" → the PO's sender + owner/manager. */
export async function notifyBackorderDraft(
  db: Database,
  args: { restaurantId: string; draftPoId: string; fromPoId: string; supplierName: string; missing: number; now?: Date },
): Promise<void> {
  const render = renderNotice(
    { he: ordersAutopilotHe.backorderTitle(args.supplierName, args.missing), en: ordersAutopilotEn.backorderTitle(args.supplierName, args.missing) },
    { he: ordersAutopilotHe.backorderCta, en: ordersAutopilotEn.backorderCta },
  );
  const base = {
    restaurantId: args.restaurantId,
    event: 'au:A16b',
    template: 'orders.backorder_draft',
    deepLink: autopilotDeepLink(args.restaurantId, args.draftPoId),
    entity: { type: 'purchase_order', id: args.draftPoId },
    render,
    now: args.now,
  };
  await notify(db, { ...base, audience: { poSenderOf: args.fromPoId } });
  await notify(db, { ...base, audience: { roles: ['owner', 'manager'] } });
}

/** "ההזמנה ל<ספק> לא נשלחה · שלחו מהוואטסאפ שלכם בלחיצה" → the PO's creator, else managers. */
export async function notifySendRescue(
  db: Database,
  args: { restaurantId: string; poId: string; supplierName: string; createdBy: string | null; now?: Date },
): Promise<void> {
  await notify(db, {
    restaurantId: args.restaurantId,
    event: 'au:A16c',
    template: 'orders.send_rescue',
    audience: args.createdBy ? { userIds: [args.createdBy] } : { roles: ['owner', 'manager'] },
    deepLink: autopilotDeepLink(args.restaurantId, args.poId),
    entity: { type: 'purchase_order', id: args.poId },
    render: renderNotice(
      { he: ordersAutopilotHe.rescueTitle(args.supplierName), en: ordersAutopilotEn.rescueTitle(args.supplierName) },
      { he: ordersAutopilotHe.rescueCta, en: ordersAutopilotEn.rescueCta },
    ),
    now: args.now,
  });
}
