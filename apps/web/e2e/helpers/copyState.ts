import type { Sql } from 'postgres';

/**
 * W2-16's own measured state (copy budget). The budget counts chrome, and some chrome only shows
 * when certain data exists: "N מוצרים מחכים לשאלה", a pay-run due bucket, "N בלי תאריך לא ייכללו",
 * the leaks cap note, "ממתין לאחרים", the VAT / duplicate lines under the approvals tiles, the
 * hero's "ממתינות לשיוך" lines, the receiving board's summary and next truck. Whether the seed or
 * an earlier spec happens to leave such rows behind — and which pay-run week or receiving day the
 * seed's dates fall in today — must not move the count. So W2-16 makes every one of these sections
 * PRESENT with its own rows, dated relative to the database clock (Israel calendar) when beforeAll
 * runs, and removes them in afterAll so later specs see the demo tenant as before.
 *
 * Every row is tagged: invoices by the `W216-` number prefix, the order by its notes. Seeding first
 * clears the tag, so a worker restart (Playwright re-runs beforeAll after a failure) stays one set.
 */
export const COPY_STATE_INVOICE_PREFIX = 'W216-';
export const COPY_STATE_PO_NOTE = 'e2e-w2-16';

/** Today on the restaurant's wall clock (Asia/Jerusalem), from the DB clock — never a fixed date. */
const IL_TODAY = `(now() at time zone 'Asia/Jerusalem')::date`;
/** Noon (Israel) of today + k days: a due day that lands in one pay-run bucket on any weekday. */
const ilNoon = (k: number) => `(((${IL_TODAY} + ${k})::timestamp + interval '12 hours') at time zone 'Asia/Jerusalem')`;
/** An invoice date inside today's Israel day, never in the future. */
const INVOICE_AT = `greatest(now() - interval '5 minutes', ${IL_TODAY}::timestamp at time zone 'Asia/Jerusalem')`;
/** A truck later today, but never past today's Israel midnight (the board lists today's deliveries). */
const TRUCK_AT = `least(now() + interval '1 hour', (${IL_TODAY} + 1)::timestamp at time zone 'Asia/Jerusalem' - interval '5 minutes')`;

type Finding = {
  type: 'PRICE_HIGHER' | 'VAT_MISMATCH' | 'DUPLICATE_INVOICE';
  delta: number;
  expected: number;
  actual: number;
  role: 'manager' | null;
  /** SQL timestamptz expression (default now()). */
  createdAt?: string;
  /** Default 'open' (waiting for a decision). */
  status?: 'open' | 'rejected';
};

export async function clearCopyState(sql: Sql, restaurantId: string): Promise<void> {
  const inv = await sql<{ id: string }[]>`
    select id from invoices where restaurant_id = ${restaurantId} and invoice_number like ${`${COPY_STATE_INVOICE_PREFIX}%`}`;
  const invIds = inv.map((r) => r.id);
  if (invIds.length) {
    // A decision taken on a fixture row during the run would hold a claim: it goes with the row.
    await sql`delete from recovery_claims where restaurant_id = ${restaurantId} and discrepancy_id in (
                select d.id from discrepancies d join match_runs mr on mr.id = d.match_run_id
                where mr.invoice_id in ${sql(invIds)})`;
    await sql`delete from match_runs where restaurant_id = ${restaurantId} and invoice_id in ${sql(invIds)}`; // discrepancies cascade
    await sql`delete from invoices where restaurant_id = ${restaurantId} and id in ${sql(invIds)}`; // lines cascade
  }
  const po = await sql<{ id: string }[]>`
    select id from purchase_orders where restaurant_id = ${restaurantId} and notes = ${COPY_STATE_PO_NOTE}`;
  const poIds = po.map((r) => r.id);
  if (poIds.length) {
    await sql`delete from gr_lines where gr_id in (select id from goods_receipts where po_id in ${sql(poIds)})`;
    await sql`delete from goods_receipts where restaurant_id = ${restaurantId} and po_id in ${sql(poIds)}`;
    await sql`delete from purchase_orders where restaurant_id = ${restaurantId} and id in ${sql(poIds)}`; // po_lines cascade
  }
}

export async function seedCopyState(sql: Sql, restaurantId: string): Promise<void> {
  await clearCopyState(sql, restaurantId);
  const rid = restaurantId;
  const [sup] = await sql<{ id: string }[]>`select id from suppliers where restaurant_id = ${rid} order by name limit 1`;
  const [prod] = await sql<{ id: string; name: string }[]>`
    select id, canonical_name as name from products
    where restaurant_id = ${rid} and canonical_name ~ '[א-ת]' order by canonical_name limit 1`;
  const [receiver] = await sql<{ id: string }[]>`
    select m.user_id as id from memberships m join users u on u.id = m.user_id
    where m.restaurant_id = ${rid} and m.role = 'receiver' order by u.email limit 1`;
  if (!sup || !prod) throw new Error('[W2-16] the demo seed has no supplier / Hebrew product');

  const invoice = async (o: {
    key: string;
    status: 'matched' | 'disputed' | 'parsed' | 'paid';
    /** SQL expressions (null = the column stays NULL). */
    at: string | null;
    due: string | null;
    excl: number;
    vat: number;
    payload?: Record<string, unknown>;
    /** false = the OCR read no supplier (so no agreed terms can date it). */
    supplier?: boolean;
  }): Promise<string> => {
    const incl = Math.round((o.excl + o.vat) * 100) / 100;
    const [r] = await sql.unsafe<{ id: string }[]>(
      `insert into invoices (restaurant_id, supplier_id, invoice_number, invoice_date, due_date,
                             total_excl_vat, vat_amount, total_incl_vat, status, source, ocr_payload)
       values ($1, $2, $3, ${o.at ?? 'null'}, ${o.due ?? 'null'}, $4, $5, $6, $7::invoice_status, 'manual', $8::text::jsonb)
       returning id`,
      [rid, o.supplier === false ? null : sup.id, `${COPY_STATE_INVOICE_PREFIX}${o.key}`, o.excl, o.vat, incl, o.status, JSON.stringify(o.payload ?? {})],
    );
    return r!.id;
  };
  /** The engine's output for an invoice: one match run and its findings. */
  const matchRun = async (invoiceId: string, findings: Finding[]) => {
    const total = findings.reduce((s, f) => s + Math.abs(f.delta), 0);
    const [mr] = await sql<{ id: string }[]>`
      insert into match_runs (restaurant_id, invoice_id, overall_status, total_discrepancy_amount)
      values (${rid}, ${invoiceId}, ${findings.length ? 'major' : 'clean'}, ${total}) returning id`;
    for (const f of findings) {
      await sql.unsafe(
        `insert into discrepancies (match_run_id, restaurant_id, type, severity, expected_value, actual_value,
                                    delta_amount, requires_role, resolution_status, created_at)
         values ($1, $2, $3::discrepancy_type, 'warn', $4, $5, $6, $7::user_role, $8::resolution_status, ${f.createdAt ?? 'now()'})`,
        [mr!.id, rid, f.type, f.expected, f.actual, f.delta, f.role, f.status ?? 'open'],
      );
    }
  };

  // Pay run: one invoice per due bucket, whatever the weekday (באיחור / השבוע / שבוע הבא / מאוחר יותר),
  // each carrying one approvals section:
  // · lines over the invoice cap (₪150 on a ₪118 invoice) → the leaks cap note; opened 30 days ago, so
  //   "הוותיק ביותר" always reads "N ימים" (never "יום אחד" / "יומיים" / today);
  const cap = await invoice({ key: 'CAP', status: 'matched', at: INVOICE_AT, due: ilNoon(0), excl: 100, vat: 18 });
  await matchRun(cap, [{ type: 'PRICE_HIGHER', delta: 150, expected: 10, actual: 25, role: 'manager', createdAt: `now() - interval '30 days'` }]);
  // · a VAT difference routed to the manager → "+ ₪ בהפרשי מע״מ" for owner and manager;
  const vat = await invoice({ key: 'VAT', status: 'matched', at: INVOICE_AT, due: ilNoon(7), excl: 1000, vat: 192 });
  await matchRun(vat, [{ type: 'VAT_MISMATCH', delta: 12, expected: 180, actual: 192, role: 'manager' }]);
  // · a duplicate copy → "+ ₪ בחשבוניות כפולות";
  const dup = await invoice({ key: 'DUP', status: 'disputed', at: INVOICE_AT, due: ilNoon(30), excl: 200, vat: 36 });
  await matchRun(dup, [{ type: 'DUPLICATE_INVOICE', delta: 236, expected: 0, actual: 236, role: 'manager' }]);
  // · an unrouted finding → "ממתין לאחרים" / "צפייה בלבד".
  const other = await invoice({ key: 'OTH', status: 'matched', at: INVOICE_AT, due: ilNoon(-3), excl: 50, vat: 9 });
  await matchRun(other, [{ type: 'PRICE_HIGHER', delta: 5, expected: 10, actual: 10.5, role: null }]);
  // A photo the OCR read no date and no supplier from, checked: "N בלי תאריך לא ייכללו" (exports) and
  // "בלי מועד תשלום" (pay run — the pay run dates an undated invoice by its upload day, so only an
  // invoice with no agreed terms at all has no due day).
  const undated = await invoice({ key: 'ND', status: 'matched', at: null, due: null, excl: 40, vat: 7.2, supplier: false });
  await matchRun(undated, []);
  // Held for a "זה אותו מוצר?" question: the home question line + the hero's awaiting-question line.
  const question = await invoice({ key: 'Q', status: 'parsed', at: INVOICE_AT, due: null, excl: 30, vat: 5.4, payload: { raw: { reviewReasons: ['unlinked'] } } });
  await sql`insert into invoice_lines (invoice_id, product_id, raw_description, qty_billed, unit, unit_price_billed, line_total, ocr_confidence_line)
            values (${question}, null, ${'W2-16 · מוצר בלי קישור'}, 1, 'יח׳', 30, 30, 0.97)`;
  // Waiting for a PO link (no run yet): the hero's / proof's "ממתינות לשיוך להזמנה".
  await invoice({ key: 'PEND', status: 'parsed', at: INVOICE_AT, due: null, excl: 300, vat: 54 });

  // The comparison period's twin: the rows above add ₪1,390 of checked spend to THIS month; on the 1st
  // the leaks tiles compare it with "1–1 of last month", and a base under 10% of it reads as a thin base
  // ("בסיס ההשוואה דל מכדי לחשב אחוז", +6 words a tile). The same spend on the 1st of last month (always
  // inside "1–N of last month") keeps the comparison a real one on every day of the month. Paid and its
  // finding waived ("שולם כפי שחויב"), so it is in no queue, pay run, claim or this month's figures.
  const twin = await invoice({
    key: 'PREV', status: 'paid', excl: 1390, vat: 250.2, due: null,
    at: `((date_trunc('month', ${IL_TODAY}) - interval '1 month')::date::timestamp + interval '12 hours') at time zone 'Asia/Jerusalem'`,
  });
  await matchRun(twin, [{ type: 'PRICE_HIGHER', delta: 5, expected: 10, actual: 10.5, role: 'manager', status: 'rejected' }]);

  // Receiving: a truck due today with its receipt open → the board's summary line and "המשאית הבאה"
  // on any day (the seed's trucks are dated by its own seed day); its scan waits for the count →
  // the hero's awaiting-count line.
  const [po] = await sql.unsafe<{ id: string }[]>(
    `insert into purchase_orders (restaurant_id, supplier_id, expected_delivery_at, status, source, notes)
     values ($1, $2, ${TRUCK_AT}, 'sent', 'manual', $3) returning id`,
    [rid, sup.id, COPY_STATE_PO_NOTE],
  );
  await sql`insert into po_lines (po_id, product_id, raw_description, qty_ordered, unit, unit_price_expected)
            values (${po!.id}, ${prod.id}, ${prod.name}, 3, 'ק״ג', 20)`;
  const [gr] = await sql<{ id: string }[]>`
    insert into goods_receipts (restaurant_id, po_id, received_by, status)
    values (${rid}, ${po!.id}, ${receiver?.id ?? null}, 'pending') returning id`;
  await invoice({ key: 'CNT', status: 'parsed', at: INVOICE_AT, due: null, excl: 80, vat: 14.4, payload: { raw: { heldForReceipts: [gr!.id] } } });
}
