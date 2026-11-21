/**
 * Pre-created by G-14 for W3-09 (order coverage; co-owned by matching-engine-guardian).
 * W3-09 fills the computation; the `index.ts` export line lands with G-14's slice b.
 * Any ₪ it returns goes through the METRICS registry (metrics.ts) as `{metric, agorot}`.
 */
export interface CoverageRow {
  supplierId: string;
  /** Filled by W3-09. */
  [k: string]: unknown;
}

export interface Coverage {
  rows: CoverageRow[];
}

/** Placeholder: W3-09 replaces the body. */
export function emptyCoverage(): Coverage {
  return { rows: [] };
}
