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

/**
 * Strict, locale-safe price cell (₪ and spaces ignored). Accepted:
 *   "1250" · "12.5" · "1,250" / "12,345,678" (comma = thousands, groups of 3)
 *   "1,234.50" (comma thousands + dot decimals) · "12,5" / "1,25" (comma decimal, 1–2 digits)
 * Everything else is rejected rather than reinterpreted: exponents ("1e3"),
 * accounting negatives ("(5)"), "1.250,5", "1,2345", signs.
 */
export function parsePriceCell(raw: string | null): number | null {
  if (raw == null) return null;
  const s = raw.replace(/[₪\s\u00a0]/g, '');
  let norm: string | null = null;
  if (/^\d+(?:\.\d+)?$/.test(s)) norm = s;
  else if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(s)) norm = s.replace(/,/g, '');
  else if (/^\d+,\d{1,2}$/.test(s)) norm = s.replace(',', '.');
  if (norm === null) return null;
  const n = Number(norm);
  return Number.isFinite(n) ? n : null;
}

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
}

/**
 * Resolve each row to one of the restaurant's products and upsert the contract
 * price on (supplier, product, valid_from). Product resolution, in order: the
 * supplier's catalog item by SKU → exact canonical
 * name (spaces/case-insensitive) → the supplier's catalog item by raw name.
 * Unknown products are reported, never created (a contract on a product the
 * restaurant doesn't buy is meaningless). Caller asserts supplier ownership.
 */
export async function commitContractRows(
  db: Database,
  args: { restaurantId: string; supplierId: string; userId: string | null; defaultValidFrom: string; defaultValidTo: string | null },
  rows: ContractImportRow[],
): Promise<ContractCommitResult> {
  const { restaurantId, supplierId } = args;
  const result: ContractCommitResult = { created: 0, updated: 0, skipped: [] };

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

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const label = r.name ?? r.supplierSku ?? `#${i + 1}`;
    if (r.invalid) {
      result.skipped.push({ row: i + 2, label, reason: r.invalid });
      continue;
    }
    const productId =
      (r.supplierSku && bySku.get(r.supplierSku)) ||
      (r.name && (prodByName.get(key(r.name)) ?? byCatName.get(key(r.name)))) ||
      null;
    if (!productId) {
      result.skipped.push({ row: i + 2, label, reason: 'NO_PRODUCT' });
      continue;
    }
    if (r.price == null || !(r.price > 0) || r.price > 10_000_000) {
      result.skipped.push({ row: i + 2, label, reason: 'NO_PRICE' });
      continue;
    }
    const validFrom = r.validFrom ?? args.defaultValidFrom;
    const validTo = r.validTo ?? args.defaultValidTo;
    if (!validFrom) {
      result.skipped.push({ row: i + 2, label, reason: 'NO_DATE' });
      continue;
    }
    if (validTo && validTo < validFrom) {
      result.skipped.push({ row: i + 2, label, reason: 'BAD_RANGE' });
      continue;
    }
    const [row] = await db
      .insert(supplierContractPrices)
      .values({
        restaurantId,
        supplierId,
        productId,
        unit: r.unit,
        contractPrice: r.price.toFixed(4),
        validFrom,
        validTo,
        source: 'import',
        createdBy: args.userId,
      })
      .onConflictDoUpdate({
        target: [supplierContractPrices.supplierId, supplierContractPrices.productId, supplierContractPrices.validFrom],
        set: {
          contractPrice: r.price.toFixed(4),
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
