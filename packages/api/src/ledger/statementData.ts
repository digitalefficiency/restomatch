import { and, creditNotes, eq, sql, type Database } from '@restomatch/db';
import { decimalToScaled } from '../orders/document/build';
import { listClaims } from '../recovery/service';
import { assertSupplierOwned } from '../tenant';
import { deliveryNoteCoverage } from './coverage';
import { reconcileStatement, type OurInvoice, type StatementLine, type StatementResult } from './statement';

/** How far around the statement's own dates we look for our invoices and credit notes. */
const SLACK_DAYS = 120;
const DAY = 86_400_000;

/**
 * W3-11 · Reconcile one supplier's statement (כרטסת) against what this
 * restaurant holds. Stateless: the statement is not stored (no table yet —
 * H-04/H-13 addendum). Tenant-scoped; a foreign supplier → NOT_FOUND.
 */
export async function reconcileSupplierStatement(
  db: Database,
  restaurantId: string,
  supplierId: string,
  lines: readonly StatementLine[],
  now = new Date(),
): Promise<StatementResult> {
  await assertSupplierOwned(db, supplierId, restaurantId);
  const dates = lines.map((l) => l.date).filter((d): d is string => !!d).sort();
  const fromDay = dates[0] ? Date.parse(`${dates[0]}T00:00:00Z`) : now.getTime() - 365 * DAY;
  const toDay = dates.length ? Date.parse(`${dates[dates.length - 1]}T00:00:00Z`) : now.getTime();
  const from = new Date(fromDay - SLACK_DAYS * DAY);
  const to = new Date(toDay + SLACK_DAYS * DAY);

  const [invoiceRows, notes, coverage, claims] = await Promise.all([
    db.execute(sql`
      SELECT id, invoice_number,
             -- The restaurant's calendar day (invoice_date is stored at 00:00Z; created_at is a real instant).
             to_char(COALESCE(invoice_date, created_at) AT TIME ZONE
               (SELECT COALESCE(timezone, 'Asia/Jerusalem') FROM restaurants WHERE id = ${restaurantId}::uuid),
               'YYYY-MM-DD') AS invoice_date,
             status::text AS status, total_incl_vat::text AS total_incl_vat
      FROM invoices
      WHERE restaurant_id = ${restaurantId}::uuid AND supplier_id = ${supplierId}::uuid
        AND COALESCE(invoice_date, created_at) >= ${from.toISOString()}::timestamptz
        AND COALESCE(invoice_date, created_at) < ${to.toISOString()}::timestamptz
      ORDER BY invoice_date NULLS LAST
      LIMIT 5000
    `),
    db
      .select({
        id: creditNotes.id,
        number: creditNotes.number,
        issuedOn: creditNotes.issuedOn,
        amountAgorot: creditNotes.amountAgorot,
      })
      .from(creditNotes)
      .where(
        and(
          eq(creditNotes.restaurantId, restaurantId),
          eq(creditNotes.supplierId, supplierId),
          sql`${creditNotes.issuedOn} >= ${from.toISOString().slice(0, 10)}::date`,
          sql`${creditNotes.issuedOn} < ${to.toISOString().slice(0, 10)}::date`,
        ),
      ),
    deliveryNoteCoverage(db, restaurantId, supplierId, from, to),
    listClaims(db, restaurantId, { supplierId, status: 'acknowledged', limit: null }),
  ]);

  // A restaurant that never receives this supplier's goods in the app has no
  // delivery notes at all: "billed, not received" would then be noise.
  const receives = coverage.length > 0;
  const covered = new Set(coverage.map((n) => n.invoiceId).filter(Boolean) as string[]);
  const rows = (Array.isArray(invoiceRows) ? invoiceRows : ((invoiceRows as { rows?: unknown[] }).rows ?? [])) as Array<
    Record<string, string | null>
  >;
  const invoices: OurInvoice[] = rows.map((r) => ({
    id: String(r.id),
    number: r.invoice_number ?? null,
    date: r.invoice_date ?? null,
    inclVatAgorot: decimalToScaled(r.total_incl_vat, 2),
    hasDeliveryNote: receives ? covered.has(String(r.id)) : null,
    paid: r.status === 'paid',
    pending: r.status === 'ocr_pending',
  }));
  const agreedOpenAgorot = claims
    .filter((c) => c.supplierId === supplierId && c.status === 'acknowledged')
    .reduce((s, c) => s + c.outstandingAgorot, 0);

  return reconcileStatement({ lines, invoices, creditNotes: notes, agreedOpenAgorot });
}
