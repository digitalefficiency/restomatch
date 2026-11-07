import Link from 'next/link';
import { ArrowRight, CircleCheck, PauseCircle, ReceiptText } from 'lucide-react';
import { createServerCaller } from '@/lib/trpc/server';
import { formatIls } from '@/lib/money';
import { formatDate, formatNumber } from '@/lib/i18n/format';
import { getLocale, getT } from '@/lib/i18n/server';
import { originalProps } from '@/lib/i18n/original';
import { payRun as payRunNs } from '@/lib/i18n/messages/payRun';
import { Badge, EmptyState, LinkButton, SectionHeader, cn, type BadgeTone } from '@/lib/components';
import { DeadlineChip, MetricTile, Money } from '@/lib/components/money';
import { displayName } from '../vocab';
import { PayRunExport } from './export-button';
import { localMonth, localYmd } from './dates';

type ListResult = Awaited<
  ReturnType<Awaited<ReturnType<typeof createServerCaller>>['payRun']['list']>
>;
type Row = ListResult['rows'][number];
type Hold = Row['holds'][number];

const BUCKETS = ['overdue', 'this_week', 'next_week', 'later', 'unknown'] as const;

/**
 * Emphasis tiers (AGENTS.md): payable is calm (T3); a decision / duplicate / missing
 * allocation / billed-twice hold is T2 (solid warn); waiting for a PO link or the count is
 * T4 (neutral) — nothing to decide yet.
 */
function toneOf(r: Row): BadgeTone {
  if (r.selectable) return r.creditIls > 0 ? 'gold' : 'accent';
  const calm = r.holds.every((h) => h.kind === 'pending_link' || h.kind === 'awaiting_count');
  return calm ? 'neutral' : 'warning-solid';
}

/**
 * W2-03 · the pay run as a due-date desk: every unpaid checked invoice, bucketed by when it is
 * due (lib/dueDate: human > agreed > printed), held rows say who they wait for and how much of
 * the total is under review with the supplier. `?m=0|-1` keeps the "by invoice month" filter.
 * "סמן כשולם" ships behind PAY_RUN_MARK_PAID (server flag, OFF until H-03 is deployed).
 */
export default async function PayRunPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const sp = await searchParams;
  const monthOffset: 0 | -1 | undefined = sp.m === '-1' ? -1 : sp.m === '0' ? 0 : undefined;
  const caller = await createServerCaller();
  const [t, locale] = await Promise.all([getT(payRunNs), getLocale()]);
  const data = await caller.payRun.list(monthOffset === undefined ? undefined : { monthOffset });

  const back = (
    <Link
      href="/dashboard/approvals"
      className="mb-3 -ms-2 touch-target inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-semibold text-muted hover:text-ink"
    >
      <ArrowRight className="h-4 w-4 ltr:-scale-x-100" aria-hidden="true" />
      {t('back')}
    </Link>
  );

  if (!data.enabled) {
    return (
      <div>
        {back}
        <SectionHeader level={1} title={t('title')} />
        <EmptyState icon={<ReceiptText className="h-6 w-6" />} title={t('disabled')} />
      </div>
    );
  }

  const ils = (v: number) => formatIls(v, { locale, maximumFractionDigits: 2 });
  const month = data.monthStart
    ? formatDate(data.monthStart, locale, { month: 'long', year: 'numeric' })
    : '';
  const day = (iso: string) => formatDate(iso, locale, { day: '2-digit', month: '2-digit' });
  const today = new Date(`${data.today}T12:00:00Z`);
  const supplierLabel = (r: Row) => displayName(locale, r.supplierName, r.supplierNameEn) || '—';
  const who = (role: string | null) =>
    t(`who.${role === 'owner' || role === 'manager' || role === 'bookkeeper' ? role : 'any'}`);

  const holdText = (h: Hold, r: Row): string => {
    switch (h.kind) {
      case 'decision':
        return t('holdReason.decision', {
          who: who(h.waitingFor),
          days: formatNumber(h.days, locale),
          dispute: ils(h.disputeIls),
          total: ils(h.ofIls),
        });
      case 'duplicate':
        return t('holdReason.duplicate');
      case 'pending_link':
        return t('holdReason.pendingLink');
      case 'awaiting_count':
        return t('holdReason.awaitingCount');
      case 'missing_allocation':
        return t('holdReason.missingAllocation', { vat: ils(h.vatIls) });
      case 'note_billed_twice':
        return t('holdReason.noteBilledTwice', { amount: ils(h.ils) });
      default:
        return r.status;
    }
  };
  const statusText = (r: Row) =>
    r.selectable
      ? r.creditIls > 0
        ? t('status.claim', { amount: ils(r.creditIls) })
        : t('status.pay')
      : holdText(r.holds[0]!, r);

  const csvColumns = [
    { key: 'supplier', label: t('csv.supplier') },
    { key: 'invoice', label: t('csv.invoice') },
    { key: 'date', label: t('csv.date') },
    { key: 'due', label: t('col.due') },
    { key: 'total', label: t('csv.total') },
    { key: 'status', label: t('csv.status') },
    { key: 'credit', label: t('csv.credit') },
    { key: 'pending', label: t('col.dispute') },
  ];
  const csvRows = data.rows.map((r) => ({
    supplier: supplierLabel(r),
    invoice: r.invoiceNumber ?? '',
    date: localYmd(r.invoiceDate),
    due: r.dueDate ?? '',
    total: r.totalInclVat.toFixed(2),
    status: r.holds.map((h) => holdText(h, r)).join(' · ') || statusText(r),
    credit: r.creditIls ? r.creditIls.toFixed(2) : '',
    pending: r.pendingIls ? r.pendingIls.toFixed(2) : '',
  }));
  const filterHref = (m: 0 | -1 | undefined) =>
    `/dashboard/approvals/pay-run${m === undefined ? '' : `?m=${m}`}`;

  const dueCell = (r: Row) => (
    <div className="flex flex-col items-start gap-1">
      {r.dueDate ? (
        <DeadlineChip due={r.dueDate} today={today} />
      ) : r.supplierKey ? (
        <Link
          href={`/dashboard/suppliers/${r.supplierKey}`}
          className="text-xs font-semibold text-muted underline hover:text-ink"
        >
          {t('due.unknown')}
        </Link>
      ) : (
        <span className="text-xs text-muted">{t('due.unknown')}</span>
      )}
      {r.exceedsLawLimit ? <Badge tone="warning">{t('due.lawLimit')}</Badge> : null}
      {r.termsCheck.verdict === 'shorter' && r.termsCheck.printedDue && r.termsCheck.agreedDue ? (
        <span data-testid="payrun-terms-shorter">
          <Badge tone="warning">
            {t('due.shorterTerms', {
              printed: day(r.termsCheck.printedDue),
              agreed: day(r.termsCheck.agreedDue),
            })}
          </Badge>
        </span>
      ) : null}
    </div>
  );

  const actionCell = (r: Row) => {
    const decision = r.holds.find(
      (h): h is Extract<Hold, { kind: 'decision' }> => h.kind === 'decision',
    );
    return decision?.canAct ? (
      <LinkButton
        href={`/dashboard/approvals?invoice=${r.invoiceId}`}
        size="sm"
        variant="secondary"
        className="touch-target"
      >
        {t('holdReason.decide')}
      </LinkButton>
    ) : null;
  };

  const rowsByBucket = BUCKETS.map((b) => ({
    bucket: b,
    rows: data.rows.filter((r) => r.bucket === b),
  })).filter((g) => g.rows.length > 0);
  const held = data.rows.filter((r) => !r.selectable);

  return (
    <div>
      {back}
      <SectionHeader
        level={1}
        title={t('title')}
        subtitle={month ? t('desk.subtitleMonth', { month }) : t('desk.subtitle')}
        action={
          data.totals.invoices > 0 ? (
            <PayRunExport
              label={t('csv.button')}
              filename={t('csv.file', {
                month: data.monthStart ? localMonth(data.monthStart) : data.today,
              })}
              columns={csvColumns}
              rows={csvRows}
            />
          ) : undefined
        }
      />

      {/* All open / this invoice month / last invoice month. */}
      <nav
        aria-label={t('desk.filterLabel')}
        className="mb-6 inline-flex rounded-xl border border-line bg-surface-2 p-1 text-sm"
      >
        {([undefined, 0, -1] as const).map((m) => (
          // A plain document link: same-route search-param soft navigations stall under
          // approvals/loading.tsx (see the soft-nav fix).
          <a
            key={String(m)}
            href={filterHref(m)}
            aria-current={m === monthOffset ? 'page' : undefined}
            data-testid={
              m === undefined ? 'payrun-month-all' : `payrun-month-${m === 0 ? 'this' : 'last'}`
            }
            className={cn(
              'touch-target inline-flex items-center rounded-lg px-3 py-1.5 font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
              m === monthOffset ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink',
            )}
          >
            {m === undefined ? t('desk.all') : m === 0 ? t('month.this') : t('month.last')}
          </a>
        ))}
      </nav>

      {/* Phone: one summary line. */}
      <p className="mb-4 text-sm font-semibold text-ink sm:hidden" data-testid="payrun-summary">
        {t('desk.summary', {
          payable: ils(data.totals.payableIls),
          count: formatNumber(data.totals.payableCount, locale),
          held: formatNumber(data.totals.heldCount, locale),
          dispute: ils(data.totals.disputeIls),
        })}
      </p>

      <div className="hidden grid-cols-1 gap-4 sm:grid sm:grid-cols-2" data-testid="payrun-kpis">
        <MetricTile
          label={t('desk.payable')}
          value={<Money value={data.totals.payableIls} context="tile" decimals={2} />}
          context={t('desk.payableHint', { count: formatNumber(data.totals.payableCount, locale) })}
          icon={<CircleCheck className="h-5 w-5" />}
        />
        <MetricTile
          label={t('desk.held')}
          value={<Money value={data.totals.heldIls} context="tile" decimals={2} />}
          context={t('desk.heldHint', {
            count: formatNumber(data.totals.heldCount, locale),
            dispute: ils(data.totals.disputeIls),
          })}
          icon={<PauseCircle className="h-5 w-5" />}
        />
      </div>
      {/* The credit is a calm T3 sentence — never a ₪0 tile. */}
      <p className="mt-3 text-sm text-muted" data-testid="payrun-credit">
        {data.totals.creditIls > 0 ? (
          <>
            {t('desk.credit')}:{' '}
            <Money value={data.totals.creditIls} context="line" state="caught" /> ·{' '}
            {t('desk.creditHint')}
          </>
        ) : (
          t('desk.zeroCredit')
        )}
      </p>

      {data.rows.length === 0 ? (
        <EmptyState
          className="mt-8"
          icon={<ReceiptText className="h-6 w-6" />}
          title={t('empty', { month: month || '—' })}
        />
      ) : (
        <>
          {/* Phone: held rows first, then the payable list. */}
          <div className="mt-6 space-y-3 sm:hidden" data-testid="payrun-phone">
            {[...held, ...data.rows.filter((r) => r.selectable)].map((r) => (
              <div
                key={r.invoiceId}
                className="rounded-xl border border-line bg-surface p-3"
                data-testid="payrun-invoice"
                data-status={r.selectable ? 'pay' : 'hold'}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p
                      className="truncate text-sm font-semibold text-ink"
                      {...originalProps(supplierLabel(r))}
                    >
                      {supplierLabel(r)}
                    </p>
                    <Link
                      href={`/dashboard/invoices/${r.invoiceId}`}
                      className="text-xs text-muted hover:text-ink"
                    >
                      {r.invoiceNumber ?? '—'} · {day(r.invoiceDate)}
                    </Link>
                  </div>
                  <Money value={r.totalInclVat} context="line" />
                </div>
                <div className="mt-2">{dueCell(r)}</div>
                <p className="mt-2 text-xs text-muted" data-testid="payrun-status">
                  {r.holds.length ? r.holds.map((h) => holdText(h, r)).join(' · ') : statusText(r)}
                </p>
                {actionCell(r) ? <div className="mt-2">{actionCell(r)}</div> : null}
              </div>
            ))}
          </div>

          {/* Desktop: one table per due bucket. */}
          <div className="mt-8 hidden space-y-8 sm:block">
            {rowsByBucket.map(({ bucket, rows }) => {
              const sum = rows.reduce((s, r) => s + Math.round(r.totalInclVat * 100), 0) / 100;
              return (
                <section
                  key={bucket}
                  data-testid={`payrun-bucket-${bucket}`}
                  aria-labelledby={`bucket-${bucket}`}
                >
                  <h2
                    id={`bucket-${bucket}`}
                    className="mb-2 flex items-baseline gap-2 text-base font-bold text-ink"
                  >
                    {t(`bucket.${bucket}`)}
                    <span className="text-sm font-normal text-muted">
                      {formatNumber(rows.length, locale)} · <Money value={sum} context="line" />
                    </span>
                  </h2>
                  <div className="overflow-x-auto rounded-xl border border-line">
                    <table className="w-full text-sm">
                      <thead className="bg-surface-2 text-xs text-muted">
                        <tr>
                          <th scope="col" className="px-3 py-2 text-start font-semibold">
                            {t('col.supplier')}
                          </th>
                          <th scope="col" className="px-3 py-2 text-start font-semibold">
                            {t('col.invoice')}
                          </th>
                          <th scope="col" className="px-3 py-2 text-start font-semibold">
                            {t('col.date')}
                          </th>
                          <th scope="col" className="px-3 py-2 text-start font-semibold">
                            {t('col.due')}
                          </th>
                          <th scope="col" className="px-3 py-2 text-right font-semibold">
                            {t('col.total')}
                          </th>
                          <th scope="col" className="px-3 py-2 text-right font-semibold">
                            {t('col.dispute')}
                          </th>
                          <th scope="col" className="px-3 py-2 text-start font-semibold">
                            {t('col.status')}
                          </th>
                          <th scope="col" className="px-3 py-2">
                            <span className="sr-only">{t('table.action')}</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line/60">
                        {rows.map((r) => (
                          <tr
                            key={r.invoiceId}
                            data-testid="payrun-invoice"
                            data-status={r.selectable ? 'pay' : 'hold'}
                            className="align-top"
                          >
                            <td
                              className="px-3 py-2 font-semibold text-ink"
                              {...originalProps(supplierLabel(r))}
                            >
                              {supplierLabel(r)}
                            </td>
                            <td className="px-3 py-2">
                              <Link
                                href={`/dashboard/invoices/${r.invoiceId}`}
                                className="font-semibold text-ink hover:text-primary"
                              >
                                {r.invoiceNumber ?? '—'}
                              </Link>
                            </td>
                            <td className="px-3 py-2 text-muted">{day(r.invoiceDate)}</td>
                            <td className="px-3 py-2">{dueCell(r)}</td>
                            <td className="px-3 py-2 text-right">
                              <Money value={r.totalInclVat} context="line" />
                            </td>
                            <td className="px-3 py-2 text-right">
                              {r.pendingIls > 0 ? (
                                <Money value={r.pendingIls} context="line" />
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="px-3 py-2" data-testid="payrun-status">
                              {r.holds.length ? (
                                <ul className="space-y-1">
                                  {r.holds.map((h, i) => (
                                    <li key={i}>
                                      <Badge tone={i === 0 ? toneOf(r) : 'neutral'}>
                                        {holdText(h, r)}
                                      </Badge>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <Badge tone={toneOf(r)}>{statusText(r)}</Badge>
                              )}
                            </td>
                            <td className="px-3 py-2">{actionCell(r)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}
      <p className="mt-6 text-xs text-subtle">{t('note')}</p>
    </div>
  );
}
