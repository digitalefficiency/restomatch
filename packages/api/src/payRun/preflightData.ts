/**
 * AU-14 · One batched reader for the pay-run pre-flight. Read-only: no audit row, no update.
 *
 * Query 1 (always) reads the candidates AND their suppliers' whole invoice history in one
 * statement. Query 2 (the bank source) reads bank changes + owner confirmations. There is
 * no per-invoice query (no N+1): ≤ 3 queries for any batch size.
 *
 * On main today:
 *  • "paid" = `status = 'paid'` (H-03 adds `invoices.paid_at`; `paidAt` stays null until then:
 *    such a supplier counts as paid before, and the bank rule uses the 90-day window);
 *  • the candidates are the unpaid invoices past OCR (W2-03's INVOICE_CHECKED replaces this on merge);
 *  • bank changes come from a BankChangeSource. Until H-03's `supplier_bank_account_changes`
 *    and W2-11's form exist there are none, so `bank_changed` cannot fire yet. The rule itself is
 *    always on (AD12) and is tested pure.
 */
import { sql, type Database } from '@restomatch/db';
import {
  parseAgorot,
  preflightFlags,
  summarize,
  type BankChange,
  type PreflightFacts,
  type PreflightFlag,
  type PreflightInvoice,
  type PreflightSummary,
} from './preflight';

type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] => (Array.isArray(res) ? (res as Row[]) : ((res as { rows?: Row[] }).rows ?? []));
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const str = (v: unknown): string | null => (v == null ? null : String(v));

/** Where bank changes and owner confirmations come from (H-03 tables + the audit, later). */
export interface BankChangeSource {
  read(
    db: Database,
    restaurantId: string,
    supplierIds: string[],
  ): Promise<{ changes: BankChange[]; confirmedChangeIds: Set<string> }>;
}

/** Until H-03 is deployed: no bank-account changes exist, and none is confirmed. */
export const noBankChanges: BankChangeSource = {
  async read() {
    return { changes: [], confirmedChangeIds: new Set() };
  },
};

export interface PreflightRead {
  facts: PreflightFacts;
  /** Query count, for the no-N+1 test. */
  queries: number;
}

export async function readPreflightFacts(
  db: Database,
  restaurantId: string,
  opts: { invoiceIds?: string[]; now?: Date; tz?: string; bank?: BankChangeSource } = {},
): Promise<PreflightRead> {
  const rid = restaurantId;
  const ids = opts.invoiceIds;
  const idFilter =
    ids && ids.length > 0
      ? sql`AND c.id IN (${sql.join(
          ids.map((i) => sql`${i}::uuid`),
          sql`, `,
        )})`
      : sql``;
  const res = await db.execute(sql`
    WITH cand AS (
      SELECT c.id FROM invoices c
      WHERE c.restaurant_id = ${rid}
        AND c.status NOT IN ('paid', 'ocr_pending')
        ${idFilter}
    ),
    sup AS (
      SELECT DISTINCT i.supplier_id FROM invoices i
      WHERE i.restaurant_id = ${rid} AND i.id IN (SELECT id FROM cand) AND i.supplier_id IS NOT NULL
    )
    SELECT i.id, i.supplier_id, s.name AS supplier_name, i.invoice_number,
           COALESCE(i.invoice_date, i.created_at) AS at, i.total_incl_vat, i.status, i.source,
           i.ocr_payload -> 'duplicateOf' ->> 'invoiceId' AS dup_of_id,
           i.ocr_payload -> 'duplicateOf' ->> 'basis' AS dup_of_basis,
           (i.ocr_payload -> 'duplicateOf') IS NOT NULL AND jsonb_typeof(i.ocr_payload -> 'duplicateOf') = 'object' AS has_dup_of,
           (i.id IN (SELECT id FROM cand)) AS is_candidate,
           EXISTS (
             SELECT 1 FROM match_runs mr
             JOIN discrepancies d ON d.match_run_id = mr.id AND d.restaurant_id = ${rid}
             WHERE mr.invoice_id = i.id AND mr.restaurant_id = ${rid}
               AND d.type = 'DUPLICATE_INVOICE' AND d.resolution_status IN ('open', 'escalated', 'accepted')
           ) AS held_dup
    FROM invoices i
    LEFT JOIN suppliers s ON s.id = i.supplier_id AND s.restaurant_id = ${rid}
    WHERE i.restaurant_id = ${rid}
      AND (i.id IN (SELECT id FROM cand) OR i.supplier_id IN (SELECT supplier_id FROM sup))
  `);
  let queries = 1;

  const history: PreflightInvoice[] = [];
  const candidates: PreflightInvoice[] = [];
  for (const r of rowsOf(res)) {
    const inv: PreflightInvoice = {
      id: String(r.id),
      supplierId: str(r.supplier_id),
      supplierName: str(r.supplier_name),
      invoiceNumber: str(r.invoice_number),
      invoiceDate: iso(r.at),
      totalAgorot: parseAgorot(r.total_incl_vat),
      status: String(r.status),
      source: String(r.source),
      paidAt: null, // H-03 `paid_at`
      duplicateOf: r.has_dup_of === true ? { invoiceId: str(r.dup_of_id), basis: str(r.dup_of_basis) } : null,
      heldAsDuplicate: r.held_dup === true,
    };
    history.push(inv);
    if (r.is_candidate === true) candidates.push(inv);
  }

  const supplierIds = [...new Set(candidates.map((c) => c.supplierId).filter((s): s is string => s != null))];
  const bank = opts.bank ?? noBankChanges;
  let changes: BankChange[] = [];
  let confirmedChangeIds = new Set<string>();
  if (supplierIds.length > 0 && bank !== noBankChanges) {
    const b = await bank.read(db, rid, supplierIds);
    // Only the last 4 digits ever leave this layer, whatever the source passes in.
    changes = b.changes.map((c) => {
      const last4 = (c.accountLast4 ?? '').replace(/\D/g, '').slice(-4);
      return { ...c, accountLast4: /^\d{4}$/.test(last4) ? last4 : null };
    });
    confirmedChangeIds = b.confirmedChangeIds;
    queries += 1;
  }

  return {
    facts: {
      candidates,
      history,
      bankChanges: changes,
      confirmedChangeIds,
      now: opts.now ?? new Date(),
      tz: opts.tz,
    },
    queries,
  };
}

export interface PreflightResult {
  flags: Map<string, PreflightFlag[]>;
  summary: PreflightSummary;
  candidates: PreflightInvoice[];
  queries: number;
}

export async function runPreflight(
  db: Database,
  restaurantId: string,
  opts: Parameters<typeof readPreflightFacts>[2] = {},
): Promise<PreflightResult> {
  const { facts, queries } = await readPreflightFacts(db, restaurantId, opts);
  const flags = preflightFlags(facts);
  return { flags, summary: summarize(flags), candidates: facts.candidates, queries };
}
