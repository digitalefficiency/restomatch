import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Download, Hourglass, ListChecks, Mail, MessageCircle, Send, Sigma } from 'lucide-react';
import { createServerCaller } from '@/lib/trpc/server';
import { formatDate, formatNumber, formatPercent } from '@/lib/i18n/format';
import { getLocale, getT } from '@/lib/i18n/server';
import { reports as reportsNs } from '@/lib/i18n/messages/reports';
import { approvals as approvalsNs } from '@/lib/i18n/messages/approvals';
import { Badge, Card, cn } from '@/lib/components';
import { MetricTile, Money } from '@/lib/components/money';
import { discrepancyLabel, displayName } from '../../approvals/vocab';
import { PrintButton } from '../../leaks/claims/print-button';
import {
  REPORT_TABS,
  coverText,
  deltaOf,
  monthKey,
  monthOptions,
  monthsBetween,
  nextSteps,
  parseMonth,
  parseTab,
  previousMonth,
  reportHref,
  statusOf,
  toAgorot,
  totalsOf,
  type NextStep,
} from './logic';
import { rich } from './rich';
import '../report.css';

/**
 * "דוח החודש" (W3-08, owner decision I4): ONE copy of the month, in 3 tabs —
 * המספר וההוכחה · לפי ספק וסוג · כך זה נשלח — replacing the proof sheet, the
 * leak report, the monthly cards and the e-mail digest as separate pages.
 *
 * The number is the report's own (`monthlyReport.preview`: the frozen snapshot
 * once the month closed, else live), shown once. The by-supplier/type rows are
 * the live breakdown (`owner.leakReport`) and must add up to it; when a closed
 * month's live rows no longer do, a neutral note says so (the number never
 * restates). Owner/manager, flag `monthlyReport`. Read-only: nothing is sent.
 */
export default async function MonthReportPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[]; month?: string | string[]; m?: string | string[] }>;
}) {
  const caller = await createServerCaller();
  const flags = await caller.recovery.flags();
  if (!flags.monthlyReport) notFound();

  const sp = await searchParams;
  const now = new Date();
  const tab = parseTab(sp.tab);
  const month = parseMonth(sp, now);
  const thisMonth = monthKey(0, now);
  const offset = monthsBetween(thisMonth, month);

  const [t, ta, locale, preview] = await Promise.all([
    getT(reportsNs),
    getT(approvalsNs),
    getLocale(),
    caller.monthlyReport.preview({ month, locale: 'he' }),
  ]);
  // The e-mail / WhatsApp text in the viewer's language (the snapshot data is the same).
  const sentPreview = tab === 'sent' && locale !== 'he' ? await caller.monthlyReport.preview({ month, locale }) : preview;
  const { data, frozen } = preview;

  const status = statusOf({ frozen, generatedAt: data.generatedAt }, now);
  const monthName = formatDate(`${month}-15T12:00:00Z`, locale, { month: 'long', year: 'numeric' });
  const day = (iso: string) => formatDate(iso, locale, { day: 'numeric', month: 'numeric', year: 'numeric' });
  const num = (n: number) => formatNumber(n, locale);
  const pct = (r: number | null) => (r == null ? '—' : formatPercent(r, locale, 1));
  const [kicker, coverMonth, coverRestaurant] = coverText([t('coverKicker'), monthName, data.restaurantName]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 print:max-w-none print:space-y-4" data-testid="month-report" data-tab={tab}>
      {/* Print header (D11): the display face, never ₪. */}
      <p data-report-print-header className="report-display hidden border-b border-line pb-2 text-lg text-ink">
        {coverText([t('printHeader', { month: coverMonth!, restaurant: coverRestaurant! })])[0]}
      </p>

      {/* Cover (D11): month + restaurant in Frank Ruhl Libre; the status pill and controls in the app face. */}
      <div className="flex flex-wrap items-end justify-between gap-4" data-testid="report-cover">
        <div className="min-w-0">
          <p className="report-display text-base text-muted">{kicker}</p>
          <h1 className="report-display mt-1 text-3xl text-ink sm:text-4xl" data-testid="report-cover-title">
            {coverMonth}
          </h1>
          {coverRestaurant ? <p className="report-display mt-1 text-lg text-ink">{coverRestaurant}</p> : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge tone="neutral">
              <span data-testid="report-status" data-state={status.state}>
                {status.state === 'closed' ? t('status.closed', { date: day(status.closedOn) }) : t('status.open', { date: day(status.asOf) })}
              </span>
            </Badge>
            <span className="text-xs text-muted">{status.state === 'closed' ? t('status.closedHint') : t('status.openHint')}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2" data-print-hide>
          <form action="/dashboard/reports/monthly" method="get" className="flex items-center gap-2">
            <input type="hidden" name="tab" value={tab} />
            <label htmlFor="report-month" className="text-xs font-semibold text-muted">
              {t('month')}
            </label>
            <select
              id="report-month"
              name="month"
              defaultValue={month}
              data-testid="report-month"
              className="min-h-11 rounded-control border border-line bg-surface px-3 text-sm text-ink"
            >
              {monthOptions(now).map((m) => (
                <option key={m} value={m}>
                  {formatDate(`${m}-15T12:00:00Z`, locale, { month: 'long', year: 'numeric' })}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="inline-flex min-h-11 items-center rounded-control border border-line bg-surface-2 px-3 text-sm font-semibold text-ink hover:border-primary/40"
            >
              {t('show')}
            </button>
          </form>
          <PrintButton label={t('print')} />
        </div>
      </div>

      <nav aria-label={t('tabsLabel')} className="flex w-full gap-1 overflow-x-auto rounded-xl bg-surface-2 p-1 sm:w-fit" data-testid="report-tabs">
        {REPORT_TABS.map((k) => (
          <Link
            key={k}
            href={reportHref(k, month)}
            aria-current={tab === k ? 'page' : undefined}
            data-testid={`report-tab-${k}`}
            className={cn(
              'inline-flex min-h-11 shrink-0 items-center rounded-lg px-4 py-1.5 text-sm font-semibold',
              tab === k ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink',
            )}
          >
            {t(`tabs.${k}`)}
          </Link>
        ))}
      </nav>

      {tab === 'proof' ? (
        <ProofTab />
      ) : tab === 'by' ? (
        <ByTab />
      ) : (
        <SentTab />
      )}
    </div>
  );

  /* ───────────────────────── המספר וההוכחה ───────────────────────── */
  async function ProofTab() {
    const prevOffset = offset - 1;
    const needSuppliers = data.nextActions.some((a) => a.code === 'talkToSupplier');
    const [prevHero, live] = await Promise.all([
      prevOffset >= -24 ? caller.owner.leakHero({ monthOffset: prevOffset }).catch(() => null) : Promise.resolve(null),
      needSuppliers ? caller.owner.leakReport({ month }).catch(() => null) : Promise.resolve(null),
    ]);
    const delta = deltaOf(data.leakAgorot, prevHero ? toAgorot(prevHero.leakIls) : null);
    const prevName = formatDate(`${previousMonth(month)}-15T12:00:00Z`, locale, { month: 'long' });
    const steps = nextSteps(data.nextActions, { month, thisMonth, suppliers: live?.bySupplier });
    const undecided = data.nextActions.find((a) => a.code === 'decideOpen');
    const tracked = data.recoveryTracked !== false;

    return (
      <div className="space-y-6" data-testid="report-proof">
        {/* T1 — the number, once. */}
        <Card padding="lg" elevated className={cn('relative overflow-hidden', data.leakAgorot > 0 ? 'border-danger/35' : undefined)}>
          {data.leakAgorot > 0 ? <div className="absolute inset-y-0 start-0 w-1.5 bg-danger" aria-hidden="true" /> : null}
          <div className="flex items-start gap-3">
            <Sigma className="mt-2 h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-ink">{t('proof.numberTitle')}</h2>
              <p className="mt-1 text-ink" data-testid="report-number" data-agorot={data.leakAgorot}>
                <Money agorot={data.leakAgorot} context="hero" decimals={2} state={data.leakAgorot > 0 ? 'leak' : 'zero'} locale={locale} />
              </p>
              {delta ? (
                <p
                  className={cn('mt-1 text-sm font-semibold', delta.bad ? 'text-danger' : 'text-muted')}
                  data-testid="report-delta"
                  data-direction={delta.direction}
                >
                  {delta.direction === 'same'
                    ? t('delta.same', { month: prevName })
                    : rich(t(delta.direction === 'up' ? 'delta.up' : 'delta.down', { amount: '{amount}', month: prevName }), {
                        amount: <Money agorot={Math.abs(delta.agorot)} context="inline" decimals={2} locale={locale} />,
                      })}
                </p>
              ) : null}
              <p className="mt-3 text-sm text-ink">
                {t('proof.number', { withLeak: num(data.invoicesWithLeak), total: num(data.invoiceCount) })}
              </p>
              <p className="mt-1 text-sm text-muted" data-testid="report-pct">
                {data.spendAgorot > 0
                  ? rich(t('proof.pct', { pct: pct(data.leakPct), spend: '{spend}' }), {
                      spend: <Money agorot={data.spendAgorot} context="inline" locale={locale} />,
                    })
                  : t('proof.pctNone')}
              </p>
            </div>
          </div>
        </Card>

        {/* T4 — pending invoices: neutral, never an alarm. */}
        <Card padding="lg" className="bg-surface-2" data-testid="report-pending">
          <div className="flex items-start gap-3">
            <Hourglass className="mt-0.5 h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-ink">{t('proof.pendingTitle')}</h2>
              <p className="mt-1 text-sm text-muted">
                {data.pendingLinkCount > 0 ? t('proof.pending', { count: num(data.pendingLinkCount) }) : t('proof.pendingNone')}
              </p>
            </div>
          </div>
        </Card>

        {/* What happened to the money: T3 calm good news, T4 neutral for what is still open. */}
        <section aria-labelledby="report-money">
          <h2 id="report-money" className="mb-3 text-base font-bold text-ink">
            {t('proof.moneyTitle')}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="report-money-states">
            <MetricTile
              label={t('proof.claimed')}
              state="claimed"
              value={<Money agorot={data.claimedAgorot} context="tile" locale={locale} />}
              context={t('proof.claimedHint')}
            />
            {tracked ? (
              <MetricTile
                label={t('proof.returned')}
                state="returned"
                value={<Money agorot={data.returnedAgorot} context="tile" locale={locale} />}
                context={t('proof.returnedHint')}
              />
            ) : null}
            {tracked ? (
              <MetricTile
                label={t('proof.awaiting')}
                state="pending"
                value={<Money agorot={data.outstandingAgorot} context="tile" locale={locale} />}
                context={t('proof.awaitingHint')}
              />
            ) : null}
            <MetricTile
              label={t('proof.undecided')}
              state="pending"
              value={<Money agorot={undecided ? Number(undecided.params.agorot ?? 0) : 0} context="tile" locale={locale} />}
              context={t('proof.undecidedHint')}
            />
          </div>
        </section>

        {/* Next steps: T2 rows (₪ + one verb link); "all clear" is calm. */}
        <section aria-labelledby="report-next" data-testid="report-next">
          <h2 id="report-next" className="mb-3 text-base font-bold text-ink">
            {t('proof.nextTitle')}
          </h2>
          <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
            {steps.map((s, i) => (
              <StepRow key={`${s.code}-${i}`} step={s} />
            ))}
          </ul>
        </section>

        {/* Audit screen: the rules are the content, so they stay open (IA-SPEC:162). */}
        <Card padding="lg">
          <div className="flex items-start gap-3">
            <ListChecks className="mt-0.5 h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-ink">{t('proof.rulesTitle')}</h2>
              <p className="mt-1 text-sm text-muted">{t('proof.rules')}</p>
              <Link
                href={`/dashboard/leaks/breakdown${offset ? `?m=${offset}` : ''}`}
                data-print-hide
                className="mt-2 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary hover:underline"
              >
                {t('proof.explainLink')}
                <ArrowLeft className="h-4 w-4 ltr:-scale-x-100" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  function StepRow({ step }: { step: NextStep }) {
    if (step.tier === 'T3') {
      return (
        <li className="px-4 py-3 text-sm font-semibold text-primary" data-testid="report-step" data-tier="T3" data-code={step.code}>
          {t('next.allClear')}
        </li>
      );
    }
    const label =
      step.code === 'talkToSupplier'
        ? t('next.talkToSupplier', { supplier: locale === 'en' ? step.supplier!.en : step.supplier!.he, pct: pct(step.pct ?? 0) })
        : t(`next.${step.code}`, { count: num(step.count ?? 0) });
    return (
      <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" data-testid="report-step" data-tier="T2" data-code={step.code}>
        <span className="flex min-w-0 items-center gap-2 text-sm text-ink">
          <span className="h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden="true" />
          {label}
        </span>
        <span className="flex shrink-0 items-center gap-3">
          {step.agorot != null ? (
            <span className="text-sm font-bold text-ink">
              <Money agorot={step.agorot} context="line" locale={locale} />
            </span>
          ) : null}
          {step.href ? (
            <Link
              href={step.href}
              data-print-hide
              className="inline-flex min-h-11 items-center gap-1 rounded-control border border-line bg-surface-2 px-3 text-sm font-semibold text-ink hover:border-primary/40"
            >
              {t(`next.${step.code as Exclude<NextStep['code'], 'allClear'>}Cta`)}
              <ArrowLeft className="h-4 w-4 ltr:-scale-x-100" aria-hidden="true" />
            </Link>
          ) : null}
        </span>
      </li>
    );
  }

  /* ───────────────────────── לפי ספק וסוג ───────────────────────── */
  async function ByTab() {
    const report = await caller.owner.leakReport({ month });
    const bySupplier = report.bySupplier;
    const supplierTotal = totalsOf(
      bySupplier.map((r) => r.leakIls),
      data.leakAgorot,
    );
    const typeTotal = totalsOf(
      report.byType.map((r) => r.amountIls),
      data.leakAgorot,
    );
    const liveGap = toAgorot(report.hero.leakIls) - data.leakAgorot;
    const breakdown = `/dashboard/leaks/breakdown${offset ? `?m=${offset}` : ''}`;
    const th = 'py-2 pe-3 font-semibold';

    return (
      <div className="space-y-6" data-testid="report-by">
        {frozen && liveGap !== 0 ? (
          <Card padding="md" className="bg-surface-2" data-testid="report-restated-note">
            <p className="text-sm text-muted">
              {rich(t('by.restatedNote', { amount: '{amount}', gap: '{gap}' }), {
                amount: <Money agorot={data.leakAgorot} context="inline" decimals={2} locale={locale} />,
                gap: <Money agorot={Math.abs(liveGap)} context="inline" decimals={2} locale={locale} />,
              })}
            </p>
          </Card>
        ) : null}

        {bySupplier.length === 0 && report.byType.length === 0 ? (
          <Card padding="lg">
            <p className="text-sm text-muted">{t('by.none')}</p>
          </Card>
        ) : null}

        {bySupplier.length > 0 ? (
          <section aria-labelledby="report-by-supplier">
            <h2 id="report-by-supplier" className="mb-2 text-base font-bold text-ink">
              {t('by.supplierTitle')}
            </h2>
            <div className="overflow-x-auto rounded-card border border-line bg-surface" tabIndex={0} role="region" aria-labelledby="report-by-supplier">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="border-b border-line text-xs text-subtle">
                  <tr>
                    <th scope="col" className={cn(th, 'ps-4 text-start')}>{t('by.colSupplier')}</th>
                    <th scope="col" className={cn(th, 'text-end')}>{t('by.colLeak')}</th>
                    <th scope="col" className={cn(th, 'text-end')}>{t('by.colPct')}</th>
                    <th scope="col" className={cn(th, 'text-end')}>{t('by.colSpend')}</th>
                    <th scope="col" className={cn(th, 'pe-4 text-end')}>{t('by.colInvoices')}</th>
                  </tr>
                </thead>
                <tbody>
                  {bySupplier.map((r) => {
                    const name = displayName(locale, r.supplierName, r.supplierNameEn) || t('by.noSupplier');
                    return (
                      <tr key={r.supplierId ?? 'none'} className="border-b border-line/60" data-testid="report-supplier-row">
                        <td className="py-2 pe-3 ps-4 text-ink">
                          {r.supplierId ? (
                            <Link href={`/dashboard/suppliers/${r.supplierId}`} className="font-medium hover:text-primary hover:underline">
                              {name}
                            </Link>
                          ) : (
                            name
                          )}
                        </td>
                        <td className={cn('py-2 pe-3 text-end font-semibold', r.leakIls > 0 ? 'text-ink' : 'text-subtle')}>
                          <Money value={r.leakIls} context="line" locale={locale} />
                        </td>
                        <td className="py-2 pe-3 text-end text-muted">{pct(r.leakPct)}</td>
                        <td className="py-2 pe-3 text-end text-muted">
                          <Money value={r.spendIls} context="inline" locale={locale} />
                        </td>
                        <td className="py-2 pe-4 text-end text-muted">{num(r.invoiceCount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" className="py-2 pe-3 ps-4 text-start font-semibold text-ink">{t('by.total')}</th>
                    <td className="py-2 pe-3 text-end font-bold text-ink" data-testid="report-supplier-total" data-agorot={supplierTotal.sumAgorot}>
                      <Money agorot={supplierTotal.sumAgorot} context="line" locale={locale} />
                    </td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        ) : null}

        {report.byType.length > 0 ? (
          <section aria-labelledby="report-by-type">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="report-by-type" className="text-base font-bold text-ink">
                {t('by.typeTitle')}
              </h2>
              <Link href={breakdown} data-print-hide className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary hover:underline">
                {t('by.toBreakdown')}
                <ArrowLeft className="h-4 w-4 ltr:-scale-x-100" aria-hidden="true" />
              </Link>
            </div>
            <div className="overflow-x-auto rounded-card border border-line bg-surface" tabIndex={0} role="region" aria-labelledby="report-by-type">
              <table className="w-full min-w-[420px] text-sm">
                <thead className="border-b border-line text-xs text-subtle">
                  <tr>
                    <th scope="col" className={cn(th, 'ps-4 text-start')}>{t('by.colType')}</th>
                    <th scope="col" className={cn(th, 'text-end')}>{t('by.colCount')}</th>
                    <th scope="col" className={cn(th, 'pe-4 text-end')}>{t('by.colAmount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.byType.map((r) => (
                    <tr key={r.type} className="border-b border-line/60" data-testid="report-type-row">
                      <td className="py-2 pe-3 ps-4 text-ink">
                        <Link href={breakdown} className="hover:text-primary hover:underline">
                          {discrepancyLabel(ta, r.type)}
                        </Link>
                      </td>
                      <td className="py-2 pe-3 text-end text-muted">{num(r.count)}</td>
                      <td className="py-2 pe-4 text-end text-ink">
                        <Money value={r.amountIls} context="line" locale={locale} />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" className="py-2 pe-3 ps-4 text-start font-semibold text-ink">{t('by.total')}</th>
                    <td />
                    <td className="py-2 pe-4 text-end font-bold text-ink" data-testid="report-type-total" data-agorot={typeTotal.sumAgorot}>
                      <Money agorot={typeTotal.sumAgorot} context="line" locale={locale} />
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {!frozen && typeTotal.gapAgorot > 0 ? (
              <p className="mt-2 text-xs text-muted" data-testid="report-cap-note">
                {rich(t('by.capNote', { amount: '{amount}' }), {
                  amount: <Money agorot={typeTotal.gapAgorot} context="inline" decimals={2} locale={locale} />,
                })}
              </p>
            ) : null}
          </section>
        ) : null}
      </div>
    );
  }

  /* ───────────────────────── כך זה נשלח ───────────────────────── */
  async function SentTab() {
    const digest = flags.monthlyDigestPreview ? await caller.monthlyReport.digest({ month, locale }).catch(() => null) : null;
    const { email, whatsapp } = sentPreview;
    const pdfLink =
      'inline-flex min-h-11 items-center gap-1.5 rounded-control border border-line bg-surface-2 px-3 py-2 text-sm font-semibold text-ink hover:border-primary/40';

    return (
      <div className="space-y-6" data-testid="report-sent">
        <Card padding="lg">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-base font-bold text-ink">
              <Mail className="h-4 w-4 text-muted" aria-hidden="true" />
              {t('sent.emailTitle')}
            </h2>
            <span className="inline-flex items-center gap-2" data-print-hide>
              <button
                type="button"
                disabled
                aria-disabled="true"
                className="inline-flex min-h-11 cursor-not-allowed items-center gap-1.5 rounded-control border border-line bg-surface px-3 text-sm font-semibold text-muted"
                data-testid="report-copy-me"
              >
                <Send className="h-4 w-4" aria-hidden="true" />
                {t('sent.copyMe')}
              </button>
              <Badge tone="neutral">{t('sent.soon')}</Badge>
            </span>
          </div>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted">{t('sent.subject')}</dt>
            <dd className="text-ink" dir="auto" data-testid="report-email-subject">
              {email.subject}
            </dd>
            {digest ? (
              <>
                <dt className="text-muted">{t('sent.to')}</dt>
                <dd className="text-ink" dir="ltr">
                  {digest.to.length ? digest.to.join(', ') : <span dir="auto">{t('sent.noRecipient')}</span>}
                </dd>
                <dt className="sr-only">{t('sent.sendOn', { date: '' })}</dt>
                <dd className="col-span-2 text-muted">
                  {frozen ? t('sent.sentOn', { date: day(data.generatedAt) }) : t('sent.sendOn', { date: day(`${digest.sendOn}T09:00:00Z`) })}
                </dd>
              </>
            ) : null}
          </dl>
          <iframe
            title={t('sent.emailFrame')}
            srcDoc={email.html}
            sandbox=""
            data-testid="report-email-frame"
            className="mt-4 h-[640px] w-full rounded-card border border-line bg-surface"
          />
        </Card>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          <Card padding="lg">
            <h2 className="flex items-center gap-2 text-base font-bold text-ink">
              <MessageCircle className="h-4 w-4 text-muted" aria-hidden="true" />
              {t('sent.whatsappTitle')}
            </h2>
            <pre
              dir={locale === 'he' ? 'rtl' : 'ltr'}
              className="mt-3 max-w-md whitespace-pre-wrap rounded-2xl rounded-ss-sm bg-surface-2 p-4 font-sans text-sm leading-relaxed text-ink"
              data-testid="report-whatsapp"
            >
              {whatsapp}
            </pre>
            <p className="mt-2 text-xs text-muted">{t('sent.whatsappNote')}</p>
          </Card>
          <Card padding="lg">
            <h2 className="flex items-center gap-2 text-base font-bold text-ink">
              <Download className="h-4 w-4 text-muted" aria-hidden="true" />
              {t('sent.pdfTitle')}
            </h2>
            <div className="mt-3 flex flex-wrap gap-2" data-print-hide>
              <a href={`/dashboard/reports/monthly/pdf?month=${month}&locale=he`} className={pdfLink} data-testid="report-pdf-he">
                {t('sent.downloadHe')}
              </a>
              <a href={`/dashboard/reports/monthly/pdf?month=${month}&locale=en`} className={pdfLink}>
                {t('sent.downloadEn')}
              </a>
            </div>
          </Card>
        </div>
        <p className="text-center text-xs text-subtle">{t('sent.note')}</p>
      </div>
    );
  }
}
