import type { discrepancies, invoices, UserRole } from '@restomatch/db';
import type { AwaitingRouting } from '../approvals/awaiting';
import type { VatBasis } from '../lib/claims';
import { addCalendarDaysInTz, localDateKeyInTz, startOfDayInTz } from '../lib/time';
import type { AgorotByBasis, DecisionRecord, GapReason, GapRole, PassedOn } from './holding';

/**
 * INV-00 · an invoice's story (`invoices.history`) and a person's decisions of a period
 * (`approvals.decided`), built only from what the product records, roles only: no user id,
 * no name and no e-mail anywhere in either payload, and "it was you" as a flag (owner
 * decision 4). A gap the system closed by itself is never shown as a person's decision.
 *
 * Known limit, stated and not mended: a re-match deletes the gap rows and writes new ones
 * (`routers/match.ts`), so the audit rows of the old gap ids can no longer be joined to the
 * invoice. A decision and a pass-on are carried onto the new row (`match/persist.ts`), but the
 * undo pairs, the decider's recorded role and reason code of a carried decision, and the time
 * of a carried pass-on are lost; `rematched` says when that can be the case.
 */

type InvoiceRow = typeof invoices.$inferSelect;

/** Where an invoice came in from (`invoices.source`): photo, e-mail, platform, manual, WhatsApp. */
export type InvoiceSource = InvoiceRow['source'];

/**
 * Who did an act, as a role, never a person: the role the doer holds in this restaurant
 * (`memberships`, or the role the audit row records for a decision, a pass-on and an undo);
 * `system` for what the product did by itself (the check, the routing); null when the product
 * does not record who did it (who sent an order).
 */
export type HistoryActor = UserRole | 'system' | null;

interface HistoryEventBase {
  /** When; null only for a pass-on carried through a re-match (its time is not known). */
  at: Date | null;
  /** The gap the event is about, or null for an event of the whole invoice. */
  gapId: string | null;
  /** The role beside the act (see `HistoryActor`). */
  by: HistoryActor;
  /** The caller did it. */
  byYou: boolean;
}

/**
 * One event of an invoice's story:
 *  - `order_sent` · the order was sent to the supplier
 *  - `goods_received` · the goods were received (`counted`: and counted)
 *  - `invoice_read` · the invoice came in and was read (`source`: photo, e-mail, …)
 *  - `checked` · it was checked against the order and the receipt (a match run); `gapsFound`
 *    counts the gaps that reached a person (not the ₪0 twin, not what the system closed itself)
 *  - `routed` · a gap reached a role (`role`, the role it first reached, and the rule's `reason`)
 *  - `passed_on` · a gap was passed on to the owner
 *  - `decided` · a person decided a gap (the role, in whose place, the reason)
 *  - `undone` · a decision or a pass-on was taken back by the person who made it
 */
export type HistoryEvent =
  | (HistoryEventBase & { kind: 'order_sent' })
  | (HistoryEventBase & { kind: 'goods_received'; counted: boolean })
  | (HistoryEventBase & { kind: 'invoice_read'; source: InvoiceSource })
  | (HistoryEventBase & { kind: 'checked'; gapsFound: number })
  | (HistoryEventBase & { kind: 'routed'; role: GapRole; reason: GapReason })
  | (HistoryEventBase & { kind: 'passed_on'; passedOn: PassedOn })
  | (HistoryEventBase & { kind: 'decided'; decision: DecisionRecord })
  | (HistoryEventBase & { kind: 'undone'; undid: 'decision' | 'pass_on'; role: GapRole | null });

export type HistoryEventKind = HistoryEvent['kind'];

/** `invoices.history`: newest first. */
export interface InvoiceHistory {
  events: HistoryEvent[];
  /** The invoice was matched more than once: the story of the earlier gap rows may be thinner. */
  rematched: boolean;
}

/** The periods `approvals.decided` takes, in the restaurant's own day (its `timezone`). */
export const DECIDED_PERIODS = ['today', 'yesterday', 'week'] as const;
export type DecidedPeriod = (typeof DECIDED_PERIODS)[number];

/**
 * One decided gap for the approvals desk's "הוחלט היום": every key of an `approvals.myQueue`
 * row, with its types, so the desk draws the same evidence in grey from the same row model,
 * plus the decision. A decided row: `canAct` false; `claimable` and `claimAgorot` say what the
 * decision put in the credit request (`credit`, `duplicate_held`), else false and 0;
 * `passedOn` null; `reason` the rule that first routed it (as `invoices.history`).
 */
type DiscrepancyRow = typeof discrepancies.$inferSelect;

export interface DecidedRow {
  id: string;
  type: DiscrepancyRow['type'];
  severity: DiscrepancyRow['severity'];
  resolutionStatus: DiscrepancyRow['resolutionStatus'];
  /** The routing stored on the gap now (an escalated-then-decided gap reads 'owner'). */
  requiredRole: UserRole | null;
  deltaAmount: string | null;
  expectedValue: string | null;
  actualValue: string | null;
  toleranceUsed: string | null;
  ruleId: string | null;
  productName: string | null;
  productNameEn: string | null;
  supplierName: string | null;
  supplierNameEn: string | null;
  invoiceNumber: string | null;
  invoiceDate: Date | null;
  invoiceDueDate: Date | null;
  invoiceStatus: InvoiceRow['status'] | null;
  hasScan: boolean;
  createdAt: Date;
  matchRunId: string;
  invoiceId: string | null;
  invoiceLineId: string | null;
  lineDescription: string | null;
  lineDescriptionEn: string | null;
  qtyBilled: string | null;
  billedUnit: string | null;
  unitPriceBilled: string | null;
  lineTotal: string | null;
  qtyOrdered: string | null;
  orderedUnit: string | null;
  unitPriceExpected: string | null;
  qtyReceived: string | null;
  poId: string | null;
  poRef: string | null;
  poDate: Date | null;
  /** Stored with the retired word "הפרש": kept for the row model, never printed. */
  ruleName: string | null;
  message: string | null;
  claimable: boolean;
  claimAgorot: number;
  canAct: boolean;
  waitingOn: AwaitingRouting;
  reason: GapReason;
  passedOn: PassedOn | null;
  /** As on the queue row: the role it is routed to now (the manager's for no routing), and since when. */
  routing: GapRole;
  since: Date;
  /** The VAT basis of `claimAgorot` (and of the decision's amount). */
  claimBasis: VatBasis;
  decision: DecisionRecord;
}

/**
 * `approvals.decided`: every member's decisions of the period in this restaurant (`byYou` marks
 * the caller's), never the system's, newest first, with the head's totals from the server.
 */
export interface DecidedList {
  rows: DecidedRow[];
  /** The decisions of the period (`rows.length` unless the read's cap cut it). */
  count: number;
  /** Σ the decisions' `amountAgorot` by VAT basis, integer agorot (the ₪ they were about). */
  amountAgorot: AgorotByBasis;
}

/**
 * Pure: the [from, to) instants of a period in the restaurant's zone (DST-safe, `lib/time`).
 * `today` turns at midnight there; `yesterday` is the day before; `week` runs from the Sunday
 * that starts the current Israeli week (Sunday to Saturday) to the end of today.
 */
export function periodBounds(period: DecidedPeriod, now: Date, timeZone: string): { from: Date; to: Date } {
  const start = startOfDayInTz(now, timeZone);
  const tomorrow = addCalendarDaysInTz(start, 1, timeZone);
  if (period === 'today') return { from: start, to: tomorrow };
  if (period === 'yesterday') return { from: addCalendarDaysInTz(start, -1, timeZone), to: start };
  const [y, m, d] = localDateKeyInTz(now, timeZone).split('-').map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return { from: addCalendarDaysInTz(start, -dow, timeZone), to: tomorrow };
}
