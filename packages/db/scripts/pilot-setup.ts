/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  RestoMatch — Concierge Pilot Setup
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Provisions ONE real pilot restaurant (the customer we onboard by hand for the
 * first pilot — no self-serve UI yet) from a small config object.
 *
 * Unlike `seed.ts` (which DELETES everything and rebuilds a demo tenant), this
 * script is PARAMETERIZED and IDEMPOTENT: it never wipes data and is safe to
 * re-run. Re-running picks up where it left off — existing rows are matched and
 * reused (restaurant by business id, users by email), and new rows are inserted
 * only when missing. Nothing is destroyed.
 *
 * It provisions, per the config:
 *   • the restaurant (name + business id + VAT rate, with sane default settings)
 *   • team members (users) and their memberships/roles
 *   • suppliers (with optional delivery schedule, contact details, business id)
 *   • the product catalog (canonical name + category + default unit)
 *   • optionally, a set of initial purchase orders (only with --with-pos)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  HOW TO RUN
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   1. Put the customer's data in a JSON file (see CONFIG below for the shape).
 *      A starter template lives next to this script:
 *          packages/db/scripts/pilot.example.json
 *      Copy it, fill in the real customer details, and keep the real file OUT of
 *      git (e.g. packages/db/scripts/pilot.local.json — gitignored).
 *
 *   2. Point DATABASE_URL at the target (the pilot's Supabase Postgres) and run
 *      from packages/db:
 *
 *          DATABASE_URL=postgres://... PILOT_CONFIG=./scripts/pilot.local.json \
 *            pnpm pilot:setup
 *
 *      To also seed the initial purchase orders from the config, add the flag:
 *
 *          DATABASE_URL=postgres://... PILOT_CONFIG=./scripts/pilot.local.json \
 *            pnpm pilot:setup -- --with-pos
 *
 *      If PILOT_CONFIG is omitted, the script falls back to the inline
 *      EXAMPLE_CONFIG below so you can smoke-test the flow without a file.
 *
 *   3. Re-run any time after editing the config — adding a supplier, a product,
 *      or a team member and re-running will insert only the new rows.
 *
 *   Notes:
 *     • This script ONLY inserts/updates. It never deletes. Removing an entry
 *       from the config does NOT remove it from the database (do that by hand).
 *     • Purchase orders are NOT idempotent by nature, so they are inserted only
 *       once: if the restaurant already has any PO, --with-pos is skipped.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { and, eq, sql } from 'drizzle-orm';

import { createDb, type Database } from '../src/client';
import {
  memberships,
  poLines,
  products,
  purchaseOrders,
  restaurants,
  suppliers,
  users,
  type DeliverySchedule,
  type RestaurantSettings,
  type UserRole,
} from '../src/schema';

/* ──────────────────────────────────────────────────────────────────────────
 * Config shape
 * ────────────────────────────────────────────────────────────────────────── */

interface PilotMember {
  email: string;
  name?: string;
  role: UserRole;
  phone?: string;
}

interface PilotSupplier {
  name: string;
  businessId?: string;
  contactEmail?: string;
  contactWhatsapp?: string;
  paymentTerms?: string;
  deliverySchedule?: DeliverySchedule;
}

interface PilotProduct {
  name: string;
  category?: string;
  unit?: string;
  barcodeEan?: string;
}

interface PilotPoLine {
  /** Matches PilotProduct.name within this config / restaurant catalog. */
  product: string;
  qty: number;
  unit?: string;
  unitPrice?: number;
}

interface PilotPurchaseOrder {
  /** Matches PilotSupplier.name within this config / restaurant suppliers. */
  supplier: string;
  /** ISO date or `YYYY-MM-DD`; defaults to now. */
  expectedDeliveryAt?: string;
  status?: 'draft' | 'sent' | 'confirmed' | 'partial' | 'closed' | 'cancelled';
  notes?: string;
  lines: PilotPoLine[];
}

export interface PilotConfig {
  restaurant: {
    name: string;
    businessId: string;
    /** Israeli VAT as a decimal, e.g. 0.18 for 18%. */
    vatRate: number;
    timezone?: string;
    settings?: RestaurantSettings;
  };
  members: PilotMember[];
  suppliers: PilotSupplier[];
  products: PilotProduct[];
  /** Optional initial POs; only applied with the --with-pos flag. */
  purchaseOrders?: PilotPurchaseOrder[];
}

/* ──────────────────────────────────────────────────────────────────────────
 * Inline fallback config (used when PILOT_CONFIG is not set). Replace with a
 * real JSON file for an actual pilot — see the header.
 * ────────────────────────────────────────────────────────────────────────── */

const EXAMPLE_CONFIG: PilotConfig = {
  restaurant: {
    name: 'מסעדת הפיילוט',
    businessId: '515000001',
    vatRate: 0.18,
    timezone: 'Asia/Jerusalem',
  },
  members: [
    { email: 'owner@pilot.example', name: 'בעל המסעדה', role: 'owner' },
    { email: 'manager@pilot.example', name: 'מנהל/ת', role: 'manager' },
    { email: 'receiver@pilot.example', name: 'מקבל סחורה', role: 'receiver' },
  ],
  suppliers: [
    { name: 'ירקן הפיילוט', businessId: '301000001', deliverySchedule: { sun: ['08:00'], wed: ['08:00'] } },
    { name: 'קצביית הפיילוט', businessId: '301000002', deliverySchedule: { mon: ['09:00'] } },
  ],
  products: [
    { name: 'עגבניה', category: 'ירקות', unit: 'ק״ג' },
    { name: 'מלפפון', category: 'ירקות', unit: 'ק״ג' },
    { name: 'חזה עוף', category: 'בשרים', unit: 'ק״ג' },
  ],
  purchaseOrders: [
    {
      supplier: 'ירקן הפיילוט',
      status: 'sent',
      lines: [
        { product: 'עגבניה', qty: 20, unitPrice: 7.5 },
        { product: 'מלפפון', qty: 15, unitPrice: 6.0 },
      ],
    },
  ],
};

/* ──────────────────────────────────────────────────────────────────────────
 * Default restaurant settings (mirrors seed.ts tolerances)
 * ────────────────────────────────────────────────────────────────────────── */

const DEFAULT_SETTINGS: RestaurantSettings = {
  tolerances: {
    pricePercent: 0.02,
    priceAbsolute: 5,
    qtyPercent: 0.03,
    qtyAbsolute: 1,
  },
  baselineWindowDays: 90,
};

/* ──────────────────────────────────────────────────────────────────────────
 * Idempotent upsert helpers
 * ────────────────────────────────────────────────────────────────────────── */

/** Restaurant: matched by business id; settings/vat/name refreshed on re-run. */
async function upsertRestaurant(db: Database, cfg: PilotConfig['restaurant']) {
  const settings = cfg.settings ?? DEFAULT_SETTINGS;
  const existing = cfg.businessId
    ? await db.query.restaurants.findFirst({
        where: eq(restaurants.businessId, cfg.businessId),
      })
    : await db.query.restaurants.findFirst({ where: eq(restaurants.name, cfg.name) });

  if (existing) {
    const [updated] = await db
      .update(restaurants)
      .set({
        name: cfg.name,
        vatRate: cfg.vatRate.toString(),
        timezone: cfg.timezone ?? 'Asia/Jerusalem',
        settings,
        updatedAt: new Date(),
      })
      .where(eq(restaurants.id, existing.id))
      .returning();
    return { row: updated!, created: false };
  }

  const [created] = await db
    .insert(restaurants)
    .values({
      name: cfg.name,
      businessId: cfg.businessId,
      vatRate: cfg.vatRate.toString(),
      timezone: cfg.timezone ?? 'Asia/Jerusalem',
      settings,
    })
    .returning();
  return { row: created!, created: true };
}

/** User: matched by email (unique). Name/phone backfilled if missing. */
async function upsertUser(db: Database, member: PilotMember) {
  const existing = await db.query.users.findFirst({
    where: eq(users.email, member.email),
  });
  if (existing) {
    if ((!existing.name && member.name) || (!existing.phone && member.phone)) {
      const [updated] = await db
        .update(users)
        .set({
          name: existing.name ?? member.name ?? null,
          phone: existing.phone ?? member.phone ?? null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, existing.id))
        .returning();
      return { row: updated!, created: false };
    }
    return { row: existing, created: false };
  }
  const [created] = await db
    .insert(users)
    .values({ email: member.email, name: member.name ?? null, phone: member.phone ?? null })
    .returning();
  return { row: created!, created: true };
}

/** Supplier: matched by (restaurantId, name). Contact/schedule refreshed. */
async function upsertSupplier(db: Database, restaurantId: string, s: PilotSupplier) {
  const existing = await db.query.suppliers.findFirst({
    where: and(eq(suppliers.restaurantId, restaurantId), eq(suppliers.name, s.name)),
  });
  if (existing) {
    const [updated] = await db
      .update(suppliers)
      .set({
        businessId: s.businessId ?? existing.businessId,
        contactEmail: s.contactEmail ?? existing.contactEmail,
        contactWhatsapp: s.contactWhatsapp ?? existing.contactWhatsapp,
        paymentTerms: s.paymentTerms ?? existing.paymentTerms,
        deliverySchedule: s.deliverySchedule ?? existing.deliverySchedule,
        updatedAt: new Date(),
      })
      .where(eq(suppliers.id, existing.id))
      .returning();
    return { row: updated!, created: false };
  }
  const [created] = await db
    .insert(suppliers)
    .values({
      restaurantId,
      name: s.name,
      businessId: s.businessId ?? null,
      contactEmail: s.contactEmail ?? null,
      contactWhatsapp: s.contactWhatsapp ?? null,
      paymentTerms: s.paymentTerms ?? null,
      deliverySchedule: s.deliverySchedule ?? null,
    })
    .returning();
  return { row: created!, created: true };
}

/** Product: matched by (restaurantId, canonicalName). Category/unit refreshed. */
async function upsertProduct(db: Database, restaurantId: string, p: PilotProduct) {
  const existing = await db.query.products.findFirst({
    where: and(eq(products.restaurantId, restaurantId), eq(products.canonicalName, p.name)),
  });
  if (existing) {
    const [updated] = await db
      .update(products)
      .set({
        category: p.category ?? existing.category,
        defaultUnit: p.unit ?? existing.defaultUnit,
        barcodeEan: p.barcodeEan ?? existing.barcodeEan,
        updatedAt: new Date(),
      })
      .where(eq(products.id, existing.id))
      .returning();
    return { row: updated!, created: false };
  }
  const [created] = await db
    .insert(products)
    .values({
      restaurantId,
      canonicalName: p.name,
      category: p.category ?? null,
      defaultUnit: p.unit ?? null,
      barcodeEan: p.barcodeEan ?? null,
    })
    .returning();
  return { row: created!, created: true };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Config loading
 * ────────────────────────────────────────────────────────────────────────── */

function loadConfig(): PilotConfig {
  const path = process.env.PILOT_CONFIG;
  if (!path) {
    console.log('[pilot] PILOT_CONFIG not set — using inline EXAMPLE_CONFIG');
    return EXAMPLE_CONFIG;
  }
  const abs = resolve(process.cwd(), path);
  console.log(`[pilot] loading config from ${abs}`);
  const parsed = JSON.parse(readFileSync(abs, 'utf8')) as PilotConfig;
  validateConfig(parsed);
  return parsed;
}

const VALID_ROLES: UserRole[] = ['owner', 'manager', 'receiver', 'bookkeeper', 'chef'];

function validateConfig(cfg: PilotConfig): void {
  if (!cfg.restaurant?.name) throw new Error('config.restaurant.name is required');
  if (!cfg.restaurant?.businessId) throw new Error('config.restaurant.businessId is required');
  if (typeof cfg.restaurant?.vatRate !== 'number') {
    throw new Error('config.restaurant.vatRate is required (decimal, e.g. 0.18)');
  }
  for (const m of cfg.members ?? []) {
    if (!m.email) throw new Error('every member needs an email');
    if (!VALID_ROLES.includes(m.role)) {
      throw new Error(`member ${m.email} has invalid role "${m.role}" (valid: ${VALID_ROLES.join(', ')})`);
    }
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Main
 * ────────────────────────────────────────────────────────────────────────── */

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const withPos = process.argv.includes('--with-pos');

  const cfg = loadConfig();
  const db = createDb(url);

  // 1) Restaurant
  const { row: restaurant, created: rCreated } = await upsertRestaurant(db, cfg.restaurant);
  console.log(
    `[pilot] restaurant ${rCreated ? 'created' : 'reused'}: ${restaurant.name} (${restaurant.id})`,
  );

  // 2) Members (users + memberships). Membership PK is (user, restaurant, role),
  //    so onConflictDoNothing makes the link idempotent.
  let usersCreated = 0;
  for (const member of cfg.members ?? []) {
    const { row: user, created } = await upsertUser(db, member);
    if (created) usersCreated += 1;
    await db
      .insert(memberships)
      .values({ userId: user.id, restaurantId: restaurant.id, role: member.role })
      .onConflictDoNothing();
  }
  console.log(`[pilot] members: ${(cfg.members ?? []).length} linked (~${usersCreated} new users)`);

  // 3) Suppliers
  const supplierByName = new Map<string, string>();
  let supCreated = 0;
  for (const s of cfg.suppliers ?? []) {
    const { row, created } = await upsertSupplier(db, restaurant.id, s);
    supplierByName.set(s.name, row.id);
    if (created) supCreated += 1;
  }
  console.log(`[pilot] suppliers: ${(cfg.suppliers ?? []).length} total (${supCreated} new)`);

  // 4) Products
  const productByName = new Map<string, { id: string; unit: string | null }>();
  let prodCreated = 0;
  for (const p of cfg.products ?? []) {
    const { row, created } = await upsertProduct(db, restaurant.id, p);
    productByName.set(p.name, { id: row.id, unit: row.defaultUnit });
    if (created) prodCreated += 1;
  }
  console.log(`[pilot] products: ${(cfg.products ?? []).length} total (${prodCreated} new)`);

  // 5) Optional initial POs (one-shot, only if the restaurant has none yet)
  if (withPos && cfg.purchaseOrders?.length) {
    const [poCountRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.restaurantId, restaurant.id));
    const count = poCountRow?.count ?? 0;
    if (count > 0) {
      console.log(`[pilot] POs skipped — restaurant already has ${count} PO(s)`);
    } else {
      const ownerMembership = await db.query.memberships.findFirst({
        where: eq(memberships.restaurantId, restaurant.id),
      });
      let poCount = 0;
      for (const po of cfg.purchaseOrders) {
        const supplierId = supplierByName.get(po.supplier);
        if (!supplierId) {
          console.warn(`[pilot]   skipping PO — unknown supplier "${po.supplier}"`);
          continue;
        }
        const [inserted] = await db
          .insert(purchaseOrders)
          .values({
            restaurantId: restaurant.id,
            supplierId,
            expectedDeliveryAt: po.expectedDeliveryAt ? new Date(po.expectedDeliveryAt) : new Date(),
            status: po.status ?? 'sent',
            source: 'manual',
            notes: po.notes ?? null,
            createdBy: ownerMembership?.userId ?? null,
          })
          .returning();
        if (!inserted) continue;
        const lines = po.lines
          .map((l) => {
            const prod = productByName.get(l.product);
            if (!prod) {
              console.warn(`[pilot]   PO line skipped — unknown product "${l.product}"`);
              return null;
            }
            return {
              poId: inserted.id,
              productId: prod.id,
              qtyOrdered: l.qty.toString(),
              unit: l.unit ?? prod.unit ?? 'יח׳',
              unitPriceExpected: l.unitPrice != null ? l.unitPrice.toFixed(4) : null,
              rawDescription: l.product,
            };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);
        if (lines.length) await db.insert(poLines).values(lines);
        poCount += 1;
      }
      console.log(`[pilot] POs: ${poCount} created`);
    }
  } else if (withPos) {
    console.log('[pilot] --with-pos set but config has no purchaseOrders');
  } else {
    console.log('[pilot] POs not requested (pass --with-pos to seed initial POs)');
  }

  console.log(`[pilot] done — restaurant ${restaurant.id} provisioned (idempotent)`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[pilot] failed', err);
  process.exit(1);
});
