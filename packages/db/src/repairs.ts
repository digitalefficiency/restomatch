import type postgres from 'postgres';

/**
 * Data repairs that make the guarded migrations (0020, 0021, 0027) apply on a
 * real database. One source of truth for `scripts/repair-preconditions.ts` (the
 * owner-run tool, dry-run by default), `rehearse-cutover` and the upgrade-path
 * test. Each repair is idempotent and only touches the offending rows.
 *
 * They are written against the 0018 schema (production's level) and degrade to
 * no-ops on a database that is already past the relevant migration.
 */

type Sql = postgres.Sql<Record<string, unknown>> | postgres.TransactionSql<Record<string, unknown>>;

export interface RepairResult {
  name: string;
  changed: number;
  detail: string;
  /** Rows a human must handle — the repair refuses to guess. */
  blocking: number;
}

async function exists(sql: Sql, regclass: string): Promise<boolean> {
  const r = await sql`select to_regclass(${regclass}) is not null as e`;
  return Boolean(r[0]?.e);
}

/**
 * 0020 — NULL-tenant invoice_scans. Walk-in showcase rows (storage_path under
 * `walk-ins/`) are not tenant data: delete the mapping row. A NULL row OUTSIDE
 * walk-ins/ is attributed to its invoice's restaurant when the invoice exists;
 * anything else is reported as blocking (a human decides — docs/DB-RUNBOOK.md §3).
 */
export async function repairUnscopedScans(sql: Sql): Promise<RepairResult> {
  if (!(await exists(sql, 'public.invoice_scans'))) {
    return { name: '0020 unscoped invoice_scans', changed: 0, detail: 'no invoice_scans table', blocking: 0 };
  }
  const deleted = await sql`
    delete from invoice_scans where restaurant_id is null and storage_path like 'walk-ins/%' returning id`;
  const attributed = await sql`
    update invoice_scans sc set restaurant_id = i.restaurant_id
    from invoices i where sc.invoice_id::text = i.id::text and sc.restaurant_id is null
    returning sc.id`;
  const [left] = await sql`select count(*)::int as n from invoice_scans where restaurant_id is null`;
  return {
    name: '0020 unscoped invoice_scans',
    changed: deleted.length + attributed.length,
    detail: `deleted ${deleted.length} walk-in row(s), attributed ${attributed.length} row(s) to their invoice's restaurant`,
    blocking: Number(left?.n ?? 0),
  };
}

/**
 * 0021 — products whose supplier belongs to ANOTHER restaurant. Preferred fix is
 * `scripts/backfill-product-supplier.ts --apply` (re-points from provenance);
 * this is the documented last resort for whatever it leaves behind: detach the
 * foreign supplier (products.supplier_id is nullable by design).
 */
export async function repairCrossTenantProducts(sql: Sql): Promise<RepairResult> {
  const [col] = await sql`
    select 1 as e from information_schema.columns
    where table_schema = 'public' and table_name = 'products' and column_name = 'supplier_id'`;
  if (!col) return { name: '0021 cross-tenant products', changed: 0, detail: 'no products.supplier_id', blocking: 0 };
  const rows = await sql`
    update products p set supplier_id = null
    from suppliers s
    where p.supplier_id = s.id and s.restaurant_id <> p.restaurant_id
    returning p.id`;
  return {
    name: '0021 cross-tenant products',
    changed: rows.length,
    detail: `detached ${rows.length} product(s) from a foreign supplier`,
    blocking: 0,
  };
}

/**
 * 0027 — more than one goods receipt for the same PO. Keeps ONE receipt per
 * (restaurant, po): the one with the most lines, then the earliest. Match runs
 * that pointed at a removed duplicate are re-pointed to the kept receipt; the
 * duplicates (and their gr_lines, by cascade) are deleted. Merging lines would
 * re-create the double-counted quantity 0027 exists to prevent, so we don't.
 */
export async function repairDuplicateReceipts(sql: Sql): Promise<RepairResult> {
  if (!(await exists(sql, 'public.goods_receipts'))) {
    return { name: '0027 duplicate goods receipts', changed: 0, detail: 'no goods_receipts table', blocking: 0 };
  }
  const ranked = (await sql`
    with ranked as (
      select g.id, g.restaurant_id, g.po_id,
             row_number() over (
               partition by g.restaurant_id, g.po_id
               order by (select count(*) from gr_lines l where l.gr_id = g.id) desc, g.received_at asc, g.created_at asc, g.id
             ) as rn
      from goods_receipts g
      where g.po_id is not null
        and (g.restaurant_id, g.po_id) in (
          select restaurant_id, po_id from goods_receipts where po_id is not null
          group by 1, 2 having count(*) > 1)
    )
    select d.id as dup_id, k.id as keep_id
    from ranked d join ranked k on k.restaurant_id = d.restaurant_id and k.po_id = d.po_id and k.rn = 1
    where d.rn > 1`) as unknown as Array<{ dup_id: string; keep_id: string }>;
  if (ranked.length === 0) {
    return { name: '0027 duplicate goods receipts', changed: 0, detail: 'no PO has two receipts', blocking: 0 };
  }
  for (const r of ranked) {
    await sql`update match_runs set gr_id = ${r.keep_id} where gr_id = ${r.dup_id}`;
  }
  const ids = ranked.map((r) => r.dup_id);
  const deleted = await sql`delete from goods_receipts where id in ${sql(ids)} returning id`;
  return {
    name: '0027 duplicate goods receipts',
    changed: deleted.length,
    detail: `deleted ${deleted.length} duplicate receipt(s) (kept the fullest/earliest per PO, match runs re-pointed)`,
    blocking: 0,
  };
}

export async function repairAllPreconditions(sql: Sql): Promise<RepairResult[]> {
  return [
    await repairUnscopedScans(sql),
    await repairCrossTenantProducts(sql),
    await repairDuplicateReceipts(sql),
  ];
}
