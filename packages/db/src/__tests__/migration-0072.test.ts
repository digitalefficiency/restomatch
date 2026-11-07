import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  consolidatedInvoiceLinks,
  createDb,
  discrepancies,
  eq,
  exportRunInvoices,
  exportRuns,
  goodsReceipts,
  invoiceLines,
  invoices,
  leakMonthCorrections,
  leakMonthSnapshots,
  matchRuns,
  notificationPrefs,
  notificationSettings,
  poLines,
  purchaseOrders,
  pushSubscriptions,
  recoveryClaims,
  restaurants,
  supplierBankAccountChanges,
  supplierBankAccounts,
  supplierCatalogItems,
  suppliers,
  users,
} from '../index';
import { migrationsDir } from '../migrations';
import { testDbUrl } from '../test-env';

/**
 * Migration-shape test for 0072_schema_batch_a (wave 2, H-03): every new column and
 * table exists with its type, default and CHECK; the ten new tenant tables carry
 * restaurant_id NOT NULL + RLS + the `<table>_tenant` policy (plus the own-user
 * RESTRICTIVE policies); the composite same-tenant FKs refuse a cross-tenant
 * reference; deletes cascade / null / block as documented; the frozen-month and audit
 * tables are append-only; bank details are immutable and audited by trigger; the
 * notification_settings owner defaults hold.
 */
const url = testDbUrl();
const sql = postgres(url, { max: 1, prepare: false });
const db = createDb(url);

interface T {
  restaurantId: string;
  supplierId: string;
  invoiceId: string;
  claimId: string;
  grId: string;
  poId: string;
}
let A: T;
let B: T;
let userId: string;

async function seed(tag: string, businessId: string): Promise<T> {
  const [r] = await db.insert(restaurants).values({ name: `0072 ${tag}`, businessId }).returning();
  const restaurantId = r!.id;
  const [s] = await db.insert(suppliers).values({ restaurantId, name: `0072 supplier ${tag}` }).returning();
  const [inv] = await db.insert(invoices).values({ restaurantId, supplierId: s!.id, source: 'manual' }).returning();
  const [run] = await db
    .insert(matchRuns)
    .values({ restaurantId, invoiceId: inv!.id, overallStatus: 'minor' })
    .returning();
  const [d] = await db
    .insert(discrepancies)
    .values({ restaurantId, matchRunId: run!.id, type: 'PRICE_HIGHER', severity: 'warn' })
    .returning();
  const [c] = await db
    .insert(recoveryClaims)
    .values({ restaurantId, discrepancyId: d!.id, supplierId: s!.id, invoiceId: inv!.id, amountAgorot: 1234 })
    .returning();
  const [po] = await db.insert(purchaseOrders).values({ restaurantId, supplierId: s!.id }).returning();
  const [gr] = await db.insert(goodsReceipts).values({ restaurantId, poId: po!.id }).returning();
  return { restaurantId, supplierId: s!.id, invoiceId: inv!.id, claimId: c!.id, grId: gr!.id, poId: po!.id };
}

async function cleanup(t: T) {
  await db.delete(exportRunInvoices).where(eq(exportRunInvoices.restaurantId, t.restaurantId));
  await db.delete(supplierBankAccountChanges).where(eq(supplierBankAccountChanges.restaurantId, t.restaurantId));
  await db.delete(supplierBankAccounts).where(eq(supplierBankAccounts.restaurantId, t.restaurantId));
  await db.delete(leakMonthCorrections).where(eq(leakMonthCorrections.restaurantId, t.restaurantId));
  await db.delete(recoveryClaims).where(eq(recoveryClaims.restaurantId, t.restaurantId));
  await db.delete(restaurants).where(eq(restaurants.id, t.restaurantId));
}

beforeAll(async () => {
  A = await seed('A', '000000721');
  B = await seed('B', '000000722');
  const [u] = await db.insert(users).values({ email: `h03-${Date.now()}@0072.test` }).returning();
  userId = u!.id;
});
afterAll(async () => {
  await cleanup(A);
  await cleanup(B);
  await db.delete(users).where(eq(users.id, userId));
  await sql.end();
});

type Col = { table_name: string; column_name: string; data_type: string; udt_name: string; is_nullable: string; column_default: string | null };
async function col(table: string, column: string): Promise<Col | undefined> {
  const rows = (await sql`
    select table_name, column_name, data_type, udt_name, is_nullable, column_default
    from information_schema.columns
    where table_schema = 'public' and table_name = ${table} and column_name = ${column}
  `) as unknown as Col[];
  return rows[0];
}
async function checkDef(name: string): Promise<string | undefined> {
  const rows = (await sql`select pg_get_constraintdef(oid) as def from pg_constraint where conname = ${name}`) as unknown as Array<{ def: string }>;
  return rows[0]?.def;
}
async function indexDef(name: string): Promise<string | undefined> {
  const rows = (await sql`select indexdef from pg_indexes where schemaname = 'public' and indexname = ${name}`) as unknown as Array<{ indexdef: string }>;
  return rows[0]?.indexdef;
}
const pgCode = (e: unknown) => (e as { code?: string; cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code;
async function expectPgError(p: Promise<unknown>, code: string) {
  let err: unknown;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  expect(err, `expected Postgres error ${code}`).toBeDefined();
  expect(pgCode(err)).toBe(code);
}
const CHECK_VIOLATION = '23514';
const FK_VIOLATION = '23503';
const UNIQUE_VIOLATION = '23505';
const RESTRICT_VIOLATION = '23001'; // the append-only trigger

const TABLES = [
  'consolidated_invoice_links',
  'export_run_invoices',
  'export_runs',
  'leak_month_corrections',
  'leak_month_snapshots',
  'notification_prefs',
  'notification_settings',
  'push_subscriptions',
  'supplier_bank_account_changes',
  'supplier_bank_accounts',
];

describe('0072 is registered', () => {
  it('is in the journal right after 0071', () => {
    const j = JSON.parse(readFileSync(join(migrationsDir(), 'meta', '_journal.json'), 'utf8')) as {
      entries: Array<{ idx: number; tag: string; when: number }>;
    };
    const i = j.entries.findIndex((e) => e.tag === '0072_schema_batch_a');
    expect(i).toBeGreaterThan(0);
    expect(j.entries[i - 1]!.tag).toBe('0071_schema_batch_0');
    expect(j.entries[i]!.when).toBeGreaterThan(j.entries[i - 1]!.when);
  });

  it('is idempotent: re-running every statement on the migrated DB changes nothing and raises nothing', async () => {
    const stmts = readFileSync(join(migrationsDir(), '0072_schema_batch_a.sql'), 'utf8')
      .split('--> statement-breakpoint')
      .map((x) => x.trim())
      .filter(Boolean);
    const shape = async (q: typeof sql) =>
      (await q`
        select (select count(*) from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname = 'public')::int as cons,
               (select count(*) from pg_indexes where schemaname = 'public')::int as idx,
               (select count(*) from pg_trigger where not tgisinternal)::int as trg,
               (select count(*) from pg_policy)::int as pol`) as unknown as [{ cons: number; idx: number; trg: number; pol: number }];
    const ROLLBACK = new Error('rollback');
    let before: unknown;
    let after: unknown;
    await expect(
      sql.begin(async (tx) => {
        before = (await shape(tx as unknown as typeof sql))[0];
        for (const st of stmts) await tx.unsafe(st);
        after = (await shape(tx as unknown as typeof sql))[0];
        throw ROLLBACK;
      }),
    ).rejects.toBe(ROLLBACK);
    expect(after).toEqual(before);
  });

  it('takes lock_timeout + every ACCESS EXCLUSIVE lock up front: a long reader makes it fail fast, nothing applied, a re-run succeeds', async () => {
    const stmts = readFileSync(join(migrationsDir(), '0072_schema_batch_a.sql'), 'utf8')
      .split('--> statement-breakpoint')
      .map((x) => x.trim())
      .filter(Boolean);
    const code = (x: string) => x.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n').trim();
    expect(code(stmts[0]!)).toMatch(/set_config\('lock_timeout', '5s', true\)[\s\S]*set_config\('statement_timeout', '6s', true\)/);
    const lockPhase = code(stmts[1]!);
    expect(lockPhase).toMatch(/^DO \$\$\s*BEGIN\s*LOOP\s*BEGIN\s*LOCK TABLE "restaurants", "suppliers"/);
    expect(lockPhase).toMatch(/EXCEPTION WHEN lock_not_available THEN\s*PERFORM pg_sleep\(0\.05\);/);
    // Every LOCK is NOWAIT (nothing is held while waiting), parent-first: receipts before PO lines.
    const locks = lockPhase.match(/LOCK TABLE [^;]+;/g) ?? [];
    expect(locks.length).toBeGreaterThan(0);
    for (const l of locks) expect(l).toMatch(/IN ACCESS EXCLUSIVE MODE NOWAIT;$/);
    expect(lockPhase.indexOf('"goods_receipts"')).toBeLessThan(lockPhase.indexOf('"po_lines"'));
    expect(code(stmts[2]!)).toMatch(/set_config\('statement_timeout',[\s\S]*current_setting\('restomatch.prev_statement_timeout', true\)/);
    const reader = postgres(url, { max: 1, prepare: false });
    const runner = postgres(url, { max: 1, prepare: false });
    try {
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      let readerReady!: () => void;
      const ready = new Promise<void>((r) => (readerReady = r));
      const readerTx = reader.begin(async (tx) => {
        await tx`select count(*) from invoices`; // ACCESS SHARE, held until commit
        readerReady();
        await held;
      });
      await ready;
      const started = Date.now();
      let err: unknown;
      try {
        await runner.begin(async (tx) => {
          for (const st of stmts) await tx.unsafe(st);
          throw new Error('should not get here');
        });
      } catch (e) {
        err = e;
      }
      const waited = Date.now() - started;
      expect(pgCode(err)).toBe('57014'); // the NOWAIT loop retries until the 6s statement_timeout
      expect(waited).toBeLessThan(15_000);
      release();
      await readerTx;
      // Re-run once the reader is gone: every statement succeeds (rolled back here).
      const ROLLBACK = new Error('rollback');
      await expect(
        runner.begin(async (tx) => {
          for (const st of stmts) await tx.unsafe(st);
          throw ROLLBACK;
        }),
      ).rejects.toBe(ROLLBACK);
    } finally {
      await reader.end();
      await runner.end();
    }
  }, 30_000);

  it('needs no transaction block: no top-level LOCK / SET LOCAL / SAVEPOINT / BEGIN / COMMIT (the Supabase CLI sends no BEGIN)', () => {
    const file = readFileSync(join(migrationsDir(), '0072_schema_batch_a.sql'), 'utf8');
    // Strip comments and every dollar-quoted body (DO blocks, functions): what is left is top level.
    const top = file
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n')
      .replace(/\$\$[\s\S]*?\$\$/g, '$$$$');
    expect(top).not.toMatch(/^\s*LOCK\s+TABLE/im);
    expect(top).not.toMatch(/\bSET\s+LOCAL\b/i);
    expect(top).not.toMatch(/\bSAVEPOINT\b/i);
    expect(top).not.toMatch(/^\s*(BEGIN|COMMIT|START TRANSACTION)\s*;/im);
  });

  it('applies statement by statement with no BEGIN (autocommit, as the CLI applier): nothing raises 25P01, a re-run is a no-op', async () => {
    const stmts = readFileSync(join(migrationsDir(), '0072_schema_batch_a.sql'), 'utf8')
      .split('--> statement-breakpoint')
      .map((x) => x.trim())
      .filter(Boolean);
    const bare = postgres(url, { max: 1, prepare: false });
    try {
      for (const st of stmts) await bare.unsafe(st); // each statement is its own implicit transaction
      // Control: the old top-level form is exactly what this applier refuses.
      await expect(bare.unsafe('LOCK TABLE "users" IN ACCESS EXCLUSIVE MODE')).rejects.toMatchObject({ code: '25P01' });
    } finally {
      await bare.end();
    }
  });

  it('uses no enum value that 0071 adds in the same migrator batch', () => {
    const file = readFileSync(join(migrationsDir(), '0072_schema_batch_a.sql'), 'utf8')
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n');
    expect(file).not.toMatch(/ALTER TYPE/i);
    expect(file).not.toMatch(/'event'|'skipped'/);
  });
});

describe('0072 the ten new tenant tables', () => {
  it('carry a NOT NULL restaurant_id', async () => {
    for (const t of TABLES) expect((await col(t, 'restaurant_id'))?.is_nullable, t).toBe('NO');
  });

  it('enable row security with exactly one permissive policy, the per-restaurant `<table>_tenant`', async () => {
    const rows = (await sql`
      select c.relname, c.relrowsecurity, p.polname, pg_get_expr(p.polqual, p.polrelid) as qual
      from pg_class c left join pg_policy p on p.polrelid = c.oid and p.polpermissive
      where c.relname in ${sql(TABLES)} order by c.relname
    `) as unknown as Array<{ relname: string; relrowsecurity: boolean; polname: string; qual: string }>;
    expect(rows.map((r) => [r.relname, r.relrowsecurity, r.polname])).toEqual(TABLES.map((t) => [t, true, `${t}_tenant`]));
    for (const r of rows) expect(r.qual).toContain('app.current_restaurant_id()');
  });

  it('push devices, notification prefs and settings carry own-user RESTRICTIVE policies (incl. DELETE)', async () => {
    const rows = (await sql`
      select c.relname, p.polname, p.polcmd,
             coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') as expr
      from pg_policy p join pg_class c on c.oid = p.polrelid
      where not p.polpermissive and c.relname in ${sql(TABLES)} order by c.relname, p.polname
    `) as unknown as Array<{ relname: string; polname: string; polcmd: string; expr: string }>;
    expect(rows.map((r) => [r.relname, r.polname, r.polcmd])).toEqual([
      ['notification_prefs', 'notification_prefs_own_delete', 'd'],
      ['notification_prefs', 'notification_prefs_own_insert', 'a'],
      ['notification_prefs', 'notification_prefs_own_update', 'w'],
      ['notification_settings', 'notification_settings_own_delete', 'd'],
      ['notification_settings', 'notification_settings_own_insert', 'a'],
      ['notification_settings', 'notification_settings_own_update', 'w'],
      ['push_subscriptions', 'push_subscriptions_own_delete', 'd'],
      ['push_subscriptions', 'push_subscriptions_own_insert', 'a'],
      ['push_subscriptions', 'push_subscriptions_own_select', 'r'],
      ['push_subscriptions', 'push_subscriptions_own_update', 'w'],
    ]);
    for (const r of rows) expect(r.expr).toContain('app.current_user_id()');
  });

  it('are in the rls/0002 table list', () => {
    const rls = readFileSync(join(migrationsDir(), 'rls', '0002_core_tenant_rls.sql'), 'utf8');
    for (const t of TABLES) expect(rls).toContain(`'${t}'`);
  });

  it('have UNIQUE (id, restaurant_id) for same-tenant composite FKs (goods_receipts gains one too)', async () => {
    for (const t of [...TABLES, 'goods_receipts']) expect(await checkDef(`${t}_id_restaurant_id_key`), t).toBe('UNIQUE (id, restaurant_id)');
  });

  it('cascade away with their restaurant (NO ACTION FKs are checked at statement end)', async () => {
    const t = await seed('cascade', '000000723');
    const [run] = await db
      .insert(exportRuns)
      .values({ restaurantId: t.restaurantId, rangeFrom: '2026-10-01', rangeTo: '2026-10-31', format: 'hashavshevet', mode: 'new_only' })
      .returning();
    await db.insert(exportRunInvoices).values({ restaurantId: t.restaurantId, exportRunId: run!.id, invoiceId: t.invoiceId });
    await db.insert(consolidatedInvoiceLinks).values({ restaurantId: t.restaurantId, invoiceId: t.invoiceId, goodsReceiptId: t.grId, source: 'manual' });
    const [snap] = await db.insert(leakMonthSnapshots).values({ restaurantId: t.restaurantId, month: '2026-09-01', leakAgorot: 100 }).returning();
    await db.insert(leakMonthCorrections).values({ restaurantId: t.restaurantId, snapshotId: snap!.id, deltaAgorot: 5, reason: 'late credit note' });
    const [acct] = await db
      .insert(supplierBankAccounts)
      .values({ restaurantId: t.restaurantId, supplierId: t.supplierId, bankCode: '12', branchCode: '345', accountNumberEnc: 'v1:x', accountLast4: '6789' })
      .returning();
    await db.insert(supplierBankAccountChanges).values({ restaurantId: t.restaurantId, bankAccountId: acct!.id, after: { account_last4: '6789' } });
    await db.insert(pushSubscriptions).values({ restaurantId: t.restaurantId, userId, endpoint: `https://push.test/${t.restaurantId}`, p256dh: 'k', auth: 'a' });
    await db.insert(notificationPrefs).values({ restaurantId: t.restaurantId, userId, channel: 'email', eventKind: 'claim_overdue' });
    await db.insert(notificationSettings).values({ restaurantId: t.restaurantId, userId });
    await db.delete(recoveryClaims).where(eq(recoveryClaims.restaurantId, t.restaurantId));
    await db.delete(restaurants).where(eq(restaurants.id, t.restaurantId));
    for (const tbl of TABLES) {
      const [{ n }] = (await sql`select count(*)::int as n from ${sql(tbl)} where restaurant_id = ${t.restaurantId}`) as unknown as [{ n: number }];
      expect(n, tbl).toBe(0);
    }
  });
});

describe('0072 invoices payment facts', () => {
  it('adds paid_at / paid_amount numeric(12,2) / payment_method / payment_ref, all nullable, no default', async () => {
    expect(await col('invoices', 'paid_at')).toMatchObject({ data_type: 'timestamp with time zone', is_nullable: 'YES', column_default: null });
    expect(await col('invoices', 'paid_amount')).toMatchObject({ data_type: 'numeric', is_nullable: 'YES', column_default: null });
    expect(await col('invoices', 'payment_method')).toMatchObject({ data_type: 'character varying', is_nullable: 'YES', column_default: null });
    expect(await col('invoices', 'payment_ref')).toMatchObject({ data_type: 'text', is_nullable: 'YES' });
    const [{ numeric_precision, numeric_scale }] = (await sql`
      select numeric_precision, numeric_scale from information_schema.columns
      where table_name = 'invoices' and column_name = 'paid_amount'`) as unknown as [{ numeric_precision: number; numeric_scale: number }];
    expect([numeric_precision, numeric_scale]).toEqual([12, 2]);
  });

  it('paid_at and paid_amount are both NULL or both set; method/ref only when paid; amount >= 0', async () => {
    const id = A.invoiceId;
    await expectPgError(sql`update invoices set paid_at = now() where id = ${id}`, CHECK_VIOLATION);
    await expectPgError(sql`update invoices set paid_amount = 10 where id = ${id}`, CHECK_VIOLATION);
    await expectPgError(sql`update invoices set payment_method = 'cash' where id = ${id}`, CHECK_VIOLATION);
    await expectPgError(sql`update invoices set payment_ref = 'x' where id = ${id}`, CHECK_VIOLATION);
    await expectPgError(sql`update invoices set paid_at = now(), paid_amount = -1 where id = ${id}`, CHECK_VIOLATION);
    await expectPgError(sql`update invoices set paid_at = now(), paid_amount = 1, payment_method = 'bitcoin' where id = ${id}`, CHECK_VIOLATION);
    for (const m of ['bank_transfer', 'check', 'cash', 'card', 'offset', 'other'] as const) {
      await db.update(invoices).set({ paidAt: new Date(), paidAmount: '1180.00', paymentMethod: m, paymentRef: 'REF-1' }).where(eq(invoices.id, id));
    }
    await db.update(invoices).set({ paidAt: null, paidAmount: null, paymentMethod: null, paymentRef: null }).where(eq(invoices.id, id));
  });

  it('an invoice already in status paid stays valid with paid_at NULL (never backfilled)', async () => {
    await db.update(invoices).set({ status: 'paid' }).where(eq(invoices.id, B.invoiceId));
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, B.invoiceId));
    expect(inv).toMatchObject({ status: 'paid', paidAt: null, paidAmount: null });
    const file = readFileSync(join(migrationsDir(), '0072_schema_batch_a.sql'), 'utf8');
    expect(file).not.toMatch(/^\s*UPDATE\s/im); // no backfill statement anywhere in 0072
  });

  it('documents what paid_at means (the business pay day, Israel midnight; the recording instant is in audit_log)', async () => {
    const [{ c }] = (await sql`select col_description('invoices'::regclass, attnum) as c from pg_attribute
      where attrelid = 'invoices'::regclass and attname = 'paid_at'`) as unknown as [{ c: string }];
    expect(c).toMatch(/money left/);
    expect(c).toMatch(/00:00 Asia\/Jerusalem/);
    expect(c).toMatch(/audit_log\.at/);
  });
});

describe('0072 export_runs + export_run_invoices', () => {
  it('has the documented columns, defaults and CHECKs', async () => {
    expect(await col('export_runs', 'range_from')).toMatchObject({ data_type: 'date', is_nullable: 'NO' });
    expect(await col('export_runs', 'total_agorot')).toMatchObject({ data_type: 'bigint', is_nullable: 'NO', column_default: '0' });
    for (const c of ['invoice_count', 'skipped_count', 'replaced_chars']) {
      expect(await col('export_runs', c)).toMatchObject({ data_type: 'integer', is_nullable: 'NO', column_default: '0' });
    }
    const base = { restaurantId: A.restaurantId, rangeFrom: '2026-10-01', rangeTo: '2026-10-31', createdBy: userId } as const;
    const [run] = await db.insert(exportRuns).values({ ...base, format: 'hashavshevet', mode: 'new_only' }).returning();
    expect(run).toMatchObject({ invoiceCount: 0, totalAgorot: 0, skippedCount: 0, replacedChars: 0 });
    await expectPgError(sql`update export_runs set format = 'xlsx' where id = ${run!.id}`, CHECK_VIOLATION);
    await db.update(exportRuns).set({ format: 'accountant_pack' }).where(eq(exportRuns.id, run!.id)); // W3-05
    await expectPgError(sql`update export_runs set mode = 'some' where id = ${run!.id}`, CHECK_VIOLATION);
    await expectPgError(sql`update export_runs set range_to = '2026-09-30' where id = ${run!.id}`, CHECK_VIOLATION);
    await expectPgError(sql`update export_runs set skipped_count = -1 where id = ${run!.id}`, CHECK_VIOLATION);
    await db.delete(exportRuns).where(eq(exportRuns.id, run!.id));
  });

  it('logs an invoice once per run, refuses a cross-tenant run or invoice, blocks deleting an exported invoice, cascades with the run', async () => {
    const mk = (restaurantId: string) =>
      db
        .insert(exportRuns)
        .values({ restaurantId, rangeFrom: '2026-10-01', rangeTo: '2026-10-31', format: 'priority', mode: 'all' })
        .returning();
    const [ra] = await mk(A.restaurantId);
    const [rb] = await mk(B.restaurantId);
    await db.insert(exportRunInvoices).values({ restaurantId: A.restaurantId, exportRunId: ra!.id, invoiceId: A.invoiceId });
    await expectPgError(
      db.insert(exportRunInvoices).values({ restaurantId: A.restaurantId, exportRunId: ra!.id, invoiceId: A.invoiceId }),
      UNIQUE_VIOLATION,
    );
    await expectPgError(
      db.insert(exportRunInvoices).values({ restaurantId: A.restaurantId, exportRunId: ra!.id, invoiceId: B.invoiceId }),
      FK_VIOLATION,
    );
    await expectPgError(
      db.insert(exportRunInvoices).values({ restaurantId: A.restaurantId, exportRunId: rb!.id, invoiceId: A.invoiceId }),
      FK_VIOLATION,
    );
    await expectPgError(sql`delete from invoices where id = ${A.invoiceId}`, FK_VIOLATION);
    expect(await indexDef('export_run_invoices_invoice_idx')).toMatch(/\(invoice_id, restaurant_id\)/);
    await db.delete(exportRuns).where(eq(exportRuns.id, ra!.id));
    const left = await db.select().from(exportRunInvoices).where(eq(exportRunInvoices.exportRunId, ra!.id));
    expect(left).toHaveLength(0);
    await db.delete(exportRuns).where(eq(exportRuns.id, rb!.id));
  });
});

describe('0072 consolidated_invoice_links', () => {
  it('links an invoice to a receipt once, CHECKs source, refuses cross-tenant pairs, cascades with the receipt', async () => {
    expect(await col('consolidated_invoice_links', 'linked_at')).toMatchObject({ is_nullable: 'NO', column_default: 'now()' });
    const [l] = await db
      .insert(consolidatedInvoiceLinks)
      .values({ restaurantId: A.restaurantId, invoiceId: A.invoiceId, goodsReceiptId: A.grId, source: 'proposal_accept', linkedBy: userId })
      .returning();
    await expectPgError(
      db.insert(consolidatedInvoiceLinks).values({ restaurantId: A.restaurantId, invoiceId: A.invoiceId, goodsReceiptId: A.grId, source: 'manual' }),
      UNIQUE_VIOLATION,
    );
    await expectPgError(sql`update consolidated_invoice_links set source = 'ocr' where id = ${l!.id}`, CHECK_VIOLATION);
    await expectPgError(
      db.insert(consolidatedInvoiceLinks).values({ restaurantId: A.restaurantId, invoiceId: A.invoiceId, goodsReceiptId: B.grId, source: 'manual' }),
      FK_VIOLATION,
    );
    await expectPgError(
      db.insert(consolidatedInvoiceLinks).values({ restaurantId: A.restaurantId, invoiceId: B.invoiceId, goodsReceiptId: A.grId, source: 'manual' }),
      FK_VIOLATION,
    );
    const [gr] = await db.insert(goodsReceipts).values({ restaurantId: A.restaurantId }).returning();
    await db.insert(consolidatedInvoiceLinks).values({ restaurantId: A.restaurantId, invoiceId: A.invoiceId, goodsReceiptId: gr!.id, source: 'manual' });
    await db.delete(goodsReceipts).where(eq(goodsReceipts.id, gr!.id));
    const left = await db.select().from(consolidatedInvoiceLinks).where(eq(consolidatedInvoiceLinks.goodsReceiptId, gr!.id));
    expect(left).toHaveLength(0);
    await db.delete(consolidatedInvoiceLinks).where(eq(consolidatedInvoiceLinks.id, l!.id));
  });
});

describe('0072 leak_month_snapshots + leak_month_corrections (frozen months)', () => {
  it('a snapshot is the 1st of a month, versioned per restaurant+month, leak >= 0, payload defaults {}', async () => {
    expect(await col('leak_month_snapshots', 'leak_agorot')).toMatchObject({ data_type: 'bigint', is_nullable: 'NO' });
    expect(await col('leak_month_snapshots', 'month')).toMatchObject({ data_type: 'date', is_nullable: 'NO' });
    const [s] = await db.insert(leakMonthSnapshots).values({ restaurantId: A.restaurantId, month: '2026-08-01', leakAgorot: 35500 }).returning();
    expect(s).toMatchObject({ version: 1, payload: {} });
    await expectPgError(
      db.insert(leakMonthSnapshots).values({ restaurantId: A.restaurantId, month: '2026-08-01', leakAgorot: 1 }),
      UNIQUE_VIOLATION,
    );
    // A re-close (version >= 2) must say why; version 1 may not.
    await expectPgError(
      db.insert(leakMonthSnapshots).values({ restaurantId: A.restaurantId, month: '2026-08-01', version: 2, leakAgorot: 36000 }),
      CHECK_VIOLATION,
    );
    await expectPgError(
      db.insert(leakMonthSnapshots).values({ restaurantId: A.restaurantId, month: '2026-08-01', version: 2, leakAgorot: 36000, reason: '  ' }),
      CHECK_VIOLATION,
    );
    const [u] = await db.insert(users).values({ email: `h03-snap-${Date.now()}@0072.test` }).returning();
    const [v2] = await db
      .insert(leakMonthSnapshots)
      .values({ restaurantId: A.restaurantId, month: '2026-08-01', version: 2, leakAgorot: 36000, reason: 'late credit note re-close', createdBy: u!.id })
      .returning();
    await db.delete(users).where(eq(users.id, u!.id)); // the actor FK still nulls through the append-only guard
    const [v2after] = await db.select().from(leakMonthSnapshots).where(eq(leakMonthSnapshots.id, v2!.id));
    expect(v2after).toMatchObject({ createdBy: null, leakAgorot: 36000, reason: 'late credit note re-close' });
    await db.insert(leakMonthSnapshots).values({ restaurantId: B.restaurantId, month: '2026-08-01', leakAgorot: 1 });
    await expectPgError(db.insert(leakMonthSnapshots).values({ restaurantId: A.restaurantId, month: '2026-08-15', leakAgorot: 1 }), CHECK_VIOLATION);
    await expectPgError(db.insert(leakMonthSnapshots).values({ restaurantId: A.restaurantId, month: '2026-07-01', leakAgorot: -1 }), CHECK_VIOLATION);
    await expectPgError(
      db.insert(leakMonthSnapshots).values({ restaurantId: A.restaurantId, month: '2026-07-01', version: 0, leakAgorot: 1 }),
      CHECK_VIOLATION,
    );
  });

  it('the append-only triggers fire on UPDATE and DELETE (the tenant-role DELETE denial is in rls.attack)', async () => {
    const rows = (await sql`
      select tgname, (tgtype & 8) <> 0 as on_delete, (tgtype & 16) <> 0 as on_update
      from pg_trigger where tgname like '%_append_only' and not tgisinternal order by tgname`) as unknown as Array<{ tgname: string; on_delete: boolean; on_update: boolean }>;
    expect(rows).toEqual(
      ['leak_month_corrections', 'leak_month_snapshots', 'supplier_bank_account_changes'].map((t) => ({
        tgname: `${t}_append_only`,
        on_delete: true,
        on_update: true,
      })),
    );
  });

  it('a snapshot is append-only: no UPDATE, ever (a printed month never restates)', async () => {
    const [s] = await db.insert(leakMonthSnapshots).values({ restaurantId: A.restaurantId, month: '2026-06-01', leakAgorot: 100 }).returning();
    await expectPgError(sql`update leak_month_snapshots set leak_agorot = 99 where id = ${s!.id}`, RESTRICT_VIOLATION);
    await expectPgError(sql`update leak_month_snapshots set payload = '{"x":1}' where id = ${s!.id}`, RESTRICT_VIOLATION);
    const [after] = await db.select().from(leakMonthSnapshots).where(eq(leakMonthSnapshots.id, s!.id));
    expect(after!.leakAgorot).toBe(100);
  });

  it('a correction carries a non-zero delta and a reason, is append-only, blocks deleting its snapshot, refuses another tenant’s snapshot', async () => {
    const [s] = await db.insert(leakMonthSnapshots).values({ restaurantId: A.restaurantId, month: '2026-05-01', leakAgorot: 100 }).returning();
    const [sb] = await db.insert(leakMonthSnapshots).values({ restaurantId: B.restaurantId, month: '2026-05-01', leakAgorot: 100 }).returning();
    const [u] = await db.insert(users).values({ email: `h03-corr-${Date.now()}@0072.test` }).returning();
    const [c] = await db
      .insert(leakMonthCorrections)
      .values({ restaurantId: A.restaurantId, snapshotId: s!.id, deltaAgorot: -2500, reason: 'credit note after close', entityType: 'credit_note', createdBy: u!.id })
      .returning();
    await expectPgError(
      db.insert(leakMonthCorrections).values({ restaurantId: A.restaurantId, snapshotId: s!.id, deltaAgorot: 0, reason: 'zero' }),
      CHECK_VIOLATION,
    );
    await expectPgError(
      db.insert(leakMonthCorrections).values({ restaurantId: A.restaurantId, snapshotId: s!.id, deltaAgorot: 1, reason: '   ' }),
      CHECK_VIOLATION,
    );
    await expectPgError(
      db.insert(leakMonthCorrections).values({ restaurantId: A.restaurantId, snapshotId: sb!.id, deltaAgorot: 1, reason: 'cross' }),
      FK_VIOLATION,
    );
    await expectPgError(sql`update leak_month_corrections set delta_agorot = 1 where id = ${c!.id}`, RESTRICT_VIOLATION);
    await expectPgError(sql`delete from leak_month_snapshots where id = ${s!.id}`, FK_VIOLATION);
    // The actor FK still works: deleting the user nulls created_by (the only UPDATE let through).
    await db.delete(users).where(eq(users.id, u!.id));
    const [after] = await db.select().from(leakMonthCorrections).where(eq(leakMonthCorrections.id, c!.id));
    expect(after).toMatchObject({ createdBy: null, deltaAgorot: -2500, reason: 'credit note after close' });
  });
});

describe('0072 recovery_claims.seq_no / restaurants address', () => {
  it('seq_no is nullable, > 0, unique per restaurant only', async () => {
    expect(await col('recovery_claims', 'seq_no')).toMatchObject({ data_type: 'integer', is_nullable: 'YES', column_default: null });
    await db.update(recoveryClaims).set({ seqNo: 1 }).where(eq(recoveryClaims.id, A.claimId));
    await db.update(recoveryClaims).set({ seqNo: 1 }).where(eq(recoveryClaims.id, B.claimId));
    await expectPgError(sql`update recovery_claims set seq_no = 0 where id = ${A.claimId}`, CHECK_VIOLATION);
    const [run] = await db.insert(matchRuns).values({ restaurantId: A.restaurantId, invoiceId: A.invoiceId, overallStatus: 'minor' }).returning();
    const [d] = await db
      .insert(discrepancies)
      .values({ restaurantId: A.restaurantId, matchRunId: run!.id, type: 'QTY_SHORT', severity: 'warn' })
      .returning();
    await expectPgError(
      db.insert(recoveryClaims).values({ restaurantId: A.restaurantId, discrepancyId: d!.id, amountAgorot: 1, seqNo: 1 }),
      UNIQUE_VIOLATION,
    );
    await db.delete(matchRuns).where(eq(matchRuns.id, run!.id));
    await db.update(recoveryClaims).set({ seqNo: null }).where(eq(recoveryClaims.restaurantId, A.restaurantId));
    await db.update(recoveryClaims).set({ seqNo: null }).where(eq(recoveryClaims.restaurantId, B.restaurantId));
  });

  it('restaurants.address text and contact_phone varchar(32), nullable', async () => {
    expect(await col('restaurants', 'address')).toMatchObject({ data_type: 'text', is_nullable: 'YES' });
    expect(await col('restaurants', 'contact_phone')).toMatchObject({ data_type: 'character varying', is_nullable: 'YES' });
    await db.update(restaurants).set({ address: 'רחוב הנמל 1, חיפה', contactPhone: '04-1234567' }).where(eq(restaurants.id, A.restaurantId));
  });
});

describe('0072 supplier_bank_accounts + supplier_bank_account_changes', () => {
  const acct = (restaurantId: string, supplierId: string, over: Record<string, unknown> = {}) => ({
    restaurantId,
    supplierId,
    bankCode: '12',
    branchCode: '345',
    accountNumberEnc: 'v1:iv:ct:tag',
    accountLast4: '6789',
    ...over,
  });

  const dropAccounts = async (where: ReturnType<typeof eq>) => {
    const ids = (await db.select({ id: supplierBankAccounts.id }).from(supplierBankAccounts).where(where)).map((r) => r.id);
    for (const id of ids) await db.delete(supplierBankAccountChanges).where(eq(supplierBankAccountChanges.bankAccountId, id));
    await db.delete(supplierBankAccounts).where(where);
  };
  const changesOf = (id: string) =>
    db.select().from(supplierBankAccountChanges).where(eq(supplierBankAccountChanges.bankAccountId, id)).orderBy(supplierBankAccountChanges.changedAt);

  it('CHECKs the codes and last4, refuses a clear number (only a v<n>: envelope), one ACTIVE account per (restaurant, supplier), updated_at by trigger', async () => {
    expect(await col('supplier_bank_accounts', 'account_number_enc')).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(await col('supplier_bank_accounts', 'active')).toMatchObject({ is_nullable: 'NO', column_default: 'true' });
    await expectPgError(db.insert(supplierBankAccounts).values(acct(A.restaurantId, A.supplierId, { bankCode: 'AB' })), CHECK_VIOLATION);
    await expectPgError(db.insert(supplierBankAccounts).values(acct(A.restaurantId, A.supplierId, { branchCode: '12' })), CHECK_VIOLATION);
    await expectPgError(db.insert(supplierBankAccounts).values(acct(A.restaurantId, A.supplierId, { accountLast4: 'x123' })), CHECK_VIOLATION);
    await expectPgError(db.insert(supplierBankAccounts).values(acct(A.restaurantId, A.supplierId, { accountNumberEnc: ' ' })), CHECK_VIOLATION);
    await expectPgError(db.insert(supplierBankAccounts).values(acct(A.restaurantId, A.supplierId, { accountNumberEnc: '123456789' })), CHECK_VIOLATION);
    await expectPgError(db.insert(supplierBankAccounts).values(acct(A.restaurantId, A.supplierId, { accountNumberEnc: 'enc:123' })), CHECK_VIOLATION);
    expect(await indexDef('supplier_bank_accounts_one_active')).toMatch(/\(restaurant_id, supplier_id\) WHERE active/);
    const [a1] = await db.insert(supplierBankAccounts).values(acct(A.restaurantId, A.supplierId)).returning();
    await expectPgError(db.insert(supplierBankAccounts).values(acct(A.restaurantId, A.supplierId)), UNIQUE_VIOLATION);
    await db.update(supplierBankAccounts).set({ active: false }).where(eq(supplierBankAccounts.id, a1!.id));
    const [a2] = await db.insert(supplierBankAccounts).values(acct(A.restaurantId, A.supplierId, { accountLast4: '1111' })).returning();
    await sql`update supplier_bank_accounts set updated_at = '2000-01-01' where id = ${a2!.id}`;
    await sql`update supplier_bank_accounts set holder_name = 'ספק בע"מ' where id = ${a2!.id}`;
    const [{ updated_at }] = (await sql`select updated_at from supplier_bank_accounts where id = ${a2!.id}`) as unknown as [{ updated_at: Date }];
    expect(updated_at.getUTCFullYear()).toBeGreaterThan(2000);
    await dropAccounts(eq(supplierBankAccounts.supplierId, A.supplierId));
  });

  it('bank details are immutable: only active / verified_* / holder_name may change (a new account is a new row)', async () => {
    const [a] = await db.insert(supplierBankAccounts).values(acct(A.restaurantId, A.supplierId)).returning();
    for (const [c, v] of [
      ['bank_code', '13'],
      ['branch_code', '999'],
      ['account_number_enc', 'v2:other'],
      ['account_last4', '0000'],
      ['supplier_id', B.supplierId],
    ] as const) {
      await expectPgError(sql`update supplier_bank_accounts set ${sql(c)} = ${v} where id = ${a!.id}`, RESTRICT_VIOLATION);
    }
    await db
      .update(supplierBankAccounts)
      .set({ active: false, verifiedBy: userId, verifiedAt: new Date(), holderName: 'שם בעל החשבון' })
      .where(eq(supplierBankAccounts.id, a!.id));
    const [after] = await db.select().from(supplierBankAccounts).where(eq(supplierBankAccounts.id, a!.id));
    expect(after).toMatchObject({ bankCode: '12', accountLast4: '6789', accountNumberEnc: 'v1:iv:ct:tag', active: false, verifiedBy: userId });
    await dropAccounts(eq(supplierBankAccounts.id, a!.id));
  });

  it('every insert and masked change writes the audit row itself (changed_by = the session user); a no-op update logs nothing', async () => {
    let id = '';
    await sql.begin(async (tx) => {
      await tx`select set_config('app.current_user_id', ${userId}, true)`;
      const [r] = (await tx`insert into supplier_bank_accounts (restaurant_id, supplier_id, bank_code, branch_code, account_number_enc, account_last4)
        values (${A.restaurantId}, ${A.supplierId}, '12', '345', 'v1:k:iv:ct:tag', '6789') returning id`) as unknown as [{ id: string }];
      id = r.id;
    });
    let log = await changesOf(id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      restaurantId: A.restaurantId,
      changedBy: userId,
      before: null,
      after: { bank_code: '12', branch_code: '345', account_last4: '6789', holder_name: null, active: true, verified_by: null, verified_at: null },
    });
    expect(JSON.stringify(log[0])).not.toContain('v1:k:iv:ct:tag'); // the ciphertext never reaches the audit
    await sql`update supplier_bank_accounts set updated_at = now() where id = ${id}`; // no masked field changed
    expect(await changesOf(id)).toHaveLength(1);
    await db.update(supplierBankAccounts).set({ active: false }).where(eq(supplierBankAccounts.id, id));
    log = await changesOf(id);
    expect(log).toHaveLength(2);
    expect(log[1]).toMatchObject({ changedBy: null, before: { active: true }, after: { active: false } }); // owner connection: no session user
    await dropAccounts(eq(supplierBankAccounts.id, id));
  });

  it('refuses another restaurant’s supplier and blocks deleting a supplier that has bank details', async () => {
    await expectPgError(db.insert(supplierBankAccounts).values(acct(A.restaurantId, B.supplierId)), FK_VIOLATION);
    const [s] = await db.insert(suppliers).values({ restaurantId: A.restaurantId, name: '0072 banked' }).returning();
    await db.insert(supplierBankAccounts).values(acct(A.restaurantId, s!.id));
    await expectPgError(db.delete(suppliers).where(eq(suppliers.id, s!.id)), FK_VIOLATION);
    await dropAccounts(eq(supplierBankAccounts.supplierId, s!.id));
    await db.delete(suppliers).where(eq(suppliers.id, s!.id));
  });

  it('the change audit is masked by an ALLOWLIST (nothing nested sneaks through), append-only, blocks deleting its account, refuses cross-tenant', async () => {
    const [a] = await db.insert(supplierBankAccounts).values(acct(A.restaurantId, A.supplierId)).returning();
    const [ab] = await db.insert(supplierBankAccounts).values(acct(B.restaurantId, B.supplierId)).returning();
    const [u] = await db.insert(users).values({ email: `h03-bank-${Date.now()}@0072.test` }).returning();
    const masked = { bank_code: '12', branch_code: '345', account_last4: '6789' };
    const [ch] = await db
      .insert(supplierBankAccountChanges)
      .values({ restaurantId: A.restaurantId, bankAccountId: a!.id, changedBy: u!.id, before: null, after: masked })
      .returning();
    const leaks: Array<Record<string, unknown>> = [
      { account_number: '123456789' },
      { accountNumber: '123456789' },
      { account_number_enc: 'v1:x' },
      { note: { account_number: '123456789' } }, // nested under a key that is not allowed
      { holder: 'x' },
    ];
    for (const leaked of leaks) {
      await expectPgError(
        db.insert(supplierBankAccountChanges).values({ restaurantId: A.restaurantId, bankAccountId: a!.id, after: { ...masked, ...leaked } }),
        CHECK_VIOLATION,
      );
      await expectPgError(
        db.insert(supplierBankAccountChanges).values({ restaurantId: A.restaurantId, bankAccountId: a!.id, before: leaked, after: masked }),
        CHECK_VIOLATION,
      );
    }
    // Value types too: nothing nested under an ALLOWED key, no ciphertext under holder_name.
    const typed: Array<Record<string, unknown>> = [
      { holder_name: { account_number: '123456789' } },
      { holder_name: 'v1:kid:iv:ct:tag' },
      { holder_name: ['123456789'] },
      { bank_code: { n: '12' } },
      { bank_code: 12 },
      { branch_code: '3456789' },
      { account_last4: 6789 },
      { active: 'yes' },
      { verified_by: { account_number: '123456789' } },
      { verified_at: ['x'] },
    ];
    for (const leaked of typed) {
      await expectPgError(
        db.insert(supplierBankAccountChanges).values({ restaurantId: A.restaurantId, bankAccountId: a!.id, after: { ...masked, ...leaked } }),
        CHECK_VIOLATION,
      );
      await expectPgError(
        db.insert(supplierBankAccountChanges).values({ restaurantId: A.restaurantId, bankAccountId: a!.id, before: { ...masked, ...leaked }, after: masked }),
        CHECK_VIOLATION,
      );
    }
    for (const bad of [{ ...masked, account_last4: '123456789' }, { ...masked, account_last4: 'abcd' }]) {
      await expectPgError(db.insert(supplierBankAccountChanges).values({ restaurantId: A.restaurantId, bankAccountId: a!.id, after: bad }), CHECK_VIOLATION);
    }
    await expectPgError(sql`insert into supplier_bank_account_changes (restaurant_id, bank_account_id, after) values (${A.restaurantId}, ${a!.id}, '["12"]')`, CHECK_VIOLATION);
    await expectPgError(
      db.insert(supplierBankAccountChanges).values({ restaurantId: A.restaurantId, bankAccountId: ab!.id, after: masked }),
      FK_VIOLATION,
    );
    await expectPgError(sql`update supplier_bank_account_changes set after = '{}' where id = ${ch!.id}`, RESTRICT_VIOLATION);
    await expectPgError(sql`delete from supplier_bank_accounts where id = ${a!.id}`, FK_VIOLATION);
    await db.delete(users).where(eq(users.id, u!.id));
    const [after] = await db.select().from(supplierBankAccountChanges).where(eq(supplierBankAccountChanges.id, ch!.id));
    expect(after).toMatchObject({ changedBy: null, after: masked });
    // The audit trigger is the only writer: SECURITY DEFINER with a pinned search_path.
    const [fn] = (await sql`select prosecdef, proconfig from pg_proc where proname = 'restomatch_bank_account_audit'`) as unknown as Array<{ prosecdef: boolean; proconfig: string[] }>;
    expect(fn).toMatchObject({ prosecdef: true, proconfig: ['search_path=pg_catalog, public'] });
    await dropAccounts(eq(supplierBankAccounts.id, a!.id));
    await dropAccounts(eq(supplierBankAccounts.id, ab!.id));
  });
});

describe('0072 suppliers min order / fee, line order, price-list date', () => {
  it('min_order_ils and delivery_fee_ils are nullable numeric(12,2) shekels >= 0', async () => {
    for (const c of ['min_order_ils', 'delivery_fee_ils']) {
      expect(await col('suppliers', c)).toMatchObject({ data_type: 'numeric', is_nullable: 'YES', column_default: null });
      await expectPgError(sql`update suppliers set ${sql(c)} = -0.01 where id = ${A.supplierId}`, CHECK_VIOLATION);
    }
    await db.update(suppliers).set({ minOrderIls: '500.00', deliveryFeeIls: '35.00' }).where(eq(suppliers.id, A.supplierId));
    const [s] = await db.select().from(suppliers).where(eq(suppliers.id, A.supplierId));
    expect(s).toMatchObject({ minOrderIls: '500.00', deliveryFeeIls: '35.00' });
  });

  it('po_lines.line_no and invoice_lines.line_no are nullable ints >= 1, indexed with their parent', async () => {
    expect(await col('po_lines', 'line_no')).toMatchObject({ data_type: 'integer', is_nullable: 'YES' });
    expect(await col('invoice_lines', 'line_no')).toMatchObject({ data_type: 'integer', is_nullable: 'YES' });
    expect(await indexDef('po_lines_po_line_no_idx')).toMatch(/\(po_id, line_no\)/);
    expect(await indexDef('invoice_lines_invoice_line_no_idx')).toMatch(/\(invoice_id, line_no\)/);
    const [pl] = await db.insert(poLines).values({ poId: A.poId, qtyOrdered: '2', unit: 'kg', lineNo: 1 }).returning();
    const [il] = await db
      .insert(invoiceLines)
      .values({ invoiceId: A.invoiceId, rawDescription: 'עגבניה', qtyBilled: '2', unit: 'kg', unitPriceBilled: '8.5000', lineTotal: '17.00', lineNo: 1 })
      .returning();
    expect([pl!.lineNo, il!.lineNo]).toEqual([1, 1]);
    await expectPgError(sql`update po_lines set line_no = 0 where id = ${pl!.id}`, CHECK_VIOLATION);
    await expectPgError(sql`update invoice_lines set line_no = 0 where id = ${il!.id}`, CHECK_VIOLATION);
    await db.delete(poLines).where(eq(poLines.id, pl!.id));
    await db.delete(invoiceLines).where(eq(invoiceLines.id, il!.id));
  });

  it('supplier_catalog_items.effective_from is a nullable date', async () => {
    expect(await col('supplier_catalog_items', 'effective_from')).toMatchObject({ data_type: 'date', is_nullable: 'YES', column_default: null });
    const [ci] = await db
      .insert(supplierCatalogItems)
      .values({ restaurantId: A.restaurantId, supplierId: A.supplierId, supplierNameRaw: 'שמן זית', effectiveFrom: '2026-11-01' })
      .returning();
    expect(ci!.effectiveFrom).toBe('2026-11-01');
    await db.delete(supplierCatalogItems).where(eq(supplierCatalogItems.id, ci!.id));
  });
});

describe('0072 push_subscriptions / WhatsApp consent / notification_prefs + settings', () => {
  it('a push endpoint is unique per restaurant and https; the subscription goes with its user', async () => {
    const [u] = await db.insert(users).values({ email: `h03-push-${Date.now()}@0072.test` }).returning();
    const endpoint = `https://push.test/${u!.id}`;
    const [p] = await db.insert(pushSubscriptions).values({ restaurantId: A.restaurantId, userId: u!.id, endpoint, p256dh: 'k', auth: 'a' }).returning();
    expect(p).toMatchObject({ lastSeenAt: null, revokedAt: null, userAgent: null });
    await expectPgError(
      db.insert(pushSubscriptions).values({ restaurantId: A.restaurantId, userId: u!.id, endpoint, p256dh: 'k2', auth: 'a2' }),
      UNIQUE_VIOLATION,
    );
    // The same device in the user's other restaurant is its own row.
    await db.insert(pushSubscriptions).values({ restaurantId: B.restaurantId, userId: u!.id, endpoint, p256dh: 'k', auth: 'a' });
    await expectPgError(
      db.insert(pushSubscriptions).values({ restaurantId: A.restaurantId, userId: u!.id, endpoint: 'http://push.test/x', p256dh: 'k', auth: 'a' }),
      CHECK_VIOLATION,
    );
    await db.delete(users).where(eq(users.id, u!.id));
    expect(await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.id, p!.id))).toHaveLength(0);
  });

  it('users WhatsApp consent: opting in needs _at + _source; an admin may only revoke; notice version recorded', async () => {
    expect(await col('users', 'whatsapp_opt_in')).toMatchObject({ data_type: 'boolean', is_nullable: 'NO', column_default: 'false' });
    expect(await col('users', 'whatsapp_opt_in_at')).toMatchObject({ data_type: 'timestamp with time zone', is_nullable: 'YES' });
    expect(await col('users', 'whatsapp_opt_in_source')).toMatchObject({ data_type: 'character varying', is_nullable: 'YES' });
    expect(await col('users', 'whatsapp_opt_in_notice_version')).toMatchObject({ data_type: 'character varying', is_nullable: 'YES' });
    const [u] = await db.select().from(users).where(eq(users.id, userId));
    expect(u).toMatchObject({ whatsappOptIn: false, whatsappOptInAt: null, whatsappOptInSource: null, whatsappOptInNoticeVersion: null });
    for (const v of ['settings', 'onboarding', 'whatsapp_reply'] as const) {
      await db
        .update(users)
        .set({ whatsappOptIn: true, whatsappOptInAt: new Date(), whatsappOptInSource: v, whatsappOptInNoticeVersion: '2026-11' })
        .where(eq(users.id, userId));
    }
    await expectPgError(sql`update users set whatsapp_opt_in_source = 'sms' where id = ${userId}`, CHECK_VIOLATION);
    await expectPgError(sql`update users set whatsapp_opt_in_source = 'admin' where id = ${userId}`, CHECK_VIOLATION); // admin cannot opt someone in
    await expectPgError(sql`update users set whatsapp_opt_in_at = null where id = ${userId}`, CHECK_VIOLATION); // opted in without a when
    await expectPgError(sql`update users set whatsapp_opt_in_source = null where id = ${userId}`, CHECK_VIOLATION); // nor a where
    await expectPgError(sql`update users set whatsapp_opt_in_notice_version = null where id = ${userId}`, CHECK_VIOLATION); // nor which notice
    // An admin revoke is fine: opt_in false, source 'admin' = the last change.
    await db.update(users).set({ whatsappOptIn: false, whatsappOptInAt: new Date(), whatsappOptInSource: 'admin' }).where(eq(users.id, userId));
    await expectPgError(sql`update users set whatsapp_opt_in = true where id = ${userId}`, CHECK_VIOLATION);
    await db.update(users).set({ whatsappOptIn: false, whatsappOptInAt: null, whatsappOptInSource: null, whatsappOptInNoticeVersion: null }).where(eq(users.id, userId));
  });

  it('notification_prefs is only the per (channel × event) on/off toggle', async () => {
    for (const gone of ['quiet_start', 'quiet_end', 'observe_shabbat', 'daily_cap']) expect(await col('notification_prefs', gone), gone).toBeUndefined();
    const [p] = await db
      .insert(notificationPrefs)
      .values({ restaurantId: A.restaurantId, userId, channel: 'whatsapp', eventKind: 'approval_waiting' })
      .returning();
    expect(p).toMatchObject({ enabled: true });
    await expectPgError(sql`update notification_prefs set channel = 'sms' where id = ${p!.id}`, CHECK_VIOLATION);
    await expectPgError(sql`update notification_prefs set event_kind = ' ' where id = ${p!.id}`, CHECK_VIOLATION);
    await expectPgError(
      db.insert(notificationPrefs).values({ restaurantId: A.restaurantId, userId, channel: 'whatsapp', eventKind: 'approval_waiting' }),
      UNIQUE_VIOLATION,
    );
    await db.insert(notificationPrefs).values({ restaurantId: B.restaurantId, userId, channel: 'whatsapp', eventKind: 'approval_waiting' });
    await sql`update notification_prefs set updated_at = '2000-01-01' where id = ${p!.id}`;
    await sql`update notification_prefs set enabled = false where id = ${p!.id}`;
    const [{ updated_at }] = (await sql`select updated_at from notification_prefs where id = ${p!.id}`) as unknown as [{ updated_at: Date }];
    expect(updated_at.getUTCFullYear()).toBeGreaterThan(2000);
    await db.delete(notificationPrefs).where(eq(notificationPrefs.userId, userId));
  });

  it('notification_settings: ONE row per (restaurant, user) with the owner defaults: quiet 23:00–06:00, Shabbat + holidays, cap 6 (1..50)', async () => {
    const [st] = await db.insert(notificationSettings).values({ restaurantId: A.restaurantId, userId }).returning();
    expect(st).toMatchObject({ quietStart: '23:00:00', quietEnd: '06:00:00', observeShabbat: true, observeHolidays: true, dailyCap: 6 });
    expect(await col('notification_settings', 'daily_cap')).toMatchObject({ data_type: 'smallint', is_nullable: 'NO' });
    expect(await col('notification_settings', 'quiet_start')).toMatchObject({ data_type: 'time without time zone', is_nullable: 'NO' });
    await db.update(notificationSettings).set({ dailyCap: 1 }).where(eq(notificationSettings.id, st!.id));
    await db.update(notificationSettings).set({ dailyCap: 50 }).where(eq(notificationSettings.id, st!.id));
    await expectPgError(sql`update notification_settings set daily_cap = 0 where id = ${st!.id}`, CHECK_VIOLATION);
    await expectPgError(sql`update notification_settings set daily_cap = 51 where id = ${st!.id}`, CHECK_VIOLATION);
    await expectPgError(db.insert(notificationSettings).values({ restaurantId: A.restaurantId, userId }), UNIQUE_VIOLATION);
    await db.insert(notificationSettings).values({ restaurantId: B.restaurantId, userId }); // the same person in another restaurant
    await sql`update notification_settings set updated_at = '2000-01-01' where id = ${st!.id}`;
    await sql`update notification_settings set observe_holidays = false where id = ${st!.id}`;
    const [{ updated_at }] = (await sql`select updated_at from notification_settings where id = ${st!.id}`) as unknown as [{ updated_at: Date }];
    expect(updated_at.getUTCFullYear()).toBeGreaterThan(2000);
    await db.delete(notificationSettings).where(eq(notificationSettings.userId, userId));
  });
});
