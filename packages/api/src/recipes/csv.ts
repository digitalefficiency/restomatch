import { parseScaled } from './cost';

/**
 * Recipe CSV import — one row per ingredient line, recipe columns repeated (or
 * left blank after the first row of a recipe). Header names are accepted in
 * English or Hebrew:
 *
 *   recipe | מנה            (required) dish / sub-recipe name
 *   ingredient | רכיב       (required) product name (Hebrew or English) or a sub-recipe name
 *   quantity | כמות         (required) net quantity, e.g. 180 or 0.18
 *   unit | יחידה            (required) e.g. גרם, ק״ג, ml, יח׳
 *   waste_pct | פחת         optional, 0–95
 *   menu_price | מחיר       optional, ₪ incl. VAT (e.g. 68 or 68.50)
 *   yield_qty | תפוקה       optional, default 1
 *   yield_unit | יחידת תפוקה optional, default מנה
 *   sub_recipe | תת מתכון   optional, yes/כן/1 marks a sauce/dough
 *   name_en | שם באנגלית    optional
 *   category | קטגוריה      optional
 *   units_per_product_unit | יחידות ליחידת מוצר   optional bridge (tray = 30 eggs)
 */

export interface CsvLine {
  row: number;
  ingredient: string;
  quantity: string;
  unit: string;
  wastePct: number;
  unitsPerProductUnit: string | null;
}

export interface CsvRecipe {
  name: string;
  nameEn: string | null;
  category: string | null;
  /** null = the CSV did not say (a replace keeps the existing value). */
  isSubRecipe: boolean | null;
  yieldQty: string;
  yieldUnit: string;
  menuPriceAgorot: number | null;
  lines: CsvLine[];
}

export interface CsvError {
  row: number;
  code:
    | 'missingColumn' | 'tooManyRows' | 'badQuantity' | 'badUnit' | 'badWaste' | 'badPrice' | 'badYield'
    | 'unknownIngredient' | 'empty' | 'tooLong' | 'tooManyLines' | 'subRecipeCycle' | 'subRecipeInUse';
  value?: string;
}

const MAX_ROWS = 2000;
/** Mirrors the save procedure's zod limits so a dry run that passes also commits. */
export const CSV_LIMITS = { name: 120, nameEn: 120, category: 60, lines: 80, maxPriceAgorot: 10_000_000 } as const;

const HEADERS: Record<string, keyof RawRow> = {
  recipe: 'recipe', dish: 'recipe', מנה: 'recipe', מתכון: 'recipe',
  ingredient: 'ingredient', product: 'ingredient', רכיב: 'ingredient', מוצר: 'ingredient',
  quantity: 'quantity', qty: 'quantity', כמות: 'quantity',
  unit: 'unit', יחידה: 'unit',
  waste_pct: 'waste', waste: 'waste', פחת: 'waste',
  menu_price: 'price', price: 'price', מחיר: 'price',
  yield_qty: 'yieldQty', yield: 'yieldQty', תפוקה: 'yieldQty',
  yield_unit: 'yieldUnit', 'יחידת תפוקה': 'yieldUnit',
  sub_recipe: 'sub', 'תת מתכון': 'sub', 'תת-מתכון': 'sub',
  name_en: 'nameEn', 'שם באנגלית': 'nameEn',
  category: 'category', קטגוריה: 'category',
  units_per_product_unit: 'unitsPer', 'יחידות ליחידת מוצר': 'unitsPer',
};

interface RawRow {
  recipe: string; ingredient: string; quantity: string; unit: string; waste: string; price: string;
  yieldQty: string; yieldUnit: string; sub: string; nameEn: string; category: string; unitsPer: string;
}

/** RFC-4180-ish CSV: quoted fields, doubled quotes, CRLF/LF, optional BOM. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

const DEC = /^\d{1,8}(\.\d{1,4})?$/;
/** ₪ amount: "68", "68.50", "1,250.00" (comma ONLY as a thousands separator). */
const PRICE = /^(\d{1,7}|\d{1,3}(,\d{3}){1,2})(\.\d{1,2})?$/;
/** Waste %: 0–95 with ≤ 2 decimals (no hex / exponent forms). */
const WASTE = /^\d{1,2}(\.\d{1,2})?%?$/;
const YES = new Set(['yes', 'y', 'true', '1', 'כן', 'v', '✓']);

export function parseRecipeCsv(text: string): { recipes: CsvRecipe[]; errors: CsvError[]; fatal?: CsvError } {
  const rows = parseCsvRows(text);
  if (rows.length < 2) return { recipes: [], errors: [], fatal: { row: 1, code: 'empty' } };
  if (rows.length - 1 > MAX_ROWS) return { recipes: [], errors: [], fatal: { row: MAX_ROWS + 2, code: 'tooManyRows' } };
  const header = rows[0]!.map((h) => HEADERS[h.trim().toLowerCase()] ?? null);
  for (const req of ['recipe', 'ingredient', 'quantity', 'unit'] as const) {
    if (!header.includes(req)) return { recipes: [], errors: [], fatal: { row: 1, code: 'missingColumn', value: req } };
  }
  const errors: CsvError[] = [];
  const byName = new Map<string, CsvRecipe>();
  let current: CsvRecipe | null = null;
  rows.slice(1).forEach((cells, i) => {
    const rowNo = i + 2;
    const raw = {} as RawRow;
    header.forEach((h, k) => { if (h) raw[h] = (cells[k] ?? '').trim(); });
    const name = raw.recipe || current?.name || '';
    if (!name) { errors.push({ row: rowNo, code: 'empty' }); return; }
    let r = byName.get(name.toLowerCase());
    if (!r) {
      if (name.length > CSV_LIMITS.name) { errors.push({ row: rowNo, code: 'tooLong', value: name.slice(0, 40) }); return; }
      r = { name, nameEn: null, category: null, isSubRecipe: null, yieldQty: '1', yieldUnit: 'מנה', menuPriceAgorot: null, lines: [] };
      byName.set(name.toLowerCase(), r);
    }
    current = r;
    if (raw.nameEn) {
      if (raw.nameEn.length > CSV_LIMITS.nameEn) errors.push({ row: rowNo, code: 'tooLong', value: raw.nameEn.slice(0, 40) });
      else r.nameEn = raw.nameEn;
    }
    if (raw.category) {
      if (raw.category.length > CSV_LIMITS.category) errors.push({ row: rowNo, code: 'tooLong', value: raw.category.slice(0, 40) });
      else r.category = raw.category;
    }
    if (raw.sub) r.isSubRecipe = YES.has(raw.sub.toLowerCase());
    if (raw.yieldUnit) r.yieldUnit = raw.yieldUnit.slice(0, 32);
    if (raw.yieldQty) {
      if (!DEC.test(raw.yieldQty) || Number(raw.yieldQty) <= 0) errors.push({ row: rowNo, code: 'badYield', value: raw.yieldQty });
      else r.yieldQty = raw.yieldQty;
    }
    if (raw.price) {
      const clean = raw.price.replace(/[₪\s]/g, '');
      const agorot = PRICE.test(clean) ? Number(parseScaled(clean.replace(/,/g, ''), 2)) : NaN;
      if (!Number.isFinite(agorot) || agorot > CSV_LIMITS.maxPriceAgorot) errors.push({ row: rowNo, code: 'badPrice', value: raw.price });
      else r.menuPriceAgorot = agorot;
    }
    if (!raw.ingredient) return; // a recipe-only row (e.g. just the price)
    if (!DEC.test(raw.quantity) || Number(raw.quantity) <= 0) { errors.push({ row: rowNo, code: 'badQuantity', value: raw.quantity }); return; }
    if (!raw.unit || raw.unit.length > 32) { errors.push({ row: rowNo, code: 'badUnit', value: raw.unit }); return; }
    if (raw.waste && !WASTE.test(raw.waste)) { errors.push({ row: rowNo, code: 'badWaste', value: raw.waste }); return; }
    const waste = raw.waste ? Number(raw.waste.replace('%', '')) : 0;
    if (waste > 95) { errors.push({ row: rowNo, code: 'badWaste', value: raw.waste }); return; }
    if (raw.unitsPer && (!DEC.test(raw.unitsPer) || Number(raw.unitsPer) <= 0)) { errors.push({ row: rowNo, code: 'badQuantity', value: raw.unitsPer }); return; }
    if (r.lines.length >= CSV_LIMITS.lines) { errors.push({ row: rowNo, code: 'tooManyLines', value: r.name.slice(0, 40) }); return; }
    r.lines.push({
      row: rowNo,
      ingredient: raw.ingredient,
      quantity: raw.quantity,
      unit: raw.unit,
      wastePct: waste,
      unitsPerProductUnit: raw.unitsPer || null,
    });
  });
  return { recipes: [...byName.values()], errors };
}
