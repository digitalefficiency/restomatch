/**
 * Demo inventory counts for "כפר הזיתים" (flag `inventoryCount`): a completed
 * opening count on 2026-09-30 and a completed closing count on 2026-10-24, so
 * the demo shows October's ACTUAL food cost (opening + purchases − closing) as
 * a % of food sales.
 *
 * Goes through the real inventory router (start → saveLines → complete) as the
 * demo owner, so the snapshot values are exactly what the app would compute.
 * Writes ONLY inventory_counts / inventory_count_lines: invoices, leaks,
 * pending and the hero are untouched (check:demo stays green).
 * Idempotent: the demo restaurant's counts are deleted and rebuilt.
 *
 *   DATABASE_URL=… pnpm --filter @restomatch/worker exec tsx scripts/seed-inventory-demo.ts
 */
import { appRouter, type AppContext } from '@restomatch/api';
import {
  and,
  asc,
  assertSeedTarget,
  createDb,
  eq,
  inventoryCounts,
  memberships,
  products,
  restaurants,
  users,
} from '@restomatch/db';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
assertSeedTarget(url, 'seed-inventory-demo');
const db = createDb(url);

const OPENING = '2026-09-30';
const CLOSING = '2026-10-24';
/**
 * October 1–24 food sales before VAT, entered by hand on the closing count (the
 * demo has no POS feed on this branch). ~₪5.7k/day for a 70-seat
 * restaurant.
 */
const OCTOBER_FOOD_SALES = '136400.00';

/** nameEn → [opening qty, closing qty] in the product's default unit. */
const QTY: Record<string, [string, string]> = {
  // Meat & fish (fridge)
  'Entrecôte (rib-eye)': ['8', '9.5'],
  'Chicken breast': ['12', '14'],
  'Boneless chicken thighs': ['10', '9'],
  'Ground beef': ['6', '7'],
  'Lamb shoulder': ['5', '4.5'],
  'Merguez sausages': ['3', '3.5'],
  'Salmon fillet': ['6', '7'],
  'Whole sea bream': ['4', '3'],
  'Red tuna': ['2', '2.5'],
  Calamari: ['3', '3.5'],
  // Dairy (fridge)
  'Bulgarian cheese': ['4', '5'],
  Butter: ['3', '4'],
  'Eggs L (tray of 30)': ['6', '8'],
  'Heavy cream 38%': ['6', '8'],
  Labneh: ['3', '4'],
  'Milk 3%': ['20', '24'],
  Mozzarella: ['5', '6'],
  // Produce
  'Cherry tomatoes': ['6', '8'],
  Coriander: ['10', '8'],
  Cucumbers: ['8', '10'],
  Eggplants: ['6', '7'],
  Lemons: ['5', '6'],
  Onions: ['15', '18'],
  Parsley: ['10', '12'],
  'Peeled garlic': ['2', '2.5'],
  Potatoes: ['30', '35'],
  'Red bell peppers': ['6', '7'],
  'Romaine lettuce': ['12', '14'],
  // Dry store, bakery, oils & spices
  'Coarse bulgur': ['10', '8'],
  'Dried chickpeas': ['25', '20'],
  'Jasmine rice': ['20', '24'],
  'White flour': ['25', '30'],
  'White sugar': ['10', '12'],
  Baguette: ['10', '12'],
  'Burger buns': ['60', '80'],
  Challah: ['6', '8'],
  'Pita bread': ['100', '120'],
  'Sourdough loaf': ['8', '10'],
  'Canola oil': ['20', '18'],
  'Coarse sea salt': ['5', '4'],
  'Cracked black pepper': ['1', '1.2'],
  'Extra virgin olive oil': ['15', '18'],
  'Ground cumin': ['1', '1.5'],
  'Raw tahini': ['10', '12'],
  Sumac: ['0.8', '1'],
  'Sweet paprika': ['1', '1.2'],
  // Bar
  'Cabernet red wine': ['24', '30'],
  'Cola Zero 330ml (case of 24)': ['6', '8'],
  'Draft beer keg 30L': ['2', '3'],
  'Fresh orange juice': ['10', '12'],
  'Mineral water 1.5L (6-pack)': ['10', '12'],
};

const ils = (agorot: number) => `₪${(agorot / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function main() {
  const [r] = await db.select({ id: restaurants.id, name: restaurants.name }).from(restaurants).orderBy(asc(restaurants.createdAt)).limit(1);
  if (!r) throw new Error('no restaurant — run seed-demo first');
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.restaurantId, r.id), eq(memberships.role, 'owner')))
    .limit(1);
  if (!owner) throw new Error('no owner membership on the demo restaurant');

  await db.delete(inventoryCounts).where(eq(inventoryCounts.restaurantId, r.id));
  const caller = appRouter.createCaller({ db, session: { userId: owner.id, restaurantId: r.id, role: 'owner' } } as AppContext);
  const byName = new Map(
    (await db.select({ id: products.id, nameEn: products.nameEn }).from(products).where(eq(products.restaurantId, r.id))).map((p) => [p.nameEn ?? '', p.id] as const),
  );

  const results: Array<{ date: string; value: number; counted: number; unpriced: number }> = [];
  for (const [date, i] of [[OPENING, 0], [CLOSING, 1]] as const) {
    const { id } = await caller.inventory.start({ countDate: date });
    const lines = Object.entries(QTY)
      .map(([nameEn, q]) => ({ productId: byName.get(nameEn), qty: q[i] }))
      .filter((l): l is { productId: string; qty: string } => !!l.productId);
    await caller.inventory.saveLines({ countId: id, lines });
    if (date === CLOSING) await caller.inventory.setMeta({ countId: id, foodSalesExVat: OCTOBER_FOOD_SALES });
    const done = await caller.inventory.complete({ countId: id });
    results.push({ date, value: done.totalValueAgorot, counted: done.counted, unpriced: done.unpriced });
  }
  const p = await caller.inventory.period();
  for (const x of results) console.log(`[seed-inventory-demo] count ${x.date}: ${ils(x.value)} · ${x.counted} items · ${x.unpriced} without a price`);
  if (p.available) {
    console.log(
      `[seed-inventory-demo] October actual food cost: ${ils(p.opening.valueAgorot)} + purchases ${ils(p.purchases.purchasesAgorot)} − credits ${ils(p.purchases.creditsAgorot)} − ${ils(p.closing.valueAgorot)} = ${ils(p.actualAgorot)}` +
        ` = ${p.actualBp == null ? '—' : (p.actualBp / 100).toFixed(1)}% of food sales ${p.salesAgorot == null ? '—' : ils(p.salesAgorot)} (${p.salesSource ?? 'none'})` +
        (p.varianceAgorot == null ? '' : ` · unexplained usage ${ils(p.varianceAgorot)}`),
    );
    console.log(
      `[seed-inventory-demo] purchases: ${p.purchases.invoiceCount} invoices ${ils(p.purchases.invoicesAgorot)} − non-food ${ils(p.purchases.nonFoodAgorot)}` +
        ` · info: ${p.purchases.unbilledNotes} delivery notes not billed yet ${ils(p.purchases.unbilledNotesAgorot)}`,
    );
  }
  console.log(`[seed-inventory-demo] done for "${r.name}"`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
