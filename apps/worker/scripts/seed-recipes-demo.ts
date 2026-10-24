/**
 * Demo recipes for the food-cost-per-dish feature (wave 1, flag `recipes`).
 *
 *   DATABASE_URL=postgres://…/restomatch_dev pnpm --filter @restomatch/worker exec tsx scripts/seed-recipes-demo.ts
 *
 * Run AFTER the base seed + seed-demo.ts. Adds 8 realistic Israeli-restaurant
 * dishes and 2 sub-recipes (tahini, house hummus) to the demo restaurant, built
 * from its own products. IDEMPOTENT: re-running replaces exactly these recipes
 * (matched by name) and touches nothing else.
 *
 * It writes NO prices: costs come from the price_history seed-demo.ts already
 * created, so the leak hero / KPIs are unchanged. The "hurt" dish is the
 * entrecôte steak — seed-demo's butchery creep (→ ₪145 → ₪149/kg this month, HaKerem
 * Butchery) pushes it from under the 30% food-cost target to over it: "What changed
 * this month" shows it, and with the `dishPriceAlert` flag it raises a dish price alert.
 */
import {
  and,
  asc,
  assertSeedTarget,
  createDb,
  eq,
  inArray,
  products,
  recipeItems,
  recipes,
  restaurants,
} from '@restomatch/db';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
assertSeedTarget(url, 'seed-recipes-demo');
const db = createDb(url);

/** [product nameEn | sub-recipe name, net qty, unit, waste %, units per product unit] */
type Line = [string, string, string, number?, string?];

interface DemoRecipe {
  name: string;
  nameEn: string;
  category: string;
  menu?: number; // ₪ incl. VAT
  sub?: { yieldQty: string; yieldUnit: string };
  lines: Line[];
}

const EGG: [number?, string?] = [0, '30']; // a tray holds 30 eggs

const DEMO: DemoRecipe[] = [
  {
    name: 'טחינה מוכנה',
    nameEn: 'Tahini sauce',
    category: 'רטבים',
    sub: { yieldQty: '1', yieldUnit: 'ק״ג' },
    lines: [
      ['Raw tahini', '400', 'גרם'],
      ['Lemons', '150', 'גרם', 45],
      ['Peeled garlic', '15', 'גרם'],
      ['Coarse sea salt', '8', 'גרם'],
    ],
  },
  {
    name: 'חומוס הבית',
    nameEn: 'House hummus',
    category: 'רטבים',
    sub: { yieldQty: '2', yieldUnit: 'ק״ג' },
    lines: [
      ['Dried chickpeas', '800', 'גרם'],
      ['Raw tahini', '400', 'גרם'],
      ['Lemons', '200', 'גרם', 45],
      ['Peeled garlic', '30', 'גרם'],
      ['Ground cumin', '10', 'גרם'],
      ['Coarse sea salt', '15', 'גרם'],
    ],
  },
  {
    name: 'סטייק אנטריקוט',
    nameEn: 'Entrecôte steak',
    category: 'עיקריות',
    // ₪199: 29.5% (under the 30% target) at the start of the month → 31.4% at today's
    // ₪149/kg entrecôte — it crosses the target, so the dishPriceAlert demo fires
    // (HaKerem Butchery raised the price).
    menu: 199,
    lines: [
      ['Entrecôte (rib-eye)', '300', 'גרם', 12],
      ['Potatoes', '250', 'גרם', 15],
      ['Extra virgin olive oil', '20', 'מ״ל'],
      ['Coarse sea salt', '5', 'גרם'],
      ['Cracked black pepper', '2', 'גרם'],
    ],
  },
  {
    name: 'שניצל עם צ׳יפס',
    nameEn: 'Schnitzel & chips',
    category: 'עיקריות',
    menu: 68,
    lines: [
      ['Chicken breast', '220', 'גרם', 8],
      ['White flour', '30', 'גרם'],
      ['Eggs L (tray of 30)', '1', 'יח׳', ...EGG],
      ['Canola oil', '120', 'מ״ל'],
      ['Potatoes', '220', 'גרם', 15],
      ['Lemons', '30', 'גרם'],
    ],
  },
  {
    name: 'פילה סלמון בתנור',
    nameEn: 'Baked salmon fillet',
    category: 'עיקריות',
    menu: 98,
    lines: [
      ['Salmon fillet', '220', 'גרם', 5],
      ['Jasmine rice', '90', 'גרם'],
      ['Lemons', '40', 'גרם'],
      ['Extra virgin olive oil', '15', 'מ״ל'],
      ['Parsley', '0.2', 'צרור'],
    ],
  },
  {
    name: 'צלחת חומוס',
    nameEn: 'Hummus plate',
    category: 'ראשונות',
    menu: 42,
    lines: [
      ['חומוס הבית', '250', 'גרם'],
      ['טחינה מוכנה', '40', 'גרם'],
      ['Extra virgin olive oil', '15', 'מ״ל'],
      ['Parsley', '0.1', 'צרור'],
      ['Pita bread', '2', 'יח׳'],
    ],
  },
  {
    name: 'שקשוקה',
    nameEn: 'Shakshuka',
    category: 'בוקר',
    menu: 56,
    lines: [
      ['Eggs L (tray of 30)', '3', 'יח׳', ...EGG],
      ['Cherry tomatoes', '250', 'גרם'],
      ['Red bell peppers', '100', 'גרם', 10],
      ['Onions', '60', 'גרם', 10],
      ['Peeled garlic', '10', 'גרם'],
      ['Sweet paprika', '3', 'גרם'],
      ['Extra virgin olive oil', '20', 'מ״ל'],
      ['Sourdough loaf', '0.15', 'יח׳'],
    ],
  },
  {
    name: 'סלט ישראלי',
    nameEn: 'Israeli salad',
    category: 'ראשונות',
    menu: 38,
    lines: [
      ['Cucumbers', '150', 'גרם', 5],
      ['Cherry tomatoes', '150', 'גרם'],
      ['Onions', '30', 'גרם', 10],
      ['Parsley', '0.2', 'צרור'],
      ['Lemons', '30', 'גרם', 45],
      ['Extra virgin olive oil', '15', 'מ״ל'],
      ['Coarse sea salt', '2', 'גרם'],
    ],
  },
  {
    name: 'המבורגר הבית',
    nameEn: 'House burger',
    category: 'עיקריות',
    menu: 72,
    lines: [
      ['Ground beef', '200', 'גרם'],
      ['Burger buns', '1', 'יח׳'],
      ['Romaine lettuce', '0.1', 'יח׳'],
      ['Cherry tomatoes', '40', 'גרם'],
      ['Onions', '30', 'גרם', 10],
      ['Potatoes', '220', 'גרם', 15],
      ['Canola oil', '100', 'מ״ל'],
    ],
  },
  {
    name: 'כתף טלה בבישול ארוך',
    nameEn: 'Slow-cooked lamb shoulder',
    category: 'עיקריות',
    menu: 138,
    lines: [
      ['Lamb shoulder', '300', 'גרם', 25],
      ['Coarse bulgur', '80', 'גרם'],
      ['Onions', '100', 'גרם', 10],
      ['Ground cumin', '3', 'גרם'],
      ['Extra virgin olive oil', '20', 'מ״ל'],
      ['טחינה מוכנה', '50', 'גרם'],
    ],
  },
];

async function main() {
  // Same tenant as seed-demo.ts (the oldest restaurant — the chain seed adds branches after it).
  const [restaurant] = await db.select().from(restaurants).orderBy(asc(restaurants.createdAt)).limit(1);
  if (!restaurant) throw new Error('no restaurant — run the base seed first');
  const rid = restaurant.id;

  const productRows = await db.select().from(products).where(eq(products.restaurantId, rid));
  const byEn = new Map(productRows.map((p) => [p.nameEn ?? '', p] as const));

  // Idempotent: drop exactly the demo recipes (dishes first — they reference the subs).
  const names = DEMO.map((d) => d.name);
  const existing = await db
    .select({ id: recipes.id })
    .from(recipes)
    .where(and(eq(recipes.restaurantId, rid), inArray(recipes.name, names)));
  const ids = existing.map((r) => r.id);
  if (ids.length) {
    await db.delete(recipeItems).where(and(eq(recipeItems.restaurantId, rid), inArray(recipeItems.recipeId, ids)));
    await db.delete(recipes).where(and(eq(recipes.restaurantId, rid), inArray(recipes.id, ids)));
  }

  const idByName = new Map<string, string>();
  for (const d of DEMO) {
    const [row] = await db
      .insert(recipes)
      .values({
        restaurantId: rid,
        name: d.name,
        nameEn: d.nameEn,
        category: d.category,
        isSubRecipe: !!d.sub,
        yieldQty: d.sub?.yieldQty ?? '1',
        yieldUnit: d.sub?.yieldUnit ?? 'מנה',
        menuPriceAgorot: d.menu != null ? Math.round(d.menu * 100) : null,
        menuPriceIncludesVat: true,
      })
      .returning({ id: recipes.id });
    idByName.set(d.name, row!.id);
    const items = d.lines.map(([ref, qty, unit, waste = 0, unitsPer], i) => {
      const subId = idByName.get(ref);
      const product = subId ? undefined : byEn.get(ref);
      if (!subId && !product) throw new Error(`demo product not found: ${ref} (run seed + seed-demo first)`);
      return {
        restaurantId: rid,
        recipeId: row!.id,
        productId: product?.id ?? null,
        subRecipeId: subId ?? null,
        quantity: qty,
        unit,
        wastePct: waste.toFixed(2),
        unitsPerProductUnit: unitsPer ?? null,
        sortOrder: i,
      };
    });
    await db.insert(recipeItems).values(items);
  }
  console.log(`[seed-recipes-demo] ${DEMO.filter((d) => !d.sub).length} dishes + ${DEMO.filter((d) => d.sub).length} sub-recipes for "${restaurant.name}"`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
