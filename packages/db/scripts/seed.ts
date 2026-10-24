/**
 * Demo/dev base seed: one Israeli restaurant ("כפר הזיתים"), its team, ten
 * suppliers, ~55 products (Hebrew + English names for "Receiver in English"),
 * purchase orders back to the 1st of the month three months before today on each
 * supplier's real delivery cadence, three
 * POs expected TODAY (ready to receive live) and two for the coming days.
 *
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5432/restomatch_dev pnpm --filter @restomatch/db seed
 *   … then: pnpm --filter @restomatch/worker exec tsx scripts/seed-demo.ts   (receipts, invoices, matching)
 *
 * Env:
 *   DEMO_PASSWORD  password for every seeded user (default below; documented in docs/DB-RUNBOOK.md §7)
 *   DEMO_TODAY     YYYY-MM-DD to treat as "today" (default: today in Asia/Jerusalem) —
 *                  seed the evening before a demo with tomorrow's date
 *
 *   SEED_SCOPE     unset → ⛔ DELETES every restaurant, user and their data (TRUNCATE … CASCADE).
 *                  'demo' → deletes ONLY the demo tenants (src/demoTenants.ts: refuses if they are
 *                  mixed with real data) and leaves every other tenant untouched — what the
 *                  production reseed uses (docs/client-ready/RESEED-PROD.md).
 *   DEMO_PLATFORM_ADMIN  '1' makes the demo owner a platform admin (/admin). Default: yes on a
 *                  local DB, NO on a remote one — on a real project /admin shows every tenant.
 *
 * Refuses any non-local database unless SEED_ALLOW_REMOTE_HOST names it (src/seedGuard.ts).
 */
import { hashPassword } from '@restomatch/crypto';
import postgres from 'postgres';
import { createDb } from '../src/client';
import { PLAN_SEED_LIST } from '../src/plans';
import {
  catalogImports,
  memberships,
  plans,
  poLines,
  productAliases,
  products,
  purchaseOrders,
  supplierCatalogItems,
  restaurants,
  suppliers,
  userCredentials,
  users,
  type DeliverySchedule,
  type RestaurantSettings,
} from '../src/schema';
import { deleteDemoTenants } from '../src/demoTenants';
import { assertSeedTarget, isLocalDbUrl } from '../src/seedGuard';

export const DEFAULT_DEMO_PASSWORD = 'RestoMatch-Demo-2026!';
const TZ = 'Asia/Jerusalem';
const HISTORY_WEEKS = 8;
/**
 * Months of FULL history before DEMO_TODAY's month (so "last month vs the month
 * before" compares two real months). Deliveries older than HISTORY_WEEKS get
 * negative ordinals: every PO inside the 8-week window keeps the exact ordinal —
 * so the same quantities and prices — it always had (the quoted October hero).
 */
const FULL_HISTORY_MONTHS = 3;

/* ── time helpers (restaurant wall clock → UTC instant) ─────────────────── */

function tzOffsetMs(at: Date, tz: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!);
  return asUtc - at.getTime();
}

/** The UTC instant of `HH:MM` on local date `ymd` (YYYY-MM-DD) in `tz`. */
export function zonedInstant(ymd: string, hhmm: string, tz = TZ): Date {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const [hh, mm] = hhmm.split(':').map(Number) as [number, number];
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  return new Date(guess.getTime() - tzOffsetMs(guess, tz));
}

export function localYmd(at: Date, tz = TZ): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Days from the 1st of the month `months` before `ymd`'s month up to `ymd`. */
function daysSinceMonthStart(ymd: string, months: number): number {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, m - 1 - months, 1)) / 86_400_000);
}

/** Pattern lookup that also accepts the negative ordinals of the extended history. */
const at = <T,>(arr: readonly T[], i: number): T => arr[((i % arr.length) + arr.length) % arr.length]!;

function weekday(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
}

/* ── catalog ─────────────────────────────────────────────────────────────── */

interface SupplierSpec {
  key: string;
  name: string;
  nameEn: string;
  businessId: string;
  contactEmail: string;
  contactWhatsapp: string;
  paymentTerms: string;
  /** Delivery weekdays (0 = Sunday) and every-N-weeks cadence. */
  days: number[];
  everyWeeks: number;
  time: string;
}

const SUPPLIERS: SupplierSpec[] = [
  { key: 'veg', name: 'ירקות השרון', nameEn: 'HaSharon Produce', businessId: '514200101', contactEmail: 'orders@sharon-produce.test', contactWhatsapp: '+972521110101', paymentTerms: 'שוטף + 30', days: [0, 2, 4], everyWeeks: 1, time: '07:30' },
  { key: 'meat', name: 'קצביית הכרם', nameEn: 'HaKerem Butchery', businessId: '514200102', contactEmail: 'office@hakerem-meat.test', contactWhatsapp: '+972521110102', paymentTerms: 'שוטף + 45', days: [1], everyWeeks: 1, time: '09:30' },
  { key: 'bakery', name: 'מאפיית ברנר', nameEn: "Brenner's Bakery", businessId: '514200103', contactEmail: 'bakery@brenner.test', contactWhatsapp: '+972521110103', paymentTerms: 'שוטף + 30', days: [0, 2, 4], everyWeeks: 1, time: '06:00' },
  { key: 'fish', name: 'דגי הים התיכון', nameEn: 'Mediterranean Fish Co.', businessId: '514200104', contactEmail: 'sales@medfish.test', contactWhatsapp: '+972521110104', paymentTerms: 'שוטף + 30', days: [2], everyWeeks: 1, time: '11:00' },
  { key: 'dairy', name: 'מחלבות הגליל', nameEn: 'Galilee Dairies', businessId: '514200105', contactEmail: 'orders@galil-dairy.test', contactWhatsapp: '+972521110105', paymentTerms: 'שוטף + 60', days: [3], everyWeeks: 1, time: '10:00' },
  { key: 'spices', name: 'תבליני פרשמן', nameEn: 'Fresman Spices & Oils', businessId: '514200106', contactEmail: 'info@fresman.test', contactWhatsapp: '+972521110106', paymentTerms: 'שוטף + 30', days: [1], everyWeeks: 2, time: '12:00' },
  { key: 'drinks', name: 'משקאות שטיינברג', nameEn: 'Steinberg Beverages', businessId: '514200107', contactEmail: 'orders@steinberg-bev.test', contactWhatsapp: '+972521110107', paymentTerms: 'שוטף + 45', days: [3], everyWeeks: 1, time: '11:30' },
  { key: 'dry', name: 'יבשים בן-עמי', nameEn: 'Ben-Ami Dry Goods', businessId: '514200108', contactEmail: 'office@benami.test', contactWhatsapp: '+972521110108', paymentTerms: 'שוטף + 30', days: [0], everyWeeks: 2, time: '13:00' },
  { key: 'disposables', name: 'חד״פ מהיר', nameEn: 'Quick Disposables', businessId: '514200109', contactEmail: 'sales@quickdisp.test', contactWhatsapp: '+972521110109', paymentTerms: 'מזומן', days: [4], everyWeeks: 2, time: '15:00' },
  { key: 'cleaning', name: 'עמית חומרי ניקוי', nameEn: 'Amit Cleaning Supplies', businessId: '514200110', contactEmail: 'amit@cleaning.test', contactWhatsapp: '+972521110110', paymentTerms: 'שוטף + 30', days: [1], everyWeeks: 4, time: '14:00' },
];

interface ProductSpec {
  supplier: string;
  name: string;
  nameEn: string;
  category: string;
  unit: string;
  /** Agreed list price, ₪ excl. VAT per unit. */
  price: number;
  /** Typical quantity per delivery. */
  qty: number;
}

export const DEMO_PRODUCTS: ProductSpec[] = [
  // ירקות — HaSharon Produce
  { supplier: 'veg', name: 'עגבניות שרי', nameEn: 'Cherry tomatoes', category: 'ירקות', unit: 'ק״ג', price: 12.9, qty: 12 },
  { supplier: 'veg', name: 'מלפפונים', nameEn: 'Cucumbers', category: 'ירקות', unit: 'ק״ג', price: 5.9, qty: 15 },
  { supplier: 'veg', name: 'חסה ערבית', nameEn: 'Romaine lettuce', category: 'ירקות', unit: 'יח׳', price: 4.5, qty: 20 },
  { supplier: 'veg', name: 'פטרוזיליה', nameEn: 'Parsley', category: 'ירקות', unit: 'צרור', price: 3, qty: 15 },
  { supplier: 'veg', name: 'כוסברה', nameEn: 'Coriander', category: 'ירקות', unit: 'צרור', price: 3, qty: 10 },
  { supplier: 'veg', name: 'בצל יבש', nameEn: 'Onions', category: 'ירקות', unit: 'ק״ג', price: 3.9, qty: 20 },
  { supplier: 'veg', name: 'שום קלוף', nameEn: 'Peeled garlic', category: 'ירקות', unit: 'ק״ג', price: 28, qty: 2 },
  { supplier: 'veg', name: 'לימונים', nameEn: 'Lemons', category: 'ירקות', unit: 'ק״ג', price: 7.9, qty: 8 },
  { supplier: 'veg', name: 'תפוחי אדמה', nameEn: 'Potatoes', category: 'ירקות', unit: 'ק״ג', price: 4.2, qty: 25 },
  { supplier: 'veg', name: 'פלפל אדום', nameEn: 'Red bell peppers', category: 'ירקות', unit: 'ק״ג', price: 9.9, qty: 8 },
  { supplier: 'veg', name: 'חצילים', nameEn: 'Eggplants', category: 'ירקות', unit: 'ק״ג', price: 5.5, qty: 10 },
  // בשר — HaKerem Butchery
  { supplier: 'meat', name: 'אנטריקוט', nameEn: 'Entrecôte (rib-eye)', category: 'בשר', unit: 'ק״ג', price: 139, qty: 8 },
  { supplier: 'meat', name: 'חזה עוף', nameEn: 'Chicken breast', category: 'בשר', unit: 'ק״ג', price: 38.9, qty: 15 },
  { supplier: 'meat', name: 'פרגית', nameEn: 'Boneless chicken thighs', category: 'בשר', unit: 'ק״ג', price: 44.9, qty: 12 },
  { supplier: 'meat', name: 'כתף טלה', nameEn: 'Lamb shoulder', category: 'בשר', unit: 'ק״ג', price: 89, qty: 5 },
  { supplier: 'meat', name: 'בשר טחון', nameEn: 'Ground beef', category: 'בשר', unit: 'ק״ג', price: 59.9, qty: 10 },
  { supplier: 'meat', name: 'נקניקיות מרגז', nameEn: 'Merguez sausages', category: 'בשר', unit: 'ק״ג', price: 64, qty: 4 },
  // מאפים — Brenner's Bakery
  { supplier: 'bakery', name: 'לחמניות המבורגר', nameEn: 'Burger buns', category: 'מאפים', unit: 'יח׳', price: 2.4, qty: 60 },
  { supplier: 'bakery', name: 'פיתות', nameEn: 'Pita bread', category: 'מאפים', unit: 'יח׳', price: 0.9, qty: 120 },
  { supplier: 'bakery', name: 'לחם מחמצת', nameEn: 'Sourdough loaf', category: 'מאפים', unit: 'יח׳', price: 16, qty: 10 },
  { supplier: 'bakery', name: 'באגט', nameEn: 'Baguette', category: 'מאפים', unit: 'יח׳', price: 6.5, qty: 15 },
  { supplier: 'bakery', name: 'חלה', nameEn: 'Challah', category: 'מאפים', unit: 'יח׳', price: 12, qty: 0 }, // not ordered routinely
  // דגים — Mediterranean Fish Co.
  { supplier: 'fish', name: 'פילה סלמון', nameEn: 'Salmon fillet', category: 'דגים', unit: 'ק״ג', price: 89, qty: 6 },
  { supplier: 'fish', name: 'דניס שלם', nameEn: 'Whole sea bream', category: 'דגים', unit: 'ק״ג', price: 62, qty: 8 },
  { supplier: 'fish', name: 'טונה אדומה', nameEn: 'Red tuna', category: 'דגים', unit: 'ק״ג', price: 145, qty: 2 },
  { supplier: 'fish', name: 'קלמרי', nameEn: 'Calamari', category: 'דגים', unit: 'ק״ג', price: 49, qty: 5 },
  // מוצרי חלב — Galilee Dairies
  { supplier: 'dairy', name: 'מוצרלה', nameEn: 'Mozzarella', category: 'מוצרי חלב', unit: 'ק״ג', price: 42, qty: 6 },
  { supplier: 'dairy', name: 'גבינה בולגרית', nameEn: 'Bulgarian cheese', category: 'מוצרי חלב', unit: 'ק״ג', price: 38, qty: 4 },
  { supplier: 'dairy', name: 'שמנת מתוקה 38%', nameEn: 'Heavy cream 38%', category: 'מוצרי חלב', unit: 'ליטר', price: 16.5, qty: 10 },
  { supplier: 'dairy', name: 'חמאה', nameEn: 'Butter', category: 'מוצרי חלב', unit: 'ק״ג', price: 46, qty: 4 },
  { supplier: 'dairy', name: 'חלב 3%', nameEn: 'Milk 3%', category: 'מוצרי חלב', unit: 'ליטר', price: 6.4, qty: 30 },
  { supplier: 'dairy', name: 'לבנה', nameEn: 'Labneh', category: 'מוצרי חלב', unit: 'ק״ג', price: 24, qty: 4 },
  { supplier: 'dairy', name: 'ביצים L (תבנית 30)', nameEn: 'Eggs L (tray of 30)', category: 'מוצרי חלב', unit: 'תבנית', price: 34, qty: 6 },
  // תבלינים ושמנים — Fresman
  { supplier: 'spices', name: 'שמן זית כתית מעולה', nameEn: 'Extra virgin olive oil', category: 'שמנים ותבלינים', unit: 'ליטר', price: 34, qty: 10 },
  { supplier: 'spices', name: 'שמן קנולה', nameEn: 'Canola oil', category: 'שמנים ותבלינים', unit: 'ליטר', price: 9.5, qty: 20 },
  { supplier: 'spices', name: 'טחינה גולמית', nameEn: 'Raw tahini', category: 'שמנים ותבלינים', unit: 'ק״ג', price: 24, qty: 6 },
  { supplier: 'spices', name: 'מלח ים גס', nameEn: 'Coarse sea salt', category: 'שמנים ותבלינים', unit: 'ק״ג', price: 6, qty: 5 },
  { supplier: 'spices', name: 'פלפל שחור גרוס', nameEn: 'Cracked black pepper', category: 'שמנים ותבלינים', unit: 'ק״ג', price: 68, qty: 1 },
  { supplier: 'spices', name: 'פפריקה מתוקה', nameEn: 'Sweet paprika', category: 'שמנים ותבלינים', unit: 'ק״ג', price: 42, qty: 1 },
  { supplier: 'spices', name: 'כמון טחון', nameEn: 'Ground cumin', category: 'שמנים ותבלינים', unit: 'ק״ג', price: 48, qty: 1 },
  { supplier: 'spices', name: 'סומק', nameEn: 'Sumac', category: 'שמנים ותבלינים', unit: 'ק״ג', price: 55, qty: 1 },
  // משקאות — Steinberg Beverages
  { supplier: 'drinks', name: 'קולה זירו 330 מ״ל (ארגז 24)', nameEn: 'Cola Zero 330ml (case of 24)', category: 'משקאות', unit: 'ארגז', price: 62, qty: 4 },
  { supplier: 'drinks', name: 'מים מינרליים 1.5 ל׳ (שישייה)', nameEn: 'Mineral water 1.5L (6-pack)', category: 'משקאות', unit: 'שישייה', price: 13.5, qty: 10 },
  { supplier: 'drinks', name: 'בירה מהחבית — חבית 30 ל׳', nameEn: 'Draft beer keg 30L', category: 'משקאות', unit: 'חבית', price: 520, qty: 2 },
  { supplier: 'drinks', name: 'יין אדום קברנה', nameEn: 'Cabernet red wine', category: 'משקאות', unit: 'בקבוק', price: 48, qty: 12 },
  { supplier: 'drinks', name: 'מיץ תפוזים סחוט', nameEn: 'Fresh orange juice', category: 'משקאות', unit: 'ליטר', price: 14, qty: 10 },
  // יבשים — Ben-Ami
  { supplier: 'dry', name: 'אורז יסמין', nameEn: 'Jasmine rice', category: 'יבשים', unit: 'ק״ג', price: 9.8, qty: 25 },
  { supplier: 'dry', name: 'בורגול גס', nameEn: 'Coarse bulgur', category: 'יבשים', unit: 'ק״ג', price: 8.5, qty: 10 },
  { supplier: 'dry', name: 'קמח לבן', nameEn: 'White flour', category: 'יבשים', unit: 'ק״ג', price: 4.9, qty: 25 },
  { supplier: 'dry', name: 'סוכר לבן', nameEn: 'White sugar', category: 'יבשים', unit: 'ק״ג', price: 5.2, qty: 10 },
  { supplier: 'dry', name: 'חומוס יבש', nameEn: 'Dried chickpeas', category: 'יבשים', unit: 'ק״ג', price: 9, qty: 15 },
  // חד״פ — Quick Disposables
  { supplier: 'disposables', name: 'מפיות נייר (חבילה)', nameEn: 'Paper napkins (pack)', category: 'חד״פ', unit: 'חבילה', price: 18, qty: 10 },
  { supplier: 'disposables', name: 'קופסאות טייק-אוויי', nameEn: 'Take-away boxes (pack of 50)', category: 'חד״פ', unit: 'חבילה', price: 39, qty: 6 },
  { supplier: 'disposables', name: 'כפפות ניטריל (קופסה)', nameEn: 'Nitrile gloves (box)', category: 'חד״פ', unit: 'קופסה', price: 28, qty: 6 },
  // ניקיון — Amit
  { supplier: 'cleaning', name: 'נוזל כלים 4 ל׳', nameEn: 'Dish soap 4L', category: 'ניקיון', unit: 'יח׳', price: 32, qty: 4 },
  { supplier: 'cleaning', name: 'אקונומיקה 4 ל׳', nameEn: 'Bleach 4L', category: 'ניקיון', unit: 'יח׳', price: 18, qty: 4 },
];

/** Deterministic per-delivery quantity swing (keeps the data lively but repeatable). */
const QTY_PATTERN = [1, 1.25, 0.8, 1, 1.15, 0.9];
/** PO price stays within ±0.5% of the list price — inside the 2% / ₪5 tolerance. */
const PRICE_PATTERN = [1, 1.005, 0.995, 1];

function roundQty(q: number, unit: string): number {
  return unit === 'ק״ג' || unit === 'ליטר' ? Math.max(0.5, Math.round(q * 2) / 2) : Math.max(1, Math.round(q));
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  assertSeedTarget(url, 'seed');
  const today = process.env.DEMO_TODAY?.trim() || localYmd(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error(`[seed] DEMO_TODAY must be YYYY-MM-DD, got ${today}`);
  const password = process.env.DEMO_PASSWORD?.trim() || DEFAULT_DEMO_PASSWORD;
  const scope = process.env.SEED_SCOPE?.trim();
  if (scope && scope !== 'demo') throw new Error(`[seed] SEED_SCOPE must be 'demo' or unset, got ${scope}`);
  const demoOnly = scope === 'demo';
  if (!demoOnly && !isLocalDbUrl(url)) {
    throw new Error('[seed] refusing a FULL wipe (TRUNCATE every tenant) on a non-local database — use SEED_SCOPE=demo (docs/client-ready/RESEED-PROD.md)');
  }
  const platformAdmin = process.env.DEMO_PLATFORM_ADMIN ? process.env.DEMO_PLATFORM_ADMIN === '1' : isLocalDbUrl(url);

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

  const raw = postgres(url, { max: 1, prepare: false, onnotice: () => undefined });
  if (demoOnly) {
    const { tenants, removed } = await deleteDemoTenants(raw);
    console.log(`[seed] demo-only: removed ${tenants.restaurants.length} demo restaurant(s), ${tenants.userIds.length} demo user(s) — ${JSON.stringify(removed)}`);
  } else {
    console.log('[seed] clearing every restaurant + user (TRUNCATE … CASCADE)');
    await raw.unsafe('TRUNCATE restaurants, users RESTART IDENTITY CASCADE');
  }
  await raw.end();

  console.log('[seed] restaurant');
  const [restaurant] = await db
    .insert(restaurants)
    .values({
      name: 'כפר הזיתים',
      businessId: '514778123',
      vatRate: '0.18',
      timezone: TZ,
      settings: {
        tolerances: { pricePercent: 0.02, priceAbsolute: 5, qtyPercent: 0.03, qtyAbsolute: 1 },
        baselineWindowDays: 90,
        // The demo tenant shows every flagged feature (packages/api/src/lib/features.ts).
        features: { all: true },
      } as RestaurantSettings,
    })
    .returning();
  if (!restaurant) throw new Error('restaurant insert failed');

  console.log('[seed] users (email-verified, demo password) + memberships');
  const userSpecs = [
    { email: 'owner@kfar-hazeitim.test', name: 'רון אלמוג', role: 'owner' as const, locale: null },
    { email: 'manager@kfar-hazeitim.test', name: 'שני לוי', role: 'manager' as const, locale: null },
    // The "Receiver in English" persona: a foreign worker who checks deliveries.
    { email: 'receiver@kfar-hazeitim.test', name: 'Somchai K.', role: 'receiver' as const, locale: 'en' },
    { email: 'bookkeeper@kfar-hazeitim.test', name: 'אורית כהן', role: 'bookkeeper' as const, locale: null },
    { email: 'chef@kfar-hazeitim.test', name: 'תומר בן דוד', role: 'chef' as const, locale: null },
  ];
  const verifiedAt = new Date();
  const insertedUsers = await db
    .insert(users)
    .values(
      userSpecs.map((u) => ({
        email: u.email,
        name: u.name,
        emailVerified: verifiedAt,
        // The demo owner doubles as the platform operator so /admin is demo-able —
        // locally by default; on a real project only with DEMO_PLATFORM_ADMIN=1.
        isPlatformAdmin: platformAdmin && u.role === 'owner',
      })),
    )
    .returning();
  const passwordHash = await hashPassword(password);
  await db.insert(userCredentials).values(
    insertedUsers.map((u) => ({ userId: u.id, passwordHash, passwordUpdatedAt: verifiedAt })),
  );
  await db.insert(memberships).values(
    insertedUsers.map((u, i) => ({
      userId: u.id,
      restaurantId: restaurant.id,
      role: userSpecs[i]!.role,
      preferredLocale: userSpecs[i]!.locale,
    })),
  );

  console.log('[seed] suppliers');
  const dayKey = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
  const insertedSuppliers = await db
    .insert(suppliers)
    .values(
      SUPPLIERS.map((s) => ({
        restaurantId: restaurant.id,
        name: s.name,
        nameEn: s.nameEn,
        businessId: s.businessId,
        contactEmail: s.contactEmail,
        contactWhatsapp: s.contactWhatsapp,
        paymentTerms: s.paymentTerms,
        vatRate: null,
        deliverySchedule: Object.fromEntries(s.days.map((d) => [dayKey[d], [s.time]])) as DeliverySchedule,
      })),
    )
    .returning();
  const supplierByKey = new Map(SUPPLIERS.map((s, i) => [s.key, insertedSuppliers[i]!] as const));

  console.log('[seed] products');
  const insertedProducts = await db
    .insert(products)
    .values(
      DEMO_PRODUCTS.map((p) => ({
        restaurantId: restaurant.id,
        canonicalName: p.name,
        nameEn: p.nameEn,
        category: p.category,
        defaultUnit: p.unit,
        supplierId: supplierByKey.get(p.supplier)!.id,
      })),
    )
    .returning();
  const productRows = DEMO_PRODUCTS.map((spec, i) => ({ spec, row: insertedProducts[i]! }));

  // Supplier price lists — written to the same tables the catalog import
  // (packages/api/src/catalog/commit.ts) commits to: one committed
  // catalog_imports row per supplier, its supplier_catalog_items linked to the
  // product, and the supplier-name → product alias the OCR matcher learns from.
  console.log('[seed] supplier price lists (catalog)');
  const SKU_PREFIX: Record<string, string> = {
    veg: 'SH', meat: 'HK', bakery: 'BR', fish: 'MF', dairy: 'GD',
    spices: 'FS', drinks: 'ST', dry: 'BA', disposables: 'QD', cleaning: 'AC',
  };
  const skuByProductId = new Map<string, string>();
  const priceListDate = zonedInstant(addDays(today, -60), '09:00');
  let catalogItems = 0;
  for (const s of SUPPLIERS) {
    const supplier = supplierByKey.get(s.key)!;
    const items = productRows.filter((p) => p.spec.supplier === s.key);
    const [imp] = await db
      .insert(catalogImports)
      .values({
        restaurantId: restaurant.id,
        supplierId: supplier.id,
        filename: `מחירון ${s.name} 2026.xlsx`,
        status: 'committed',
        rowCount: items.length,
        createdItems: items.length,
        updatedItems: 0,
        columnMapping: { sku: 'מק״ט', name: 'תיאור פריט', unit: 'יחידה', price: 'מחיר ליחידה' },
        createdBy: insertedUsers[0]!.id,
        createdAt: priceListDate,
      })
      .returning();
    const rows = items.map((p, j) => {
      const sku = `${SKU_PREFIX[s.key] ?? 'XX'}-${1001 + j}`;
      skuByProductId.set(p.row.id, sku);
      return {
        restaurantId: restaurant.id,
        supplierId: supplier.id,
        productId: p.row.id,
        supplierSku: sku,
        supplierNameRaw: p.spec.name,
        unit: p.spec.unit,
        packSize: '1',
        listPrice: p.spec.price.toFixed(2),
        currency: 'ILS',
        active: true,
        sourceImportId: imp!.id,
        observedAt: priceListDate,
        createdAt: priceListDate,
        updatedAt: priceListDate,
      };
    });
    await db.insert(supplierCatalogItems).values(rows);
    await db.insert(productAliases).values(
      rows.map((r) => ({
        productId: r.productId,
        supplierId: r.supplierId,
        supplierSku: r.supplierSku,
        supplierNameRaw: r.supplierNameRaw,
        confidence: '1.000',
      })),
    );
    catalogItems += rows.length;
  }

  console.log(`[seed] purchase orders (history from the 1st of ${FULL_HISTORY_MONTHS} months back, today = ${today})`);
  const owner = insertedUsers[0]!;
  const manager = insertedUsers[1]!;
  let poCount = 0;
  let lineCount = 0;
  const createPo = async (
    s: SupplierSpec,
    ymd: string,
    time: string,
    status: 'closed' | 'sent',
    ordinal: number,
  ): Promise<void> => {
    const supplier = supplierByKey.get(s.key)!;
    const basket = productRows.filter((p) => p.spec.supplier === s.key && p.spec.qty > 0);
    const expectedDeliveryAt = zonedInstant(ymd, time);
    // Ordered the day before delivery — but never after DEMO_TODAY 09:00 (wall clock):
    // a PO for the coming days must not show a future "created / sent" date.
    const orderedAt = new Date(Math.min(expectedDeliveryAt.getTime() - 24 * 3600 * 1000, zonedInstant(today, '09:00').getTime()));
    const lines = basket.map((p, j) => {
      const qty = roundQty(p.spec.qty * at(QTY_PATTERN, ordinal + j), p.spec.unit);
      const price = Math.round(p.spec.price * at(PRICE_PATTERN, ordinal + j) * 100) / 100;
      return { p, qty, price };
    });
    const total = lines.reduce((acc, l) => acc + Math.round(l.qty * l.price * 100), 0) / 100;
    const [po] = await db
      .insert(purchaseOrders)
      .values({
        restaurantId: restaurant.id,
        supplierId: supplier.id,
        expectedDeliveryAt,
        status,
        source: 'manual',
        totalEstimated: total.toFixed(2),
        createdBy: ordinal % 2 === 0 ? manager.id : owner.id,
        sentAt: orderedAt,
        sentChannel: s.key === 'veg' || s.key === 'bakery' ? 'whatsapp' : 'email',
        createdAt: orderedAt,
        updatedAt: status === 'closed' ? expectedDeliveryAt : orderedAt,
      })
      .returning();
    await db.insert(poLines).values(
      lines.map((l) => ({
        poId: po!.id,
        productId: l.p.row.id,
        rawDescription: l.p.spec.name,
        rawDescriptionEn: l.p.spec.nameEn,
        supplierSku: skuByProductId.get(l.p.row.id) ?? null,
        qtyOrdered: l.qty.toString(),
        unit: l.p.spec.unit,
        unitPriceExpected: l.price.toFixed(2),
      })),
    );
    poCount += 1;
    lineCount += lines.length;
  };

  // Older history (the FULL_HISTORY_MONTHS before today's month, beyond the 8-week
  // window): same cadence, ordinals -m … -1 so the window below is unchanged.
  const fullDays = Math.max(HISTORY_WEEKS * 7, daysSinceMonthStart(today, FULL_HISTORY_MONTHS));
  const older: Array<{ s: (typeof SUPPLIERS)[number]; ymd: string }> = [];
  for (let back = fullDays; back > HISTORY_WEEKS * 7; back -= 1) {
    const ymd = addDays(today, -back);
    const week = Math.floor(back / 7);
    for (const s of SUPPLIERS) if (s.days.includes(weekday(ymd)) && week % s.everyWeeks === 0) older.push({ s, ymd });
  }
  const olderLeft = new Map<string, number>();
  for (const o of older) olderLeft.set(o.s.key, (olderLeft.get(o.s.key) ?? 0) + 1);
  for (const o of older) {
    const left = olderLeft.get(o.s.key)!;
    olderLeft.set(o.s.key, left - 1);
    await createPo(o.s, o.ymd, o.s.time, 'closed', -left);
  }

  // History: every scheduled delivery day in the last HISTORY_WEEKS weeks, up to yesterday.
  const ordinals = new Map<string, number>();
  for (let back = HISTORY_WEEKS * 7; back >= 1; back -= 1) {
    const ymd = addDays(today, -back);
    const week = Math.floor(back / 7);
    for (const s of SUPPLIERS) {
      if (!s.days.includes(weekday(ymd)) || week % s.everyWeeks !== 0) continue;
      const n = ordinals.get(s.key) ?? 0;
      ordinals.set(s.key, n + 1);
      await createPo(s, ymd, s.time, 'closed', n);
    }
  }

  // TODAY: three open deliveries the receiver can check live (spread over the day).
  const todays: Array<[string, string]> = [
    ['veg', '10:00'],
    ['meat', '12:30'],
    ['dairy', '15:00'],
  ];
  for (const [key, time] of todays) {
    const s = SUPPLIERS.find((x) => x.key === key)!;
    await createPo(s, today, time, 'sent', (ordinals.get(key) ?? 0) + 1);
  }
  // Coming days: shows the orders pipeline without cluttering today's inbox.
  await createPo(SUPPLIERS.find((x) => x.key === 'fish')!, addDays(today, 1), '11:00', 'sent', 99);
  await createPo(SUPPLIERS.find((x) => x.key === 'drinks')!, addDays(today, 2), '11:30', 'sent', 98);

  console.log(`[seed] done — restaurant ${restaurant.id}`);
  console.log(`  users: ${insertedUsers.length} (password: ${process.env.DEMO_PASSWORD ? 'from DEMO_PASSWORD' : DEFAULT_DEMO_PASSWORD})`);
  console.log(`  suppliers: ${insertedSuppliers.length} · products: ${insertedProducts.length} · price-list items: ${catalogItems}`);
  console.log(`  POs: ${poCount} (${lineCount} lines) · ${todays.length} expected today (${today})`);

  await db.$client.end();
}

main().catch((err) => {
  console.error('[seed] failed', err instanceof Error ? err.message : err);
  process.exit(1);
});
