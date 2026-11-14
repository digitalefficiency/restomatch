import { describe, expect, it } from 'vitest';
import { createDb, sql } from '@restomatch/db';
import { computeInvoiceLeak, computeInvoicesLeak, computeLeakBreakdown, computeLeakHero } from '../leak-hero';

/**
 * Pins the seeded lab demo ("כפר הזיתים" at DEMO_TODAY=2026-10-25): the hero
 * ₪759.54, ₪296.00 still stoppable before payment and ₪463.54 paid (to claim).
 * Read-only. Runs only where the wave-2 lab DB exists (`. ~/.rm-lab/<id>/env`
 * sets LAB_DATABASE_URL); CI has no seeded demo, so it skips there.
 */
const LAB = process.env.LAB_DATABASE_URL;
const NOW = new Date('2026-10-25T12:00:00+03:00');

describe.skipIf(!LAB)('lab demo pin (W2-09a: no ₪ change)', () => {
  it('hero ₪759.54 = ₪296.00 unpaid + ₪463.54 paid, and per-invoice leaks sum to it', async () => {
    const db = createDb(LAB!);
    {
      const res = (await db.execute(sql`
        select id from restaurants where name = 'כפר הזיתים' order by created_at limit 1`)) as unknown;
      const [main] = (Array.isArray(res) ? res : (res as { rows: unknown[] }).rows) as { id: string }[];
      expect(main).toBeTruthy();
      const hero = await computeLeakHero(db, main!.id, { now: NOW });
      expect(hero.leakIls).toBe(759.54);
      expect(hero.caughtBeforePaymentIls).toBe(296);
      expect(Math.round((hero.leakIls - hero.caughtBeforePaymentIls) * 100)).toBe(46354);

      const rows = await computeLeakBreakdown(db, main!.id, { now: NOW, limit: 200 });
      const sumAgorot = (xs: { leakIls: number }[]) => xs.reduce((a, r) => a + Math.round(r.leakIls * 100), 0);
      expect(sumAgorot(rows)).toBe(75954);

      const single = await Promise.all(rows.map((r) => computeInvoiceLeak(db, main!.id, r.invoiceId)));
      expect(single.map((s) => s?.leakIls)).toEqual(rows.map((r) => r.leakIls));

      const batch = await computeInvoicesLeak(db, main!.id, rows.map((r) => r.invoiceId));
      expect([...batch.values()]).toEqual(single);
      const unpaid = [...batch.values()].filter((v) => v.status !== 'paid');
      expect(sumAgorot(unpaid)).toBe(29600);
    }
  });
});
