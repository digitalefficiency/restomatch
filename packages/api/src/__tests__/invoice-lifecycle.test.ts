import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  and,
  applyAuditImmutableRls,
  applyCoreTenantRls,
  auditLog,
  createDb,
  discrepancies,
  ensureRlsAppRole,
  eq,
  invoices,
  recoveryClaims,
  sql,
  testDbUrl,
  withRestaurant,
  type Database,
} from '@restomatch/db';
import { hasColumn, invoiceMachine, isTransitionConflict, isTransitionRefused, transition, transitionMany } from '../lifecycle';
import type { TRPCError } from '@trpc/server';
import { resolveAppError } from '../errors';
import { resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

/**
 * G-05 invoice machine. Owner decision (payment): mark_paid / unmark touch ONLY
 * the invoice — claims, discrepancies and every letter input hash-equal before
 * and after; a paid invoice keeps its claims.
 */

const TEST_DB_URL = testDbUrl();
const ownerDb = createDb(TEST_DB_URL);
/** Collection-time probe: H-03 adds invoices.paid_at. */
const hasPaidAt = await hasColumn(ownerDb, 'invoices', 'paid_at');
/** H-03 0072 adds paid_amount / payment_method / payment_ref with the pair CHECKs. */
const hasPaymentFacts = await hasColumn(ownerDb, 'invoices', 'paid_amount');
let appDb: Database;
let A: Tenant;

function asTenant<T>(fn: (tx: Database) => Promise<T>): Promise<T> {
  return withRestaurant(appDb, A.restaurantId, async (tx) => {
    await tx.execute(sql`select set_config('app.current_user_id', ${A.ownerUserId}, true)`);
    return fn(tx);
  });
}
const move = (event: string, extra: Record<string, unknown> = {}) =>
  asTenant((tx) =>
    transition(tx, invoiceMachine, {
      id: A.invoiceId,
      restaurantId: A.restaurantId,
      event: event as never,
      actorId: A.ownerUserId,
      ...extra,
    }),
  );

/** Everything the claims ledger, the letters and the pay-run credit read, hashed. */
async function moneyInputsHash(): Promise<string> {
  const rid = A.restaurantId;
  const rows = await ownerDb.execute(sql`
    SELECT
      (SELECT coalesce(json_agg(c ORDER BY c.id), '[]') FROM recovery_claims c WHERE c.restaurant_id = ${rid}) AS claims,
      (SELECT coalesce(json_agg(e ORDER BY e.id), '[]') FROM recovery_events e WHERE e.restaurant_id = ${rid}) AS events,
      (SELECT coalesce(json_agg(n ORDER BY n.id), '[]') FROM credit_notes n WHERE n.restaurant_id = ${rid}) AS notes,
      (SELECT coalesce(json_agg(d ORDER BY d.id), '[]') FROM discrepancies d WHERE d.restaurant_id = ${rid}) AS discrepancies,
      (SELECT coalesce(json_agg(l ORDER BY l.id), '[]') FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id WHERE i.restaurant_id = ${rid}) AS lines,
      (SELECT coalesce(json_agg(m ORDER BY m.id), '[]') FROM match_runs m WHERE m.restaurant_id = ${rid}) AS runs
  `);
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
async function invoiceAudits() {
  return ownerDb
    .select({ action: auditLog.action })
    .from(auditLog)
    .where(and(eq(auditLog.entityType, 'invoice'), eq(auditLog.entityId, A.invoiceId)));
}
async function invoiceStatus() {
  const [i] = await ownerDb.select({ status: invoices.status }).from(invoices).where(eq(invoices.id, A.invoiceId));
  return i!.status;
}

beforeAll(async () => {
  await applyCoreTenantRls(TEST_DB_URL);
  await applyAuditImmutableRls(TEST_DB_URL);
  appDb = createDb(await ensureRlsAppRole(TEST_DB_URL));
});

beforeEach(async () => {
  await resetDb(ownerDb);
  await seedPlans(ownerDb);
  A = await seedTenant(ownerDb, 'IA');
  // An accepted ₪100 discrepancy with an open claim on the (matched) invoice.
  await ownerDb.update(discrepancies).set({ resolutionStatus: 'accepted' }).where(eq(discrepancies.id, A.discrepancyId));
  await ownerDb.insert(recoveryClaims).values({
    restaurantId: A.restaurantId,
    discrepancyId: A.discrepancyId,
    supplierId: A.supplierId,
    invoiceId: A.invoiceId,
    amountAgorot: 10_000,
  });
});

afterAll(async () => {
  await resetDb(ownerDb);
});

describe('invoice machine', () => {
  it('mark_paid keeps the claims: claims, discrepancies and letter inputs hash-equal before and after', async () => {
    await move('approve_for_payment', { expectedFrom: 'matched' });
    const before = await moneyInputsHash();
    const r = await move('mark_paid', { expectedFrom: 'approved', payload: { paidOn: '2026-10-30' } });
    expect(r).toMatchObject({ from: 'approved', to: 'paid', replayed: false });
    expect(await invoiceStatus()).toBe('paid');
    expect(await moneyInputsHash()).toBe(before);
    const [claim] = await ownerDb.select().from(recoveryClaims).where(eq(recoveryClaims.restaurantId, A.restaurantId));
    expect(claim).toMatchObject({ status: 'claimed', amountAgorot: 10_000 });

    await move('unmark', { expectedFrom: 'paid' });
    expect(await moneyInputsHash()).toBe(before);
  });

  it('unmark returns a paid invoice to approved', async () => {
    await move('approve_for_payment', { expectedFrom: 'matched' });
    await move('mark_paid', { expectedFrom: 'approved' });
    const r = await move('unmark', { expectedFrom: 'paid' });
    expect(r).toMatchObject({ from: 'paid', to: 'approved' });
    expect(await invoiceStatus()).toBe('approved');
    expect((await invoiceAudits()).map((a) => a.action)).toEqual([
      'invoice.approved_for_payment',
      'invoice.marked_paid',
      'invoice.unmarked_paid',
    ]);
  });

  it('a double mark is ONE audit row; a stale screen gets CONFLICT', async () => {
    await move('approve_for_payment', { expectedFrom: 'matched' });
    await move('mark_paid', { expectedFrom: 'approved', payload: { paidOn: '2026-10-30' } });
    const again = await move('mark_paid', { expectedFrom: 'approved', payload: { paidOn: '2026-10-30' } });
    expect(again.replayed).toBe(true);
    expect((await invoiceAudits()).filter((a) => a.action === 'invoice.marked_paid')).toHaveLength(1);

    // Another device still shows "matched" and taps approve: the invoice is paid.
    const stale = await move('approve_for_payment', { expectedFrom: 'matched' }).catch((e: unknown) => e);
    expect(isTransitionConflict(stale)).toBe(true);
    expect((stale as { cause: { appParams: { currentStatus: string } } }).cause.appParams.currentStatus).toBe('paid');
    // A second mark with a different payment date is not a replay either.
    const other = await move('mark_paid', { expectedFrom: 'approved', payload: { paidOn: '2026-10-31' } }).catch((e: unknown) => e);
    expect(isTransitionConflict(other)).toBe(true);
    expect(await invoiceAudits()).toHaveLength(2);
    expect(await invoiceStatus()).toBe('paid');
  });

  it('a re-match never leaves approved/paid: match_completed → CONFLICT; rematch_lock records without moving', async () => {
    await move('approve_for_payment', { expectedFrom: 'matched' });
    const err = await move('match_completed', { to: 'matched' }).catch((e: unknown) => e);
    expect(isTransitionConflict(err)).toBe(true);
    const r = await move('rematch_lock', { payload: { matchRunId: A.matchRunId } });
    expect(r).toMatchObject({ from: 'approved', to: 'approved' });
    expect(await invoiceStatus()).toBe('approved');
    expect((await invoiceAudits()).map((a) => a.action)).toEqual(['invoice.approved_for_payment', 'invoice.rematch_locked']);
  });

  it('OCR and match events: ocr_pending → parsed → matched|disputed (the target is required)', async () => {
    await ownerDb.update(invoices).set({ status: 'ocr_pending' }).where(eq(invoices.id, A.invoiceId));
    await move('ocr_parsed', { expectedFrom: 'ocr_pending' });
    expect(await invoiceStatus()).toBe('parsed');
    const bad = await move('match_completed').catch((e: unknown) => e);
    expect((bad as { code?: string }).code).toBe('BAD_REQUEST');
    await move('match_completed', { to: 'disputed' });
    expect(await invoiceStatus()).toBe('disputed');
  });

  it('reocr (G-09): parsed|matched → ocr_pending only with no decision and no claim; refused otherwise, nothing written', async () => {
    // beforeEach: an accepted discrepancy with an open claim on this invoice.
    const claimed = await move('reocr', { expectedFrom: 'matched' }).catch((e: unknown) => e);
    expect(isTransitionRefused(claimed)).toBe(true);
    expect((claimed as { cause: { appParams: { reason: string } } }).cause.appParams.reason).toBe('invoice_has_claim');
    expect(resolveAppError(claimed as TRPCError)).toEqual({ appCode: 'lifecycle.refused', appParams: { reason: 'invoice_has_claim' } });
    await ownerDb.delete(recoveryClaims).where(eq(recoveryClaims.restaurantId, A.restaurantId));
    const decided = await move('reocr', { expectedFrom: 'matched' }).catch((e: unknown) => e);
    expect((decided as { cause: { appParams: { reason: string } } }).cause.appParams.reason).toBe('invoice_has_decision');
    expect(await invoiceStatus()).toBe('matched');
    expect(await invoiceAudits()).toHaveLength(0);

    await ownerDb.update(discrepancies).set({ resolutionStatus: 'open' }).where(eq(discrepancies.id, A.discrepancyId));
    const r = await move('reocr', { expectedFrom: 'matched', payload: { reason: 'page added' } });
    expect(r).toMatchObject({ from: 'matched', to: 'ocr_pending' });
    expect((await invoiceAudits()).map((a) => a.action)).toEqual(['invoice.reocr_requested']);
    // Batch path refuses with the same reason.
    await ownerDb.update(invoices).set({ status: 'parsed' }).where(eq(invoices.id, A.invoiceId));
    await ownerDb.update(discrepancies).set({ resolutionStatus: 'rejected' }).where(eq(discrepancies.id, A.discrepancyId));
    const b = await asTenant((tx) =>
      transitionMany(tx, invoiceMachine, {
        restaurantId: A.restaurantId,
        event: 'reocr',
        actorId: A.ownerUserId,
        items: [{ id: A.invoiceId, expectedStatus: 'parsed' }],
      }),
    );
    expect(b).toEqual({ ok: false, failures: [{ id: A.invoiceId, code: 'REFUSED', currentStatus: 'parsed', reason: 'invoice_has_decision' }] });
  });

  it('retire (G-09) is reserved until the invoice_status value exists: always refused, nothing written', async () => {
    await ownerDb.delete(recoveryClaims).where(eq(recoveryClaims.restaurantId, A.restaurantId));
    const err = await move('retire', { expectedFrom: 'matched', payload: { reason: 'absorbed', intoInvoiceId: A.invoiceId } }).catch(
      (e: unknown) => e,
    );
    expect(isTransitionRefused(err)).toBe(true);
    expect((err as { cause: { appParams: { reason: string } } }).cause.appParams.reason).toBe('reserved');
    expect(invoiceMachine.edges.retire).toMatchObject({ from: ['parsed', 'matched', 'disputed'], kind: 'terminal', requiresReason: true });
    expect(await invoiceStatus()).toBe('matched');
    expect(await invoiceAudits()).toHaveLength(0);
  });

  it.skipIf(!hasPaidAt)('H-03 path: mark_paid stamps invoices.paid_at with the event time; unmark clears it', async () => {
    const paidAt = async () =>
      ((await ownerDb.execute(sql`SELECT paid_at FROM invoices WHERE id = ${A.invoiceId}::uuid`)) as unknown as Array<{ paid_at: Date | null }>)[0]!
        .paid_at;
    await move('approve_for_payment', { expectedFrom: 'matched' });
    const at = new Date('2026-10-30T09:15:00Z');
    await move('mark_paid', { expectedFrom: 'approved', at });
    expect(new Date(await paidAt() as Date).toISOString()).toBe(at.toISOString());
    await move('unmark', { expectedFrom: 'paid' });
    expect(await paidAt()).toBeNull();
  });

  describe.skipIf(!hasPaymentFacts)('H-03 0072 payment facts (one statement, CHECK-safe)', () => {
    type Pay = { paid_at: Date | null; paid_amount: string | null; payment_method: string | null; payment_ref: string | null };
    const pay = async () =>
      ((await ownerDb.execute(
        sql`SELECT paid_at, paid_amount::text AS paid_amount, payment_method, payment_ref FROM invoices WHERE id = ${A.invoiceId}::uuid`,
      )) as unknown as Pay[])[0]!;
    const lastMarkAudit = async () => {
      const rows = await ownerDb
        .select({ action: auditLog.action, after: auditLog.after })
        .from(auditLog)
        .where(and(eq(auditLog.entityType, 'invoice'), eq(auditLog.entityId, A.invoiceId)));
      return rows.filter((r) => r.action === 'invoice.marked_paid' || r.action === 'invoice.external_sync').at(-1)?.after as
        | Record<string, unknown>
        | undefined;
    };

    it('a payload amount is parsed at the boundary (exact agorot) and written with paid_at, method and ref in one UPDATE', async () => {
      await move('approve_for_payment', { expectedFrom: 'matched' });
      const at = new Date('2026-10-30T22:00:00Z');
      await move('mark_paid', {
        expectedFrom: 'approved',
        at,
        payload: { paidAmount: '1,234.50', paymentMethod: 'bank_transfer', paymentRef: 'העברה 778' },
      });
      const p = await pay();
      expect(new Date(p.paid_at as Date).toISOString()).toBe(at.toISOString());
      expect(p).toMatchObject({ paid_amount: '1234.50', payment_method: 'bank_transfer', payment_ref: 'העברה 778' });
      expect(await lastMarkAudit()).toMatchObject({ paidAmount: '1234.50', paidAmountSource: 'payload' });
    });

    it("without a payload amount the invoice's own total incl. VAT is recorded, and the audit says so", async () => {
      await move('approve_for_payment', { expectedFrom: 'matched' });
      await move('mark_paid', { expectedFrom: 'approved' });
      expect(await pay()).toMatchObject({ paid_amount: '117.00', payment_method: null, payment_ref: null });
      expect(await lastMarkAudit()).toMatchObject({ paidAmount: '117.00', paidAmountSource: 'invoice_total' });
    });

    it('external_sync records the pair the same way', async () => {
      await move('external_sync', { expectedFrom: 'matched', payload: { paidAmount: 117, paymentMethod: 'offset' } });
      expect(await pay()).toMatchObject({ paid_amount: '117.00', payment_method: 'offset' });
    });

    it('an invalid method or amount is refused (BAD_REQUEST) and nothing moves', async () => {
      await move('approve_for_payment', { expectedFrom: 'matched' });
      const badMethod = await move('mark_paid', { expectedFrom: 'approved', payload: { paymentMethod: 'paypal' } }).catch((e: unknown) => e);
      expect((badMethod as { code?: string }).code).toBe('BAD_REQUEST');
      const badAmount = await move('mark_paid', { expectedFrom: 'approved', payload: { paidAmount: '12.345' } }).catch((e: unknown) => e);
      expect((badAmount as { code?: string }).code).toBe('BAD_REQUEST');
      expect(await invoiceStatus()).toBe('approved');
      expect(await pay()).toEqual({ paid_at: null, paid_amount: null, payment_method: null, payment_ref: null });
      expect((await invoiceAudits()).map((a) => a.action)).toEqual(['invoice.approved_for_payment']);
    });

    it('unmark clears all four payment facts together', async () => {
      await move('approve_for_payment', { expectedFrom: 'matched' });
      await move('mark_paid', { expectedFrom: 'approved', payload: { paidAmount: '100', paymentMethod: 'check', paymentRef: '#55' } });
      await move('unmark', { expectedFrom: 'paid' });
      expect(await invoiceStatus()).toBe('approved');
      expect(await pay()).toEqual({ paid_at: null, paid_amount: null, payment_method: null, payment_ref: null });
    });
  });
});
