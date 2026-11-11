import type { UserRole } from '@restomatch/db';
import { daysBetween, israelDay, toAgorot } from '../rank';
import type { Task } from '../types';
import { claimFollowUps, deliverySummary, todayCutoffs, type ClaimLike, type ExpectationLike, type SupplierWithSchedule } from './rules';

/**
 * Task sources: each maps ONE existing service result to tasks. The service is
 * the one the queue's own page reads, so a task's ₪ is the page's ₪.
 */

const ageOf = (oldest: Date | string | null | undefined, today: string): number | null =>
  oldest ? Math.max(0, daysBetween(israelDay(oldest), today)) : null;

/** `approvals.queueSummary` (G-12a `awaitingDecision` swaps in here, one line). */
export interface QueueSummaryLike {
  count: number;
  blockers: number;
  oldestAt: Date | string | null;
  duplicateIls: number;
  vatIls: number;
  toDecide: { count: number; amountIls: number };
  toReview: { count: number };
  others: { count: number; amountIls: number; byRole: { role: string; count: number; amountIls: number }[] };
}

export function decisionTasks(s: QueueSummaryLike, today: string): Task[] {
  const out: Task[] = [];
  if (s.count > 0) {
    out.push({
      type: 'decision',
      entityId: 'decision:mine',
      title: 'decision',
      // The approvals "ניתן לדרוש מהספקים" tile: the lib/claims rule, before VAT.
      // Routed info rows ("לבדיקה") add a count, never ₪.
      ilsAgorot: toAgorot(s.toDecide.amountIls),
      count: s.count,
      blocking: s.blockers,
      tier: 'T2',
      // IA rule 8: colour = urgency. Red only when something blocks a payment; without a block
      // (and with no due date on the queue yet — W2-03 computeDueDate) the row stays neutral.
      tone: s.blockers > 0 ? 'danger' : 'neutral',
      due: null,
      ageDays: ageOf(s.oldestAt, today),
      verb: 'decide',
      deepLink: '/dashboard/approvals',
      scope: 'mine',
      detail: {
        toDecide: s.toDecide.count,
        toReview: s.toReview.count,
        duplicateAgorot: toAgorot(s.duplicateIls),
        vatAgorot: toAgorot(s.vatIls),
      },
    });
  }
  for (const r of s.others.byRole) {
    if (r.count <= 0) continue;
    out.push({
      type: 'waiting_on_others',
      entityId: `decision:${r.role}`,
      title: 'waitingOnOthers',
      ilsAgorot: toAgorot(r.amountIls),
      count: r.count,
      blocking: 0,
      tier: 'T4',
      tone: 'neutral',
      due: null,
      ageDays: null,
      verb: 'view',
      deepLink: '/dashboard/approvals',
      scope: 'others',
      withRole: r.role as UserRole,
    });
  }
  return out;
}

export function claimTasks(claims: readonly ClaimLike[], now: Date, today: string): Task[] {
  const q = claimFollowUps(claims, now.toISOString());
  const out: Task[] = [];
  if (q.unsent.count > 0) {
    out.push({
      type: 'claim_to_send',
      entityId: 'claims:unsent',
      title: 'claimToSend',
      ilsAgorot: q.unsent.agorot,
      count: q.unsent.count,
      blocking: 0,
      tier: 'T2',
      // Not late yet (no answer window has started): neutral. The overdue follow-up is the orange one.
      tone: 'neutral',
      due: null,
      ageDays: ageOf(q.unsent.oldest, today),
      verb: 'send',
      deepLink: '/dashboard/recovery',
      scope: 'mine',
    });
  }
  if (q.waiting.count > 0) {
    out.push({
      type: 'credit_to_match',
      entityId: 'claims:waiting',
      title: 'creditToMatch',
      ilsAgorot: q.waiting.agorot,
      count: q.waiting.count,
      blocking: 0,
      tier: 'T2',
      tone: 'warn',
      due: null,
      ageDays: ageOf(q.waiting.oldest, today),
      verb: 'followUp',
      deepLink: '/dashboard/recovery',
      scope: 'mine',
    });
  }
  return out;
}

export interface VatLike {
  totalVatAtRisk: number;
  rows: { invoiceId: string; daysLeft: number; deductionDeadline: string }[];
}

export function vatTasks(v: VatLike | null): Task[] {
  if (!v || v.rows.length === 0) return [];
  const days = Math.min(...v.rows.map((r) => r.daysLeft));
  const due = v.rows.map((r) => r.deductionDeadline).sort()[0] ?? null;
  return [
    {
      type: 'allocation_missing',
      entityId: v.rows.length === 1 ? v.rows[0]!.invoiceId : 'vat:open',
      title: 'allocationMissing',
      ilsAgorot: toAgorot(v.totalVatAtRisk),
      count: v.rows.length,
      blocking: 0,
      tier: 'T2',
      // H8: neutral far from the deadline, warn inside 30 days, danger inside 7 (or late).
      tone: days <= 7 ? 'danger' : days <= 30 ? 'warn' : 'neutral',
      due,
      ageDays: null,
      verb: 'fix',
      deepLink: v.rows.length === 1 ? `/dashboard/invoices/${v.rows[0]!.invoiceId}` : '/dashboard#vat-at-risk',
      scope: 'mine',
      detail: { daysLeft: Math.max(0, days) },
    },
  ];
}

export interface PayRunLike {
  enabled: boolean;
  totals: { payIls: number };
  suppliers: { invoices: { status: string }[] }[];
}

export function payRunTasks(p: PayRunLike | null): Task[] {
  if (!p?.enabled || p.totals.payIls <= 0) return [];
  const toPay = p.suppliers.reduce((sum, s) => sum + s.invoices.filter((i) => i.status === 'pay').length, 0);
  return [
    {
      type: 'payment_due',
      entityId: 'payRun:month',
      title: 'paymentDue',
      ilsAgorot: toAgorot(p.totals.payIls),
      count: toPay,
      blocking: 0,
      tier: 'T2',
      tone: 'neutral',
      due: null,
      ageDays: null,
      verb: 'pay',
      deepLink: '/dashboard/approvals/pay-run',
      scope: 'mine',
    },
  ];
}

export function deliveryTasks(rows: readonly ExpectationLike[], now: Date, today: string): Task[] {
  if (rows.length === 0) return [];
  const s = deliverySummary(rows, now);
  // Open trucks today (late ones carried over count; an undated open PO is not "today").
  const open = s.total - s.received;
  if (open <= 0 && s.late <= 0) return [];
  return [
    {
      type: s.late > 0 ? 'delivery_late' : 'delivery_due',
      entityId: 'receiving:today',
      title: 'deliveries',
      ilsAgorot: null,
      count: Math.max(open, s.late),
      blocking: 0,
      tier: s.late > 0 ? 'T2' : 'T4',
      tone: s.late > 0 ? 'warn' : 'neutral',
      due: today,
      ageDays: null,
      verb: 'receive',
      deepLink: '/dashboard/receiving',
      scope: 'mine',
      detail: { total: s.total, received: s.received, late: s.late },
    },
  ];
}

export interface CountLike {
  status: string;
  progress: { counted: number; lines: number };
}

export function countTasks(c: CountLike | null, today: string): Task[] {
  if (!c || c.status !== 'draft') return [];
  const left = Math.max(0, c.progress.lines - c.progress.counted);
  return [
    {
      type: 'close_step',
      entityId: 'count:draft',
      title: 'count',
      ilsAgorot: null,
      count: left,
      blocking: 0,
      tier: 'T4',
      tone: 'neutral',
      due: today,
      ageDays: null,
      verb: 'count',
      deepLink: '/dashboard/inventory/count',
      scope: 'mine',
      detail: { counted: c.progress.counted, lines: c.progress.lines },
    },
  ];
}

export function orderTasks(suppliers: readonly SupplierWithSchedule[], now: Date, today: string): Task[] {
  const cut = todayCutoffs(suppliers, now);
  if (cut.length === 0) return [];
  const first = cut[0]!;
  return [
    {
      type: 'order_due',
      entityId: `order:${first.supplierId}`,
      title: 'orderDue',
      ilsAgorot: null,
      count: cut.length,
      blocking: 0,
      tier: first.minutesLeft <= 60 ? 'T2' : 'T4',
      tone: first.minutesLeft <= 60 ? 'warn' : 'neutral',
      due: today,
      ageDays: null,
      verb: 'order',
      deepLink: '/dashboard/orders/new',
      scope: 'mine',
      detail: { supplier: first.supplierName, supplierEn: first.supplierNameEn, time: first.cutoff },
    },
  ];
}

/** PILOT (train B, W2-02 interim): `invoices.needsLines` — invoices waiting for a person to complete their lines. */
export interface NeedsLinesLike {
  count: number;
  rows: readonly { reason: string }[];
}

export function invoiceLineTasks(r: NeedsLinesLike | null, today: string): Task[] {
  if (!r || r.count <= 0) return [];
  // Only held-for-review invoices (T4) → neutral; any failed / unread read → warn (main's home rule).
  const onlyHeld = r.rows.every((x) => x.reason === 'held');
  return [
    {
      type: 'doc_review',
      entityId: 'invoices:needsLines',
      title: 'invoiceLines',
      ilsAgorot: null,
      count: r.count,
      blocking: 0,
      tier: onlyHeld ? 'T4' : 'T2',
      tone: onlyHeld ? 'neutral' : 'warn',
      due: today,
      ageDays: null,
      verb: 'review',
      deepLink: '/dashboard/invoices?view=lines',
      scope: 'mine',
    },
  ];
}
