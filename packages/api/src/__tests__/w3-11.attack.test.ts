import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyAuditImmutableRls,
  applyAuthCredentialTables,
  applyCoreTenantRls,
  createDb,
  creditNotes,
  ensureRlsAppRole,
  eq,
  invoices,
  recoveryClaims,
  restaurants,
  testDbUrl,
  type Database,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * W3-11 ATTACK SUITE — credit-note allocation + supplier statement reconciliation,
 * run on the RLS-enforced app role (`restomatch_app`, no BYPASSRLS), like production.
 * A = attacker, B = victim. Add-only (tenant-security-warden reviews).
 */

const TEST_DB_URL = testDbUrl();
const ownerDb = createDb(TEST_DB_URL);
let appDb: Database;
let A: Tenant;
let B: Tenant;
let claimA: string;
let claimB: string;

function caller(t: Tenant, role: Session['role'] = 'owner') {
  const ctx: AppContext = { db: appDb, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } };
  return appRouter.createCaller(ctx);
}

const csv = (...rows: string[]) => ['תאריך,סוג מסמך,אסמכתא,חובה,זכות', ...rows].join('\n');

beforeAll(async () => {
  await applyCoreTenantRls(TEST_DB_URL);
  await applyAuditImmutableRls(TEST_DB_URL);
  await applyAuthCredentialTables(TEST_DB_URL);
  appDb = createDb(await ensureRlsAppRole(TEST_DB_URL));
  await resetDb(ownerDb);
  A = await seedTenant(ownerDb, 'A');
  B = await seedTenant(ownerDb, 'B');
  for (const t of [A, B]) {
    await ownerDb.update(restaurants).set({ settings: { features: { all: true } } as never }).where(eq(restaurants.id, t.restaurantId));
  }
  // Distinct invoice numbers so a statement line can only match its own tenant's invoice.
  await ownerDb.update(invoices).set({ invoiceNumber: 'A-1001', totalInclVat: '118.00' }).where(eq(invoices.id, A.invoiceId));
  await ownerDb.update(invoices).set({ invoiceNumber: 'B-2002', totalInclVat: '236.00' }).where(eq(invoices.id, B.invoiceId));
  const [ca] = await ownerDb
    .insert(recoveryClaims)
    .values({ restaurantId: A.restaurantId, discrepancyId: A.discrepancyId, supplierId: A.supplierId, invoiceId: A.invoiceId, amountAgorot: 4_500 })
    .returning({ id: recoveryClaims.id });
  const [cb] = await ownerDb
    .insert(recoveryClaims)
    .values({ restaurantId: B.restaurantId, discrepancyId: B.discrepancyId, supplierId: B.supplierId, invoiceId: B.invoiceId, amountAgorot: 4_500 })
    .returning({ id: recoveryClaims.id });
  claimA = ca!.id;
  claimB = cb!.id;
  await ownerDb.insert(creditNotes).values({
    restaurantId: B.restaurantId,
    supplierId: B.supplierId,
    number: '777',
    amountAgorot: 5_000,
    issuedOn: '2026-10-10',
  });
});

afterAll(async () => {
  await resetDb(ownerDb);
});

describe('recovery.suggestAllocation (W3-11)', () => {
  it("B's supplier id → NOT_FOUND; nothing of B is read", async () => {
    await expect(caller(A).recovery.suggestAllocation({ supplierId: B.supplierId, amountAgorot: 4_500 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it("A's suggestion lists only A's claims and picks the exact one", async () => {
    const out = await caller(A).recovery.suggestAllocation({ supplierId: A.supplierId, amountAgorot: 4_500 });
    expect(out.candidates.map((c) => c.id)).toEqual([claimA]);
    expect(out.candidates.map((c) => c.id)).not.toContain(claimB);
    expect(out.suggestion).toMatchObject({ basis: 'exact_single', allocations: [{ id: claimA, agorot: 4_500 }] });
  });

  it('receiver and chef are refused (no ₪)', async () => {
    for (const role of ['receiver', 'chef'] as const) {
      await expect(caller(A, role).recovery.suggestAllocation({ supplierId: A.supplierId, amountAgorot: 1 })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    }
  });
});

describe('suppliers.reconcileStatement (W3-11)', () => {
  it("B's supplier id → NOT_FOUND", async () => {
    await expect(
      caller(A).suppliers.reconcileStatement({ supplierId: B.supplierId, csv: csv('10/10/2026,חשבונית מס,B-2002,236.00,') }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it("B's invoices and credit notes never match A's statement", async () => {
    const out = await caller(A).suppliers.reconcileStatement({
      supplierId: A.supplierId,
      csv: csv('10/10/2026,חשבונית מס,A-1001,118.00,', '10/10/2026,חשבונית מס,B-2002,236.00,', '10/10/2026,חשבונית זיכוי,777,,59.00'),
    });
    expect(out.matched).toEqual({ invoices: 1, credits: 0 });
    const kinds = out.flags.map((f) => [f.kind, f.number]);
    expect(kinds).toContainEqual(['invoice_never_got', 'B-2002']);
    expect(kinds).toContainEqual(['credit_unrecorded', '777']);
    expect(out.flags.some((f) => f.invoiceId === B.invoiceId)).toBe(false);
  });

  it('receiver and chef are refused (no ₪)', async () => {
    for (const role of ['receiver', 'chef'] as const) {
      await expect(
        caller(A, role).suppliers.reconcileStatement({ supplierId: A.supplierId, csv: csv('10/10/2026,חשבונית מס,A-1001,1.00,') }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });
});
