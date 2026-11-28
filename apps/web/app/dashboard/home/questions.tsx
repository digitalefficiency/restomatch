import Link from 'next/link';
import { cn } from '@/lib/components/cn';
import { StatusDot } from '@/lib/components/feedback/StatusChip';
import { DirIcon } from '@/lib/components/icon';
import { formatNumber } from '@/lib/i18n/format';
import type { Locale } from '@/lib/i18n/config';
import type { UserRole } from '@restomatch/db';
import { getT } from '@/lib/i18n/server';
import { catalog as catalogNs } from '@/lib/i18n/messages/catalog';

/**
 * G-08 · "N מוצרים מחכים לשאלה: זה אותו מוצר?" — when the link policy is unsure
 * it asks a person instead of guessing, and the question must be seen. A calm
 * T2 line in the clean finish's card: the amber dot (it waits for handling,
 * blocks nothing), one CTA to the mapper, no alarm, no ₪. Hidden at 0.
 * `spacing` places it: under the page title on the chef's home (the default),
 * under the "מחכה לך" card on the finance homes (never above the T1 hero).
 */
export function QuestionsLine({
  count,
  locale,
  label,
  cta,
  spacing = 'mb-4',
}: {
  count: number;
  locale: Locale;
  label: (count: string) => string;
  cta: string;
  spacing?: string;
}) {
  if (count <= 0) return null;
  return (
    <Link
      href="/dashboard/catalog/mapping"
      data-testid="home-link-questions"
      className={cn(
        spacing,
        'flex min-h-12 items-center justify-between gap-3 rounded-card border border-line-rule bg-surface px-5 py-3 shadow-e1 transition-colors duration-micro ease-standard hover:bg-surface-hover max-sm:px-4',
      )}
    >
      <span className="flex min-w-0 items-center gap-2.5 text-body-sm text-fg">
        <StatusDot tone="warn" />
        <span className="min-w-0">{label(formatNumber(count, locale))}</span>
      </span>
      <span className="flex shrink-0 items-center gap-0.5 text-body-sm font-medium text-primary">
        {cta}
        <DirIcon kind="forward" size="caption" />
      </span>
    </Link>
  );
}

/** Roles that may answer a question (mapping.answerLink): only they see the line. */
export const QUESTION_ROLES: readonly UserRole[] = ['owner', 'manager', 'chef'];

/**
 * The home's question line, for any role's home. Reads ONLY the count
 * (mapping.questionCount, no ₪). A failed read hides the line rather than
 * blocking the home. This is the chef's way into /dashboard/catalog/mapping
 * (nav-registry.test.ts names it as the chef's reachability exception).
 */
export async function HomeQuestions({
  caller,
  role,
  locale,
  spacing,
}: {
  caller: { mapping: { questionCount: () => Promise<{ count: number }> } };
  role: UserRole;
  locale: Locale;
  spacing?: string;
}) {
  if (!QUESTION_ROLES.includes(role)) return null;
  const [count, t] = await Promise.all([
    caller.mapping
      .questionCount()
      .then((r) => r.count)
      .catch(() => 0),
    getT(catalogNs),
  ]);
  return (
    <QuestionsLine
      count={count}
      locale={locale}
      label={(n) => t('mapping.pendingQuestions', { count: n })}
      cta={t('mapping.answerCta')}
      spacing={spacing}
    />
  );
}
