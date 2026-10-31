import Link from 'next/link';
import { ArrowLeft, HelpCircle } from 'lucide-react';
import { cn } from '@/lib/components';
import { formatNumber } from '@/lib/i18n/format';
import type { Locale } from '@/lib/i18n/config';

const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2';

/**
 * G-08 · "N מוצרים מחכים לשאלה: זה אותו מוצר?" — when the link policy is unsure
 * it asks a person instead of guessing, and the question must be seen. A calm
 * T2 line: one CTA to the mapper, a warn rail and no alarm, no ₪. Hidden at 0.
 */
export function QuestionsLine({
  count,
  locale,
  label,
  cta,
}: {
  count: number;
  locale: Locale;
  label: (count: string) => string;
  cta: string;
}) {
  if (count <= 0) return null;
  return (
    <Link
      href="/dashboard/catalog/mapping"
      data-testid="home-link-questions"
      className={cn(
        'relative mb-4 flex min-h-[48px] items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3 ps-5 shadow-card hover:border-primary/40',
        'before:absolute before:inset-y-3 before:start-1.5 before:w-1 before:rounded-full before:bg-warn',
        focus,
      )}
    >
      <span className="flex min-w-0 items-center gap-2 text-sm text-ink">
        <HelpCircle className="h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
        <span className="min-w-0">{label(formatNumber(count, locale))}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-primary">
        {cta}
        <ArrowLeft className="h-4 w-4 ltr:-scale-x-100" aria-hidden="true" />
      </span>
    </Link>
  );
}
