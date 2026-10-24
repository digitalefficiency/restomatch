import {
  and,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  priceAlertThresholds,
  priceAlerts,
  priceHistory,
  products,
  restaurants,
  supplierCatalogItems,
  suppliers,
  type Database,
} from '@restomatch/db';
import { unitConversionFactor } from '@restomatch/matching';
import { featureEnabled } from '../lib/features';
import { enqueueNotification } from '../notifications/outbox';
import { recipientsForRestaurant } from '../notifications/recipients';
import { localDateKey } from '../contracts/core';
import {
  cheaperOffer,
  DEFAULT_WINDOW_DAYS,
  detectSustainedIncrease,
  resolveThreshold,
  type PricePoint,
  type ThresholdRule,
} from './detect';
import { priceAlertEmail } from './email';

const DAY_MS = 86_400_000;

/**
 * A catalog list price expressed per the product's default unit (the unit
 * price_history is normalized to), or null when it can't be compared safely:
 * a pack price (pack_size > 1), or a unit that doesn't convert.
 */
function catalogUnitPrice(c: {
  listPrice: string | null;
  unit: string | null;
  packSize: string | null;
  productUnit: string | null;
}): number | null {
  const price = Number(c.listPrice);
  if (!Number.isFinite(price) || price <= 0) return null;
  if (c.packSize != null && Number(c.packSize) !== 1) return null;
  // No unit on either side = quoted in the product's own unit.
  if (!c.unit || !c.productUnit) return price;
  const n = (u: string) => u.trim().toLowerCase().replace(/["'.\s\u05F3\u05F4]/g, '');
  if (n(c.unit) === n(c.productUnit)) return price;
  const f = unitConversionFactor(c.unit, c.productUnit);
  return f ? Math.round((price / f) * 10_000) / 10_000 : null;
}
/** How far back a competing supplier's latest price still counts as an offer. */
const OFFER_MAX_AGE_DAYS = 90;
const DEFAULT_TZ = 'Asia/Jerusalem';

export interface SweepOptions {
  now?: Date;
  /** Enqueue an email per new alert to owners/managers via the outbox. */
  notify?: boolean;
  /** Absolute base URL for the email CTA (worker passes APP_URL). */
  appBaseUrl?: string;
}

export interface SweepResult {
  skipped: boolean;
  created: number;
  enqueued: number;
}

/**
 * Detect sustained price increases for one restaurant and persist them as
 * `price_alerts` (deduped per last observation day). With `notify`, each NEW
 * alert enqueues one email per owner/manager through the notification outbox
 * (deduped by alert id); real delivery is outbox-dispatch's job.
 *
 * Every query is scoped by restaurant_id (safe on the worker's service
 * connection and inside a member RLS transaction alike). No-op unless the
 * restaurant has the `priceAlerts` feature on.
 */
export async function runPriceAlertSweep(
  db: Database,
  restaurantId: string,
  opts: SweepOptions = {},
): Promise<SweepResult> {
  const now = opts.now ?? new Date();
  const [restaurant] = await db
    .select({ settings: restaurants.settings, timezone: restaurants.timezone })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  if (!restaurant || !featureEnabled(restaurant.settings, 'priceAlerts')) {
    return { skipped: true, created: 0, enqueued: 0 };
  }
  const tz = restaurant.timezone ?? DEFAULT_TZ;

  const rules: ThresholdRule[] = (
    await db
      .select({
        supplierId: priceAlertThresholds.supplierId,
        category: priceAlertThresholds.category,
        thresholdPct: priceAlertThresholds.thresholdPct,
        windowDays: priceAlertThresholds.windowDays,
        enabled: priceAlertThresholds.enabled,
      })
      .from(priceAlertThresholds)
      .where(eq(priceAlertThresholds.restaurantId, restaurantId))
  ).map((r) => ({ ...r, thresholdPct: Number(r.thresholdPct) }));

  const maxWindow = Math.max(DEFAULT_WINDOW_DAYS, ...rules.map((r) => r.windowDays));
  const since = new Date(now.getTime() - Math.max(maxWindow, OFFER_MAX_AGE_DAYS) * DAY_MS);

  const rows = await db
    .select({
      productId: priceHistory.productId,
      supplierId: priceHistory.supplierId,
      observedAt: priceHistory.observedAt,
      unitPrice: priceHistory.unitPrice,
      category: products.category,
    })
    .from(priceHistory)
    .innerJoin(products, eq(products.id, priceHistory.productId))
    .where(and(eq(priceHistory.restaurantId, restaurantId), gt(priceHistory.observedAt, since)));

  const series = new Map<string, { productId: string; supplierId: string; category: string | null; points: PricePoint[] }>();
  // Latest observed price per (product, supplier) — the competing offers.
  const latest = new Map<string, { supplierId: string; price: number; at: number }[]>();
  for (const r of rows) {
    if (r.observedAt.getTime() > now.getTime()) continue;
    const k = `${r.productId}:${r.supplierId}`;
    const s = series.get(k) ?? { productId: r.productId, supplierId: r.supplierId, category: r.category, points: [] };
    s.points.push({ observedAt: r.observedAt, unitPrice: r.unitPrice });
    series.set(k, s);
    const offers = latest.get(r.productId) ?? [];
    const prev = offers.find((o) => o.supplierId === r.supplierId);
    const at = r.observedAt.getTime();
    if (!prev) offers.push({ supplierId: r.supplierId, price: Number(r.unitPrice), at });
    else if (at > prev.at) Object.assign(prev, { price: Number(r.unitPrice), at });
    latest.set(r.productId, offers);
  }

  const detected: Array<typeof priceAlerts.$inferInsert> = [];
  for (const s of series.values()) {
    const th = resolveThreshold(rules, s.supplierId, s.category);
    if (!th.enabled) continue;
    const trend = detectSustainedIncrease(s.points, th, now, tz);
    if (!trend) continue;
    detected.push({
      restaurantId,
      productId: s.productId,
      supplierId: s.supplierId,
      windowDays: th.windowDays,
      thresholdPct: th.thresholdPct.toFixed(4),
      startPrice: trend.startPrice.toFixed(4),
      endPrice: trend.endPrice.toFixed(4),
      // NUMERIC(8,4): clamp absurd ratios instead of failing the whole sweep.
      pctChange: Math.min(trend.pctChange, 9999).toFixed(4),
      startAt: trend.startAt,
      endAt: trend.endAt,
      observations: trend.observations,
      dedupeKey: `${s.productId}:${s.supplierId}:${localDateKey(trend.endAt, tz)}`,
    });
  }
  const pendingOnly = async (): Promise<SweepResult> => ({
    skipped: false,
    created: 0,
    enqueued: opts.notify ? await notifyPending(db, restaurantId, now, opts.appBaseUrl) : 0,
  });
  if (detected.length === 0) return pendingOnly();

  // Don't re-alert a trend the owner already sees or dismissed: skip a
  // (product, supplier) with an OPEN alert, or one DISMISSED within its window.
  const existing = await db
    .select({
      productId: priceAlerts.productId,
      supplierId: priceAlerts.supplierId,
      status: priceAlerts.status,
      dismissedAt: priceAlerts.dismissedAt,
    })
    .from(priceAlerts)
    .where(
      and(
        eq(priceAlerts.restaurantId, restaurantId),
        inArray(priceAlerts.productId, [...new Set(detected.map((d) => d.productId))]),
      ),
    );
  const suppressed = (d: (typeof detected)[number]) =>
    existing.some(
      (e) =>
        e.productId === d.productId &&
        e.supplierId === d.supplierId &&
        (e.status === 'open' ||
          (e.dismissedAt != null && now.getTime() - e.dismissedAt.getTime() < d.windowDays * DAY_MS)),
    );
  const fresh = detected.filter((d) => !suppressed(d));
  if (fresh.length === 0) return pendingOnly();

  // Competing offers: other suppliers' latest observed price, plus active
  // catalog list prices for the same product.
  const productIds = [...new Set(fresh.map((d) => d.productId))];
  const catalog = await db
    .select({
      productId: supplierCatalogItems.productId,
      supplierId: supplierCatalogItems.supplierId,
      listPrice: supplierCatalogItems.listPrice,
      unit: supplierCatalogItems.unit,
      packSize: supplierCatalogItems.packSize,
      productUnit: products.defaultUnit,
    })
    .from(supplierCatalogItems)
    .innerJoin(products, eq(products.id, supplierCatalogItems.productId))
    .where(
      and(
        eq(supplierCatalogItems.restaurantId, restaurantId),
        inArray(supplierCatalogItems.productId, productIds),
        eq(supplierCatalogItems.active, true),
        isNotNull(supplierCatalogItems.listPrice),
      ),
    );
  const offerCutoff = now.getTime() - OFFER_MAX_AGE_DAYS * DAY_MS;
  for (const d of fresh) {
    const offers = [
      ...(latest.get(d.productId) ?? []).filter((o) => o.at >= offerCutoff),
      ...catalog
        .filter((c) => c.productId === d.productId)
        .map((c) => ({ supplierId: c.supplierId, price: catalogUnitPrice(c) }))
        .filter((o): o is { supplierId: string; price: number } => o.price !== null),
    ].filter((o) => o.supplierId !== d.supplierId);
    const best = cheaperOffer(Number(d.endPrice), offers);
    if (best) {
      d.cheaperSupplierId = best.supplierId;
      d.cheaperPrice = best.price.toFixed(4);
    }
  }

  const inserted = await db
    .insert(priceAlerts)
    .values(fresh)
    .onConflictDoNothing({ target: [priceAlerts.restaurantId, priceAlerts.dedupeKey] })
    .returning({ id: priceAlerts.id, productId: priceAlerts.productId, supplierId: priceAlerts.supplierId });

  // Email every OPEN alert not yet notified — this run's and any created by an
  // in-app refresh or a previous run whose notify failed (notified_at NULL).
  const enqueued = opts.notify ? await notifyPending(db, restaurantId, now, opts.appBaseUrl) : 0;
  return { skipped: false, created: inserted.length, enqueued };
}

async function notifyPending(
  db: Database,
  restaurantId: string,
  now: Date,
  appBaseUrl?: string,
): Promise<number> {
  const pending = await db
    .select({ id: priceAlerts.id })
    .from(priceAlerts)
    .where(
      and(
        eq(priceAlerts.restaurantId, restaurantId),
        eq(priceAlerts.status, 'open'),
        isNull(priceAlerts.notifiedAt),
      ),
    );
  if (pending.length === 0) return 0;
  const recipients = await recipientsForRestaurant(db, restaurantId);
  if (recipients.length === 0) return 0;
  const alerts = await loadAlertDetails(db, restaurantId, pending.map((p) => p.id));
  let enqueued = 0;
  for (const a of alerts) {
    const email = priceAlertEmail({
      productName: a.productName,
      supplierName: a.supplierName,
      pctChange: Number(a.pctChange),
      windowDays: a.windowDays,
      startPrice: Number(a.startPrice),
      endPrice: Number(a.endPrice),
      cheaperSupplierName: a.cheaperSupplierName,
      cheaperPrice: a.cheaperPrice == null ? null : Number(a.cheaperPrice),
      url: appBaseUrl ? `${appBaseUrl}/dashboard/contracts?tab=alerts` : undefined,
    });
    for (const r of recipients) {
      const { deduped } = await enqueueNotification(db, {
        restaurantId,
        channel: 'email',
        target: r.email,
        subject: email.subject,
        body: email.text,
        html: email.html,
        relatedEntityType: 'price_alert',
        relatedEntityId: a.id,
        dedupeKey: `price-alert:${a.id}:${r.email}`,
      });
      if (!deduped) enqueued += 1;
    }
    // Marked only after every recipient is queued (the outbox dedupes a retry).
    await db.update(priceAlerts).set({ notifiedAt: now }).where(eq(priceAlerts.id, a.id));
  }
  return enqueued;
}

export interface PriceAlertDetail {
  id: string;
  productId: string;
  productName: string;
  productNameEn: string | null;
  supplierId: string;
  supplierName: string;
  supplierNameEn: string | null;
  windowDays: number;
  thresholdPct: string;
  startPrice: string;
  endPrice: string;
  pctChange: string;
  startAt: Date;
  endAt: Date;
  observations: number;
  cheaperSupplierId: string | null;
  cheaperSupplierName: string | null;
  /** English name of the cheaper supplier (display only; null when none). */
  cheaperSupplierNameEn: string | null;
  cheaperPrice: string | null;
  status: 'open' | 'dismissed';
  createdAt: Date;
}

/** Alerts with product/supplier names, newest first, scoped to the restaurant. */
export async function loadAlertDetails(
  db: Database,
  restaurantId: string,
  ids?: string[],
  opts: { status?: 'open' | 'dismissed'; limit?: number } = {},
): Promise<PriceAlertDetail[]> {
  if (ids && ids.length === 0) return [];
  const conds = [eq(priceAlerts.restaurantId, restaurantId)];
  if (ids) conds.push(inArray(priceAlerts.id, ids));
  if (opts.status) conds.push(eq(priceAlerts.status, opts.status));
  const rows = await db
    .select({
      id: priceAlerts.id,
      productId: priceAlerts.productId,
      productName: products.canonicalName,
      productNameEn: products.nameEn,
      supplierId: priceAlerts.supplierId,
      supplierName: suppliers.name,
      supplierNameEn: suppliers.nameEn,
      windowDays: priceAlerts.windowDays,
      thresholdPct: priceAlerts.thresholdPct,
      startPrice: priceAlerts.startPrice,
      endPrice: priceAlerts.endPrice,
      pctChange: priceAlerts.pctChange,
      startAt: priceAlerts.startAt,
      endAt: priceAlerts.endAt,
      observations: priceAlerts.observations,
      cheaperSupplierId: priceAlerts.cheaperSupplierId,
      cheaperPrice: priceAlerts.cheaperPrice,
      status: priceAlerts.status,
      createdAt: priceAlerts.createdAt,
    })
    .from(priceAlerts)
    .innerJoin(products, eq(products.id, priceAlerts.productId))
    .innerJoin(suppliers, eq(suppliers.id, priceAlerts.supplierId))
    .where(and(...conds))
    .orderBy(desc(priceAlerts.createdAt))
    .limit(opts.limit ?? 200);
  const cheaperIds = [...new Set(rows.map((r) => r.cheaperSupplierId).filter((x): x is string => !!x))];
  const names = new Map<string, { name: string; nameEn: string | null }>();
  if (cheaperIds.length) {
    const sup = await db
      .select({ id: suppliers.id, name: suppliers.name, nameEn: suppliers.nameEn })
      .from(suppliers)
      .where(and(eq(suppliers.restaurantId, restaurantId), inArray(suppliers.id, cheaperIds)));
    for (const s of sup) names.set(s.id, { name: s.name, nameEn: s.nameEn });
  }
  return rows.map((r) => {
    const cheaper = r.cheaperSupplierId ? names.get(r.cheaperSupplierId) : undefined;
    return { ...r, cheaperSupplierName: cheaper?.name ?? null, cheaperSupplierNameEn: cheaper?.nameEn ?? null };
  });
}
