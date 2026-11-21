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
import { featureEnabled } from '../lib/features';
import { catalogUnitPrice } from '../lib/unitPrice';
import { localDateKey } from '../contracts/core';
import {
  cheaperOffer,
  DEFAULT_WINDOW_DAYS,
  detectSustainedIncrease,
  resolveThreshold,
  type PricePoint,
  type ThresholdRule,
} from './detect';
import { buildChefDigest, buildOwnerDigest, type CreepLine, type DigestLinks } from './digest';
import { loadDigestImpacts } from './impactAdapter';
import { contractsEnding, markContractsAnnounced } from './contractExpiry';
import { markListDiffsAnnounced, pendingListDiffs } from './priceListDiff';
import { markDishesAnnounced, pendingDishCrossings, type DishChangesSource } from './dishCrossing';
import { digestOptions, type DigestOptions } from './options';
import { digestRecipients, enqueueDigest } from './notifyRoles';

const DAY_MS = 86_400_000;

/** How far back a competing supplier's latest price still counts as an offer. */
const OFFER_MAX_AGE_DAYS = 90;
const DEFAULT_TZ = 'Asia/Jerusalem';

export interface SweepOptions {
  now?: Date;
  /**
   * Send the AU-13 morning digest: ONE mail per person per Israel day (owner and
   * manager: price creep + contracts ending + new price lists + dishes; chef:
   * dishes only). Detection is identical with or without it.
   */
  notify?: boolean;
  /** Absolute base URL for the email CTA (worker passes APP_URL). */
  appBaseUrl?: string;
  /** Tests only: override the AU-13 options (default: the restaurant's settings). */
  digestOptions?: DigestOptions;
  /** Tests only: the recipes seam for the dish section (default: W3-02's export, once it lands). */
  dishChanges?: DishChangesSource | null;
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
  const ctx: NotifyCtx = { restaurantId, now, tz, settings: restaurant.settings, opts };

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
    enqueued: opts.notify ? await notifyPending(db, ctx) : 0,
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
  const enqueued = opts.notify ? await notifyPending(db, ctx) : 0;
  return { skipped: false, created: inserted.length, enqueued };
}

interface NotifyCtx {
  restaurantId: string;
  now: Date;
  tz: string;
  settings: unknown;
  opts: SweepOptions;
}

/**
 * AU-13 — the 07:00 digest. Collects the restaurant's open, un-notified alerts
 * (this run's, an in-app refresh's, or a run whose notify failed), contracts
 * ending within 14 days, new price lists and dishes that crossed their target,
 * and queues ONE mail per person: dedupe `au:A18:<rid>:<userId>:<ilDate>`.
 *
 * Marks (`notified_at`, the audit "once" rows) are written only AFTER every
 * recipient is queued, and only when at least one row was newly queued — a
 * same-day rerun whose mail already went leaves new items for tomorrow's mail.
 * Returns the number of newly queued mails.
 */
async function notifyPending(db: Database, ctx: NotifyCtx): Promise<number> {
  const { restaurantId, now, tz, settings, opts } = ctx;
  const options = opts.digestOptions ?? digestOptions(settings as never);
  const today = localDateKey(now, tz);
  const month = today.slice(0, 7);
  const skip = (what: string) => console.log(`[price-alerts] restaurant=${restaurantId} ${what} skipped: option off`);

  let creep: CreepLine[] = [];
  if (options.priceCreepDigest) {
    const pending = await db
      .select({ id: priceAlerts.id })
      .from(priceAlerts)
      .where(and(eq(priceAlerts.restaurantId, restaurantId), eq(priceAlerts.status, 'open'), isNull(priceAlerts.notifiedAt)));
    if (pending.length) {
      const alerts = await loadAlertDetails(db, restaurantId, pending.map((p) => p.id));
      const impacts = await loadDigestImpacts(db, restaurantId, alerts);
      creep = alerts.map((a) => ({
        alertId: a.id,
        productName: a.productName,
        supplierName: a.supplierName,
        pctChange: Number(a.pctChange),
        windowDays: a.windowDays,
        startPrice: Number(a.startPrice),
        endPrice: Number(a.endPrice),
        cheaperSupplierName: a.cheaperSupplierName,
        cheaperPrice: a.cheaperPrice == null ? null : Number(a.cheaperPrice),
        monthlyAgorot: impacts.get(a.id)?.monthlyAgorot ?? null,
        tone: impacts.get(a.id)?.tone ?? 't4',
      }));
    }
  } else skip('priceCreepDigest');
  const contracts = options.contractExpiry ? await contractsEnding(db, restaurantId, today) : (skip('contractExpiry'), []);
  const listDiffs = options.priceListDiff ? await pendingListDiffs(db, restaurantId, now, tz) : (skip('priceListDiff'), []);
  const dishesOn = featureEnabled(settings, 'recipes') && featureEnabled(settings, 'dishPriceAlert');
  const dishes = dishesOn ? await pendingDishCrossings(db, restaurantId, now, month, opts.dishChanges) : [];
  if (creep.length + contracts.length + listDiffs.length + dishes.length === 0) return 0;

  const base = opts.appBaseUrl;
  const go = (to: string) => (base ? `${base}/dashboard/go?r=${restaurantId}&to=${encodeURIComponent(to)}` : undefined);
  const links: DigestLinks = {
    queue: go('/dashboard/contracts?tab=queue'),
    contracts: go('/dashboard/contracts'),
    catalog: go('/dashboard/catalog'),
    recipe: (id) => go(`/dashboard/recipes/${id}`),
  };

  let enqueued = 0;
  let ownersReached = false;
  let chefsReached = false;
  const ownerMail = buildOwnerDigest({ locale: 'he', creep, contracts, dishes, listDiffs, links });
  if (ownerMail) {
    for (const r of await digestRecipients(db, restaurantId, ['owner', 'manager'])) {
      const fresh = await enqueueDigest(db, {
        restaurantId,
        recipient: r,
        subject: ownerMail.subject,
        text: ownerMail.text,
        html: ownerMail.html,
        dedupeKey: `au:A18:${restaurantId}:${r.userId}:${today}`,
        relatedEntityType: ownerMail.alertIds.length ? 'price_alert' : 'price_digest',
        relatedEntityId: ownerMail.alertIds[0] ?? null,
        payload: { kpi: 'A18', alertIds: ownerMail.alertIds, creepMonthlyAgorot: ownerMail.creepMonthlyAgorot },
      });
      if (fresh) {
        enqueued += 1;
        ownersReached = true;
      }
    }
  }
  const chefMail = buildChefDigest({ locale: 'he', dishes, links });
  if (chefMail) {
    for (const r of await digestRecipients(db, restaurantId, ['chef'])) {
      const fresh = await enqueueDigest(db, {
        restaurantId,
        recipient: r,
        subject: chefMail.subject,
        text: chefMail.text,
        html: chefMail.html,
        dedupeKey: `au:A18:${restaurantId}:${r.userId}:${today}`,
        relatedEntityType: 'price_digest',
        relatedEntityId: null,
        payload: { kpi: 'A18', dishes: dishes.length },
      });
      if (fresh) {
        enqueued += 1;
        chefsReached = true;
      }
    }
  }

  // Marked only after every recipient is queued (the outbox dedupes a retry).
  if (ownersReached) {
    if (creep.length) {
      await db
        .update(priceAlerts)
        .set({ notifiedAt: now })
        .where(and(eq(priceAlerts.restaurantId, restaurantId), inArray(priceAlerts.id, creep.map((c) => c.alertId))));
    }
    await markContractsAnnounced(db, restaurantId, contracts);
    await markListDiffsAnnounced(db, restaurantId, listDiffs);
  }
  if (ownersReached || chefsReached) await markDishesAnnounced(db, restaurantId, month, dishes);
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
