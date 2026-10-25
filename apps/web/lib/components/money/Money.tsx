'use client';

import { CheckCircle2, Clock } from 'lucide-react';
import type { MoneyState } from '@restomatch/ui-tokens';
import { useLocale, useT } from '@/lib/i18n/client';
import type { Locale } from '@/lib/i18n/config';
import { components } from '@/lib/i18n/messages/components';
import { cn } from '../cn';
import { exactText, moneyText, MONEY_DECIMALS, shekelsOf, splitGlyph, stateClass, type MoneyContext } from './format';

const CONTEXT_CLASS: Record<MoneyContext, string> = {
  hero: 'text-metric-hero',
  tile: 'text-metric-lg',
  line: '',
  unit: '',
  inline: '',
};

export interface MoneyProps {
  /** Shekels (NUMERIC strings must be parsed by the caller — this never does money math). */
  value?: number | null;
  /** Integer agorot (billing/pricing). Takes precedence over `value`. */
  agorot?: number | null;
  /** Precision and type role: hero/tile/inline 0 dp · line 2 dp · unit 4 dp. */
  context?: MoneyContext;
  /** Money state → figure colour (A9). ₪0 is never danger. */
  state?: MoneyState;
  /** Override the context's decimals (e.g. a total beside 2 dp rows uses 2). */
  decimals?: number;
  /** A credit reads as the word, never a sign or parentheses: "זיכוי ₪120". */
  credit?: boolean;
  /** The value failed to load: "לא זמין · נסו שוב" — never ₪0. */
  unavailable?: boolean;
  /** Not known yet (T4): "ממתין". */
  pending?: boolean;
  /** Locale override for server-rendered callers that already know it. */
  locale?: Locale;
  className?: string;
}

/**
 * The ONE way to show ₪ (design-system-01/-02). A plain <bdi> around the frozen
 * `formatIls()` output — no `dir`, so in Hebrew the glyph sits at the visual
 * left ("‏760 ₪") exactly like the claim letter. Heebo with tabular, lining
 * figures (`.num`); never mono. Rounded figures carry the exact agorot in `title`.
 */
export function Money({
  value,
  agorot,
  context = 'line',
  state,
  decimals,
  credit = false,
  unavailable = false,
  pending = false,
  locale: localeProp,
  className,
}: MoneyProps) {
  const ctxLocale = useLocale();
  const locale = localeProp ?? ctxLocale;
  const t = useT(components);
  const shekels = shekelsOf({ value, agorot });

  if (pending || (state === 'pending' && shekels === null)) {
    return (
      <span className={cn('inline-flex items-center gap-1 text-muted', className)}>
        <Clock className="h-[1em] w-[1em] shrink-0" aria-hidden="true" />
        {t('ds.money.pending')}
      </span>
    );
  }
  if (unavailable || shekels === null) {
    return <span className={cn('text-muted', className)}>{t('ds.money.unavailable')}</span>;
  }

  const shown = decimals ?? MONEY_DECIMALS[context];
  const amount = credit ? Math.abs(shekels) : shekels;
  const text = moneyText(amount, context, locale, shown);
  const exact = exactText(amount, shown, locale);

  return (
    <span className={cn('inline-flex items-baseline gap-1', CONTEXT_CLASS[context], stateClass(state, shekels), className)}>
      {credit ? <span>{t('ds.money.credit')}</span> : null}
      <bdi className="num whitespace-nowrap" title={exact ? t('ds.money.exact', { amount: exact }) : undefined}>
        {context === 'hero'
          ? splitGlyph(text).map((part, i) =>
              part.glyph ? (
                <span key={i} className="money-glyph">
                  {part.text}
                </span>
              ) : (
                <span key={i}>{part.text}</span>
              ),
            )
          : text}
      </bdi>
      {state === 'credited' ? <CheckCircle2 className="h-[0.9em] w-[0.9em] shrink-0 self-center" aria-hidden="true" /> : null}
    </span>
  );
}
