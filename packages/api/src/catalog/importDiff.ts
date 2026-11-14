import { normalizeLinkName } from '@restomatch/catalog';
import { priceUnitsTimesQtyToAgorot } from './rounding';

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
}

export interface IncomingCatalogRow {
  /** Line in the file as the user sees it. */
  rowNumber: number;
  supplierSku: string | null;
  name: string;
  /** Parsed price in price units; null when the cell could not be read unambiguously. */
  priceUnits: number | null;
}

export type DiffKind = 'up' | 'down' | 'same' | 'new' | 'unclear' | 'missing';
export type UnclearReason = 'NO_PRICE' | 'DUPLICATE_IN_FILE' | 'NO_NAME';

export interface DiffLine {
  kind: DiffKind;
  /** The incoming file line; null for a `missing` line (it is not in the file). */
  rowNumber: number | null;
  currentId: string | null;
  supplierSku: string | null;
  name: string;
  beforeUnits: number | null;
  afterUnits: number | null;
  /** after − before, price units; null unless both sides have a price. */
  deltaUnits: number | null;
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
    const key = skuKey(row.supplierSku) ?? (nk ? `name:${nk}` : null);
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
    const match = (row.supplierSku ? bySku.get(key) : undefined) ?? (nk ? byName.get(nk) : undefined);
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
