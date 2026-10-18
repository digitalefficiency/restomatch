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
  isSubRecipe: boolean;
  yieldQty: string;
  yieldUnit: string;
  menuPriceAgorot: number | null;
  lines: CsvLine[];
}

export interface CsvError {
  row: number;
  code: 'missingColumn' | 'tooManyRows' | 'badQuantity' | 'badUnit' | 'badWaste' | 'badPrice' | 'badYield' | 'unknownIngredient' | 'empty';
  value?: string;
}

const MAX_ROWS = 2000;

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
    } else if (c === '"') quoted = true;
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
      r = { name, nameEn: null, category: null, isSubRecipe: false, yieldQty: '1', yieldUnit: 'מנה', menuPriceAgorot: null, lines: [] };
      byName.set(name.toLowerCase(), r);
    }
    current = r;
    if (raw.nameEn) r.nameEn = raw.nameEn;
    if (raw.category) r.category = raw.category;
    if (raw.sub) r.isSubRecipe = YES.has(raw.sub.toLowerCase());
    if (raw.yieldUnit) r.yieldUnit = raw.yieldUnit.slice(0, 32);
    if (raw.yieldQty) {
      if (!DEC.test(raw.yieldQty) || Number(raw.yieldQty) <= 0) errors.push({ row: rowNo, code: 'badYield', value: raw.yieldQty });
      else r.yieldQty = raw.yieldQty;
    }
    if (raw.price) {
      const clean = raw.price.replace(/[₪\s,]/g, '');
      if (!/^\d{1,7}(\.\d{1,2})?$/.test(clean)) errors.push({ row: rowNo, code: 'badPrice', value: raw.price });
      else r.menuPriceAgorot = Number(parseScaled(clean, 2));
    }
    if (!raw.ingredient) return; // a recipe-only row (e.g. just the price)
    if (!DEC.test(raw.quantity) || Number(raw.quantity) <= 0) { errors.push({ row: rowNo, code: 'badQuantity', value: raw.quantity }); return; }
    if (!raw.unit || raw.unit.length > 32) { errors.push({ row: rowNo, code: 'badUnit', value: raw.unit }); return; }
    const waste = raw.waste ? Number(raw.waste.replace('%', '')) : 0;
    if (!Number.isFinite(waste) || waste < 0 || waste > 95) { errors.push({ row: rowNo, code: 'badWaste', value: raw.waste }); return; }
    if (raw.unitsPer && (!DEC.test(raw.unitsPer) || Number(raw.unitsPer) <= 0)) { errors.push({ row: rowNo, code: 'badQuantity', value: raw.unitsPer }); return; }
    r.lines.push({
      row: rowNo,
      ingredient: raw.ingredient,
      quantity: raw.quantity,
      unit: raw.unit,
      wastePct: Math.round(waste * 100) / 100,
      unitsPerProductUnit: raw.unitsPer || null,
    });
  });
  return { recipes: [...byName.values()], errors };
}
