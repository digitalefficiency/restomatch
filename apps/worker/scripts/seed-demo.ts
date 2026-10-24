/**
 * Demo-flow generator: turns the static seed (restaurant + POs) into a fully
 * MATCHED dataset so the live dashboard shows real KPIs, a leaks page and a
 * calm, believable approvals queue — without Redis/OCR. It runs the REAL
 * matching engine + approvals engine + baselines job (the code the worker
 * uses), so every discrepancy and routing decision is authentic.
 *
 * The leak story is scripted, not random (≈2% of food spend, the North Star):
 *   - the butcher quietly crept entrecôte from the agreed ₪139 to ₪145, then ₪149/kg
 *   - the fish supplier bills salmon at ₪92, then ₪96, instead of the agreed ₪89
 *   - the draft-beer keg jumped 10% on the latest delivery
 *   - twice the produce supplier delivered 3 kg fewer cherry tomatoes but billed in full;
 *     the butcher once short-delivered 2 kg of chicken breast, billed in full
 *   - the bakery slipped six challahs onto an invoice nobody ordered
 *   - the dairy still computes VAT at the old 17%
 *   - one cheaper cucumber delivery (good news, auto-accepted)
 *   - two consolidated invoices (חשבוניות ריכוז) are parsed and PENDING — calm, not alarms
 * Discrepancies older than ten days are resolved (credit note received → "savings
 * captured"); recent ones are open in the approvals queue. Today's POs (from the
 * base seed) are left untouched so the receiver can check them live.
 *
 * Run: DATABASE_URL=... pnpm --filter @restomatch/worker exec tsx scripts/seed-demo.ts
 * Refuses any non-local database (it deletes the restaurant's receipts/invoices).
 */
import {
  buildRules,
  evaluateApproval,
  matchActivitySummary,
  resolveApprovalThresholds,
  type ApprovalContext,
} from '@restomatch/api';
import { computeBaselines, computeLeakHero } from '@restomatch/charts';
import {
  activityEvents,
  and,
  asc,
  assertSeedTarget,
  DEMO_MAIN_BUSINESS_ID,
  DEMO_MAIN_NAME,
  createDb,
  discrepancies,
  eq,
  goodsReceipts,
  grLines,
  inArray,
  invoiceLines,
  invoices,
  lt,
  matchRuns,
  memberships,
  poLines,
  priceBaselines,
  priceHistory,
  products,
  purchaseOrders,
  restaurants,
  sql,
  suppliers,
  users,
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
assertSeedTarget(url, 'seed-demo');
const db = createDb(url);

const DAY_MS = 24 * 60 * 60 * 1000;
const OPEN_WINDOW_DAYS = 10;
/** The base seed's HISTORY_WEEKS × 7 (packages/db/scripts/seed.ts). */
const BASE_HISTORY_DAYS = 56;
/** Marks the standing-order POs this script creates (delivery notes billed monthly). */
const STANDING_ORDER_NOTE = 'הזמנה קבועה — חלב וביצים · חיוב בחשבונית מרכזת';
/** Months of standing-order history before the current month (the supplier ledger). */
const STANDING_ORDER_MONTHS = 5;
/** Marks the one large event order (the VAT-at-risk demo invoice) this script creates. */
const EVENT_ORDER_NOTE = 'הזמנה מיוחדת — אירוע';

/** Start of "today" on the restaurant's wall clock (DEMO_TODAY overrides, like the base seed). */
function startOfLocalDay(tz: string): Date {
  const ymd =
    process.env.DEMO_TODAY?.trim() ||
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const guess = new Date(Date.UTC(y, m - 1, d));
  const local = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(guess);
  const p = Object.fromEntries(local.map((x) => [x.type, x.value]));
  const offset = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!) - guess.getTime();
  return new Date(guess.getTime() - offset);
}

/** What happens on the k-th most recent delivery (k = 1 is the latest) of a supplier. */
interface Scenario {
  /** product nameEn → billed unit price */
  price?: Record<string, number>;
  /** product nameEn → kg/units missing from the delivery (but billed in full) */
  shortBilledInFull?: Record<string, number>;
  /** a line on the invoice that was never ordered */
  extra?: { nameEn: string; qty: number; price: number };
  /** VAT rate the supplier used on the invoice (default: the restaurant's) */
  invoiceVatRate?: number;
}

function scenarioFor(supplierEn: string, k: number): Scenario {
  switch (supplierEn) {
    case 'HaKerem Butchery':
      // Creep: 139 → 145 → 149. The leaks page flags a latest price above the p90.
      if (k === 1) return { price: { 'Entrecôte (rib-eye)': 149 } };
      if (k === 2) return { price: { 'Entrecôte (rib-eye)': 145 }, shortBilledInFull: { 'Chicken breast': 2 } };
      // Last month (resolved): a lamb price slip and a short ground-beef delivery.
      if (k === 4) return { price: { 'Lamb shoulder': 96 } };
      if (k === 5) return { shortBilledInFull: { 'Ground beef': 2 } };
      if (k === 6) return { price: { 'Boneless chicken thighs': 49.9 } };
      if (k === 8) return { price: { 'Lamb shoulder': 96 } };
      return {};
    case 'Mediterranean Fish Co.':
      if (k === 1) return { price: { 'Salmon fillet': 96 } };
      if (k === 2) return { price: { 'Salmon fillet': 92 } };
      if (k === 4) return { price: { Calamari: 54 } };
      if (k === 5) return { price: { 'Red tuna': 159 } };
      if (k === 6) return { shortBilledInFull: { 'Whole sea bream': 1.5 } };
      return {};
    case 'Steinberg Beverages':
      if (k === 1) return { price: { 'Draft beer keg 30L': 575 } };
      if (k === 3) return { price: { 'Cabernet red wine': 52 } };
      if (k === 4) return { price: { 'Fresh orange juice': 16 }, shortBilledInFull: { 'Mineral water 1.5L (6-pack)': 2 } };
      if (k === 5) return { extra: { nameEn: 'Cola Zero 330ml (case of 24)', qty: 2, price: 62 } };
      return {};
    case 'Galilee Dairies':
      if (k === 2) return { invoiceVatRate: 0.17 };
      if (k === 4) return { price: { Mozzarella: 46 } };
      return {};
    case 'HaSharon Produce':
      if (k === 4 || k === 7 || k === 10 || k === 14 || k === 22) return { shortBilledInFull: { 'Cherry tomatoes': 3 } };
      if (k === 6) return { price: { Cucumbers: 5.6 } };
      if (k === 12) return { price: { 'Red bell peppers': 11.9 } };
      if (k === 16) return { shortBilledInFull: { Lemons: 2 } };
      return {};
    case "Brenner's Bakery":
      if (k === 5 || k === 12 || k === 22) return { extra: { nameEn: 'Challah', qty: 6, price: 12 } };
      if (k === 9) return { shortBilledInFull: { 'Sourdough loaf': 2 } };
      return {};
    case 'Fresman Spices & Oils':
      return k === 2 ? { price: { 'Extra virgin olive oil': 37.5 }, shortBilledInFull: { 'Raw tahini': 2 } } : {};
    case 'Ben-Ami Dry Goods':
      if (k === 2) return { shortBilledInFull: { 'Jasmine rice': 5 } };
      if (k === 3) return { price: { 'Dried chickpeas': 10.5 } };
      return {};
    case 'Quick Disposables':
      return k === 3 ? { extra: { nameEn: 'Take-away boxes (pack of 50)', qty: 4, price: 39 } } : {};
    default:
      return {};
  }
}

const INVOICE_PREFIX: Record<string, string> = {
  'HaSharon Produce': 'SH',
  'HaKerem Butchery': 'HK',
  "Brenner's Bakery": 'BR',
  'Mediterranean Fish Co.': 'MF',
  'Galilee Dairies': 'GD',
  'Fresman Spices & Oils': 'FS',
  'Steinberg Beverages': 'ST',
  'Ben-Ami Dry Goods': 'BA',
  'Quick Disposables': 'QD',
  'Amit Cleaning Supplies': 'AC',
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** A delivery note (תעודת משלוח): one goods receipt billed later on a consolidated invoice. */
interface DeliveryNote {
  grId: string;
  receivedAt: Date;
  rows: Array<{ productId: string; qty: number; expected: number; billed: number }>;
}

async function main() {
  // The base seed's demo restaurant, by its fixed business id — NEVER "the oldest
  // restaurant": on a shared database that is a real tenant whose invoices and
  // receipts this script deletes below.
  const [restaurant] = await db
    .select()
    .from(restaurants)
    .where(and(eq(restaurants.businessId, DEMO_MAIN_BUSINESS_ID), eq(restaurants.name, DEMO_MAIN_NAME)))
    .limit(1);
  if (!restaurant) throw new Error(`no demo restaurant (business id ${DEMO_MAIN_BUSINESS_ID}) — run the base seed first`);
  const restaurantId = restaurant.id;

  // Clean any prior demo-flow rows for this restaurant (idempotent re-run).
  const invIds = (await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.restaurantId, restaurantId))).map((r) => r.id);
  const grIds = (await db.select({ id: goodsReceipts.id }).from(goodsReceipts).where(eq(goodsReceipts.restaurantId, restaurantId))).map((r) => r.id);
  // Recovery claims hold money history and block discrepancy deletes (0048, NO ACTION):
  // a demo re-seed starts the ₪-back tracker over (seed-recovery-demo restages it).
  await db.execute(sql`
    DO $$ BEGIN
      IF to_regclass('public.recovery_claims') IS NOT NULL THEN
        DELETE FROM recovery_claims WHERE restaurant_id = '${sql.raw(restaurantId)}';
        DELETE FROM credit_notes WHERE restaurant_id = '${sql.raw(restaurantId)}';
      END IF;
    END $$`);
  await db.delete(discrepancies).where(eq(discrepancies.restaurantId, restaurantId));
  await db.delete(matchRuns).where(eq(matchRuns.restaurantId, restaurantId));
  if (invIds.length) await db.delete(invoiceLines).where(inArray(invoiceLines.invoiceId, invIds));
  await db.delete(priceHistory).where(eq(priceHistory.restaurantId, restaurantId));
  await db.delete(priceBaselines).where(eq(priceBaselines.restaurantId, restaurantId));
  await db.delete(invoices).where(eq(invoices.restaurantId, restaurantId));
  if (grIds.length) await db.delete(grLines).where(inArray(grLines.grId, grIds));
  await db.delete(goodsReceipts).where(eq(goodsReceipts.restaurantId, restaurantId));
  await db.delete(activityEvents).where(eq(activityEvents.restaurantId, restaurantId));
  // Standing-order and event POs are this script's own rows (po_lines cascade); drop them
  // before the delivered-PO query below so a re-run never counts them.
  await db
    .delete(purchaseOrders)
    .where(and(eq(purchaseOrders.restaurantId, restaurantId), inArray(purchaseOrders.notes, [STANDING_ORDER_NOTE, EVENT_ORDER_NOTE])));

  const tolerances = resolveTolerances(restaurant.settings?.tolerances);
  const rules = buildRules(resolveApprovalThresholds(restaurant.settings?.approvalThresholds));
  const vatRate = Number(restaurant.vatRate ?? '0.18');
  const todayStart = startOfLocalDay(restaurant.timezone ?? 'Asia/Jerusalem');
  const openSince = new Date(todayStart.getTime() - OPEN_WINDOW_DAYS * DAY_MS);

  const team = await db
    .select({ id: users.id, role: memberships.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.restaurantId, restaurantId));
  const userFor = (role: UserRole) => team.find((t) => t.role === role)?.id ?? team[0]?.id ?? null;
  const receiverId = userFor('receiver');
  const managerId = userFor('manager');

  const supplierRows = await db.select().from(suppliers).where(eq(suppliers.restaurantId, restaurantId));
  const supplierById = new Map(supplierRows.map((s) => [s.id, s] as const));
  const productRows = await db.select().from(products).where(eq(products.restaurantId, restaurantId));
  const productById = new Map(productRows.map((p) => [p.id, p] as const));
  const productByEn = new Map(productRows.map((p) => [p.nameEn ?? '', p] as const));

  // Delivered history only: POs expected before the start of today. Today's and
  // future POs stay open for the live receiving demo.
  const pos = await db
    .select()
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.restaurantId, restaurantId), lt(purchaseOrders.expectedDeliveryAt, todayStart)))
    .orderBy(asc(purchaseOrders.expectedDeliveryAt));

  // k = 1 for each supplier's most recent delivery.
  const recencyById = new Map<string, number>();
  const perSupplier = new Map<string, string[]>();
  for (const po of pos) perSupplier.set(po.supplierId, [...(perSupplier.get(po.supplierId) ?? []), po.id]);
  for (const ids of perSupplier.values()) ids.forEach((id, i) => recencyById.set(id, ids.length - i));

  // The base seed's 8-week window (HISTORY_WEEKS) vs the older full months before it.
  // Window POs keep their scripted story and invoice numbers exactly (the demo pack
  // quotes ST-24108 …); older ones replay the "last month" incidents (k ≥ 4) so
  // every month reads like a normal month (~2% leak), never the headline k 1–3.
  const windowStart = new Date(todayStart.getTime() - BASE_HISTORY_DAYS * DAY_MS);
  const windowCount = new Map<string, number>();
  const olderCount = new Map<string, number>();
  for (const po of pos) {
    const m = (po.expectedDeliveryAt ?? todayStart) >= windowStart ? windowCount : olderCount;
    m.set(po.supplierId, (m.get(po.supplierId) ?? 0) + 1);
  }
  const scenarioK = (supplierId: string, k: number) => {
    const w = windowCount.get(supplierId) ?? 0;
    return k <= w ? k : 4 + ((k - w - 1) % Math.max(w - 5, 1));
  };

  const knownBySupplier = new Map<string, Set<string>>();
  // Older invoices number downwards from 24100 so the window's numbers never move.
  const invoiceSeq = new Map<string, number>([...olderCount].map(([id, n]) => [id, 24100 - n] as const));
  let made = 0;
  let openCount = 0;
  // Deliveries billed later on ONE consolidated invoice (חשבונית ריכוז): this
  // week's bakery drops and the latest dairy delivery get a goods receipt but no
  // per-delivery invoice — exactly how a ריכוז works, so spend is not doubled.
  const isConsolidated = (supplierEn: string, k: number) =>
    (supplierEn === "Brenner's Bakery" && k <= 2) || (supplierEn === 'Galilee Dairies' && k === 1);
  const consolidatedBuckets = new Map<string, DeliveryNote[]>();

  for (const po of pos) {
    const supplier = supplierById.get(po.supplierId)!;
    const supplierEn = supplier.nameEn ?? supplier.name;
    const k = recencyById.get(po.id)!;
    const sc = scenarioFor(supplierEn, scenarioK(po.supplierId, k));
    // The rate the engine expects (buildMatchInput: PO → supplier → restaurant): fresh
    // produce suppliers are VAT 0, so their invoices carry no VAT.
    const supplierVat = supplier.vatRate != null ? Number(supplier.vatRate) : vatRate;
    const lines = await db.select().from(poLines).where(eq(poLines.poId, po.id)).orderBy(asc(poLines.id));
    if (lines.length === 0) continue;
    const expected = po.expectedDeliveryAt ?? new Date();
    const receivedAt = new Date(expected.getTime() + 20 * 60 * 1000);

    // ── goods receipt ──────────────────────────────────────────────────
    const [gr] = await db
      .insert(goodsReceipts)
      .values({ restaurantId, poId: po.id, receivedAt, receivedBy: receiverId, status: 'completed', createdAt: receivedAt, updatedAt: receivedAt })
      .returning();
    const grRows: Array<{ poLine: (typeof lines)[number]; grLineId: string; qtyReceived: number; qtyBilled: number; price: number }> = [];
    for (const l of lines) {
      const ordered = Number(l.qtyOrdered);
      const en = productById.get(l.productId ?? '')?.nameEn ?? '';
      const missing = sc.shortBilledInFull?.[en] ?? 0;
      const qtyReceived = Math.max(0, ordered - missing);
      const [grl] = await db
        .insert(grLines)
        .values({
          grId: gr!.id,
          poLineId: l.id,
          productId: l.productId,
          qtyReceived: qtyReceived.toString(),
          qtyRejected: '0',
          conditionNotes: missing > 0 ? `חסרים ${missing} ${l.unit} בקבלה` : null,
        })
        .returning();
      const price = sc.price?.[en] ?? Number(l.unitPriceExpected ?? 0);
      grRows.push({ poLine: l, grLineId: grl!.id, qtyReceived, qtyBilled: ordered, price });
    }

    if (isConsolidated(supplierEn, k)) {
      const rows = grRows
        .filter((g) => g.poLine.productId)
        .map((g) => ({ productId: g.poLine.productId!, qty: g.qtyReceived, expected: Number(g.poLine.unitPriceExpected ?? 0), billed: g.price }));
      consolidatedBuckets.set(supplier.id, [...(consolidatedBuckets.get(supplier.id) ?? []), { grId: gr!.id, receivedAt, rows }]);
      continue;
    }

    // ── invoice (billed for what was ORDERED — that is how short deliveries leak) ──
    const prefix = INVOICE_PREFIX[supplierEn] ?? 'IN';
    const seq = (invoiceSeq.get(supplier.id) ?? 24100) + 1;
    invoiceSeq.set(supplier.id, seq);
    const invNumber = `${prefix}-${seq}`;
    const invLineInputs: InvoiceLineInput[] = [];
    const invLineValues: Array<typeof invoiceLines.$inferInsert> = [];
    const addLine = (productId: string | null, he: string, en: string | null, qty: number, unit: string, price: number) => {
      const id = crypto.randomUUID();
      const lineTotal = r2(qty * price);
      invLineInputs.push({ id, productId, qtyBilled: qty, unit, unitPriceBilled: price, lineTotal });
      invLineValues.push({
        id,
        invoiceId: '', // filled below
        productId,
        rawDescription: he,
        rawDescriptionEn: en,
        qtyBilled: qty.toString(),
        unit,
        unitPriceBilled: price.toFixed(2),
        lineTotal: lineTotal.toFixed(2),
        vatRate: (sc.invoiceVatRate ?? supplierVat).toString(),
      });
    };
    for (const g of grRows) {
      const p = productById.get(g.poLine.productId ?? '');
      addLine(g.poLine.productId, g.poLine.rawDescription ?? p?.canonicalName ?? '', g.poLine.rawDescriptionEn ?? p?.nameEn ?? null, g.qtyBilled, g.poLine.unit, g.price);
    }
    if (sc.extra) {
      const p = productByEn.get(sc.extra.nameEn);
      addLine(p?.id ?? null, p?.canonicalName ?? sc.extra.nameEn, sc.extra.nameEn, sc.extra.qty, p?.defaultUnit ?? 'יח׳', sc.extra.price);
    }
    const subtotal = r2(invLineInputs.reduce((a, l) => a + Math.round(l.lineTotal * 100), 0) / 100);
    const vatAmount = r2(subtotal * (sc.invoiceVatRate ?? supplierVat));
    const totalInclVat = r2(subtotal + vatAmount);

    const [invoice] = await db
      .insert(invoices)
      .values({
        restaurantId,
        supplierId: supplier.id,
        invoiceNumber: invNumber,
        invoiceDate: receivedAt,
        dueDate: new Date(receivedAt.getTime() + 30 * DAY_MS),
        totalExclVat: subtotal.toFixed(2),
        vatAmount: vatAmount.toFixed(2),
        totalInclVat: totalInclVat.toFixed(2),
        status: 'matched',
        source: 'photo',
        ocrConfidence: '0.970',
        createdBy: receiverId,
        createdAt: receivedAt,
        updatedAt: receivedAt,
      })
      .returning();
    await db.insert(invoiceLines).values(invLineValues.map((v) => ({ ...v, invoiceId: invoice!.id })));

    for (const v of invLineValues) {
      if (!v.productId) continue;
      await db.insert(priceHistory).values({
        restaurantId,
        productId: v.productId,
        supplierId: supplier.id,
        observedAt: receivedAt,
        unitPrice: v.unitPriceBilled,
        qty: v.qtyBilled,
        sourceInvoiceId: invoice!.id,
      });
    }

    // ── the REAL engine ────────────────────────────────────────────────
    const known = knownBySupplier.get(supplier.id) ?? new Set<string>();
    const input: MatchInput = {
      invoice: { invoiceNumber: invNumber, invoiceDate: receivedAt, supplierId: supplier.id, totalExclVat: subtotal, vatAmount, totalInclVat },
      poLines: lines.map((l) => ({
        id: l.id,
        productId: l.productId,
        qtyOrdered: Number(l.qtyOrdered),
        unit: l.unit,
        unitPriceExpected: l.unitPriceExpected ? Number(l.unitPriceExpected) : null,
      })),
      grLines: grRows.map((g) => ({ id: g.grLineId, poLineId: g.poLine.id, productId: g.poLine.productId, qtyReceived: g.qtyReceived })),
      invoiceLines: invLineInputs,
      vatRate: supplierVat,
      tolerances,
      // A COPY: the engine must see only the numbers known BEFORE this invoice.
      // (The old generator added the number to the same Set before runMatch, so
      // every invoice flagged itself as DUPLICATE_INVOICE — 100% "leak".)
      knownInvoiceNumbers: new Set(known),
      expectedDeliveryDate: po.expectedDeliveryAt ?? undefined,
    };
    const result = runMatch(input);
    known.add(invNumber);
    knownBySupplier.set(supplier.id, known);

    const recent = receivedAt >= openSince;
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

    let invoiceHasOpenBlock = false;
    const feedFindings: Parameters<typeof matchActivitySummary>[0] = [];
    for (const d of result.discrepancies) {
      const ctx: ApprovalContext = {
        discrepancy: { type: d.type, severity: d.severity, deltaAmount: d.deltaAmount },
        matchRun: { totalDiscrepancyAmount: result.totalDiscrepancyAmount, totalInvoiceAmount: totalInclVat, poExists: true },
      };
      const decision = evaluateApproval(ctx, rules);
      const auto = decision.action === 'auto_approve';
      const status = auto ? 'accepted' : recent ? 'open' : 'resolved';
      feedFindings.push({ type: d.type, severity: d.severity, deltaAmount: d.deltaAmount, resolutionStatus: status });
      if (status === 'open') {
        openCount += 1;
        if (d.severity === 'block') invoiceHasOpenBlock = true;
      }
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
        resolvedBy: status === 'resolved' ? managerId : null,
        resolvedAt: status === 'resolved' ? new Date(receivedAt.getTime() + 2 * DAY_MS) : null,
        resolutionNote: status === 'resolved' ? 'זיכוי התקבל מהספק' : null,
        createdAt: receivedAt,
      });
    }

    const finalStatus = invoiceHasOpenBlock ? 'disputed' : recent ? 'matched' : 'paid';
    if (finalStatus !== 'matched') {
      await db.update(invoices).set({ status: finalStatus, updatedAt: receivedAt }).where(eq(invoices.id, invoice!.id));
    }

    const issues = result.discrepancies.filter((d) => d.severity !== 'info').length;
    // The same feed story as the real match writer (the hero's leak rule).
    const feed = matchActivitySummary(feedFindings, totalInclVat, { poMatched: true });
    await db.insert(activityEvents).values([
      {
        restaurantId,
        eventType: 'invoice_received',
        title: `חשבונית ${invNumber} התקבלה`,
        detail: `${supplier.name} · ₪${Math.round(totalInclVat).toLocaleString('he-IL')} כולל מע״מ`,
        entityType: 'invoice',
        entityId: invoice!.id,
        actorId: receiverId,
        // Same structured shape as the real writers, so the feed renders in any locale.
        metadata: {
          invoiceId: invoice!.id,
          invoiceNumber: invNumber,
          supplierName: supplier.name,
          supplierNameEn: supplier.nameEn ?? null,
          totalInclVatIls: totalInclVat,
        },
        createdAt: receivedAt,
      },
      {
        restaurantId,
        eventType: 'invoice_matched',
        title: `חשבונית ${invNumber} הותאמה`,
        detail: `${supplier.name} · ${feed.detail}`,
        entityType: 'match_run',
        entityId: matchRun!.id,
        metadata: {
          invoiceId: invoice!.id,
          invoiceNumber: invNumber,
          supplierName: supplier.name,
          supplierNameEn: supplier.nameEn ?? null,
          discrepancyCount: issues,
          potentialLossIls: issues ? result.totalDiscrepancyAmount : 0,
          leakCount: feed.leakCount,
          leakIls: feed.leakIls,
          pendingLink: feed.pendingLink,
          poMatched: feed.poMatched,
          reviewCount: feed.reviewCount,
          status: result.status,
        },
        createdAt: new Date(receivedAt.getTime() + 60 * 1000),
      },
    ]);
    made += 1;
  }

  // ── consolidated invoices (חשבוניות ריכוז / מרכזת): parsed, PENDING, deliberately calm ──
  // Each one lists the delivery notes (תעודות משלוח = goods receipts, `ת.מ. <n>` in
  // goods_receipts.notes) it bills, one line per note × product, plus
  // ocr_payload.raw.deliveryNotes — the covered set the consolidated cross-match reads.
  // None gets a match run, so all stay pendingLink: in neither leak nor spend.
  const tz = restaurant.timezone ?? 'Asia/Jerusalem';
  const consolidatedVatOf = (s: typeof supplierRows[number]) => (s.vatRate != null ? Number(s.vatRate) : vatRate);
  const ilDate = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: tz });
  async function insertConsolidated(opts: {
    supplier: (typeof supplierRows)[number];
    number: string;
    at: Date;
    status: 'parsed' | 'paid';
    periodStart: string;
    periodEnd: string;
    notes: Array<DeliveryNote & { dn: string }>;
    detail: string;
  }) {
    const vat = consolidatedVatOf(opts.supplier);
    const lines = opts.notes.flatMap((n) =>
      n.rows.map((r) => {
        const p = productById.get(r.productId)!;
        return { n, r, p, lineTotal: r2(r.qty * r.billed) };
      }),
    );
    const subtotal = r2(lines.reduce((a, l) => a + Math.round(l.lineTotal * 100), 0) / 100);
    const vatAmount = r2(subtotal * vat);
    const [inv] = await db
      .insert(invoices)
      .values({
        restaurantId,
        supplierId: opts.supplier.id,
        invoiceNumber: opts.number,
        invoiceDate: opts.at,
        dueDate: new Date(opts.at.getTime() + 30 * DAY_MS),
        totalExclVat: subtotal.toFixed(2),
        vatAmount: vatAmount.toFixed(2),
        totalInclVat: r2(subtotal + vatAmount).toFixed(2),
        status: opts.status,
        source: 'email',
        ocrConfidence: '0.940',
        ocrPayload: {
          provider: 'reconciled',
          raw: {
            kind: 'consolidated',
            periodStart: opts.periodStart,
            periodEnd: opts.periodEnd,
            deliveryNotes: opts.notes.map((n) => ({
              number: n.dn,
              date: ilDate(n.receivedAt),
              totalExclVat: r2(n.rows.reduce((a, r) => a + r2(r.qty * r.billed), 0)).toFixed(2),
            })),
          },
        },
        createdAt: opts.at,
        updatedAt: opts.at,
      })
      .returning();
    await db.insert(invoiceLines).values(
      lines.map((l) => ({
        invoiceId: inv!.id,
        productId: l.p.id,
        rawDescription: `ת.מ. ${l.n.dn} · ${l.p.canonicalName}`,
        rawDescriptionEn: `DN ${l.n.dn} · ${l.p.nameEn}`,
        qtyBilled: l.r.qty.toString(),
        unit: l.p.defaultUnit ?? 'יח׳',
        unitPriceBilled: l.r.billed.toFixed(2),
        lineTotal: l.lineTotal.toFixed(2),
        vatRate: vat.toString(),
      })),
    );
    if (opts.status === 'parsed') {
      await db.insert(activityEvents).values({
        restaurantId,
        eventType: 'invoice_received',
        title: `חשבונית ריכוז ${inv!.invoiceNumber} התקבלה`,
        detail: `${opts.supplier.name} · ${opts.detail}`,
        entityType: 'invoice',
        entityId: inv!.id,
        metadata: {
          consolidated: true,
          invoiceId: inv!.id,
          invoiceNumber: inv!.invoiceNumber,
          supplierName: opts.supplier.name,
          supplierNameEn: opts.supplier.nameEn ?? null,
          totalInclVatIls: r2(subtotal + vatAmount),
          deliveryNotes: opts.notes.length,
        },
        createdAt: opts.at,
      });
    }
    return { id: inv!.id, subtotal };
  }
  const numberNotes = async (notes: DeliveryNote[], first: number) => {
    const sorted = [...notes].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
    const out: Array<DeliveryNote & { dn: string }> = [];
    for (const [i, n] of sorted.entries()) {
      const dn = String(first + i);
      await db.update(goodsReceipts).set({ notes: `ת.מ. ${dn}` }).where(eq(goodsReceipts.id, n.grId));
      out.push({ ...n, dn });
    }
    return out;
  };

  // Galilee Dairies' standing order: milk + eggs every Sunday and Thursday, each drop
  // a delivery note (its own PO + goods receipt, no invoice of its own), billed once a
  // month on a חשבונית מרכזת GD-M-<YYYYMM>. Earlier months are invoiced on the
  // month's last day and paid; LAST month's arrived on the 1st of this month and is
  // pending (it carries the one deliberate overcharge below); this month's notes wait
  // for the month-end invoice. Created after the delivered-PO loop so no recency /
  // scenario above moves; no GD-M invoice is dated inside last month, so last month's
  // figures do not move either.
  const STANDING_OVERCHARGE = { product: 'Milk 3%', qty: 24, billed: 7.9 };
  const standingNotes: DeliveryNote[] = [];
  const galilee = supplierRows.find((s) => s.nameEn === 'Galilee Dairies');
  const milk = productByEn.get('Milk 3%');
  const eggs = productByEn.get('Eggs L (tray of 30)');
  let consolidatedCount = 0;
  if (galilee && milk && eggs) {
    const lastPrice = async (productId: string, fallback: number) => {
      const [row] = await db
        .select({ p: poLines.unitPriceExpected })
        .from(poLines)
        .innerJoin(purchaseOrders, eq(purchaseOrders.id, poLines.poId))
        .where(and(eq(purchaseOrders.restaurantId, restaurantId), eq(poLines.productId, productId)))
        .limit(1);
      return row?.p != null ? Number(row.p) : fallback;
    };
    const milkPrice = await lastPrice(milk.id, 6.4);
    const eggsPrice = await lastPrice(eggs.id, 34);
    const [cy, cm] = ilDate(todayStart).split('-').map(Number) as [number, number];
    const until = todayStart.getTime() - 2 * DAY_MS;
    let drop = 0;
    for (let off = -STANDING_ORDER_MONTHS; off <= 0; off++) {
      const first = new Date(Date.UTC(cy, cm - 1 + off, 1, 12));
      for (let d = first; d.getUTCMonth() === first.getUTCMonth() && d.getTime() < until; d = new Date(d.getTime() + DAY_MS)) {
        if (d.getUTCDay() !== 0 && d.getUTCDay() !== 4) continue;
        const deliveredAt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 4, 30));
        const qtyMilk = [24, 30, 18, 24, 30, 24][drop % 6]!;
        const qtyEggs = drop % 2 ? 3 : 2;
        drop += 1;
        const orderedAt = new Date(deliveredAt.getTime() - DAY_MS);
        const [po] = await db
          .insert(purchaseOrders)
          .values({
            restaurantId,
            supplierId: galilee.id,
            expectedDeliveryAt: deliveredAt,
            status: 'closed',
            source: 'recurring',
            totalEstimated: r2(qtyMilk * milkPrice + qtyEggs * eggsPrice).toFixed(2),
            createdBy: managerId,
            notes: STANDING_ORDER_NOTE,
            sentAt: orderedAt,
            createdAt: orderedAt,
            updatedAt: deliveredAt,
          })
          .returning();
        const lines = await db
          .insert(poLines)
          .values([
            { poId: po!.id, productId: milk.id, rawDescription: milk.canonicalName, rawDescriptionEn: milk.nameEn, qtyOrdered: String(qtyMilk), unit: milk.defaultUnit ?? 'ליטר', unitPriceExpected: milkPrice.toFixed(4) },
            { poId: po!.id, productId: eggs.id, rawDescription: eggs.canonicalName, rawDescriptionEn: eggs.nameEn, qtyOrdered: String(qtyEggs), unit: eggs.defaultUnit ?? 'תבנית', unitPriceExpected: eggsPrice.toFixed(4) },
          ])
          .returning();
        const receivedAt = new Date(deliveredAt.getTime() + 20 * 60 * 1000);
        const [gr] = await db
          .insert(goodsReceipts)
          .values({ restaurantId, poId: po!.id, receivedAt, receivedBy: receiverId, status: 'completed', createdAt: receivedAt, updatedAt: receivedAt })
          .returning();
        await db.insert(grLines).values(
          lines.map((l) => ({ grId: gr!.id, poLineId: l.id, productId: l.productId, qtyReceived: l.qtyOrdered, qtyRejected: '0' })),
        );
        standingNotes.push({
          grId: gr!.id,
          receivedAt,
          rows: [
            { productId: milk.id, qty: qtyMilk, expected: milkPrice, billed: milkPrice },
            { productId: eggs.id, qty: qtyEggs, expected: eggsPrice, billed: eggsPrice },
          ],
        });
      }
    }
    // The supplier's own delivery-note numbers run across both kinds of drop.
    const numbered = await numberNotes([...standingNotes, ...(consolidatedBuckets.get(galilee.id) ?? [])], 61001);
    const standingIds = new Set(standingNotes.map((n) => n.grId));
    const byMonth = new Map<string, Array<DeliveryNote & { dn: string }>>();
    for (const n of numbered.filter((x) => standingIds.has(x.grId))) {
      const key = ilDate(n.receivedAt).slice(0, 7);
      byMonth.set(key, [...(byMonth.get(key) ?? []), n]);
    }
    const lastMonthKey = ilDate(new Date(Date.UTC(cy, cm - 2, 15))).slice(0, 7);
    for (const [key, notes] of [...byMonth].sort()) {
      const [y, m] = key.split('-').map(Number) as [number, number];
      if (y === cy && m === cm) continue; // this month: invoice expected at month end
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const period = { periodStart: `${key}-01`, periodEnd: `${key}-${String(lastDay).padStart(2, '0')}` };
      if (key === lastMonthKey) {
        // The one deliberate discrepancy: on one note, milk billed above its PO price.
        const target = notes.find((n) => n.rows[0]!.qty === STANDING_OVERCHARGE.qty) ?? notes[0]!;
        target.rows[0]!.billed = STANDING_OVERCHARGE.billed;
        await insertConsolidated({
          supplier: galilee,
          number: `GD-M-${key.replace('-', '')}`,
          at: new Date(Date.UTC(cy, cm - 1, 1, 8)),
          status: 'parsed',
          ...period,
          notes,
          detail: `${notes.length} תעודות משלוח · ממתינה להתאמה מול התעודות`,
        });
        consolidatedCount += 1;
        console.log(
          `[seed-demo] standing order: GD-M-${key.replace('-', '')} covers ${notes.length} delivery notes · overcharge on ת.מ. ${target.dn}: ${STANDING_OVERCHARGE.product} ${STANDING_OVERCHARGE.qty} × (₪${STANDING_OVERCHARGE.billed.toFixed(2)} − ₪${target.rows[0]!.expected.toFixed(2)}) = ₪${r2(STANDING_OVERCHARGE.qty * (STANDING_OVERCHARGE.billed - target.rows[0]!.expected)).toFixed(2)} excl. VAT`,
        );
      } else {
        await insertConsolidated({
          supplier: galilee,
          number: `GD-M-${key.replace('-', '')}`,
          at: new Date(Date.UTC(y, m - 1, lastDay, 10)),
          status: 'paid',
          ...period,
          notes,
          detail: `${notes.length} תעודות משלוח`,
        });
      }
    }
    const thisMonth = numbered.filter((n) => ilDate(n.receivedAt).slice(0, 7) === `${cy}-${String(cm).padStart(2, '0')}`).length;
    console.log(`[seed-demo] standing order: ${standingNotes.length} delivery notes · this month ${thisMonth} not yet invoiced (invoice expected at month end)`);
  }

  // ── the VAT-at-risk case: one large invoice without an allocation number ──
  // From 2026 an invoice above ₪5,000 excl. VAT needs a Tax Authority allocation
  // number (מספר הקצאה) or its input VAT cannot be deducted. One event order from
  // the fish supplier, 27 days ago (last month, so this month's figures do not move),
  // delivered and billed exactly as ordered: the engine matches it clean, and its
  // ₪1,123.20 VAT is the only VAT at risk in the demo.
  const fish = supplierRows.find((s) => s.nameEn === 'Mediterranean Fish Co.');
  // Agreed event prices (the catalog's list prices): 20·89 + 25·62 + 15·145 + 15·49 = ₪6,240.
  const eventItems = (
    [
      ['Salmon fillet', 20, 89],
      ['Whole sea bream', 25, 62],
      ['Red tuna', 15, 145],
      ['Calamari', 15, 49],
    ] as const
  ).map(([en, qty, price]) => ({ p: productByEn.get(en), qty, price }));
  if (fish && eventItems.every((i) => i.p)) {
    const vat = fish.vatRate != null ? Number(fish.vatRate) : vatRate;
    const deliveredAt = new Date(todayStart.getTime() - 27 * DAY_MS + 10 * 60 * 60 * 1000);
    const orderedAt = new Date(deliveredAt.getTime() - 3 * DAY_MS);
    const priced = eventItems;
    const subtotal = r2(priced.reduce((a, i) => a + Math.round(i.qty * i.price * 100), 0) / 100);
    const vatAmount = r2(subtotal * vat);
    const [po] = await db
      .insert(purchaseOrders)
      .values({
        restaurantId,
        supplierId: fish.id,
        expectedDeliveryAt: deliveredAt,
        status: 'closed',
        source: 'manual',
        totalEstimated: subtotal.toFixed(2),
        createdBy: managerId,
        notes: EVENT_ORDER_NOTE,
        sentAt: orderedAt,
        createdAt: orderedAt,
        updatedAt: deliveredAt,
      })
      .returning();
    const lines = await db
      .insert(poLines)
      .values(
        priced.map((i) => ({
          poId: po!.id,
          productId: i.p!.id,
          rawDescription: i.p!.canonicalName,
          rawDescriptionEn: i.p!.nameEn,
          qtyOrdered: String(i.qty),
          unit: i.p!.defaultUnit ?? 'ק״ג',
          unitPriceExpected: i.price.toFixed(4),
        })),
      )
      .returning();
    const receivedAt = new Date(deliveredAt.getTime() + 20 * 60 * 1000);
    const [gr] = await db
      .insert(goodsReceipts)
      .values({ restaurantId, poId: po!.id, receivedAt, receivedBy: receiverId, status: 'completed', createdAt: receivedAt, updatedAt: receivedAt })
      .returning();
    const grRowsEvent = await db
      .insert(grLines)
      .values(lines.map((l) => ({ grId: gr!.id, poLineId: l.id, productId: l.productId, qtyReceived: l.qtyOrdered, qtyRejected: '0' })))
      .returning();
    const invNumber = 'MF-24950';
    const invLines = lines.map((l) => ({
      id: crypto.randomUUID(),
      productId: l.productId,
      qtyBilled: Number(l.qtyOrdered),
      unit: l.unit,
      unitPriceBilled: Number(l.unitPriceExpected),
      lineTotal: r2(Number(l.qtyOrdered) * Number(l.unitPriceExpected)),
    }));
    const [invoice] = await db
      .insert(invoices)
      .values({
        restaurantId,
        supplierId: fish.id,
        invoiceNumber: invNumber,
        invoiceDate: receivedAt,
        dueDate: new Date(receivedAt.getTime() + 30 * DAY_MS),
        totalExclVat: subtotal.toFixed(2),
        vatAmount: vatAmount.toFixed(2),
        totalInclVat: r2(subtotal + vatAmount).toFixed(2),
        allocationNumber: null,
        status: 'matched',
        source: 'email',
        ocrConfidence: '0.970',
        createdAt: receivedAt,
        updatedAt: receivedAt,
      })
      .returning();
    await db.insert(invoiceLines).values(
      invLines.map((l, i) => ({
        id: l.id,
        invoiceId: invoice!.id,
        productId: l.productId,
        rawDescription: lines[i]!.rawDescription ?? '',
        rawDescriptionEn: lines[i]!.rawDescriptionEn,
        qtyBilled: l.qtyBilled.toString(),
        unit: l.unit,
        unitPriceBilled: l.unitPriceBilled.toFixed(2),
        lineTotal: l.lineTotal.toFixed(2),
        vatRate: vat.toString(),
      })),
    );
    const result = runMatch({
      invoice: { invoiceNumber: invNumber, invoiceDate: receivedAt, supplierId: fish.id, totalExclVat: subtotal, vatAmount, totalInclVat: r2(subtotal + vatAmount) },
      poLines: lines.map((l) => ({ id: l.id, productId: l.productId, qtyOrdered: Number(l.qtyOrdered), unit: l.unit, unitPriceExpected: Number(l.unitPriceExpected) })),
      grLines: grRowsEvent.map((g) => ({ id: g.id, poLineId: g.poLineId, productId: g.productId, qtyReceived: Number(g.qtyReceived) })),
      invoiceLines: invLines,
      vatRate: vat,
      tolerances,
      knownInvoiceNumbers: new Set(knownBySupplier.get(fish.id) ?? []),
      expectedDeliveryDate: deliveredAt,
    });
    if (result.discrepancies.length > 0) {
      throw new Error(`event invoice ${invNumber} must match clean, got ${result.discrepancies.map((d) => d.type).join(', ')}`);
    }
    await db.insert(matchRuns).values({
      restaurantId,
      poId: po!.id,
      grId: gr!.id,
      invoiceId: invoice!.id,
      runAt: receivedAt,
      overallStatus: result.status,
      totalDiscrepancyAmount: result.totalDiscrepancyAmount.toFixed(2),
    });
    console.log(`[seed-demo] VAT at risk: ${invNumber} ₪${subtotal.toFixed(2)} + VAT ₪${vatAmount.toFixed(2)} on ${ilDate(receivedAt)}, no allocation number, matched ${result.status}`);
  }

  // The bakery's weekly ריכוז: this week's drops, one consolidated invoice.
  for (const [supplierId, bucket] of consolidatedBuckets) {
    if (supplierId === galilee?.id) continue; // billed on the monthly GD-M invoice
    const supplier = supplierById.get(supplierId)!;
    const prefix = INVOICE_PREFIX[supplier.nameEn ?? ''] ?? 'IN';
    const notes = await numberNotes(bucket, 8801);
    const at = new Date(todayStart.getTime() - 16 * 60 * 60 * 1000);
    await insertConsolidated({
      supplier,
      number: `${prefix}-R-${(invoiceSeq.get(supplierId) ?? 24100) + 1}`,
      at,
      status: 'parsed',
      periodStart: ilDate(notes[0]!.receivedAt),
      periodEnd: ilDate(notes[notes.length - 1]!.receivedAt),
      notes,
      detail: 'ממתינה להתאמה מול תעודות המשלוח של השבוע',
    });
    consolidatedCount += 1;
  }

  // Price baselines (the worker's baselines job) so the leaks page has its p50/p90.
  const baselines = await computeBaselines(db, restaurantId, { windowDays: 90 });

  // Report exactly what the dashboard hero will show (packages/charts leak-hero).
  const hero = await computeLeakHero(db, restaurantId);
  console.log(
    `[seed-demo] matched ${made} invoices · ${openCount} open in the approvals queue · ${consolidatedCount} consolidated invoices pending · ${baselines.length} baselines`,
  );
  console.log(
    `[seed-demo] dashboard hero (this month): leak ₪${hero.leakIls.toFixed(0)} of ₪${hero.spendIls.toFixed(0)} spend (${((hero.leakPct ?? 0) * 100).toFixed(1)}%) · caught before payment ₪${hero.caughtBeforePaymentIls.toFixed(0)} · recovered ₪${hero.recoveredIls.toFixed(0)} · ${hero.invoicesWithLeak}/${hero.invoiceCount} invoices with a leak`,
  );
  await db.$client.end();
}

main().catch((err) => {
  console.error('[seed-demo] failed', err);
  process.exit(1);
});
