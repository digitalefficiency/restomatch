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
  await db.delete(discrepancies).where(eq(discrepancies.restaurantId, restaurantId));
  await db.delete(matchRuns).where(eq(matchRuns.restaurantId, restaurantId));
  if (invIds.length) await db.delete(invoiceLines).where(inArray(invoiceLines.invoiceId, invIds));
  await db.delete(priceHistory).where(eq(priceHistory.restaurantId, restaurantId));
  await db.delete(priceBaselines).where(eq(priceBaselines.restaurantId, restaurantId));
  await db.delete(invoices).where(eq(invoices.restaurantId, restaurantId));
  if (grIds.length) await db.delete(grLines).where(inArray(grLines.grId, grIds));
  await db.delete(goodsReceipts).where(eq(goodsReceipts.restaurantId, restaurantId));
  await db.delete(activityEvents).where(eq(activityEvents.restaurantId, restaurantId));

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
  const consolidatedBuckets = new Map<string, Map<string, { qty: number; price: number }>>();

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
      const bucket = consolidatedBuckets.get(supplier.id) ?? new Map<string, { qty: number; price: number }>();
      for (const g of grRows) {
        if (!g.poLine.productId) continue;
        const cur = bucket.get(g.poLine.productId) ?? { qty: 0, price: g.price };
        cur.qty += g.qtyReceived;
        bucket.set(g.poLine.productId, cur);
      }
      consolidatedBuckets.set(supplier.id, bucket);
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
    for (const d of result.discrepancies) {
      const ctx: ApprovalContext = {
        discrepancy: { type: d.type, severity: d.severity, deltaAmount: d.deltaAmount },
        matchRun: { totalDiscrepancyAmount: result.totalDiscrepancyAmount, totalInvoiceAmount: totalInclVat, poExists: true },
      };
      const decision = evaluateApproval(ctx, rules);
      const auto = decision.action === 'auto_approve';
      const status = auto ? 'accepted' : recent ? 'open' : 'resolved';
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
    await db.insert(activityEvents).values([
      {
        restaurantId,
        eventType: 'invoice_received',
        title: `חשבונית ${invNumber} התקבלה`,
        detail: `${supplier.name} · ₪${totalInclVat.toFixed(0)} כולל מע״מ`,
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
        detail: issues
          ? `${supplier.name} · ${issues} חריגות · ₪${result.totalDiscrepancyAmount.toFixed(0)} בבדיקה`
          : `${supplier.name} · תואמת להזמנה ולקבלה`,
        entityType: 'match_run',
        entityId: matchRun!.id,
        metadata: {
          invoiceId: invoice!.id,
          invoiceNumber: invNumber,
          supplierName: supplier.name,
          supplierNameEn: supplier.nameEn ?? null,
          discrepancyCount: issues,
          potentialLossIls: issues ? result.totalDiscrepancyAmount : 0,
          status: result.status,
        },
        createdAt: new Date(receivedAt.getTime() + 60 * 1000),
      },
    ]);
    made += 1;
  }

  // ── consolidated invoices (חשבוניות ריכוז): parsed, PENDING, deliberately calm ──
  let consolidatedCount = 0;
  for (const [supplierId, bucket] of consolidatedBuckets) {
    const supplier = supplierById.get(supplierId)!;
    const prefix = INVOICE_PREFIX[supplier.nameEn ?? ''] ?? 'IN';
    const items = [...bucket].map(([productId, v]) => ({ p: productById.get(productId)!, ...v }));
    const subtotal = r2(items.reduce((a, l) => a + Math.round(l.qty * l.price * 100), 0) / 100);
    const consolidatedVat = supplier.vatRate != null ? Number(supplier.vatRate) : vatRate;
    const vatAmount = r2(subtotal * consolidatedVat);
    const at = new Date(todayStart.getTime() - 16 * 60 * 60 * 1000);
    const [inv] = await db
      .insert(invoices)
      .values({
        restaurantId,
        supplierId,
        invoiceNumber: `${prefix}-R-${(invoiceSeq.get(supplierId) ?? 24100) + 1}`,
        invoiceDate: at,
        dueDate: new Date(at.getTime() + 30 * DAY_MS),
        totalExclVat: subtotal.toFixed(2),
        vatAmount: vatAmount.toFixed(2),
        totalInclVat: r2(subtotal + vatAmount).toFixed(2),
        status: 'parsed',
        source: 'email',
        ocrConfidence: '0.940',
        createdAt: at,
        updatedAt: at,
      })
      .returning();
    await db.insert(invoiceLines).values(
      items.map((l) => ({
        invoiceId: inv!.id,
        productId: l.p.id,
        rawDescription: `ריכוז תעודות משלוח — ${l.p.canonicalName}`,
        rawDescriptionEn: `Consolidated delivery notes — ${l.p.nameEn}`,
        qtyBilled: l.qty.toString(),
        unit: l.p.defaultUnit ?? 'יח׳',
        unitPriceBilled: l.price.toFixed(2),
        lineTotal: r2(l.qty * l.price).toFixed(2),
        vatRate: consolidatedVat.toString(),
      })),
    );
    await db.insert(activityEvents).values({
      restaurantId,
      eventType: 'invoice_received',
      title: `חשבונית ריכוז ${inv!.invoiceNumber} התקבלה`,
      detail: `${supplier.name} · ממתינה להתאמה מול תעודות המשלוח של השבוע`,
      entityType: 'invoice',
      entityId: inv!.id,
      metadata: {
        consolidated: true,
        invoiceId: inv!.id,
        invoiceNumber: inv!.invoiceNumber,
        supplierName: supplier.name,
        supplierNameEn: supplier.nameEn ?? null,
        totalInclVatIls: r2(subtotal + vatAmount),
      },
      createdAt: at,
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
