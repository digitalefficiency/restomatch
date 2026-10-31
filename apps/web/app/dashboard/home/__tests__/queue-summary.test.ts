import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, discrepancies, eq, invoices, matchRuns, restaurants, suppliers, testDbUrl } from '@restomatch/db';
import { appRouter, type AppContext } from '@restomatch/api';
import { decideNeed } from '../queue-summary';

/**
 * "ממתין להחלטה שלך" — the approvals page is the single source of truth: the
 * home row is approvals.queueSummary (lib/claims rule, before VAT), mapped, never
 * a private Σ|Δ|. A no-PO arrival and a missing-on-invoice row are "לבדיקה (ללא ₪)";
 * a duplicate (incl. VAT) and a VAT mismatch are separate muted items.
 */
const db = createDb(testDbUrl());
const tag = `qs-${Date.now()}`;
let rid: string;

type Row = {
  type: 'PRICE_HIGHER' | 'PRICE_LOWER' | 'UNORDERED_ARRIVAL' | 'MISSING_ON_INVOICE' | 'DUPLICATE_INVOICE' | 'VAT_MISMATCH';
  severity: 'info' | 'warn' | 'block';
  deltaAmount: string;
  requiresRole: 'owner' | 'manager' | 'bookkeeper';
};

async function invoiceWith(supplierId: string, status: 'matched' | 'paid', total: string, rows: Row[]) {
  const [inv] = await db
    .insert(invoices)
    .values({ restaurantId: rid, supplierId, source: 'manual', invoiceNumber: `${tag}-${Math.random()}`, totalExclVat: total, totalInclVat: total, status })
    .returning();
  const [mr] = await db.insert(matchRuns).values({ restaurantId: rid, invoiceId: inv!.id, overallStatus: 'minor' }).returning();
  await db.insert(discrepancies).values(rows.map((r) => ({ restaurantId: rid, matchRunId: mr!.id, resolutionStatus: 'open' as const, ...r })));
}

beforeAll(async () => {
  const [r] = await db.insert(restaurants).values({ name: `Queue ${tag}` }).returning();
  rid = r!.id;
  const [s] = await db.insert(suppliers).values({ restaurantId: rid, name: 'ספק' }).returning();
  const sid = s!.id;
  await invoiceWith(sid, 'matched', '1180.00', [
    { type: 'PRICE_HIGHER', severity: 'warn', deltaAmount: '50.00', requiresRole: 'manager' },
    { type: 'MISSING_ON_INVOICE', severity: 'warn', deltaAmount: '30.00', requiresRole: 'manager' },
    { type: 'PRICE_HIGHER', severity: 'info', deltaAmount: '2.00', requiresRole: 'manager' },
  ]);
  // A no-PO arrival: Δ = the whole invoice incl. VAT — never claimable.
  await invoiceWith(sid, 'matched', '4130.00', [{ type: 'UNORDERED_ARRIVAL', severity: 'block', deltaAmount: '4130.00', requiresRole: 'owner' }]);
  await invoiceWith(sid, 'matched', '590.00', [{ type: 'DUPLICATE_INVOICE', severity: 'block', deltaAmount: '590.00', requiresRole: 'bookkeeper' }]);
  await invoiceWith(sid, 'matched', '1000.00', [{ type: 'VAT_MISMATCH', severity: 'warn', deltaAmount: '12.00', requiresRole: 'bookkeeper' }]);
  await invoiceWith(sid, 'paid', '800.00', [{ type: 'PRICE_HIGHER', severity: 'warn', deltaAmount: '40.00', requiresRole: 'manager' }]);
});

afterAll(async () => {
  await db.delete(restaurants).where(eq(restaurants.id, rid));
});

const callerFor = (role: 'owner' | 'manager' | 'bookkeeper') =>
  appRouter.createCaller({ db, session: { userId: crypto.randomUUID(), restaurantId: rid, role } } as unknown as AppContext);

describe('decideNeed — the home row is approvals.queueSummary', () => {
  it.each(['owner', 'manager', 'bookkeeper'] as const)('%s: ₪, count, blocking and the review/duplicate/VAT split equal the approvals tiles', async (role) => {
    const s = await callerFor(role).approvals.queueSummary();
    const need = decideNeed(s);
    expect(need).toEqual({
      count: s.count,
      amountIls: s.toDecide.amountIls,
      blocking: s.blockers,
      toReview: s.toReview.count,
      duplicateIls: s.duplicateIls,
      vatIls: s.vatIls,
    });
    expect(need.amountIls).toBe(s.claimableIls);
  });

  it('owner: the no-PO arrival and the duplicate never enter the before-VAT ₪ (not Σ|Δ|)', async () => {
    const need = decideNeed(await callerFor('owner').approvals.queueSummary());
    const naive = 50 + 30 + 2 + 4130 + 590 + 12 + 40;
    expect(need.count).toBe(7);
    expect(need.amountIls).toBeLessThan(4130);
    expect(need.amountIls).not.toBe(naive);
    expect(need.toReview).toBeGreaterThanOrEqual(3); // MISSING_ON_INVOICE, UNORDERED_ARRIVAL, info
    expect(need.duplicateIls).toBeGreaterThan(0);
    expect(need.blocking).toBe(2);
  });
});
