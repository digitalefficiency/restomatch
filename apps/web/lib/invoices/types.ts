import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';

/**
 * INV-00 · the shapes the invoices area's screens read, each named once and derived from the
 * router (the package root exports no type of `packages/api/src/invoices/`). Every screen of
 * the area imports these types from here.
 */
type Out = inferRouterOutputs<AppRouter>;
type In = inferRouterInputs<AppRouter>;

// ── invoices.list ──────────────────────────────────────────────────────────────
export type InvoiceListOutput = Out['invoices']['list'];
export type InvoiceListRow = InvoiceListOutput['rows'][number];
export type InvoiceListCounts = InvoiceListOutput['counts'];
/** One place of the month for the caller (`places[]`), in `PLACE_IDS` order as the server sends it. */
export type PlaceSummary = InvoiceListOutput['places'][number];
export type PlaceId = PlaceSummary['id'];
/** The nine canonical invoice states (`invoices/state.ts`). */
export type InvoiceState = InvoiceListRow['state'];
/** The month's open gaps, their ₪ and routings (`invoices.list.open`): the opening sentence reads these. */
export type MonthOpenGaps = InvoiceListOutput['open'];

// ── with whom, since when, why ─────────────────────────────────────────────────
/** With whom an invoice's open gaps are (`holding`), the same object wherever it is returned. */
export type Holding = NonNullable<InvoiceListRow['holding']>;
/** The roles a gap can wait for, and the roles that enter this area: owner, manager, bookkeeper. */
export type GapRole = Holding['role'];
export type GapSeverity = Holding['worstSeverity'];
export type GapReason = Holding['reason'];
export type ReasonKind = GapReason['kind'];
export type PassedOn = NonNullable<Holding['passedOn']>;
/** ₪ per VAT basis, integer agorot. */
export type AgorotByBasis = Holding['openAgorot'];
export type VatBasis = keyof AgorotByBasis;

// ── what was decided ───────────────────────────────────────────────────────────
export type DecisionRecord = NonNullable<InvoiceListRow['lastDecision']>;
export type DecisionResult = DecisionRecord['result'];
/** A waive reason code (`approvals` WAIVE_REASON_CODES). */
export type WaiveReasonCode = NonNullable<DecisionRecord['reasonCode']>;

// ── by when ────────────────────────────────────────────────────────────────────
export type PayBy = NonNullable<InvoiceListRow['payBy']>;

// ── invoices.detail ────────────────────────────────────────────────────────────
export type InvoiceDetail = Out['invoices']['detail'];
export type DetailLine = InvoiceDetail['lines'][number];
export type DetailFinding = DetailLine['findings'][number];
export type Payment = NonNullable<InvoiceDetail['payment']>;
export type PaymentStatus = Payment['status'];
export type HoldReasonCode = Payment['reasons'][number];
export type Allocation = NonNullable<InvoiceDetail['allocation']>;

// ── invoices.holding, invoices.history ─────────────────────────────────────────
export type InvoiceHoldingInput = In['invoices']['holding'];
export type InvoiceHoldingEntry = Out['invoices']['holding'][number];
export type InvoiceHistory = Out['invoices']['history'];
export type HistoryEvent = InvoiceHistory['events'][number];
export type HistoryEventKind = HistoryEvent['kind'];
/** Where an invoice came in from (`invoices.source`). */
export type InvoiceSource = Extract<HistoryEvent, { kind: 'invoice_read' }>['source'];
/** The role beside an act of the story (a role, 'system', or null when not recorded). */
export type HistoryActor = HistoryEvent['by'];

// ── approvals ──────────────────────────────────────────────────────────────────
export type QueueRow = Out['approvals']['myQueue'][number];
export type QueueSummary = Out['approvals']['queueSummary'];
export type RoutingSummary = QueueSummary['byRouting'][number];
export type OpenInvoicesSummary = QueueSummary['invoices'];
export type DecidedInput = In['approvals']['decided'];
export type DecidedPeriod = DecidedInput['period'];
export type DecidedList = Out['approvals']['decided'];
export type DecidedRow = DecidedList['rows'][number];
