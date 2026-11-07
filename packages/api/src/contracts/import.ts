import {
  and,
  eq,
  products,
  sql,
  supplierCatalogItems,
  supplierContractPrices,
  type Database,
} from '@restomatch/db';
import type { ParsedTable } from '../catalog/parse';
import { parsePriceCell } from '../lib/parseMoneyCell';
import { contractInForce } from './core';

/** Column mapping for a contract price-list upload. */
export interface ContractColumnMapping {
  sku?: string;
  name?: string;
  unit?: string;
  price?: string;
  validFrom?: string;
  validTo?: string;
}

export interface ContractImportRow {
  supplierSku: string | null;
  name: string | null;
  unit: string | null;
  price: number | null;
  validFrom: string | null;
  validTo: string | null;
  /** A cell was present but unusable — the row is reported, never guessed. */
  invalid?: 'NO_PRICE' | 'NO_DATE' | 'BAD_UNIT';
}

/** The strict price-cell parser now lives in lib/parseMoneyCell (shared with the catalog import). */
export { parsePriceCell };

/** A unit fits varchar(32) and can't be a spreadsheet formula. */
const UNIT_OK = (u: string): boolean => u.length <= 32 && !/^[=+\-@]/.test(u);

const norm = (h: string): string =>
  h.toLowerCase().replace(/["'״׳`_\-]/g, '').replace(/\s+/g, '').trim();

const KEYWORDS: Record<keyof ContractColumnMapping, string[]> = {
  validFrom: ['מתאריך', 'בתוקףמ', 'תוקףמ', 'החלמ', 'validfrom', 'from', 'start', 'effective'],
  validTo: ['עדתאריך', 'בתוקףעד', 'תוקףעד', 'validto', 'until', 'to', 'end', 'expires'],
  sku: ['מקט', 'sku', 'קוד', 'itemcode', 'code'],
  name: ['תיאור', 'שם', 'פריט', 'מוצר', 'description', 'name', 'item', 'product'],
  unit: ['יחידה', 'יח', 'unit', 'uom'],
  price: ['מחירחוזה', 'מחיר', 'contractprice', 'price', 'עלות', 'cost'],
};
const CODE_HINTS = ['קוד', 'מקט', 'sku', 'code'];

/** Best-effort header → field auto-mapping (Hebrew + English). */
export function autoDetectContractMapping(headers: string[]): ContractColumnMapping {
  const mapping: ContractColumnMapping = {};
  const taken = new Set<string>();
  // Dates first: "בתוקף מ" must not be read as a name/price column.
  const order: Array<keyof ContractColumnMapping> = ['validFrom', 'validTo', 'sku', 'price', 'name', 'unit'];
  for (const field of order) {
    for (const h of headers) {
      if (taken.has(h)) continue;
      const n = norm(h);
      if (field === 'name' && CODE_HINTS.some((k) => n.includes(k))) continue;
      const hit =
        field === 'validTo' || field === 'validFrom'
          ? KEYWORDS[field].some((k) => (k.length <= 4 ? n === k : n.includes(k)))
          : KEYWORDS[field].some((k) => n.includes(k));
      if (hit) {
        mapping[field] = h;
        taken.add(h);
        break;
      }
    }
  }
  return mapping;
}

/**
 * Parse a date cell: ISO (2026-10-01 / 2026-10-01T…), or Israeli D/M/YYYY,
 * D.M.YYYY, D-M-YYYY (2-digit years → 20YY). Returns YYYY-MM-DD or null.
 */
export function parseDateCell(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(s);
  const il = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(s);
  if (iso) {
    [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (il) {
    [d, m, y] = [Number(il[1]), Number(il[2]), Number(il[3])];
    if (y < 100) y += 2000;
  } else {
    return null;
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Project a parsed table onto contract rows. */
export function extractContractRows(table: ParsedTable, mapping: ContractColumnMapping): ContractImportRow[] {
  const get = (row: Record<string, string>, h?: string): string | null => {
    if (!h) return null;
    const v = row[h];
    if (v == null) return null;
    const t = String(v).trim();
    return t === '' ? null : t;
  };
  const out: ContractImportRow[] = [];
  for (const row of table.rows) {
    const sku = get(row, mapping.sku);
    const name = get(row, mapping.name);
    if (!sku && !name) continue;
    const unit = get(row, mapping.unit);
    const rawPrice = get(row, mapping.price);
    const rawFrom = get(row, mapping.validFrom);
    const rawTo = get(row, mapping.validTo);
    const price = parsePriceCell(rawPrice);
    const validFrom = parseDateCell(rawFrom);
    const validTo = parseDateCell(rawTo);
    const invalid =
      unit != null && !UNIT_OK(unit)
        ? ('BAD_UNIT' as const)
        : rawPrice != null && price == null
          ? ('NO_PRICE' as const)
          : (rawFrom != null && validFrom == null) || (rawTo != null && validTo == null)
            ? ('NO_DATE' as const)
            : undefined;
    out.push({ supplierSku: sku, name, unit, price, validFrom, validTo, ...(invalid ? { invalid } : {}) });
  }
  return out;
}

export interface ContractCommitResult {
  created: number;
  updated: number;
  /** Rows that could not be applied, with a stable reason code for the UI. */
  skipped: Array<{ row: number; label: string; reason: 'NO_PRODUCT' | 'NO_PRICE' | 'NO_DATE' | 'BAD_RANGE' | 'BAD_UNIT' }>;
  /** Rows the person excluded in the diff step (never written). */
  excluded: number;
}

/** Resolves an import row to one of the restaurant's products (SKU → name → catalog name). */
type ProductResolver = (r: ContractImportRow) => string | null;

/**
 * Build the row → product resolver. Product resolution, in order: the
 * supplier's catalog item by SKU → exact canonical name (spaces/case-insensitive)
 * → the supplier's catalog item by raw name. Unknown products are reported,
 * never created (a contract on a product the restaurant doesn't buy is
 * meaningless).
 */
async function productResolver(db: Database, restaurantId: string, supplierId: string): Promise<ProductResolver> {
  const catalog = await db
    .select({
      sku: supplierCatalogItems.supplierSku,
      name: supplierCatalogItems.supplierNameRaw,
      productId: supplierCatalogItems.productId,
    })
    .from(supplierCatalogItems)
    .where(and(eq(supplierCatalogItems.restaurantId, restaurantId), eq(supplierCatalogItems.supplierId, supplierId)));
  const prods = await db
    .select({ id: products.id, name: products.canonicalName, supplierId: products.supplierId })
    .from(products)
    .where(eq(products.restaurantId, restaurantId));

  const key = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  const bySku = new Map<string, string>();
  const byCatName = new Map<string, string>();
  for (const c of catalog) {
    if (!c.productId) continue;
    if (c.sku) bySku.set(c.sku.trim(), c.productId);
    byCatName.set(key(c.name), c.productId);
  }
  const prodByName = new Map<string, string>();
  // The supplier's own products win a name/SKU tie over other suppliers' products.
  for (const p of [...prods].sort((a, b) => Number(a.supplierId === supplierId) - Number(b.supplierId === supplierId))) {
    prodByName.set(key(p.name), p.id);
  }
  return (r) =>
    (r.supplierSku && bySku.get(r.supplierSku)) ||
    (r.name && (prodByName.get(key(r.name)) ?? byCatName.get(key(r.name)))) ||
    null;
}

type SkipReason = ContractCommitResult['skipped'][number]['reason'];

/** The checks every row passes before it can be written (shared by the diff and the commit). */
function rowProblem(
  r: ContractImportRow,
  productId: string | null,
  validFrom: string | null,
  validTo: string | null,
): SkipReason | null {
  if (r.invalid) return r.invalid;
  if (!productId) return 'NO_PRODUCT';
  if (r.price == null || !(Math.round(r.price * 10_000) >= 1) || r.price > 10_000_000) return 'NO_PRICE';
  if (!validFrom) return 'NO_DATE';
  if (validTo && validTo < validFrom) return 'BAD_RANGE';
  return null;
}

/** The spreadsheet row number of import row `i` (header = row 1). Stable id for exclude. */
export const importRowId = (i: number): number => i + 2;

/**
 * Resolve each row to one of the restaurant's products and upsert the contract
 * price on (supplier, product, valid_from). Rows whose id is in `excludeRowIds`
 * are not written (the diff step's per-row exclude). Caller asserts supplier
 * ownership.
 */
export async function commitContractRows(
  db: Database,
  args: {
    restaurantId: string;
    supplierId: string;
    userId: string | null;
    defaultValidFrom: string;
    defaultValidTo: string | null;
    excludeRowIds?: number[];
  },
  rows: ContractImportRow[],
): Promise<ContractCommitResult> {
  const { restaurantId, supplierId } = args;
  const result: ContractCommitResult = { created: 0, updated: 0, skipped: [], excluded: 0 };
  const resolve = await productResolver(db, restaurantId, supplierId);
  const exclude = new Set(args.excludeRowIds ?? []);

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (exclude.has(importRowId(i))) {
      result.excluded += 1;
      continue;
    }
    const label = r.name ?? r.supplierSku ?? `#${i + 1}`;
    const productId = r.invalid ? null : resolve(r);
    const validFrom = r.validFrom ?? args.defaultValidFrom;
    const validTo = r.validTo ?? args.defaultValidTo;
    const problem = rowProblem(r, productId, validFrom, validTo);
    if (problem) {
      result.skipped.push({ row: importRowId(i), label, reason: problem });
      continue;
    }
    const price = r.price!;
    const [row] = await db
      .insert(supplierContractPrices)
      .values({
        restaurantId,
        supplierId,
        productId: productId!,
        unit: r.unit,
        contractPrice: price.toFixed(4),
        validFrom,
        validTo,
        source: 'import',
        createdBy: args.userId,
      })
      .onConflictDoUpdate({
        target: [supplierContractPrices.supplierId, supplierContractPrices.productId, supplierContractPrices.validFrom],
        set: {
          contractPrice: price.toFixed(4),
          unit: r.unit,
          validTo,
          source: 'import',
        },
      })
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    if (row?.inserted) result.created += 1;
    else result.updated += 1;
  }
  return result;
}

export type DiffChip = 'up' | 'down' | 'new' | 'same' | 'unmatched' | 'invalid';

export interface ContractDiffRow {
  rowId: number;
  label: string;
  chip: DiffChip;
  productId: string | null;
  productName: string | null;
  productNameEn: string | null;
  unit: string | null;
  /** The contract price in force on the row's valid-from (null = none / not resolved). */
  currentPrice: number | null;
  /** Parsed new price (null when the cell is missing or unparseable). */
  newPrice: number | null;
  /** (new − current) ÷ current, 4 dp; null without a current price. */
  deltaPct: number | null;
  /** ≈ ₪/month the change moves at the last 90 days' qty (new − current) × qty ÷ 3, agorot; signed. */
  monthlyAgorot: number | null;
  validFrom: string | null;
  reason?: SkipReason;
}

/**
 * The "בדיקה" step: what a commit WOULD write, row by row, against the
 * contract in force today — no writes. Unparseable / unresolved rows are held
 * out ('invalid' / 'unmatched') and are never written by the commit either.
 */
export async function diffContractRows(
  db: Database,
  args: { restaurantId: string; supplierId: string; defaultValidFrom: string; defaultValidTo: string | null; qty90?: Map<string, number> },
  rows: ContractImportRow[],
): Promise<{ rows: ContractDiffRow[]; counts: Record<DiffChip, number>; monthlyAgorot: number; writable: number }> {
  const { restaurantId, supplierId } = args;
  const resolve = await productResolver(db, restaurantId, supplierId);
  const prods = await db
    .select({ id: products.id, name: products.canonicalName, nameEn: products.nameEn, unit: products.defaultUnit })
    .from(products)
    .where(eq(products.restaurantId, restaurantId));
  const prodById = new Map(prods.map((p) => [p.id, p]));
  const contracts = await db
    .select({
      id: supplierContractPrices.id,
      supplierId: supplierContractPrices.supplierId,
      productId: supplierContractPrices.productId,
      unit: supplierContractPrices.unit,
      contractPrice: supplierContractPrices.contractPrice,
      validFrom: supplierContractPrices.validFrom,
      validTo: supplierContractPrices.validTo,
    })
    .from(supplierContractPrices)
    .where(and(eq(supplierContractPrices.restaurantId, restaurantId), eq(supplierContractPrices.supplierId, supplierId)));

  const counts: Record<DiffChip, number> = { up: 0, down: 0, new: 0, same: 0, unmatched: 0, invalid: 0 };
  const out: ContractDiffRow[] = [];
  let monthly = 0;
  let writable = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const label = r.name ?? r.supplierSku ?? `#${i + 1}`;
    const productId = r.invalid ? null : resolve(r);
    const validFrom = r.validFrom ?? args.defaultValidFrom;
    const validTo = r.validTo ?? args.defaultValidTo;
    const problem = rowProblem(r, productId, validFrom, validTo);
    const p = productId ? prodById.get(productId) : undefined;
    const base: ContractDiffRow = {
      rowId: importRowId(i),
      label,
      chip: 'invalid',
      productId,
      productName: p?.name ?? null,
      productNameEn: p?.nameEn ?? null,
      unit: r.unit ?? p?.unit ?? null,
      currentPrice: null,
      newPrice: r.price,
      deltaPct: null,
      monthlyAgorot: null,
      validFrom,
    };
    if (problem) {
      const chip: DiffChip = problem === 'NO_PRODUCT' ? 'unmatched' : 'invalid';
      counts[chip] += 1;
      out.push({ ...base, chip, reason: problem });
      continue;
    }
    writable += 1;
    const own = contracts.filter((c) => c.productId === productId);
    const current = contractInForce(own, validFrom!);
    const newUnits = Math.round(r.price! * 10_000);
    if (!current) {
      counts.new += 1;
      out.push({ ...base, chip: 'new' });
      continue;
    }
    const curUnits = Math.round(Number(current.contractPrice) * 10_000);
    const chip: DiffChip = newUnits > curUnits ? 'up' : newUnits < curUnits ? 'down' : 'same';
    counts[chip] += 1;
    const qty = args.qty90?.get(productId!) ?? 0;
    const qtyMilli = Math.round(qty * 1000);
    const deltaUnits = newUnits - curUnits;
    // Signed half-up (away from zero on .5) in agorot: Δunits × qtyMilli / (100 × 1000 × 3).
    const raw = (deltaUnits * qtyMilli) / 300_000;
    const m = Math.sign(raw) * Math.round(Math.abs(raw));
    monthly += m;
    out.push({
      ...base,
      chip,
      currentPrice: curUnits / 10_000,
      deltaPct: curUnits > 0 ? Math.round((deltaUnits / curUnits) * 10_000) / 10_000 : null,
      monthlyAgorot: qty > 0 ? m : null,
    });
  }
  return { rows: out, counts, monthlyAgorot: monthly, writable };
}
