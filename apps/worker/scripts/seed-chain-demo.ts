/**
 * Chain demo ("רשת"): adds two more branches to the demo tenant's billing
 * account, each with its own suppliers, deliveries, invoices and discrepancies,
 * run through the REAL matching + approvals engines (like seed-demo.ts):
 *
 *   כפר הזיתים — חיפה      clean branch, ~0.8 % of checked spend leaks
 *   כפר הזיתים — ירושלים   leaky branch, ~3.1 % (a butcher creeping prices,
 *                           short deliveries billed in full)
 *
 * Five suppliers in each new branch are the SAME businesses as the main branch
 * (same ח.פ) so the chain dashboard merges them across branches; each branch
 * also has one local supplier of its own.
 *
 * The existing tenant is NOT changed except that it is attached to a billing
 * account on the 'chain' plan (if it has none yet): its hero (₪572 = 2.0 % of
 * ₪28,389 on the base demo) is untouched. The demo owner gets an owner
 * membership in all three branches; the demo manager gets a MANAGER membership
 * in Jerusalem (so their switcher has two branches, and the owner-only chain
 * rule is visible).
 *
 * Idempotent: re-running wipes and regenerates only the two new branches.
 * Run after the base seed + seed-demo:
 *   DATABASE_URL=... pnpm --filter @restomatch/worker seed:chain-demo
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
  billingAccounts,
  createDb,
  discrepancies,
  eq,
  goodsReceipts,
  grLines,
  inArray,
  invoiceLines,
  invoices,
  matchRuns,
  memberships,
  plans,
  poLines,
  priceBaselines,
  priceHistory,
  products,
  purchaseOrders,
  restaurants,
  storageNamespaces,
  subscriptions,
  supplierCatalogItems,
  suppliers,
  users,
} from '@restomatch/db';
import { resolveTolerances, runMatch, type InvoiceLineInput, type MatchInput } from '@restomatch/matching';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
assertSeedTarget(url, 'seed-chain-demo');
const db = createDb(url);

const DAY_MS = 24 * 60 * 60 * 1000;
const OPEN_WINDOW_DAYS = 10;
const HISTORY_DAYS = 70;
const OWNER_EMAIL = 'owner@kfar-hazeitim.test';
const MANAGER_EMAIL = 'manager@kfar-hazeitim.test';
const CHAIN_ACCOUNT_NAME = 'כפר הזיתים — רשת';

type Profile = 'clean' | 'leaky';

interface LocalSupplier {
  name: string;
  nameEn: string;
  businessId: string;
  prefix: string;
  products: Array<{ name: string; nameEn: string; unit: string; price: number; category: string }>;
}

interface BranchSpec {
  key: string;
  name: string;
  profile: Profile;
  seed: number;
  /** Main-branch suppliers (by nameEn) this branch also buys from. */
  shared: string[];
  local: LocalSupplier;
}

const BRANCHES: BranchSpec[] = [
  {
    key: 'haifa',
    name: 'כפר הזיתים — חיפה',
    profile: 'clean',
    seed: 0x4a1fa,
    shared: ['HaSharon Produce', 'HaKerem Butchery', 'Mediterranean Fish Co.', 'Galilee Dairies', 'Steinberg Beverages'],
    local: {
      name: 'ירקות הכרמל',
      nameEn: 'Carmel Greens',
      businessId: '514300201',
      prefix: 'CG',
      products: [
        { name: 'חסה ערבית', nameEn: 'Romaine lettuce', unit: 'יח׳', price: 6.5, category: 'ירקות' },
        { name: 'פטרוזיליה', nameEn: 'Parsley bunch', unit: 'יח׳', price: 3.2, category: 'ירקות' },
        { name: 'נענע', nameEn: 'Mint bunch', unit: 'יח׳', price: 3.5, category: 'ירקות' },
        { name: 'בצל סגול', nameEn: 'Red onion', unit: 'ק״ג', price: 5.9, category: 'ירקות' },
      ],
    },
  },
  {
    key: 'jerusalem',
    name: 'כפר הזיתים — ירושלים',
    profile: 'leaky',
    seed: 0x1e7a5,
    shared: ['HaSharon Produce', 'HaKerem Butchery', 'Mediterranean Fish Co.', 'Galilee Dairies', "Brenner's Bakery"],
    local: {
      name: 'בשר ההר',
      nameEn: 'Har Meats',
      businessId: '514300301',
      prefix: 'HM',
      products: [
        { name: 'פרגית', nameEn: 'Chicken thighs (pargit)', unit: 'ק״ג', price: 44, category: 'בשר' },
        { name: 'כבש טחון', nameEn: 'Ground lamb', unit: 'ק״ג', price: 78, category: 'בשר' },
        { name: 'צלעות עגל', nameEn: 'Veal ribs', unit: 'ק״ג', price: 92, category: 'בשר' },
      ],
    },
  },
];

/** Price bump / short delivery knobs per profile (tuned for the % targets above). */
const KNOBS: Record<Profile, { bumpP: number; bump: [number, number]; shortP: number; short: number; localBump: number }> = {
  clean: { bumpP: 0.22, bump: [0.06, 0.1], shortP: 0.04, short: 0.15, localBump: 0 },
  leaky: { bumpP: 0.45, bump: [0.07, 0.12], shortP: 0.18, short: 0.2, localBump: 0.12 },
};

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

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

async function wipeBranch(restaurantId: string) {
  const invIds = (await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.restaurantId, restaurantId))).map((r) => r.id);
  const grIds = (await db.select({ id: goodsReceipts.id }).from(goodsReceipts).where(eq(goodsReceipts.restaurantId, restaurantId))).map((r) => r.id);
  const poIds = (await db.select({ id: purchaseOrders.id }).from(purchaseOrders).where(eq(purchaseOrders.restaurantId, restaurantId))).map((r) => r.id);
  await db.delete(discrepancies).where(eq(discrepancies.restaurantId, restaurantId));
  await db.delete(matchRuns).where(eq(matchRuns.restaurantId, restaurantId));
  if (invIds.length) await db.delete(invoiceLines).where(inArray(invoiceLines.invoiceId, invIds));
  await db.delete(priceHistory).where(eq(priceHistory.restaurantId, restaurantId));
  await db.delete(priceBaselines).where(eq(priceBaselines.restaurantId, restaurantId));
  await db.delete(invoices).where(eq(invoices.restaurantId, restaurantId));
  if (grIds.length) await db.delete(grLines).where(inArray(grLines.grId, grIds));
  await db.delete(goodsReceipts).where(eq(goodsReceipts.restaurantId, restaurantId));
  if (poIds.length) await db.delete(poLines).where(inArray(poLines.poId, poIds));
  await db.delete(purchaseOrders).where(eq(purchaseOrders.restaurantId, restaurantId));
  await db.delete(activityEvents).where(eq(activityEvents.restaurantId, restaurantId));
  await db.delete(supplierCatalogItems).where(eq(supplierCatalogItems.restaurantId, restaurantId));
  await db.delete(products).where(eq(products.restaurantId, restaurantId));
  await db.delete(suppliers).where(eq(suppliers.restaurantId, restaurantId));
}

async function ensureMembership(userId: string, restaurantId: string, role: 'owner' | 'manager') {
  const [m] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.restaurantId, restaurantId)))
    .limit(1);
  if (!m) await db.insert(memberships).values({ userId, restaurantId, role });
  else if (m.role !== role) {
    await db
      .update(memberships)
      .set({ role })
      .where(and(eq(memberships.userId, userId), eq(memberships.restaurantId, restaurantId)));
  }
}

async function main() {
  const [owner] = await db.select().from(users).where(eq(users.email, OWNER_EMAIL)).limit(1);
  if (!owner) throw new Error(`no ${OWNER_EMAIL} — run the base seed first`);
  const [manager] = await db.select().from(users).where(eq(users.email, MANAGER_EMAIL)).limit(1);

  // The main branch = the oldest restaurant the demo owner owns.
  const [main] = await db
    .select({ r: restaurants })
    .from(memberships)
    .innerJoin(restaurants, eq(restaurants.id, memberships.restaurantId))
    .where(and(eq(memberships.userId, owner.id), eq(memberships.role, 'owner')))
    .orderBy(asc(restaurants.createdAt))
    .limit(1);
  if (!main) throw new Error('the demo owner owns no restaurant — run the base seed first');
  const mainR = main.r;
  const heroBefore = await computeLeakHero(db, mainR.id);

  // ── billing account on the chain plan (shared by every branch) ─────────────
  let accountId = mainR.billingAccountId;
  if (!accountId) {
    const [acct] = await db.insert(billingAccounts).values({ name: CHAIN_ACCOUNT_NAME, ownerUserId: owner.id }).returning();
    accountId = acct!.id;
    await db.update(restaurants).set({ billingAccountId: accountId }).where(eq(restaurants.id, mainR.id));
  }
  const [chainPlan] = await db.select().from(plans).where(eq(plans.key, 'chain')).limit(1);
  if (!chainPlan) throw new Error("plan 'chain' is not seeded — run the base seed first");
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.billingAccountId, accountId)).limit(1);
  if (!sub) {
    await db.insert(subscriptions).values({ billingAccountId: accountId, planId: chainPlan.id, status: 'active' });
  } else if (sub.planId !== chainPlan.id || sub.status !== 'active') {
    await db.update(subscriptions).set({ planId: chainPlan.id, status: 'active' }).where(eq(subscriptions.id, sub.id));
  }

  const mainSuppliers = await db.select().from(suppliers).where(eq(suppliers.restaurantId, mainR.id));
  const mainProducts = await db.select().from(products).where(eq(products.restaurantId, mainR.id));
  const mainItems = await db.select().from(supplierCatalogItems).where(eq(supplierCatalogItems.restaurantId, mainR.id));
  const priceOf = new Map(mainItems.map((i) => [i.productId ?? '', Number(i.listPrice ?? 0)]));

  const tolerances = resolveTolerances(mainR.settings?.tolerances);
  const rules = buildRules(resolveApprovalThresholds(mainR.settings?.approvalThresholds));
  const vatRate = Number(mainR.vatRate ?? '0.18');
  const tz = mainR.timezone ?? 'Asia/Jerusalem';
  const todayStart = startOfLocalDay(tz);
  const openSince = new Date(todayStart.getTime() - OPEN_WINDOW_DAYS * DAY_MS);

  for (const spec of BRANCHES) {
    const rand = mulberry32(spec.seed);
    const knobs = KNOBS[spec.profile];

    // ── the branch restaurant (found by name on the account → idempotent) ──
    let [branch] = await db
      .select()
      .from(restaurants)
      .where(and(eq(restaurants.name, spec.name), eq(restaurants.billingAccountId, accountId)))
      .limit(1);
    if (branch) {
      await wipeBranch(branch.id);
    } else {
      [branch] = await db
        .insert(restaurants)
        .values({ name: spec.name, billingAccountId: accountId, vatRate: mainR.vatRate, timezone: tz, settings: mainR.settings })
        .returning();
      await db.insert(storageNamespaces).values({ restaurantId: branch!.id, bucket: 'invoice-scans', prefix: `${branch!.id}/` });
    }
    const rid = branch!.id;
    await ensureMembership(owner.id, rid, 'owner');
    if (manager && spec.key === 'jerusalem') await ensureMembership(manager.id, rid, 'manager');

    // ── suppliers + products (shared businesses copied, plus one local) ──
    type Prod = { id: string; name: string; nameEn: string | null; unit: string; price: number };
    const supplierPlan: Array<{ id: string; name: string; nameEn: string; prefix: string; local: boolean; products: Prod[] }> = [];
    for (const en of spec.shared) {
      const src = mainSuppliers.find((s) => s.nameEn === en);
      if (!src) continue;
      const [s] = await db
        .insert(suppliers)
        .values({
          restaurantId: rid,
          name: src.name,
          nameEn: src.nameEn,
          businessId: src.businessId,
          contactEmail: src.contactEmail,
          paymentTerms: src.paymentTerms,
          deliverySchedule: src.deliverySchedule,
          orderSchedule: src.orderSchedule,
        })
        .returning();
      const prods: Prod[] = [];
      for (const p of mainProducts.filter((x) => x.supplierId === src.id).slice(0, 5)) {
        const price = priceOf.get(p.id) || 10;
        const [np] = await db
          .insert(products)
          .values({ restaurantId: rid, supplierId: s!.id, canonicalName: p.canonicalName, nameEn: p.nameEn, category: p.category, defaultUnit: p.defaultUnit })
          .returning();
        await db.insert(supplierCatalogItems).values({
          restaurantId: rid,
          supplierId: s!.id,
          productId: np!.id,
          supplierNameRaw: p.canonicalName,
          unit: p.defaultUnit,
          listPrice: price.toFixed(4),
        });
        prods.push({ id: np!.id, name: p.canonicalName, nameEn: p.nameEn, unit: p.defaultUnit ?? 'יח׳', price });
      }
      supplierPlan.push({ id: s!.id, name: src.name, nameEn: en, prefix: en.slice(0, 2).toUpperCase(), local: false, products: prods });
    }
    {
      const l = spec.local;
      const [s] = await db
        .insert(suppliers)
        .values({ restaurantId: rid, name: l.name, nameEn: l.nameEn, businessId: l.businessId, paymentTerms: 'שוטף + 30' })
        .returning();
      const prods: Prod[] = [];
      for (const p of l.products) {
        const [np] = await db
          .insert(products)
          .values({ restaurantId: rid, supplierId: s!.id, canonicalName: p.name, nameEn: p.nameEn, category: p.category, defaultUnit: p.unit })
          .returning();
        await db.insert(supplierCatalogItems).values({
          restaurantId: rid,
          supplierId: s!.id,
          productId: np!.id,
          supplierNameRaw: p.name,
          unit: p.unit,
          listPrice: p.price.toFixed(4),
        });
        prods.push({ id: np!.id, name: p.name, nameEn: p.nameEn, unit: p.unit, price: p.price });
      }
      supplierPlan.push({ id: s!.id, name: l.name, nameEn: l.nameEn, prefix: l.prefix, local: true, products: prods });
    }

    // ── deliveries over the last HISTORY_DAYS, each through the real engine ──
    let made = 0;
    let openCount = 0;
    for (const [si, sp] of supplierPlan.entries()) {
      const cadence = 3 + (si % 2); // every 3–4 days
      const known = new Set<string>();
      let seq = 31000 + si * 1000;
      for (let day = HISTORY_DAYS - (si % cadence); day >= 1; day -= cadence) {
        const expected = new Date(todayStart.getTime() - day * DAY_MS + (8 + (si % 4)) * 60 * 60 * 1000);
        const receivedAt = new Date(expected.getTime() + 25 * 60 * 1000);
        const lines = sp.products.map((p) => ({
          ...p,
          qty: p.unit === 'ק״ג' ? 2 + Math.round(rand() * 4) : 3 + Math.round(rand() * 7),
        }));

        // Scenario for this delivery.
        const bumpIdx = rand() < knobs.bumpP ? Math.floor(rand() * lines.length) : -1;
        const bumpPct = knobs.bump[0] + rand() * (knobs.bump[1] - knobs.bump[0]);
        const shortIdx = rand() < knobs.shortP ? Math.floor(rand() * lines.length) : -1;
        // The leaky branch's local butcher creeps every price once it starts (last ~5 weeks).
        const creep = sp.local && knobs.localBump > 0 && day <= 35 ? knobs.localBump * (1 - day / 50) : 0;

        const [po] = await db
          .insert(purchaseOrders)
          .values({ restaurantId: rid, supplierId: sp.id, expectedDeliveryAt: expected, status: 'closed', source: 'manual', createdAt: new Date(expected.getTime() - DAY_MS) })
          .returning();
        const poRows = [];
        for (const l of lines) {
          const [pl] = await db
            .insert(poLines)
            .values({ poId: po!.id, productId: l.id, rawDescription: l.name, rawDescriptionEn: l.nameEn, qtyOrdered: l.qty.toString(), unit: l.unit, unitPriceExpected: l.price.toFixed(2) })
            .returning();
          poRows.push(pl!);
        }
        const [gr] = await db
          .insert(goodsReceipts)
          .values({ restaurantId: rid, poId: po!.id, receivedAt, status: 'completed', createdAt: receivedAt, updatedAt: receivedAt })
          .returning();
        const grRows = [];
        for (const [i, l] of lines.entries()) {
          const missing = i === shortIdx ? Math.max(1, Math.round(l.qty * knobs.short)) : 0;
          const [grl] = await db
            .insert(grLines)
            .values({ grId: gr!.id, poLineId: poRows[i]!.id, productId: l.id, qtyReceived: (l.qty - missing).toString(), qtyRejected: '0', conditionNotes: missing ? `חסרים ${missing} ${l.unit} בקבלה` : null })
            .returning();
          grRows.push({ id: grl!.id, qtyReceived: l.qty - missing });
        }

        const invNumber = `${sp.prefix}-${(seq += 1)}`;
        const invLineInputs: InvoiceLineInput[] = [];
        const invLineValues: Array<typeof invoiceLines.$inferInsert> = [];
        for (const [i, l] of lines.entries()) {
          const id = crypto.randomUUID();
          const factor = 1 + (i === bumpIdx ? bumpPct : 0) + creep;
          const price = r2(l.price * factor);
          const lineTotal = r2(l.qty * price);
          invLineInputs.push({ id, productId: l.id, qtyBilled: l.qty, unit: l.unit, unitPriceBilled: price, lineTotal });
          invLineValues.push({
            id,
            invoiceId: '',
            productId: l.id,
            rawDescription: l.name,
            rawDescriptionEn: l.nameEn,
            qtyBilled: l.qty.toString(),
            unit: l.unit,
            unitPriceBilled: price.toFixed(2),
            lineTotal: lineTotal.toFixed(2),
            vatRate: vatRate.toString(),
          });
        }
        const subtotal = r2(invLineInputs.reduce((a, l) => a + Math.round(l.lineTotal * 100), 0) / 100);
        const vatAmount = r2(subtotal * vatRate);
        const totalInclVat = r2(subtotal + vatAmount);
        const [invoice] = await db
          .insert(invoices)
          .values({
            restaurantId: rid,
            supplierId: sp.id,
            invoiceNumber: invNumber,
            invoiceDate: receivedAt,
            dueDate: new Date(receivedAt.getTime() + 30 * DAY_MS),
            totalExclVat: subtotal.toFixed(2),
            vatAmount: vatAmount.toFixed(2),
            totalInclVat: totalInclVat.toFixed(2),
            status: 'matched',
            source: 'photo',
            ocrConfidence: '0.965',
            createdAt: receivedAt,
            updatedAt: receivedAt,
          })
          .returning();
        await db.insert(invoiceLines).values(invLineValues.map((v) => ({ ...v, invoiceId: invoice!.id })));
        await db.insert(priceHistory).values(
          invLineValues.map((v) => ({
            restaurantId: rid,
            productId: v.productId!,
            supplierId: sp.id,
            observedAt: receivedAt,
            unitPrice: v.unitPriceBilled!,
            qty: v.qtyBilled!,
            sourceInvoiceId: invoice!.id,
          })),
        );

        const input: MatchInput = {
          invoice: { invoiceNumber: invNumber, invoiceDate: receivedAt, supplierId: sp.id, totalExclVat: subtotal, vatAmount, totalInclVat },
          poLines: poRows.map((l) => ({ id: l.id, productId: l.productId, qtyOrdered: Number(l.qtyOrdered), unit: l.unit, unitPriceExpected: Number(l.unitPriceExpected) })),
          grLines: grRows.map((g, i) => ({ id: g.id, poLineId: poRows[i]!.id, productId: poRows[i]!.productId, qtyReceived: g.qtyReceived })),
          invoiceLines: invLineInputs,
          vatRate,
          tolerances,
          knownInvoiceNumbers: new Set(known),
          expectedDeliveryDate: expected,
        };
        const result = runMatch(input);
        known.add(invNumber);

        const recent = receivedAt >= openSince;
        const [matchRun] = await db
          .insert(matchRuns)
          .values({ restaurantId: rid, poId: po!.id, grId: gr!.id, invoiceId: invoice!.id, runAt: receivedAt, overallStatus: result.status, totalDiscrepancyAmount: result.totalDiscrepancyAmount.toFixed(2) })
          .returning();
        let openBlock = false;
        for (const d of result.discrepancies) {
          const ctx: ApprovalContext = {
            discrepancy: { type: d.type, severity: d.severity, deltaAmount: d.deltaAmount },
            matchRun: { totalDiscrepancyAmount: result.totalDiscrepancyAmount, totalInvoiceAmount: totalInclVat, poExists: true },
          };
          const decision = evaluateApproval(ctx, rules);
          const status = decision.action === 'auto_approve' ? 'accepted' : recent ? 'open' : 'resolved';
          if (status === 'open') {
            openCount += 1;
            if (d.severity === 'block') openBlock = true;
          }
          await db.insert(discrepancies).values({
            matchRunId: matchRun!.id,
            restaurantId: rid,
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
            resolvedAt: status === 'resolved' ? new Date(receivedAt.getTime() + 2 * DAY_MS) : null,
            resolutionNote: status === 'resolved' ? 'זיכוי התקבל מהספק' : null,
            createdAt: receivedAt,
          });
        }
        const finalStatus = openBlock ? 'disputed' : recent ? 'matched' : 'paid';
        if (finalStatus !== 'matched') {
          await db.update(invoices).set({ status: finalStatus, updatedAt: receivedAt }).where(eq(invoices.id, invoice!.id));
        }
        await db.insert(activityEvents).values({
          restaurantId: rid,
          eventType: 'invoice_matched',
          title: `חשבונית ${invNumber} הותאמה`,
          detail: sp.name,
          entityType: 'match_run',
          entityId: matchRun!.id,
          metadata: {
            invoiceId: invoice!.id,
            invoiceNumber: invNumber,
            supplierName: sp.name,
            supplierNameEn: sp.nameEn,
            discrepancyCount: result.discrepancies.filter((d) => d.severity !== 'info').length,
            potentialLossIls: result.totalDiscrepancyAmount,
            status: result.status,
          },
          createdAt: receivedAt,
        });
        made += 1;
      }
    }
    await computeBaselines(db, rid, { windowDays: 90 });
    const hero = await computeLeakHero(db, rid);
    console.log(
      `[seed-chain-demo] ${spec.name}: ${made} invoices · ${openCount} open · leak ₪${hero.leakIls.toFixed(0)} of ₪${hero.spendIls.toFixed(0)} (${((hero.leakPct ?? 0) * 100).toFixed(1)}%)`,
    );
  }

  const heroAfter = await computeLeakHero(db, mainR.id);
  if (heroAfter.leakIls !== heroBefore.leakIls || heroAfter.spendIls !== heroBefore.spendIls) {
    throw new Error(
      `main branch numbers changed (₪${heroBefore.leakIls}/₪${heroBefore.spendIls} → ₪${heroAfter.leakIls}/₪${heroAfter.spendIls}) — this must never happen`,
    );
  }
  console.log(
    `[seed-chain-demo] ${mainR.name} unchanged: leak ₪${heroAfter.leakIls.toFixed(0)} of ₪${heroAfter.spendIls.toFixed(0)} (${((heroAfter.leakPct ?? 0) * 100).toFixed(1)}%) · ${OWNER_EMAIL} owns all 3 branches`,
  );
  await db.$client.end();
}

main().catch((err) => {
  console.error('[seed-chain-demo] failed', err);
  process.exit(1);
});
