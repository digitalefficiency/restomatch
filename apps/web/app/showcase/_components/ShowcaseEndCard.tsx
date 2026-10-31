'use client';

import Link from 'next/link';
import { MessageCircle, Sparkles } from 'lucide-react';
import { useLocale, useT } from '@/lib/i18n/client';
import { showcase } from '@/lib/i18n/messages/showcase';
import { formatIls } from '@/lib/money';
import { contactChannels, whatsappHref } from '@/lib/contact';

/** What the sample restaurant's caught-this-month tile shows (dashboard KPI "saved"). */
export const SAMPLE_CAUGHT_THIS_MONTH_ILS = 12_340;

export type EndCardKind = 'receiver' | 'dashboard' | 'invoices';

/**
 * Every demo ends at its "aha" with a way forward (W1-12 · mkt-18): a calm T3
 * line naming the ₪ the screen just caught, one primary "התחילו פיילוט חינם"
 * (the lead form) and, when a number is configured, "שלחו חשבונית בוואטסאפ".
 */
export function ShowcaseEndCard({
  kind,
  amountIls,
}: {
  kind: EndCardKind;
  amountIls: number | null;
}) {
  const t = useT(showcase);
  const locale = useLocale();
  const wa = contactChannels().whatsapp;
  const line =
    amountIls && amountIls > 0
      ? t(`endCard.${kind}`, { amount: formatIls(amountIls, { locale }) })
      : t('endCard.receiverClean');

  return (
    <section
      aria-labelledby={`end-card-${kind}`}
      data-testid="showcase-end-card"
      className="mx-auto mt-12 max-w-3xl rounded-2xl border border-gold/40 bg-surface p-6 shadow-card sm:p-8"
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Sparkles className="h-4 w-4 text-gold" aria-hidden="true" />
        {t('endCard.eyebrow')}
      </p>
      <h2
        id={`end-card-${kind}`}
        className="mt-2 text-xl font-bold tracking-tight text-ink sm:text-2xl"
      >
        {line}
      </h2>
      <p className="mt-2 text-base leading-relaxed text-muted">{t('endCard.body')}</p>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <Link
          href="/#lead"
          className="inline-flex min-h-12 items-center justify-center rounded-xl bg-primary px-6 text-base font-semibold text-on-primary hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          {t('endCard.ctaPilot')}
        </Link>
        {wa ? (
          <a
            href={whatsappHref(wa.digits, t('endCard.whatsappText'))}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-6 text-base font-semibold text-ink hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <MessageCircle className="h-4 w-4" aria-hidden="true" />
            {t('endCard.ctaWhatsapp')}
          </a>
        ) : null}
      </div>
    </section>
  );
}
