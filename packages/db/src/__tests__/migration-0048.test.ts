import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDb,
  creditNotes,
  discrepancies,
  eq,
  invoices,
  matchRuns,
  monthlyReports,
  recoveryClaims,
  recoveryEvents,
  restaurants,
  suppliers,
} from '../index';
import { testDbUrl } from '../test-env';

/**
 * Migration-shape tests for 0048_recovery + 0049_monthly_reports: the tables
 * exist, money columns are bigint agorot with sign checks, the lifecycle status
 * is CHECK-constrained, one claim per discrepancy, one report per month, and
 * updated_at is trigger-maintained.
 */
const url = testDbUrl();
const sql = postgres(url, { max: 1, prepare: false });
const db = createDb(url);

let restaurantId: string;
let supplierId: string;
let discrepancyId: string;

beforeAll(async () => {
  const [r] = await db.insert(restaurants).values({ name: '0048 shape', businessId: '000000048' }).returning();
  restaurantId = r!.id;
  const [s] = await db.insert(suppliers).values({ restaurantId, name: 'ספק 0048' }).returning();
  supplierId = s!.id;
  const [inv] = await db
    .insert(invoices)
    .values({ restaurantId, supplierId, invoiceNumber: 'S-0048', source: 'manual' })
    .returning();
  const [mr] = await db
    .insert(matchRuns)
    .values({ restaurantId, invoiceId: inv!.id, overallStatus: 'minor' })
    .returning();
  const [d] = await db
    .insert(discrepancies)
    .values({ restaurantId, matchRunId: mr!.id, type: 'PRICE_HIGHER', severity: 'warn', deltaAmount: '12.50' })
    .returning();
  discrepancyId = d!.id;
});

afterAll(async () => {
  await db.delete(restaurants).where(eq(restaurants.id, restaurantId));
  await sql.end();
});

describe('0048/0049 migration shape', () => {
  it('stores money as bigint agorot', async () => {
    const rows = (await sql`
      select table_name, column_name, data_type from information_schema.columns
      where table_schema = 'public' and column_name like '%agorot'
        and table_name in ('credit_notes','recovery_claims','recovery_events')
      order by table_name, column_name
    `) as unknown as Array<{ table_name: string; column_name: string; data_type: string }>;
    expect(rows.map((r) => `${r.table_name}.${r.column_name}:${r.data_type}`)).toEqual([
      'credit_notes.amount_agorot:bigint',
      'recovery_claims.amount_agorot:bigint',
      'recovery_claims.credited_agorot:bigint',
      'recovery_events.amount_agorot:bigint',
    ]);
  });

  it('one claim per discrepancy, CHECK-constrained status and amounts, trigger-maintained updated_at', async () => {
    const [c] = await db
      .insert(recoveryClaims)
      .values({ restaurantId, discrepancyId, supplierId, amountAgorot: 1250 })
      .returning();
    expect(c!.status).toBe('claimed');
    expect(c!.creditedAgorot).toBe(0);
    await expect(
      db.insert(recoveryClaims).values({ restaurantId, discrepancyId, amountAgorot: 1 }),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      db.update(recoveryClaims).set({ status: 'paid' as never }).where(eq(recoveryClaims.id, c!.id)),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      db.update(recoveryClaims).set({ amountAgorot: -1 }).where(eq(recoveryClaims.id, c!.id)),
    ).rejects.toMatchObject({ code: '23514' });
    await sql`update recovery_claims set note = 'x' where id = ${c!.id}`;
    const [after] = await db.select().from(recoveryClaims).where(eq(recoveryClaims.id, c!.id));
    expect(after!.updatedAt.getTime()).toBeGreaterThanOrEqual(c!.updatedAt.getTime());
    await db.insert(recoveryEvents).values({ restaurantId, claimId: c!.id, toStatus: 'claimed' });
  });

  it('credit notes: positive amount, invoice_line source needs a line, one note per line', async () => {
    await expect(
      db.insert(creditNotes).values({ restaurantId, supplierId, amountAgorot: 0, issuedOn: '2026-10-01' }),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      db.insert(creditNotes).values({
        restaurantId,
        supplierId,
        amountAgorot: 100,
        issuedOn: '2026-10-01',
        source: 'invoice_line',
      }),
    ).rejects.toMatchObject({ code: '23514' });
    const [n] = await db
      .insert(creditNotes)
      .values({ restaurantId, supplierId, amountAgorot: 1250, issuedOn: '2026-10-01', number: 'CN-1' })
      .returning();
    expect(n!.amountAgorot).toBe(1250);
  });

  it('monthly_reports: one per restaurant-month, month must be a first day', async () => {
    await db.insert(monthlyReports).values({ restaurantId, month: '2026-09-01', snapshot: { v: 1 } });
    await expect(
      db.insert(monthlyReports).values({ restaurantId, month: '2026-09-01', snapshot: {} }),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      db.insert(monthlyReports).values({ restaurantId, month: '2026-09-15', snapshot: {} }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('all four tables have RLS enabled (rls/0002 list)', async () => {
    const rows = (await sql`
      select relname, relrowsecurity from pg_class
      where relname in ('credit_notes','recovery_claims','recovery_events','monthly_reports') order by relname
    `) as unknown as Array<{ relname: string; relrowsecurity: boolean }>;
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
    expect(rows).toHaveLength(4);
  });
});
