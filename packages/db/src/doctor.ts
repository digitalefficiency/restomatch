import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { INTEGRITY_CHECKS } from './integrityChecks';
import { migrationHash, migrationsDir, readJournal, REQUIRED_EXTENSIONS, type JournalEntry } from './migrations';
import { WAVE1_CROSS_TENANT_CHECKS, WAVE1_PRECONDITIONS } from './wave1Checks';

/**
 * `pnpm db:doctor` — a READ-ONLY health report for any RestoMatch database
 * (local, CI, a restored dump, or production).
 *
 * Every query runs inside one `BEGIN READ ONLY` transaction with a statement
 * timeout, so the doctor cannot write even if a check were buggy. It answers,
 * in order: which migrations are applied / pending (and whether the journal has
 * gaps or the DB is ahead of this checkout), whether each PENDING migration's
 * preconditions hold on the live rows (the 0020/0021/0027 class of "fails on
 * real data"), whether RLS + the non-bypass app role are in place, cross-tenant
 * referential integrity the FKs cannot express, unindexed foreign keys,
 * unvalidated constraints and missing updated_at triggers.
 *
 * FAIL = will break the cutover or is a tenant-isolation hole. WARN = should be
 * looked at (pending work, data that needs repair, performance). PASS / INFO /
 * SKIP never fail the run.
 */

export type DoctorStatus = 'PASS' | 'WARN' | 'FAIL' | 'INFO' | 'SKIP';

export interface DoctorFinding {
  section: string;
  name: string;
  status: DoctorStatus;
  detail: string;
}

export interface DoctorReport {
  target: string;
  findings: DoctorFinding[];
  applied: string[];
  pending: string[];
  counts: Record<DoctorStatus, number>;
  ok: boolean;
}

export interface DoctorOptions {
  /** Migrations folder holding meta/_journal.json + the .sql files (default: this package's). */
  migrationsDir?: string;
  /** Name of the non-owner tenant role (default restomatch_app). */
  appRole?: string;
  /** Per-statement timeout (default 20 s). */
  statementTimeoutMs?: number;
}

type Tx = postgres.TransactionSql<Record<string, unknown>>;

const APP_ROLE = 'restomatch_app';

/** Tables RLS-scoped through a parent/user join instead of their own restaurant_id (rls/0002). */
const JOIN_SCOPED_RLS_TABLES = [
  'restaurants',
  'users',
  'invoice_lines',
  'po_lines',
  'gr_lines',
  'product_aliases',
  'billing_accounts',
  'subscriptions',
  'usage_counters',
  'billing_events',
  'leads',
];

/** Identity tables the tenant role must hold NO privilege on (rls.ts / 0026). */
const IDENTITY_REVOKED = [
  'accounts',
  'sessions',
  'verification_tokens',
  'authenticators',
  'user_credentials',
  'password_reset_tokens',
  'user_recovery_codes',
];

/**
 * FK columns intentionally left unindexed (low-churn audit pointers, never
 * filtered on) — see the header of 0030_fk_indexes.sql.
 */
const FK_INDEX_ALLOWLIST = new Set([
  'audit_log.user_id',
  'discrepancies.resolved_by',
  'goods_receipts.received_by',
  'invoices.created_by',
  'purchase_orders.created_by',
  'catalog_imports.created_by',
  'invitations.invited_by_user_id',
  'invitations.accepted_by_user_id',
  'billing_accounts.owner_user_id',
  'subscriptions.plan_id',
  'dsr_requests.requested_by_user_id',
  'activity_events.actor_id',
]);

export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return url.replace(/:[^:@/]+@/, ':***@');
  }
}

interface Ctx {
  tx: Tx;
  tableExists(name: string): Promise<boolean>;
  columnExists(table: string, column: string): Promise<boolean>;
  count(query: string): Promise<number>;
}

interface PreconditionResult {
  status: DoctorStatus;
  detail: string;
}

/**
 * Preconditions for each migration from production's level (0018) onward, run
 * ONLY while the migration is pending. A FAIL here means the migrator WILL abort
 * (and roll the whole batch back) on this database — repair first.
 */
const PRECONDITIONS: Record<string, (c: Ctx) => Promise<PreconditionResult>> = {
  ...WAVE1_PRECONDITIONS, // 0048–0057 (wave1Checks.ts)
  '0019_storage_namespaces': async () => ({ status: 'PASS', detail: 'additive (CREATE TABLE IF NOT EXISTS)' }),

  '0020_invoice_scans_restaurant_not_null': async (c) => {
    if (!(await c.tableExists('invoice_scans'))) return { status: 'FAIL', detail: 'invoice_scans table missing (0003 not applied?)' };
    const n = await c.count('select count(*) from invoice_scans where restaurant_id is null');
    if (n === 0) return { status: 'PASS', detail: 'no NULL-tenant invoice_scans rows' };
    const walk = await c.count("select count(*) from invoice_scans where restaurant_id is null and storage_path like 'walk-ins/%'");
    return {
      status: 'FAIL',
      detail: `${n} invoice_scans row(s) have NULL restaurant_id (${walk} under walk-ins/) — 0020 will abort. Repair: docs/DB-RUNBOOK.md §3 (walk-ins → delete; tenant scans → attribute) / docs/PR1-storage-isolation-APPLY.md §2`,
    };
  },

  '0021_products_supplier_same_tenant': async (c) => {
    const problems: string[] = [];
    const exists = await c.count(
      "select count(*) from pg_constraint where conname in ('suppliers_id_restaurant_id_key','products_supplier_same_tenant_fk')",
    );
    if (exists > 0) problems.push('constraint suppliers_id_restaurant_id_key / products_supplier_same_tenant_fk already exists (0021 has no IF NOT EXISTS) — drop it first');
    if (await c.columnExists('products', 'supplier_id')) {
      const n = await c.count(
        'select count(*) from products p join suppliers s on s.id = p.supplier_id where s.restaurant_id <> p.restaurant_id',
      );
      if (n > 0) problems.push(`${n} product(s) reference a supplier of ANOTHER restaurant — run scripts/backfill-product-supplier.ts (dry-run, then --apply)`);
    }
    return problems.length ? { status: 'FAIL', detail: problems.join('; ') } : { status: 'PASS', detail: 'no cross-tenant products.supplier_id' };
  },

  '0022_legal_compliance': async () => ({ status: 'PASS', detail: 'additive (IF NOT EXISTS)' }),

  '0023_user_credentials': async (c) => {
    const pre = [];
    for (const t of ['user_credentials', 'password_reset_tokens', 'user_recovery_codes']) {
      if (await c.tableExists(t)) pre.push(t);
    }
    return pre.length
      ? { status: 'FAIL', detail: `${pre.join(', ')} already exist (created outside migrations?) — 0023 uses plain CREATE TABLE and will abort; compare shape, then drop or record 0023 manually` }
      : { status: 'PASS', detail: 'credential tables do not exist yet' };
  },

  '0024_two_factor_ticket': async () => ({ status: 'PASS', detail: 'additive (ADD COLUMN IF NOT EXISTS)' }),
  '0025_totp_last_step': async () => ({ status: 'PASS', detail: 'additive (ADD COLUMN IF NOT EXISTS)' }),
  '0026_revoke_identity_tables': async () => ({ status: 'PASS', detail: 'REVOKE only, role-existence guarded' }),

  '0027_leak_trust': async (c) => {
    const dup = await c.count(
      'select count(*) from (select 1 from goods_receipts where po_id is not null group by restaurant_id, po_id having count(*) > 1) d',
    );
    const vat17 = await c.count('select count(*) from restaurants where vat_rate = 0.17');
    const note = vat17 > 0 ? ` (${vat17} restaurant(s) still at VAT 0.17 will be moved to 0.18)` : '';
    if (dup > 0) {
      return {
        status: 'FAIL',
        detail: `${dup} purchase order(s) have more than one goods receipt — 0027 will abort. Repair: docs/DB-RUNBOOK.md §3 (keep the receipt with lines / the earliest)${note}`,
      };
    }
    return { status: 'PASS', detail: `no PO has two goods receipts${note}` };
  },

  '0028_english_receiving': async () => ({ status: 'PASS', detail: 'additive (nullable columns, guarded CHECK)' }),

  '0029_tenant_scoped_uniques': async (c) => {
    // Cannot fail by construction (looser key); checked anyway for a hand-edited DB.
    const po = await c.count(
      'select count(*) from (select 1 from purchase_orders where source_ref is not null group by restaurant_id, source_platform, source_ref having count(*) > 1) d',
    );
    const sup = await c.count(
      'select count(*) from (select 1 from suppliers where external_ref is not null group by restaurant_id, source_platform, external_ref having count(*) > 1) d',
    );
    return po + sup > 0
      ? { status: 'FAIL', detail: `${po} duplicate PO ref(s), ${sup} duplicate supplier ref(s) within one restaurant` }
      : { status: 'PASS', detail: 'per-restaurant platform refs are unique (loosens the global key)' };
  },

  '0030_fk_indexes': async () => ({ status: 'PASS', detail: 'CREATE INDEX IF NOT EXISTS only' }),
  '0031_updated_at_triggers': async () => ({ status: 'PASS', detail: 'trigger function + BEFORE UPDATE triggers only' }),

  '0033_plans_catalog': async () => ({ status: 'PASS', detail: 'upsert of the plan catalog (PLAN_SEED) — re-prices existing plans to PLAN_SEED' }),
  '0039_invitation_locale': async () => ({ status: 'PASS', detail: 'additive (nullable column, guarded CHECK)' }),

  '0032_integrity_checks': async (c) => {
    const bad: string[] = [];
    for (const chk of INTEGRITY_CHECKS) {
      if (!(await c.tableExists(chk.table))) continue;
      const n = await c.count(`select count(*) from "${chk.table}" where not (${chk.expr})`).catch(() => 0);
      if (n > 0) bad.push(`${chk.name}=${n}`);
    }
    return bad.length
      ? { status: 'WARN', detail: `cannot fail (NOT VALID), but these will stay unvalidated until repaired: ${bad.join(', ')}` }
      : { status: 'PASS', detail: `all ${INTEGRITY_CHECKS.length} checks hold on existing rows` };
  },
};

/** Cross-tenant consistency the FKs cannot express. Each query returns offending row count. */
const CROSS_TENANT_CHECKS: Array<{ name: string; needs: Array<[string, string]>; sql: string }> = [
  {
    name: 'po.supplier same tenant',
    needs: [['purchase_orders', 'supplier_id']],
    sql: 'select count(*) from purchase_orders po join suppliers s on s.id = po.supplier_id where s.restaurant_id <> po.restaurant_id',
  },
  {
    name: 'invoice.supplier same tenant',
    needs: [['invoices', 'supplier_id']],
    sql: 'select count(*) from invoices i join suppliers s on s.id = i.supplier_id where s.restaurant_id <> i.restaurant_id',
  },
  {
    name: 'goods_receipt.po same tenant',
    needs: [['goods_receipts', 'po_id']],
    sql: 'select count(*) from goods_receipts g join purchase_orders po on po.id = g.po_id where po.restaurant_id <> g.restaurant_id',
  },
  {
    name: 'gr_line.po_line belongs to the receipt\'s PO',
    needs: [['gr_lines', 'po_line_id']],
    sql: 'select count(*) from gr_lines gl join goods_receipts g on g.id = gl.gr_id join po_lines pl on pl.id = gl.po_line_id where g.po_id is not null and pl.po_id <> g.po_id',
  },
  {
    name: 'match_run links same tenant',
    needs: [['match_runs', 'invoice_id']],
    sql: `select count(*) from match_runs m
          left join invoices i on i.id = m.invoice_id
          left join purchase_orders po on po.id = m.po_id
          left join goods_receipts g on g.id = m.gr_id
          where (i.id is not null and i.restaurant_id <> m.restaurant_id)
             or (po.id is not null and po.restaurant_id <> m.restaurant_id)
             or (g.id is not null and g.restaurant_id <> m.restaurant_id)`,
  },
  {
    name: 'discrepancy.restaurant = match_run.restaurant',
    needs: [['discrepancies', 'match_run_id']],
    sql: 'select count(*) from discrepancies d join match_runs m on m.id = d.match_run_id where m.restaurant_id <> d.restaurant_id',
  },
  {
    name: 'po_line.product same tenant',
    needs: [['po_lines', 'product_id']],
    sql: 'select count(*) from po_lines l join purchase_orders po on po.id = l.po_id join products p on p.id = l.product_id where p.restaurant_id <> po.restaurant_id',
  },
  {
    name: 'invoice_line.product same tenant',
    needs: [['invoice_lines', 'product_id']],
    sql: 'select count(*) from invoice_lines l join invoices i on i.id = l.invoice_id join products p on p.id = l.product_id where p.restaurant_id <> i.restaurant_id',
  },
  {
    name: 'gr_line.product same tenant',
    needs: [['gr_lines', 'product_id']],
    sql: 'select count(*) from gr_lines l join goods_receipts g on g.id = l.gr_id join products p on p.id = l.product_id where p.restaurant_id <> g.restaurant_id',
  },
  {
    name: 'product.supplier same tenant',
    needs: [['products', 'supplier_id']],
    sql: 'select count(*) from products p join suppliers s on s.id = p.supplier_id where s.restaurant_id <> p.restaurant_id',
  },
  {
    name: 'product_alias.supplier same tenant as product',
    needs: [['product_aliases', 'supplier_id']],
    sql: 'select count(*) from product_aliases a join products p on p.id = a.product_id join suppliers s on s.id = a.supplier_id where s.restaurant_id <> p.restaurant_id',
  },
  {
    name: 'price_history product/supplier same tenant',
    needs: [['price_history', 'supplier_id']],
    sql: `select count(*) from price_history h join products p on p.id = h.product_id join suppliers s on s.id = h.supplier_id
          where p.restaurant_id <> h.restaurant_id or s.restaurant_id <> h.restaurant_id`,
  },
  {
    name: 'supplier_catalog_item supplier/product same tenant',
    needs: [['supplier_catalog_items', 'supplier_id']],
    sql: `select count(*) from supplier_catalog_items c join suppliers s on s.id = c.supplier_id left join products p on p.id = c.product_id
          where s.restaurant_id <> c.restaurant_id or (p.id is not null and p.restaurant_id <> c.restaurant_id)`,
  },
  {
    name: 'invoice_scan.invoice same tenant',
    needs: [['invoice_scans', 'restaurant_id']],
    sql: 'select count(*) from invoice_scans sc join invoices i on i.id::text = sc.invoice_id::text where sc.restaurant_id is not null and i.restaurant_id <> sc.restaurant_id',
  },
  ...WAVE1_CROSS_TENANT_CHECKS, // 0048/0050 single-column FKs (wave1Checks.ts)
];

function tally(findings: DoctorFinding[]): Record<DoctorStatus, number> {
  const c: Record<DoctorStatus, number> = { PASS: 0, WARN: 0, FAIL: 0, INFO: 0, SKIP: 0 };
  for (const f of findings) c[f.status] += 1;
  return c;
}

export async function runDoctor(url: string, opts: DoctorOptions = {}): Promise<DoctorReport> {
  const dir = opts.migrationsDir ?? migrationsDir();
  const appRole = opts.appRole ?? APP_ROLE;
  const findings: DoctorFinding[] = [];
  const add = (section: string, name: string, status: DoctorStatus, detail: string) =>
    findings.push({ section, name, status, detail });
  const journal = readJournal(dir).entries;
  let applied: JournalEntry[] = [];
  let pending: JournalEntry[] = [];

  const client = postgres(url, { max: 1, prepare: false, connect_timeout: 15, onnotice: () => undefined });
  try {
    await client.begin('read only', async (tx) => {
      await tx.unsafe(`set local statement_timeout = ${Math.max(1000, opts.statementTimeoutMs ?? 20_000)}`);
      await tx.unsafe(`set local lock_timeout = 5000`);

      const tableCache = new Map<string, boolean>();
      const ctx: Ctx = {
        tx,
        async tableExists(name) {
          if (!tableCache.has(name)) {
            const r = await tx`select to_regclass(${'public.' + name}) is not null as e`;
            tableCache.set(name, Boolean(r[0]?.e));
          }
          return tableCache.get(name)!;
        },
        async columnExists(table, column) {
          const r = await tx`
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = ${table} and column_name = ${column}`;
          return r.length > 0;
        },
        // Savepoint-wrapped: a failing probe (e.g. a column a hand-edited DB
        // lacks) must not abort the whole read-only transaction.
        async count(query) {
          const r = await tx.savepoint((sp) => sp.unsafe(query));
          return Number((r[0] as { count?: unknown } | undefined)?.count ?? 0);
        },
      };

      // ── 1. Connection ───────────────────────────────────────────────────
      const [info] = await tx`
        select current_setting('server_version_num')::int as vnum, current_setting('server_version') as v,
               current_user as usr, current_database() as db,
               (select rolsuper from pg_roles where rolname = current_user) as su`;
      add('connection', 'server', info!.vnum >= 140000 ? 'INFO' : 'WARN',
        `PostgreSQL ${info!.v} · db=${info!.db} · user=${info!.usr}${info!.su ? ' (superuser)' : ''}${info!.vnum < 140000 ? ' — PG ≥ 14 expected' : ''}`);

      // ── 2. Extensions ───────────────────────────────────────────────────
      const ext = await tx`select extname from pg_extension`;
      const have = new Set(ext.map((e) => String(e.extname)));
      const missingExt = REQUIRED_EXTENSIONS.filter((e) => !have.has(e));
      add('extensions', 'required extensions', missingExt.length ? 'FAIL' : 'PASS',
        missingExt.length ? `missing: ${missingExt.join(', ')} (migrate creates them; on Supabase enable in Database → Extensions)` : REQUIRED_EXTENSIONS.join(', '));

      // ── 3. Migrations ───────────────────────────────────────────────────
      const [hasTracker] = await tx`select to_regclass('drizzle.__drizzle_migrations') is not null as e`;
      if (!hasTracker?.e) {
        pending = journal;
        add('migrations', 'tracker', 'FAIL', 'drizzle.__drizzle_migrations does not exist — no migration has ever been applied here (fresh DB): run `pnpm db:migrate`');
      } else {
        const rows = await tx`select hash, created_at from drizzle.__drizzle_migrations order by created_at`;
        const byWhen = new Map(rows.map((r) => [Number(r.created_at), String(r.hash)] as const));
        const maxApplied = rows.length ? Math.max(...rows.map((r) => Number(r.created_at))) : 0;
        applied = journal.filter((e) => byWhen.has(e.when));
        pending = journal.filter((e) => e.when > maxApplied);
        const gaps = journal.filter((e) => e.when <= maxApplied && !byWhen.has(e.when));
        const knownWhen = new Set(journal.map((e) => e.when));
        const unknown = rows.filter((r) => !knownWhen.has(Number(r.created_at)));
        const lastJournal = journal[journal.length - 1]!;
        const latestApplied = [...applied].pop();
        add('migrations', 'applied', applied.length ? 'PASS' : 'FAIL',
          `${applied.length}/${journal.length} journal entries recorded · latest applied: ${latestApplied?.tag ?? '(none)'}`);
        add('migrations', 'pending', pending.length ? 'WARN' : 'PASS',
          pending.length ? `${pending.length} pending: ${pending.map((p) => p.tag).join(', ')}` : 'none — schema is at the latest migration');
        if (gaps.length) {
          add('migrations', 'journal gaps', 'FAIL',
            `${gaps.map((g) => g.tag).join(', ')} are OLDER than the newest applied row but not recorded — the migrator will SKIP them forever. Apply their SQL by hand (in order) and insert their hash/created_at rows.`);
        } else {
          add('migrations', 'journal gaps', 'PASS', 'no skipped entries');
        }
        if (maxApplied > lastJournal.when) {
          add('migrations', 'database ahead of checkout', 'FAIL',
            `the database has migrations newer than ${lastJournal.tag} — this checkout is OLDER than the schema; do not deploy it`);
        } else if (unknown.length) {
          add('migrations', 'unknown rows', 'WARN', `${unknown.length} __drizzle_migrations row(s) match no journal entry (created_at ${unknown.map((u) => u.created_at).join(', ')})`);
        }
        const drift = applied.filter((e) => {
          try {
            return migrationHash(e.tag, dir) !== byWhen.get(e.when);
          } catch {
            return true;
          }
        });
        add('migrations', 'file hashes', drift.length ? 'WARN' : 'PASS',
          drift.length
            ? `${drift.length} applied migration file(s) changed after they were applied (comment edits are harmless; DDL edits are not re-run): ${drift.map((d) => d.tag).join(', ')}`
            : 'every applied file matches its recorded hash');
      }

      // ── 4. Preconditions of pending migrations ──────────────────────────
      if (pending.length === 0) {
        add('preconditions', 'pending migrations', 'SKIP', 'nothing pending');
      } else if (!(await ctx.tableExists('restaurants'))) {
        add('preconditions', 'pending migrations', 'SKIP', 'empty schema — a fresh DB has no data to violate preconditions');
      } else {
        for (const p of pending) {
          const fn = PRECONDITIONS[p.tag];
          if (!fn) {
            add('preconditions', p.tag, p.idx <= 18 ? 'SKIP' : 'WARN',
              p.idx <= 18 ? 'pre-production migration (no data guard registered)' : 'no precondition registered — read the file header before applying');
            continue;
          }
          try {
            const r = await fn(ctx);
            add('preconditions', p.tag, r.status, r.detail);
          } catch (err) {
            add('preconditions', p.tag, 'WARN', `could not evaluate: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }

      if (!(await ctx.tableExists('restaurants'))) {
        add('schema', 'tables', 'SKIP', 'public schema is empty — skipping RLS / integrity / index checks');
        return;
      }

      // ── 5. RLS ──────────────────────────────────────────────────────────
      const tenantTables = (await tx`
        select c.relname as t, c.relrowsecurity as rls,
               (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)::int as policies
        from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
        where c.relkind = 'r' and exists (
          select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'restaurant_id' and not a.attisdropped)
        order by 1`) as unknown as Array<{ t: string; rls: boolean; policies: number }>;
      const noRls = tenantTables.filter((t) => !t.rls).map((t) => t.t);
      const noPolicy = tenantTables.filter((t) => t.rls && t.policies === 0).map((t) => t.t);
      add('rls', 'restaurant_id tables have RLS', noRls.length ? 'FAIL' : 'PASS',
        noRls.length ? `RLS DISABLED on: ${noRls.join(', ')} — run provision-rls (add new tables to rls/0002 first)` : `${tenantTables.length} tenant tables protected`);
      add('rls', 'tenant tables have a policy', noPolicy.length ? 'FAIL' : 'PASS',
        noPolicy.length ? `RLS on but NO policy (deny-all for the app role) on: ${noPolicy.join(', ')}` : 'every tenant table has ≥1 policy');
      const joinScoped = (await tx`
        select c.relname as t, c.relrowsecurity as rls from pg_class c
        join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
        where c.relname in ${tx(JOIN_SCOPED_RLS_TABLES)} and c.relkind = 'r'`) as unknown as Array<{ t: string; rls: boolean }>;
      const joinNoRls = joinScoped.filter((t) => !t.rls).map((t) => t.t);
      add('rls', 'join-scoped tables have RLS', joinNoRls.length ? 'FAIL' : 'PASS',
        joinNoRls.length ? `RLS DISABLED on: ${joinNoRls.join(', ')}` : `${joinScoped.length} child/identity/billing tables protected`);
      const [fn] = await tx`select to_regprocedure('app.current_restaurant_id()') is not null as e`;
      add('rls', 'app.current_restaurant_id()', fn?.e ? 'PASS' : 'FAIL', fn?.e ? 'present' : 'missing — rls/0002 not applied');
      const [audit] = await tx`select count(*)::int as n from pg_trigger where tgname = 'audit_log_no_update_delete' and not tgisinternal`;
      add('rls', 'audit_log append-only trigger', audit!.n ? 'PASS' : 'WARN', audit!.n ? 'present' : 'missing — rls/0003 not applied (provision-rls)');

      // ── 6. App role ─────────────────────────────────────────────────────
      const [role] = (await tx`
        select rolbypassrls, rolsuper, rolcanlogin from pg_roles where rolname = ${appRole}`) as unknown as Array<{
        rolbypassrls: boolean; rolsuper: boolean; rolcanlogin: boolean;
      }>;
      if (!role) {
        add('app role', appRole, 'FAIL', 'role does not exist — run provision-rls with APP_ROLE_PASSWORD');
      } else {
        const safe = !role.rolbypassrls && !role.rolsuper;
        add('app role', appRole, !safe ? 'FAIL' : role.rolcanlogin ? 'PASS' : 'WARN',
          `bypassrls=${role.rolbypassrls} superuser=${role.rolsuper} canlogin=${role.rolcanlogin}` +
            (!safe
              ? ' — must not bypass RLS or be superuser'
              : role.rolcanlogin
                ? ''
                : ' — no LOGIN yet (a Supabase/git deploy creates it NOLOGIN): ALTER ROLE restomatch_app WITH LOGIN PASSWORD \'…\' or run provision-rls with APP_ROLE_PASSWORD'));
        const tables = (await tx`
          select c.relname as t,
                 has_table_privilege(${appRole}, c.oid, 'SELECT') as sel,
                 has_table_privilege(${appRole}, c.oid, 'INSERT') as ins,
                 has_table_privilege(${appRole}, c.oid, 'UPDATE') as upd,
                 has_table_privilege(${appRole}, c.oid, 'DELETE') as del
          from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
          where c.relkind = 'r' order by 1`) as unknown as Array<{ t: string; sel: boolean; ins: boolean; upd: boolean; del: boolean }>;
        const priv = new Map(tables.map((t) => [t.t, t] as const));
        const leakedIdentity = IDENTITY_REVOKED.filter((t) => {
          const p = priv.get(t);
          return p && (p.ins || p.upd || p.del || (t !== 'users' && p.sel));
        });
        add('app role', 'identity tables revoked', leakedIdentity.length ? 'FAIL' : 'PASS',
          leakedIdentity.length ? `${appRole} still has privileges on: ${leakedIdentity.join(', ')}` : 'no access to accounts/sessions/tokens/credentials');
        const usersP = priv.get('users');
        const writable = ['plans', 'billing_accounts', 'subscriptions', 'usage_counters', 'billing_events'].filter((t) => {
          const p = priv.get(t);
          return p && (p.ins || p.upd || p.del);
        });
        if (usersP && (usersP.ins || usersP.upd || usersP.del)) writable.push('users');
        const auditP = priv.get('audit_log');
        if (auditP && (auditP.upd || auditP.del)) writable.push('audit_log(update/delete)');
        add('app role', 'read-only tables', writable.length ? 'FAIL' : 'PASS',
          writable.length ? `${appRole} can write: ${writable.join(', ')} (tenant self-escalation)` : 'plans/billing/users read-only, audit_log append-only');
        const revokedOrReadOnly = new Set([...IDENTITY_REVOKED, 'dsr_requests']);
        const ungranted = tables.filter((t) => !revokedOrReadOnly.has(t.t) && !t.sel).map((t) => t.t);
        add('app role', 'grants on tenant tables', ungranted.length ? 'WARN' : 'PASS',
          ungranted.length ? `no SELECT on: ${ungranted.join(', ')} — re-run provision-rls (tables created after the last grant)` : 'SELECT granted on every tenant table');
        const [exec] = await tx`
          select case when to_regprocedure('app.current_restaurant_id()') is null then null
                 else has_function_privilege(${appRole}, 'app.current_restaurant_id()', 'EXECUTE') end as ok`;
        if (exec?.ok === false) add('app role', 'execute app.*', 'FAIL', `${appRole} cannot execute app.current_restaurant_id() — every RLS query will error`);
      }

      // Supabase Data API roles (anon/authenticated) must not reach any table:
      // they are usable with the public publishable key through PostgREST.
      const apiRoles = (await tx`select rolname from pg_roles where rolname in ('anon', 'authenticated')`).map((r) => String(r.rolname));
      if (apiRoles.length > 0) {
        const exposed = (await tx`
          select distinct c.relname as t from pg_class c
          join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
          cross join unnest(${apiRoles}::text[]) as r(role)
          where c.relkind in ('r', 'p', 'v', 'm', 'f') and (has_table_privilege(r.role, c.oid, 'SELECT')
             or has_table_privilege(r.role, c.oid, 'INSERT') or has_table_privilege(r.role, c.oid, 'UPDATE')
             or has_table_privilege(r.role, c.oid, 'DELETE'))
          order by 1`) as unknown as Array<{ t: string }>;
        add('app role', 'Supabase Data API locked out', exposed.length ? 'FAIL' : 'PASS',
          exposed.length
            ? `${apiRoles.join('/')} can reach ${exposed.length} public relation(s) via the publishable key: ${exposed.map((e) => e.t).join(', ')} — apply the latest supabase/migrations RLS file`
            : `${apiRoles.join('/')} have no table privileges in public`);
      }

      // ── 7. Cross-tenant integrity ───────────────────────────────────────
      const integrityBad: string[] = [];
      let integrityRan = 0;
      for (const chk of CROSS_TENANT_CHECKS) {
        let ok = true;
        for (const [t, col] of chk.needs) if (!(await ctx.columnExists(t, col))) ok = false;
        if (!ok) continue;
        integrityRan += 1;
        try {
          const n = await ctx.count(chk.sql);
          if (n > 0) integrityBad.push(`${chk.name}: ${n}`);
        } catch (err) {
          integrityBad.push(`${chk.name}: could not evaluate (${err instanceof Error ? err.message : String(err)})`);
        }
      }
      add('integrity', 'cross-tenant references', integrityBad.length ? 'WARN' : 'PASS',
        integrityBad.length ? integrityBad.join(' · ') : `${integrityRan} cross-tenant consistency checks clean`);
      const ownerless = await ctx.count(
        "select count(*) from restaurants r where not exists (select 1 from memberships m where m.restaurant_id = r.id and m.role = 'owner')",
      );
      add('integrity', 'restaurants have an owner', ownerless ? 'WARN' : 'PASS',
        ownerless ? `${ownerless} restaurant(s) without an owner membership (nobody can manage them)` : 'every restaurant has an owner');
      const unmatched = await ctx.count(
        "select count(*) from invoices i where i.status in ('matched','disputed','approved','paid') and not exists (select 1 from match_runs m where m.invoice_id = i.id)",
      );
      add('integrity', 'matched invoices have a match run', unmatched ? 'WARN' : 'PASS',
        unmatched ? `${unmatched} invoice(s) in a post-match status with no match_runs row (leak figure excludes them)` : 'consistent');

      // ── 8. Indexes ──────────────────────────────────────────────────────
      const fkNoIdx = (await tx`
        select c.conrelid::regclass::text as t,
               (select string_agg(a.attname, ',' order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord)
                 join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as cols
        from pg_constraint c
        where c.contype = 'f' and c.connamespace = 'public'::regnamespace
          and not exists (
            select 1 from pg_index i
            where i.indrelid = c.conrelid
              and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] @> c.conkey::int2[])
        order by 1, 2`) as unknown as Array<{ t: string; cols: string }>;
      const fkMissing = fkNoIdx.map((r) => `${r.t}.${r.cols}`).filter((k) => !FK_INDEX_ALLOWLIST.has(k));
      add('indexes', 'foreign keys indexed', fkMissing.length ? 'WARN' : 'PASS',
        fkMissing.length ? `${fkMissing.length} unindexed FK(s): ${fkMissing.join(', ')}` : `all FKs indexed (${fkNoIdx.length} allowlisted audit pointers)`);
      const invalid = (await tx`
        select i.indexrelid::regclass::text as idx from pg_index i
        join pg_class c on c.oid = i.indrelid join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
        where not i.indisvalid`) as unknown as Array<{ idx: string }>;
      add('indexes', 'no invalid indexes', invalid.length ? 'FAIL' : 'PASS',
        invalid.length ? `INVALID (failed concurrent build): ${invalid.map((r) => r.idx).join(', ')} — drop and recreate` : 'all valid');

      // ── 9. Constraints / triggers ───────────────────────────────────────
      const notValid = (await tx`
        select con.conname as name, cls.relname as t from pg_constraint con
        join pg_class cls on cls.oid = con.conrelid join pg_namespace ns on ns.oid = cls.relnamespace and ns.nspname = 'public'
        where not con.convalidated order by 2, 1`) as unknown as Array<{ name: string; t: string }>;
      if (notValid.length) {
        const parts: string[] = [];
        for (const nv of notValid) {
          const chk = INTEGRITY_CHECKS.find((c) => c.name === nv.name);
          const n = chk ? await ctx.count(`select count(*) from "${chk.table}" where not (${chk.expr})`).catch(() => -1) : -1;
          parts.push(`${nv.t}.${nv.name}${n >= 0 ? ` (${n} violating row(s))` : ''}`);
        }
        add('constraints', 'all constraints validated', 'WARN', `NOT VALID: ${parts.join(', ')} — repair rows, then ALTER TABLE … VALIDATE CONSTRAINT …`);
      } else {
        add('constraints', 'all constraints validated', 'PASS', 'no NOT VALID constraints');
      }
      const [trgFn] = await tx`select to_regprocedure('public.set_updated_at()') is not null as e`;
      if (trgFn?.e) {
        const noTrg = (await tx`
          select c.table_name as t from information_schema.columns c
          join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
          where c.table_schema = 'public' and c.column_name = 'updated_at'
            and not exists (select 1 from pg_trigger g where g.tgrelid = ('public.' || quote_ident(c.table_name))::regclass
                            and g.tgname = c.table_name || '_set_updated_at')
          order by 1`) as unknown as Array<{ t: string }>;
        add('constraints', 'updated_at triggers', noTrg.length ? 'WARN' : 'PASS',
          noTrg.length ? `no set_updated_at trigger on: ${noTrg.map((r) => r.t).join(', ')} (re-run 0031's DO block)` : 'every updated_at column is maintained by trigger');
      } else if (applied.some((a) => a.tag === '0031_updated_at_triggers')) {
        add('constraints', 'updated_at triggers', 'WARN', 'set_updated_at() is MISSING although 0031 is recorded as applied (schema drift — re-run packages/db/drizzle/0031_updated_at_triggers.sql)');
      } else {
        add('constraints', 'updated_at triggers', 'SKIP', 'set_updated_at() not installed yet (0031 pending)');
      }

      // Schema drift: objects a migration created must still exist if the tracker
      // says it is applied (catches hand-run undo SQL / partial restores).
      const appliedTags = new Set(applied.map((a) => a.tag));
      const expectIdx: string[] = [];
      if (appliedTags.has('0029_tenant_scoped_uniques')) expectIdx.push('po_restaurant_source_ref_unique', 'suppliers_restaurant_external_ref_unique');
      if (appliedTags.has('0030_fk_indexes')) {
        try {
          const sql0030 = readFileSync(join(dir, '0030_fk_indexes.sql'), 'utf8');
          expectIdx.push(...[...sql0030.matchAll(/CREATE INDEX IF NOT EXISTS "([a-z_]+)"/g)].map((m) => m[1]!));
        } catch {
          /* file missing in this checkout — skip */
        }
      }
      const haveIdx = new Set(
        ((await tx`select indexname from pg_indexes where schemaname = 'public'`) as unknown as Array<{ indexname: string }>).map((r) => r.indexname),
      );
      const haveCon = new Set(
        ((await tx`select conname from pg_constraint where connamespace = 'public'::regnamespace`) as unknown as Array<{ conname: string }>).map((r) => r.conname),
      );
      const missing = [
        ...expectIdx.filter((i) => !haveIdx.has(i)).map((i) => `index ${i}`),
        ...(appliedTags.has('0032_integrity_checks') ? INTEGRITY_CHECKS.filter((c) => !haveCon.has(c.name)).map((c) => `check ${c.name}`) : []),
      ];
      const legacy = ['po_source_ref_unique', 'suppliers_external_ref_unique'].filter((i) => appliedTags.has('0029_tenant_scoped_uniques') && haveIdx.has(i));
      add('constraints', 'applied migrations intact', missing.length + legacy.length ? 'WARN' : 'PASS',
        missing.length + legacy.length
          ? `schema drift vs the tracker — missing: ${missing.join(', ') || '—'}${legacy.length ? `; global uniques back (I5): ${legacy.join(', ')}` : ''} (re-run the migration's SQL)`
          : 'every object from 0029/0030/0032 present');

      // ── 10. Supabase storage ────────────────────────────────────────────
      const [storage] = await tx`select to_regclass('storage.buckets') is not null as e`;
      if (storage?.e) {
        const b = await tx`select public from storage.buckets where id = 'invoice-scans'`;
        if (!b.length) add('storage', 'invoice-scans bucket', 'WARN', 'bucket missing');
        else add('storage', 'invoice-scans bucket', b[0]!.public ? 'FAIL' : 'PASS', b[0]!.public ? 'bucket is PUBLIC — invoice scans readable by URL (apply rls/0001)' : 'private');
        // rls/0001: the four per-restaurant policies must exist (the Supabase RLS
        // migration only WARNs when it may not create them), and nothing else may
        // open storage.objects to the publishable key. The walk-ins showcase
        // policies are known and WARN until the server-side showcase upload lands
        // (SB-3, docs/SUPABASE-GITHUB-DEPLOY.md).
        const pols = (await tx`
          select policyname, roles::text[] as roles from pg_policies
          where schemaname = 'storage' and tablename = 'objects'`) as unknown as Array<{ policyname: string; roles: string[] }>;
        const tenantPol = ['select', 'insert', 'update', 'delete'].map((op) => `invoice_scans_tenant_${op}`);
        const missingPol = tenantPol.filter((n) => !pols.some((p) => p.policyname === n));
        add('storage', 'tenant storage policies', missingPol.length ? 'FAIL' : 'PASS',
          missingPol.length
            ? `missing ${missingPol.join(', ')} — invoice scans are unreadable/unwritable for tenants (apply packages/db/drizzle/rls/0001_invoice_scans_rls.sql in the SQL editor)`
            : '4 per-restaurant policies on storage.objects');
        const walkins = pols.filter((p) => p.policyname.startsWith('invoice_scans_walkins'));
        const stray = pols.filter((p) => !tenantPol.includes(p.policyname) && !p.policyname.startsWith('invoice_scans_walkins'));
        const strayAnon = stray.filter((p) => p.roles.includes('anon') || p.roles.includes('public'));
        add('storage', 'no anonymous storage access', strayAnon.length ? 'FAIL' : walkins.length ? 'WARN' : 'PASS',
          strayAnon.length
            ? `unexpected storage.objects policies open to anon/public: ${strayAnon.map((p) => p.policyname).join(', ')} — drop them`
            : walkins.length
              ? `${walkins.map((p) => p.policyname).join(', ')}: anyone with the publishable key can list/upload walk-ins/ (showcase demo prefix only — never a tenant prefix). Drop once the server-side showcase upload ships (SB-3)`
              : 'no anon policies on storage.objects');
        const [hasLimits] = await tx`
          select count(*)::int as n from information_schema.columns
          where table_schema = 'storage' and table_name = 'buckets' and column_name in ('file_size_limit', 'allowed_mime_types')`;
        if (b.length && hasLimits!.n === 2) {
          const [lim] = await tx`select file_size_limit, allowed_mime_types from storage.buckets where id = 'invoice-scans'`;
          const ok = lim!.file_size_limit != null && lim!.allowed_mime_types != null;
          add('storage', 'invoice-scans upload limits', ok ? 'PASS' : 'WARN',
            ok ? `≤${Math.round(Number(lim!.file_size_limit) / 1048576)} MiB · ${(lim!.allowed_mime_types as string[]).join(', ')}` : 'no file_size_limit / allowed_mime_types on the bucket (apply the latest RLS migration)');
        }
      } else {
        add('storage', 'invoice-scans bucket', 'SKIP', 'no storage schema (not Supabase)');
      }

      // ── 11. Size ────────────────────────────────────────────────────────
      const sizes = (await tx`
        select relname as t, n_live_tup::bigint as n from pg_stat_user_tables where schemaname = 'public'
        order by n_live_tup desc limit 6`) as unknown as Array<{ t: string; n: string }>;
      const [tenants] = await tx`select count(*)::int as n from restaurants`;
      add('size', 'data', 'INFO', `${tenants!.n} restaurant(s) · largest: ${sizes.map((s) => `${s.t}≈${s.n}`).join(', ')}`);
    });
  } finally {
    await client.end({ timeout: 5 });
  }

  const counts = tally(findings);
  return {
    target: redactUrl(url),
    findings,
    applied: applied.map((a) => a.tag),
    pending: pending.map((p) => p.tag),
    counts,
    ok: counts.FAIL === 0,
  };
}

export function formatDoctorReport(report: DoctorReport, opts: { color?: boolean } = {}): string {
  const paint = (s: DoctorStatus) => {
    if (!opts.color) return s.padEnd(4);
    const code = { PASS: 32, WARN: 33, FAIL: 31, INFO: 36, SKIP: 90 }[s];
    return `\x1b[1;${code}m${s.padEnd(4)}\x1b[0m`;
  };
  const lines = [`db:doctor → ${report.target}`, ''];
  let section = '';
  for (const f of report.findings) {
    if (f.section !== section) {
      section = f.section;
      lines.push(`── ${section}`);
    }
    lines.push(`  ${paint(f.status)}  ${f.name}: ${f.detail}`);
  }
  const c = report.counts;
  lines.push('', `${c.FAIL} FAIL · ${c.WARN} WARN · ${c.PASS} PASS · ${c.INFO} INFO · ${c.SKIP} SKIP — ${report.ok ? 'no blocking problems' : 'BLOCKING problems above'}`);
  return lines.join('\n');
}
