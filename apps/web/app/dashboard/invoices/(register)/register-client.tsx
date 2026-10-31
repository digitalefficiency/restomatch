'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Locale } from '@/lib/i18n/config';
import { formatIls } from '@/lib/money';
import { cn } from '@/lib/components/cn';
import { Banner } from '@/lib/components/feedback';
import { DataTable, ViewTabs, updateTableUrl, useTableUrlValue } from '@/lib/components/table';
import { registerColumns, visibleTotals, ddmmyyyy, type RegisterCopy, type RegisterRow } from './columns';

type Tab = 'review' | 'awaiting' | 'matched' | 'held' | 'paid' | 'noAllocation' | 'intake';
const TABS: Tab[] = ['review', 'awaiting', 'matched', 'held', 'paid', 'noAllocation', 'intake'];

export interface RegisterPageCopy extends RegisterCopy {
  caption: string;
  tabs: Record<Tab, string>;
  open: string;
  intakeHint: string;
  intakeCta: string;
  prevMonth: string;
  nextMonth: string;
  error: string;
  retry: string;
  peekTotal: string;
  peekGap: string;
}

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info';
const BTN = cn(
  'inline-flex h-10 items-center gap-1 rounded-lg border border-line-strong bg-surface px-3 text-sm font-semibold text-ink hover:bg-surface-2',
  FOCUS,
);

export function inTab(r: RegisterRow, tab: Tab): boolean {
  if (tab === 'noAllocation') return !r.hasAllocation && r.state !== 'in_ocr';
  if (tab === 'intake') return false;
  return r.tab === tab;
}

export function RegisterClient({
  rows,
  counts,
  monthOffset,
  locale,
  copy: t,
}: {
  rows: RegisterRow[] | null;
  counts: Record<Tab, number> | null;
  monthOffset: number;
  locale: Locale;
  copy: RegisterPageCopy;
}) {
  const router = useRouter();
  const viewParam = useTableUrlValue('view');
  const view: Tab = (TABS as string[]).includes(viewParam ?? '') ? (viewParam as Tab) : 'review';
  const columns = useMemo(() => registerColumns(t, locale), [t, locale]);
  const visible = useMemo(() => (rows ?? []).filter((r) => inTab(r, view)), [rows, view]);
  const totals = visibleTotals(visible);
  const href = (r: RegisterRow) => `/dashboard/invoices/${r.id}?from=register${view ? `&view=${view}` : ''}`;
  const monthHref = (o: number) => (o === 0 ? '/dashboard/invoices' : `/dashboard/invoices?month=${o}`);
  const Prev = locale === 'he' ? ChevronRight : ChevronLeft;
  const Next = locale === 'he' ? ChevronLeft : ChevronRight;

  const monthNav = (
    <nav aria-label={t.caption} className="flex items-center gap-2">
      <Link href={monthHref(monthOffset - 1)} className={BTN} data-testid="register-prev-month">
        <Prev className="h-4 w-4" aria-hidden="true" />
        {t.prevMonth}
      </Link>
      {monthOffset < 0 ? (
        <Link href={monthHref(monthOffset + 1)} className={BTN}>
          {t.nextMonth}
          <Next className="h-4 w-4" aria-hidden="true" />
        </Link>
      ) : null}
    </nav>
  );

  if (!rows || !counts) {
    return (
      <Banner
        tone="danger"
        title={t.error}
        action={
          <button type="button" className={BTN} onClick={() => router.refresh()}>
            {t.retry}
          </button>
        }
      />
    );
  }

  const tabs = (
    <ViewTabs
      views={TABS.map((v) => ({
        id: v,
        label: t.tabs[v],
        count: counts[v],
      }))}
      active={view}
      onChange={(v) => updateTableUrl({ view: v === 'review' ? null : v, page: 1, sel: null, peek: null })}
    />
  );

  if (view === 'intake') {
    return (
      <div className="space-y-4" data-testid="invoice-register">
        {tabs}
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
          <p className="text-sm text-ink">{t.intakeHint}</p>
          <Link href="/dashboard/inbox?filter=needs_review" className={cn(BTN, 'mt-3 bg-primary text-on-primary hover:bg-primary')}>
            {t.intakeCta}
          </Link>
        </div>
      </div>
    );
  }

  const peekBody = (r: RegisterRow) => (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
      <dt className="text-muted">{t.col.date}</dt>
      <dd>{r.invoiceDate ? ddmmyyyy(r.invoiceDate, locale) : null}</dd>
      <dt className="text-muted">{t.peekTotal}</dt>
      <dd className="text-right">
        <bdi>{formatIls(r.totalInclVatAgorot / 100, { maximumFractionDigits: 2, locale })}</bdi>
      </dd>
      <dt className="text-muted">{t.peekGap}</dt>
      <dd className="text-right">
        <bdi>{formatIls(r.gapAgorot / 100, { maximumFractionDigits: 2, locale })}</bdi>
      </dd>
      <dt className="text-muted">{t.col.status}</dt>
      <dd>{t.state[r.state]}</dd>
    </dl>
  );

  return (
    <div className="space-y-3" data-testid="invoice-register" data-visible-total={totals.sumAgorot}>
      <DataTable<RegisterRow>
        id="invoice-register"
        caption={t.caption}
        rows={visible}
        columns={columns}
        rowKey={(r) => r.id}
        defaultSort={{ id: 'date', desc: true }}
        totals={{ count: totals.count, sumAgorot: totals.sumAgorot, columnId: 'total' }}
        rowTone={(r) => (r.state === 'held_duplicate' ? 'danger' : r.state === 'flagged_open' ? 'warn' : undefined)}
        onOpen={(r) => router.push(href(r))}
        peek={{ title: (r) => `${r.invoiceNumber ?? ''} · ${r.supplierName ?? ''}`, render: peekBody, href }}
        exportMeta={{ title: t.caption, period: monthHref(monthOffset), scope: t.tabs[view], filters: '' }}
        toolbar={
          <div className="flex flex-wrap items-center justify-between gap-2">
            {tabs}
            {monthNav}
          </div>
        }
      />
    </div>
  );
}
