import { auditLog, discrepancies, matchRuns, sql, type Database } from '@restomatch/db';

export const GROUP_TOTAL_NOTE = 'G-09: נבדק כחשבונית אחת עם עמודים נוספים';

/**
 * Round 11 (L1): an invoice checked as ONE document with other pages (it carries a
 * "checked together" group, or is included in one) is never a TOTAL_MISMATCH on its own —
 * its lines vs a total printed for the whole document is a phantom leak. Sets aside the
 * open TOTAL_MISMATCH findings of `invoiceId`'s runs (audited, restaurant-scoped). Called by
 * the match job after every run and by the "checked together" answer itself.
 */
export async function setAsideGroupTotals(tx: Database, restaurantId: string, invoiceId: string, userId: string | null = null): Promise<string[]> {
  const [grouped] = (await tx.execute(sql`
    select 1 as hit from invoices i
     where i.restaurant_id = ${restaurantId} and i.id = ${invoiceId}
       and ((i.ocr_payload -> 'raw') ? 'paidWith'
            or exists (select 1 from invoices c where c.restaurant_id = ${restaurantId}
                        and c.ocr_payload -> 'raw' -> 'paidWith' ->> 'invoiceId' = ${invoiceId}::text))
     limit 1`)) as unknown as Array<{ hit: number }>;
  if (!grouped) return [];
  const waived = (await tx.execute(sql`
    update ${discrepancies} d
       set resolution_status = 'rejected', resolved_by = ${userId}, resolved_at = now(), resolution_note = ${GROUP_TOTAL_NOTE}
      from ${matchRuns} mr
     where mr.id = d.match_run_id and mr.restaurant_id = d.restaurant_id
       and d.restaurant_id = ${restaurantId} and mr.invoice_id = ${invoiceId}
       and d.type = 'TOTAL_MISMATCH' and d.resolution_status in ('open', 'escalated')
     returning d.id::text as id`)) as unknown as Array<{ id: string }>;
  if (waived.length > 0) {
    await tx.insert(auditLog).values({
      restaurantId,
      userId,
      action: 'document.group_totals_set_aside',
      entityType: 'invoice',
      entityId: invoiceId,
      after: { discrepancyIds: waived.map((w) => w.id) } as never,
    });
  }
  return waived.map((w) => w.id);
}
