import { and, asc, eq, restaurants, sql, suppliers, type Database } from '@restomatch/db';
import { deriveExpectedDelivery } from '../lib/deriveDelivery';
import { localDateKeyInTz } from '../lib/time';

/**
 * The cut-off board (W2-06 §5.2, orders-04/orders-19): every active supplier
 * with its next order cut-off, the last placed order and the caller's open
 * draft — ONE query for the rows (no N+1), cut-offs derived in memory from
 * each supplier's order schedule. Sorted by next cut-off; suppliers without a
 * schedule sink to the end. `today` marks a cut-off on the restaurant-local
 * today (the "היום" group).
 */
export interface BoardRow {
  supplierId: string;
  name: string;
  nameEn: string | null;
  hasWhatsapp: boolean;
  hasEmail: boolean;
  nextOrderCutoffAt: string | null;
  expectedDeliveryAt: string | null;
  missedCutoff: boolean;
  today: boolean;
  lastOrder: { poId: string; at: string; totalEstimated: string | null } | null;
  myDraft: { poId: string; lineCount: number; updatedAt: string } | null;
}

const DEFAULT_TZ = 'Asia/Jerusalem';

export async function buildSupplierBoard(
  db: Database,
  args: { restaurantId: string; userId: string | null; now?: Date },
): Promise<{ today: string; rows: BoardRow[] }> {
  const now = args.now ?? new Date();
  const [r] = await db
    .select({ tz: restaurants.timezone })
    .from(restaurants)
    .where(eq(restaurants.id, args.restaurantId))
    .limit(1);
  const tz = r?.tz ?? DEFAULT_TZ;
  const todayKey = localDateKeyInTz(now, tz);
  const uid = args.userId;

  const rows = await db
    .select({
      supplierId: suppliers.id,
      name: suppliers.name,
      nameEn: suppliers.nameEn,
      email: suppliers.contactEmail,
      whatsapp: suppliers.contactWhatsapp,
      orderSchedule: suppliers.orderSchedule,
      last: sql<{ poId: string; at: string; totalEstimated: string | null } | null>`(
        select json_build_object('poId', po.id, 'at', coalesce(po.sent_at, po.created_at), 'totalEstimated', po.total_estimated::text)
        from purchase_orders po
        where po.restaurant_id = ${args.restaurantId} and po.supplier_id = ${suppliers.id}
          and po.status in ('sent','confirmed','partial','closed')
          and (po.source_ref is null or po.source_ref not like 'walk_in:%')
        order by coalesce(po.sent_at, po.created_at) desc, po.id desc
        limit 1)`,
      draft: sql<{ poId: string; lineCount: number; updatedAt: string } | null>`(
        select json_build_object('poId', po.id, 'updatedAt', po.updated_at,
          'lineCount', (select count(*) from po_lines l where l.po_id = po.id))
        from purchase_orders po
        where po.restaurant_id = ${args.restaurantId} and po.supplier_id = ${suppliers.id}
          and po.status = 'draft' and po.source_ref is null
          and ${uid === null ? sql`false` : sql`po.created_by = ${uid}`}
        order by po.updated_at desc, po.id desc
        limit 1)`,
    })
    .from(suppliers)
    .where(and(eq(suppliers.restaurantId, args.restaurantId), eq(suppliers.active, true)))
    .orderBy(asc(suppliers.name));

  const out: BoardRow[] = rows.map((s) => {
    const d = deriveExpectedDelivery(s.orderSchedule as never, now, tz);
    const cutoff = d?.nextOrderCutoffAt ?? null;
    return {
      supplierId: s.supplierId,
      name: s.name,
      nameEn: s.nameEn,
      hasWhatsapp: !!s.whatsapp,
      hasEmail: !!s.email,
      nextOrderCutoffAt: cutoff?.toISOString() ?? null,
      expectedDeliveryAt: d?.expectedDeliveryAt.toISOString() ?? null,
      missedCutoff: d?.missedCutoff ?? false,
      today: cutoff ? localDateKeyInTz(cutoff, tz) === todayKey : false,
      lastOrder: s.last ? { ...s.last, at: new Date(s.last.at).toISOString() } : null,
      myDraft: s.draft
        ? { poId: s.draft.poId, lineCount: Number(s.draft.lineCount), updatedAt: new Date(s.draft.updatedAt).toISOString() }
        : null,
    };
  });
  out.sort((a, b) => {
    if (a.nextOrderCutoffAt && b.nextOrderCutoffAt) return a.nextOrderCutoffAt.localeCompare(b.nextOrderCutoffAt);
    if (a.nextOrderCutoffAt) return -1;
    if (b.nextOrderCutoffAt) return 1;
    return a.name.localeCompare(b.name, 'he');
  });
  return { today: todayKey, rows: out };
}
