import { sql, type Database } from '@restomatch/db';
import { lineTotalAgorot } from '../orders/document/build';

/**
 * Delivery-note ↔ invoice coverage for the supplier ledger.
 *
 * Contract agreed with S3 (money engine): their `deliveryNoteCoverage` in
 * packages/api/src/match/consolidated.ts returns this shape, including the
 * consolidated cross-match `proposed` links. Until it lands this is the
 * PO-linked stub: a delivery note is `invoiced` when a match run links its
 * goods receipt to an invoice, otherwise `none`; an invoice is consolidated
 * when it covers two or more delivery notes. Swap the import when S3's ships.
 */
export type NoteCoverage =
  | { kind: 'invoiced'; invoiceId: string; invoiceNumber: string | null }
  | { kind: 'proposed'; invoiceId: string; invoiceNumber: string | null }
  | { kind: 'none' };

export interface DeliveryNote {
  grId: string;
  poId: string | null;
  supplierId: string;
  receivedAt: Date;
  /** Σ qty_received × po_lines.unit_price_expected, before VAT, integer agorot (half-up per line). */
  valueAgorot: number;
  coverage: NoteCoverage;
}

export interface CoveredInvoice {
  invoiceId: string;
  consolidated: boolean;
  grIds: string[];
}

interface NoteRow {
  gr_id: string;
  po_id: string | null;
  supplier_id: string;
  received_at: Date | string;
  invoice_id: string | null;
  invoice_number: string | null;
  [k: string]: unknown;
}

/**
 * `supplierId` null = every supplier of the restaurant (the all-suppliers grid).
 * Window: notes by received_at, invoices by invoice_date, [from, to).
 */
export async function deliveryNoteCoverage(
  db: Database,
  restaurantId: string,
  supplierId: string | null,
  from: Date,
  to: Date,
): Promise<{ notes: DeliveryNote[]; invoices: CoveredInvoice[] }> {
  const supplierCond = supplierId ? sql`AND po.supplier_id = ${supplierId}::uuid` : sql``;
  const notes = (await db.execute(sql`
    SELECT gr.id AS gr_id, gr.po_id, po.supplier_id, gr.received_at,
           link.invoice_id, link.invoice_number
    FROM goods_receipts gr
    JOIN purchase_orders po ON po.id = gr.po_id AND po.restaurant_id = gr.restaurant_id
    LEFT JOIN LATERAL (
      SELECT mr.invoice_id, i.invoice_number
      FROM match_runs mr JOIN invoices i ON i.id = mr.invoice_id AND i.restaurant_id = mr.restaurant_id
      WHERE mr.restaurant_id = gr.restaurant_id AND mr.gr_id = gr.id AND mr.invoice_id IS NOT NULL
      ORDER BY mr.run_at DESC LIMIT 1
    ) link ON true
    WHERE gr.restaurant_id = ${restaurantId}::uuid
      AND gr.status <> 'pending'
      AND gr.received_at >= ${from.toISOString()}::timestamptz AND gr.received_at < ${to.toISOString()}::timestamptz
      ${supplierCond}
    ORDER BY gr.received_at
  `)) as unknown as NoteRow[];

  const ids = notes.map((n) => n.gr_id);
  const lines = ids.length
    ? ((await db.execute(sql`
        SELECT gl.gr_id, gl.qty_received::text AS qty, pl.unit_price_expected::text AS price
        FROM gr_lines gl JOIN po_lines pl ON pl.id = gl.po_line_id
        WHERE gl.gr_id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
      `)) as unknown as Array<{ gr_id: string; qty: string; price: string | null }>)
    : [];
  const value = new Map<string, number>();
  for (const l of lines) {
    if (l.price == null) continue;
    value.set(l.gr_id, (value.get(l.gr_id) ?? 0) + (lineTotalAgorot(l.qty, l.price) ?? 0));
  }

  const invSupplierCond = supplierId ? sql`AND i.supplier_id = ${supplierId}::uuid` : sql``;
  const invRows = (await db.execute(sql`
    SELECT i.id AS invoice_id,
           COALESCE(array_agg(DISTINCT mr.gr_id) FILTER (WHERE mr.gr_id IS NOT NULL), '{}') AS gr_ids
    FROM invoices i
    LEFT JOIN match_runs mr ON mr.invoice_id = i.id AND mr.restaurant_id = i.restaurant_id
    WHERE i.restaurant_id = ${restaurantId}::uuid AND i.status <> 'ocr_pending'
      AND i.invoice_date >= ${from.toISOString()}::timestamptz AND i.invoice_date < ${to.toISOString()}::timestamptz
      ${invSupplierCond}
    GROUP BY i.id
  `)) as unknown as Array<{ invoice_id: string; gr_ids: string[] | string }>;
  const asArray = (v: string[] | string): string[] =>
    Array.isArray(v) ? v : v.replace(/^\{|\}$/g, '').split(',').filter(Boolean);

  return {
    notes: notes.map((n) => ({
      grId: n.gr_id,
      poId: n.po_id,
      supplierId: n.supplier_id,
      receivedAt: new Date(n.received_at),
      valueAgorot: value.get(n.gr_id) ?? 0,
      coverage: n.invoice_id
        ? { kind: 'invoiced', invoiceId: n.invoice_id, invoiceNumber: n.invoice_number }
        : { kind: 'none' },
    })),
    invoices: invRows.map((r) => {
      const grIds = asArray(r.gr_ids);
      return { invoiceId: r.invoice_id, consolidated: grIds.length >= 2, grIds };
    }),
  };
}
