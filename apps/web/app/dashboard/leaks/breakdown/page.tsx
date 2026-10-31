import Link from 'next/link';
import { ArrowLeft, ArrowRight, ExternalLink, FileBarChart, FileCheck2, FileText, Hourglass, Info } from 'lucide-react';
import { createServerCaller } from '@/lib/trpc/server';
import { formatIls } from '@/lib/money';
import { formatDate, formatNumber, formatPercent } from '@/lib/i18n/format';
import { getLocale, getT } from '@/lib/i18n/server';
import { leaks as leaksNs } from '@/lib/i18n/messages/leaks';
import { approvals as approvalsNs } from '@/lib/i18n/messages/approvals';
import { Badge, Card, SectionHeader, type BadgeTone } from '@/lib/components';
import { sumAgora } from '../claims/letters';
import { LeakStateNote, leakStateOf } from '../leak-state';
import { zeroNoteOf } from '../states';
import {
  discrepancyLabel,
  displayName,
  resolutionLabel,
  severityLabel,
} from '../../approvals/vocab';
import { views as viewsNs } from '@/lib/i18n/messages/views';
import {
  DeltaBadge,
  compareSpanLabel,
  isThinBase,
  ViewToolbar,
  isDefaultData,
  localDay,
  parseView,
  rangeLabel,
  toViewInput,
} from '@/lib/components/views';

/**
 * Drill-down behind the hero leak number: every invoice that contributed to the
 * month's leak (largest first) with the discrepancy lines that caused it, then
 * the invoices calmly waiting for a PO link. `?m=-1` = previous month. Any
 * view param (period / compare / filters, see lib/components/views) switches
 * to that view; the plain URL stays the classic month drill-down.
 */
export default async function LeakBreakdownPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const m = Array.isArray(sp.m) ? sp.m[0] : sp.m;
  const parsed = Number.parseInt(m ?? '0', 10);
  const view = parseView(sp);
  const viewMode = !isDefaultData(view);
  const monthOffset = viewMode ? 0 : Number.isFinite(parsed) ? Math.min(0, Math.max(-24, parsed)) : 0;

  const caller = await createServerCaller();
  const [t, ta, tv, locale] = await Promise.all([getT(leaksNs), getT(approvalsNs), getT(viewsNs), getLocale()]);
  const viewInput = toViewInput(view);
  const [summary, rows, options] = await Promise.all([
    viewMode
      ? caller.owner.leakSummary({ view: viewInput, compare: view.compare })
      : monthOffset === 0 && view.compare !== 'off'
        ? // This month, compared like-for-like (the same day-span of the comparison period).
          Promise.all([
            caller.owner.leakHero({ monthOffset }),
            caller.owner.leakSummary({ view: { period: 'this_month' }, compare: view.compare }),
          ]).then(([current, aligned]) => ({ current, previous: aligned.previous }))
        : caller.owner.leakHero({ monthOffset }).then((current) => ({ current, previous: null })),
    viewMode
      ? caller.owner.leakBreakdown({ view: viewInput, limit: 200 })
      : caller.owner.leakBreakdown({ monthOffset, limit: 100 }),
    caller.owner.viewOptions(),
  ]);
  const hero = summary.current;
  const compact = view.density === 'compact';

  const ils = (v: number) => formatIls(v, { locale, maximumFractionDigits: 2 });
  const month = rangeLabel(viewMode ? view.period : 'this_month', hero.monthStart, hero.monthEnd, locale);
  // Claims are month-based (?m=): offer them for the month periods only.
  const claimsOffset = !viewMode ? monthOffset : view.period === 'this_month' ? 0 : view.period === 'last_month' ? -1 : null;
  // Every invoice that carries leak (a pending one too — its finding is in the hero); pending
  // invoices without leak wait calmly below.
  const leaking = rows.filter((r) => r.leakIls > 0);
  const pending = rows.filter((r) => r.pendingLink && r.leakIls <= 0);
  const state = leakStateOf(hero);
  const rowsTotal = sumAgora(leaking.map((r) => r.leakIls));
  // The list is capped (limit); anything it does not show is named, so Σ rows + rest = the hero.
  const notShownIls = Math.round((hero.leakIls - rowsTotal) * 100) / 100;
  const previous = summary.previous && summary.previous.invoiceCount > 0 ? summary.previous : null;
  const vs = previous
    ? tv('delta.vsSpan', compareSpanLabel(hero, previous, locale, new Date().toISOString()))
    : undefined;

  const navLink =
    'inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-semibold text-primary transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60';

  return (
    <div>
      <Link href="/dashboard" className={`${navLink} mb-3 -ms-2 text-muted`}>
        <ArrowRight className="h-4 w-4 ltr:-scale-x-100" aria-hidden="true" />
        {t('breakdown.back')}
      </Link>

      <SectionHeader level={1} title={t('breakdown.title')} subtitle={t('breakdown.subtitle', { month })} />

      <ViewToolbar
        page="breakdown"
        view={view}
        period
        compare
        density
        saved
        filters={['supplier', 'category', 'type', 'severity', 'status']}
        options={options}
        exportData={{
          columns: [
            { key: 'supplier', label: tv('csv.supplier') },
            { key: 'invoice', label: tv('csv.invoice') },
            { key: 'date', label: tv('csv.date') },
            { key: 'total', label: tv('csv.total') },
            { key: 'leak', label: tv('csv.leak') },
            { key: 'status', label: tv('csv.status') },
          ],
          rows: rows.map((r) => ({
            supplier: displayName(locale, r.supplierName, r.supplierNameEn),
            invoice: r.invoiceNumber ?? '',
            date: r.invoiceDate ? localDay(r.invoiceDate) : '',
            total: r.totalInclVat,
            leak: r.pendingLink ? null : r.leakIls,
            status: r.pendingLink ? t('breakdown.pendingTitle') : r.status === 'paid' ? t('breakdown.paid') : t('breakdown.unpaid'),
          })),
        }}
      />

      {/* Month switcher + total — the same number as the hero, to the agora (its rows sum to it). */}
      <Card
        padding="md"
        tone={state === 'leak' ? 'danger' : 'default'}
        className="relative mb-6 flex flex-col gap-4 overflow-hidden sm:flex-row sm:items-center sm:justify-between"
        data-view-region
      >
        {/* T1 — the one number: danger start rail when money leaked. */}
        {state === 'leak' ? <div className="absolute inset-y-0 start-0 w-1.5 bg-danger" aria-hidden="true" /> : null}
        <div>
          <p className="text-sm font-semibold text-muted">
            {viewMode && view.period !== 'this_month' ? t('breakdown.totalPeriod') : t('breakdown.total')} · {month}
          </p>
          {state === 'noData' ? (
            <p className="mt-1 text-4xl font-extrabold tabular-nums text-subtle" aria-label={t('states.noData')}>
              —
            </p>
          ) : (
            <p
              className="mt-1 text-4xl font-extrabold tabular-nums text-ink"
              data-testid="breakdown-total"
              data-amount={hero.leakIls}
              title={ils(hero.leakIls)}
            >
              <bdi>{ils(hero.leakIls)}</bdi>
            </p>
          )}
          {hero.leakPct != null ? (
            <p className="text-sm text-muted">{t('breakdown.ofSpend', { pct: formatPercent(hero.leakPct, locale, 1) })}</p>
          ) : null}
          {previous ? (
            <DeltaBadge
              className="mt-1"
              current={hero.leakIls}
              previous={previous.leakIls}
              compare={view.compare}
              thinBase={isThinBase(hero.spendIls, previous.spendIls)}
              vs={vs}
              showAmount
            />
          ) : null}
        </div>
        <nav className="flex flex-wrap items-center gap-2" aria-label={month}>
          <Link
            href={`/dashboard/leaks/report?month=${monthKey(hero.monthEnd)}`}
            className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-semibold text-primary ring-1 ring-line hover:bg-surface-2"
          >
            <FileBarChart className="h-4 w-4" aria-hidden="true" />
            {t('report.open')}
          </Link>
          {leaking.length > 0 && claimsOffset != null ? (
            <Link
              href={`/dashboard/leaks/claims${claimsOffset ? `?m=${claimsOffset}` : ''}`}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-sm font-semibold text-on-primary hover:brightness-90"
            >
              <FileCheck2 className="h-4 w-4" aria-hidden="true" />
              {t('claims.open')}
            </Link>
          ) : null}
          {!viewMode && monthOffset > -24 ? (
            <Link href={`/dashboard/leaks/breakdown?m=${monthOffset - 1}`} className={navLink}>
              <ArrowRight className="h-4 w-4 ltr:-scale-x-100" aria-hidden="true" />
              {t('breakdown.prevMonth')}
            </Link>
          ) : null}
          {!viewMode && monthOffset < 0 ? (
            <>
              <Link href={`/dashboard/leaks/breakdown?m=${monthOffset + 1}`} className={navLink}>
                {t('breakdown.nextMonth')}
                <ArrowLeft className="h-4 w-4 ltr:-scale-x-100" aria-hidden="true" />
              </Link>
              <Link href="/dashboard/leaks/breakdown" className={navLink}>
                {t('breakdown.thisMonth')}
              </Link>
            </>
          ) : null}
        </nav>
      </Card>

      {state === 'noData' ? (
        <LeakStateNote state="noData" labels={{ title: t('states.noData'), hint: t('states.noDataHint'), cta: t('states.noDataCta') }} />
      ) : leaking.length === 0 ? (
        <LeakStateNote
          state="clean"
          labels={{ title: t('states.clean', { count: formatNumber(hero.matchedInvoiceCount, locale) }), hint: t('states.cleanHint') }}
        />
      ) : (
        <div className="space-y-4" data-view-region>
          {leaking.map((inv) => {
            const supplier = displayName(locale, inv.supplierName, inv.supplierNameEn);
            const rawSum = inv.lines.filter((l) => l.countsAsLeak).reduce((s, l) => s + Math.abs(l.deltaAmount), 0);
            const capped = rawSum - inv.leakIls > 0.005;
            return (
              <Card key={inv.invoiceId} as="article" elevated padding="none" className="overflow-hidden">
                <header className="flex flex-col gap-2 border-b border-line p-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h2 className="text-base font-bold text-ink">
                      {supplier || '—'}
                      <span className="ms-2 text-sm font-normal text-muted">
                        {t('breakdown.invoice', { number: inv.invoiceNumber ?? t('breakdown.noNumber') })}
                      </span>
                    </h2>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-xs text-subtle">
                      {inv.invoiceDate ? formatDate(inv.invoiceDate, locale, { dateStyle: 'medium' }) : null}
                      {' · '}
                      {t('breakdown.invoiceTotal', { amount: ils(inv.totalInclVat) })}
                      {' · '}
                      <Badge tone={inv.status === 'paid' ? 'neutral' : 'warning'}>
                        {inv.status === 'paid' ? t('breakdown.paid') : t('breakdown.unpaid')}
                      </Badge>
                    </p>
                  </div>
                  <div className="shrink-0 sm:text-end">
                    <p className="text-xs font-semibold text-subtle">{t('breakdown.leak')}</p>
                    <p className="text-2xl font-extrabold tabular-nums text-ink" data-testid="breakdown-row" data-amount={inv.leakIls}>
                      {ils(inv.leakIls)}
                    </p>
                    {capped ? <p className="text-xs text-muted">{t('breakdown.capped')}</p> : null}
                  </div>
                </header>

                <ul className="divide-y divide-line">
                  {inv.lines.map((l) => {
                    const item =
                      displayName(locale, l.productName, l.productNameEn) ||
                      displayName(locale, l.lineDescription, l.lineDescriptionEn);
                    const noMoney = Math.abs(l.deltaAmount) < 0.005;
                    return (
                      <li
                        key={l.discrepancyId}
                        className={`flex flex-col gap-1 px-4 ${compact ? 'py-1.5' : 'py-3'} sm:flex-row sm:items-center sm:justify-between ${l.countsAsLeak && !noMoney ? '' : 'text-muted'}`}
                        data-testid={noMoney ? 'line-no-money' : 'line'}
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            {noMoney ? (
                              <Info className="h-4 w-4 shrink-0 text-info" aria-hidden="true" />
                            ) : (
                              <Badge tone={severityTone(l.severity)}>{severityLabel(ta, l.severity)}</Badge>
                            )}
                            <span className={noMoney ? 'font-medium' : 'font-semibold text-ink'}>{discrepancyLabel(ta, l.type)}</span>
                            {item ? <span className="text-sm text-muted">· {item}</span> : null}
                          </div>
                          <p className="mt-0.5 text-xs text-subtle">
                            {noMoney
                              ? zeroNoteOf(l, inv.lines) === 'billedShort'
                                ? t('breakdown.noMoneyShort')
                                : t('breakdown.noMoney')
                              : resolutionLabel(ta, l.resolutionStatus)}
                          </p>
                        </div>
                        {noMoney ? null : (
                          <div className="shrink-0 text-start sm:text-end">
                            <span
                              className={`font-semibold tabular-nums ${l.countsAsLeak ? 'text-ink' : 'text-muted line-through decoration-1'}`}
                            >
                              {ils(Math.abs(l.deltaAmount))}
                            </span>
                            {!l.countsAsLeak ? <span className="ms-2 text-xs text-subtle">{t('breakdown.notCounted')}</span> : null}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>

                <footer className="flex flex-wrap justify-end gap-3 border-t border-line bg-surface-2/50 px-4 py-2">
                  <Link
                    href="/dashboard/approvals"
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    {t('breakdown.decide')}
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                  <Link
                    href={`/dashboard/invoices/${inv.invoiceId}`}
                    className="inline-flex items-center gap-1 text-xs font-medium text-info hover:underline"
                  >
                    <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('breakdown.open')}
                  </Link>
                </footer>
              </Card>
            );
          })}
          <p
            className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm"
            data-testid="breakdown-rows-total"
            data-amount={rowsTotal}
          >
            <span className="font-semibold text-ink">{t('breakdown.rowsTotal', { count: formatNumber(leaking.length, locale) })}</span>
            <span className="text-lg font-bold tabular-nums text-ink">{ils(rowsTotal)}</span>
            {notShownIls > 0.005 ? (
              <span className="w-full text-xs text-muted">
                {t('breakdown.notShown', {
                  count: formatNumber(Math.max(1, hero.invoicesWithLeak - leaking.length), locale),
                  amount: ils(notShownIls),
                })}
              </span>
            ) : null}
          </p>
        </div>
      )}

      {pending.length > 0 ? (
        <section className="mt-10">
          <SectionHeader title={t('breakdown.pendingTitle')} subtitle={t('breakdown.pendingHint')} />
          <Card padding="none" className="divide-y divide-line">
            {pending.map((inv) => (
              <Link
                key={inv.invoiceId}
                href={`/dashboard/invoices/${inv.invoiceId}`}
                className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-surface-2/60"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Hourglass className="h-4 w-4 shrink-0 text-info" aria-hidden="true" />
                  <span className="truncate text-sm text-ink">
                    {displayName(locale, inv.supplierName, inv.supplierNameEn) || '—'} ·{' '}
                    {t('breakdown.invoice', { number: inv.invoiceNumber ?? t('breakdown.noNumber') })}
                  </span>
                </span>
                <span className="shrink-0 text-sm tabular-nums text-muted">{ils(inv.totalInclVat)}</span>
              </Link>
            ))}
          </Card>
        </section>
      ) : null}
    </div>
  );
}

function severityTone(severity: string): BadgeTone {
  return severity === 'block' ? 'danger' : severity === 'warn' ? 'warning' : 'info';
}

/**
 * 'YYYY-MM' of the local month that ENDS at `monthEndIso` (exclusive bound):
 * one hour earlier is still inside the month in Israel time.
 */
function monthKey(monthEndIso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' })
    .formatToParts(new Date(new Date(monthEndIso).getTime() - 3600_000));
  return `${parts.find((p) => p.type === 'year')?.value}-${parts.find((p) => p.type === 'month')?.value}`;
}
