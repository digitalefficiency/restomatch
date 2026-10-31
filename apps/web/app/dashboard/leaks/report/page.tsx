import Link from 'next/link';
import { WithOriginal } from '@/lib/i18n/original';
import { auth } from '@/auth';
import { TRPCError } from '@trpc/server';
import { ArrowLeft, ArrowRight, Lock } from 'lucide-react';
import { createServerCaller } from '@/lib/trpc/server';
import { formatIls } from '@/lib/money';
import { formatDate, formatDateTime, formatNumber, formatPercent } from '@/lib/i18n/format';
import { getLocale, getT } from '@/lib/i18n/server';
import { leaks as leaksNs } from '@/lib/i18n/messages/leaks';
import { approvals as approvalsNs } from '@/lib/i18n/messages/approvals';
import { activeMembershipOf } from '@/lib/activeRestaurant';
import { Card, SectionHeader } from '@/lib/components';
import { discrepancyLabel, displayName } from '../../approvals/vocab';
import { PrintButton } from '../claims/print-button';
import { views as viewsNs } from '@/lib/i18n/messages/views';
import { DeltaBadge, ViewToolbar, compareSpanLabel, isThinBase, parseView } from '@/lib/components/views';
import { approvedNotClaimed, sumAgora } from '../claims/letters';
import { ALL_CLAIMS } from '../../recovery/logic';
import { LeakStateNote, leakStateOf } from '../leak-state';
import { noDataCtaFor } from '../states';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** 'YYYY-MM' of the current month in Israel time. */
function currentMonth(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' })
    .formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  return `${y}-${m}`;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Whole months from `a` back to `b` ('YYYY-MM'), ≤ 0 for a past month. */
function monthsBetween(from: string, to: string): number {
  const [ay, am] = from.split('-').map(Number) as [number, number];
  const [by, bm] = to.split('-').map(Number) as [number, number];
  return (by - ay) * 12 + (bm - am);
}

/**
 * Print-ready monthly leak report (A4). Owner/manager only. `?month=YYYY-MM`,
 * defaulting to the current month. The compare is like-for-like: a month still
 * running is compared with the same day-span of the comparison month
 * (owner.leakSummary's aligned compare, "1–25 באוק׳ מול 1–25 בספט׳"); a month
 * that ended, full against full. The money story is one partition that adds up
 * to the agora: ממתין להחלטה + אושר לדרישה + ויתרנו = נמצא.
 */
export default async function LeakReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const thisMonth = currentMonth();
  const monthParam = Array.isArray(sp.month) ? sp.month[0] : sp.month;
  const month = monthParam && MONTH_RE.test(monthParam) && monthParam <= thisMonth ? monthParam : thisMonth;
  const openMonth = month === thisMonth;
  // `?cmp=prev|yoy` (default prev) adds ▲/▼ against the previous month or the same month last year.
  const view = parseView(sp);
  const compareMonth = view.compare === 'off' ? null : shiftMonth(month, view.compare === 'yoy' ? -12 : -1);

  const caller = await createServerCaller();
  const session = await auth();
  const [t, ta, tv, locale] = await Promise.all([getT(leaksNs), getT(approvalsNs), getT(viewsNs), getLocale()]);
  const role = (session?.user as { role?: string } | undefined)?.role;

  // owner|manager only — a calm T4 card for other roles (never an alarm).
  if (role !== 'owner' && role !== 'manager') {
    return <RoleCard title={t('report.title')} body={t('report.roleOnly')} />;
  }
  let report: Awaited<ReturnType<typeof caller.owner.leakReport>>;
  let previous: { leakIls: number; spendIls: number; invoiceCount: number; monthStart: string; monthEnd: string } | null = null;
  try {
    const [r, prev] = await Promise.all([
      caller.owner.leakReport({ month }),
      compareMonth == null
        ? Promise.resolve(null)
        : openMonth
          ? // Still running: the same to-date stretch of the comparison period.
            caller.owner.leakSummary({ view: { period: 'this_month' }, compare: view.compare }).then((s) => s.previous)
          : caller.owner.leakReport({ month: compareMonth }).then((p) => p.hero),
    ]);
    report = r;
    previous = prev && prev.invoiceCount > 0 ? prev : null;
  } catch (err) {
    if (err instanceof TRPCError && err.code === 'FORBIDDEN') {
      return <RoleCard title={t('report.title')} body={t('report.roleOnly')} />;
    }
    throw err;
  }
  const monthOffset = monthsBetween(thisMonth, month);
  const [memberships, profile, lines, flags] = await Promise.all([
    caller.onboarding.myMemberships(),
    caller.settings.profile(),
    monthOffset >= -24 ? caller.owner.leakBreakdown({ monthOffset, limit: 200 }).catch(() => []) : Promise.resolve([]),
    caller.recovery.flags(),
  ]);
  // Approved lines no ₪-back claim holds (only meaningful with the tracker on).
  const tracked = flags.recovery ? await caller.recovery.list({ limit: ALL_CLAIMS }).catch(() => null) : null;
  // The report names the ACTIVE restaurant (never memberships[0]).
  const restaurant = activeMembershipOf(memberships, session?.user?.restaurantId)?.restaurantName ?? profile.name ?? '';
  const businessId = profile.businessId?.trim() || null;

  const { hero, status } = report;
  const nowIso = new Date().toISOString();
  const ils = (v: number, digits = 2) => formatIls(v, { locale, maximumFractionDigits: digits });
  const pct = (v: number) => formatPercent(v, locale, 1);
  // One decimal always ("2.0%", never "2%" beside "2.1%").
  const pct1 = (v: number) => formatNumber(v, locale, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const num = (v: number) => formatNumber(v, locale);
  const monthLabel = formatDate(hero.monthStart, locale, { month: 'long', year: 'numeric' });
  const typeTotal = sumAgora(report.byType.map((r) => r.amountIls));
  const supplierLeakTotal = sumAgora(report.bySupplier.map((r) => r.leakIls));
  const supplierSpendTotal = sumAgora(report.bySupplier.map((r) => r.spendIls));
  const state = leakStateOf(hero);
  const found = sumAgora([status.stillOpenIls, status.claimedIls, status.waivedIls]);
  const checkedCount = Math.max(0, hero.invoiceCount - hero.pendingLinkCount - hero.awaitingCountCount - hero.awaitingQuestionCount);
  // "טופל" lines count as approved-to-claim but no letter claims them: say so, in ₪.
  const resolved = (tracked ? approvedNotClaimed(lines, tracked) : []).map(({ invoice, line }) => ({
    amount: Math.abs(line.deltaAmount),
    type: line.type,
    supplier: displayName(locale, invoice.supplierName, invoice.supplierNameEn),
  }));
  const resolvedIls = sumAgora(resolved.map((r) => r.amount));
  const resolvedItems = [...new Set(resolved.map((r) => `${discrepancyLabel(ta, r.type)}, ${r.supplier}`))].slice(0, 3).join(' · ');
  const span = previous
    ? openMonth
      ? compareSpanLabel(hero, previous, locale, nowIso)
      : {
          current: monthLabel,
          previous: formatDate(previous.monthStart, locale, { month: 'long', year: 'numeric' }),
        }
    : null;
  const vs = span ? t('report.compareSpan', span) : undefined;
  const cmpQ = view.compare !== 'prev' ? `&cmp=${view.compare}` : '';
  const navLink =
    'inline-flex min-h-11 items-center gap-1 rounded-lg px-2 py-1 text-sm font-semibold text-primary hover:text-ink';

  return (
    <div>
      {/* A4 print: only the report sheet, on white, with tight margins. */}
      <style>{`
        @page { size: A4; margin: 12mm; }
        @media print {
          html, body { background: #fff !important; background-image: none !important; }
          body * { visibility: hidden !important; }
          #leak-report, #leak-report * { visibility: visible !important; }
          #leak-report { position: absolute; inset: 0 auto auto 0; width: 100%; max-width: none; margin: 0; padding: 0;
            color: #111 !important; background: #fff !important; border: 0 !important; box-shadow: none !important; }
          #leak-report * { color: #111 !important; border-color: #ccc !important; background: transparent !important; box-shadow: none !important; }
          #leak-report .rm-print-accent { color: #b4123a !important; }
          #leak-report .rm-bar { background: #b4123a !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          #leak-report section { break-inside: avoid; }
        }
      `}</style>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/dashboard/leaks" className={`${navLink} -ms-2 text-muted`}>
          <ArrowRight className="h-4 w-4 ltr:-scale-x-100" aria-hidden="true" />
          {t('hub.title')}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/dashboard/leaks/report?month=${shiftMonth(month, -1)}${cmpQ}`} className={navLink}>
            <ArrowRight className="h-4 w-4 ltr:-scale-x-100" aria-hidden="true" />
            {t('report.prevMonth')}
          </Link>
          {month < thisMonth ? (
            <Link href={`/dashboard/leaks/report?month=${shiftMonth(month, 1)}${cmpQ}`} className={navLink}>
              {t('report.nextMonth')}
              <ArrowLeft className="h-4 w-4 ltr:-scale-x-100" aria-hidden="true" />
            </Link>
          ) : null}
          <PrintButton label={t('report.print')} />
        </div>
      </div>

      <ViewToolbar
        page="report"
        view={view}
        compare
        exportData={{
          columns: [
            { key: 'type', label: tv('csv.type') },
            { key: 'count', label: t('report.colCount') },
            { key: 'amount', label: t('report.colAmount') },
          ],
          rows: report.byType.map((r) => ({ type: discrepancyLabel(ta, r.type), count: r.count, amount: r.amountIls })),
        }}
      />

      <article
        id="leak-report"
        data-view-region
        className="mx-auto max-w-[210mm] space-y-6 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-8"
      >
        <header className="flex flex-col gap-1 border-b border-line pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-extrabold text-ink">{t('report.title')}</h1>
            <p className="text-sm text-muted" data-testid="report-subtitle">
              <WithOriginal text={t('report.subtitle', { restaurant, month: monthLabel })} value={restaurant} />
              {businessId ? <span> · {t('report.businessId', { id: businessId })}</span> : null}
            </p>
          </div>
          <p className="text-xs text-subtle" data-testid="report-freshness">
            {openMonth ? t('report.openMonth', { date: formatDateTime(nowIso, locale) }) : t('report.closedMonth')}
          </p>
        </header>

        {/* Headline */}
        <section className="grid gap-4 sm:grid-cols-[1.3fr_1fr] sm:items-end">
          {/* T1 — the one number: danger start rail + ink figure when money leaked. */}
          <div className={state === 'leak' ? 'relative border-s-4 border-danger ps-4' : undefined}>
            <p className="text-sm font-semibold text-muted">{t('report.headline')}</p>
            {state === 'noData' ? (
              <p className="text-5xl font-extrabold tabular-nums text-subtle" aria-label={t('states.noData')}>
                —
              </p>
            ) : (
              <p className="rm-print-accent text-5xl font-extrabold tabular-nums text-ink" data-testid="report-leak" title={ils(hero.leakIls)}>
                <bdi>{ils(hero.leakIls)}</bdi>
              </p>
            )}
            <p className="mt-1 text-base font-semibold text-ink">
              {hero.leakPct != null ? t('report.ofSpend', { pct: pct(hero.leakPct) }) : t('report.noSpend')}
            </p>
            {hero.spendIls > 0 ? (
              <p className="text-sm text-muted">{t('report.spendBase', { spend: ils(hero.spendIls, 0), count: num(checkedCount) })}</p>
            ) : null}
            {previous && vs ? (
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1" data-testid="report-compare">
                <DeltaBadge
                  current={hero.leakIls}
                  previous={previous.leakIls}
                  compare={view.compare}
                  thinBase={isThinBase(hero.spendIls, previous.spendIls)}
                  vs={vs}
                  showAmount
                />
                <DeltaBadge
                  current={hero.spendIls}
                  previous={previous.spendIls}
                  compare={view.compare}
                  thinBase={isThinBase(hero.spendIls, previous.spendIls)}
                  vs={vs}
                  neutral
                />
              </div>
            ) : null}
          </div>
          {hero.pendingLinkCount > 0 ? (
            <p className="rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-muted">
              {t('report.pending', { count: num(hero.pendingLinkCount), amount: ils(hero.pendingLinkIls) })}
            </p>
          ) : null}
          {hero.awaitingQuestionCount > 0 ? (
            <p data-testid="report-awaiting-question" className="rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-muted">
              {t('report.awaitingQuestion', { count: num(hero.awaitingQuestionCount), amount: ils(hero.awaitingQuestionIls) })}{' '}
              <Link href="/dashboard/catalog/mapping" className="font-semibold text-primary underline-offset-2 hover:underline">
                {t('report.awaitingQuestionCta')}
              </Link>
            </p>
          ) : null}
        </section>

        {state === 'noData' ? (
          <LeakStateNote state="noData" labels={{ title: t('states.noData'), hint: t('states.noDataHint') }}
            cta={noDataCtaFor(role, t('states.noDataCta'))}
          />
        ) : state === 'clean' ? (
          <LeakStateNote
            state="clean"
            labels={{ title: t('report.empty', { count: num(hero.matchedInvoiceCount) }), hint: t('states.cleanHint') }}
          />
        ) : (
          <>
            {/* What happened to the money — one partition of what was found. */}
            <section data-testid="report-status">
              <h2 className="mb-2 text-base font-bold text-ink">{t('report.statusTitle')}</h2>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-sm font-semibold text-muted">{t('report.found')}</span>
                <span className="text-xl font-bold tabular-nums text-ink" data-testid="report-found" data-amount={found}>
                  {ils(found)}
                </span>
                {hero.caughtBeforePaymentIls > 0 ? (
                  <span className="rounded-full bg-gold/12 px-2.5 py-0.5 text-xs font-semibold text-gold ring-1 ring-gold/25">
                    {t('report.caughtChip', { amount: ils(hero.caughtBeforePaymentIls) })}
                  </span>
                ) : null}
              </div>
              <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Stat label={t('report.stillOpen')} value={ils(status.stillOpenIls)} amount={status.stillOpenIls} hint={t('report.lines', { count: num(status.stillOpenCount) })} />
                <Stat
                  label={t('report.claimed')}
                  value={ils(status.claimedIls)}
                  amount={status.claimedIls}
                  hint={t('report.claimedHint', { count: num(status.claimedCount), suppliers: num(status.creditRequestSuppliers) })}
                />
                <Stat label={t('report.waived')} value={ils(status.waivedIls)} amount={status.waivedIls} hint={t('report.lines', { count: num(status.waivedCount) })} />
              </dl>
              <p className="mt-2 text-xs text-subtle">{t('report.partition')}</p>
              {resolvedIls > 0 ? (
                <p className="mt-1 text-xs text-muted" data-testid="report-resolved-note">
                  {t('report.resolvedNote', { amount: ils(resolvedIls), items: resolvedItems })}
                </p>
              ) : null}
              {report.capAdjustmentIls > 0 ? (
                <p className="mt-1 text-xs text-muted">{t('report.capNoteShort', { amount: ils(report.capAdjustmentIls) })}</p>
              ) : null}
            </section>

            {/* By type */}
            <section>
              <h2 id="report-byTypeTitle" className="mb-2 text-base font-bold text-ink">{t('report.byTypeTitle')}</h2>
              <div className="overflow-x-auto" tabIndex={0} role="region" aria-labelledby="report-byTypeTitle">
                <table className="w-full min-w-[420px] text-sm">
                  <thead className="border-b border-line text-xs text-subtle">
                    <tr>
                      <th scope="col" className="py-2 pe-3 text-start font-semibold">{t('report.colType')}</th>
                      <th scope="col" className="py-2 pe-3 text-right font-semibold">{t('report.colCount')}</th>
                      <th scope="col" className="py-2 pe-3 text-right font-semibold">{t('report.colAmount')}</th>
                      <th scope="col" className="w-1/3 py-2 text-start font-semibold">{t('report.colShare')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byType.map((r) => {
                      const share = typeTotal > 0 ? r.amountIls / typeTotal : 0;
                      return (
                        <tr key={r.type} className="border-b border-line/60">
                          <td className="py-2 pe-3 text-ink">{discrepancyLabel(ta, r.type)}</td>
                          <td className="py-2 pe-3 text-right tabular-nums text-muted">{num(r.count)}</td>
                          <td className="py-2 pe-3 text-right tabular-nums text-ink">{ils(r.amountIls)}</td>
                          <td className="py-2">
                            <div className="flex items-center gap-2">
                              <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                                <span className="rm-bar block h-full rounded-full bg-danger/70" style={{ width: `${Math.max(2, share * 100)}%` }} />
                              </span>
                              <span className="w-12 text-end text-xs tabular-nums text-subtle">{formatPercent(share, locale, 0)}</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row" className="pt-2 pe-3 text-start font-semibold text-ink">{t('report.total')}</th>
                      <td />
                      <td className="pt-2 pe-3 text-right font-bold tabular-nums text-ink" data-testid="report-type-total" data-amount={typeTotal}>{ils(typeTotal)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>

            {/* By supplier */}
            <section>
              <h2 id="report-bySupplierTitle" className="mb-2 text-base font-bold text-ink">{t('report.bySupplierTitle')}</h2>
              <div className="overflow-x-auto" tabIndex={0} role="region" aria-labelledby="report-bySupplierTitle">
                <table className="w-full min-w-[440px] text-sm">
                  <thead className="border-b border-line text-xs text-subtle">
                    <tr>
                      <th scope="col" className="py-2 pe-3 text-start font-semibold">{t('report.colSupplier')}</th>
                      <th scope="col" className="py-2 pe-3 text-right font-semibold">{t('report.colLeak')}</th>
                      <th scope="col" className="py-2 pe-3 text-right font-semibold">{t('report.colPct')}</th>
                      <th scope="col" className="py-2 pe-3 text-right font-semibold">{t('report.colSpend')}</th>
                      <th scope="col" className="py-2 text-right font-semibold">{t('report.colInvoices')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.bySupplier.map((r) => (
                      <tr key={r.supplierId ?? 'none'} className="border-b border-line/60">
                        <td className="py-2 pe-3 text-ink">{displayName(locale, r.supplierName, r.supplierNameEn) || '—'}</td>
                        <td className={`py-2 pe-3 text-right font-semibold tabular-nums ${r.leakIls > 0 ? 'text-ink' : 'text-subtle'}`}>
                          {ils(r.leakIls)}
                        </td>
                        <td className="py-2 pe-3 text-right tabular-nums text-muted">{r.leakPct != null ? pct1(r.leakPct) : '—'}</td>
                        <td className="py-2 pe-3 text-right tabular-nums text-muted">{ils(r.spendIls, 0)}</td>
                        <td className="py-2 text-right tabular-nums text-muted">{num(r.invoiceCount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row" className="pt-2 pe-3 text-start font-semibold text-ink">{t('report.total')}</th>
                      <td className="pt-2 pe-3 text-right font-bold tabular-nums text-ink" data-testid="report-supplier-total">{ils(supplierLeakTotal)}</td>
                      <td />
                      <td className="pt-2 pe-3 text-right tabular-nums text-muted">{ils(supplierSpendTotal, 0)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          </>
        )}

        {/* Prices that rose — a trend, in calm ink (never the leak's danger). */}
        <section>
          <h2 id="report-creepTitle" className="text-base font-bold text-ink">{t('report.creepTitle')}</h2>
          <p className="mb-2 text-xs text-subtle">{t('report.creepHint')}</p>
          {report.priceCreep.length === 0 ? (
            <p className="text-sm text-muted">{t('report.creepEmpty')}</p>
          ) : (
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-labelledby="report-creepTitle">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="border-b border-line text-xs text-subtle">
                  <tr>
                    <th scope="col" className="py-2 pe-3 text-start font-semibold">{t('report.colProduct')}</th>
                    <th scope="col" className="py-2 pe-3 text-start font-semibold">{t('report.colSupplier')}</th>
                    <th scope="col" className="py-2 pe-3 text-right font-semibold">{t('report.colBefore')}</th>
                    <th scope="col" className="py-2 pe-3 text-right font-semibold">{t('report.colAfter')}</th>
                    <th scope="col" className="py-2 pe-3 text-right font-semibold">{t('report.colChange')}</th>
                    <th scope="col" className="py-2 text-right font-semibold">{t('report.colExcess')}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.priceCreep.map((r) => (
                    <tr key={`${r.productId}-${r.supplierName}`} className="border-b border-line/60">
                      <td className="py-2 pe-3 text-ink">{displayName(locale, r.productName, r.productNameEn)}</td>
                      <td className="py-2 pe-3 text-muted">{displayName(locale, r.supplierName, r.supplierNameEn)}</td>
                      <td className="py-2 pe-3 text-right tabular-nums text-muted">{ils(r.beforePrice)}</td>
                      <td className="py-2 pe-3 text-right tabular-nums text-ink">{ils(r.afterPrice)}</td>
                      <td className="py-2 pe-3 text-right tabular-nums text-warn">
                        <bdi>+{formatPercent(r.deltaPct, locale, 1)}</bdi>
                      </td>
                      <td className="py-2 text-right tabular-nums text-ink">{ils(r.excessIls)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <footer className="space-y-1 border-t border-line pt-3 text-xs leading-snug text-subtle">
          {report.capAdjustmentIls > 0 ? <p>{t('report.capNote', { amount: ils(report.capAdjustmentIls) })}</p> : null}
          <p>{t('report.method')}</p>
        </footer>
      </article>
    </div>
  );
}

function RoleCard({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <SectionHeader level={1} title={title} />
      <Card padding="md" className="flex items-center gap-3 bg-surface-2 text-muted" data-testid="role-card">
        <Lock className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span>{body}</span>
      </Card>
    </div>
  );
}

function Stat({ label, value, amount, hint }: { label: string; value: string; amount: number; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2/60 px-3 py-2.5" data-testid="report-part" data-amount={amount}>
      <dt className="text-xs font-semibold text-subtle">{label}</dt>
      <dd className="mt-0.5 text-lg font-bold tabular-nums text-ink">{value}</dd>
      {hint ? <dd className="text-xs text-muted">{hint}</dd> : null}
    </div>
  );
}
