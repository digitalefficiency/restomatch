/**
 * db:doctor coverage for the wave-1 migrations (0048–0057).
 *
 * Kept apart from doctor.ts so the wave-0 and wave-1 branches can both merge it
 * without touching the same lines. Every check is inert on a database that does
 * not have the wave-1 tables:
 *   - a precondition only runs while its migration is pending;
 *   - a cross-tenant check only runs when every column it reads exists
 *     (doctor.ts skips it otherwise).
 *
 * The 0046/0047 preconditions live in doctor.ts (they came with wave1-contracts).
 */

interface WaveCtx {
  columnExists(table: string, column: string): Promise<boolean>;
  count(query: string): Promise<number>;
}

interface WaveResult {
  status: 'PASS' | 'WARN' | 'FAIL';
  detail: string;
}

/** The receiver locales 0052 allows on memberships / invitations. */
const LOCALES_0052 = ['he', 'en', 'ar', 'ru', 'th', 'ti'];

/**
 * 0048 / 0050 add `UNIQUE (id, restaurant_id)`-style keys guarded by constraint NAME
 * only (`IF NOT EXISTS … WHERE conname = …`). The keys themselves cannot fail (id is
 * the PK), but if a constraint of that name already exists with other columns or on
 * another table, the guard skips it and the composite FK that needs the key aborts
 * the whole migration batch.
 */
type SupportingKey = { table: string; name: string; cols: string };

async function supportingKeysFit(c: WaveCtx, keys: SupportingKey[], what: string): Promise<WaveResult> {
  const bad: string[] = [];
  for (const k of keys) {
    const sameName = await c.count(`select count(*) from pg_constraint where conname = '${k.name}'`);
    if (sameName === 0) continue; // will be created; cannot fail (id is the PK)
    const exact = await c.count(
      `select count(*) from pg_constraint where conname = '${k.name}' and conrelid = 'public.${k.table}'::regclass
         and contype in ('u', 'p') and pg_get_constraintdef(oid) = 'UNIQUE (${k.cols})'`,
    );
    if (exact !== 1) bad.push(`${k.name} exists but is not UNIQUE (${k.cols}) on ${k.table}`);
  }
  return bad.length
    ? { status: 'FAIL', detail: `${bad.join('; ')} — the composite FKs in ${what} would abort; rename or drop that constraint first` }
    : { status: 'PASS', detail: `new tables with same-tenant composite FKs; supporting keys ${keys.map((k) => k.name).join(', ')} absent or exact` };
}

const KEY_INVOICES: SupportingKey = { table: 'invoices', name: 'invoices_id_restaurant_id_key', cols: 'id, restaurant_id' };

async function localesFit(c: WaveCtx): Promise<WaveResult> {
  const list = LOCALES_0052.map((l) => `'${l}'`).join(', ');
  const bad: string[] = [];
  for (const t of ['memberships', 'invitations']) {
    if (!(await c.columnExists(t, 'preferred_locale'))) continue;
    const n = await c.count(`select count(*) from ${t} where preferred_locale is not null and preferred_locale not in (${list})`);
    if (n > 0) bad.push(`${t}: ${n}`);
  }
  return bad.length
    ? { status: 'FAIL', detail: `preferred_locale outside {${LOCALES_0052.join(',')}} (${bad.join(', ')}) — 0052's CHECK will abort; fix those rows first` }
    : { status: 'PASS', detail: 'widens the preferred_locale CHECKs; every existing value fits' };
}

export const WAVE1_PRECONDITIONS: Record<string, (c: WaveCtx) => Promise<WaveResult>> = {
  '0048_recovery': (c) =>
    supportingKeysFit(c, [
      KEY_INVOICES,
      { table: 'discrepancies', name: 'discrepancies_id_restaurant_id_key', cols: 'id, restaurant_id' },
      { table: 'invoice_lines', name: 'invoice_lines_id_invoice_id_key', cols: 'id, invoice_id' },
    ], '0048'),
  '0049_monthly_reports': async () => ({ status: 'PASS', detail: 'new table only' }),
  '0050_ingest': (c) => supportingKeysFit(c, [KEY_INVOICES], '0050'),
  '0051_invoice_source_whatsapp': async () => ({ status: 'PASS', detail: "enum ADD VALUE 'whatsapp' (IF NOT EXISTS)" }),
  '0052_receiver_languages': localesFit,
  '0053_ai_assistant': async () => ({ status: 'PASS', detail: 'new table only' }),
  '0054_leak_check_sandbox': async () => ({ status: 'PASS', detail: 'new tables only' }),
  '0055_referrals': async () => ({ status: 'PASS', detail: 'new tables + app.resolve_referral_code() only' }),
  '0056_recipes_prereqs': async () => ({ status: 'PASS', detail: 'UNIQUE(id, restaurant_id) on products (id is the PK — cannot fail) + an index' }),
  '0057_recipes': async () => ({ status: 'PASS', detail: 'new tables only' }),
  '0058_pos_sales': async () => ({ status: 'PASS', detail: 'new tables only (pos_sales_imports, pos_sales)' }),
  '0061_postgres_queue': async () => ({ status: 'PASS', detail: 'new tables only (job_queue, worker_heartbeats, rate_limit_counters, ops_kv)' }),
};

/** `child.col` must point at a row of the same restaurant (0048 enforces it with composite FKs; 0050 with single-column FKs). */
function sameTenant(name: string, child: string, col: string, parent: string): { name: string; needs: Array<[string, string]>; sql: string } {
  return {
    name,
    needs: [[child, col], [child, 'restaurant_id'], [parent, 'restaurant_id']],
    sql: `select count(*) from ${child} c join ${parent} p on p.id = c.${col} where p.restaurant_id <> c.restaurant_id`,
  };
}

export const WAVE1_CROSS_TENANT_CHECKS = [
  sameTenant('credit_note.supplier same tenant', 'credit_notes', 'supplier_id', 'suppliers'),
  sameTenant('credit_note.invoice same tenant', 'credit_notes', 'invoice_id', 'invoices'),
  {
    // invoice_lines has no restaurant_id — a line belongs to its invoice's restaurant.
    name: 'credit_note.invoice_line same tenant',
    needs: [['credit_notes', 'invoice_line_id'], ['credit_notes', 'restaurant_id'], ['invoice_lines', 'invoice_id']] as Array<[string, string]>,
    sql: `select count(*) from credit_notes c join invoice_lines l on l.id = c.invoice_line_id join invoices i on i.id = l.invoice_id
          where i.restaurant_id <> c.restaurant_id`,
  },
  sameTenant('recovery_claim.discrepancy same tenant', 'recovery_claims', 'discrepancy_id', 'discrepancies'),
  sameTenant('recovery_claim.supplier same tenant', 'recovery_claims', 'supplier_id', 'suppliers'),
  sameTenant('recovery_claim.invoice same tenant', 'recovery_claims', 'invoice_id', 'invoices'),
  sameTenant('recovery_claim.credit_note same tenant', 'recovery_claims', 'credit_note_id', 'credit_notes'),
  sameTenant('recovery_event.claim same tenant', 'recovery_events', 'claim_id', 'recovery_claims'),
  sameTenant('ingest_sender.supplier same tenant', 'ingest_senders', 'supplier_id', 'suppliers'),
  sameTenant('ingest_message.channel same tenant', 'ingest_messages', 'channel_id', 'ingest_channels'),
  sameTenant('ingest_message.supplier same tenant', 'ingest_messages', 'supplier_id', 'suppliers'),
  sameTenant('ingest_document.message same tenant', 'ingest_documents', 'message_id', 'ingest_messages'),
  sameTenant('ingest_document.invoice same tenant', 'ingest_documents', 'invoice_id', 'invoices'),
  sameTenant('pos_sale.import same tenant', 'pos_sales', 'import_id', 'pos_sales_imports'),
];

/**
 * The same-tenant composite FKs 0048 / 0050 create. A database that applied an
 * earlier draft of those migrations (single-column FKs) has the tables but not
 * these constraints — the tracker can't tell, so the doctor checks by name.
 */
export const WAVE1_COMPOSITE_FKS: Array<{ table: string; name: string }> = [
  { table: 'credit_notes', name: 'credit_notes_supplier_same_tenant_fk' },
  { table: 'credit_notes', name: 'credit_notes_invoice_same_tenant_fk' },
  { table: 'credit_notes', name: 'credit_notes_invoice_line_fk' },
  { table: 'recovery_claims', name: 'recovery_claims_discrepancy_same_tenant_fk' },
  { table: 'recovery_claims', name: 'recovery_claims_supplier_same_tenant_fk' },
  { table: 'recovery_claims', name: 'recovery_claims_invoice_same_tenant_fk' },
  { table: 'recovery_claims', name: 'recovery_claims_credit_note_same_tenant_fk' },
  { table: 'recovery_events', name: 'recovery_events_claim_same_tenant_fk' },
  { table: 'ingest_senders', name: 'ingest_senders_supplier_same_tenant_fk' },
  { table: 'ingest_messages', name: 'ingest_messages_channel_same_tenant_fk' },
  { table: 'ingest_messages', name: 'ingest_messages_supplier_same_tenant_fk' },
  { table: 'ingest_documents', name: 'ingest_documents_message_same_tenant_fk' },
  { table: 'ingest_documents', name: 'ingest_documents_invoice_same_tenant_fk' },
];

/** null when no wave-1 table with a composite FK exists (nothing to report). */
export async function wave1CompositeFkFinding(c: WaveCtx & { tableExists(name: string): Promise<boolean> }): Promise<WaveResult | null> {
  const present: string[] = [];
  const missing: string[] = [];
  for (const fk of WAVE1_COMPOSITE_FKS) {
    if (!(await c.tableExists(fk.table))) continue;
    const n = await c.count(
      `select count(*) from pg_constraint where conname = '${fk.name}' and conrelid = 'public.${fk.table}'::regclass and contype = 'f'`,
    );
    (n === 1 ? present : missing).push(fk.name);
  }
  if (!present.length && !missing.length) return null;
  return missing.length
    ? { status: 'WARN', detail: `missing ${missing.join(', ')} — the table came from an earlier draft of 0048/0050 (single-column FKs); recreate it from the current migration` }
    : { status: 'PASS', detail: `${present.length} same-tenant composite FKs in place` };
}
