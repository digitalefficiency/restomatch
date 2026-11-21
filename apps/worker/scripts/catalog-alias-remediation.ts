/**
 * G-08 · catalog alias remediation report — READ ONLY.
 *
 * Prints product links that were probably GUESSED before the link policy
 * (catalog-01): price-list items linked to a pre-existing product with a name
 * similarity < 0.9, the aliases learned with them, and the draft/open POs and
 * open price alerts priced from them. CSV on stdout, a summary on stderr.
 *
 * It writes NOTHING: everything runs inside `SET TRANSACTION READ ONLY`, and
 * there is no unlink flag. Decision 24: a person confirms each unlink after the
 * pilot.
 *
 *   DATABASE_URL=... pnpm --filter @restomatch/worker exec tsx scripts/catalog-alias-remediation.ts [--restaurant <uuid>]...
 *
 * Without --restaurant it reports every restaurant (an operator run).
 */
import { createDb, restaurants, sql } from '@restomatch/db';
// One export line in @restomatch/api's index is frozen for wave 2; the report
// module is imported by path until W3-10 exposes it.
import {
  aliasRemediationReport,
  type AliasRemediationReport,
} from '../../../packages/api/src/catalog/remediation';
import { formatIlsAgorot } from '../../../packages/api/src/reports/money';

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(reports: AliasRemediationReport[]): string {
  const out = [
    ['kind', 'restaurant_id', 'id', 'item_id', 'supplier_id', 'product_id', 'name', 'canonical_name', 'detail', 'amount_ils'].join(','),
  ];
  for (const r of reports) {
    const itemById = new Map(r.items.map((i) => [i.itemId, i]));
    for (const i of r.items) {
      out.push(
        ['item', r.restaurantId, i.itemId, i.itemId, i.supplierId, i.productId, i.supplierNameRaw, i.canonicalName,
          `similarity=${i.similarity.toFixed(3)} import=${i.importId}`, ''].map(csvCell).join(','),
      );
    }
    for (const a of r.aliases) {
      const i = itemById.get(a.itemId);
      out.push(
        ['alias', r.restaurantId, a.aliasId, a.itemId, i?.supplierId, a.productId, a.supplierNameRaw, i?.canonicalName,
          `confidence=${a.confidence ?? ''} provenance=${a.provenance}`, ''].map(csvCell).join(','),
      );
    }
    for (const l of r.poLines) {
      const i = itemById.get(l.itemId);
      out.push(
        ['po_line', r.restaurantId, l.poLineId, l.itemId, i?.supplierId, l.productId, i?.supplierNameRaw, i?.canonicalName,
          `po=${l.poId} status=${l.poStatus} qty=${l.qtyOrdered} unit_price=${l.unitPriceExpected ?? ''}`,
          // ₪ formatted HERE only (display), from integer agorot.
          l.lineTotalAgorot == null ? '' : formatIlsAgorot(l.lineTotalAgorot, { maximumFractionDigits: 2 })].map(csvCell).join(','),
      );
    }
    for (const p of r.priceAlerts) {
      const i = itemById.get(p.itemId);
      out.push(
        ['price_alert', r.restaurantId, p.alertId, p.itemId, p.supplierId, p.productId, i?.supplierNameRaw, i?.canonicalName,
          `start=${p.startPrice} end=${p.endPrice} pct=${p.pctChange}`, ''].map(csvCell).join(','),
      );
    }
  }
  return out.join('\n');
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const argv = process.argv.slice(2);
  const wanted: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--restaurant' && argv[i + 1]) wanted.push(argv[++i]!);
    else throw new Error(`unknown argument: ${argv[i]} (only --restaurant <uuid>; this report never writes)`);
  }

  const db = createDb(url);
  const reports = await db.transaction(async (tx) => {
    // First statement of the transaction: nothing below can write.
    await tx.execute(sql`set transaction read only`);
    const ids = wanted.length > 0
      ? wanted
      : (await tx.select({ id: restaurants.id }).from(restaurants)).map((r) => r.id);
    const rs: AliasRemediationReport[] = [];
    for (const id of ids) rs.push(await aliasRemediationReport(tx as unknown as typeof db, id));
    return rs;
  });

  process.stdout.write(toCsv(reports) + '\n');
  const sum = (f: (r: AliasRemediationReport) => number) => reports.reduce((s, r) => s + f(r), 0);
  process.stderr.write(
    [
      `[catalog-alias-remediation] READ ONLY · ${reports.length} restaurant(s)`,
      `  suspect items:   ${sum((r) => r.items.length)}`,
      `  aliases:         ${sum((r) => r.aliases.length)}`,
      `  open PO lines:   ${sum((r) => r.poLines.length)} (${formatIlsAgorot(sum((r) => r.poExposureAgorot), { maximumFractionDigits: 2 })})`,
      `  open alerts:     ${sum((r) => r.priceAlerts.length)}`,
      '  Nothing was changed. Each unlink needs a person (decision 24, after the pilot).',
    ].join('\n') + '\n',
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
