import { unitConversionFactor } from '@restomatch/matching';
import { divRoundHalfAway } from './rounding';

/**
 * W3-10 · the item master's supplier comparison. Each supplier quotes in its
 * own unit ("ק״ג", "ליטר", "ארגז 12 יח׳"); the owner needs one comparable price.
 * Each offer is normalised to a base unit: ₪/kg (mass), ₪/l (volume) or
 * ₪/יח׳ (count). A unit we cannot read is "unclear" and stays out of the
 * ranking: a guessed conversion would invent a leak.
 *
 * Unit semantics (supplier_catalog_items): `listPrice` is the price of one
 * `unit`. For a pack unit (ארגז / קרטון / חבילה / pack / case) `packSize` is
 * the number of items in it; a mass/volume unit ignores `packSize`.
 */

export type BaseUnit = 'kg' | 'l' | 'unit';

export interface SupplierOffer {
  supplierId: string;
  /** price units (1/100 agorot) per one `unit`. */
  priceUnits: number;
  unit: string | null;
  packSize: number | null;
}

export interface NormalisedOffer extends SupplierOffer {
  status: 'ok' | 'unclear';
  baseUnit: BaseUnit | null;
  /** price units per base unit, half away from zero; null when unclear. */
  perBaseUnits: number | null;
  cheapest: boolean;
  /** (this − cheapest) / cheapest in basis points (1% = 100); null when unclear or no comparison. */
  gapBp: number | null;
}

export interface SupplierComparison {
  /** The base unit most ok offers share; offers in another dimension are marked unclear for this view. */
  baseUnit: BaseUnit | null;
  offers: NormalisedOffer[];
}

const COUNT_UNITS = new Set(['יח', 'יחידה', 'יחידות', 'unit', 'units', 'ea', 'each', 'pc', 'pcs', 'piece']);
const PACK_UNITS = new Set(['ארגז', 'קרטון', 'חבילה', 'מארז', 'pack', 'case', 'box', 'carton']);

function normUnit(u: string): string {
  return u.trim().toLowerCase().replace(/["'.\s׳״]/g, '');
}

/** How many base units one `unit` holds, as an exact ratio num/den; null when unreadable. */
function baseQty(unit: string | null, packSize: number | null): { base: BaseUnit; milli: bigint } | null {
  if (!unit) return null;
  const n = normUnit(unit);
  if (COUNT_UNITS.has(n)) return { base: 'unit', milli: 1000n };
  if (PACK_UNITS.has(n)) {
    if (packSize == null || !(packSize > 0)) return null;
    return { base: 'unit', milli: BigInt(Math.round(packSize * 1000)) };
  }
  const kg = unitConversionFactor(unit, 'kg');
  if (kg != null) return { base: 'kg', milli: BigInt(Math.round(kg * 1000)) };
  const l = unitConversionFactor(unit, 'l');
  if (l != null) return { base: 'l', milli: BigInt(Math.round(l * 1000)) };
  return null;
}

export function compareSuppliers(offers: SupplierOffer[]): SupplierComparison {
  const pre = offers.map((o) => {
    const q = baseQty(o.unit, o.packSize);
    if (!q || q.milli <= 0n || !Number.isInteger(o.priceUnits)) return { o, base: null, per: null };
    const per = Number(divRoundHalfAway(BigInt(o.priceUnits) * 1000n, q.milli));
    return { o, base: q.base, per };
  });
  const tally = new Map<BaseUnit, number>();
  for (const p of pre) if (p.base) tally.set(p.base, (tally.get(p.base) ?? 0) + 1);
  let baseUnit: BaseUnit | null = null;
  for (const b of ['kg', 'l', 'unit'] as BaseUnit[]) {
    if ((tally.get(b) ?? 0) > (baseUnit ? tally.get(baseUnit) ?? 0 : 0)) baseUnit = b;
  }
  const okPer = pre.filter((p) => p.base === baseUnit && p.per != null).map((p) => p.per as number);
  const min = okPer.length ? Math.min(...okPer) : null;
  const comparable = okPer.length >= 2;
  return {
    baseUnit,
    offers: pre.map(({ o, base, per }) => {
      const ok = base != null && base === baseUnit && per != null;
      return {
        ...o,
        status: ok ? 'ok' : 'unclear',
        baseUnit: ok ? base : null,
        perBaseUnits: ok ? per : null,
        cheapest: ok && comparable && per === min,
        gapBp:
          ok && comparable && min != null && min > 0
            ? Number(divRoundHalfAway(BigInt((per as number) - min) * 10000n, BigInt(min)))
            : null,
      };
    }),
  };
}
