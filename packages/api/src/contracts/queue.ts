import {
  and,
  desc,
  discrepancies,
  eq,
  inArray,
  invoices,
  matchRuns,
  sql,
  supplierContractPrices,
  type Database,
} from '@restomatch/db';
import { findOverContractLines, type OverContractLine } from './overContract';
import { loadAlertDetails, type PriceAlertDetail } from '../priceAlerts/sweep';
import { loadAlertImpacts, type AlertImpact } from '../priceAlerts/impact';

/**
 * W2-12 — the "לטיפול" queue on /dashboard/contracts: one ₪-ranked list that
 * merges over-contract lines (billed, in the header ₪) with open price alerts
 * (an estimate, never added to the header).
 *
 * Read-only. `findOverContractLines` is consumed unchanged; this module adds the
 * joins it doesn't carry (the line's open PRICE_HIGHER on its invoice's latest
 * run, and the invoice's payment state) so each card can name ONE money action:
 *   • open discrepancy, invoice not paid → 'offset'  ("קזזו לפני תשלום")
 *   • open discrepancy, invoice paid     → 'claim'   ("הוסיפו לדרישת זיכוי")
 *   • no open discrepancy (not matched yet, or already decided) → 'request'
 *     ("בקשו מהספק את מחיר החוזה": a WhatsApp draft the person sends)
 * One channel per state (owner decision 19): never both offset and claim.
 */

export const QUEUE_DAYS = 90;
/** Over-contract cards returned (newest-first scan, then ranked by ₪). */
export const QUEUE_LINE_LIMIT = 500;

export type OverAction = 'offset' | 'claim' | 'request';

export interface QueueOverItem extends Omit<OverContractLine, 'invoiceDate'> {
  kind: OverAction;
  invoiceDate: Date;
  /** The open PRICE_HIGHER the action decides (null for 'request'). */
  discrepancyId: string | null;
  invoiceStatus: string;
  invoicePaid: boolean;
}

export interface QueueAlertItem {
  kind: 'alert';
  alert: PriceAlertDetail;
  impact: AlertImpact;
}

export type QueueItem = QueueOverItem | QueueAlertItem;

export interface ContractsQueue {
  /**
   * 'no_contracts' — nothing to compare against: unknown, never ₪0 / clean.
   * 'unchecked'    — contracts exist but no invoice line in the window could be compared.
   * 'clean'        — lines were checked and nothing is over contract and no alert is open.
   * 'open'         — at least one card.
   */
  state: 'no_contracts' | 'unchecked' | 'clean' | 'open';
  /** Σ overAgorot of the billed over-contract cards — the header ₪ (alerts never added). */
  totalOverAgorot: number;
  lineCount: number;
  alertCount: number;
  /** Over-contract cards first ranked by overAgorot, alerts by monthly estimate, merged by ₪ (desc). */
  items: QueueItem[];
  /** More invoice lines exist than one scan covers — the total is a lower bound. */
  truncated: boolean;
  days: number;
}

/** The sort key of a card in agorot: billed overage, or the alert's monthly estimate. */
export function queueRankAgorot(item: QueueItem): number {
  return item.kind === 'alert' ? item.impact.monthlyAgorot : item.overAgorot;
}

/** Pure: which action a line gets from its discrepancy + payment state. */
export function overActionFor(discrepancyId: string | null, invoiceStatus: string): OverAction {
  if (!discrepancyId) return 'request';
  return invoiceStatus === 'paid' ? 'claim' : 'offset';
}

export async function loadContractsQueue(
  db: Database,
  restaurantId: string,
  opts: { now?: Date; alerts?: boolean } = {},
): Promise<ContractsQueue> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - QUEUE_DAYS * 86_400_000);
  const [hasContract] = await db
    .select({ id: supplierContractPrices.id })
    .from(supplierContractPrices)
    .where(eq(supplierContractPrices.restaurantId, restaurantId))
    .limit(1);

  let truncated = false;
  const lines = hasContract
    ? await findOverContractLines(db, restaurantId, { since, onTruncated: () => (truncated = true) })
    : [];

  // Joins: invoice status, and the open PRICE_HIGHER on the line's latest run.
  const invoiceIds = [...new Set(lines.map((l) => l.invoiceId))];
  const status = new Map<string, string>();
  const openDisc = new Map<string, string>();
  if (invoiceIds.length) {
    const inv = await db
      .select({ id: invoices.id, status: invoices.status })
      .from(invoices)
      .where(and(eq(invoices.restaurantId, restaurantId), inArray(invoices.id, invoiceIds)));
    for (const i of inv) status.set(i.id, i.status);
    const latestRunId = sql`(select mr.id from ${matchRuns} mr where mr.invoice_id = ${matchRuns.invoiceId} and mr.restaurant_id = ${restaurantId} order by mr.run_at desc limit 1)`;
    const disc = await db
      .select({ id: discrepancies.id, invoiceLineId: discrepancies.invoiceLineId })
      .from(discrepancies)
      .innerJoin(matchRuns, eq(matchRuns.id, discrepancies.matchRunId))
      .where(
        and(
          eq(discrepancies.restaurantId, restaurantId),
          eq(discrepancies.type, 'PRICE_HIGHER'),
          eq(discrepancies.resolutionStatus, 'open'),
          inArray(discrepancies.invoiceLineId, lines.map((l) => l.invoiceLineId)),
          sql`${matchRuns.id} = ${latestRunId}`,
        ),
      )
      .orderBy(desc(discrepancies.createdAt));
    for (const d of disc) if (d.invoiceLineId && !openDisc.has(d.invoiceLineId)) openDisc.set(d.invoiceLineId, d.id);
  }

  const over: QueueOverItem[] = lines.slice(0, QUEUE_LINE_LIMIT).map((l) => {
    const invoiceStatus = status.get(l.invoiceId) ?? 'matched';
    const discrepancyId = openDisc.get(l.invoiceLineId) ?? null;
    return { ...l, kind: overActionFor(discrepancyId, invoiceStatus), discrepancyId, invoiceStatus, invoicePaid: invoiceStatus === 'paid' };
  });

  let alertItems: QueueAlertItem[] = [];
  if (opts.alerts !== false) {
    const alerts = await loadAlertDetails(db, restaurantId, undefined, { status: 'open' });
    const impacts = await loadAlertImpacts(db, restaurantId, alerts, { now });
    alertItems = alerts.map((a) => ({ kind: 'alert' as const, alert: a, impact: impacts.get(a.id)! }));
  }

  const items: QueueItem[] = [...over, ...alertItems].sort((a, b) => queueRankAgorot(b) - queueRankAgorot(a));
  const totalOverAgorot = over.reduce((s, l) => s + l.overAgorot, 0);

  let state: ContractsQueue['state'];
  if (items.length > 0) state = 'open';
  else if (!hasContract) state = 'no_contracts';
  else state = (await anyLineChecked(db, restaurantId, since)) ? 'clean' : 'unchecked';

  return {
    state,
    totalOverAgorot,
    lineCount: over.length,
    alertCount: alertItems.length,
    items,
    truncated,
    days: QUEUE_DAYS,
  };
}

/** True when at least one invoice line in the window has a product the restaurant holds a contract for (same supplier). */
async function anyLineChecked(db: Database, restaurantId: string, since: Date): Promise<boolean> {
  const [first] = (await db.execute(sql`
    select exists (
      select 1 from invoice_lines il
      join invoices i on i.id = il.invoice_id
      join supplier_contract_prices c
        on c.restaurant_id = i.restaurant_id and c.supplier_id = i.supplier_id and c.product_id = il.product_id
      where i.restaurant_id = ${restaurantId}
        and coalesce(i.invoice_date, i.created_at) >= ${since.toISOString()}::timestamptz
    ) as ok`)) as unknown as Array<{ ok: boolean }>;
  return !!first?.ok;
}
