import { afterAll, describe, expect, it } from 'vitest';
import {
  createDb,
  discrepancies,
  eq,
  invoiceLines,
  invoices,
  matchRuns,
  restaurants,
  suppliers,
  testDbUrl,
} from '@restomatch/db';
import { computeLeakHero, computeMonthInvoiceLeaks } from '../leak-hero';
import { readClosedLeakMonth } from '../leak-report';

/** H-07: the per-invoice month leak is the hero leak, split by invoice, to the agora. */
const db = createDb(testDbUrl());
const ids: string[] = [];
afterAll(async () => {
  for (const id of ids) await db.delete(restaurants).where(eq(restaurants.id, id));
});

const NOW = new Date('2026-10-15T09:00:00Z');

async function setup() {
  const [r] = await db.insert(restaurants).values({ name: `h07 charts ${Date.now()}` }).returning();
  ids.push(r!.id);
  const [s] = await db.insert(suppliers).values({ restaurantId: r!.id, name: 'ספק' }).returning();
  const invoice = async (date: string, total: string, lines: [string, 'info' | 'warn' | 'block', string?][]) => {
    const [inv] = await db
      .insert(invoices)
      .values({
        restaurantId: r!.id,
        supplierId: s!.id,
        invoiceNumber: `C-${Math.random()}`,
        invoiceDate: new Date(date),
        createdAt: new Date(date),
        totalExclVat: total,
        vatAmount: '0',
        totalInclVat: total,
        status: 'matched',
        source: 'photo',
      })
      .returning();
    const [line] = await db
      .insert(invoiceLines)
      .values({ invoiceId: inv!.id, rawDescription: 'x', qtyBilled: '1', unit: 'יח', unitPriceBilled: total, lineTotal: total })
      .returning();
    const [mr] = await db
      .insert(matchRuns)
      .values({ restaurantId: r!.id, invoiceId: inv!.id, overallStatus: 'major', totalDiscrepancyAmount: '0' })
      .returning();
    for (const [delta, severity, type] of lines) {
      await db.insert(discrepancies).values({
        restaurantId: r!.id,
        matchRunId: mr!.id,
        type: (type ?? 'PRICE_HIGHER') as 'PRICE_HIGHER',
        severity,
        deltaAmount: delta,
        invoiceLineId: line!.id,
        resolutionStatus: 'open',
      });
    }
    return inv!.id;
  };
  return { restaurantId: r!.id, invoice };
}

describe('computeMonthInvoiceLeaks (H-07)', () => {
  it('Σ per invoice = the hero leak to the agora; same cap, filter and month', async () => {
    const t = await setup();
    const a = await t.invoice('2026-10-03T10:00:00Z', '1000', [['0.01', 'warn'], ['33.33', 'block'], ['5', 'info']]);
    const b = await t.invoice('2026-10-12T10:00:00Z', '10', [['8', 'warn'], ['8', 'warn']]); // capped at 10
    await t.invoice('2026-10-13T10:00:00Z', '100', [['4', 'warn', 'PRICE_LOWER']]); // not leak
    await t.invoice('2026-09-29T10:00:00Z', '100', [['99', 'warn']]); // last month
    const per = await computeMonthInvoiceLeaks(db, t.restaurantId, { now: NOW });
    const hero = await computeLeakHero(db, t.restaurantId, { now: NOW });
    expect(new Map(per.map((p) => [p.invoiceId, p.leakAgorot]))).toEqual(
      new Map([
        [a, 3334],
        [b, 1000],
      ]),
    );
    expect(per.reduce((s, p) => s + p.leakAgorot, 0)).toBe(Math.round(hero.leakIls * 100));
    const sep = await computeMonthInvoiceLeaks(db, t.restaurantId, { now: NOW, monthOffset: -1 });
    expect(sep.map((p) => p.leakAgorot)).toEqual([9900]);
  });

  it('readClosedLeakMonth: null for a month that is not closed', async () => {
    const t = await setup();
    expect(await readClosedLeakMonth(db, t.restaurantId, '2026-10')).toBeNull();
  });
});
