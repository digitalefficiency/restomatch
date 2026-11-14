import type { CatalogColumnMapping } from '@restomatch/db';
import { parseMoneyCell } from '../lib/parseMoneyCell';
import { autoDetectMapping } from './parse';

/**
 * W3-10 · header-row and sheet auto-detection for "ייבוא מחירון". Supplier
 * files often open with a logo, an address block or a date before the real
 * header, and a workbook may hold a cover sheet before the price list. These
 * pure helpers find the header row and the sheet; the column mapping itself is
 * still `autoDetectMapping` (one definition of what a header means).
 */

export type Grid = string[][];

export interface HeaderGuess {
  /** 0-based row index of the header inside the grid. */
  headerIndex: number;
  headers: string[];
  mapping: CatalogColumnMapping;
  /** Number of canonical fields the header maps (name and price weigh double). */
  score: number;
  /** Rows under the header whose price cell reads as one unambiguous amount. */
  pricedRows: number;
}

export interface SheetInput {
  name: string;
  grid: Grid;
}

export interface SheetGuess extends HeaderGuess {
  sheetName: string;
}

/** Rows scanned from the top when looking for the header. */
export const HEADER_SCAN_ROWS = 20;

function scoreMapping(m: CatalogColumnMapping): number {
  let s = 0;
  for (const [field, col] of Object.entries(m)) {
    if (!col) continue;
    s += field === 'name' || field === 'price' ? 2 : 1;
  }
  return s;
}

function cleanRow(row: string[]): string[] {
  return row.map((c) => (c ?? '').toString().trim());
}

/**
 * The header is the first row (within the scan window) that maps both a name
 * and a price column, preferring the highest score; ties go to the earliest
 * row. Returns null when no row maps both — the UI then asks the user.
 */
export function detectHeaderRow(grid: Grid, scanRows = HEADER_SCAN_ROWS): HeaderGuess | null {
  let best: HeaderGuess | null = null;
  const limit = Math.min(grid.length, scanRows);
  for (let i = 0; i < limit; i += 1) {
    const headers = cleanRow(grid[i] ?? []);
    const nonEmpty = headers.filter(Boolean);
    if (nonEmpty.length < 2) continue;
    // A row of numbers is data, never a header.
    if (nonEmpty.every((h) => parseMoneyCell(h).kind === 'ok')) continue;
    const mapping = autoDetectMapping(nonEmpty);
    if (!mapping.name || !mapping.price) continue;
    const score = scoreMapping(mapping);
    if (best && score <= best.score) continue;
    best = { headerIndex: i, headers, mapping, score, pricedRows: countPricedRows(grid, i, headers, mapping) };
  }
  return best;
}

function countPricedRows(grid: Grid, headerIndex: number, headers: string[], mapping: CatalogColumnMapping): number {
  const col = mapping.price ? headers.indexOf(mapping.price) : -1;
  if (col < 0) return 0;
  let n = 0;
  for (let r = headerIndex + 1; r < grid.length; r += 1) {
    const cell = grid[r]?.[col];
    if (cell != null && String(cell).trim() !== '' && parseMoneyCell(String(cell)).kind === 'ok') n += 1;
  }
  return n;
}

/**
 * Picks the sheet that most looks like a price list: the most priced rows,
 * then the best header score, then the earliest sheet. Null when no sheet has
 * a usable header.
 */
export function pickSheet(sheets: SheetInput[]): SheetGuess | null {
  let best: SheetGuess | null = null;
  for (const sheet of sheets) {
    const guess = detectHeaderRow(sheet.grid);
    if (!guess) continue;
    if (
      !best ||
      guess.pricedRows > best.pricedRows ||
      (guess.pricedRows === best.pricedRows && guess.score > best.score)
    ) {
      best = { ...guess, sheetName: sheet.name };
    }
  }
  return best;
}
