'use client';

import { CheckCircle2, Clock } from 'lucide-react';
import type { MoneyState } from '@restomatch/ui-tokens';
import { useLocale, useT } from '@/lib/i18n/client';
import type { Locale } from '@/lib/i18n/config';
import { components } from '@/lib/i18n/messages/components';
import { cnMerge as cn } from '../cn';
import { MONEY_QUIET } from '../tone';
import {
  exactText,
  moneyFigureText,
  moneyText,
  MONEY_DECIMALS,
  shekelsOf,
  splitGlyph,
  splitMoney,
  stateClass,
  type MoneyContext,
  type MoneyPart,
} from './format';

const CONTEXT_CLASS: Record<MoneyContext, string> = {
  hero: 'text-metric-hero',
  tile: 'text-metric-lg',
  line: '',
  unit: '',
  inline: '',
};

/**
 * SPEC §3: the ₪ sign at about 0.74 em of the figure and never under the 12 px desk floor (the
 * caption role), in regular weight; the agorot keep the figure's size. Both are quiet (tertiary)
 * unless the figure itself is coloured, in which case they take the figure's colour.
 */
const GLYPH_SIZE = 'text-[length:max(0.74em,var(--fs-caption))] font-normal';

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
  /**
   * Where the ₪ glyph goes. `inline` (default) prints it with every figure.
   * `header` prints the figure only, for a bookkeeper compact table whose column
   * header carries "(₪)" once (owner decision D8). Never on owner screens. The
   * exact amount with ₪ stays in `title`.
   */
  symbol?: 'inline' | 'header';
  /**
   * DS3 money markup (SPEC §3, opt-in): the ₪ sign (≈0.74 em, never under 12 px) and the agorot
   * as their own quiet spans of the same `formatIls()` text. Off by default, so the amount stays
   * ONE text node: e2e specs of other packages locate the ₪ glyph and its digits inside a single
   * text node (W1-05…W2-14, G-10, the G-16 crawl). A screen that adopts `split` updates its own spec.
   */
  split?: boolean;
  /**
   * With `split`: the ₪ sign and the agorot in the tertiary colour. Default: on for an ink figure,
   * off for a coloured one (they share its colour). Pass `false` inside a coloured context.
   */
  quietParts?: boolean;
  className?: string;
}

function Parts({ parts, quiet }: { parts: MoneyPart[]; quiet: boolean }) {
  return (
    <>
      {parts.map((part, i) =>
        part.kind === 'glyph' ? (
          <span key={i} data-money="cur" className={cn(GLYPH_SIZE, quiet && MONEY_QUIET)}>
            {part.text}
          </span>
        ) : part.kind === 'dec' ? (
          <span key={i} data-money="dec" className={quiet ? MONEY_QUIET : undefined}>
            {part.text}
          </span>
        ) : (
          part.text
        ),
      )}
    </>
  );
}

/**
 * The ONE way to show ₪ (design-system-01/-02, DS3 SPEC §3). A plain <bdi> around the frozen
 * `formatIls()` output — no `dir`, so in Hebrew the glyph sits at the visual left ("‏760 ₪")
 * exactly like the claim letter. With `split` (the clean finish's markup) the text is cut, never
 * changed: the ₪ sign and the agorot become quiet, smaller spans of the same string and the digits
 * keep the figure's colour. The UI face with tabular, lining figures (`.num`); never mono.
 * Rounded figures carry the exact agorot in `title`.
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
  symbol = 'inline',
  split = false,
  quietParts,
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
  const figureOnly = symbol === 'header' && context !== 'hero';
  // With the glyph in the header, the title always names the amount with ₪.
  const title = exact ?? (figureOnly ? text : null);
  const figureColour = stateClass(state, shekels);
  // A coloured figure (muted, green…) keeps one colour; an ink figure has quiet parts.
  const quiet = quietParts ?? (figureColour === undefined || figureColour === 'text-ink');

  return (
    <span className={cn('inline-flex items-baseline gap-1', CONTEXT_CLASS[context], figureColour, className)}>
      {credit ? <span>{t('ds.money.credit')}</span> : null}
      <bdi className="num whitespace-nowrap" title={title ? t('ds.money.exact', { amount: title }) : undefined}>
        {context === 'hero' && !figureOnly ? (
          splitGlyph(text).map((part, i) =>
            part.glyph ? (
              <span key={i} className="money-glyph">
                {part.text}
              </span>
            ) : (
              <span key={i}>{part.text}</span>
            ),
          )
        ) : split ? (
          <Parts parts={splitMoney(figureOnly ? moneyFigureText(amount, context, locale, shown) : text, shown)} quiet={quiet} />
        ) : figureOnly ? (
          moneyFigureText(amount, context, locale, shown)
        ) : (
          text
        )}
      </bdi>
      {state === 'credited' ? <CheckCircle2 className="h-[0.9em] w-[0.9em] shrink-0 self-center" aria-hidden="true" /> : null}
    </span>
  );
}
