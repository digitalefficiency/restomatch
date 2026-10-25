/**
 * Deterministic lab rows for the desk primitives (no DB): 500 invoice-like rows
 * with a seeded PRNG, so the server and the client build the same set and
 * Playwright can assert exact values. Money is integer agorot.
 */

export type LabSeverity = 'block' | 'warn' | 'none';
export type LabStatus = 'open' | 'approved' | 'held';

export interface LabRow {
  id: string;
  supplierHe: string;
  supplierEn: string;
  number: string;
  /** Epoch ms (Asia/Jerusalem noon) — sorts as a number. */
  date: number;
  totalAgorot: number;
  /** Δ between billed and expected; Σ|Δ| is the at-risk ₪ a batch moves. */
  deltaAgorot: number;
  severity: LabSeverity;
  status: LabStatus;
  /** A row whose Δ could not be computed yet (pending OCR) — renders the `pending` cell state. */
  pendingDelta: boolean;
}

export const LAB_ROW_COUNT = 500;

const SUPPLIERS: [string, string][] = [
  ['ירקני אבי', 'Avi Greengrocer'],
  ['קצביית הכרם', 'HaKerem Butchery'],
  ['משקאות שטיינברג', 'Steinberg Beverages'],
  ['מאפיית הגליל', 'Galilee Bakery'],
  ['תנובה', 'Tnuva'],
  ['דגי ים כנרת', 'Kinneret Fish'],
  ['שמן זית הגולן', 'Golan Olive Oil'],
  ['תבלינים אלמוג — סיטונאות וייבוא ישיר לבתי עסק', 'Almog Spices — wholesale and direct import'],
  ['מחלבות גד', 'Gad Dairies'],
  ['פירות הערבה', 'Arava Fruit'],
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 2026-10-25 12:00 Asia/Jerusalem (UTC+2 in late October). */
const LAB_TODAY = Date.UTC(2026, 9, 25, 10, 0, 0);
const DAY = 86_400_000;

let cache: LabRow[] | null = null;

export function labRows(): LabRow[] {
  if (cache) return cache;
  const rnd = mulberry32(20261025);
  const rows: LabRow[] = [];
  for (let i = 0; i < LAB_ROW_COUNT; i++) {
    const [he, en] = SUPPLIERS[Math.floor(rnd() * SUPPLIERS.length)]!;
    const total = Math.round(20_000 + rnd() * 1_800_000); // ₪200 – ₪18,200
    const r = rnd();
    const severity: LabSeverity = r < 0.08 ? 'block' : r < 0.35 ? 'warn' : 'none';
    const delta =
      severity === 'none' ? 0 : Math.round((severity === 'block' ? 15_000 : 500) + rnd() * (severity === 'block' ? 60_000 : 30_000));
    const s = rnd();
    rows.push({
      id: `inv-${String(i + 1).padStart(3, '0')}`,
      supplierHe: he,
      supplierEn: en,
      number: `HK-${24_000 + Math.floor(rnd() * 9_000)}`,
      date: LAB_TODAY - Math.floor(rnd() * 55) * DAY,
      totalAgorot: total,
      deltaAgorot: rnd() < 0.5 ? delta : -delta,
      severity,
      status: s < 0.7 ? 'open' : s < 0.9 ? 'approved' : 'held',
      pendingDelta: severity === 'none' && rnd() < 0.04,
    });
  }
  cache = rows;
  return rows;
}

export const LAB_VIEWS = ['all', 'block', 'warn', 'open'] as const;
export type LabView = (typeof LAB_VIEWS)[number];

export function inView(row: LabRow, view: LabView): boolean {
  if (view === 'block') return row.severity === 'block';
  if (view === 'warn') return row.severity === 'warn';
  if (view === 'open') return row.status === 'open';
  return true;
}

/** "Server" totals for a view: the count and Σ|Δ| over every row, never a page. */
export function viewTotals(rows: readonly LabRow[], view: LabView): { count: number; sumAgorot: number } {
  let count = 0;
  let sumAgorot = 0;
  for (const r of rows) {
    if (!inView(r, view)) continue;
    count++;
    sumAgorot += Math.abs(r.deltaAgorot);
  }
  return { count, sumAgorot };
}
