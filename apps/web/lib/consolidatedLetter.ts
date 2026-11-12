/**
 * True when the cross-match letter's ask is below what its items add up to — the
 * claim is capped at the invoice total (lib/claims.ts), so the letter must say so
 * or its items would not add up to the ask. Compared per VAT basis, in agorot.
 */
export function letterAskCapped(
  items: ReadonlyArray<{ deltaAmount: number; basis?: string | null }>,
  claim: { exclIls: number; inclIls: number },
): boolean {
  const ag = (v: number) => Math.round(Math.abs(v) * 100);
  const excl = items.filter((f) => f.basis === 'excl').reduce((s, f) => s + ag(f.deltaAmount), 0);
  const incl = items.filter((f) => f.basis !== 'excl').reduce((s, f) => s + ag(f.deltaAmount), 0);
  return excl > ag(claim.exclIls) || incl > ag(claim.inclIls);
}
