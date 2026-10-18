import { it } from 'vitest';
import { createDb, eq, sql, matchRuns, restaurants, type RestaurantSettings } from '@restomatch/db';
import { runMatch } from '@restomatch/matching';
import { buildMatchInputForInvoice } from '../match/buildMatchInput';

it('dev: rematch with contracts on vs off (read-only)', async () => {
  const db = createDb('postgres://postgres:postgres@localhost:5432/restomatch_dev');
  await db.transaction(async (tx) => {
    await tx.execute(sql`set transaction read only`);
    const [r] = await tx.select().from(restaurants).where(eq(restaurants.name, 'כפר הזיתים'));
    console.log('features', JSON.stringify((r!.settings as any)?.features));
    const runs = await tx.selectDistinct({ inv: matchRuns.invoiceId }).from(matchRuns).where(eq(matchRuns.restaurantId, r!.id));
    let on = 0, off = 0; const diffs: string[] = [];
    for (const { inv } of runs) {
      if (!inv) continue;
      const bOn = await buildMatchInputForInvoice(tx as any, r!.id, inv);
      const prev = process.env.FEATURES_OFF; process.env.FEATURES_OFF = 'contracts';
      const bOff = await buildMatchInputForInvoice(tx as any, r!.id, inv);
      if (prev === undefined) delete process.env.FEATURES_OFF; else process.env.FEATURES_OFF = prev;
      if (!bOn || !bOff) continue;
      const a = runMatch(bOn.input).totalDiscrepancyAmount, b = runMatch(bOff.input).totalDiscrepancyAmount;
      on += a; off += b; if (Math.round(a * 100) !== Math.round(b * 100)) { diffs.push(`${inv}:${b}->${a}`); console.log('PO', bOn.input.po?.id ?? (bOn.input as any).poId, JSON.stringify(bOff.input.poLines.map((l:any)=>[l.productId?.slice(0,6),l.unit,l.qtyOrdered,l.unitPriceExpected])), JSON.stringify(bOn.input.poLines.map((l:any)=>[l.productId?.slice(0,6),l.unit,l.unitPriceExpected]))); console.log('OFF', JSON.stringify(runMatch(bOff.input).discrepancies.map(d=>[d.type,d.expected,d.actual,d.deltaAmount]))); console.log('ON', JSON.stringify(runMatch(bOn.input).discrepancies.map(d=>[d.type,d.expected,d.actual,d.deltaAmount]))); }
    }
    console.log('invoices', runs.length, 'leak off', off.toFixed(2), 'on', on.toFixed(2), 'diffs', diffs);
  });
}, 120000);
