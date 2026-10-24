import 'server-only';
import { createServerCaller } from '@/lib/trpc/server';
import { leakCardWindow, topLeakLines, topTypes, toAgorot, type TopLeakLine } from './leak-card-logic';

type Caller = Awaited<ReturnType<typeof createServerCaller>>;
type Scorecard = Awaited<ReturnType<Caller['owner']['suppliers']>>[number];
type TypeRow = Awaited<ReturnType<Caller['owner']['leakGrouped']>>['rows'][number];

export interface SupplierLeakCard {
  window: { from: string; to: string };
  /** The supplier's 90-day leak — the same figure as the leak explorer grouped by supplier. */
  leakAgorot: number;
  /** Discrepancy lines behind it. */
  leakCount: number;
  topTypes: TypeRow[];
  topLines: TopLeakLine[];
  /** Leak still open or escalated (not yet waived, claimed or resolved). */
  openAgorot: number;
  openCount: number;
  /** null when the scorecard isn't available (advanced_analytics plan) or the supplier has no runs. */
  scorecard: Scorecard | null;
  /** True when the plan doesn't include the scorecard (advanced_analytics). */
  scorecardGated: boolean;
}

/**
 * Everything the supplier leak tab + print card show, composed from the
 * existing leak-explorer procedures filtered to one supplier (no new data
 * path, so the ₪ matches /dashboard/leaks exactly). Finance roles only — the
 * supplier pages are owner/manager already.
 */
export async function loadSupplierLeakCard(supplierId: string, now = new Date()): Promise<SupplierLeakCard> {
  const caller = await createServerCaller();
  const window = leakCardWindow(now);
  const view = { period: 'custom' as const, ...window, filters: { supplierIds: [supplierId] } };
  const openView = { ...view, filters: { ...view.filters, statuses: ['open' as const, 'escalated' as const] } };

  const [bySupplier, byType, open, breakdown, scorecards] = await Promise.all([
    caller.owner.leakGrouped({ view, groupBy: 'supplier', compare: 'off' }),
    caller.owner.leakGrouped({ view, groupBy: 'type', compare: 'off' }),
    caller.owner.leakGrouped({ view: openView, groupBy: 'supplier', compare: 'off' }),
    caller.owner.leakBreakdown({ view, limit: 200 }),
    // The scorecard is plan-gated (advanced_analytics): absent, the card just omits it.
    caller.owner.suppliers().catch(() => null),
  ]);

  const row = bySupplier.rows.find((r) => r.key === supplierId);
  const openRow = open.rows.find((r) => r.key === supplierId);
  const card = scorecards?.find((s) => s.supplierId === supplierId) ?? null;
  return {
    window,
    leakAgorot: toAgorot(row?.leakIls ?? 0),
    leakCount: row?.count ?? 0,
    topTypes: topTypes(byType.rows),
    topLines: topLeakLines(breakdown),
    openAgorot: toAgorot(openRow?.leakIls ?? 0),
    openCount: openRow?.count ?? 0,
    scorecard: card && card.matchRunsCount > 0 ? card : null,
    scorecardGated: scorecards === null,
  };
}
