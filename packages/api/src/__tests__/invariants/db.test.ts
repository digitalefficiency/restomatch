/**
 * G-16 API invariants against the DB (GAP-PACKAGES G-16 §2):
 *  • GET procedures write nothing — a statement log over every tRPC `query`
 *    (recovery.list and the monthly report included): any INSERT / UPDATE /
 *    DELETE / row lock is a violation, counted per router;
 *  • a discrepancy is on at most one credit-request letter — at most one live
 *    claim per discrepancy (the claim is the letter line).
 * Warn mode prints the per-area counts; G16_MODE=error fails on them.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, discrepancies, eq, recoveryClaims, restaurants, sql, testDbUrl } from '@restomatch/db';
import { appRouter } from '../../index';
import type { AppContext, Session } from '../../context';
import { syncClaims } from '../../recovery/service';
import { resetDb, seedTenant, type Tenant } from '../fixtures';
import { isWriteStatement, loggedDb, report, type Violation } from './g16';

const base = createDb(testDbUrl());
let T: Tenant;

/** Inputs for queries whose input is required; every other query is probed with none. */
const INPUTS: Record<string, unknown> = {
  'monthlyReport.preview': { month: '2026-10' },
  'monthlyReport.pdf': { month: '2026-10', locale: 'he' },
  'monthlyReport.digest': { month: '2026-10' },
};
/** Must be probed (GAP G-16 §2 names them); a skip here is a test failure, not a warn. */
const REQUIRED = ['recovery.list', 'monthlyReport.preview'];

function call(db: AppContext['db'], path: string, input: unknown, role: Session['role'] = 'owner'): Promise<unknown> {
  const ctx: AppContext = { db, session: { userId: T.ownerUserId, restaurantId: T.restaurantId, role } };
  let fn: unknown = appRouter.createCaller(ctx);
  for (const seg of path.split('.')) fn = (fn as Record<string, unknown>)[seg];
  return (fn as (i: unknown) => Promise<unknown>)(input);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms))]);
}

beforeAll(async () => {
  await resetDb(base);
  T = await seedTenant(base, 'G16');
  await base.update(restaurants).set({ settings: { features: { all: true } } as never }).where(eq(restaurants.id, T.restaurantId));
});

afterAll(async () => {
  await resetDb(base);
});

describe('statement log (self-test)', () => {
  it('classifies writes and reads', () => {
    for (const w of [
      'insert into "x" values (1)',
      'UPDATE recovery_claims SET status = $1',
      'delete from "t" where id = $1',
      'with s as (select 1) insert into t select * from s',
      'with u as (update "t" set a = 1 returning id) select * from u',
      'select * from "t" where id = $1 for update',
      'select 1 for no key update',
      '/* c */ truncate t',
    ]) {
      expect(isWriteStatement(w), w).toBe(true);
    }
    for (const r of [
      'select "status", "updated_at" from "recovery_claims"',
      "select set_config('app.current_restaurant_id', $1, true)",
      'with t as (select 1) select * from t',
      'select "deleted_at" from x where note = \'update set\'',
    ]) {
      expect(isWriteStatement(r), r).toBe(false);
    }
  });

  it('records every statement Drizzle sends, writes included', async () => {
    const { db, log } = loggedDb(base);
    await db.select({ id: discrepancies.id }).from(discrepancies).where(eq(discrepancies.restaurantId, T.restaurantId));
    await db.update(discrepancies).set({ resolutionNote: null }).where(eq(discrepancies.id, T.discrepancyId));
    await db.execute(sql`select 1`);
    expect(log).toHaveLength(3);
    expect(log.map(isWriteStatement)).toEqual([false, true, false]);
  });
});

describe('get-writes-nothing', () => {
  it('every tRPC query, probed as the owner on the seeded tenant, writes nothing (warn)', async () => {
    const procedures = (appRouter._def as unknown as { procedures: Record<string, { _def: { type: string } }> }).procedures;
    const queries = Object.entries(procedures)
      .filter(([, p]) => p._def.type === 'query')
      .map(([path]) => path)
      .sort();
    expect(queries).toEqual(expect.arrayContaining(REQUIRED));

    const violations: Violation[] = [];
    const probed: string[] = [];
    const skipped: string[] = [];
    for (const path of queries) {
      const { db, log } = loggedDb(base);
      try {
        await withTimeout(call(db, path, INPUTS[path]), 15_000);
        probed.push(path);
      } catch (e) {
        // An input/permission refusal still ran no handler; a handler error after writes still counts.
        const code = (e as { code?: string }).code;
        if (code === 'BAD_REQUEST' || code === 'FORBIDDEN' || code === 'NOT_FOUND' || code === 'UNAUTHORIZED') skipped.push(`${path} (${code})`);
        else probed.push(path);
      }
      const writes = log.filter(isWriteStatement);
      for (const w of writes) {
        violations.push({ area: `api:${path.split('.')[0]}`, detail: `${path}: ${w.replace(/\s+/g, ' ').slice(0, 120)}` });
      }
    }
    console.warn(`[G-16] get-writes-nothing · probed ${probed.length}/${queries.length} queries; not probed: ${skipped.join(', ') || 'none'}`);
    for (const r of REQUIRED) expect(probed, `${r} must be probed`).toContain(r);
    report('get-writes-nothing', violations);
  });
});

describe('one-letter-per-discrepancy', () => {
  it('self-test: the DB refuses a second claim for one discrepancy', async () => {
    // Only a decided (accepted) leak line becomes a claim — the letter line.
    await base.update(discrepancies).set({ resolutionStatus: 'accepted', resolvedAt: new Date() }).where(eq(discrepancies.id, T.discrepancyId));
    await syncClaims(base, T.restaurantId);
    const [c] = await base.select().from(recoveryClaims).where(eq(recoveryClaims.discrepancyId, T.discrepancyId));
    expect(c).toBeTruthy();
    await expect(
      base.insert(recoveryClaims).values({ restaurantId: T.restaurantId, discrepancyId: T.discrepancyId, amountAgorot: 1, status: 'claimed' }),
    ).rejects.toThrow();
  });

  it('no discrepancy sits on two live letter lines, and every claim is on its invoice supplier’s letter (warn)', async () => {
    await syncClaims(base, T.restaurantId);
    const dup = await base.execute<{ discrepancy_id: string; n: number }>(sql`
      select discrepancy_id, count(*)::int as n from recovery_claims
      where status <> 'written_off' group by discrepancy_id having count(*) > 1`);
    const wrongSupplier = await base.execute<{ id: string }>(sql`
      select c.id from recovery_claims c join invoices i on i.id = c.invoice_id and i.restaurant_id = c.restaurant_id
      where c.supplier_id is distinct from i.supplier_id`);
    const violations: Violation[] = [
      ...[...dup].map((r) => ({ area: 'api:recovery', detail: `discrepancy ${r.discrepancy_id} on ${r.n} live claims` })),
      ...[...wrongSupplier].map((r) => ({ area: 'api:recovery', detail: `claim ${r.id}: supplier differs from its invoice's (letter grouped under another supplier)` })),
    ];
    report('one-letter-per-discrepancy', violations);
  });
});
