import { notFound } from 'next/navigation';
import { TRPCError } from '@trpc/server';
import { SectionHeader } from '@/lib/components';
import { getLocale, getT } from '@/lib/i18n/server';
import { invoices as invoicesNs } from '@/lib/i18n/messages/invoices';
import { createServerCaller } from '@/lib/trpc/server';
import { RegisterClient, type RegisterPageCopy } from './register-client';
import type { InvoiceStateKey, RegisterRow } from './columns';

export const dynamic = 'force-dynamic';

const TABS = ['review', 'awaiting', 'matched', 'held', 'paid', 'noAllocation', 'intake'] as const;
const STATES: InvoiceStateKey[] = [
  'in_ocr',
  'awaiting_count',
  'awaiting_link',
  'clean',
  'flagged_open',
  'claim_open',
  'held_duplicate',
  'approved',
  'paid',
];

/**
 * W2-02 · the invoice register (exec-desktop-02, ia-nav-13): every invoice of the
 * month by its ONE canonical state (G-05 `invoices/state.ts`), with the ₪ gap.
 * Owner, manager and bookkeeper (`money.view`); the receiver and chef never.
 */
export default async function InvoicesRegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
  const monthOffset = Math.max(-24, Math.min(0, Number.parseInt(month ?? '0', 10) || 0));
  const [caller, t, locale] = await Promise.all([createServerCaller(), getT(invoicesNs), getLocale()]);

  let data: Awaited<ReturnType<typeof caller.invoices.list>> | null = null;
  try {
    data = await caller.invoices.list({ monthOffset });
  } catch (err) {
    if (err instanceof TRPCError && err.code === 'FORBIDDEN') notFound();
    data = null; // in-shell error state with retry, never an empty ₪0 register
  }

  const copy: RegisterPageCopy = {
    caption: t('register.caption'),
    tabs: Object.fromEntries(TABS.map((k) => [k, t(`register.tabs.${k}`)])) as RegisterPageCopy['tabs'],
    col: {
      date: t('register.col.date'),
      supplier: t('register.col.supplier'),
      number: t('register.col.number'),
      total: t('register.col.total'),
      due: t('register.col.due'),
      gap: t('register.col.gap'),
      status: t('register.col.status'),
      allocation: t('register.col.allocation'),
    },
    state: Object.fromEntries(STATES.map((s) => [s, t(`state.${s}`)])) as RegisterPageCopy['state'],
    allocationYes: t('register.allocationYes'),
    allocationNo: t('register.allocationNo'),
    consolidated: t('register.consolidated'),
    open: t('register.open'),
    intakeHint: t('register.intakeHint'),
    intakeCta: t('register.intakeCta'),
    prevMonth: t('register.prevMonth'),
    nextMonth: t('register.nextMonth'),
    error: t('register.error'),
    retry: t('register.retry'),
    peekTotal: t('register.peekTotal'),
    peekGap: t('register.peekGap'),
  };

  const rows: RegisterRow[] | null = data
    ? data.rows.map((r) => ({
        id: r.id,
        invoiceNumber: r.invoiceNumber,
        invoiceDate: r.invoiceDate ? new Date(r.invoiceDate).toISOString() : null,
        dueDate: r.dueDate ? new Date(r.dueDate).toISOString() : null,
        supplierName: r.supplierName,
        totalInclVatAgorot: r.totalInclVatAgorot,
        gapAgorot: r.gapAgorot,
        state: r.state,
        tab: r.tab,
        hasAllocation: r.hasAllocation,
        consolidated: r.consolidated,
      }))
    : null;

  return (
    <div>
      <SectionHeader level={1} title={t('register.title')} subtitle={t('register.subtitle')} />
      <RegisterClient rows={rows} counts={data?.counts ?? null} monthOffset={monthOffset} locale={locale} copy={copy} />
    </div>
  );
}
