import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  claimLetters,
  createDb,
  discrepancies,
  eq,
  goodsReceipts,
  grLines,
  idempotencyKeys,
  invoices,
  matchRuns,
  paymentDeductions,
  productAliases,
  products,
  purchaseOrders,
  recoveryClaims,
  restaurants,
  suppliers,
  users,
} from '../index';
import { migrationsDir } from '../migrations';
import { testDbUrl } from '../test-env';

/**
 * Migration-shape test for 0071_schema_batch_0 (wave 2, G-03): every new column
 * and table exists with its type, default and CHECK; the three new tenant tables
 * carry restaurant_id NOT NULL + RLS + the `<table>_tenant` policy; the composite
 * same-tenant FKs refuse a cross-tenant reference; deletes cascade / null / block
 * as documented; the enum values exist; the legacy count backfill stamps exactly
 * the lines of closed receipts and is idempotent.
 */
const url = testDbUrl();
const sql = postgres(url, { max: 1, prepare: false });
const db = createDb(url);

interface T {
  restaurantId: string;
  supplierId: string;
  invoiceId: string;
  discrepancyId: string;
  claimId: string;
}
let A: T;
let B: T;
let userId: string;

async function seed(tag: string, businessId: string): Promise<T> {
  const [r] = await db.insert(restaurants).values({ name: `0071 ${tag}`, businessId }).returning();
  const restaurantId = r!.id;
  const [s] = await db.insert(suppliers).values({ restaurantId, name: `0071 supplier ${tag}` }).returning();
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
  return { restaurantId, supplierId: s!.id, invoiceId: inv!.id, discrepancyId: d!.id, claimId: c!.id };
}

async function cleanup(t: T) {
  await db.delete(paymentDeductions).where(eq(paymentDeductions.restaurantId, t.restaurantId));
  await db.delete(recoveryClaims).where(eq(recoveryClaims.restaurantId, t.restaurantId));
  await db.delete(claimLetters).where(eq(claimLetters.restaurantId, t.restaurantId));
  await db.delete(restaurants).where(eq(restaurants.id, t.restaurantId));
}

beforeAll(async () => {
  A = await seed('A', '000000711');
  B = await seed('B', '000000712');
  const [u] = await db.insert(users).values({ email: `g03-${Date.now()}@0071.test` }).returning();
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

describe('0071 is registered', () => {
  it('is in the journal right after 0070', () => {
    const j = JSON.parse(readFileSync(join(migrationsDir(), 'meta', '_journal.json'), 'utf8')) as {
      entries: Array<{ idx: number; tag: string; when: number }>;
    };
    const i = j.entries.findIndex((e) => e.tag === '0071_schema_batch_0');
    expect(i).toBeGreaterThan(0);
    expect(j.entries[i - 1]!.tag).toBe('0070_inventory_counts');
    expect(j.entries[i]!.when).toBeGreaterThan(j.entries[i - 1]!.when);
  });
});

describe('0071 the three new tenant tables', () => {
  const TABLES = ['claim_letters', 'idempotency_keys', 'payment_deductions'];

  it('carry a NOT NULL restaurant_id', async () => {
    for (const t of TABLES) expect((await col(t, 'restaurant_id'))?.is_nullable).toBe('NO');
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
    for (const t of TABLES) expect(await checkDef(`${t}_id_restaurant_id_key`)).toBe('UNIQUE (id, restaurant_id)');
  });

  it('cascade away with their restaurant (NO ACTION FKs are checked at statement end)', async () => {
    const t = await seed('cascade', '000000713');
    await db.insert(claimLetters).values({ restaurantId: t.restaurantId, supplierId: t.supplierId, seqNo: 1 });
    await db.insert(paymentDeductions).values({ restaurantId: t.restaurantId, invoiceId: t.invoiceId, amountAgorot: 100 });
    await db.insert(idempotencyKeys).values({ restaurantId: t.restaurantId, key: 'k', procedure: 'p' });
    await db.delete(recoveryClaims).where(eq(recoveryClaims.restaurantId, t.restaurantId));
    await db.delete(restaurants).where(eq(restaurants.id, t.restaurantId));
    for (const tbl of TABLES) {
      const [{ n }] = (await sql`select count(*)::int as n from ${sql(tbl)} where restaurant_id = ${t.restaurantId}`) as unknown as [{ n: number }];
      expect(n).toBe(0);
    }
  });
});

describe('0071 gr_lines count truth', () => {
  it('adds counted_at / counted_by / count_method (nullable) and updated_at (NOT NULL, defaulted)', async () => {
    expect(await col('gr_lines', 'counted_at')).toMatchObject({ data_type: 'timestamp with time zone', is_nullable: 'YES', column_default: null });
    expect(await col('gr_lines', 'counted_by')).toMatchObject({ data_type: 'uuid', is_nullable: 'YES' });
    expect(await col('gr_lines', 'count_method')).toMatchObject({ data_type: 'character varying', is_nullable: 'YES', column_default: null });
    expect(await col('gr_lines', 'updated_at')).toMatchObject({ data_type: 'timestamp with time zone', is_nullable: 'NO', column_default: 'now()' });
    expect(await checkDef('gr_lines_count_method_check')).toMatch(/line.*bulk_as_ordered.*legacy/);
    expect(await checkDef('gr_lines_counted_by_users_id_fk')).toMatch(/REFERENCES users\(id\) ON DELETE SET NULL/);
  });

  it('refuses an unknown count_method, keeps updated_at by trigger, nulls counted_by when the user goes', async () => {
    const [gr] = await db.insert(goodsReceipts).values({ restaurantId: A.restaurantId }).returning();
    const [u] = await db.insert(users).values({ email: `g03-counter-${Date.now()}@0071.test` }).returning();
    const [line] = await db
      .insert(grLines)
      .values({ grId: gr!.id, qtyReceived: '1', countedAt: new Date(), countedBy: u!.id, countMethod: 'line' })
      .returning();
    await expectPgError(sql`update gr_lines set count_method = 'guess' where id = ${line!.id}`, CHECK_VIOLATION);
    await sql`update gr_lines set updated_at = '2000-01-01' where id = ${line!.id}`;
    await sql`update gr_lines set count_method = 'bulk_as_ordered' where id = ${line!.id}`;
    const [{ updated_at }] = (await sql`select updated_at from gr_lines where id = ${line!.id}`) as unknown as [{ updated_at: Date }];
    expect(updated_at.getUTCFullYear()).toBeGreaterThan(2000); // the trigger re-stamped it
    await db.delete(users).where(eq(users.id, u!.id));
    const [after] = await db.select().from(grLines).where(eq(grLines.id, line!.id));
    expect(after!.countedBy).toBeNull();
    await db.delete(goodsReceipts).where(eq(goodsReceipts.id, gr!.id));
  });

  it('the legacy backfill stamps only unstamped, valid lines of closed receipts, with the receipt time, and is idempotent', async () => {
    const file = readFileSync(join(migrationsDir(), '0071_schema_batch_0.sql'), 'utf8');
    const backfill = /UPDATE "gr_lines" AS gl[\s\S]*?;/.exec(file)?.[0];
    expect(backfill, 'the backfill UPDATE is in 0071').toBeTruthy();

    const closedAt = new Date('2026-10-20T08:00:00Z');
    const mk = async (status: 'completed' | 'partial' | 'pending' | 'rejected') => {
      const [gr] = await db.insert(goodsReceipts).values({ restaurantId: A.restaurantId, status }).returning();
      const [line] = await db.insert(grLines).values({ grId: gr!.id, qtyReceived: '2' }).returning();
      // an explicit updated_at survives the house trigger (it only stamps unchanged values)
      await sql`update goods_receipts set updated_at = ${closedAt} where id = ${gr!.id}`;
      return { grId: gr!.id, lineId: line!.id };
    };
    const completed = await mk('completed');
    const partial = await mk('partial');
    const pending = await mk('pending');
    const rejected = await mk('rejected');
    const counted = await mk('completed');
    // A legacy line that breaks 0032's NOT VALID check: stamping it would abort the batch.
    const negative = await mk('completed');
    await sql`alter table gr_lines drop constraint gr_lines_qty_received_nonneg`;
    await sql`update gr_lines set qty_received = -1 where id = ${negative.lineId}`;
    await sql`alter table gr_lines add constraint gr_lines_qty_received_nonneg check (qty_received >= 0) not valid`;
    const already = new Date('2026-10-21T09:30:00Z');
    await db.update(grLines).set({ countedAt: already, countMethod: 'line' }).where(eq(grLines.id, counted.lineId));

    await sql.unsafe(backfill!);
    const read = async (id: string) => (await db.select().from(grLines).where(eq(grLines.id, id)))[0]!;
    for (const x of [completed, partial]) {
      const l = await read(x.lineId);
      expect(l.countedAt?.toISOString()).toBe(closedAt.toISOString());
      expect(l.countMethod).toBe('legacy');
      expect(l.countedBy).toBeNull();
    }
    for (const x of [pending, rejected]) {
      const l = await read(x.lineId);
      expect(l.countedAt).toBeNull();
      expect(l.countMethod).toBeNull();
    }
    const skipped = await read(negative.lineId);
    expect(skipped.countedAt).toBeNull();
    expect(skipped.countMethod).toBeNull();
    const kept = await read(counted.lineId);
    expect(kept.countedAt?.toISOString()).toBe(already.toISOString());
    expect(kept.countMethod).toBe('line');

    const second = await sql.unsafe(backfill!);
    expect(second.count).toBe(0); // idempotent: nothing left to stamp

    for (const x of [completed, partial, pending, rejected, counted, negative]) await db.delete(goodsReceipts).where(eq(goodsReceipts.id, x.grId));
    // Leave 0032's check VALIDATED again (the 0032 shape test asserts it).
    await sql`alter table gr_lines validate constraint gr_lines_qty_received_nonneg`;
  });
});

describe('0071 idempotency_keys', () => {
  it('has the documented columns', async () => {
    expect(await col('idempotency_keys', 'key')).toMatchObject({ data_type: 'character varying', is_nullable: 'NO' });
    expect(await col('idempotency_keys', 'procedure')).toMatchObject({ data_type: 'character varying', is_nullable: 'NO' });
    expect(await col('idempotency_keys', 'user_id')).toMatchObject({ data_type: 'uuid', is_nullable: 'YES' });
    expect(await col('idempotency_keys', 'request_hash')).toMatchObject({ data_type: 'character varying', is_nullable: 'YES' });
    expect(await col('idempotency_keys', 'response')).toMatchObject({ data_type: 'jsonb', is_nullable: 'YES' });
    expect(await col('idempotency_keys', 'created_at')).toMatchObject({ is_nullable: 'NO', column_default: 'now()' });
  });

  it('a key is unique per restaurant, not globally, and never blank', async () => {
    await db.insert(idempotencyKeys).values({ restaurantId: A.restaurantId, key: 'same', procedure: 'receiving.complete', userId });
    await db.insert(idempotencyKeys).values({ restaurantId: B.restaurantId, key: 'same', procedure: 'receiving.complete' });
    await expectPgError(
      db.insert(idempotencyKeys).values({ restaurantId: A.restaurantId, key: 'same', procedure: 'x' }),
      UNIQUE_VIOLATION,
    );
    await expectPgError(db.insert(idempotencyKeys).values({ restaurantId: A.restaurantId, key: '  ', procedure: 'x' }), CHECK_VIOLATION);
    await db.delete(idempotencyKeys).where(eq(idempotencyKeys.key, 'same'));
  });
});

describe('0071 purchase_orders / goods_receipts', () => {
  it('kind defaults to standard and only allows standard | walk_in; po_number and delivery_note_number are nullable', async () => {
    expect(await col('purchase_orders', 'kind')).toMatchObject({ is_nullable: 'NO', column_default: "'standard'::character varying" });
    expect(await col('purchase_orders', 'po_number')).toMatchObject({ data_type: 'character varying', is_nullable: 'YES' });
    expect(await col('goods_receipts', 'delivery_note_number')).toMatchObject({ data_type: 'character varying', is_nullable: 'YES' });
    const [po] = await db.insert(purchaseOrders).values({ restaurantId: A.restaurantId, supplierId: A.supplierId }).returning();
    expect(po!.kind).toBe('standard');
    expect(po!.poNumber).toBeNull();
    await db.update(purchaseOrders).set({ kind: 'walk_in', poNumber: 'PO-17' }).where(eq(purchaseOrders.id, po!.id));
    await expectPgError(sql`update purchase_orders set kind = 'rush' where id = ${po!.id}`, CHECK_VIOLATION);
    await db.delete(purchaseOrders).where(eq(purchaseOrders.id, po!.id));
  });
});

describe('0071 discrepancies decision', () => {
  it('adds decision (nullable, CHECKed), basis jsonb, escalated_from_role user_role, escalated_by → users', async () => {
    expect(await col('discrepancies', 'decision')).toMatchObject({ data_type: 'character varying', is_nullable: 'YES', column_default: null });
    expect(await col('discrepancies', 'basis')).toMatchObject({ data_type: 'jsonb', is_nullable: 'YES' });
    expect(await col('discrepancies', 'escalated_from_role')).toMatchObject({ udt_name: 'user_role', is_nullable: 'YES' });
    expect(await col('discrepancies', 'escalated_by')).toMatchObject({ data_type: 'uuid', is_nullable: 'YES' });
    const [d] = await db.select().from(discrepancies).where(eq(discrepancies.id, A.discrepancyId));
    expect(d!.decision).toBeNull();
    for (const v of ['claim', 'waive', 'acknowledge', 'hold_duplicate', 'release_duplicate', 'link_po', 'tolerate'] as const) {
      await db.update(discrepancies).set({ decision: v }).where(eq(discrepancies.id, A.discrepancyId));
    }
    await expectPgError(sql`update discrepancies set decision = 'approve' where id = ${A.discrepancyId}`, CHECK_VIOLATION);
    await db
      .update(discrepancies)
      .set({ decision: null, basis: { deltaAgorot: 1234 }, escalatedFromRole: 'receiver', escalatedBy: userId })
      .where(eq(discrepancies.id, A.discrepancyId));
  });
});

describe('0071 claim_letters + recovery_claims.letter_id', () => {
  it('defaults status draft / version 1, CHECKs status, seq_no > 0, version >= 1', async () => {
    expect(await col('claim_letters', 'reply_by')).toMatchObject({ data_type: 'date' });
    expect(await col('claim_letters', 'content_snapshot')).toMatchObject({ data_type: 'jsonb' });
    const [l] = await db.insert(claimLetters).values({ restaurantId: A.restaurantId, supplierId: A.supplierId, seqNo: 1 }).returning();
    expect(l).toMatchObject({ status: 'draft', version: 1, sentAt: null, channel: null });
    await expectPgError(sql`update claim_letters set status = 'paid' where id = ${l!.id}`, CHECK_VIOLATION);
    await expectPgError(sql`update claim_letters set version = 0 where id = ${l!.id}`, CHECK_VIOLATION);
    await expectPgError(
      db.insert(claimLetters).values({ restaurantId: A.restaurantId, supplierId: A.supplierId, seqNo: 0 }),
      CHECK_VIOLATION,
    );
    await db.delete(claimLetters).where(eq(claimLetters.id, l!.id));
  });

  it('numbers letters per restaurant (seq_no unique within a restaurant only)', async () => {
    await db.insert(claimLetters).values({ restaurantId: A.restaurantId, supplierId: A.supplierId, seqNo: 7 });
    await db.insert(claimLetters).values({ restaurantId: B.restaurantId, supplierId: B.supplierId, seqNo: 7 });
    await expectPgError(
      db.insert(claimLetters).values({ restaurantId: A.restaurantId, supplierId: A.supplierId, seqNo: 7 }),
      UNIQUE_VIOLATION,
    );
    await db.delete(claimLetters).where(eq(claimLetters.seqNo, 7));
  });

  it('refuses a supplier of another restaurant, and blocks deleting a supplier that has letters', async () => {
    await expectPgError(
      db.insert(claimLetters).values({ restaurantId: A.restaurantId, supplierId: B.supplierId, seqNo: 2 }),
      FK_VIOLATION,
    );
    const [s] = await db.insert(suppliers).values({ restaurantId: A.restaurantId, name: '0071 lettered' }).returning();
    const [l] = await db.insert(claimLetters).values({ restaurantId: A.restaurantId, supplierId: s!.id, seqNo: 3 }).returning();
    await expectPgError(db.delete(suppliers).where(eq(suppliers.id, s!.id)), FK_VIOLATION);
    await db.delete(claimLetters).where(eq(claimLetters.id, l!.id));
    await db.delete(suppliers).where(eq(suppliers.id, s!.id));
  });

  it('keeps updated_at by trigger', async () => {
    const [l] = await db.insert(claimLetters).values({ restaurantId: A.restaurantId, supplierId: A.supplierId, seqNo: 4 }).returning();
    await sql`update claim_letters set updated_at = '2000-01-01' where id = ${l!.id}`;
    await sql`update claim_letters set status = 'sent' where id = ${l!.id}`;
    const [{ updated_at }] = (await sql`select updated_at from claim_letters where id = ${l!.id}`) as unknown as [{ updated_at: Date }];
    expect(updated_at.getUTCFullYear()).toBeGreaterThan(2000);
    await db.delete(claimLetters).where(eq(claimLetters.id, l!.id));
  });

  it('recovery_claims.letter_id is a same-tenant FK that nulls when the letter is deleted', async () => {
    expect(await col('recovery_claims', 'letter_id')).toMatchObject({ data_type: 'uuid', is_nullable: 'YES' });
    const [lb] = await db.insert(claimLetters).values({ restaurantId: B.restaurantId, supplierId: B.supplierId, seqNo: 5 }).returning();
    await expectPgError(db.update(recoveryClaims).set({ letterId: lb!.id }).where(eq(recoveryClaims.id, A.claimId)), FK_VIOLATION);
    const [la] = await db.insert(claimLetters).values({ restaurantId: A.restaurantId, supplierId: A.supplierId, seqNo: 5 }).returning();
    await db.update(recoveryClaims).set({ letterId: la!.id }).where(eq(recoveryClaims.id, A.claimId));
    await db.delete(claimLetters).where(eq(claimLetters.id, la!.id));
    const [c] = await db.select().from(recoveryClaims).where(eq(recoveryClaims.id, A.claimId));
    expect(c!.letterId).toBeNull();
    expect(c!.restaurantId).toBe(A.restaurantId); // SET NULL (letter_id) only, never the tenant column
    await db.delete(claimLetters).where(eq(claimLetters.id, lb!.id));
  });
});

describe('0071 payment_deductions', () => {
  it('amount_agorot is bigint > 0; vat_basis defaults incl_vat and is CHECKed', async () => {
    expect(await col('payment_deductions', 'amount_agorot')).toMatchObject({ data_type: 'bigint', is_nullable: 'NO' });
    expect(await col('payment_deductions', 'vat_basis')).toMatchObject({ is_nullable: 'NO', column_default: "'incl_vat'::character varying" });
    const [p] = await db
      .insert(paymentDeductions)
      .values({ restaurantId: A.restaurantId, invoiceId: A.invoiceId, claimId: A.claimId, amountAgorot: 1234, createdBy: userId })
      .returning();
    expect(p!.vatBasis).toBe('incl_vat');
    await expectPgError(sql`update payment_deductions set amount_agorot = 0 where id = ${p!.id}`, CHECK_VIOLATION);
    await expectPgError(sql`update payment_deductions set vat_basis = 'gross' where id = ${p!.id}`, CHECK_VIOLATION);
    await db.delete(paymentDeductions).where(eq(paymentDeductions.id, p!.id));
  });

  it('refuses another restaurant’s invoice or claim; blocks deleting its invoice; nulls claim_id when the claim goes', async () => {
    await expectPgError(
      db.insert(paymentDeductions).values({ restaurantId: A.restaurantId, invoiceId: B.invoiceId, amountAgorot: 1 }),
      FK_VIOLATION,
    );
    await expectPgError(
      db.insert(paymentDeductions).values({ restaurantId: A.restaurantId, invoiceId: A.invoiceId, claimId: B.claimId, amountAgorot: 1 }),
      FK_VIOLATION,
    );
    const t = await seed('deduction', '000000714');
    const [p] = await db
      .insert(paymentDeductions)
      .values({ restaurantId: t.restaurantId, invoiceId: t.invoiceId, claimId: t.claimId, amountAgorot: 500 })
      .returning();
    await db.delete(recoveryClaims).where(eq(recoveryClaims.id, t.claimId));
    const [after] = await db.select().from(paymentDeductions).where(eq(paymentDeductions.id, p!.id));
    expect(after!.claimId).toBeNull();
    expect(after!.restaurantId).toBe(t.restaurantId);
    await expectPgError(sql`delete from invoices where id = ${t.invoiceId}`, FK_VIOLATION);
    await cleanup(t);
  });
});

describe('0071 product_aliases.source / users.phone_verified_at', () => {
  it('source defaults to legacy and only allows the five provenances', async () => {
    expect(await col('product_aliases', 'source')).toMatchObject({ is_nullable: 'NO', column_default: "'legacy'::character varying" });
    const [prod] = await db.insert(products).values({ restaurantId: A.restaurantId, canonicalName: '0071 alias product' }).returning();
    const [a] = await db.insert(productAliases).values({ productId: prod!.id, supplierNameRaw: 'עגבניה' }).returning();
    expect(a!.source).toBe('legacy');
    for (const v of ['human', 'exact_key', 'new_product', 'import_guess'] as const) {
      await db.update(productAliases).set({ source: v }).where(eq(productAliases.id, a!.id));
    }
    await expectPgError(sql`update product_aliases set source = 'ocr' where id = ${a!.id}`, CHECK_VIOLATION);
    await db.delete(products).where(eq(products.id, prod!.id));
  });

  it('users.phone_verified_at is a nullable timestamptz', async () => {
    expect(await col('users', 'phone_verified_at')).toMatchObject({ data_type: 'timestamp with time zone', is_nullable: 'YES', column_default: null });
    const [u] = await db.select().from(users).where(eq(users.id, userId));
    expect(u!.phoneVerifiedAt).toBeNull();
  });
});

describe('0071 enum values', () => {
  it('activity_event_type has event and notification_status has skipped (existing values kept)', async () => {
    const rows = (await sql`
      select t.typname, array_agg(e.enumlabel order by e.enumsortorder)::text[] as labels
      from pg_type t join pg_enum e on e.enumtypid = t.oid
      where t.typname in ('activity_event_type', 'notification_status') group by t.typname order by t.typname
    `) as unknown as Array<{ typname: string; labels: string[] }>;
    expect(rows).toEqual([
      {
        typname: 'activity_event_type',
        labels: ['invoice_received', 'invoice_matched', 'discrepancy_approved', 'discrepancy_rejected', 'alias_learned', 'sync_completed', 'event'],
      },
      { typname: 'notification_status', labels: ['queued', 'sending', 'sent', 'failed', 'cancelled', 'skipped'] },
    ]);
  });
});
