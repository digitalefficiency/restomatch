import { Check, Minus } from 'lucide-react';
import { getT } from '@/lib/i18n/server';
import { growth } from '@/lib/i18n/messages/growth';

/**
 * "Your ordering system orders. RestoMatch checks." — the landing answer to
 * "we already have an ordering system" (flag `landingCompare`, lib/landingFlags.ts;
 * off = no section). No competitor names, no numbers we can't show.
 *
 * Every RestoMatch cell is a capability on main:
 *   number   → packages/charts/src/leak-hero.ts (computeLeakHero, the dashboard ₪ hero)
 *   dock     → packages/api/src/routers/receiving.ts + apps/web/app/dashboard/receiving
 *   invoice  → packages/matching/src/index.ts (the 12 DiscrepancyType, incl. DUPLICATE_INVOICE)
 *   payment  → packages/api/src/approvals/engine.ts + apps/web/app/dashboard/approvals
 *   supplier → apps/web/app/dashboard/leaks/claims (credit-request letters per supplier)
 *
 * Colours are the semantic tokens only (ink / muted / surface / line / primary),
 * so the section follows the light theme without a second design language.
 */
export const COMPARE_ROWS = ['number', 'dock', 'invoice', 'payment', 'supplier'] as const;

export async function LandingCompare() {
  const t = await getT(growth);
  return (
    <section
      id="compare"
      data-flag="landingCompare"
      aria-labelledby="compare-title"
      className="scroll-mt-24 mx-auto max-w-5xl px-4 py-20 sm:px-6"
    >
      <div className="mx-auto mb-10 max-w-2xl text-center">
        <p className="mb-3 text-xs font-semibold uppercase text-muted ltr:tracking-[0.2em] rtl:text-sm">
          {t('compare.eyebrow')}
        </p>
        <h2 id="compare-title" className="text-balance text-3xl font-bold tracking-tight text-ink sm:text-4xl">
          {t('compare.title')}
        </h2>
        <p className="mt-4 text-base leading-relaxed text-muted">{t('compare.lead')}</p>
      </div>

      <table className="block w-full border-collapse text-start sm:table">
        <caption className="sr-only">{t('compare.title')}</caption>
        <thead className="hidden sm:table-header-group">
          <tr className="border-b border-line text-sm">
            <th scope="col" className="w-40 px-4 py-3 text-start font-semibold text-muted">
              {t('compare.colStep')}
            </th>
            <th scope="col" className="px-4 py-3 text-start font-semibold text-muted">
              {t('compare.colOrdering')}
            </th>
            <th scope="col" className="px-4 py-3 text-start font-semibold text-ink">
              {t('compare.colRestomatch')}
            </th>
          </tr>
        </thead>
        <tbody className="block space-y-4 sm:table-row-group sm:space-y-0">
          {COMPARE_ROWS.map((row) => (
            <tr
              key={row}
              data-testid="compare-row"
              className="block rounded-2xl border border-line bg-surface p-4 sm:table-row sm:rounded-none sm:border-0 sm:border-b sm:bg-transparent sm:p-0"
            >
              <th
                scope="row"
                className="block pb-2 text-start text-base font-bold text-ink sm:table-cell sm:px-4 sm:py-4 sm:align-top sm:text-sm"
              >
                {t(`compare.rows.${row}.step`)}
              </th>
              <td className="flex gap-2 py-1 text-sm text-muted sm:table-cell sm:px-4 sm:py-4 sm:align-top">
                <Minus className="mt-0.5 h-4 w-4 shrink-0 text-muted sm:hidden" aria-hidden="true" />
                <span>
                  <span className="font-semibold sm:hidden">{t('compare.colOrdering')}: </span>
                  {t(`compare.rows.${row}.ordering`)}
                </span>
              </td>
              <td className="flex gap-2 py-1 text-sm text-ink sm:table-cell sm:px-4 sm:py-4 sm:align-top">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary sm:hidden" aria-hidden="true" />
                <span>
                  <span className="font-semibold sm:hidden">{t('compare.colRestomatch')}: </span>
                  {t(`compare.rows.${row}.restomatch`)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-8 text-center text-base font-semibold text-ink">{t('compare.keepOrdering')}</p>
    </section>
  );
}
