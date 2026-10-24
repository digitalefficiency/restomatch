/**
 * Drop every trailing `/`. A plain loop instead of `.replace(/\/+$/, '')`: that
 * regex backtracks quadratically on input with many slashes that are not at
 * the end (CodeQL js/polynomial-redos), and these helpers see env/user values.
 */
export function stripTrailingSlashes(s: string): string {
  while (s.endsWith('/')) s = s.slice(0, -1);
  return s;
}
