import { cookies } from 'next/headers';
import { createServerCaller } from '@/lib/trpc/server';
import { getLocale } from '@/lib/i18n/server';
import { LOCALE_COOKIE, isLocale } from '@/lib/i18n/config';
import { ApplyLocale } from './locale-sync-client';

/**
 * Per-member language (client-ready S4). When THIS device has never chosen a
 * language (no `rm_locale` cookie) and the member has a saved preference that
 * differs from what is rendering, adopt it: the client child writes the cookie
 * and refreshes once. A device that already chose (switcher / ?lang=) is never
 * overridden — the switcher always wins on that device.
 */
export async function LocaleSync() {
  const store = await cookies();
  if (isLocale(store.get(LOCALE_COOKIE)?.value)) return null;
  let preferred: string | null = null;
  try {
    const caller = await createServerCaller();
    preferred = (await caller.settings.myLocale()).locale;
  } catch {
    return null; // never break the dashboard over a language preference
  }
  if (!isLocale(preferred) || preferred === (await getLocale())) return null;
  return <ApplyLocale locale={preferred} />;
}
