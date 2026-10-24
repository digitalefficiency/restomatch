import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, FileText, Hourglass, ListChecks, Scale, Sigma } from 'lucide-react';
import { createServerCaller } from '@/lib/trpc/server';
import { formatIls } from '@/lib/money';
import { formatDate, formatNumber, formatPercent } from '@/lib/i18n/format';
import { getLocale, getT } from '@/lib/i18n/server';
import { leakProof as leakProofNs } from '@/lib/i18n/messages/leakProof';
import { approvals as approvalsNs } from '@/lib/i18n/messages/approvals';
import { Card, SectionHeader } from '@/lib/components';
import { buildProof } from '@/lib/leakProof';
import { discrepancyLabel, displayName } from '../../approvals/vocab';
import { PrintButton } from './print-button';

/**
 * "How did we get to ₪X?" (flag `leakProof`): a print-friendly sheet that
 * proves the dashboard's leak hero — built only from owner.leakHero and
 * owner.leakBreakdown, so every ₪ here equals the hero to the agora.
 * Finance roles (the breakdown is finance detail, like /dashboard/leaks).
 */
export default async function LeakProofPage() {
  const caller = await createServerCaller();
  const flags = await caller.recovery.flags();
  if (!flags.leakProof) notFound();

  const [t, ta, locale, hero, breakdown] = await Promise.all([
    getT(leakProofNs),
    getT(approvalsNs),
    getLocale(),
    caller.owner.leakHero(),
    // The whole month (pending rows sort last, and a pending invoice can still
    // carry leak) so the top 5 can never miss a catch.
    caller.owner.leakBreakdown({ limit: 200 }),
  ]);
  const proof = buildProof(hero, breakdown);
  const round = (ils: number) => formatIls(ils, { locale });
  const exact = (ils: number) => formatIls(ils, { locale, maximumFractionDigits: 2 });
  const num = (n: number) => formatNumber(n, locale);
  const month = formatDate(hero.monthStart, locale, { month: 'long', year: 'numeric' });

  return (
    <div className="mx-auto max-w-3xl space-y-6 print:max-w-none print:space-y-4" data-testid="leak-proof">
      {/* Print: the sheet only — no app chrome, no buttons. */}
      <style>{'@media print { header, nav, [data-print-hide] { display: none !important; } }'}</style>

      <div className="flex flex-wrap items-center justify-between gap-3" data-print-hide>
        <Link
          href="/dashboard"
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        >
          <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
          {t('back')}
        </Link>
        <PrintButton label={t('print')} />
      </div>

      <SectionHeader level={1} title={t('title', { amount: round(hero.leakIls) })} subtitle={t('subtitle', { month })} />

      {/* T1 — the number and how it is made. */}
      <Card padding="lg" elevated data-testid="proof-number" className={hero.leakIls > 0 ? 'relative overflow-hidden border-danger/35' : 'relative overflow-hidden'}>
        {hero.leakIls > 0 ? <div className="absolute inset-y-0 start-0 w-1.5 bg-danger" aria-hidden="true" /> : null}
        <div className="flex items-start gap-3">
          <Sigma className="mt-1 h-5 w-5 shrink-0 text-danger" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-ink">{t('numberTitle')}</h2>
            <p className="mt-1 font-mono text-4xl font-extrabold tabular-nums text-ink" data-testid="proof-leak">
              {exact(hero.leakIls)}
            </p>
            <p className="mt-2 text-sm text-ink">
              {t('number', {
                amount: exact(hero.leakIls),
                withLeak: num(hero.invoicesWithLeak),
                matched: num(hero.matchedInvoiceCount),
                total: num(hero.invoiceCount),
              })}
            </p>
          </div>
        </div>
        <div className="mt-5 flex items-start gap-3 border-t border-line pt-4">
          <Scale className="mt-0.5 h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-ink">{t('pctTitle')}</h2>
            <p className="mt-1 text-sm text-ink" data-testid="proof-pct">
              {hero.leakPct != null && hero.spendIls > 0
                ? t('pct', { pct: formatPercent(hero.leakPct, locale, 2), amount: exact(hero.leakIls), spend: exact(hero.spendIls) })
                : t('pctNone')}
            </p>
          </div>
        </div>
      </Card>

      {/* T4 — pending invoices: neutral, never an alarm. */}
      <Card padding="lg" className="bg-surface-2" data-testid="proof-pending">
        <div className="flex items-start gap-3">
          <Hourglass className="mt-0.5 h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-ink">{t('pendingTitle')}</h2>
            <p className="mt-1 text-sm text-muted">
              {hero.pendingLinkCount > 0
                ? t('pending', { count: num(hero.pendingLinkCount), amount: exact(hero.pendingLinkIls) })
                : t('pendingNone')}
            </p>
          </div>
        </div>
      </Card>

      {/* The biggest catches, each finding linked to its invoice line (or the invoice). */}
      <section data-testid="proof-top">
        <SectionHeader title={t('topTitle')} subtitle={t('topHint')} />
        {proof.top.length === 0 ? (
          <Card padding="lg">
            <p className="text-sm text-muted">{t('none')}</p>
          </Card>
        ) : (
          <ol className="space-y-3">
            {proof.top.map((c, i) => (
              <li key={c.invoiceId} className="break-inside-avoid">
                <Card padding="none" className="overflow-hidden" data-testid="proof-catch">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-bold text-muted">
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink">
                          {displayName(locale, c.supplierName, c.supplierNameEn) || '—'}
                        </p>
                        <Link href={c.href} className="text-xs text-muted hover:text-primary hover:underline">
                          {t('invoice', { number: c.invoiceNumber ?? t('noNumber') })}
                          {c.invoiceDate ? ` · ${formatDate(c.invoiceDate, locale)}` : ''}
                        </Link>
                      </div>
                    </div>
                    <div className="text-end">
                      <p className="font-mono text-lg font-bold tabular-nums text-danger" data-testid="proof-catch-amount">
                        {exact(c.leakIls)}
                      </p>
                      {c.capped ? <p className="text-[11px] text-muted">{t('capped')}</p> : null}
                    </div>
                  </div>
                  <ul className="divide-y divide-line">
                    {c.findings.map((f) => {
                      const item =
                        displayName(locale, f.productName, f.productNameEn) ||
                        displayName(locale, f.lineDescription, f.lineDescriptionEn);
                      return (
                        <li key={f.discrepancyId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                          <span className="min-w-0">
                            <span className="font-medium text-ink">{discrepancyLabel(ta, f.type)}</span>
                            {f.level === 'line' && item ? <span className="text-muted"> · {item}</span> : null}
                            {f.level === 'invoice' ? <span className="text-muted"> · {t('invoiceLevel')}</span> : null}
                          </span>
                          <span className="flex shrink-0 items-center gap-3">
                            <span className="font-mono tabular-nums text-ink">{exact(f.amountIls)}</span>
                            <Link
                              href={f.href}
                              data-print-hide
                              className="inline-flex min-h-11 items-center gap-1 text-xs font-medium text-primary hover:underline sm:min-h-0"
                            >
                              <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                              {f.level === 'line' ? t('openLine') : t('openInvoice')}
                            </Link>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* T3 — the good news, with the hero's own definitions. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 [&>*]:min-w-0">
        <Card padding="lg" data-testid="proof-caught">
          <h2 className="text-sm font-bold text-ink">{t('caughtTitle')}</h2>
          <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-gold">{exact(hero.caughtBeforePaymentIls)}</p>
          <p className="mt-1 text-xs text-muted">{t('caught', { amount: exact(hero.caughtBeforePaymentIls) })}</p>
        </Card>
        <Card padding="lg" data-testid="proof-recovered">
          <h2 className="text-sm font-bold text-ink">{t('recoveredTitle')}</h2>
          <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-primary">{exact(hero.recoveredIls)}</p>
          <p className="mt-1 text-xs text-muted">{t('recovered', { amount: exact(hero.recoveredIls) })}</p>
        </Card>
      </div>

      <Card padding="lg">
        <div className="flex items-start gap-3">
          <ListChecks className="mt-0.5 h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-ink">{t('rulesTitle')}</h2>
            <p className="mt-1 text-sm text-muted">{t('rules')}</p>
          </div>
        </div>
      </Card>

      <p className="text-center text-xs text-subtle">{t('footer')}</p>
    </div>
  );
}
