import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, discrepancies, invoices, matchRuns, recoveryClaims, restaurants, sql, testDbUrl } from '@restomatch/db';
// Read-only use of the immutable numbers-canary builders and the real engine.
import { runMatch } from '../../../matching/src/engine';
import { grLine, input, invoiceHeader, invoiceLine, poLine } from '../../../matching/src/__tests__/fixtures';
import { automationKpis, computeFoundAgorot } from '../automation';
import { computeLeakHero } from '../leak-hero';

/**
 * AC 5 (money truth): the funnel's "found" IS the hero's leak, to the agora, on
 * the canary scenarios and on a seeded month. One leak definition: AU-07 never
 * re-derives or subtracts anything; MISSING_ON_INVOICE leaves the leak only
 * through LEAK_FILTER itself (#211), and whatever it does moves both sides equally.
 */

const db = createDb(testDbUrl());
async function resetDb() {
  await db.execute(sql`TRUNCATE restaurants, users CASCADE`);
}
beforeEach(resetDb);
afterAll(resetDb);

// Sat 31.10.2026 14:00 in Israel. With weeks=4 the Israel weeks are Sun 4.10, 11.10, 18.10, 25.10
// and the last one ends Sun 1.11 00:00 = the month's end, so the 4 weeks tile 4.10–31.10 exactly.
const NOW = new Date('2026-10-31T12:00:00Z');

type Finding = { type: (typeof discrepancies.$inferInsert)['type']; severity: 'info' | 'warn' | 'block'; delta: string; status?: 'open' | 'accepted' | 'rejected' };

async function seed() {
  const [r] = await db.insert(restaurants).values({ name: 'Parity' }).returning();
  const rid = r!.id;
  async function invoice(date: string, total: string, findings: Finding[]) {
    const [inv] = await db
      .insert(invoices)
      .values({ restaurantId: rid, invoiceDate: new Date(date), createdAt: new Date(date), totalExclVat: total, vatAmount: '0', totalInclVat: total, status: 'matched', source: 'email' })
      .returning();
    const [mr] = await db.insert(matchRuns).values({ restaurantId: rid, invoiceId: inv!.id, overallStatus: 'major' }).returning();
    const ids: string[] = [];
    for (const f of findings) {
      const [d] = await db
        .insert(discrepancies)
        .values({ restaurantId: rid, matchRunId: mr!.id, type: f.type, severity: f.severity, deltaAmount: f.delta, resolutionStatus: f.status ?? 'open' })
        .returning();
      ids.push(d!.id);
    }
    return { invoiceId: inv!.id, ids };
  }
  return { rid, invoice };
}

/** Engine output → stored findings (delta is the engine's ₪ amount, 2 dp). */
function engineFindings(out: ReturnType<typeof runMatch>): Finding[] {
  return out.discrepancies.map((d) => ({
    type: d.type as Finding['type'],
    severity: d.severity as Finding['severity'],
    delta: (Math.round(Math.abs(d.deltaAmount ?? 0) * 100) / 100).toFixed(2),
  }));
}

async function sides(rid: string) {
  const hero = await computeLeakHero(db, rid, { now: NOW });
  const k = await automationKpis(db, rid, { weeks: 4, now: NOW });
  expect(k.weeks[0]!.weekStart).toBe('2026-10-03T21:00:00.000Z');
  expect(k.weeks[3]!.weekEnd).toBe(hero.monthEnd);
  const weeklyFound = k.weeks.reduce((s, w) => s + w.funnelAgorot.found, 0);
  const windowFound = await computeFoundAgorot(db, rid, { from: new Date(hero.monthStart), to: new Date(hero.monthEnd) });
  return { heroAgorot: Math.round(hero.leakIls * 100), weeklyFound, windowFound, k };
}

describe('AU-07 parity: Σ found = owner.leakHero, exactly, in agorot', () => {
  it('canary headline (₪32.00) + a 4-decimal unit-price scenario through the real engine', async () => {
    const po = poLine({ id: 'po-canary', qtyOrdered: 10, unitPriceExpected: 8.0 });
    const headline = runMatch(
      input({
        poLines: [po],
        grLines: [grLine({ poLineId: po.id, qtyReceived: 8 })],
        invoiceLines: [invoiceLine({ productId: po.productId, qtyBilled: 8, unitPriceBilled: 10.0, lineTotal: 80 })],
        invoice: invoiceHeader({ totalExclVat: 80, vatAmount: 13.6, totalInclVat: 93.6 }),
      }),
    );
    expect(Math.round(headline.totalDiscrepancyAmount * 100)).toBe(3200);

    const po2 = poLine({ id: 'po-4dp', qtyOrdered: 3, unitPriceExpected: 4.1234 });
    const rounding = runMatch(
      input({
        poLines: [po2],
        grLines: [grLine({ poLineId: po2.id, qtyReceived: 3 })],
        invoiceLines: [invoiceLine({ productId: po2.productId, qtyBilled: 3, unitPriceBilled: 6, lineTotal: 18 })],
        invoice: invoiceHeader({ totalExclVat: 18, vatAmount: 3.06, totalInclVat: 21.06 }),
      }),
    );

    const s = await seed();
    await s.invoice('2026-10-06T08:00:00Z', '93.60', engineFindings(headline));
    await s.invoice('2026-10-20T08:00:00Z', '21.06', engineFindings(rounding));

    const { heroAgorot, weeklyFound, windowFound } = await sides(s.rid);
    expect(heroAgorot).toBeGreaterThanOrEqual(3200);
    expect(weeklyFound).toBe(heroAgorot);
    expect(windowFound).toBe(heroAgorot);
  });

  it('a seeded month: caps, info/PRICE_LOWER/UNORDERED out, a rejected duplicate out; MISSING_ON_INVOICE moves both sides equally', async () => {
    const s = await seed();
    await s.invoice('2026-10-05T08:00:00Z', '100.00', [
      { type: 'PRICE_HIGHER', severity: 'block', delta: '80.00' },
      { type: 'QTY_SHORT', severity: 'warn', delta: '45.55' }, // capped at 100.00
    ]);
    await s.invoice('2026-10-13T08:00:00Z', '500.00', [
      { type: 'PRICE_LOWER', severity: 'warn', delta: '12.00' },
      { type: 'UNORDERED_ARRIVAL', severity: 'warn', delta: '30.00' },
      { type: 'QTY_OVER', severity: 'info', delta: '9.99' },
      { type: 'DUPLICATE_INVOICE', severity: 'block', delta: '500.00', status: 'rejected' },
      { type: 'TOTAL_MISMATCH', severity: 'warn', delta: '0.37' },
    ]);
    const before = await sides(s.rid);
    expect(before.weeklyFound).toBe(before.heroAgorot);
    expect(before.heroAgorot).toBe(10037);

    await s.invoice('2026-10-27T08:00:00Z', '400.00', [{ type: 'MISSING_ON_INVOICE', severity: 'warn', delta: '25.10' }]);
    const after = await sides(s.rid);
    expect(after.weeklyFound).toBe(after.heroAgorot);
    expect(after.windowFound).toBe(after.heroAgorot);
    // One definition: whatever LEAK_FILTER does with MISSING_ON_INVOICE (₪0 once #211 is on main), both sides move together.
    expect(after.weeklyFound - before.weeklyFound).toBe(after.heroAgorot - before.heroAgorot);
  });

  it('claimed = Σ recovery_claims.amount_agorot; the claimable share never includes PRICE_LOWER, UNORDERED_ARRIVAL or MISSING_ON_INVOICE', async () => {
    const s = await seed();
    const accepted = new Date('2026-10-14T09:00:00Z');
    const { invoiceId, ids } = await s.invoice('2026-10-12T08:00:00Z', '1000.00', [
      { type: 'PRICE_HIGHER', severity: 'warn', delta: '11.11', status: 'accepted' },
      { type: 'PRICE_LOWER', severity: 'warn', delta: '22.22', status: 'accepted' },
      { type: 'UNORDERED_ARRIVAL', severity: 'warn', delta: '33.33', status: 'accepted' },
      { type: 'MISSING_ON_INVOICE', severity: 'warn', delta: '44.44', status: 'accepted' },
    ]);
    await db.execute(sql`UPDATE discrepancies SET resolved_at = ${accepted.toISOString()}::timestamptz WHERE restaurant_id = ${s.rid}`);
    await db.insert(recoveryClaims).values([
      { restaurantId: s.rid, discrepancyId: ids[0]!, invoiceId, amountAgorot: 1111, claimedAt: accepted },
    ]);
    const { k } = await sides(s.rid);
    const decided = k.weeks.reduce((x, w) => x + w.funnelAgorot.decided, 0);
    const claimed = k.weeks.reduce((x, w) => x + w.funnelAgorot.claimed, 0);
    expect(decided).toBe(1111);
    const rows = (await db.execute(
      sql`SELECT COALESCE(SUM(amount_agorot), 0)::bigint AS total FROM recovery_claims WHERE restaurant_id = ${s.rid}`,
    )) as unknown as Array<{ total: string }>;
    expect(claimed).toBe(Number(rows[0]!.total));
  });
});
