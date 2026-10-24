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
