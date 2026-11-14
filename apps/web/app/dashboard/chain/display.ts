/**
 * Display-only helpers for the chain page. Money math stays in the router /
 * charts (exact sums); these only decide which whole shekels to print.
 */

/**
 * Whole-₪ rows that add up to the printed total. Each row is rounded exactly
 * like that branch's own dashboard hero (so a branch never reads ₪759 here and
 * ₪760 on its own dashboard), and the printed total is the sum of the printed
 * rows. The exact total (Σ agorot) differs by under ₪0.5 per branch; the
 * leak % stays computed from the exact sums.
 */
export function wholeShekelRows(values: number[]): { rows: number[]; total: number } {
  const rows = values.map((v) => Math.round(Math.round(v * 100) / 100));
  return { rows, total: rows.reduce((a, b) => a + b, 0) };
}

/**
 * The chain KPI sparkline: Σ leak per month over the branches' heatmap rows.
 * A missing or non-finite cell means that month is unknown for the chain, so
 * the whole sparkline is unavailable (null → no sparkline, neutral T4). It is
 * never read as ₪0 (G-16 money-swallow).
 */
export function chainSparkline(
  months: string[],
  heatmap: { cells: { month: string; leakIls: number | null | undefined }[] }[],
): number[] | null {
  const out: number[] = [];
  for (const m of months) {
    let agorot = 0;
    for (const row of heatmap) {
      const v = row.cells.find((c) => c.month === m)?.leakIls;
      if (typeof v !== 'number' || !Number.isFinite(v)) return null;
      agorot += Math.round(v * 100);
    }
    out.push(agorot / 100);
  }
  return out;
}
