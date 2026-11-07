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

  it('the legacy backfill stamps only unstamped, interim-counted, valid lines of closed receipts, with the receipt time, and is idempotent', async () => {
    const file = readFileSync(join(migrationsDir(), '0071_schema_batch_0.sql'), 'utf8');
    const backfill = /UPDATE "gr_lines" AS gl[\s\S]*?;/.exec(file)?.[0];
    expect(backfill, 'the backfill UPDATE is in 0071').toBeTruthy();

    // Everything runs in ONE transaction that is always rolled back: the constraint
    // swap and the full-table backfill never leave this test, pass or fail.
    const ROLLBACK = new Error('rollback');
    const closedAt = new Date('2026-10-20T08:00:00Z');
    const already = new Date('2026-10-21T09:30:00Z');
    type Line = { counted_at: Date | null; count_method: string | null; counted_by: string | null };
    const seen: Record<string, Line> = {};
    let secondCount = -1;
    await expect(
      sql.begin(async (tx) => {
        const mk = async (status: string, line: { qty?: number; reason?: string; notes?: string } = { qty: 2 }) => {
          const [gr] = (await tx`insert into goods_receipts (restaurant_id, status) values (${A.restaurantId}, ${status}::gr_status) returning id`) as unknown as [{ id: string }];
          const [row] = (await tx`
            insert into gr_lines (gr_id, qty_received, reject_reason, condition_notes)
            values (${gr.id}, ${line.qty ?? 0}, ${line.reason ?? null}, ${line.notes ?? null}) returning id
          `) as unknown as [{ id: string }];
          // an explicit updated_at survives the house trigger (it only stamps unchanged values)
          await tx`update goods_receipts set updated_at = ${closedAt} where id = ${gr.id}`;
          return row.id;
        };
        const ids = {
          completed: await mk('completed'),
          partial: await mk('partial'),
          pending: await mk('pending'),
          rejected: await mk('rejected'),
          counted: await mk('completed'),
          // A legacy line that breaks 0032's NOT VALID check: stamping it would abort the batch.
          negative: await mk('completed'),
          // Counted by the interim marker although 0 received (G-04 countedLineSql ≡ fromGrLine):
          missing: await mk('partial', { reason: 'missing' }),
          damagedNote: await mk('completed', { notes: 'damaged: box crushed' }),
          bulk: await mk('completed', { qty: 5, notes: 'count:bulk_as_ordered' }),
          spot: await mk('partial', { notes: 'נבדק count:spot_check' }),
          // NOT counted: an untouched 0/0 line ("לא נספר") and a free-text note alone.
          untouched: await mk('partial', { qty: 0 }),
          noteOnly: await mk('completed', { qty: 0, notes: 'הספק התקשר' }),
          // A token glued to a word is not a token (ASCII word boundary, like the JS \b).
          glued: await mk('completed', { qty: 0, notes: 'xcount:per_line' }),
        };
        await tx`alter table gr_lines drop constraint gr_lines_qty_received_nonneg`;
        await tx`update gr_lines set qty_received = -1 where id = ${ids.negative}`;
        await tx`alter table gr_lines add constraint gr_lines_qty_received_nonneg check (qty_received >= 0) not valid`;
        await tx`update gr_lines set counted_at = ${already}, count_method = 'line' where id = ${ids.counted}`;

        await tx.unsafe(backfill!);
        for (const [k, id] of Object.entries(ids)) {
          const [row] = (await tx`select counted_at, count_method, counted_by from gr_lines where id = ${id}`) as unknown as [Line];
          seen[k] = row;
        }
        secondCount = (await tx.unsafe(backfill!)).count;
        throw ROLLBACK;
      }),
    ).rejects.toBe(ROLLBACK);

    for (const k of ['completed', 'partial', 'missing', 'damagedNote', 'spot']) {
      expect(seen[k]!.counted_at?.toISOString(), k).toBe(closedAt.toISOString());
      expect(seen[k]!.count_method, k).toBe('legacy');
      expect(seen[k]!.counted_by, k).toBeNull();
    }
    expect(seen.bulk!.counted_at?.toISOString()).toBe(closedAt.toISOString());
    expect(seen.bulk!.count_method).toBe('bulk_as_ordered');
    // Unknown stays unknown: G-04's switch to counted_at IS NOT NULL must not turn
    // an untouched line into "received 0" (a false whole-line shortfall).
    for (const k of ['pending', 'rejected', 'negative', 'untouched', 'noteOnly', 'glued']) {
      expect(seen[k]!.counted_at, k).toBeNull();
      expect(seen[k]!.count_method, k).toBeNull();
    }
    expect(seen.counted!.counted_at?.toISOString()).toBe(already.toISOString());
    expect(seen.counted!.count_method).toBe('line');
    expect(secondCount).toBe(0); // idempotent: nothing left to stamp

    // The rollback restored 0032's check, still VALIDATED.
    const [{ convalidated }] = (await sql`select convalidated from pg_constraint where conname = 'gr_lines_qty_received_nonneg'`) as unknown as [{ convalidated: boolean }];
    expect(convalidated).toBe(true);
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
    for (const c of ['whatsapp', 'email', 'print'] as const) {
      await db.update(claimLetters).set({ channel: c }).where(eq(claimLetters.id, l!.id));
    }
    await expectPgError(sql`update claim_letters set channel = 'fax' where id = ${l!.id}`, CHECK_VIOLATION);
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

describe('0071 fails fast on a lock instead of queueing', () => {
  const statements = () =>
    readFileSync(join(migrationsDir(), '0071_schema_batch_0.sql'), 'utf8')
      .split('--> statement-breakpoint')
      .map((x) => x.trim())
      .filter(Boolean);

  it('opens with set_config timeouts (not SET LOCAL) and takes every lock up front, parent-first, inside ONE DO block', () => {
    const code = (x: string) => x.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').trim();
    const [a, c, d, e] = statements().map(code);
    expect(a).toBe("SELECT set_config('lock_timeout', '5s', true);");
    expect(c).toBe("SELECT set_config('statement_timeout', '6s', true);");
    expect(d!.startsWith('DO $$')).toBe(true);
    expect(d!.match(/LOCK TABLE [^;]+;/g)).toEqual([
      'LOCK TABLE "restaurants", "suppliers" IN SHARE ROW EXCLUSIVE MODE;',
      // the app's order (startReceiving: purchase_orders → goods_receipts → gr_lines)
      'LOCK TABLE "purchase_orders", "goods_receipts", "gr_lines" IN ACCESS EXCLUSIVE MODE;',
      'LOCK TABLE "invoices" IN SHARE ROW EXCLUSIVE MODE;',
      'LOCK TABLE "discrepancies", "recovery_claims", "product_aliases", "users" IN ACCESS EXCLUSIVE MODE;',
    ]);
    expect(e).toBe("SELECT set_config('statement_timeout', (SELECT reset_val FROM pg_settings WHERE name = 'statement_timeout'), true);");
    // No other LOCK anywhere in the file, and nothing that needs a transaction block at top level.
    expect(statements().filter((x) => /\bLOCK TABLE\b/i.test(code(x)))).toHaveLength(1);
  });

  it('a long reader on users → 55P03 within the timeout, nothing applied; once it ends, a re-run succeeds', async () => {
    // A closed receipt with a counted, unstamped line: the backfill's witness.
    const [gr] = await db.insert(goodsReceipts).values({ restaurantId: A.restaurantId, status: 'completed' }).returning();
    const [line] = await db.insert(grLines).values({ grId: gr!.id, qtyReceived: '3' }).returning();
    const run = () =>
      sql.begin(async (tx) => {
        for (const st of statements()) await tx.unsafe(st);
      });

    const blocker = postgres(url, { max: 1, prepare: false });
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const lockTaken = new Promise<void>((r) => (locked = r));
    const reader = blocker.begin(async (tx) => {
      await tx`select count(*) from users`; // AccessShare on users, held until commit
      locked();
      await held;
    });
    try {
      await lockTaken;
      const t0 = Date.now();
      await expectPgError(run(), '55P03'); // lock_not_available
      expect(Date.now() - t0).toBeLessThan(9_000);
      const [after] = await db.select().from(grLines).where(eq(grLines.id, line!.id));
      expect(after!.countedAt).toBeNull(); // the whole transaction rolled back
    } finally {
      release();
      await reader;
      await blocker.end();
    }

    await run(); // traffic is quiet: the same file applies (idempotent)
    const [stamped] = await db.select().from(grLines).where(eq(grLines.id, line!.id));
    expect(stamped!.countedAt).not.toBeNull();
    expect(stamped!.countMethod).toBe('legacy');
    await db.delete(goodsReceipts).where(eq(goodsReceipts.id, gr!.id));
  }, 30_000);

  it('the whole lock phase is bounded at 6 s (statement_timeout): two staggered holders → 57014, nothing applied', async () => {
    const run = () =>
      sql.begin(async (tx) => {
        for (const st of statements()) await tx.unsafe(st);
      });
    const blocker = postgres(url, { max: 2, prepare: false });
    const releases: Array<() => void> = [];
    const taken: Array<Promise<void>> = [];
    const hold = (lockSql: string, ms: number) => {
      let locked!: () => void;
      taken.push(new Promise<void>((r) => (locked = r)));
      let release!: () => void;
      const done = new Promise<void>((r) => (release = r));
      releases.push(release);
      return blocker.begin(async (tx) => {
        await tx.unsafe(lockSql);
        locked();
        await Promise.race([done, new Promise((r) => setTimeout(r, ms))]);
      });
    };
    const h1 = hold('lock table restaurants in row exclusive mode', 4_000); // 4 s wait (< lock_timeout)…
    const h2 = hold('select count(*) from users', 20_000); // …then a second wait: only the 6 s bound stops it
    try {
      await Promise.all(taken);
      const t0 = Date.now();
      await expectPgError(run(), '57014'); // query_canceled (statement timeout)
      const took = Date.now() - t0;
      expect(took).toBeGreaterThan(5_500);
      expect(took).toBeLessThan(8_000);
    } finally {
      for (const r of releases) r();
      await Promise.all([h1, h2]);
      await blocker.end();
    }
    // The statement timeout was restored afterwards on the success path (checked by the re-run above),
    // and a failed run leaves the session default untouched (transaction-local set_config).
    const [{ statement_timeout }] = (await sql`show statement_timeout`) as unknown as [{ statement_timeout: string }];
    expect(statement_timeout).toBe('0');
  }, 30_000);
});

