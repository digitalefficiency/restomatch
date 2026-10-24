import { eq, restaurants, sql, type Database } from '@restomatch/db';
import { lineTotalAgorot } from '../orders/document/build';

/**
 * Delivery-note ↔ invoice coverage for the supplier ledger.
 *
 * The interface is S3's (money engine) `deliveryNoteCoverage` from
 * packages/api/src/match/consolidated.ts, agreed for this ledger; this is a
 * local implementation of the same rules until that lands (then swap the
 * import). One row per delivery note (goods receipt) of the supplier with
 * received_at in [from, to), oldest first. Rules, in order:
 *   1. the note's ת.מ. number is listed in raw.deliveryNotes of a consolidated invoice of the
 *      supplier → covered when it is matched/approved/paid, else in_consolidated;
 *   2. a match run of an invoice used the GR or its PO → covered;
 *   3. the period (raw.periodStart..periodEnd, else the invoice's month ± 3 days) of a
 *      consolidated invoice that lists no notes holds it → same status rule;
 *   4. otherwise not_invoiced — an ordinary invoice waiting for a PO link never covers a note
 *      (orchestrator decision: a note billed on nothing must not read as covered).
 */
export interface DeliveryNoteCoverage {
  grId: string;
  poId: string | null;
  /** The delivery-note number ('ת.מ.' in goods_receipts.notes), or null. */
  number: string | null;
  poRef: string | null;
  /** ISO */
  receivedAt: string;
  /** Σ received × PO price, before VAT, agora-exact. */
  receivedValueIls: number;
  state: 'covered' | 'in_consolidated' | 'not_invoiced';
  invoiceId: string | null;
  invoiceNumber: string | null;
  /** The covering invoice is a consolidated one (חשבונית ריכוז). */
  consolidated: boolean;
}

interface NoteRow {
  gr_id: string;
  po_id: string | null;
  po_ref: string | null;
  received_at: Date | string;
  note_number: string | null;
  mr_invoice_id: string | null;
  mr_invoice_number: string | null;
  [k: string]: unknown;
}

interface CandidateInvoice {
  id: string;
  invoice_number: string | null;
  invoice_date: Date | string | null;
  status: string;
  has_run: boolean;
  kind: string | null;
  period_start: string | null;
  period_end: string | null;
  note_numbers: string[] | string | null;
  [k: string]: unknown;
}

const SETTLED = new Set(['matched', 'approved', 'paid']);
const DAY = 86_400_000;

const asArray = (v: string[] | string | null): string[] =>
  v == null ? [] : Array.isArray(v) ? v : v.replace(/^\{|\}$/g, '').split(',').filter(Boolean);

/** The calendar month of `at` in `tz`, widened by ± 3 days, as instants. */
function monthWindow(at: Date, tz: string): [number, number] {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' }).formatToParts(at).map((x) => [x.type, x.value]),
  );
  const y = Number(p.year);
  const m = Number(p.month);
  return [Date.UTC(y, m - 1, 1) - 3 * DAY - 3 * 3600_000, Date.UTC(y, m, 1) + 3 * DAY];
}

export async function deliveryNoteCoverage(
  db: Database,
  restaurantId: string,
  supplierId: string,
  from: Date,
  to: Date,
): Promise<DeliveryNoteCoverage[]> {
  const [r] = await db.select({ tz: restaurants.timezone }).from(restaurants).where(eq(restaurants.id, restaurantId)).limit(1);
  const tz = r?.tz ?? 'Asia/Jerusalem';

  const notes = (await db.execute(sql`
    SELECT gr.id AS gr_id, gr.po_id, COALESCE(po.source_ref, po.customer_ref) AS po_ref, gr.received_at,
           substring(gr.notes from 'ת\\.מ\\.\\s*([0-9A-Za-z-]+)') AS note_number,
           link.invoice_id AS mr_invoice_id, link.invoice_number AS mr_invoice_number
    FROM goods_receipts gr
    JOIN purchase_orders po ON po.id = gr.po_id AND po.restaurant_id = gr.restaurant_id
    LEFT JOIN LATERAL (
      SELECT mr.invoice_id, i.invoice_number
      FROM match_runs mr JOIN invoices i ON i.id = mr.invoice_id AND i.restaurant_id = mr.restaurant_id
      WHERE mr.restaurant_id = gr.restaurant_id AND mr.invoice_id IS NOT NULL
        AND (mr.gr_id = gr.id OR mr.po_id = gr.po_id)
      ORDER BY mr.run_at DESC LIMIT 1
    ) link ON true
    WHERE gr.restaurant_id = ${restaurantId}::uuid
      AND po.supplier_id = ${supplierId}::uuid
      AND gr.status <> 'pending'
      AND gr.received_at >= ${from.toISOString()}::timestamptz AND gr.received_at < ${to.toISOString()}::timestamptz
    ORDER BY gr.received_at, gr.id
  `)) as unknown as NoteRow[];
  if (notes.length === 0) return [];

  const ids = notes.map((n) => n.gr_id);
  const lines = (await db.execute(sql`
    SELECT gl.gr_id, gl.qty_received::text AS qty, pl.unit_price_expected::text AS price
    FROM gr_lines gl JOIN po_lines pl ON pl.id = gl.po_line_id
    WHERE gl.gr_id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
  `)) as unknown as Array<{ gr_id: string; qty: string; price: string | null }>;
  const value = new Map<string, number>();
  for (const l of lines) {
    if (l.price == null) continue;
    value.set(l.gr_id, (value.get(l.gr_id) ?? 0) + (lineTotalAgorot(l.qty, l.price) ?? 0));
  }

  // Invoices that can hold notes without a match run: consolidated ones (any status),
  // dated up to a month after the window (a month-end invoice can come late).
  const candidates = (await db.execute(sql`
    SELECT i.id, i.invoice_number, i.invoice_date, i.status::text AS status,
           EXISTS (SELECT 1 FROM match_runs mr WHERE mr.invoice_id = i.id AND mr.restaurant_id = i.restaurant_id) AS has_run,
           i.ocr_payload->'raw'->>'kind' AS kind,
           i.ocr_payload->'raw'->>'periodStart' AS period_start,
           i.ocr_payload->'raw'->>'periodEnd' AS period_end,
           ARRAY(SELECT jsonb_array_elements(i.ocr_payload->'raw'->'deliveryNotes')->>'number'
                 WHERE jsonb_typeof(i.ocr_payload->'raw'->'deliveryNotes') = 'array') AS note_numbers
    FROM invoices i
    WHERE i.restaurant_id = ${restaurantId}::uuid AND i.supplier_id = ${supplierId}::uuid
      AND i.status <> 'ocr_pending'
      AND i.invoice_date >= ${new Date(from.getTime() - 35 * DAY).toISOString()}::timestamptz
      AND i.invoice_date < ${new Date(to.getTime() + 35 * DAY).toISOString()}::timestamptz
  `)) as unknown as CandidateInvoice[];
  const consolidated = candidates.filter((c) => c.kind === 'consolidated');
  const byNumber = new Map<string, CandidateInvoice>();
  for (const c of consolidated) for (const n of asArray(c.note_numbers)) byNumber.set(n, c);
  const periodOf = (c: CandidateInvoice): [number, number] | null => {
    if (c.period_start && c.period_end) {
      return [Date.parse(`${c.period_start}T00:00:00Z`) - 3 * 3600_000, Date.parse(`${c.period_end}T23:59:59Z`)];
    }
    return c.invoice_date ? monthWindow(new Date(c.invoice_date), tz) : null;
  };

  const isConsolidated = (c: CandidateInvoice) => c.kind === 'consolidated';
  const stateOf = (c: CandidateInvoice) => (SETTLED.has(c.status) ? ('covered' as const) : ('in_consolidated' as const));
  const consolidatedById = new Set(candidates.filter(isConsolidated).map((c) => c.id));

  return notes.map((n) => {
    const base = {
      grId: n.gr_id,
      poId: n.po_id,
      number: n.note_number,
      poRef: n.po_ref,
      receivedAt: new Date(n.received_at).toISOString(),
      receivedValueIls: (value.get(n.gr_id) ?? 0) / 100,
    };
    // 1. Listed by number on a consolidated invoice.
    const listed = n.note_number ? byNumber.get(n.note_number) : undefined;
    if (listed) {
      return { ...base, state: stateOf(listed), invoiceId: listed.id, invoiceNumber: listed.invoice_number, consolidated: true };
    }
    // 2. Used by a match run (GR or PO).
    if (n.mr_invoice_id) {
      return {
        ...base,
        state: 'covered' as const,
        invoiceId: n.mr_invoice_id,
        invoiceNumber: n.mr_invoice_number,
        consolidated: consolidatedById.has(n.mr_invoice_id),
      };
    }
    // 3. Held by the period of a consolidated invoice that lists no notes.
    const at = new Date(n.received_at).getTime();
    const holder = consolidated.find((c) => {
      if (isConsolidated(c) && asArray(c.note_numbers).length > 0) return false;
      const p = periodOf(c);
      return p != null && at >= p[0] && at <= p[1];
    });
    if (holder) {
      return { ...base, state: stateOf(holder), invoiceId: holder.id, invoiceNumber: holder.invoice_number, consolidated: isConsolidated(holder) };
    }
    return { ...base, state: 'not_invoiced' as const, invoiceId: null, invoiceNumber: null, consolidated: false };
  });
}

/** Invoices tagged consolidated on the document itself (ocr_payload.raw.kind). */
export async function consolidatedInvoiceIds(db: Database, restaurantId: string, invoiceIds: string[]): Promise<Set<string>> {
  if (invoiceIds.length === 0) return new Set();
  const rows = (await db.execute(sql`
    SELECT id FROM invoices
    WHERE restaurant_id = ${restaurantId}::uuid AND ocr_payload->'raw'->>'kind' = 'consolidated'
      AND id IN (${sql.join(invoiceIds.map((id) => sql`${id}::uuid`), sql`, `)})
  `)) as unknown as Array<{ id: string }>;
  return new Set(rows.map((r) => r.id));
}
