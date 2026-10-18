import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDb,
  creditNotes,
  discrepancies,
  eq,
  invoiceLines,
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

  it('credit notes: positive amount, known source', async () => {
    await expect(
      db.insert(creditNotes).values({ restaurantId, supplierId, amountAgorot: 0, issuedOn: '2026-10-01' }),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      db.insert(creditNotes).values({
        restaurantId,
        supplierId,
        amountAgorot: 100,
        issuedOn: '2026-10-01',
        source: 'ocr' as never,
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

  it('composite same-tenant FKs: no reference can point at another restaurant', async () => {
    const [other] = await db.insert(restaurants).values({ name: '0048 other', businessId: '000000049' }).returning();
    try {
      const [os] = await db.insert(suppliers).values({ restaurantId: other!.id, name: 'ספק זר' }).returning();
      const [oi] = await db
        .insert(invoices)
        .values({ restaurantId: other!.id, supplierId: os!.id, invoiceNumber: 'X-1', source: 'manual' })
        .returning();
      // This tenant's credit note → other tenant's supplier / invoice: FK violation.
      await expect(
        db.insert(creditNotes).values({ restaurantId, supplierId: os!.id, amountAgorot: 100, issuedOn: '2026-10-01' }),
      ).rejects.toMatchObject({ code: '23503' });
      await expect(
        db.insert(creditNotes).values({ restaurantId, supplierId, invoiceId: oi!.id, amountAgorot: 100, issuedOn: '2026-10-01' }),
      ).rejects.toMatchObject({ code: '23503' });
      // A claim → other tenant's discrepancy / supplier: FK violation.
      const [omr] = await db.insert(matchRuns).values({ restaurantId: other!.id, invoiceId: oi!.id, overallStatus: 'minor' }).returning();
      const [od] = await db
        .insert(discrepancies)
        .values({ restaurantId: other!.id, matchRunId: omr!.id, type: 'PRICE_HIGHER', severity: 'warn', deltaAmount: '1.00' })
        .returning();
      await expect(
        db.insert(recoveryClaims).values({ restaurantId, discrepancyId: od!.id, amountAgorot: 1 }),
      ).rejects.toMatchObject({ code: '23503' });
      await expect(
        db.update(recoveryClaims).set({ supplierId: os!.id }).where(eq(recoveryClaims.restaurantId, restaurantId)),
      ).rejects.toMatchObject({ code: '23503' });
      // An invoice line is reachable only through its own invoice (MATCH FULL).
      const [ol] = await db
        .insert(invoiceLines)
        .values({ invoiceId: oi!.id, rawDescription: 'x', qtyBilled: '1', unit: 'unit', unitPriceBilled: '-1', lineTotal: '-1.00' })
        .returning();
      await expect(
        db.insert(creditNotes).values({ restaurantId, supplierId, invoiceLineId: ol!.id, amountAgorot: 100, issuedOn: '2026-10-01', source: 'invoice_line' }),
      ).rejects.toMatchObject({ code: '23503' });
    } finally {
      await db.delete(restaurants).where(eq(restaurants.id, other!.id));
    }
    // The other tenant's delete cascaded nothing here.
    expect(await db.select().from(recoveryClaims).where(eq(recoveryClaims.restaurantId, restaurantId))).toHaveLength(1);
  });

  it('deleting an invoice removes a credit note derived from its credit line, keeps manual notes and clears claim links', async () => {
    const [inv] = await db
      .insert(invoices)
      .values({ restaurantId, supplierId, invoiceNumber: 'S-0048-CR', source: 'manual' })
      .returning();
    const [line] = await db
      .insert(invoiceLines)
      .values({ invoiceId: inv!.id, rawDescription: 'זיכוי', qtyBilled: '1', unit: 'unit', unitPriceBilled: '-5', lineTotal: '-5.00' })
      .returning();
    const [derived] = await db
      .insert(creditNotes)
      .values({ restaurantId, supplierId, invoiceId: inv!.id, invoiceLineId: line!.id, amountAgorot: 500, issuedOn: '2026-10-02', source: 'invoice_line' })
      .returning();
    await db.update(recoveryClaims).set({ creditNoteId: derived!.id }).where(eq(recoveryClaims.restaurantId, restaurantId));
    await db.delete(invoices).where(eq(invoices.id, inv!.id));
    expect(await db.select().from(creditNotes).where(eq(creditNotes.id, derived!.id))).toEqual([]);
    const [claim] = await db.select().from(recoveryClaims).where(eq(recoveryClaims.restaurantId, restaurantId));
    expect(claim!.creditNoteId).toBeNull();
    expect(claim!.restaurantId).toBe(restaurantId);
  });

  it('RLS is enabled inside the migration (with the tenant policy), not via rls/0002', async () => {
    const rows = (await sql`
      select tablename, policyname from pg_policies
      where tablename in ('credit_notes','recovery_claims','recovery_events','monthly_reports') order by 1
    `) as unknown as Array<{ tablename: string; policyname: string }>;
    expect(rows.map((r) => r.policyname)).toEqual([
      'credit_notes_tenant',
      'monthly_reports_tenant',
      'recovery_claims_tenant',
      'recovery_events_tenant',
    ]);
  });

  it('all four tables have RLS enabled', async () => {
    const rows = (await sql`
      select relname, relrowsecurity from pg_class
      where relname in ('credit_notes','recovery_claims','recovery_events','monthly_reports') order by relname
    `) as unknown as Array<{ relname: string; relrowsecurity: boolean }>;
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
    expect(rows).toHaveLength(4);
  });
});
