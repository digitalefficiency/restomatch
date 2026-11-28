import { normalizeLinkName } from '@restomatch/catalog';
import { unitConversionFactor } from '@restomatch/matching';
import { sameUnit } from '../lib/unitPrice';
import { divRoundHalfAway, priceUnitsTimesQtyToAgorot, qtyToMilli } from './rounding';

/**
 * W3-10 · "מה ישתנה" — the preview step of one "ייבוא מחירון", computed before
 * anything is written. Pure: the caller loads the supplier's current catalog
 * rows (with the last-30-days quantity bought) and the parsed incoming rows.
 *
 * Money is integer throughout: prices in price units (1/100 agorot, NUMERIC
 * 12,4), impact in agorot. The ₪/month impact of a price change is
 * Δprice × monthly quantity, rounded once (half away from zero).
 */

export interface CurrentCatalogRow {
  id: string;
  supplierSku: string | null;
  name: string;
  /** Current list price in price units; null when the row has no price yet. */
  priceUnits: number | null;
  /** Quantity bought in the last 30 days, in this row's unit (0 when unknown). */
  monthlyQty: number;
  active: boolean;
  /** The row's unit and pack (numeric(12,3) string; null = a pack of 1) — the basis its price is in. */
  unit?: string | null;
  packSize?: string | null;
}

export interface IncomingCatalogRow {
  /** Line in the file as the user sees it. */
  rowNumber: number;
  supplierSku: string | null;
  name: string;
  /** Parsed price in price units; null when the cell could not be read unambiguously. */
  priceUnits: number | null;
  /**
   * The current row the commit will write (W3-10 revert merge): when given, it
   * replaces the diff's own matching, so the preview and the commit agree row
   * for row. null = the commit creates a new row. Omitted = match here.
   */
  matchId?: string | null;
  /** The unit / pack the commit will store (storedBasis). Omitted = the current row's basis. */
  unit?: string | null;
  packSize?: string | null;
}

export type DiffKind = 'up' | 'down' | 'same' | 'new' | 'unclear' | 'missing';
/** BASIS_NOT_COMPARABLE: the unit / pack changes to one the old price cannot be restated in (a case → kg). */
export type UnclearReason = 'NO_PRICE' | 'DUPLICATE_IN_FILE' | 'NO_NAME' | 'BASIS_NOT_COMPARABLE';

export interface DiffLine {
  kind: DiffKind;
  /** The incoming file line; null for a `missing` line (it is not in the file). */
  rowNumber: number | null;
  currentId: string | null;
  supplierSku: string | null;
  name: string;
  beforeUnits: number | null;
  afterUnits: number | null;
  /** after − before, price units (on the new basis when it changes); null unless both sides have a price. */
  deltaUnits: number | null;
  /** The unit / pack changes: before is restated on the new basis for the delta and the ₪/month. */
  basisChanged?: boolean;
  /** Signed ₪/month in agorot (+ = we pay more); 0 when no quantity history. */
  monthlyImpactAgorot: number;
  unclearReason?: UnclearReason;
}

export interface ImportDiff {
  lines: DiffLine[];
  counts: Record<DiffKind, number>;
  /** Σ of positive monthly impacts (agorot). */
  upAgorot: number;
  /** Σ of negative monthly impacts, as a positive number (agorot). */
  downAgorot: number;
  /** upAgorot − downAgorot. */
  netAgorot: number;
}

const ORDER: Record<DiffKind, number> = { up: 0, down: 1, unclear: 2, missing: 3, new: 4, same: 5 };

function skuKey(sku: string | null): string | null {
  const s = sku?.trim();
  return s ? `sku:${s}` : null; // exact after trim, as commit.ts matches SKUs
}

/**
 * Builds the preview. Matching: by SKU when the incoming row has one, else by
 * `normalizeLinkName` (G-08's one name key; SQL twin `normNameSql`). A current
 * active row the file does not mention becomes
 * `missing` (suggested for disabling — never disabled automatically).
 */
export function buildImportDiff(current: CurrentCatalogRow[], incoming: IncomingCatalogRow[]): ImportDiff {
  const bySku = new Map<string, CurrentCatalogRow>();
  const byName = new Map<string, CurrentCatalogRow>();
  const byId = new Map(current.map((c) => [c.id, c]));
  for (const c of current) {
    const k = skuKey(c.supplierSku);
    if (k && !bySku.has(k)) bySku.set(k, c);
    const n = normalizeLinkName(c.name);
    if (n && !byName.has(n)) byName.set(n, c);
  }

  const seenKeys = new Set<string>();
  const touched = new Set<string>();
  const lines: DiffLine[] = [];

  for (const row of incoming) {
    const nk = normalizeLinkName(row.name);
    const key = row.matchId ? `id:${row.matchId}` : (skuKey(row.supplierSku) ?? (nk ? `name:${nk}` : null));
    const base = {
      rowNumber: row.rowNumber,
      supplierSku: row.supplierSku,
      name: row.name.trim(),
      afterUnits: row.priceUnits,
      monthlyImpactAgorot: 0,
    };
    if (!key) {
      lines.push({ ...base, kind: 'unclear', currentId: null, beforeUnits: null, deltaUnits: null, unclearReason: 'NO_NAME' });
      continue;
    }
    const match =
      row.matchId !== undefined
        ? (row.matchId ? byId.get(row.matchId) : undefined)
        : ((row.supplierSku ? bySku.get(key) : undefined) ?? (nk ? byName.get(nk) : undefined));
    if (seenKeys.has(key)) {
      lines.push({
        ...base,
        kind: 'unclear',
        currentId: match?.id ?? null,
        beforeUnits: match?.priceUnits ?? null,
        deltaUnits: null,
        unclearReason: 'DUPLICATE_IN_FILE',
      });
      continue;
    }
    seenKeys.add(key);
    if (match) touched.add(match.id);

    if (row.priceUnits == null) {
      lines.push({
        ...base,
        kind: 'unclear',
        currentId: match?.id ?? null,
        beforeUnits: match?.priceUnits ?? null,
        deltaUnits: null,
        unclearReason: 'NO_PRICE',
      });
      continue;
    }
    if (!match) {
      lines.push({ ...base, kind: 'new', currentId: null, beforeUnits: null, deltaUnits: null });
      continue;
    }
    if (match.priceUnits == null) {
      lines.push({ ...base, kind: 'new', currentId: match.id, beforeUnits: null, deltaUnits: null });
      continue;
    }
    const basis = basisChange(match, row);
    if (basis === 'NOT_COMPARABLE') {
      lines.push({
        ...base,
        kind: 'unclear',
        currentId: match.id,
        beforeUnits: match.priceUnits,
        deltaUnits: null,
        basisChanged: true,
        unclearReason: 'BASIS_NOT_COMPARABLE',
      });
      continue;
    }
    if (basis) {
      // On the new basis: the same physical quantity, priced before and after.
      const { a0, a1 } = basis;
      const num = BigInt(row.priceUnits) * a0 - BigInt(match.priceUnits) * a1;
      const restatedDelta = Number(divRoundHalfAway(num, a0));
      const impact = Number(divRoundHalfAway(num * qtyToMilli(Math.max(0, match.monthlyQty)), a1 * 1000n * 100n));
      lines.push({
        ...base,
        // The kind follows the exact difference, like the ₪ does: 'same' ⇔ ₪0
        // (a gap below the rounding of deltaUnits still moves money).
        kind: num > 0n ? 'up' : num < 0n ? 'down' : 'same',
        currentId: match.id,
        beforeUnits: match.priceUnits,
        deltaUnits: restatedDelta,
        basisChanged: true,
        monthlyImpactAgorot: impact,
      });
      continue;
    }
    const delta = row.priceUnits - match.priceUnits;
    const impact = delta === 0 ? 0 : priceUnitsTimesQtyToAgorot(delta, Math.max(0, match.monthlyQty));
    lines.push({
      ...base,
      kind: delta > 0 ? 'up' : delta < 0 ? 'down' : 'same',
      currentId: match.id,
      beforeUnits: match.priceUnits,
      deltaUnits: delta,
      monthlyImpactAgorot: impact,
    });
  }

  for (const c of current) {
    if (!c.active || touched.has(c.id)) continue;
    lines.push({
      kind: 'missing',
      rowNumber: null,
      currentId: c.id,
      supplierSku: c.supplierSku,
      name: c.name,
      beforeUnits: c.priceUnits,
      afterUnits: null,
      deltaUnits: null,
      monthlyImpactAgorot: 0,
    });
  }

  lines.sort(
    (a, b) =>
      ORDER[a.kind] - ORDER[b.kind] ||
      Math.abs(b.monthlyImpactAgorot) - Math.abs(a.monthlyImpactAgorot) ||
      (a.rowNumber ?? Number.MAX_SAFE_INTEGER) - (b.rowNumber ?? Number.MAX_SAFE_INTEGER) ||
      a.name.localeCompare(b.name, 'he'),
  );

  const counts: Record<DiffKind, number> = { up: 0, down: 0, same: 0, new: 0, unclear: 0, missing: 0 };
  let upAgorot = 0;
  let downAgorot = 0;
  for (const l of lines) {
    counts[l.kind] += 1;
    if (l.monthlyImpactAgorot > 0) upAgorot += l.monthlyImpactAgorot;
    else downAgorot -= l.monthlyImpactAgorot;
  }
  return { lines, counts, upAgorot, downAgorot, netAgorot: upAgorot - downAgorot };
}

/** A pack (numeric string, null = 1) in thousandths. */
const packMilli = (p: string | null | undefined): bigint => (p == null ? 1000n : BigInt(Math.round(Number(p) * 1000)));

/**
 * Does the row's basis change, and how do the two priced units compare? null:
 * the same basis. Otherwise a0 / a1 are the physical amount in one old / new
 * priced unit on one common integer scale (pack in thousandths × the unit
 * ratio held exactly as num / den — every UNIT_MAP ratio is a power of ten),
 * so `qty_new = qty_old × a0 / a1` and `price_old_on_new = price_old × a1 / a0`.
 * NOT_COMPARABLE: no restatement exists (unknown units, a case → kg) or the
 * basis is degenerate (a pack of 0) — never a zero divisor, never a throw.
 */
function basisChange(cur: CurrentCatalogRow, row: IncomingCatalogRow): { a0: bigint; a1: bigint } | null | 'NOT_COMPARABLE' {
  if (row.unit === undefined && row.packSize === undefined) return null;
  const u0 = cur.unit ?? null;
  const u1 = row.unit === undefined ? u0 : row.unit;
  const k0 = packMilli(cur.packSize);
  const k1 = packMilli(row.packSize === undefined ? cur.packSize : row.packSize);
  let num = 1n;
  let den = 1n;
  if (u0 == null || u1 == null ? u0 === u1 : sameUnit(u0, u1)) {
    if (k0 === k1) return null;
  } else {
    const f = u0 && u1 ? unitConversionFactor(u0, u1) : null; // qty_u1 = qty_u0 × f
    if (f == null || !(f > 0)) return 'NOT_COMPARABLE';
    // Exact rational: f ≥ 1 → f / 1, else 1 / (1 / f) (mg → kg = 1 / 1,000,000).
    if (f >= 1) num = BigInt(Math.round(f));
    else den = BigInt(Math.round(1 / f));
  }
  const a0 = k0 * num;
  const a1 = k1 * den;
  if (a0 <= 0n || a1 <= 0n) return 'NOT_COMPARABLE';
  return { a0, a1 };
}
