import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FlaskConical, Info } from 'lucide-react';
import { leakCheck as lc } from '@restomatch/api';
import { PLAN_SEED } from '@restomatch/db';
import { authDb } from '@/lib/authDb';
import { getLocale, getT } from '@/lib/i18n/server';
import { formatDate, formatNumber, formatPercent } from '@/lib/i18n/format';
import { leakCheck } from '@/lib/i18n/messages/leakCheck';
import { formatIls } from '@/lib/money';
import { DemoCta } from './DemoCta';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(leakCheck);
  // A personal result: never indexed, never shared via a referrer.
  return { title: t('meta.resultTitle'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

/**
 * Leak-check result. The only key is a signed, short-lived link (`?t=`); the
 * sandbox row is read on the owner connection by the id inside a VALID link,
 * so no one reaches another prospect's result by editing the URL.
 */
export default async function LeakCheckResultPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  if (!lc.leakCheckPublicEnabled()) notFound();
  const t = await getT(leakCheck);
  const locale = await getLocale();
  const { t: token = '' } = await searchParams;

  let sessionId: string | null = null;
  try {
    sessionId = lc.verifyResultLink(lc.leakCheckSecret(), token);
  } catch {
    sessionId = null;
  }
  const view = sessionId ? await lc.getLeakCheckSession(authDb, sessionId) : null;
  if (!view) {
    return (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <p className="text-lg text-muted">{t('result.invalid')}</p>
        <Link href="/leak-check" className="mt-6 inline-block font-semibold text-primary hover:underline">
          {t('result.again')}
        </Link>
      </div>
    );
  }

  const ils = (agorot: number) => formatIls(agorot / 100, { maximumFractionDigits: 2, locale });
  const price = (shekels: number) => formatIls(shekels, { maximumFractionDigits: 2, locale });
  const inv = (i: number) => view.invoices.find((x) => x.index === i);
  const { report } = view;
  const leak = report.leakAgorot;
  // Grounded ROI line: the check's own leak/spend + the Pro price from PLAN_SEED only.
  const proPriceAgorot = PLAN_SEED.pro.priceAgorotMonthly;
  const roiAgorot = lc.breakEvenMonthlySpendAgorot(leak, report.spendAgorot, proPriceAgorot);

  const describe = (f: lc.LeakFinding): string => {
    const line = f.lineIndex !== null ? inv(f.invoiceIndex)?.lines[f.lineIndex] : undefined;
    const desc = line?.description ?? '';
    switch (f.kind) {
      case 'vat_overcharge':
        return t('result.kinds.vat_overcharge', { actual: ils(f.actualAgorot), expected: ils(f.expectedAgorot) });
      case 'line_arithmetic':
        return t('result.kinds.line_arithmetic', { desc, actual: ils(f.actualAgorot), expected: ils(f.expectedAgorot) });
      case 'total_arithmetic':
        return t('result.kinds.total_arithmetic_total', {
          actual: ils(f.actualAgorot),
          expected: ils(f.expectedAgorot),
        });
      case 'price_creep': {
        const ref = f.refInvoiceIndex !== undefined && f.refLineIndex !== undefined ? inv(f.refInvoiceIndex)?.lines[f.refLineIndex] : undefined;
        return t('result.kinds.price_creep', {
          desc,
          qty: formatNumber(f.qty ?? 0, locale),
          price: price(line?.unitPrice ?? 0),
          prevPrice: price(ref?.unitPrice ?? 0),
          ref: (f.refInvoiceIndex ?? 0) + 1,
        });
      }
      case 'above_price_list': {
        const qty = f.qty ?? 0;
        return t('result.kinds.above_price_list', {
          desc,
          qty: formatNumber(qty, locale),
          price: price(line?.unitPrice ?? 0),
          listPrice: price(qty > 0 ? f.expectedAgorot / 100 / qty : 0),
        });
      }
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-14 sm:px-6 sm:py-20">
      {view.ocrMode === 'stub' ? (
        <p
          data-testid="sample-banner"
          className="mb-8 flex items-start gap-2 rounded-2xl border border-gold/30 bg-gold/[0.08] px-4 py-3 text-sm text-ink"
        >
          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
          {t('result.sampleBanner')}
        </p>
      ) : null}

      <p className="mb-3 text-xs font-semibold uppercase text-gold ltr:font-mono ltr:tracking-[0.2em] rtl:text-sm">
        {t('result.eyebrow')}
      </p>
      <h1 data-testid="leak-total" className="text-balance text-3xl font-extrabold tracking-tight text-ink sm:text-5xl">
        {leak > 0 ? t('result.found', { amount: ils(leak) }) : t('result.foundNone')}
      </h1>
      <p className="mt-4 text-base text-muted">
        {report.spendAgorot > 0 && leak > 0
          ? t('result.ofSpend', { pct: formatPercent(leak / report.spendAgorot, locale, 2), spend: ils(report.spendAgorot) })
          : null}
        {leak === 0 ? t('result.noneBody') : null}
      </p>
      <p className="mt-2 text-sm text-subtle">
        {t('result.analysed', { n: report.analysedInvoices })} ·{' '}
        {t('result.expires', { date: formatDate(view.expiresAt, locale, { dateStyle: 'medium' }) })}
      </p>

      {report.findings.length > 0 ? (
        <section aria-labelledby="lc-findings" className="mt-10 overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
          <h2 id="lc-findings" className="border-b border-line px-5 py-4 text-base font-bold text-ink">
            {t('result.findingsTitle')}
          </h2>
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs text-subtle">
              <tr>
                <th scope="col" className="px-5 py-2 text-start font-medium">{t('result.colWhat')}</th>
                <th scope="col" className="hidden px-3 py-2 text-start font-medium sm:table-cell">{t('result.colWhere')}</th>
                <th scope="col" className="px-5 py-2 text-end font-medium">{t('result.colAmount')}</th>
              </tr>
            </thead>
            <tbody>
              {report.findings.map((f, i) => {
                const where =
                  f.lineIndex !== null
                    ? t('result.whereLine', { n: f.invoiceIndex + 1, line: f.lineIndex + 1 })
                    : t('result.where', { n: f.invoiceIndex + 1 });
                return (
                  <tr key={i} data-testid="finding" className="border-t border-line align-top">
                    <td className="px-5 py-3 text-ink">
                      {describe(f)}
                      <span className="mt-1 block text-xs text-subtle sm:hidden">{where}</span>
                    </td>
                    <td className="hidden px-3 py-3 text-muted sm:table-cell">
                      {where}
                      <span className="block truncate text-xs text-subtle" dir="ltr">
                        {inv(f.invoiceIndex)?.fileName}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-end font-mono font-semibold tabular-nums text-danger">
                      {ils(f.amountAgorot)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-line">
                <td className="px-5 py-3 font-bold text-ink" colSpan={1}>
                  Σ
                </td>
                <td className="hidden sm:table-cell" />
                <td className="whitespace-nowrap px-5 py-3 text-end font-mono font-extrabold tabular-nums text-danger">
                  {ils(leak)}
                </td>
              </tr>
            </tfoot>
          </table>
        </section>
      ) : null}

      {report.notes.length > 0 || report.ocrFailures > 0 ? (
        <section aria-labelledby="lc-notes" className="mt-6 rounded-2xl border border-line bg-surface-2/60 p-5">
          <h2 id="lc-notes" className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted">
            <Info className="h-4 w-4" aria-hidden="true" />
            {t('result.notes.title')}
          </h2>
          <ul className="space-y-1 text-sm text-muted">
            {report.notes.map((n, i) => (
              <li key={i}>
                {n.kind === 'same_file_twice'
                  ? t('result.notes.same_file_twice', { n: n.invoiceIndex + 1, ref: (n.refInvoiceIndex ?? 0) + 1 })
                  : n.kind === 'possible_duplicate'
                    ? t('result.notes.possible_duplicate', {
                        n: n.invoiceIndex + 1,
                        ref: (n.refInvoiceIndex ?? 0) + 1,
                        number: inv(n.invoiceIndex)?.invoiceNumber ?? '',
                        supplier: inv(n.invoiceIndex)?.supplierName ?? '',
                        amount: ils(n.amountAgorot ?? 0),
                      })
                    : n.kind === 'subtotal_mismatch'
                      ? t('result.notes.subtotal_mismatch', { n: n.invoiceIndex + 1, amount: ils(n.amountAgorot ?? 0) })
                      : t('result.notes.undercharge', {
                          n: n.invoiceIndex + 1,
                          line: (n.lineIndex ?? 0) + 1,
                          amount: ils(n.amountAgorot ?? 0),
                        })}
              </li>
            ))}
            {report.ocrFailures > 0 ? <li>{t('result.notes.ocrFailures', { n: report.ocrFailures })}</li> : null}
          </ul>
        </section>
      ) : null}

      {roiAgorot !== null ? (
        <section
          data-testid="roi-line"
          aria-labelledby="lc-roi"
          className="mt-8 rounded-2xl border border-gold/30 bg-gold/[0.06] p-5"
        >
          <h2 id="lc-roi" className="text-sm font-semibold text-ink">
            {t('result.roi.title')}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            {t('result.roi.body', {
              pct: formatPercent(leak / report.spendAgorot, locale, 2),
              price: formatIls(proPriceAgorot / 100, { locale }),
              breakEven: formatIls(roiAgorot / 100, { locale }),
            })}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-subtle">{t('result.roi.note')}</p>
        </section>
      ) : null}

      <p className="mt-6 text-xs leading-relaxed text-subtle">{t('result.method')}</p>

      <section className="mt-12 rounded-3xl border border-primary/30 bg-primary/[0.05] p-6 sm:p-8">
        <h2 className="text-xl font-bold text-ink">{t('result.ctaTitle')}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">{t('result.ctaBody')}</p>
        <div className="mt-6">
          <DemoCta token={token} />
        </div>
      </section>
    </div>
  );
}
