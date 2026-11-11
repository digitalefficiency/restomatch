import { formatIls } from '@/lib/money';
import type { Locale } from '@/lib/i18n/config';
import { cn } from '@/lib/components';

/**
 * ₪ for the supplier page, formatted ONCE on the server with the frozen
 * formatIls() and shipped as text. The client <Money> re-formats with the
 * browser's ICU, and CI's Chromium formats differently from Node, which caused
 * a hydration mismatch (React then client-rendered the shell and the Bell's
 * useId diverged). Same look as <Money>: <bdi class="num">, tabular figures,
 * never mono. null → "unavailable", never ₪0.
 */
export function ServerMoney({
  agorot,
  decimals,
  locale,
  className,
  unavailableText,
  testId,
}: {
  agorot: number | null;
  decimals: number;
  locale: Locale;
  className?: string;
  unavailableText: string;
  testId?: string;
}) {
  if (agorot == null) return <span className={cn('text-muted', className)}>{unavailableText}</span>;
  return (
    <span className={cn('inline-flex items-baseline', className)} data-testid={testId}>
      <bdi className="num whitespace-nowrap">{formatIls(agorot / 100, { locale, maximumFractionDigits: decimals })}</bdi>
    </span>
  );
}
