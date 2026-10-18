import type postgres from 'postgres';

/**
 * Realistic rows for a database frozen at migration 0018 (production's level),
 * written with raw SQL against the 0018 column set — the Drizzle schema in
 * schema.ts describes the LATEST shape and cannot insert into an old one.
 *
 * Besides ordinary tenant data (2 restaurants, owners, suppliers, products,
 * a platform-imported PO with lines, a receipt, an invoice, a match run with a
 * discrepancy, price history), it plants exactly the edge cases each later
 * migration's guard exists for:
 *
 *   0020  a walk-in invoice_scans row with NULL restaurant_id
 *   0021  a product in B pointing at A's supplier
 *   0027  a second goods receipt for A's PO (+ restaurant A still at VAT 0.17)
 *   0032  a gr_lines row with a negative qty_received (constraint stays NOT VALID)
 *
 * and the I5 situation: A owns supplier/PO refs `mm-sup-1` / `mm-po-1` on
 * marketman that B will legitimately reuse after 0029.
 */

type Sql = postgres.Sql<Record<string, unknown>>;

export interface Fixture0018 {
  restaurantA: string;
  restaurantB: string;
  supplierA: string;
  supplierB: string;
  poA: string;
  keptReceipt: string;
  duplicateReceipt: string;
  badGrLine: string;
  crossTenantProduct: string;
}

export const FIXTURE_REFS = { platform: 'marketman', supplierRef: 'mm-sup-1', poRef: 'mm-po-1' } as const;

export async function seedFixture0018(sql: Sql, opts: { offenders?: boolean } = {}): Promise<Fixture0018> {
  const offenders = opts.offenders ?? true;
  const one = async <T = string>(q: Promise<unknown>): Promise<T> => {
    const rows = (await q) as Array<{ id: T }>;
    return rows[0]!.id;
  };

  const restaurantA = await one(sql`
    insert into restaurants (name, business_id, vat_rate, updated_at)
    values ('upgrade-A', '510000001', 0.17, now() - interval '30 days') returning id`);
  const restaurantB = await one(sql`
    insert into restaurants (name, business_id) values ('upgrade-B', '510000002') returning id`);

  for (const [r, email] of [[restaurantA, 'owner-a@upgrade.test'], [restaurantB, 'owner-b@upgrade.test']] as const) {
    const u = await one(sql`insert into users (email, name) values (${email}, 'owner') returning id`);
    await sql`insert into memberships (user_id, restaurant_id, role) values (${u}, ${r}, 'owner')`;
  }

  const supplierA = await one(sql`
    insert into suppliers (restaurant_id, name, source_platform, external_ref)
    values (${restaurantA}, 'ירקני אבי', ${FIXTURE_REFS.platform}, ${FIXTURE_REFS.supplierRef}) returning id`);
  const supplierB = await one(sql`
    insert into suppliers (restaurant_id, name) values (${restaurantB}, 'קצביית הכרם') returning id`);

  const tomato = await one(sql`
    insert into products (restaurant_id, canonical_name, default_unit, supplier_id)
    values (${restaurantA}, 'עגבניה שרי', 'ק״ג', ${supplierA}) returning id`);

  const poA = await one(sql`
    insert into purchase_orders (restaurant_id, supplier_id, status, source, source_platform, source_ref, expected_delivery_at)
    values (${restaurantA}, ${supplierA}, 'sent', 'platform', ${FIXTURE_REFS.platform}, ${FIXTURE_REFS.poRef}, now()) returning id`);
  const poLine = await one(sql`
    insert into po_lines (po_id, product_id, raw_description, qty_ordered, unit, unit_price_expected)
    values (${poA}, ${tomato}, 'עגבניה שרי', 10, 'ק״ג', 8.50) returning id`);

  const keptReceipt = await one(sql`
    insert into goods_receipts (restaurant_id, po_id, status, received_at)
    values (${restaurantA}, ${poA}, 'completed', now() - interval '2 hours') returning id`);
  const grLine = await one(sql`
    insert into gr_lines (gr_id, po_line_id, product_id, qty_received)
    values (${keptReceipt}, ${poLine}, ${tomato}, 10) returning id`);

  const invoice = await one(sql`
    insert into invoices (restaurant_id, supplier_id, invoice_number, status, source, total_excl_vat, vat_amount, total_incl_vat)
    values (${restaurantA}, ${supplierA}, 'INV-1', 'matched', 'photo', 90.00, 15.30, 105.30) returning id`);
  const invLine = await one(sql`
    insert into invoice_lines (invoice_id, product_id, raw_description, qty_billed, unit, unit_price_billed, line_total)
    values (${invoice}, ${tomato}, 'עגבניה שרי', 10, 'ק״ג', 9.00, 90.00) returning id`);
  const run = await one(sql`
    insert into match_runs (restaurant_id, po_id, gr_id, invoice_id, overall_status, total_discrepancy_amount)
    values (${restaurantA}, ${poA}, ${keptReceipt}, ${invoice}, 'minor', 5.00) returning id`);
  await sql`
    insert into discrepancies (match_run_id, restaurant_id, type, severity, product_id, po_line_id, gr_line_id, invoice_line_id, delta_amount)
    values (${run}, ${restaurantA}, 'PRICE_HIGHER', 'warn', ${tomato}, ${poLine}, ${grLine}, ${invLine}, 5.00)`;
  await sql`
    insert into price_history (restaurant_id, product_id, supplier_id, observed_at, unit_price, qty, source_invoice_id)
    values (${restaurantA}, ${tomato}, ${supplierA}, now(), 9.00, 10, ${invoice})`;
  await sql`
    insert into invoice_scans (invoice_id, restaurant_id, storage_path, mime_type)
    values (${invoice}, ${restaurantA}, ${restaurantA + '/inv-1.jpg'}, 'image/jpeg')`;

  let duplicateReceipt = '';
  let badGrLine = '';
  let crossTenantProduct = '';
  if (offenders) {
    // 0027: a double-tap created a second, empty receipt for the same PO.
    duplicateReceipt = await one(sql`
      insert into goods_receipts (restaurant_id, po_id, status, received_at)
      values (${restaurantA}, ${poA}, 'pending', now() - interval '1 hour') returning id`);
    // 0032: a corrupt negative quantity (repairs leave it — the CHECK stays NOT VALID).
    badGrLine = await one(sql`
      insert into gr_lines (gr_id, po_line_id, product_id, qty_received)
      values (${keptReceipt}, ${poLine}, ${tomato}, -1) returning id`);
    // 0021: B's product points at A's supplier.
    crossTenantProduct = await one(sql`
      insert into products (restaurant_id, canonical_name, supplier_id)
      values (${restaurantB}, 'מוצר חוצה דיירים', ${supplierA}) returning id`);
    // 0020: an anonymous showcase scan with no tenant.
    const walkInInvoice = await one(sql`
      insert into invoices (restaurant_id, status, source) values (${restaurantA}, 'ocr_pending', 'photo') returning id`);
    await sql`
      insert into invoice_scans (invoice_id, restaurant_id, storage_path, mime_type)
      values (${walkInInvoice}, null, 'walk-ins/demo.pdf', 'application/pdf')`;
  }

  return {
    restaurantA,
    restaurantB,
    supplierA,
    supplierB,
    poA,
    keptReceipt,
    duplicateReceipt,
    badGrLine,
    crossTenantProduct,
  };
}
