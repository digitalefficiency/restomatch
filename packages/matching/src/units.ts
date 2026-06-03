interface UnitDef {
  dim: 'mass' | 'volume';
  /** value_in_base = value × factor (base: gram for mass, ml for volume). */
  factor: number;
}

const UNIT_MAP: Record<string, UnitDef> = {
  // mass (base: gram)
  mg: { dim: 'mass', factor: 0.001 },
  g: { dim: 'mass', factor: 1 },
  gr: { dim: 'mass', factor: 1 },
  גרם: { dim: 'mass', factor: 1 },
  kg: { dim: 'mass', factor: 1000 },
  קג: { dim: 'mass', factor: 1000 },
  קילו: { dim: 'mass', factor: 1000 },
  // volume (base: ml)
  ml: { dim: 'volume', factor: 1 },
  מל: { dim: 'volume', factor: 1 },
  cl: { dim: 'volume', factor: 10 },
  l: { dim: 'volume', factor: 1000 },
  ליטר: { dim: 'volume', factor: 1000 },
};

function norm(unit: string): string {
  return unit.trim().toLowerCase().replace(/["'.\s]/g, '');
}

/**
 * Quantity multiplier to convert `from` → `to` (qty_to = qty_from × factor),
 * or null when the units are unknown or in different dimensions.
 * Prices convert inversely (price_to = price_from / factor).
 */
export function unitConversionFactor(from: string, to: string): number | null {
  const f = UNIT_MAP[norm(from)];
  const t = UNIT_MAP[norm(to)];
  if (!f || !t || f.dim !== t.dim) return null;
  return f.factor / t.factor;
}

export function areConvertible(a: string, b: string): boolean {
  return unitConversionFactor(a, b) !== null;
}
