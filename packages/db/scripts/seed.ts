import { createDb } from '../src/client';
import { PLAN_SEED_LIST } from '../src/plans';
import {
  memberships,
  plans,
  poLines,
  products,
  purchaseOrders,
  restaurants,
  suppliers,
  users,
  type DeliverySchedule,
} from '../src/schema';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  // This script DELETES every restaurant/user/supplier/product/PO below. It is a
  // dev/test fixture, never a production tool (plans are repriced by migration).
  // Same guard as reset.ts: refuse anything that is not clearly local/test.
  if (!url.includes('localhost') && !url.includes('127.0.0.1') && !url.includes('_test')) {
    throw new Error(
      '[seed] refusing to run against a non-local, non-test database (it deletes all tenant data): ' +
        url.replace(/:[^:@/]+@/, ':***@'),
    );
  }
  const db = createDb(url);

  console.log('[seed] plans (idempotent upsert)');
  for (const p of PLAN_SEED_LIST) {
    await db
      .insert(plans)
      .values({
        key: p.key,
        nameHe: p.nameHe,
        priceAgorotMonthly: p.priceAgorotMonthly,
        limits: p.limits,
        features: p.features,
        sortOrder: p.sortOrder,
      })
      .onConflictDoUpdate({
        target: plans.key,
        set: {
          nameHe: p.nameHe,
          priceAgorotMonthly: p.priceAgorotMonthly,
          limits: p.limits,
          features: p.features,
          sortOrder: p.sortOrder,
        },
      });
  }

  console.log('[seed] clearing existing data');
  await db.delete(poLines);
  await db.delete(purchaseOrders);
  await db.delete(products);
  await db.delete(suppliers);
  await db.delete(memberships);
  await db.delete(users);
  await db.delete(restaurants);

  console.log('[seed] restaurant');
  const [restaurant] = await db
    .insert(restaurants)
    .values({
      name: 'כפר הזיתים',
      businessId: '514778123',
      vatRate: '0.17',
      timezone: 'Asia/Jerusalem',
      settings: {
        tolerances: {
          pricePercent: 0.02,
          priceAbsolute: 5,
          qtyPercent: 0.03,
          qtyAbsolute: 1,
        },
        baselineWindowDays: 90,
      },
    })
    .returning();
  if (!restaurant) throw new Error('restaurant insert failed');

  console.log('[seed] users + memberships');
  const userSpecs = [
    { email: 'owner@kfar-hazeitim.test', name: 'רון בעלים', role: 'owner' as const },
    { email: 'manager@kfar-hazeitim.test', name: 'שני מנהלת', role: 'manager' as const },
    { email: 'receiver@kfar-hazeitim.test', name: 'יוסי מקבל', role: 'receiver' as const },
    { email: 'bookkeeper@kfar-hazeitim.test', name: 'אורית חשבת', role: 'bookkeeper' as const },
    { email: 'chef@kfar-hazeitim.test', name: 'תומר שף', role: 'chef' as const },
  ];
  const insertedUsers = await db.insert(users).values(userSpecs).returning();
  await db.insert(memberships).values(
    insertedUsers.map((u, i) => ({
      userId: u.id,
      restaurantId: restaurant.id,
      role: userSpecs[i]!.role,
    })),
  );

  console.log('[seed] suppliers');
  const supplierSpecs: Array<{
    name: string;
    businessId: string;
    deliverySchedule: DeliverySchedule;
  }> = [
    { name: 'ירקני אבי', businessId: '301234561', deliverySchedule: { sun: ['08:00'], tue: ['08:00'], thu: ['08:00'] } },
    { name: 'קצביית הכרם', businessId: '301234562', deliverySchedule: { mon: ['09:30'], wed: ['09:30'] } },
    { name: 'מאפיית ברנס', businessId: '301234563', deliverySchedule: { sun: ['06:00'], mon: ['06:00'], tue: ['06:00'], wed: ['06:00'], thu: ['06:00'], fri: ['06:00'] } },
    { name: 'קובי דגים', businessId: '301234564', deliverySchedule: { tue: ['11:00'], thu: ['11:00'] } },
    { name: 'יקבי גליל', businessId: '301234565', deliverySchedule: { mon: ['14:00'] } },
    { name: 'גבינות מירון', businessId: '301234566', deliverySchedule: { wed: ['10:00'] } },
    { name: 'תבלינים פרשמן', businessId: '301234567', deliverySchedule: { mon: ['12:00'] } },
    { name: 'חד״פ מהיר', businessId: '301234568', deliverySchedule: { thu: ['16:00'] } },
    { name: 'משקאות שטיינברג', businessId: '301234569', deliverySchedule: { wed: ['11:30'] } },
    { name: 'מלון בן-עמי', businessId: '301234570', deliverySchedule: { sun: ['13:00'] } },
  ];
  const insertedSuppliers = await db
    .insert(suppliers)
    .values(
      supplierSpecs.map((s) => ({
        restaurantId: restaurant.id,
        name: s.name,
        businessId: s.businessId,
        deliverySchedule: s.deliverySchedule,
      })),
    )
    .returning();

  console.log('[seed] products');
  const productSpecs: Array<{ name: string; category: string; unit: string }> = [
    // ירקות
    { name: 'עגבניה שרי', category: 'ירקות', unit: 'ק״ג' },
    { name: 'מלפפון חממה', category: 'ירקות', unit: 'ק״ג' },
    { name: 'חסה אייסברג', category: 'ירקות', unit: 'יח׳' },
    { name: 'פטרוזיליה', category: 'ירקות', unit: 'צרור' },
    { name: 'כוסברה', category: 'ירקות', unit: 'צרור' },
    { name: 'בצל יבש', category: 'ירקות', unit: 'ק״ג' },
    { name: 'שום קלוף', category: 'ירקות', unit: 'ק״ג' },
    { name: 'גזר', category: 'ירקות', unit: 'ק״ג' },
    { name: 'תפוח אדמה לבן', category: 'ירקות', unit: 'ק״ג' },
    { name: 'פלפל אדום', category: 'ירקות', unit: 'ק״ג' },
    // בשרים
    { name: 'אנטריקוט אנגוס', category: 'בשרים', unit: 'ק״ג' },
    { name: 'חזה עוף', category: 'בשרים', unit: 'ק״ג' },
    { name: 'כתף טלה', category: 'בשרים', unit: 'ק״ג' },
    { name: 'נקניקיות מרגז', category: 'בשרים', unit: 'ק״ג' },
    { name: 'המבורגר 200g', category: 'בשרים', unit: 'יח׳' },
    // לחמים
    { name: 'לחמניית המבורגר', category: 'לחמים', unit: 'יח׳' },
    { name: 'פיתה לבנה', category: 'לחמים', unit: 'יח׳' },
    { name: 'לחם כפרי', category: 'לחמים', unit: 'יח׳' },
    { name: 'באגט', category: 'לחמים', unit: 'יח׳' },
    // דגים
    { name: 'סלמון פילה טרי', category: 'דגים', unit: 'ק״ג' },
    { name: 'דניס שלם', category: 'דגים', unit: 'ק״ג' },
    { name: 'טונה אדומה', category: 'דגים', unit: 'ק״ג' },
    // אלכוהול
    { name: 'יין אדום קברנה', category: 'אלכוהול', unit: 'בקבוק' },
    { name: 'בירה גולדסטאר', category: 'אלכוהול', unit: 'בקבוק' },
    { name: 'וודקה', category: 'אלכוהול', unit: 'בקבוק' },
    // גבינות וחלב
    { name: 'מוצרלה', category: 'חלב', unit: 'ק״ג' },
    { name: 'פטה', category: 'חלב', unit: 'ק״ג' },
    { name: 'שמנת מתוקה 38%', category: 'חלב', unit: 'ליטר' },
    { name: 'חמאה', category: 'חלב', unit: 'ק״ג' },
    { name: 'חלב 3%', category: 'חלב', unit: 'ליטר' },
    // תבלינים
    { name: 'מלח ים גס', category: 'תבלינים', unit: 'ק״ג' },
    { name: 'פלפל שחור', category: 'תבלינים', unit: 'ק״ג' },
    { name: 'פפריקה מתוקה', category: 'תבלינים', unit: 'ק״ג' },
    { name: 'כמון', category: 'תבלינים', unit: 'ק״ג' },
    { name: 'אורגנו', category: 'תבלינים', unit: 'ק״ג' },
    // שמנים ורטבים
    { name: 'שמן זית כתית', category: 'שמנים', unit: 'ליטר' },
    { name: 'שמן קנולה', category: 'שמנים', unit: 'ליטר' },
    { name: 'חומץ בלסמי', category: 'שמנים', unit: 'בקבוק' },
    { name: 'רוטב סויה', category: 'שמנים', unit: 'בקבוק' },
    // יבשים
    { name: 'אורז יסמין', category: 'יבשים', unit: 'ק״ג' },
    { name: 'בורגול גס', category: 'יבשים', unit: 'ק״ג' },
    { name: 'עדשים שחורות', category: 'יבשים', unit: 'ק״ג' },
    { name: 'קמח לבן', category: 'יבשים', unit: 'ק״ג' },
    { name: 'סוכר לבן', category: 'יבשים', unit: 'ק״ג' },
    // משקאות
    { name: 'קולה זירו', category: 'משקאות', unit: 'בקבוק' },
    { name: 'מים מינרליים 1.5L', category: 'משקאות', unit: 'בקבוק' },
    { name: 'מיץ תפוזים סחוט', category: 'משקאות', unit: 'ליטר' },
    // חד״פ
    { name: 'מפיות נייר', category: 'חד״פ', unit: 'חבילה' },
    { name: 'כפיות פלסטיק', category: 'חד״פ', unit: 'חבילה' },
    { name: 'קופסאות take-away', category: 'חד״פ', unit: 'חבילה' },
  ];
  const insertedProducts = await db
    .insert(products)
    .values(
      productSpecs.map((p) => ({
        restaurantId: restaurant.id,
        canonicalName: p.name,
        category: p.category,
        defaultUnit: p.unit,
      })),
    )
    .returning();

  console.log('[seed] purchase orders');
  // 20 POs spread across the last 60 days, across multiple suppliers
  const now = new Date();
  const poInserts: Array<{
    poId: string;
    lines: Array<{ productId: string; qty: number; unit: string; price: number }>;
  }> = [];
  for (let i = 0; i < 20; i += 1) {
    const supplier = insertedSuppliers[i % insertedSuppliers.length]!;
    const expectedDeliveryAt = new Date(now.getTime() - (60 - i * 3) * 24 * 3600 * 1000);
    const [po] = await db
      .insert(purchaseOrders)
      .values({
        restaurantId: restaurant.id,
        supplierId: supplier.id,
        expectedDeliveryAt,
        status: i < 17 ? 'closed' : 'sent',
        source: 'manual',
        totalEstimated: null,
        createdBy: insertedUsers[0]!.id,
      })
      .returning();
    if (!po) continue;

    // 3-6 line items per PO
    const lineCount = 3 + (i % 4);
    const linesToInsert = Array.from({ length: lineCount }).map((_, j) => {
      const product = insertedProducts[(i * 3 + j) % insertedProducts.length]!;
      const qty = (j + 1) * 2 + (i % 5);
      const price = 5 + ((i + j) % 10) + Math.random() * 3;
      return {
        poId: po.id,
        productId: product.id,
        qtyOrdered: qty.toString(),
        unit: product.defaultUnit ?? 'יח׳',
        unitPriceExpected: price.toFixed(2),
        rawDescription: product.canonicalName,
      };
    });
    await db.insert(poLines).values(linesToInsert);
    poInserts.push({
      poId: po.id,
      lines: linesToInsert.map((l) => ({
        productId: l.productId,
        qty: parseFloat(l.qtyOrdered),
        unit: l.unit,
        price: parseFloat(l.unitPriceExpected),
      })),
    });
  }

  console.log(`[seed] done — restaurant ${restaurant.id}`);
  console.log(`  users: ${insertedUsers.length}`);
  console.log(`  suppliers: ${insertedSuppliers.length}`);
  console.log(`  products: ${insertedProducts.length}`);
  console.log(`  POs: ${poInserts.length}`);

  process.exit(0);
}

main().catch((err) => {
  console.error('[seed] failed', err);
  process.exit(1);
});
