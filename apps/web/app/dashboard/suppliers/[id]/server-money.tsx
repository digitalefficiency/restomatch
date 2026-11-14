import { formatIls } from '@/lib/money';
import type { Locale } from '@/lib/i18n/config';
import { cnMerge as cn } from '@/lib/components/cn';
import { splitGlyph } from '@/lib/components/money/format';

/**
 * ₪ for the supplier page, formatted ONCE on the server with the frozen
 * formatIls() and shipped as text. The client <Money> re-formats with the
 * browser's ICU, and CI's Chromium formats differently from Node, which caused
 * a hydration mismatch (React then client-rendered the shell and the Bell's
 * useId diverged). Same look as <Money>: <bdi class="num">, tabular figures,
 * never mono. null → "unavailable", never ₪0. Classes join with the Tailwind-aware
 * cnMerge (as <Money> does), so a call site's `text-3xl` wins over a metric size.
 * `hero` draws the ₪ glyph like <Money context="hero">.
 */
export function ServerMoney({
  agorot,
  decimals,
  locale,
  className,
  unavailableText,
  testId,
  hero = false,
}: {
  agorot: number | null;
  decimals: number;
  locale: Locale;
  className?: string;
  unavailableText: string;
  testId?: string;
  hero?: boolean;
}) {
  if (agorot == null) return <span className={cn('text-muted', className)}>{unavailableText}</span>;
  const text = formatIls(agorot / 100, { locale, maximumFractionDigits: decimals });
  return (
    <span className={cn('inline-flex items-baseline', className)} data-testid={testId}>
      <bdi className="num whitespace-nowrap">
        {hero
          ? splitGlyph(text).map((part, i) => (
              <span key={i} className={part.glyph ? 'money-glyph' : undefined}>
                {part.text}
              </span>
            ))
          : text}
      </bdi>
    </span>
  );
}
