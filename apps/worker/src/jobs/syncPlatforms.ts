import {
  and,
  createDb,
  eq,
  poLines,
  procurementConnections,
  purchaseOrders,
  suppliers,
} from '@restomatch/db';
import { getAdapter, type PlatformId } from '@restomatch/procurement';
import type { NormalizedPurchaseOrder } from '@restomatch/types';
import { makeWorker } from '../queue';

export interface SyncPlatformsJob {
  restaurantId: string;
  platform: PlatformId;
  /** When set, ignore the connection record and use this credential map. Used in tests. */
  credentialsOverride?: Record<string, unknown>;
  /** When set, fetch orders since this date instead of connection.last_sync_at. */
  sinceOverride?: string;
}

export function startSyncPlatformsWorker() {
  return makeWorker<SyncPlatformsJob>('sync-platforms', async (job) => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is required');
    const db = createDb(url);

    const connectionRows = await db
      .select()
      .from(procurementConnections)
      .where(
        and(
          eq(procurementConnections.restaurantId, job.data.restaurantId),
          eq(procurementConnections.platform, job.data.platform),
        ),
      )
      .limit(1);
    const connection = connectionRows[0];
    if (!connection && !job.data.credentialsOverride) {
      throw new Error(
        `No procurement_connection for restaurant ${job.data.restaurantId} platform ${job.data.platform}`,
      );
    }

    const credentials =
      job.data.credentialsOverride ??
      (connection ? loadCredentials(connection.credentialsVaultRef) : {});
    const adapter = getAdapter(job.data.platform);

    const since = job.data.sinceOverride
      ? new Date(job.data.sinceOverride)
      : connection?.lastSyncAt ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days back

    const ctx = { restaurantId: job.data.restaurantId, credentials };

    // 1. Sync suppliers first (needed for FK on POs)
    const supplierMap = await syncSuppliers(
      db,
      job.data.restaurantId,
      job.data.platform,
      await adapter.listSuppliers(ctx),
    );

    // 2. Sync orders (and their lines)
    const orders = await adapter.listOrders(ctx, since);
    const poCount = await syncOrders(db, job.data.restaurantId, supplierMap, orders);

    // 3. Update sync cursor
    if (connection) {
      await db
        .update(procurementConnections)
        .set({ lastSyncAt: new Date() })
        .where(eq(procurementConnections.id, connection.id));
    }

    console.log(
      `[sync-platforms] platform=${job.data.platform} restaurant=${job.data.restaurantId} ` +
        `suppliers=${supplierMap.size} orders=${orders.length} persisted=${poCount}`,
    );

    return {
      platform: job.data.platform,
      suppliersSynced: supplierMap.size,
      ordersFetched: orders.length,
      ordersPersisted: poCount,
    };
  });
}

/**
 * Sync suppliers from the platform.
 *
 * Lookup order:
 *   1. By (sourcePlatform, externalRef) — the platform-supplied UUID.
 *   2. By restaurant-scoped lowercase name — for suppliers added manually
 *      before the platform connection existed (one-time backfill).
 *
 * If neither matches, inserts a new supplier with the externalRef populated.
 */
async function syncSuppliers(
  db: ReturnType<typeof createDb>,
  restaurantId: string,
  platform: PlatformId,
  externalSuppliers: { externalId: string; name: string; businessId?: string; contactEmail?: string }[],
): Promise<Map<string, string>> {
  const supplierMap = new Map<string, string>(); // externalId → internal supplier.id

  const existing = await db
    .select({
      id: suppliers.id,
      name: suppliers.name,
      externalRef: suppliers.externalRef,
      sourcePlatform: suppliers.sourcePlatform,
    })
    .from(suppliers)
    .where(eq(suppliers.restaurantId, restaurantId));

  const byExternalRef = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const s of existing) {
    if (s.externalRef && s.sourcePlatform === platform) {
      byExternalRef.set(s.externalRef, s.id);
    }
    byName.set(s.name.toLowerCase().trim(), s.id);
  }

  for (const ext of externalSuppliers) {
    const byRef = byExternalRef.get(ext.externalId);
    if (byRef) {
      supplierMap.set(ext.externalId, byRef);
      continue;
    }
    const nameMatch = byName.get(ext.name.toLowerCase().trim());
    if (nameMatch) {
      // Backfill external_ref so future syncs hit the fast path
      await db
        .update(suppliers)
        .set({ externalRef: ext.externalId, sourcePlatform: platform })
        .where(eq(suppliers.id, nameMatch));
      supplierMap.set(ext.externalId, nameMatch);
      continue;
    }
    const [inserted] = await db
      .insert(suppliers)
      .values({
        restaurantId,
        name: ext.name,
        businessId: ext.businessId,
        contactEmail: ext.contactEmail,
        externalRef: ext.externalId,
        sourcePlatform: platform,
      })
      .returning({ id: suppliers.id });
    if (inserted) supplierMap.set(ext.externalId, inserted.id);
  }
  return supplierMap;
}

/**
 * Upsert purchase orders by (source_platform, source_ref). Replaces po_lines
 * each time — the source platform is authoritative for line-level data.
 */
async function syncOrders(
  db: ReturnType<typeof createDb>,
  restaurantId: string,
  supplierMap: Map<string, string>,
  orders: NormalizedPurchaseOrder[],
): Promise<number> {
  let persisted = 0;
  for (const order of orders) {
    const supplierId = supplierMap.get(order.supplierExternalId);
    if (!supplierId) {
      console.warn(
        `[sync-platforms] skipping order ${order.externalId} — supplier ${order.supplierExternalId} not in supplier_map`,
      );
      continue;
    }

    // restaurantId in the lookup is load-bearing: external ids are only unique
    // per platform account, so two restaurants syncing the same platform can
    // collide on (sourcePlatform, sourceRef) — without this filter one
    // restaurant's sync overwrites the other's PO and replaces its lines.
    const existing = await db
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.restaurantId, restaurantId),
          eq(purchaseOrders.sourcePlatform, order.platform === 'email' || order.platform === 'manual' ? 'restomatch' : (order.platform as PlatformId)),
          eq(purchaseOrders.sourceRef, order.externalId),
        ),
      )
      .limit(1);

    let poId: string;
    if (existing[0]) {
      poId = existing[0].id;
      await db
        .update(purchaseOrders)
        .set({
          status: order.status,
          expectedDeliveryAt: order.expectedDeliveryAt
            ? new Date(order.expectedDeliveryAt)
            : null,
          totalEstimated: order.totalEstimated?.toString(),
          updatedAt: new Date(),
        })
        .where(eq(purchaseOrders.id, poId));
      await db.delete(poLines).where(eq(poLines.poId, poId));
    } else {
      const [inserted] = await db
        .insert(purchaseOrders)
        .values({
          restaurantId,
          supplierId,
          expectedDeliveryAt: order.expectedDeliveryAt
            ? new Date(order.expectedDeliveryAt)
            : null,
          status: order.status,
          source: 'platform',
          sourcePlatform:
            order.platform === 'email' || order.platform === 'manual'
              ? 'restomatch'
              : (order.platform as PlatformId),
          sourceRef: order.externalId,
          totalEstimated: order.totalEstimated?.toString(),
        })
        .returning({ id: purchaseOrders.id });
      if (!inserted) continue;
      poId = inserted.id;
    }

    if (order.lines.length > 0) {
      await db.insert(poLines).values(
        order.lines.map((line) => ({
          poId,
          productId: null, // resolved via catalog matcher when invoice comes in
          rawDescription: line.rawDescription,
          qtyOrdered: line.qty.toString(),
          unit: line.unit,
          unitPriceExpected: line.unitPrice?.toString() ?? null,
        })),
      );
    }
    persisted += 1;
  }
  return persisted;
}

/**
 * For M5 we expect callers to set credentials via env vars on the worker
 * or via the job's credentialsOverride. Vault integration comes later
 * (M9 polish) — for now `credentialsVaultRef` is just a key into env.
 */
function loadCredentials(vaultRef: string): Record<string, unknown> {
  // Convention: vaultRef = "env:VAR_NAME" returns {apiKey: process.env[VAR_NAME]}
  if (vaultRef.startsWith('env:')) {
    const varName = vaultRef.slice(4);
    const apiKey = process.env[varName];
    if (!apiKey) {
      throw new Error(`Credentials env var ${varName} is not set`);
    }
    return { apiKey };
  }
  throw new Error(`Unsupported vault ref scheme: ${vaultRef}`);
}
