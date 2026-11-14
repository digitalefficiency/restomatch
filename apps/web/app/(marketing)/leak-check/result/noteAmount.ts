/**
 * W3-06b (routed from G-16 · money-swallow): a note's amount is optional in the
 * leak-check report. A missing amount must NEVER render as ₪0 — it reads as the
 * neutral T4 word "לא זמין" instead.
 */
export function noteAmountText(
  agorot: number | null | undefined,
  format: (agorot: number) => string,
  unavailable: string,
): string {
  return typeof agorot === 'number' && Number.isFinite(agorot) ? format(agorot) : unavailable;
}
