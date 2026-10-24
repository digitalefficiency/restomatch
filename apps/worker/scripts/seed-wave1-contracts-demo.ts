/**
 * Wave-1 demo data for `contracts` + `priceAlerts` (S11). ADDITIVE and
 * IDEMPOTENT — run after seed-demo.ts, any number of times:
 *
 *   DATABASE_URL=postgres://…/restomatch_dev pnpm --filter @restomatch/worker exec tsx scripts/seed-wave1-contracts-demo.ts
 *
 * What it adds to the demo restaurant (כפר הזיתים):
 *  1. Contract price lists for 2 suppliers (HaKerem Butchery, Mediterranean
 *     Fish Co.): the price list that took effect on 2026-10-10, one row per
 *     product at the PO price of the invoices it covers (see seedContracts for
 *     the hero-number guarantee). The existing PRICE_HIGHER lines above the
 *     contract (entrecôte ₪149 vs ₪139, salmon ₪96 vs ₪89) light up as
 *     "over contract" (asserted ≥ 2).
 *  2. A price trend: product "עגבניות" (tomatoes) at HaSharon Produce rising
 *     from ₪6.20 to ₪7.30–7.34 over the last 3 weeks (+18%), and a cheaper offer for the
 *     same product (₪6.40) at a new supplier "חקלאי העמק"; then runs the
 *     price-alert sweep (in-app only; pass --notify to also queue outbox emails).
 *  3. Prints the leak total before/after and FAILS if it moved.
 *
 * Never touches seed.ts data except by INSERTing new rows; no matching re-run is
 * persisted (the verification is in-memory).
 */
import {
  assertSeedTarget,
  and,
  createDb,
  desc,
  discrepancies,
  eq,
  invoices,
  matchRuns,
  asc,
  poLines,
  priceAlerts,
  purchaseOrders,
  priceHistory,
  products,
  restaurants,
  sql,
  supplierCatalogItems,
  supplierConfirmLinks,
  supplierResponses,
  supplierContractPrices,
  suppliers,
} from '@restomatch/db';
import {
  createSupplierLink,
  findOverContractLines,
  resolveSupplierToken,
  runPriceAlertSweep,
  submitSupplierAnswer,
  supplierLinkUrl,
} from '@restomatch/api';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
assertSeedTarget(url, 'seed-wave1-contracts-demo');
const db = createDb(url);
const NOTIFY = process.argv.includes('--notify');

const CONTRACT_FROM = '2026-10-10';
const CONTRACT_SUPPLIERS = ['HaKerem Butchery', 'Mediterranean Fish Co.'];
const TREND_SUPPLIER = 'HaSharon Produce';
const CHEAP_SUPPLIER = { name: 'חקלאי העמק', nameEn: 'HaEmek Farmers' };
const TOMATO = { name: 'עגבניות', nameEn: 'Tomatoes', unit: 'ק״ג' };
// days ago → price: +18% over 3 weeks, staying up.
const TREND: Array<[number, string]> = [
  [20, '6.2000'],
  [16, '6.2000'],
  [8, '7.3000'],
  [4, '7.3200'],
  [1, '7.3400'],
];

async function leakTotalAgorot(restaurantId: string): Promise<number> {
  const [r] = await db
    .select({ s: sql<string>`coalesce(sum(abs(${discrepancies.deltaAmount})), 0)` })
    .from(discrepancies)
    .where(eq(discrepancies.restaurantId, restaurantId));
  return Math.round(Number(r?.s ?? 0) * 100);
}

async function supplierByEn(restaurantId: string, nameEn: string) {
  const [s] = await db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.restaurantId, restaurantId), eq(suppliers.nameEn, nameEn)))
    .limit(1);
  if (!s) throw new Error(`supplier "${nameEn}" not found — run seed + seed-demo first`);
  return s;
}

/**
 * Contract rows for one supplier: the price list that took effect on
 * CONTRACT_FROM, at the PO prices of the invoices it covers. HERO-NUMBER
 * GUARANTEE (analytic, not sampled): a product is kept only if EVERY matched
 * PO line of that product on an invoice dated ≥ CONTRACT_FROM carries exactly
 * the contract price — so buildMatchInput's contract override leaves every
 * engine input byte-identical and no stored or future leak figure can move.
 */
async function seedContracts(restaurantId: string) {
  let kept = 0;
  for (const nameEn of CONTRACT_SUPPLIERS) {
    const sup = await supplierByEn(restaurantId, nameEn);
    const covered = await db
      .select({ productId: poLines.productId, unit: poLines.unit, price: poLines.unitPriceExpected, invoiceDate: invoices.invoiceDate })
      .from(matchRuns)
      .innerJoin(invoices, eq(invoices.id, matchRuns.invoiceId))
      .innerJoin(poLines, eq(poLines.poId, matchRuns.poId))
      .where(
        and(
          eq(matchRuns.restaurantId, restaurantId),
          eq(invoices.supplierId, sup.id),
          sql`(${invoices.invoiceDate} at time zone 'Asia/Jerusalem')::date >= ${CONTRACT_FROM}::date`,
        ),
      )
      .orderBy(desc(invoices.invoiceDate));
    const byProduct = new Map<string, { unit: string; prices: Set<string> }>();
    for (const r of covered) {
      if (!r.productId || r.price == null) continue;
      const e = byProduct.get(r.productId) ?? { unit: r.unit, prices: new Set<string>() };
      e.prices.add(Number(r.price).toFixed(4));
      byProduct.set(r.productId, e);
    }
    for (const [productId, e] of byProduct) {
      if (e.prices.size !== 1) continue; // two different PO prices in the window → skip (would move a figure)
      const price = [...e.prices][0]!;
      await db
        .insert(supplierContractPrices)
        .values({
          restaurantId,
          supplierId: sup.id,
          productId,
          unit: e.unit,
          contractPrice: price,
          validFrom: CONTRACT_FROM,
          source: 'import',
          note: 'מחירון מוסכם — רבעון 4/2026',
        })
        .onConflictDoNothing();
      kept += 1;
    }
  }
  return kept;
}

async function seedTrend(restaurantId: string) {
  const produce = await supplierByEn(restaurantId, TREND_SUPPLIER);

  let [cheap] = await db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.restaurantId, restaurantId), eq(suppliers.name, CHEAP_SUPPLIER.name)))
    .limit(1);
  if (!cheap) {
    [cheap] = await db
      .insert(suppliers)
      .values({ restaurantId, name: CHEAP_SUPPLIER.name, nameEn: CHEAP_SUPPLIER.nameEn })
      .returning();
  }

  // Same category as the supplier's other produce, so per-category thresholds apply.
  const [sibling] = await db
    .select({ category: products.category })
    .from(products)
    .where(and(eq(products.restaurantId, restaurantId), eq(products.supplierId, produce.id)))
    .limit(1);
  let [tomato] = await db
    .select()
    .from(products)
    .where(and(eq(products.restaurantId, restaurantId), eq(products.canonicalName, TOMATO.name)))
    .limit(1);
  if (!tomato) {
    [tomato] = await db
      .insert(products)
      .values({
        restaurantId,
        supplierId: produce.id,
        canonicalName: TOMATO.name,
        nameEn: TOMATO.nameEn,
        defaultUnit: TOMATO.unit,
        category: sibling?.category ?? null,
      })
      .returning();
  }

  // Re-anchor the series to "now" on every run (idempotent: replace it).
  await db
    .delete(priceHistory)
    .where(and(eq(priceHistory.productId, tomato!.id), eq(priceHistory.supplierId, produce.id)));
  const now = Date.now();
  await db.insert(priceHistory).values(
    TREND.map(([daysAgo, price]) => ({
      restaurantId,
      productId: tomato!.id,
      supplierId: produce.id,
      observedAt: new Date(now - daysAgo * 86_400_000),
      unitPrice: price,
      qty: '20',
    })),
  );

  const [offer] = await db
    .select({ id: supplierCatalogItems.id })
    .from(supplierCatalogItems)
    .where(and(eq(supplierCatalogItems.supplierId, cheap!.id), eq(supplierCatalogItems.productId, tomato!.id)))
    .limit(1);
  if (!offer) {
    await db.insert(supplierCatalogItems).values({
      restaurantId,
      supplierId: cheap!.id,
      productId: tomato!.id,
      supplierNameRaw: 'עגבניות שדה',
      unit: TOMATO.unit,
      listPrice: '6.4000',
    });
  }
  // One live alert for the demo product: drop earlier runs' rows, re-detect.
  await db.delete(priceAlerts).where(and(eq(priceAlerts.restaurantId, restaurantId), eq(priceAlerts.productId, tomato!.id)));
  const sweep = await runPriceAlertSweep(db, restaurantId, { notify: NOTIFY });
  const [open] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(priceAlerts)
    .where(and(eq(priceAlerts.restaurantId, restaurantId), eq(priceAlerts.status, 'open')));
  return { ...sweep, open: open?.n ?? 0 };
}

/**
 * Supplier portal demo (flag `supplierConfirm`): of the restaurant's SENT orders,
 * the earliest gets a supplier answer (a shortage on its first line + a price
 * proposal on its second) so the order page shows differences; the next one
 * gets a fresh 72h link printed for the live walkthrough. Idempotent: earlier
 * unanswered demo links are replaced; an existing answer is kept.
 */
async function seedSupplierConfirm(restaurantId: string) {
  const sent = await db
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.restaurantId, restaurantId), eq(purchaseOrders.status, 'sent')))
    .orderBy(asc(purchaseOrders.expectedDeliveryAt), asc(purchaseOrders.id))
    .limit(2);
  if (sent.length < 2) return { answered: false, url: null as string | null };
  const [answeredPo, livePo] = [sent[0]!.id, sent[1]!.id];

  const [existing] = await db.select({ id: supplierResponses.id }).from(supplierResponses).where(eq(supplierResponses.poId, answeredPo)).limit(1);
  if (!existing) {
    const lines = await db
      .select({ id: poLines.id, qty: poLines.qtyOrdered, price: poLines.unitPriceExpected })
      .from(poLines)
      .where(eq(poLines.poId, answeredPo))
      .orderBy(asc(poLines.id))
      .limit(2);
    const link = await createSupplierLink(db, restaurantId, answeredPo);
    const resolved = link ? await resolveSupplierToken(db, link.token) : null;
    if (resolved?.ok && lines.length > 0) {
      const answer = [
        { poLineId: lines[0]!.id, qtyAvailable: Math.max(0, Math.floor(Number(lines[0]!.qty) * 0.6)) },
        ...(lines[1] && lines[1].price != null
          ? [{ poLineId: lines[1].id, proposedUnitPrice: Math.round(Number(lines[1].price) * 1.08 * 100) / 100 }]
          : []),
      ];
      await submitSupplierAnswer(db, resolved.link, { lines: answer, note: 'חלק מהסחורה יגיע מחר בבוקר' });
    }
  }

  // Replace earlier unanswered demo links for the live order, then mint one.
  await db.delete(supplierConfirmLinks).where(eq(supplierConfirmLinks.poId, livePo));
  await db.delete(supplierResponses).where(eq(supplierResponses.poId, livePo));
  const live = await createSupplierLink(db, restaurantId, livePo);
  const base = process.env.APP_URL ?? process.env.AUTH_URL ?? 'http://localhost:3000';
  return { answered: true, url: live ? supplierLinkUrl(base, live.token) : null };
}

async function main() {
  const [named] = await db.select().from(restaurants).where(eq(restaurants.name, 'כפר הזיתים')).limit(1);
  const restaurant = named ?? (await db.select().from(restaurants).limit(1))[0];
  if (!restaurant) throw new Error('no restaurant — run the base seed first');
  const rid = restaurant.id;

  const before = await leakTotalAgorot(rid);
  const contracts = await seedContracts(rid);
  const over = await findOverContractLines(db, rid);
  const sweep = await seedTrend(rid);
  const portal = await seedSupplierConfirm(rid);
  const after = await leakTotalAgorot(rid);

  console.log(`[wave1-demo] contracts kept=${contracts} over-contract lines=${over.length} alerts created=${sweep.created} open=${sweep.open}`);
  for (const l of over) {
    console.log(`  over contract: ${l.supplierName} · ${l.productName} billed ₪${l.billedUnitPrice} vs contract ₪${l.contractUnitPrice} (+₪${(l.overAgorot / 100).toFixed(2)})`);
  }
  console.log(`[wave1-demo] supplier portal: answered order seeded=${portal.answered} · live link: ${portal.url ?? '(no sent order)'}`);
  console.log(`[wave1-demo] leak total before=₪${(before / 100).toFixed(2)} after=₪${(after / 100).toFixed(2)}`);
  if (before !== after) throw new Error('hero numbers moved — aborting (this script must be additive)');
  if (over.length < 2) throw new Error(`expected ≥ 2 over-contract lines, got ${over.length}`);
  if (sweep.skipped) throw new Error('priceAlerts is off for the demo restaurant (settings.features)');
  if (sweep.open < 1) throw new Error('expected ≥ 1 open price alert');
  process.exit(0);
}

main().catch((err) => {
  console.error('[wave1-demo] failed', err);
  process.exit(1);
});
