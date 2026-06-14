/**
 * Demo-flow generator: turns the static seed (restaurant + POs) into a fully
 * MATCHED dataset so the live dashboard shows real KPIs, a leaks heatmap, and a
 * populated approvals queue — without needing Redis/OCR. It runs the REAL
 * matching engine + approvals engine (the same code the worker uses), so every
 * discrepancy and routing decision is authentic.
 *
 * Run: DATABASE_URL=... pnpm --filter @restomatch/worker exec tsx scripts/seed-demo.ts
 */
import {
  buildRules,
  evaluateApproval,
  resolveApprovalThresholds,
  type ApprovalContext,
} from '@restomatch/api';
import {
  activityEvents,
  and,
  asc,
  createDb,
  discrepancies,
  eq,
  goodsReceipts,
  grLines,
  invoiceLines,
  invoices,
  matchRuns,
  poLines,
  priceHistory,
  purchaseOrders,
  restaurants,
  suppliers,
  type UserRole,
} from '@restomatch/db';
import {
  resolveTolerances,
  runMatch,
  type InvoiceLineInput,
  type MatchInput,
} from '@restomatch/matching';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const db = createDb(url);

// Deterministic pseudo-random so re-runs are stable-ish (no Math.random ban here).
let seed = 1337;
const rand = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)]!;

async function main() {
  const [restaurant] = await db.select().from(restaurants).limit(1);
  if (!restaurant) throw new Error('no restaurant — run the base seed first');
  const restaurantId = restaurant.id;

  // Clean any prior demo-flow rows (idempotent re-run).
  await db.delete(discrepancies).where(eq(discrepancies.restaurantId, restaurantId));
  await db.delete(matchRuns).where(eq(matchRuns.restaurantId, restaurantId));
  await db.delete(invoiceLines);
  await db.delete(invoices).where(eq(invoices.restaurantId, restaurantId));
  await db.delete(grLines);
  await db.delete(goodsReceipts).where(eq(goodsReceipts.restaurantId, restaurantId));
  await db.delete(priceHistory).where(eq(priceHistory.restaurantId, restaurantId));
  await db.delete(activityEvents).where(eq(activityEvents.restaurantId, restaurantId));

  const tolerances = resolveTolerances(restaurant.settings?.tolerances);
  const rules = buildRules(resolveApprovalThresholds(restaurant.settings?.approvalThresholds));
  const vatRate = Number(restaurant.vatRate ?? '0.17');

  const pos = await db
    .select()
    .from(purchaseOrders)
    .where(eq(purchaseOrders.restaurantId, restaurantId))
    .orderBy(asc(purchaseOrders.expectedDeliveryAt));

  const knownInvoiceNumbers = new Set<string>();
  let made = 0;
  let openDiscrepancies = 0;

  for (let i = 0; i < pos.length; i++) {
    const po = pos[i]!;
    const lines = await db
      .select()
      .from(poLines)
      .where(eq(poLines.poId, po.id))
      .orderBy(asc(poLines.id));
    if (lines.length === 0) continue;

    const receivedAt = new Date(po.expectedDeliveryAt ?? new Date());
    const [supplier] = await db
      .select({ name: suppliers.name })
      .from(suppliers)
      .where(eq(suppliers.id, po.supplierId))
      .limit(1);

    // Goods receipt — most lines arrive in full, ~1 in 4 short.
    const [gr] = await db
      .insert(goodsReceipts)
      .values({ restaurantId, poId: po.id, receivedAt, status: 'completed' })
      .returning();
    const grLineRows = [];
    for (const l of lines) {
      const ordered = Number(l.qtyOrdered);
      const short = rand() < 0.25;
      const qtyReceived = short ? Math.max(0, Math.round(ordered * (0.7 + rand() * 0.2))) : ordered;
      const [grl] = await db
        .insert(grLines)
        .values({
          grId: gr!.id,
          poLineId: l.id,
          productId: l.productId,
          qtyReceived: qtyReceived.toString(),
          qtyRejected: '0',
        })
        .returning();
      grLineRows.push({ poLine: l, grl: grl!, qtyReceived });
    }

    // Invoice — ~1 in 3 lines billed above the PO price.
    const invNumber = `2026-${String(1000 + i)}`;
    let subtotal = 0;
    const invLineInputs: InvoiceLineInput[] = [];
    const invoiceLineValues = [];
    for (const { poLine, grl, qtyReceived } of grLineRows) {
      const basePrice = Number(poLine.unitPriceExpected ?? 0);
      const bumped = rand() < 0.33;
      const unitPrice = bumped ? Math.round(basePrice * (1.05 + rand() * 0.12) * 100) / 100 : basePrice;
      const qtyBilled = qtyReceived; // billed for what arrived
      const lineTotal = Math.round(unitPrice * qtyBilled * 100) / 100;
      subtotal += lineTotal;
      const invLineId = crypto.randomUUID();
      invLineInputs.push({
        id: invLineId,
        productId: poLine.productId,
        qtyBilled,
        unit: poLine.unit,
        unitPriceBilled: unitPrice,
        lineTotal,
      });
      invoiceLineValues.push({
        id: invLineId,
        productId: poLine.productId,
        rawDescription: poLine.rawDescription,
        qtyBilled: qtyBilled.toString(),
        unit: poLine.unit,
        unitPriceBilled: unitPrice.toString(),
        lineTotal: lineTotal.toString(),
        vatRate: vatRate.toString(),
      });
    }
    const vatAmount = Math.round(subtotal * vatRate * 100) / 100;
    const totalInclVat = Math.round((subtotal + vatAmount) * 100) / 100;

    const [invoice] = await db
      .insert(invoices)
      .values({
        restaurantId,
        supplierId: po.supplierId,
        invoiceNumber: invNumber,
        invoiceDate: receivedAt,
        totalExclVat: subtotal.toFixed(2),
        vatAmount: vatAmount.toFixed(2),
        totalInclVat: totalInclVat.toFixed(2),
        status: 'matched',
        source: 'photo',
      })
      .returning();
    await db.insert(invoiceLines).values(
      invoiceLineValues.map((v) => ({ ...v, invoiceId: invoice!.id })),
    );

    // Price history (for leak quantification + sparklines).
    for (const v of invoiceLineValues) {
      if (!v.productId) continue;
      await db.insert(priceHistory).values({
        restaurantId,
        productId: v.productId,
        supplierId: po.supplierId,
        observedAt: receivedAt,
        unitPrice: v.unitPriceBilled,
        qty: v.qtyBilled,
        sourceInvoiceId: invoice!.id,
      });
    }

    // Run the REAL engine.
    const input: MatchInput = {
      invoice: {
        invoiceNumber: invNumber,
        invoiceDate: receivedAt,
        supplierId: po.supplierId,
        totalExclVat: subtotal,
        vatAmount,
        totalInclVat,
      },
      poLines: lines.map((l) => ({
        id: l.id,
        productId: l.productId,
        qtyOrdered: Number(l.qtyOrdered),
        unit: l.unit,
        unitPriceExpected: l.unitPriceExpected ? Number(l.unitPriceExpected) : null,
      })),
      grLines: grLineRows.map(({ poLine, grl, qtyReceived }) => ({
        id: grl.id,
        poLineId: poLine.id,
        productId: poLine.productId,
        qtyReceived,
      })),
      invoiceLines: invLineInputs,
      vatRate,
      tolerances,
      knownInvoiceNumbers,
      expectedDeliveryDate: po.expectedDeliveryAt ?? undefined,
    };
    knownInvoiceNumbers.add(invNumber);

    const result = runMatch(input);
    const [matchRun] = await db
      .insert(matchRuns)
      .values({
        restaurantId,
        poId: po.id,
        grId: gr!.id,
        invoiceId: invoice!.id,
        runAt: receivedAt,
        overallStatus: result.status,
        totalDiscrepancyAmount: result.totalDiscrepancyAmount.toFixed(2),
      })
      .returning();

    const rolesNotified = new Set<UserRole>();
    for (const d of result.discrepancies) {
      const ctx: ApprovalContext = {
        discrepancy: { type: d.type, severity: d.severity, deltaAmount: d.deltaAmount },
        matchRun: {
          totalDiscrepancyAmount: result.totalDiscrepancyAmount,
          totalInvoiceAmount: totalInclVat,
          poExists: true,
        },
      };
      const decision = evaluateApproval(ctx, rules);
      const status = decision.action === 'auto_approve' ? 'accepted' : 'open';
      if (status === 'open') openDiscrepancies++;
      if (decision.requiredRole && status === 'open') rolesNotified.add(decision.requiredRole);
      await db.insert(discrepancies).values({
        matchRunId: matchRun!.id,
        restaurantId,
        type: d.type,
        severity: d.severity,
        productId: d.productId,
        poLineId: d.poLineId ?? null,
        grLineId: d.grLineId ?? null,
        invoiceLineId: d.invoiceLineId ?? null,
        expectedValue: d.expected?.toString() ?? null,
        actualValue: d.actual?.toString() ?? null,
        deltaAmount: d.deltaAmount.toFixed(2),
        toleranceUsed: d.toleranceUsed,
        requiresRole: decision.requiredRole,
        ruleId: decision.ruleId,
        ruleName: decision.ruleName,
        resolutionStatus: status,
      });
    }

    await db.insert(activityEvents).values({
      restaurantId,
      eventType: 'invoice_matched',
      title: `חשבונית ${invNumber} הותאמה`,
      detail: `${supplier?.name ?? 'ספק'} · ${result.discrepancies.length} חריגות · הפסד פוטנציאלי ₪${result.totalDiscrepancyAmount.toFixed(0)}`,
      entityType: 'match_run',
      entityId: matchRun!.id,
      metadata: {},
    });

    made++;
  }

  console.log(
    `[seed-demo] matched ${made} invoices · ${openDiscrepancies} open discrepancies in the approvals queue`,
  );
  await db.$client.end();
}

main().catch((err) => {
  console.error('[seed-demo] failed', err);
  process.exit(1);
});
