import { cookies } from 'next/headers';
import { createServerCaller } from '@/lib/trpc/server';
import { getAppLocale } from '@/lib/i18n/server';
import { LOCALE_COOKIE, isAppLocale, isReceiverLocale } from '@/lib/i18n/config';
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
  if (isAppLocale(store.get(LOCALE_COOKIE)?.value)) return null;
  let preferred: string | null = null;
  try {
    const caller = await createServerCaller();
    preferred = (await caller.settings.myLocale()).locale;
    // Receiver languages (S14): adopt ar/ru/th/ti only while the flag is on.
    if (isReceiverLocale(preferred) && !(await caller.receiverLangs.status()).enabled) preferred = 'en';
  } catch {
    return null; // never break the dashboard over a language preference
  }
  if (!isAppLocale(preferred) || preferred === (await getAppLocale())) return null;
  return <ApplyLocale locale={preferred} />;
}
