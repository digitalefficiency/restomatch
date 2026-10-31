import { formatDate } from '@/lib/i18n/format';
import type { Locale } from '@/lib/i18n/config';
import { StatusChip, type StatusTone } from '@/lib/components/feedback';
import { DeadlineChip, Token } from '@/lib/components/money';
import type { ColumnDef } from '@/lib/components/table';

/** One register row as the page hands it to the client (money = integer agorot). */
export interface RegisterRow {
  id: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  supplierName: string | null;
  totalInclVatAgorot: number;
  gapAgorot: number;
  state: InvoiceStateKey;
  tab: 'review' | 'awaiting' | 'matched' | 'held' | 'paid';
  hasAllocation: boolean;
  consolidated: boolean;
}

export type InvoiceStateKey =
  | 'in_ocr'
  | 'awaiting_count'
  | 'awaiting_link'
  | 'clean'
  | 'flagged_open'
  | 'claim_open'
  | 'held_duplicate'
  | 'approved'
  | 'paid';

/**
 * Emphasis tiers (AGENTS.md): T2 act-now = a gap to decide or a possible double
 * payment; T3 good news = clean / paid / to claim; T4 pending = awaiting link,
 * count or OCR — neutral, never an alarm.
 */
export const STATE_TONE: Record<InvoiceStateKey, { tone: StatusTone; emphasis: 'bold' | 'subtle' }> = {
  flagged_open: { tone: 'warn', emphasis: 'bold' },
  held_duplicate: { tone: 'danger', emphasis: 'bold' },
  claim_open: { tone: 'gold', emphasis: 'subtle' },
  clean: { tone: 'success', emphasis: 'subtle' },
  approved: { tone: 'success', emphasis: 'subtle' },
  paid: { tone: 'success', emphasis: 'subtle' },
  awaiting_link: { tone: 'neutral', emphasis: 'subtle' },
  awaiting_count: { tone: 'neutral', emphasis: 'subtle' },
  in_ocr: { tone: 'neutral', emphasis: 'subtle' },
};

/** dd.MM.yyyy in both locales (owner spec). */
export function ddmmyyyy(value: string | Date, locale: Locale): string {
  return formatDate(value, locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.');
}

export interface RegisterCopy {
  col: { date: string; supplier: string; number: string; total: string; due: string; gap: string; status: string; allocation: string };
  state: Record<InvoiceStateKey, string>;
  allocationYes: string;
  allocationNo: string;
  consolidated: string;
}

export function registerColumns(t: RegisterCopy, locale: Locale): ColumnDef<RegisterRow>[] {
  return [
    {
      id: 'supplier',
      header: t.col.supplier,
      identity: true,
      value: (r) => r.supplierName ?? '',
      cell: (r) => r.supplierName ?? 'na',
    },
    {
      id: 'date',
      header: t.col.date,
      kind: 'date',
      value: (r) => (r.invoiceDate ? new Date(r.invoiceDate).getTime() : null),
      cell: (r) => (r.invoiceDate ? ddmmyyyy(r.invoiceDate, locale) : 'na'),
      exportValue: (r) => (r.invoiceDate ? ddmmyyyy(r.invoiceDate, locale) : ''),
    },
    {
      id: 'number',
      header: t.col.number,
      value: (r) => r.invoiceNumber ?? '',
      cell: (r) => (r.invoiceNumber ? <Token kind="invoice" value={r.invoiceNumber} /> : 'na'),
    },
    { id: 'total', header: t.col.total, kind: 'money', decimals: 2, value: (r) => r.totalInclVatAgorot },
    {
      id: 'due',
      header: t.col.due,
      kind: 'date',
      hideable: true,
      value: (r) => (r.dueDate ? new Date(r.dueDate).getTime() : null),
      cell: (r) => (r.dueDate && r.state !== 'paid' ? <DeadlineChip due={r.dueDate} /> : r.dueDate ? ddmmyyyy(r.dueDate, locale) : 'na'),
      exportValue: (r) => (r.dueDate ? ddmmyyyy(r.dueDate, locale) : ''),
    },
    {
      id: 'gap',
      header: t.col.gap,
      kind: 'money',
      decimals: 2,
      // Unknown until a match ran: never ₪0 (awaiting link / OCR / count).
      value: (r) => (r.state === 'awaiting_link' || r.state === 'in_ocr' || r.state === 'awaiting_count' ? null : r.gapAgorot),
      cell: (r) => (r.state === 'awaiting_link' || r.state === 'in_ocr' || r.state === 'awaiting_count' ? 'pending' : undefined),
    },
    {
      id: 'status',
      header: t.col.status,
      kind: 'status',
      value: (r) => t.state[r.state],
      cell: (r) => (
        <span className="inline-flex flex-wrap items-center gap-1">
          <StatusChip tone={STATE_TONE[r.state].tone} emphasis={STATE_TONE[r.state].emphasis} label={t.state[r.state]} />
          {r.consolidated ? <StatusChip tone="neutral" label={t.consolidated} icon={null} /> : null}
        </span>
      ),
    },
    {
      id: 'allocation',
      header: t.col.allocation,
      kind: 'status',
      hideable: true,
      value: (r) => (r.hasAllocation ? 1 : 0),
      cell: (r) => (
        <span>
          <span aria-hidden="true">{r.hasAllocation ? '✓' : '✗'}</span>
          <span className="sr-only">{r.hasAllocation ? t.allocationYes : t.allocationNo}</span>
        </span>
      ),
      exportValue: (r) => (r.hasAllocation ? t.allocationYes : t.allocationNo),
    },
  ];
}

/** Σ of the visible rows, integer agorot (the TotalsRow equals its rows). */
export function visibleTotals(rows: readonly RegisterRow[]) {
  return {
    count: rows.length,
    sumAgorot: rows.reduce((s, r) => s + r.totalInclVatAgorot, 0),
    gapAgorot: rows.reduce((s, r) => s + r.gapAgorot, 0),
  };
}
