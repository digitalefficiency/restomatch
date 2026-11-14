import { sql, type Database } from '@restomatch/db';

/**
 * AU-08 (catalogue A13) — the case state of an invoice at VAT risk, read from
 * what already exists (no schema change):
 *   - "a request went out" = `vat.allocation_requested` audit rows (one per invoice);
 *   - "the supplier re-sent a corrected invoice" = a duplicate copy the OCR
 *     worker kept with `ocr_payload.raw.duplicateOf.invoiceId` = this invoice
 *     (writeOcrHeader clears the copy's number, so we match on that id, never on
 *     the invoice number) whose read carries a well-formed allocation number.
 *
 * Kept free of any runtime import of `vatAtRisk.ts` (which calls into here).
 */

export const A13 = 'A13' as const;

/** Audit actions AU-08 writes (G-05 batches them into `AuditAction`). */
export const VAT_ALLOCATION_REQUESTED = 'vat.allocation_requested' as const;
export const VAT_ALLOCATION_SET = 'vat.allocation_set' as const;

/** A request with no number after this many days is "overdue". */
export const REQUEST_OVERDUE_DAYS = 7;
/** ≤ this many days to the deduction deadline = "closing". */
export const CLOSING_DAYS = 14;

export type AllocationStage = 'new' | 'requested' | 'overdue_request' | 'closing' | 'expired';

export interface AllocationCase {
  /** ISO timestamp of the latest request, or null if none was recorded. */
  requestedAt: string | null;
  requestCount: number;
  /** A corrected copy of this invoice with a well-formed number (format only). */
  suggestedNumber: { value: string; fromInvoiceId: string } | null;
  stage: AllocationStage;
}

/** Spaces / dashes as printed are dropped; returns the 9 digits or null. */
export function normaliseAllocationNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.replace(/[\s-]/g, '');
  return /^\d{9}$/.test(v) ? v : null;
}

/** Israel calendar day (YYYY-MM-DD) of an instant. */
export function israelDay(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

function wholeDays(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

/** Precedence: expired > closing > overdue request > requested > new. */
export function stageFor(args: { daysLeft: number; requestedAt: string | null; todayIso: string }): AllocationStage {
  if (args.daysLeft < 0) return 'expired';
  if (args.daysLeft <= CLOSING_DAYS) return 'closing';
  if (args.requestedAt) {
    const since = wholeDays(israelDay(new Date(args.requestedAt)), args.todayIso);
    return since > REQUEST_OVERDUE_DAYS ? 'overdue_request' : 'requested';
  }
  return 'new';
}

/** Days since the latest request (Israel days), or null. For the "נשלחה בקשה לפני N ימים" text. */
export function daysSinceRequest(requestedAt: string | null, todayIso: string): number | null {
  return requestedAt ? wholeDays(israelDay(new Date(requestedAt)), todayIso) : null;
}

/**
 * Case state for `invoiceIds` of `restaurantId`. Two index-friendly reads
 * (audit_log by restaurant + action; invoices by restaurant). Runs inside the
 * caller's restaurant transaction.
 */
export async function loadCaseState(
  db: Database,
  restaurantId: string,
  rows: ReadonlyArray<{ invoiceId: string; daysLeft: number }>,
  todayIso: string,
): Promise<Map<string, AllocationCase>> {
  const out = new Map<string, AllocationCase>();
  if (rows.length === 0) return out;
  const ids = rows.map((r) => r.invoiceId);
  const idList = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

  const requests = (await db.execute(sql`
    select a.entity_id::text as invoice_id, count(*)::int as n,
           to_char(max(a.at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as last_at
    from audit_log a
    where a.restaurant_id = ${restaurantId}
      and a.action = ${VAT_ALLOCATION_REQUESTED}
      and a.entity_type = 'invoice'
      and a.entity_id in (${idList})
    group by a.entity_id
  `)) as unknown as Array<{ invoice_id: string; n: number; last_at: string }>;
  const reqBy = new Map(requests.map((r) => [r.invoice_id, r]));

  const copies = (await db.execute(sql`
    select c.id::text as copy_id, c.ocr_payload->'raw'->'duplicateOf'->>'invoiceId' as original_id, c.allocation_number
    from invoices c
    where c.restaurant_id = ${restaurantId}
      and c.ocr_payload->'raw'->'duplicateOf'->>'invoiceId' in (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )})
      and c.allocation_number is not null
    order by c.created_at desc
  `)) as unknown as Array<{ copy_id: string; original_id: string; allocation_number: string | null }>;
  const sugBy = new Map<string, { value: string; fromInvoiceId: string }>();
  for (const c of copies) {
    if (sugBy.has(c.original_id)) continue; // newest valid copy wins
    const v = normaliseAllocationNumber(c.allocation_number);
    if (v) sugBy.set(c.original_id, { value: v, fromInvoiceId: c.copy_id });
  }

  for (const r of rows) {
    const req = reqBy.get(r.invoiceId);
    const requestedAt = req?.last_at ?? null;
    out.set(r.invoiceId, {
      requestedAt,
      requestCount: req?.n ?? 0,
      suggestedNumber: sugBy.get(r.invoiceId) ?? null,
      stage: stageFor({ daysLeft: r.daysLeft, requestedAt, todayIso }),
    });
  }
  return out;
}
