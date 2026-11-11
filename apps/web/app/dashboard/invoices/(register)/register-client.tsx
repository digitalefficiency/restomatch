'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, ClipboardList, FileWarning } from 'lucide-react';
import type { Locale } from '@/lib/i18n/config';
import { formatIls } from '@/lib/money';
import { cn } from '@/lib/components/cn';
import { Banner, StatusChip } from '@/lib/components/feedback';
import { DataTable, ViewTabs, updateTableUrl, useTableUrlValue } from '@/lib/components/table';
import { registerColumns, visibleTotals, ddmmyyyy, type RegisterCopy, type RegisterRow } from './columns';

type Tab = 'review' | 'lines' | 'awaiting' | 'matched' | 'held' | 'paid' | 'noAllocation' | 'intake';
const TABS: Tab[] = ['review', 'lines', 'awaiting', 'matched', 'held', 'paid', 'noAllocation', 'intake'];

/** ?view=lines — invoices.needsLines, translated on the server (no ₪). */
export interface LinesView {
  count: number;
  rows: { id: string; supplier: string; meta: string; held: boolean; reason: string | null; chips: string[]; open: string }[];
  empty: string;
  emptyBody: string;
  caption: string;
}

export interface RegisterPageCopy extends RegisterCopy {
  caption: string;
  tabs: Record<Tab, string>;
  open: string;
  intakeHint: string;
  intakeCta: string;
  prevMonth: string;
  nextMonth: string;
  prevMonthShown: string;
  currentMonth: string;
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
  if (tab === 'intake' || tab === 'lines') return false;
  return r.tab === tab;
}

export function RegisterClient({
  rows,
  counts,
  lines = null,
  monthOffset,
  fellBack = false,
  locale,
  copy: t,
}: {
  rows: RegisterRow[] | null;
  counts: Record<Exclude<Tab, 'lines'>, number> | null;
  /** invoices.needsLines for ?view=lines; null when that read failed. */
  lines?: LinesView | null;
  monthOffset: number;
  /** The first days of a month opened the previous month because this one is still empty. */
  fellBack?: boolean;
  locale: Locale;
  copy: RegisterPageCopy;
}) {
  const router = useRouter();
  const viewParam = useTableUrlValue('view');
  const view: Tab = (TABS as string[]).includes(viewParam ?? '') ? (viewParam as Tab) : 'review';
  const columns = useMemo(() => registerColumns(t, locale), [t, locale]);
  const visible = useMemo(() => (rows ?? []).filter((r) => inTab(r, view)), [rows, view]);
  const totals = visibleTotals(visible);
  const href = (r: RegisterRow) =>
    `/dashboard/invoices/${r.id}?from=register${view ? `&view=${view}` : ''}${monthOffset ? `&month=${monthOffset}` : ''}`;
  const monthHref = (o: number) => `/dashboard/invoices?month=${o}`;
  const Prev = locale === 'he' ? ChevronRight : ChevronLeft;
  const Next = locale === 'he' ? ChevronLeft : ChevronRight;

  const monthNav = (
    <nav aria-label={t.caption} className="flex flex-wrap items-center gap-2">
      {fellBack ? (
        <span className="inline-flex min-h-10 items-center gap-1 rounded-full border border-line bg-surface-2 px-3 text-sm text-ink" data-testid="register-prev-month-shown">
          {t.prevMonthShown}
          <span aria-hidden="true">·</span>
          <Link href={monthHref(0)} className={cn('font-semibold text-primary underline underline-offset-4', FOCUS)}>
            {t.currentMonth}
          </Link>
        </span>
      ) : null}
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
        count: v === 'lines' ? (lines?.count ?? 0) : counts[v],
      }))}
      active={view}
      onChange={(v) => updateTableUrl({ view: v === 'review' ? null : v, page: 1, sel: null, peek: null })}
    />
  );

  if (view === 'lines') {
    const Chevron = locale === 'he' ? ChevronLeft : ChevronRight;
    return (
      <div className="space-y-4" data-testid="invoice-register">
        {tabs}
        {!lines ? (
          <Banner
            tone="danger"
            title={t.error}
            action={
              <button type="button" className={BTN} onClick={() => router.refresh()}>
                {t.retry}
              </button>
            }
          />
        ) : lines.rows.length === 0 ? (
          <div className="rounded-2xl border border-line bg-surface p-5 text-center shadow-card" data-testid="register-lines-empty">
            <p className="font-semibold text-ink">{lines.empty}</p>
            <p className="mt-1 text-sm text-muted">{lines.emptyBody}</p>
          </div>
        ) : (
          <ul className="space-y-2" aria-label={lines.caption} data-testid="register-lines">
            {lines.rows.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/dashboard/invoices/${r.id}?from=register&view=lines`}
                  data-testid="register-lines-row"
                  className={cn('flex min-h-14 items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 shadow-card hover:bg-surface-2', FOCUS)}
                >
                  {r.held ? (
                    // T4: held for review — a neutral icon, never a warning.
                    <ClipboardList className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
                  ) : (
                    <FileWarning className="h-5 w-5 shrink-0 text-warn" aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-ink">{r.supplier}</span>
                    <span className="block text-sm text-muted">{r.meta}</span>
                    {r.chips.length > 0 ? (
                      <span className="mt-1 flex flex-wrap gap-1" data-testid="register-lines-reasons">
                        {r.chips.map((c) => (
                          <StatusChip key={c} tone="neutral" emphasis="subtle" shape="control" icon={null} label={c} />
                        ))}
                      </span>
                    ) : null}
                  </span>
                  {r.reason ? <StatusChip tone="warn" emphasis="bold" label={r.reason} /> : null}
                  <span className="hidden text-sm font-semibold text-primary sm:inline">{r.open}</span>
                  <Chevron className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

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
