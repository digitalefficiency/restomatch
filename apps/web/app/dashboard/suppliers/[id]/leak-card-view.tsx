import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import type { Locale } from '@/lib/i18n/config';
import type { Translator } from '@/lib/i18n/translate';
import type { he as suppliersHe } from '@/lib/i18n/messages/suppliers/he';
import type { he as approvalsHe } from '@/lib/i18n/messages/approvals/he';
import { formatDate, formatNumber, formatPercent } from '@/lib/i18n/format';
import { formatIls } from '@/lib/money';
import { createTranslator } from '@/lib/i18n/translate';
import { leaks as leaksNs } from '@/lib/i18n/messages/leaks';
import { Badge, LinkButton, cn } from '@/lib/components';
import { discrepancyLabel, displayName } from '../../approvals/vocab';
import { lineMathText } from '../../leaks/claims/why';
import type { SupplierLeakCard } from './leak-card-data';

const ils = (agorot: number, locale: Locale) => formatIls(agorot / 100, { locale, maximumFractionDigits: 2 });

/**
 * The supplier leak card body — shared by the "Leak" tab and the A4 print
 * card. Emphasis tiers (AGENTS.md): T1 the 90-day ₪ leak is the hero; T2 the
 * still-open ₪ gets a solid badge + one CTA; T3 a clean supplier is calm good
 * news, never an empty error.
 */
export function LeakCardBody({
  card,
  supplierId,
  locale,
  t,
  ta,
  print = false,
}: {
  card: SupplierLeakCard;
  supplierId: string;
  locale: Locale;
  t: Translator<typeof suppliersHe>;
  ta: Translator<typeof approvalsHe>;
  print?: boolean;
}) {
  const day = (ymd: string) => formatDate(`${ymd}T12:00:00Z`, locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
  const windowText = t('leakCard.window', { from: day(card.window.from), to: day(card.window.to) });
  const explorerHref = `/dashboard/leaks?p=custom&from=${card.window.from}&to=${card.window.to}&g=supplier&sup=${supplierId}`;
  const sc = card.scorecard;
  // Claim wording comes from the leak glossary ("דרישת זיכוי", never "תביעה").
  const tl = createTranslator(t.appLocale, leaksNs);

  if (card.leakAgorot === 0 && card.topLines.length === 0) {
    return (
      <div className="space-y-4">
        <section
          data-testid="supplier-leak-clean"
          data-agorot={0}
          data-from={card.window.from}
          data-to={card.window.to}
          className="flex items-start gap-3 rounded-2xl border border-line bg-primary/8 p-5"
        >
          <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <h2 className="text-base font-bold text-ink">{t('leakCard.cleanTitle')}</h2>
            <p className="mt-1 text-sm text-muted">{t('leakCard.cleanBody')}</p>
            <p className="mt-2 text-xs tabular-nums text-subtle">{windowText}</p>
          </div>
        </section>
        <Scorecard sc={sc} gated={card.scorecardGated} locale={locale} t={t} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* T1 — the hero ₪ */}
      <section
        data-testid="supplier-leak-total"
        data-agorot={card.leakAgorot}
        data-from={card.window.from}
        data-to={card.window.to}
        className="flex flex-wrap items-end justify-between gap-4"
      >
        <div>
          <p className="text-sm font-semibold text-muted">{t('leakCard.total')}</p>
          <p className="rm-print-accent text-5xl font-extrabold tabular-nums text-ink">
            {ils(card.leakAgorot, locale)}
          </p>
          <p className="mt-1 text-xs tabular-nums text-subtle">
            {windowText} · {t('leakCard.lines', { count: formatNumber(card.leakCount, locale) })}
          </p>
        </div>
        {!print && (
          <Link href={explorerHref} className="rounded text-sm font-semibold text-primary underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60">
            {t('leakCard.explorer')}
          </Link>
        )}
      </section>

      {/* T2 — what's still open, with one CTA */}
      {card.openAgorot > 0 && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-danger/8 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone="danger-solid">{tl('claims.openForClaim')}</Badge>
            <span className="rm-print-accent text-xl font-bold tabular-nums text-ink">
              {ils(card.openAgorot, locale)}
            </span>
            <span className="text-xs text-muted">
              {t('leakCard.openLines', { count: formatNumber(card.openCount, locale) })}
            </span>
          </div>
          {!print && (
            <LinkButton href={`/dashboard/leaks/claims?sup=${supplierId}`} size="sm" data-testid="supplier-claims-cta">
              {/* The ₪ the letter it opens prints — never the 90-day open total. */}
              {card.letterAgorot > 0
                ? tl('claims.openSupplierLetter', { amount: ils(card.letterAgorot, locale) })
                : tl('claims.openSupplierLetterPlain')}
            </LinkButton>
          )}
        </section>
      )}

      <div className={cn('grid gap-5', print ? 'grid-cols-2' : 'lg:grid-cols-2')}>
        <section aria-labelledby="leak-types">
          <h2 id="leak-types" className="mb-2 text-sm font-bold text-ink">{t('leakCard.topTypes')}</h2>
          <ol className="space-y-2">
            {card.topTypes.map((r) => {
              const pct = card.leakAgorot > 0 ? Math.min(1, Math.round(r.leakIls * 100) / card.leakAgorot) : 0;
              return (
                <li key={r.key}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate text-ink">{discrepancyLabel(ta, r.key)}</span>
                    <span className="shrink-0 tabular-nums text-ink">{formatIls(r.leakIls, { locale, maximumFractionDigits: 2 })}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-surface-2" aria-hidden="true">
                    <div className="rm-bar h-1.5 rounded-full bg-danger" style={{ width: `${Math.max(4, pct * 100)}%` }} />
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        <section aria-labelledby="leak-lines">
          <h2 id="leak-lines" className="mb-2 text-sm font-bold text-ink">{t('leakCard.topLines')}</h2>
          <ol className="divide-y divide-line text-sm">
            {card.topLines.map((l) => {
              const item = displayName(locale, l.productName ?? l.lineDescription, l.productNameEn ?? l.lineDescriptionEn);
              const inv = l.invoiceNumber ? t('leakCard.invoice', { number: l.invoiceNumber }) : t('leakCard.invoiceNoNumber');
              // Expected vs charged, so the supplier can verify the line (SUP-02).
              // TODO(W2-09): render through W1-07's flags/WhyLine once both are on main (no cross-package imports in wave 1).
              const math = lineMathText(
                { type: l.type, severity: l.severity ?? null, expected: l.expected ?? null, actual: l.actual ?? null, deltaAmount: l.deltaAmount },
                t.appLocale,
              );
              return (
                <li key={l.discrepancyId} className="flex items-start justify-between gap-3 py-2" data-testid="supplier-leak-line">
                  <div className="min-w-0">
                    <p className="truncate text-ink">{item || discrepancyLabel(ta, l.type)}</p>
                    {math ? (
                      <p className="text-xs text-ink" data-testid="supplier-leak-math">
                        {math}
                      </p>
                    ) : null}
                    <p className="text-xs text-subtle">
                      {discrepancyLabel(ta, l.type)} ·{' '}
                      {print ? (
                        inv
                      ) : (
                        <Link href={`/dashboard/invoices/${l.invoiceId}`} className="text-primary underline underline-offset-2">
                          {inv}
                        </Link>
                      )}
                      {l.invoiceDate ? <> · <span className="tabular-nums">{day(l.invoiceDate.slice(0, 10))}</span></> : null}
                    </p>
                  </div>
                  <span className="rm-print-accent shrink-0 font-semibold tabular-nums text-ink">{ils(l.amountAgorot, locale)}</span>
                </li>
              );
            })}
          </ol>
        </section>
      </div>

      <Scorecard sc={sc} gated={card.scorecardGated} locale={locale} t={t} />
    </div>
  );
}

function Scorecard({
  sc,
  gated,
  locale,
  t,
}: {
  sc: SupplierLeakCard['scorecard'];
  gated: boolean;
  locale: Locale;
  t: Translator<typeof suppliersHe>;
}) {
  if (!sc && !gated) return null; // no match runs with this supplier yet
  return (
    <section aria-labelledby="leak-scorecard" className="border-t border-line pt-4">
      <h2 id="leak-scorecard" className="mb-2 text-sm font-bold text-ink">{t('leakCard.scorecard')}</h2>
      {sc ? (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <Stat label={t('leakCard.runs')} value={formatNumber(sc.matchRunsCount, locale)} />
          <Stat label={t('leakCard.clean')} value={formatPercent(sc.cleanMatchPct / 100, locale)} />
          <Stat label={t('leakCard.priceDelta')} value={formatPercent(sc.avgPriceDeltaPct, locale)} />
          <Stat label={t('leakCard.duplicates')} value={formatNumber(sc.duplicateInvoicesCount, locale)} />
        </dl>
      ) : (
        <p className="text-sm text-subtle">{t('leakCard.noScorecard')}</p>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-subtle">{label}</dt>
      <dd className="tabular-nums text-ink">{value}</dd>
    </div>
  );
}
