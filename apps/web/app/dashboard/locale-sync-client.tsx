'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { dirOf, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE_SEC, type Locale } from '@/lib/i18n/config';

/** Writes the member's preferred locale into `rm_locale` and re-renders once. */
export function ApplyLocale({ locale }: { locale: Locale }) {
  const router = useRouter();
  useEffect(() => {
    const secure = window.location.protocol === 'https:' ? '; secure' : '';
    document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE_SEC}; samesite=lax${secure}`;
    document.documentElement.lang = locale;
    document.documentElement.dir = dirOf(locale);
    router.refresh();
  }, [locale, router]);
  return null;
}
