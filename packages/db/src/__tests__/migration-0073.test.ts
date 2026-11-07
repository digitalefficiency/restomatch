import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDb,
  eq,
  inventoryCountLines,
  inventoryCounts,
  notificationSeen,
  poLines,
  productCountUnits,
  products,
  purchaseOrders,
  recipes,
  restaurants,
  savedViews,
  suppliers,
  users,
  viewSubscriptions,
  wasteEntries,
} from '../index';
import { migrationsDir } from '../migrations';
import { testDbUrl } from '../test-env';

/**
 * Migration-shape test for 0073_schema_batch_b (wave 3, H-04): every new column and
 * table exists with its type, default and CHECK; the five new tenant tables carry
 * restaurant_id NOT NULL + RLS + the `<table>_tenant` policy; the composite
 * same-tenant FKs refuse a cross-tenant reference; deletes cascade / block as
 * documented; the count status widens to 'submitted' with one OPEN count per
 * restaurant; the po_lines revised pair holds; the file is pipeline-safe.
 */
const url = testDbUrl();
const sql = postgres(url, { max: 1, prepare: false });
const db = createDb(url);
const FILE = '0073_schema_batch_b.sql';

interface T {
  restaurantId: string;
  supplierId: string;
  productId: string;
  recipeId: string;
  poId: string;
}
let A: T;
let B: T;
let userId: string;

async function seed(tag: string, businessId: string): Promise<T> {
  const [r] = await db.insert(restaurants).values({ name: `0073 ${tag}`, businessId }).returning();
  const restaurantId = r!.id;
  const [s] = await db.insert(suppliers).values({ restaurantId, name: `0073 supplier ${tag}` }).returning();
  const [p] = await db.insert(products).values({ restaurantId, canonicalName: `0073 product ${tag}` }).returning();
  const [rc] = await db.insert(recipes).values({ restaurantId, name: `0073 recipe ${tag}` }).returning();
  const [po] = await db.insert(purchaseOrders).values({ restaurantId, supplierId: s!.id }).returning();
  return { restaurantId, supplierId: s!.id, productId: p!.id, recipeId: rc!.id, poId: po!.id };
}

async function cleanup(t: T) {
  await db.delete(restaurants).where(eq(restaurants.id, t.restaurantId));
}

beforeAll(async () => {
  A = await seed('A', '000000731');
  B = await seed('B', '000000732');
  const [u] = await db.insert(users).values({ email: `h04-${Date.now()}@0073.test` }).returning();
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

const TABLES = ['notification_seen', 'product_count_units', 'saved_views', 'view_subscriptions', 'waste_entries'];
const statements = () =>
  readFileSync(join(migrationsDir(), FILE), 'utf8')
    .split('--> statement-breakpoint')
    .map((x) => x.trim())
    .filter(Boolean);

describe('0073 is registered', () => {
  it('is in the journal right after 0072, idx 73, with a later `when`', () => {
    const j = JSON.parse(readFileSync(join(migrationsDir(), 'meta', '_journal.json'), 'utf8')) as {
      entries: Array<{ idx: number; tag: string; when: number }>;
    };
    const i = j.entries.findIndex((e) => e.tag === '0073_schema_batch_b');
    expect(i).toBeGreaterThan(0);
    expect(j.entries[i]!.idx).toBe(73);
    expect(j.entries[i - 1]!.tag).toBe('0072_schema_batch_a');
    expect(j.entries[i]!.when).toBeGreaterThan(1782500000000);
  });

  it('is idempotent: re-running every statement on the migrated DB changes nothing and raises nothing', async () => {
    const stmts = statements();
    const shape = async (q: typeof sql) =>
      (await q`
        select (select count(*) from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname = 'public')::int as cons,
               (select count(*) from pg_indexes where schemaname = 'public')::int as idx,
               (select count(*) from pg_trigger where not tgisinternal)::int as trg,
               (select count(*) from pg_policy)::int as pol,
               (select count(*) from information_schema.columns where table_schema = 'public')::int as cols`) as unknown as [
        { cons: number; idx: number; trg: number; pol: number; cols: number },
      ];
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

  it('takes lock_timeout + every lock up front, parent-first: a long reader makes it fail fast, nothing applied, a re-run succeeds', async () => {
    const stmts = statements();
    const code = (x: string) => x.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n').trim();
    expect(code(stmts[0]!)).toMatch(/set_config\('lock_timeout', '5s', true\)[\s\S]*set_config\('statement_timeout', '6s', true\)/);
    const lockPhase = code(stmts[1]!);
    expect(lockPhase).toMatch(/^DO \$\$\s*BEGIN\s*LOOP\s*BEGIN\s*LOCK TABLE "restaurants" IN SHARE ROW EXCLUSIVE MODE NOWAIT;/);
    expect(lockPhase).toMatch(/EXCEPTION WHEN lock_not_available THEN\s*PERFORM pg_sleep\(0\.05\);/);
    // Every LOCK is NOWAIT (nothing is held while waiting); parent-first, users last (0071/0072 order).
    const locks = lockPhase.match(/LOCK TABLE [^;]+;/g) ?? [];
    expect(locks).toHaveLength(4);
    for (const l of locks) expect(l).toMatch(/NOWAIT;$/);
    const order = ['"restaurants"', '"suppliers"', '"products"', '"purchase_orders"', '"po_lines"', '"recipes"', '"inventory_counts"', '"inventory_count_lines"', '"users"'];
    const pos = order.map((t) => lockPhase.indexOf(t));
    expect(pos.every((p) => p >= 0)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
    expect(code(stmts[2]!)).toMatch(/set_config\('statement_timeout',[\s\S]*current_setting\('restomatch.prev_statement_timeout', true\)/);
    // No other LOCK anywhere after the prelude: nothing waits or upgrades mid-file.
    expect(stmts.slice(2).some((s) => /\bLOCK TABLE\b/i.test(code(s)))).toBe(false);
    const reader = postgres(url, { max: 1, prepare: false });
    const runner = postgres(url, { max: 1, prepare: false });
    try {
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      let readerReady!: () => void;
      const ready = new Promise<void>((r) => (readerReady = r));
      const readerTx = reader.begin(async (tx) => {
        await tx`select count(*) from recipes`; // ACCESS SHARE, held until commit
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
    const file = readFileSync(join(migrationsDir(), FILE), 'utf8');
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
    const bare = postgres(url, { max: 1, prepare: false });
    try {
      for (const st of statements()) await bare.unsafe(st);
      await expect(bare.unsafe('LOCK TABLE "users" IN ACCESS EXCLUSIVE MODE')).rejects.toMatchObject({ code: '25P01' });
    } finally {
      await bare.end();
    }
  });

  it('has no ALTER TYPE, no 0071 enum value, no backfill (no UPDATE / INSERT / DELETE of rows) and no outbox CHECK', () => {
    const file = readFileSync(join(migrationsDir(), FILE), 'utf8')
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n');
    expect(file).not.toMatch(/ALTER TYPE/i);
    expect(file).not.toMatch(/'event'|'skipped'/);
    expect(file).not.toMatch(/^\s*(UPDATE|INSERT INTO|DELETE FROM)\b/im);
    expect(file).not.toMatch(/notifications_outbox/);
  });
});

describe('0073 the five new tenant tables', () => {
  it('carry a NOT NULL restaurant_id', async () => {
    for (const t of TABLES) expect((await col(t, 'restaurant_id'))?.is_nullable, t).toBe('NO');
  });

  it('enable row security with exactly the per-restaurant `<table>_tenant` policy', async () => {
    const rows = (await sql`
      select c.relname, c.relrowsecurity, p.polname, pg_get_expr(p.polqual, p.polrelid) as qual
      from pg_class c left join pg_policy p on p.polrelid = c.oid
      where c.relname in ${sql(TABLES)} order by c.relname
    `) as unknown as Array<{ relname: string; relrowsecurity: boolean; polname: string; qual: string }>;
    expect(rows.map((r) => [r.relname, r.relrowsecurity, r.polname])).toEqual(TABLES.map((t) => [t, true, `${t}_tenant`]));
    for (const r of rows) expect(r.qual).toContain('app.current_restaurant_id()');
  });

  it('are in the rls/0002 table list', () => {
    const rls = readFileSync(join(migrationsDir(), 'rls', '0002_core_tenant_rls.sql'), 'utf8');
    for (const t of TABLES) expect(rls).toContain(`'${t}'`);
  });

  it('have UNIQUE (id, restaurant_id) for same-tenant composite FKs', async () => {
    for (const t of TABLES) expect(await checkDef(`${t}_id_restaurant_id_key`), t).toBe('UNIQUE (id, restaurant_id)');
  });

  it('cascade away with their restaurant (NO ACTION FKs are checked at statement end)', async () => {
    const t = await seed('cascade', '000000733');
    const [v] = await db.insert(savedViews).values({ restaurantId: t.restaurantId, page: 'invoices', name: 'מוכן לתשלום', scope: 'restaurant', roleDefault: 'bookkeeper' }).returning();
    await db.insert(viewSubscriptions).values({ restaurantId: t.restaurantId, viewId: v!.id, userId, cadence: 'weekly', weekday: 0 });
    await db.insert(productCountUnits).values({ restaurantId: t.restaurantId, productId: t.productId, unit: 'ארגז', baseQty: '12' });
    await db.insert(wasteEntries).values({ restaurantId: t.restaurantId, productId: t.productId, qty: '2', unit: 'ק״ג', reason: 'spoiled' });
    await db.insert(wasteEntries).values({ restaurantId: t.restaurantId, recipeId: t.recipeId, qty: '1', unit: 'מנה', reason: 'returned' });
    await db.insert(notificationSeen).values({ restaurantId: t.restaurantId, userId, itemKey: 'invoice:x:decide' });
    await db.delete(restaurants).where(eq(restaurants.id, t.restaurantId));
    for (const tbl of TABLES) {
      const [{ n }] = (await sql`select count(*)::int as n from ${sql(tbl)} where restaurant_id = ${t.restaurantId}`) as unknown as [{ n: number }];
      expect(n, tbl).toBe(0);
    }
  });
});

describe('0073 saved_views + view_subscriptions', () => {
  it('has the documented columns and defaults', async () => {
    expect(await col('saved_views', 'query')).toMatchObject({ data_type: 'jsonb', is_nullable: 'NO' });
    expect((await col('saved_views', 'scope'))?.column_default).toContain("'personal'");
    expect(await col('saved_views', 'user_id')).toMatchObject({ udt_name: 'uuid', is_nullable: 'YES' });
    expect((await col('view_subscriptions', 'send_hour'))?.column_default).toBe('7');
    expect((await col('view_subscriptions', 'channel'))?.column_default).toContain("'email'");
    expect(await indexDef('saved_views_role_default_unique')).toMatch(/UNIQUE INDEX[\s\S]*\(restaurant_id, page, role_default\) WHERE \(role_default IS NOT NULL\)/);
  });

  it('a personal view has a member and no role default; a team view has no member; one default per page × role', async () => {
    const r = A.restaurantId;
    const [mine] = await db.insert(savedViews).values({ restaurantId: r, page: 'invoices', name: 'שלי', userId }).returning();
    expect(mine!.scope).toBe('personal');
    await expectPgError(db.insert(savedViews).values({ restaurantId: r, page: 'invoices', name: 'x', scope: 'personal' }), CHECK_VIOLATION);
    await expectPgError(db.insert(savedViews).values({ restaurantId: r, page: 'invoices', name: 'x', scope: 'restaurant', userId }), CHECK_VIOLATION);
    await expectPgError(db.insert(savedViews).values({ restaurantId: r, page: 'invoices', name: 'x', userId, roleDefault: 'bookkeeper' }), CHECK_VIOLATION);
    await expectPgError(db.insert(savedViews).values({ restaurantId: r, page: 'invoices', name: 'x', scope: 'restaurant', roleDefault: 'admin' as never }), CHECK_VIOLATION);
    await expectPgError(db.insert(savedViews).values({ restaurantId: r, page: ' ', name: 'x', userId }), CHECK_VIOLATION);
    await expectPgError(db.insert(savedViews).values({ restaurantId: r, page: 'invoices', name: 'x', userId, query: [] as never }), CHECK_VIOLATION);
    await db.insert(savedViews).values({ restaurantId: r, page: 'invoices', name: 'מוכן לתשלום', scope: 'restaurant', roleDefault: 'bookkeeper' });
    await expectPgError(
      db.insert(savedViews).values({ restaurantId: r, page: 'invoices', name: 'אחר', scope: 'restaurant', roleDefault: 'bookkeeper' }),
      UNIQUE_VIOLATION,
    );
    // Another restaurant may have its own default for the same page × role.
    await db.insert(savedViews).values({ restaurantId: B.restaurantId, page: 'invoices', name: 'מוכן לתשלום', scope: 'restaurant', roleDefault: 'bookkeeper' });
    // A personal view goes with its member.
    const [u2] = await db.insert(users).values({ email: `h04-gone-${Date.now()}@0073.test` }).returning();
    const [gone] = await db.insert(savedViews).values({ restaurantId: r, page: 'invoices', name: 'זמני', userId: u2!.id }).returning();
    await db.delete(users).where(eq(users.id, u2!.id));
    expect(await db.select().from(savedViews).where(eq(savedViews.id, gone!.id))).toHaveLength(0);
    await db.delete(savedViews).where(eq(savedViews.restaurantId, r));
    await db.delete(savedViews).where(eq(savedViews.restaurantId, B.restaurantId));
  });

  it('a subscription CHECKs cadence / hour / weekday / month day / channel, is unique per view × member × channel, refuses another tenant’s view, goes with its view', async () => {
    const [v] = await db.insert(savedViews).values({ restaurantId: A.restaurantId, page: 'leaks', name: 'חוסמים', scope: 'restaurant' }).returning();
    const [vb] = await db.insert(savedViews).values({ restaurantId: B.restaurantId, page: 'leaks', name: 'B', scope: 'restaurant' }).returning();
    const base = { restaurantId: A.restaurantId, viewId: v!.id, userId };
    const [weekly] = await db.insert(viewSubscriptions).values({ ...base, cadence: 'weekly', weekday: 0 }).returning();
    expect(weekly).toMatchObject({ sendHour: 7, channel: 'email', active: true, lastSentAt: null });
    await expectPgError(db.insert(viewSubscriptions).values({ ...base, cadence: 'weekly', weekday: 0 }), UNIQUE_VIOLATION);
    await expectPgError(db.insert(viewSubscriptions).values({ ...base, cadence: 'hourly' as never, channel: 'push' }), CHECK_VIOLATION);
    await expectPgError(db.insert(viewSubscriptions).values({ ...base, cadence: 'daily', sendHour: 24, channel: 'push' }), CHECK_VIOLATION);
    await expectPgError(db.insert(viewSubscriptions).values({ ...base, cadence: 'weekly', channel: 'push' }), CHECK_VIOLATION);
    await expectPgError(db.insert(viewSubscriptions).values({ ...base, cadence: 'weekly', weekday: 7, channel: 'push' }), CHECK_VIOLATION);
    await expectPgError(db.insert(viewSubscriptions).values({ ...base, cadence: 'daily', weekday: 1, channel: 'push' }), CHECK_VIOLATION);
    await expectPgError(db.insert(viewSubscriptions).values({ ...base, cadence: 'monthly', channel: 'push' }), CHECK_VIOLATION);
    await expectPgError(db.insert(viewSubscriptions).values({ ...base, cadence: 'monthly', monthDay: 29, channel: 'push' }), CHECK_VIOLATION);
    await expectPgError(db.insert(viewSubscriptions).values({ ...base, cadence: 'daily', channel: 'sms' as never }), CHECK_VIOLATION);
    await db.insert(viewSubscriptions).values({ ...base, cadence: 'monthly', monthDay: 1, channel: 'whatsapp' });
    await expectPgError(db.insert(viewSubscriptions).values({ ...base, viewId: vb!.id, cadence: 'daily', channel: 'push' }), FK_VIOLATION);
    await db.delete(savedViews).where(eq(savedViews.id, v!.id));
    expect(await db.select().from(viewSubscriptions).where(eq(viewSubscriptions.viewId, v!.id))).toHaveLength(0);
    await db.delete(savedViews).where(eq(savedViews.id, vb!.id));
  });
});

describe('0073 counting: walk order, count units, multi-unit entry, submitted', () => {
  it('products.count_sort is a nullable int; count lines gain qty_parts (a jsonb array or NULL)', async () => {
    expect(await col('products', 'count_sort')).toMatchObject({ data_type: 'integer', is_nullable: 'YES', column_default: null });
    expect(await col('inventory_count_lines', 'qty_parts')).toMatchObject({ data_type: 'jsonb', is_nullable: 'YES' });
    const [c] = await db.insert(inventoryCounts).values({ restaurantId: A.restaurantId, countDate: '2026-12-20' }).returning();
    const parts = [
      { unit: 'ארגז', qty: 2 },
      { unit: 'יח׳', qty: 5 },
    ];
    const [l] = await db
      .insert(inventoryCountLines)
      .values({ restaurantId: A.restaurantId, countId: c!.id, productId: A.productId, unit: 'יח׳', qty: '29', qtyParts: parts })
      .returning();
    expect(l!.qtyParts).toEqual(parts);
    await expectPgError(sql`update inventory_count_lines set qty_parts = '{"unit":"x"}'::jsonb where id = ${l!.id}`, CHECK_VIOLATION);
    await db.delete(inventoryCounts).where(eq(inventoryCounts.id, c!.id));
  });

  it('a count unit is unique per product, base_qty > 0, refuses another tenant’s product, goes with its product', async () => {
    await db.insert(productCountUnits).values({ restaurantId: A.restaurantId, productId: A.productId, unit: 'ארגז', baseQty: '12' });
    await expectPgError(db.insert(productCountUnits).values({ restaurantId: A.restaurantId, productId: A.productId, unit: 'ארגז', baseQty: '6' }), UNIQUE_VIOLATION);
    await expectPgError(db.insert(productCountUnits).values({ restaurantId: A.restaurantId, productId: A.productId, unit: 'שק', baseQty: '0' }), CHECK_VIOLATION);
    await expectPgError(db.insert(productCountUnits).values({ restaurantId: A.restaurantId, productId: A.productId, unit: ' ', baseQty: '1' }), CHECK_VIOLATION);
    await expectPgError(db.insert(productCountUnits).values({ restaurantId: A.restaurantId, productId: B.productId, unit: 'ארגז', baseQty: '12' }), FK_VIOLATION);
    const [p] = await db.insert(products).values({ restaurantId: A.restaurantId, canonicalName: '0073 temp product' }).returning();
    await db.insert(productCountUnits).values({ restaurantId: A.restaurantId, productId: p!.id, unit: 'ארגז', baseQty: '12' });
    await db.delete(products).where(eq(products.id, p!.id));
    expect(await db.select().from(productCountUnits).where(eq(productCountUnits.productId, p!.id))).toHaveLength(0);
    await db.delete(productCountUnits).where(eq(productCountUnits.restaurantId, A.restaurantId));
  });

  it('status accepts draft | submitted | completed; submitted needs submitted_at; one OPEN count per restaurant; 0070 completion CHECK unchanged', async () => {
    expect(await checkDef('inventory_counts_status_check')).toMatch(/'draft'.*'submitted'.*'completed'/);
    expect(await indexDef('inventory_counts_one_open_idx')).toMatch(/UNIQUE INDEX[\s\S]*\(restaurant_id\) WHERE[\s\S]*'draft'[\s\S]*'submitted'/);
    expect(await indexDef('inventory_counts_one_draft_idx')).toBeDefined();
    const r = A.restaurantId;
    const [c] = await db.insert(inventoryCounts).values({ restaurantId: r, countDate: '2026-12-21' }).returning();
    await expectPgError(db.update(inventoryCounts).set({ status: 'submitted' }).where(eq(inventoryCounts.id, c!.id)), CHECK_VIOLATION);
    await db.update(inventoryCounts).set({ status: 'submitted', submittedAt: new Date(), submittedBy: userId }).where(eq(inventoryCounts.id, c!.id));
    // A submitted count still blocks a second draft.
    await expectPgError(db.insert(inventoryCounts).values({ restaurantId: r, countDate: '2026-12-22' }), UNIQUE_VIOLATION);
    await expectPgError(db.update(inventoryCounts).set({ status: 'closed' }).where(eq(inventoryCounts.id, c!.id)), CHECK_VIOLATION);
    // Completing still needs completed_at + the total (0070); submitted_at stays as evidence.
    await expectPgError(db.update(inventoryCounts).set({ status: 'completed' }).where(eq(inventoryCounts.id, c!.id)), CHECK_VIOLATION);
    await db.update(inventoryCounts).set({ status: 'completed', completedAt: new Date(), totalValueAgorot: 0 }).where(eq(inventoryCounts.id, c!.id));
    await db.insert(inventoryCounts).values({ restaurantId: r, countDate: '2026-12-22' });
    await db.delete(inventoryCounts).where(eq(inventoryCounts.restaurantId, r));
  });
});

describe('0073 waste_entries', () => {
  it('has the documented money columns (shekels unit_cost numeric(12,4), agorot bigint value)', async () => {
    expect(await col('waste_entries', 'unit_cost')).toMatchObject({ data_type: 'numeric', is_nullable: 'YES' });
    expect(await col('waste_entries', 'value_agorot')).toMatchObject({ data_type: 'bigint', is_nullable: 'YES' });
    expect(await col('waste_entries', 'occurred_at')).toMatchObject({ data_type: 'timestamp with time zone', is_nullable: 'NO' });
  });

  it('is about exactly one product or recipe, qty > 0, a known reason; refuses another tenant’s subject; blocks deleting its subject', async () => {
    const r = A.restaurantId;
    await expectPgError(db.insert(wasteEntries).values({ restaurantId: r, qty: '1', unit: 'ק״ג', reason: 'spoiled' }), CHECK_VIOLATION);
    await expectPgError(
      db.insert(wasteEntries).values({ restaurantId: r, productId: A.productId, recipeId: A.recipeId, qty: '1', unit: 'ק״ג', reason: 'spoiled' }),
      CHECK_VIOLATION,
    );
    await expectPgError(db.insert(wasteEntries).values({ restaurantId: r, productId: A.productId, qty: '0', unit: 'ק״ג', reason: 'spoiled' }), CHECK_VIOLATION);
    await expectPgError(db.insert(wasteEntries).values({ restaurantId: r, productId: A.productId, qty: '1', unit: 'ק״ג', reason: 'stolen' as never }), CHECK_VIOLATION);
    await expectPgError(
      db.insert(wasteEntries).values({ restaurantId: r, productId: A.productId, qty: '1', unit: 'ק״ג', reason: 'spoiled', valueAgorot: -1 }),
      CHECK_VIOLATION,
    );
    await expectPgError(db.insert(wasteEntries).values({ restaurantId: r, productId: B.productId, qty: '1', unit: 'ק״ג', reason: 'spoiled' }), FK_VIOLATION);
    await expectPgError(db.insert(wasteEntries).values({ restaurantId: r, recipeId: B.recipeId, qty: '1', unit: 'מנה', reason: 'returned' }), FK_VIOLATION);
    const [w] = await db
      .insert(wasteEntries)
      .values({ restaurantId: r, productId: A.productId, qty: '1.5', unit: 'ק״ג', reason: 'expired', unitCost: '42.5000', valueAgorot: 6375, recordedBy: userId })
      .returning();
    expect(w).toMatchObject({ qty: '1.5000', unitCost: '42.5000', valueAgorot: 6375 });
    await db.insert(wasteEntries).values({ restaurantId: r, recipeId: A.recipeId, qty: '1', unit: 'מנה', reason: 'returned' });
    await expectPgError(db.delete(products).where(eq(products.id, A.productId)), FK_VIOLATION);
    await expectPgError(db.delete(recipes).where(eq(recipes.id, A.recipeId)), FK_VIOLATION);
    const before = w!.updatedAt;
    const [w2] = await db.update(wasteEntries).set({ note: 'נפל מהמדף' }).where(eq(wasteEntries.id, w!.id)).returning();
    expect(w2!.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    await db.delete(wasteEntries).where(eq(wasteEntries.restaurantId, r));
  });
});

describe('0073 recipes kitchen card', () => {
  it('method / plating text, photo_key a key (not a URL), allergens text[] default {} from the 14 keys', async () => {
    expect(await col('recipes', 'method')).toMatchObject({ data_type: 'text', is_nullable: 'YES' });
    expect(await col('recipes', 'plating')).toMatchObject({ data_type: 'text', is_nullable: 'YES' });
    expect(await col('recipes', 'allergens')).toMatchObject({ data_type: 'ARRAY', udt_name: '_text', is_nullable: 'NO' });
    const [r] = await db.select().from(recipes).where(eq(recipes.id, A.recipeId));
    expect(r!.allergens).toEqual([]);
    const [u] = await db
      .update(recipes)
      .set({ method: 'לערבב', plating: 'צלחת לבנה', photoKey: `${A.restaurantId}/recipes/1.jpg`, allergens: ['gluten', 'sesame'] })
      .where(eq(recipes.id, A.recipeId))
      .returning();
    expect(u!.allergens).toEqual(['gluten', 'sesame']);
    await expectPgError(db.update(recipes).set({ allergens: ['gluten', 'msg'] as never }).where(eq(recipes.id, A.recipeId)), CHECK_VIOLATION);
    await expectPgError(db.update(recipes).set({ photoKey: 'https://evil.test/x.jpg' }).where(eq(recipes.id, A.recipeId)), CHECK_VIOLATION);
    await expectPgError(db.update(recipes).set({ photoKey: ' ' }).where(eq(recipes.id, A.recipeId)), CHECK_VIOLATION);
  });
});

describe('0073 suppliers.billing_mode / purchase_orders.opened_at / po_lines revised', () => {
  it('billing_mode is a nullable CHECKed varchar, not backfilled', async () => {
    expect(await col('suppliers', 'billing_mode')).toMatchObject({ data_type: 'character varying', is_nullable: 'YES', column_default: null });
    const [s] = await db.select().from(suppliers).where(eq(suppliers.id, A.supplierId));
    expect(s!.billingMode).toBeNull();
    await db.update(suppliers).set({ billingMode: 'consolidated' }).where(eq(suppliers.id, A.supplierId));
    await expectPgError(db.update(suppliers).set({ billingMode: 'monthly' as never }).where(eq(suppliers.id, A.supplierId)), CHECK_VIOLATION);
  });

  it('opened_at is a nullable timestamptz', async () => {
    expect(await col('purchase_orders', 'opened_at')).toMatchObject({ data_type: 'timestamp with time zone', is_nullable: 'YES', column_default: null });
  });

  it('revised columns: nullable, >= 0, revised_at exactly with a revised value and a source; the original stays', async () => {
    expect(await col('po_lines', 'qty_revised')).toMatchObject({ data_type: 'numeric', is_nullable: 'YES' });
    expect(await col('po_lines', 'unit_price_revised')).toMatchObject({ data_type: 'numeric', is_nullable: 'YES' });
    const [l] = await db.insert(poLines).values({ poId: A.poId, qtyOrdered: '10', unit: 'ק״ג', unitPriceExpected: '20.0000' }).returning();
    expect(l).toMatchObject({ qtyRevised: null, unitPriceRevised: null, revisedAt: null, revisionSource: null });
    const at = new Date();
    await expectPgError(db.update(poLines).set({ qtyRevised: '8' }).where(eq(poLines.id, l!.id)), CHECK_VIOLATION);
    await expectPgError(db.update(poLines).set({ qtyRevised: '8', revisedAt: at }).where(eq(poLines.id, l!.id)), CHECK_VIOLATION);
    await expectPgError(db.update(poLines).set({ revisedAt: at, revisionSource: 'manual' }).where(eq(poLines.id, l!.id)), CHECK_VIOLATION);
    await expectPgError(db.update(poLines).set({ qtyRevised: '-1', revisedAt: at, revisionSource: 'manual' }).where(eq(poLines.id, l!.id)), CHECK_VIOLATION);
    await expectPgError(db.update(poLines).set({ qtyRevised: '8', revisedAt: at, revisionSource: 'phone' as never }).where(eq(poLines.id, l!.id)), CHECK_VIOLATION);
    const [r] = await db
      .update(poLines)
      .set({ qtyRevised: '0', unitPriceRevised: '21.5000', revisedAt: at, revisedBy: userId, revisionSource: 'supplier_confirm' })
      .where(eq(poLines.id, l!.id))
      .returning();
    expect(r).toMatchObject({ qtyOrdered: '10.000', unitPriceExpected: '20.0000', qtyRevised: '0.000', unitPriceRevised: '21.5000' });
    await db.delete(poLines).where(eq(poLines.id, l!.id));
  });
});

describe('0073 notification_seen', () => {
  it('one row per restaurant × member × item key; non-empty key; goes with the member', async () => {
    const [u2] = await db.insert(users).values({ email: `h04-seen-${Date.now()}@0073.test` }).returning();
    const [s] = await db.insert(notificationSeen).values({ restaurantId: A.restaurantId, userId: u2!.id, itemKey: 'invoice:1:decide' }).returning();
    expect(s!.dismissedAt).toBeNull();
    expect(s!.seenAt).toBeInstanceOf(Date);
    await expectPgError(db.insert(notificationSeen).values({ restaurantId: A.restaurantId, userId: u2!.id, itemKey: 'invoice:1:decide' }), UNIQUE_VIOLATION);
    await expectPgError(db.insert(notificationSeen).values({ restaurantId: A.restaurantId, userId: u2!.id, itemKey: ' ' }), CHECK_VIOLATION);
    await db.insert(notificationSeen).values({ restaurantId: B.restaurantId, userId: u2!.id, itemKey: 'invoice:1:decide' });
    await db.delete(users).where(eq(users.id, u2!.id));
    expect(await db.select().from(notificationSeen).where(eq(notificationSeen.userId, u2!.id))).toHaveLength(0);
  });
});

describe('H-04 part 2: the PENDING outbox role-target CHECK (deploys 19.1, after H-05)', () => {
  const PENDING = join(migrationsDir(), 'pending', 'outbox_no_role_target.sql');

  it('is NOT in the journal and NOT in supabase/migrations (so neither drizzle nor the integration applies it before H-05)', () => {
    const j = readFileSync(join(migrationsDir(), 'meta', '_journal.json'), 'utf8');
    expect(j).not.toMatch(/outbox_no_role_target/);
    const supa = join(migrationsDir(), '..', '..', '..', 'supabase', 'migrations');
    const files = readdirSync(supa);
    expect(files.filter((f) => /outbox_no_role_target/.test(f))).toEqual([]);
    expect(readFileSync(join(migrationsDir(), FILE), 'utf8')).not.toMatch(/no_role_target/);
  });

  it('is pipeline-safe, and (applied in a rolled-back transaction) refuses a new role: row but keeps old ones (NOT VALID)', async () => {
    const stmts = readFileSync(PENDING, 'utf8').split('--> statement-breakpoint').map((x) => x.trim()).filter(Boolean);
    const top = readFileSync(PENDING, 'utf8')
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n')
      .replace(/\$\$[\s\S]*?\$\$/g, '$$$$');
    expect(top).not.toMatch(/^\s*LOCK\s+TABLE/im);
    expect(top).not.toMatch(/\bSET\s+LOCAL\b/i);
    const ROLLBACK = new Error('rollback');
    await expect(
      sql.begin(async (tx) => {
        await tx`insert into notifications_outbox (restaurant_id, channel, target, body) values (${A.restaurantId}, 'email', 'role:owner', 'old')`;
        for (const st of stmts) await tx.unsafe(st);
        for (const st of stmts) await tx.unsafe(st); // idempotent
        const [{ v }] = (await tx`select convalidated as v from pg_constraint where conname = 'notifications_outbox_no_role_target_check'`) as unknown as [
          { v: boolean },
        ];
        expect(v).toBe(false);
        await tx`insert into notifications_outbox (restaurant_id, channel, target, body) values (${A.restaurantId}, 'email', 'owner@a.test', 'ok')`;
        await tx`savepoint s`;
        await expect(
          tx`insert into notifications_outbox (restaurant_id, channel, target, body) values (${A.restaurantId}, 'push', 'role:manager', 'new')`,
        ).rejects.toMatchObject({ code: CHECK_VIOLATION });
        await tx`rollback to savepoint s`;
        throw ROLLBACK;
      }),
    ).rejects.toBe(ROLLBACK);
    expect(await checkDef('notifications_outbox_no_role_target_check')).toBeUndefined();
  });
});
