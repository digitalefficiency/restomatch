import { createServerCaller } from '@/lib/trpc/server';
import { DockPriceHint } from '../../receiving/dock-price-hint';

/**
 * Flag `dockPriceContext` on the invoice page: "your usual price" under each
 * line the matcher flagged PRICE_HIGHER and that is above its usual price.
 * Keyed by invoice line id; `{}` when the flag is off or on any error.
 */
export async function dockPriceNotesForInvoice(invoiceId: string): Promise<Record<string, React.ReactNode>> {
  try {
    const caller = await createServerCaller();
    const ctx = await caller.receiving.priceContext({ invoiceId });
    if (!ctx.enabled) return {};
    const out: Record<string, React.ReactNode> = {};
    for (const l of ctx.lines) {
      if (l.priceHigher && l.pctVsUsual > 0) out[l.invoiceLineId] = <DockPriceHint data={l} />;
    }
    return out;
  } catch {
    return {};
  }
}

/** Merge per-line badge maps (over-contract + dock price), in order. */
export function mergeLineBadges(...maps: Array<Record<string, React.ReactNode>>): Record<string, React.ReactNode> {
  const out: Record<string, React.ReactNode> = {};
  for (const m of maps) {
    for (const [id, node] of Object.entries(m)) {
      out[id] = id in out ? (
        <>
          {out[id]}
          {node}
        </>
      ) : (
        node
      );
    }
  }
  return out;
}
