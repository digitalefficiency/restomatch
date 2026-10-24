'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Languages } from 'lucide-react';
import { cn } from '@/lib/components/cn';
import {
  APP_LOCALES,
  dirOf,
  isAppLocale,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE_SEC,
  LOCALE_NATIVE_NAMES,
  type AppLocale,
} from './config';
import { useAppLocale, useT } from './client';
import { receiverLangs } from './messages/receiverLangs';

/**
 * Six-language picker (he · en · ar · ru · th · ti) — replaces the עב/EN toggle
 * where the `receiverLanguages` flag is on (dashboard) or on signed-out pages
 * (login), unless killed by FEATURES_OFF. Writes `rm_locale`, flips <html
 * lang/dir> at once and refreshes server components. No tRPC here: the login
 * page has no TrpcProvider. The dashboard uses `PersistingLanguagePicker`
 * (./PersistingLanguagePicker), which passes `onSave` to also store the choice
 * as the member's language (best effort), so the next login on a new phone opens in it.
 */
export function LanguagePicker({
  className,
  onSave,
}: {
  className?: string;
  onSave?: (locale: AppLocale) => Promise<unknown>;
}) {
  const locale = useAppLocale();
  const router = useRouter();
  const t = useT(receiverLangs);
  const [pending, startTransition] = useTransition();

  function switchTo(target: AppLocale) {
    const secure = window.location.protocol === 'https:' ? '; secure' : '';
    document.cookie = `${LOCALE_COOKIE}=${target}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE_SEC}; samesite=lax${secure}`;
    document.documentElement.lang = target;
    document.documentElement.dir = dirOf(target);
    const refresh = () => startTransition(() => router.refresh());
    if (onSave) onSave(target).then(refresh, refresh);
    else refresh();
  }

  return (
    <label
      title={t('picker.title')}
      className={cn(
        'inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2 py-1 text-xs font-semibold text-muted focus-within:ring-2 focus-within:ring-primary/60',
        className,
      )}
    >
      <Languages className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="sr-only">{t('picker.label')}</span>
      <select
        value={locale}
        disabled={pending}
        onChange={(e) => {
          if (isAppLocale(e.target.value)) switchTo(e.target.value);
        }}
        data-testid="language-picker"
        className="cursor-pointer bg-transparent text-xs font-semibold text-ink focus:outline-none disabled:opacity-60"
      >
        {APP_LOCALES.map((l) => (
          <option key={l} value={l} lang={l}>
            {LOCALE_NATIVE_NAMES[l]}
          </option>
        ))}
      </select>
    </label>
  );
}
