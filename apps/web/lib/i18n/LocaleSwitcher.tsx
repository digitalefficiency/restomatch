'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Languages } from 'lucide-react';
import { cn } from '@/lib/components/cn';
import { dirOf, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE_SEC, type Locale } from './config';
import { useLocale } from './client';

/**
 * עברית ⇄ English toggle. Writes the `rm_locale` cookie, flips <html lang/dir>
 * immediately (no flash), then refreshes the server components so every
 * server-rendered string re-renders in the new language.
 */
export function LocaleSwitcher({ className }: { className?: string }) {
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const next: Locale = locale === 'he' ? 'en' : 'he';

  function switchTo(target: Locale) {
    const secure = window.location.protocol === 'https:' ? '; secure' : '';
    document.cookie = `${LOCALE_COOKIE}=${target}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE_SEC}; samesite=lax${secure}`;
    document.documentElement.lang = target;
    document.documentElement.dir = dirOf(target);
    startTransition(() => router.refresh());
  }

  return (
    <button
      type="button"
      onClick={() => switchTo(next)}
      disabled={pending}
      lang={next}
      aria-label={next === 'en' ? 'Switch to English' : 'החלפה לעברית'}
      title={next === 'en' ? 'Switch to English' : 'החלפה לעברית'}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-xs font-semibold text-muted transition-colors hover:border-primary/40 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-60',
        className,
      )}
    >
      <Languages className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{next === 'en' ? 'EN' : 'עב'}</span>
    </button>
  );
}
