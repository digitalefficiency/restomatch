import Link from 'next/link';
import { WithOriginal } from '@/lib/i18n/original';
import { auth } from '@/auth';
import { TRPCError } from '@trpc/server';
import { ArrowLeft, ArrowRight, ShieldAlert } from 'lucide-react';
import { createServerCaller } from '@/lib/trpc/server';
import { formatIls } from '@/lib/money';
import { formatDate, formatNumber, formatPercent } from '@/lib/i18n/format';
import { getLocale, getT } from '@/lib/i18n/server';
import { leaks as leaksNs } from '@/lib/i18n/messages/leaks';
import { approvals as approvalsNs } from '@/lib/i18n/messages/approvals';
import { Card, SectionHeader } from '@/lib/components';
import { discrepancyLabel, displayName } from '../../approvals/vocab';
import { PrintButton } from '../claims/print-button';
import { views as viewsNs } from '@/lib/i18n/messages/views';
import { DeltaBadge, ViewToolbar, parseView } from '@/lib/components/views';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
/** North Star: ≥1.5% of food spend surfaced as leak. */
const TARGET_PCT = 0.015;

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

/**
 * Print-ready monthly leak report (A4). Owner/manager only. `?month=YYYY-MM`,
 * defaulting to the current month. Window.print → "Save as PDF" for a file.
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
  // `?cmp=prev|yoy` adds ▲/▼ against the previous month or the same month last year.
  const view = parseView(sp);
  const compareMonth = view.compare === 'off' ? null : shiftMonth(month, view.compare === 'yoy' ? -12 : -1);

  const caller = await createServerCaller();
  const [t, ta, tv, locale] = await Promise.all([getT(leaksNs), getT(approvalsNs), getT(viewsNs), getLocale()]);
  let previous: Awaited<ReturnType<typeof caller.owner.leakReport>> | null = null;

  let report: Awaited<ReturnType<typeof caller.owner.leakReport>>;
  const role = (
    (await auth())?.user as { role?: string } | undefined
  )?.role;
  try {
    // owner|manager only — skip the guaranteed-FORBIDDEN call for other roles.
    if (role !== 'owner' && role !== 'manager') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'owner|manager only' });
    }
    [report, previous] = await Promise.all([
      caller.owner.leakReport({ month }),
      compareMonth ? caller.owner.leakReport({ month: compareMonth }) : Promise.resolve(null),
    ]);
  } catch (err) {
    if (err instanceof TRPCError && err.code === 'FORBIDDEN') {
      return (
        <div>
          <SectionHeader level={1} title={t('report.title')} />
          <Card padding="md" className="flex items-center gap-3 border-warn/30 bg-warn/5 text-warn">
            <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span>{t('report.roleOnly')}</span>
          </Card>
        </div>
      );
    }
    throw err;
  }
  const memberships = await caller.onboarding.myMemberships();
  const restaurant = memberships[0]?.restaurantName ?? '';

  const { hero, status } = report;
  const ils = (v: number, digits = 0) => formatIls(v, { locale, maximumFractionDigits: digits });
  const pct = (v: number) => formatPercent(v, locale, 1);
  const num = (v: number) => formatNumber(v, locale);
  const monthLabel = formatDate(hero.monthStart, locale, { month: 'long', year: 'numeric' });
  const typeTotal = report.byType.reduce((s, r) => s + r.amountIls, 0);
  const hasLeak = hero.leakIls > 0;
  const cmpQ = view.compare !== 'off' ? `&cmp=${view.compare}` : '';
  const navLink =
    'inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-semibold text-primary hover:text-ink';

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
          {t('detective.title')}
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
        className="mx-auto max-w-[210mm] space-y-6 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-8"
      >
        <header className="flex flex-col gap-1 border-b border-line pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-extrabold text-ink">{t('report.title')}</h1>
            <p className="text-sm text-muted"><WithOriginal text={t('report.subtitle', { restaurant, month: monthLabel })} value={restaurant} /></p>
          </div>
          <p className="text-xs text-subtle">
            {t('report.generated', { date: formatDate(new Date(), locale, { dateStyle: 'medium' }) })}
          </p>
        </header>

        {/* Headline */}
        <section className="grid gap-4 sm:grid-cols-[1.3fr_1fr] sm:items-end">
          {/* T1 — the one number: danger start rail + ink figure when money leaked. */}
          <div className={hasLeak ? 'relative border-s-4 border-danger ps-4' : undefined}>
            <p className="text-sm font-semibold text-muted">{t('report.headline')}</p>
            <p className={`rm-print-accent font-mono text-5xl font-extrabold tabular-nums ${hasLeak ? 'text-ink' : 'text-primary'}`}>
              {ils(hero.leakIls)}
            </p>
            <p className="mt-1 text-base font-semibold text-ink">
              {hero.leakPct != null ? t('report.ofSpend', { pct: pct(hero.leakPct) }) : t('report.noSpend')}
            </p>
            {hero.spendIls > 0 ? (
              <p className="text-sm text-muted">
                {t('report.spendBase', { spend: ils(hero.spendIls), count: num(Math.max(0, hero.invoiceCount - hero.pendingLinkCount)) })}
              </p>
            ) : null}
            <p className="mt-1 text-xs text-subtle">{t('report.target')}</p>
            {previous && previous.hero.invoiceCount > 0 ? (
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                <DeltaBadge current={hero.leakIls} previous={previous.hero.leakIls} compare={view.compare} showAmount />
                <DeltaBadge current={hero.spendIls} previous={previous.hero.spendIls} compare={view.compare} neutral />
              </div>
            ) : null}
          </div>
          {hero.pendingLinkCount > 0 ? (
            <p className="rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-muted">
              {t('report.pending', { count: num(hero.pendingLinkCount), amount: ils(hero.pendingLinkIls) })}
            </p>
          ) : null}
        </section>

        {/* What happened to the money */}
        <section>
          <h2 className="mb-2 text-base font-bold text-ink">{t('report.statusTitle')}</h2>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={t('report.caught')} value={ils(status.caughtBeforePaymentIls)} tone="gold" />
            <Stat label={t('report.stillOpen')} value={ils(status.stillOpenIls)} hint={t('report.lines', { count: num(status.stillOpenCount) })} tone="warn" />
            <Stat
              label={t('report.claimed')}
              value={ils(status.claimedIls)}
              hint={t('report.claimedHint', { count: num(status.claimedCount), suppliers: num(status.creditRequestSuppliers) })}
              tone="primary"
            />
            <Stat label={t('report.waived')} value={ils(status.waivedIls)} hint={t('report.lines', { count: num(status.waivedCount) })} />
          </dl>
        </section>

        {!hasLeak ? (
          <p className="rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-primary">{t('report.empty')}</p>
        ) : (
          <>
            {/* By type */}
            <section>
              <h2 className="mb-2 text-base font-bold text-ink">{t('report.byTypeTitle')}</h2>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-sm">
                  <thead className="border-b border-line text-xs text-subtle">
                    <tr>
                      <th scope="col" className="py-2 pe-3 text-start font-semibold">{t('report.colType')}</th>
                      <th scope="col" className="py-2 pe-3 text-end font-semibold">{t('report.colCount')}</th>
                      <th scope="col" className="py-2 pe-3 text-end font-semibold">{t('report.colAmount')}</th>
                      <th scope="col" className="w-1/3 py-2 text-start font-semibold">{t('report.colShare')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byType.map((r) => {
                      const share = typeTotal > 0 ? r.amountIls / typeTotal : 0;
                      return (
                        <tr key={r.type} className="border-b border-line/60">
                          <td className="py-2 pe-3 text-ink">{discrepancyLabel(ta, r.type)}</td>
                          <td className="py-2 pe-3 text-end font-mono tabular-nums text-muted">{num(r.count)}</td>
                          <td className="py-2 pe-3 text-end font-mono tabular-nums text-ink">{ils(r.amountIls, 2)}</td>
                          <td className="py-2">
                            <div className="flex items-center gap-2">
                              <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                                <span className="rm-bar block h-full rounded-full bg-danger/70" style={{ width: `${Math.max(2, share * 100)}%` }} />
                              </span>
                              <span className="w-12 text-end font-mono text-xs tabular-nums text-subtle">{formatPercent(share, locale, 0)}</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {/* By supplier */}
            <section>
              <h2 className="mb-2 text-base font-bold text-ink">{t('report.bySupplierTitle')}</h2>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-sm">
                  <thead className="border-b border-line text-xs text-subtle">
                    <tr>
                      <th scope="col" className="py-2 pe-3 text-start font-semibold">{t('report.colSupplier')}</th>
                      <th scope="col" className="py-2 pe-3 text-end font-semibold">{t('report.colInvoices')}</th>
                      <th scope="col" className="py-2 pe-3 text-end font-semibold">{t('report.colSpend')}</th>
                      <th scope="col" className="py-2 pe-3 text-end font-semibold">{t('report.colLeak')}</th>
                      <th scope="col" className="py-2 text-end font-semibold">{t('report.colPct')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.bySupplier.map((r) => (
                      <tr key={r.supplierId ?? 'none'} className="border-b border-line/60">
                        <td className="py-2 pe-3 text-ink">{displayName(locale, r.supplierName, r.supplierNameEn) || '—'}</td>
                        <td className="py-2 pe-3 text-end font-mono tabular-nums text-muted">{num(r.invoiceCount)}</td>
                        <td className="py-2 pe-3 text-end font-mono tabular-nums text-muted">{ils(r.spendIls)}</td>
                        <td className={`py-2 pe-3 text-end font-mono tabular-nums ${r.leakIls > 0 ? 'rm-print-accent text-danger' : 'text-subtle'}`}>
                          {ils(r.leakIls, 2)}
                        </td>
                        <td className={`py-2 text-end font-mono tabular-nums ${r.leakPct != null && r.leakPct >= TARGET_PCT ? 'font-semibold text-danger' : 'text-muted'}`}>
                          {r.leakPct != null ? pct(r.leakPct) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {/* Price creep */}
        <section>
          <h2 className="text-base font-bold text-ink">{t('report.creepTitle')}</h2>
          <p className="mb-2 text-xs text-subtle">{t('report.creepHint')}</p>
          {report.priceCreep.length === 0 ? (
            <p className="text-sm text-muted">{t('report.creepEmpty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="border-b border-line text-xs text-subtle">
                  <tr>
                    <th scope="col" className="py-2 pe-3 text-start font-semibold">{t('report.colProduct')}</th>
                    <th scope="col" className="py-2 pe-3 text-start font-semibold">{t('report.colSupplier')}</th>
                    <th scope="col" className="py-2 pe-3 text-end font-semibold">{t('report.colBefore')}</th>
                    <th scope="col" className="py-2 pe-3 text-end font-semibold">{t('report.colAfter')}</th>
                    <th scope="col" className="py-2 pe-3 text-end font-semibold">{t('report.colChange')}</th>
                    <th scope="col" className="py-2 text-end font-semibold">{t('report.colExcess')}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.priceCreep.map((r) => (
                    <tr key={`${r.productId}-${r.supplierName}`} className="border-b border-line/60">
                      <td className="py-2 pe-3 text-ink">{displayName(locale, r.productName, r.productNameEn)}</td>
                      <td className="py-2 pe-3 text-muted">{displayName(locale, r.supplierName, r.supplierNameEn)}</td>
                      <td className="py-2 pe-3 text-end font-mono tabular-nums text-muted">{ils(r.beforePrice, 2)}</td>
                      <td className="py-2 pe-3 text-end font-mono tabular-nums text-ink">{ils(r.afterPrice, 2)}</td>
                      <td className="rm-print-accent py-2 pe-3 text-end font-mono tabular-nums text-danger" dir="ltr">
                        +{formatPercent(r.deltaPct, locale, 1)}
                      </td>
                      <td className="py-2 text-end font-mono tabular-nums text-ink">{ils(r.excessIls, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <footer className="space-y-1 border-t border-line pt-3 text-[11px] leading-snug text-subtle">
          {report.capAdjustmentIls > 0 ? <p>{t('report.capNote', { amount: ils(report.capAdjustmentIls, 2) })}</p> : null}
          <p>{t('report.method')}</p>
        </footer>
      </article>
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'gold' | 'warn' | 'primary' }) {
  const color = tone === 'gold' ? 'text-gold' : tone === 'warn' ? 'text-warn' : tone === 'primary' ? 'text-primary' : 'text-ink';
  return (
    <div className="rounded-xl border border-line bg-surface-2/60 px-3 py-2.5">
      <dt className="text-xs font-semibold text-subtle">{label}</dt>
      <dd className={`mt-0.5 font-mono text-lg font-bold tabular-nums ${color}`}>{value}</dd>
      {hint ? <dd className="text-[11px] text-muted">{hint}</dd> : null}
    </div>
  );
}
