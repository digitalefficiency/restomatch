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
  '0048_recovery': async () => ({
    status: 'PASS',
    detail: 'new tables (credit_notes, recovery_claims, recovery_events) + UNIQUE(id, restaurant_id) on invoices/discrepancies and UNIQUE(id, invoice_id) on invoice_lines (id is the PK — cannot fail)',
  }),
  '0049_monthly_reports': async () => ({ status: 'PASS', detail: 'new table only' }),
  '0050_ingest': async () => ({ status: 'PASS', detail: 'new tables + app.ingest_resolve_channel() only' }),
  '0051_invoice_source_whatsapp': async () => ({ status: 'PASS', detail: "enum ADD VALUE 'whatsapp' (IF NOT EXISTS)" }),
  '0052_receiver_languages': localesFit,
  '0053_ai_assistant': async () => ({ status: 'PASS', detail: 'new table only' }),
  '0054_leak_check_sandbox': async () => ({ status: 'PASS', detail: 'new tables only' }),
  '0055_referrals': async () => ({ status: 'PASS', detail: 'new tables + app.resolve_referral_code() only' }),
  '0056_recipes_prereqs': async () => ({ status: 'PASS', detail: 'UNIQUE(id, restaurant_id) on products (id is the PK — cannot fail) + an index' }),
  '0057_recipes': async () => ({ status: 'PASS', detail: 'new tables only' }),
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
];
