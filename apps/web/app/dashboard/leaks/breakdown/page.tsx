import Link from 'next/link';
import { ArrowLeft, ArrowRight, ExternalLink, FileText, Hourglass, ShieldCheck } from 'lucide-react';
import { createServerCaller } from '@/lib/trpc/server';
import { formatIls } from '@/lib/money';
import { formatDate, formatPercent } from '@/lib/i18n/format';
import { getLocale, getT } from '@/lib/i18n/server';
import { leaks as leaksNs } from '@/lib/i18n/messages/leaks';
import { approvals as approvalsNs } from '@/lib/i18n/messages/approvals';
import { Badge, Card, EmptyState, SectionHeader, type BadgeTone } from '@/lib/components';
import {
  discrepancyLabel,
  displayName,
  resolutionLabel,
  severityLabel,
} from '../../approvals/vocab';

/**
 * Drill-down behind the hero leak number: every invoice that contributed to the
 * month's leak (largest first) with the discrepancy lines that caused it, then
 * the invoices calmly waiting for a PO link. `?m=-1` = previous month.
 */
export default async function LeakBreakdownPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const sp = await searchParams;
  const parsed = Number.parseInt(sp.m ?? '0', 10);
  const monthOffset = Number.isFinite(parsed) ? Math.min(0, Math.max(-24, parsed)) : 0;

  const caller = await createServerCaller();
  const [t, ta, locale] = await Promise.all([getT(leaksNs), getT(approvalsNs), getLocale()]);
  const [hero, rows] = await Promise.all([
    caller.owner.leakHero({ monthOffset }),
    caller.owner.leakBreakdown({ monthOffset, limit: 100 }),
  ]);

  const ils = (v: number, digits = 2) => formatIls(v, { locale, maximumFractionDigits: digits });
  const month = formatDate(hero.monthStart, locale, { month: 'long', year: 'numeric' });
  const leaking = rows.filter((r) => !r.pendingLink);
  const pending = rows.filter((r) => r.pendingLink);

  const navLink =
    'inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-semibold text-primary transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60';

  return (
    <div>
      <Link href="/dashboard" className={`${navLink} mb-3 -ms-2 text-muted`}>
        <ArrowRight className="h-4 w-4 ltr:-scale-x-100" aria-hidden="true" />
        {t('breakdown.back')}
      </Link>

      <SectionHeader level={1} title={t('breakdown.title')} subtitle={t('breakdown.subtitle', { month })} />

      {/* Month switcher + total — the same number as the hero. */}
      <Card padding="md" className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-subtle">
            {t('breakdown.total')} · {month}
          </p>
          <p className="mt-1 font-mono text-3xl font-extrabold tabular-nums text-danger">{ils(hero.leakIls, 0)}</p>
          {hero.leakPct != null ? (
            <p className="text-sm text-muted">{t('breakdown.ofSpend', { pct: formatPercent(hero.leakPct, locale, 1) })}</p>
          ) : null}
        </div>
        <nav className="flex items-center gap-2" aria-label={month}>
          {monthOffset > -24 ? (
            <Link href={`/dashboard/leaks/breakdown?m=${monthOffset - 1}`} className={navLink}>
              <ArrowRight className="h-4 w-4 ltr:-scale-x-100" aria-hidden="true" />
              {t('breakdown.prevMonth')}
            </Link>
          ) : null}
          {monthOffset < 0 ? (
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

      {leaking.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="h-6 w-6" />}
          title={t('breakdown.emptyTitle')}
          description={t('breakdown.emptyDescription')}
        />
      ) : (
        <div className="space-y-4">
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
                    <p className="mt-0.5 text-xs text-subtle">
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
                    <p className="font-mono text-2xl font-extrabold tabular-nums text-danger">{ils(inv.leakIls)}</p>
                    {capped ? <p className="text-[11px] text-muted">{t('breakdown.capped')}</p> : null}
                  </div>
                </header>

                <ul className="divide-y divide-line">
                  {inv.lines.map((l) => {
                    const item =
                      displayName(locale, l.productName, l.productNameEn) ||
                      displayName(locale, l.lineDescription, l.lineDescriptionEn);
                    return (
                      <li
                        key={l.discrepancyId}
                        className={`flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${l.countsAsLeak ? '' : 'opacity-70'}`}
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge tone={severityTone(l.severity)}>{severityLabel(ta, l.severity)}</Badge>
                            <span className="font-semibold text-ink">{discrepancyLabel(ta, l.type)}</span>
                            {item ? <span className="text-sm text-muted">· {item}</span> : null}
                          </div>
                          <p className="mt-0.5 text-xs text-subtle">{resolutionLabel(ta, l.resolutionStatus)}</p>
                        </div>
                        <div className="shrink-0 text-start sm:text-end">
                          <span
                            className={`font-mono font-semibold tabular-nums ${l.countsAsLeak ? 'text-danger' : 'text-muted line-through decoration-1'}`}
                          >
                            {ils(Math.abs(l.deltaAmount))}
                          </span>
                          {!l.countsAsLeak ? (
                            <span className="ms-2 text-[11px] text-subtle">{t('breakdown.notCounted')}</span>
                          ) : null}
                        </div>
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
                <span className="shrink-0 font-mono text-sm tabular-nums text-muted">{ils(inv.totalInclVat)}</span>
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
