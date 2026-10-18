/**
 * The CHECK constraints added by migration 0032_integrity_checks, as data.
 *
 * Kept here (not only in the SQL) so `pnpm db:doctor` can count would-be
 * violators on a database that has NOT applied 0032 yet, and so the migration
 * shape test can assert the SQL file and this list never drift apart.
 *
 * Every constraint is added NOT VALID (enforced for new/updated rows at once,
 * never fails the migration) and then validated only when no existing row
 * violates it. A constraint left unvalidated is reported by the doctor (WARN)
 * with its violator count so the owner can repair and run
 * `ALTER TABLE … VALIDATE CONSTRAINT …` later.
 *
 * Only invariants the code already assumes are listed. Deliberately absent:
 * sign checks on invoice qty/prices/line totals (credit notes and discount
 * lines are legitimately negative) and on discrepancy deltas (signed).
 */
export interface IntegrityCheck {
  table: string;
  name: string;
  /** SQL boolean expression over the row; NULL-tolerant where the column is nullable. */
  expr: string;
}

const rate = (col: string) => `${col} IS NULL OR (${col} >= 0 AND ${col} <= 1)`;

export const INTEGRITY_CHECKS: readonly IntegrityCheck[] = [
  { table: 'restaurants', name: 'restaurants_vat_rate_range', expr: 'vat_rate >= 0 AND vat_rate <= 1' },
  { table: 'suppliers', name: 'suppliers_vat_rate_range', expr: rate('vat_rate') },
  { table: 'purchase_orders', name: 'purchase_orders_vat_rate_range', expr: rate('vat_rate') },
  { table: 'invoice_lines', name: 'invoice_lines_vat_rate_range', expr: rate('vat_rate') },
  { table: 'po_lines', name: 'po_lines_qty_ordered_nonneg', expr: 'qty_ordered >= 0' },
  { table: 'po_lines', name: 'po_lines_unit_price_nonneg', expr: 'unit_price_expected IS NULL OR unit_price_expected >= 0' },
  { table: 'gr_lines', name: 'gr_lines_qty_received_nonneg', expr: 'qty_received >= 0' },
  { table: 'gr_lines', name: 'gr_lines_qty_rejected_nonneg', expr: 'qty_rejected >= 0' },
  { table: 'invoices', name: 'invoices_ocr_confidence_range', expr: rate('ocr_confidence') },
  { table: 'invoices', name: 'invoices_currency_iso', expr: "currency ~ '^[A-Z]{3}$'" },
  { table: 'invoice_lines', name: 'invoice_lines_ocr_confidence_range', expr: rate('ocr_confidence_line') },
  { table: 'product_aliases', name: 'product_aliases_confidence_range', expr: rate('confidence') },
  { table: 'supplier_catalog_items', name: 'supplier_catalog_items_list_price_nonneg', expr: 'list_price IS NULL OR list_price >= 0' },
  { table: 'supplier_catalog_items', name: 'supplier_catalog_items_pack_size_pos', expr: 'pack_size IS NULL OR pack_size > 0' },
  { table: 'price_history', name: 'price_history_unit_price_nonneg', expr: 'unit_price >= 0' },
  { table: 'price_baselines', name: 'price_baselines_window_pos', expr: 'window_days > 0 AND sample_size >= 0' },
  { table: 'match_runs', name: 'match_runs_total_discrepancy_nonneg', expr: 'total_discrepancy_amount >= 0' },
  { table: 'notifications_outbox', name: 'notifications_outbox_attempts_nonneg', expr: 'attempt_count >= 0' },
  { table: 'usage_counters', name: 'usage_counters_used_nonneg', expr: 'used >= 0' },
  { table: 'usage_counters', name: 'usage_counters_period_format', expr: "period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'" },
  { table: 'plans', name: 'plans_price_nonneg', expr: 'price_agorot_monthly >= 0' },
];
