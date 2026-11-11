import { notFound } from 'next/navigation';
import { TRPCError } from '@trpc/server';
import { SectionHeader } from '@/lib/components';
import { getLocale, getT } from '@/lib/i18n/server';
import { invoices as invoicesNs } from '@/lib/i18n/messages/invoices';
import { createServerCaller } from '@/lib/trpc/server';
import { RegisterClient, type RegisterPageCopy } from './register-client';
import type { InvoiceStateKey, RegisterRow } from './columns';
import { pickRegisterMonth } from './month';
import { auth } from '@/auth';
import { enabledFeatures } from '@/lib/ingest/features';
import { formatDate } from '@/lib/i18n/format';
import { holdReasonKeys } from '../hold-reasons';
import type { LinesView } from './register-client';

export const dynamic = 'force-dynamic';

const TABS = ['review', 'lines', 'awaiting', 'matched', 'held', 'paid', 'noAllocation', 'intake'] as const;
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
  const [caller, t, locale, session] = await Promise.all([createServerCaller(), getT(invoicesNs), getLocale(), auth()]);
  // ?view=lines (train-C B2): the invoices waiting for a person — a failed or empty read, or a
  // held one — from invoices.needsLines (not month-scoped). Its own error state; never "none".
  const linesRes = await caller.invoices.needsLines().then(
    (v) => ({ ok: true as const, v }),
    () => ({ ok: false as const }),
  );

  let data: Awaited<ReturnType<typeof caller.invoices.list>> | null = null;
  let monthOffset = pickRegisterMonth({ param: month, now: new Date(), currentMonthCount: 1 }).monthOffset;
  let fellBack = false;
  try {
    data = await caller.invoices.list({ monthOffset });
    // First days of a month: an empty current month opens the previous one, with a chip back.
    const pick = pickRegisterMonth({ param: month, now: new Date(), currentMonthCount: data.rows.length });
    if (pick.fellBack) {
      monthOffset = pick.monthOffset;
      fellBack = true;
      data = await caller.invoices.list({ monthOffset });
    }
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
    allocationNa: t('register.allocationNa'),
    consolidated: t('register.consolidated'),
    open: t('register.open'),
    intakeHint: t('register.intakeHint'),
    intakeCta: t('register.intakeCta'),
    prevMonth: t('register.prevMonth'),
    nextMonth: t('register.nextMonth'),
    prevMonthShown: t('register.prevMonthShown'),
    currentMonth: t('register.currentMonth'),
    error: t('register.error'),
    retry: t('register.retry'),
    peekTotal: t('register.peekTotal'),
    peekGap: t('register.peekGap'),
  };

  const readOnly = session?.user?.role === 'bookkeeper';
  // B4: the 'נכנסות' tab and its inbox CTA exist only when an intake channel is on —
  // with ingestWhatsapp and ingestEmail off, /dashboard/inbox is a 404 (a dead end).
  const features = await enabledFeatures(session?.user?.restaurantId);
  const intakeOn = features.includes('ingestWhatsapp') || features.includes('ingestEmail');
  const dd = (d: Date | string | null) =>
    d ? formatDate(new Date(d), locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.') : null;
  const lines: LinesView | null = linesRes.ok
    ? {
        count: linesRes.v.count,
        rows: linesRes.v.rows.map((r) => {
          const held = r.reason === 'held';
          return {
            id: r.id,
            supplier: (locale === 'en' && r.supplierNameEn ? r.supplierNameEn : r.supplierName) ?? t('needsLines.noSupplier'),
            meta: [dd(r.invoiceDate), r.invoiceNumber ?? t('needsLines.noNumber')].filter(Boolean).join(' · '),
            held,
            reason: held ? null : t(`needsLines.reason.${r.reason}`),
            chips: holdReasonKeys(r.reviewReasons).map((k) => t(`needsLines.held.${k}`)),
            open: t(readOnly ? 'needsLines.openReadOnly' : held ? 'needsLines.openHeld' : 'needsLines.open'),
          };
        }),
        empty: t('needsLines.empty'),
        emptyBody: t('needsLines.emptyBody'),
        caption: t('needsLines.caption'),
      }
    : null;

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
        allocationNumber: r.allocationNumber,
        allocationRequired: r.allocationRequired,
        consolidated: r.consolidated,
      }))
    : null;

  return (
    <div>
      <SectionHeader level={1} title={t('register.title')} subtitle={t('register.subtitle')} />
      <RegisterClient rows={rows} counts={data?.counts ?? null} lines={lines} intake={intakeOn} monthOffset={monthOffset} fellBack={fellBack} locale={locale} copy={copy} />
    </div>
  );
}
