import { ClipboardList, PackageCheck, ShieldAlert } from 'lucide-react';
import type { Locale } from '@/lib/i18n/config';
import type { Translator } from '@/lib/i18n/translate';
import type { he as landingHe } from '@/lib/i18n/messages/landing/he';
import { formatIls } from '@/lib/money';
import { mockText } from '@/app/showcase/_lib/mockText';
import { Eyebrow, Forward } from './detail-sections';

/**
 * The worked example: the cherry-tomato line of the showcase's INV-7821 (ירקני
 * אבי, PO-1234) — ordered at ₪7.00/kg, invoiced at ₪8.50/kg. Locked to the
 * showcase mock by `__tests__/ordersStory.test.ts`, so the landing and the demo
 * the client clicks into quote the same ₪.
 */
export const ORDERS_STORY_EXAMPLE = {
  supplierName: 'ירקני אבי',
  poNumber: 'PO-1234',
  invoiceNumber: 'INV-7821',
  qtyKg: 20,
  agreedIls: 7,
  billedIls: 8.5,
} as const;

/** One delivery's gap on this line (a one-time figure — never annualised). */
export const ordersStoryGapIls = () =>
  Math.round(
    ORDERS_STORY_EXAMPLE.qtyKg *
      (ORDERS_STORY_EXAMPLE.billedIls - ORDERS_STORY_EXAMPLE.agreedIls) *
      100,
  ) / 100;

/**
 * "The order goes out at the agreed price → the check at the dock → the leak in
 * ₪" (flag `landingOrdersStory`, lib/landingFlags.ts). Copy in the GTM voice:
 * "MarketMan orders, RestoMatch checks you weren't cheated".
 */
export function OrdersStory({ t, locale }: { t: Translator<typeof landingHe>; locale: Locale }) {
  const ex = ORDERS_STORY_EXAMPLE;
  const ils = (n: number, digits = 0) => formatIls(n, { locale, maximumFractionDigits: digits });
  const qty = String(ex.qtyKg);
  const steps = [
    { icon: ClipboardList, title: t('v2.story.s1Title'), body: t('v2.story.s1Body') },
    { icon: PackageCheck, title: t('v2.story.s2Title'), body: t('v2.story.s2Body') },
    { icon: ShieldAlert, title: t('v2.story.s3Title'), body: t('v2.story.s3Body') },
  ];

  return (
    <section
      id="story"
      data-flag="landingOrdersStory"
      className="rm-defer scroll-mt-24 mx-auto max-w-6xl px-4 py-20 sm:px-6"
      aria-labelledby="story-title"
    >
      <div className="mx-auto mb-12 max-w-2xl text-center">
        <Eyebrow>{t('v2.story.eyebrow')}</Eyebrow>
        <h2
          id="story-title"
          className="text-balance text-3xl font-bold tracking-tight text-ink sm:text-4xl"
        >
          {t('v2.story.title')}
        </h2>
        <p className="mt-3 text-base text-muted">{t('v2.story.lead')}</p>
      </div>

      <ol className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {steps.map(({ icon: Icon, title, body }, i) => (
          <li
            key={title}
            className={
              i === 2
                ? 'relative flex flex-col rounded-2xl border border-danger/40 bg-surface p-5 shadow-card'
                : 'relative flex flex-col rounded-2xl border border-line bg-surface p-5 shadow-card'
            }
          >
            <div className="flex items-center gap-3">
              <span
                className={
                  i === 2
                    ? 'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-danger/10 text-danger'
                    : 'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary'
                }
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="text-base font-bold text-ink">
                <span className="sr-only">{i + 1}. </span>
                {title}
              </h3>
              {i < 2 && <Forward className="ms-auto hidden text-muted md:block" />}
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted">{body}</p>

            {/* The same invoice line, as each stop sees it. */}
            <div className="mt-auto pt-5">
              <div className="rounded-xl border border-line bg-bg px-3 py-3 text-sm">
                <p className="font-semibold text-ink">{t('v2.story.product', { qty })}</p>
                {i === 0 && (
                  <p className="mt-1 flex justify-between gap-2 text-muted">
                    <span>{t('v2.story.ordered')}</span>
                    <span className="tabular-nums text-ink">
                      {t('v2.story.perKg', { price: ils(ex.agreedIls, 2) })}
                    </span>
                  </p>
                )}
                {i === 1 && (
                  <>
                    <p className="mt-1 flex justify-between gap-2 text-muted">
                      <span>{t('v2.story.ordered')}</span>
                      <span className="tabular-nums text-ink">
                        {t('v2.story.perKg', { price: ils(ex.agreedIls, 2) })}
                      </span>
                    </p>
                    <p className="mt-1 flex justify-between gap-2 text-muted">
                      <span>{t('v2.story.billed')}</span>
                      <span className="tabular-nums font-semibold text-gold">
                        {t('v2.story.perKg', { price: ils(ex.billedIls, 2) })}
                      </span>
                    </p>
                  </>
                )}
                {i === 2 && (
                  <p className="mt-1 flex items-baseline justify-between gap-2 text-muted">
                    <span>{t('v2.story.gap')}</span>
                    <span className="text-xl font-bold tabular-nums text-danger">
                      {t('v2.story.gapValue', { amount: ils(ordersStoryGapIls()) })}
                    </span>
                  </p>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>

      <p className="mx-auto mt-6 max-w-3xl text-center text-xs leading-relaxed text-muted">
        {t('v2.story.note', { supplier: mockText(ex.supplierName, locale), po: ex.poNumber })}
      </p>
    </section>
  );
}
