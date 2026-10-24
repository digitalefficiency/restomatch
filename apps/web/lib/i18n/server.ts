import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { featureEnabled } from '@restomatch/api';
import {
  LOCALE_COOKIE,
  isReceiverLocale,
  resolveAppLocale,
  resolveLocale,
  type AppLocale,
  type Locale,
} from './config';
import { createTranslator, type MessageTree, type Namespace, type Translator } from './translate';

/**
 * Active BASE locale for this request (he | en; a receiver locale is 'en').
 * Formatting and every non-receiver screen use this.
 */
export async function getLocale(): Promise<Locale> {
  return resolveLocale(await getAppLocale());
}

/**
 * May this request render a receiver locale (ar/ru/th/ti)?
 * - `FEATURES_OFF` kill-switch → never.
 * - Signed out (login, check-email, 2FA) → yes: the language is the device's.
 * - Signed in → only when the active restaurant has `receiverLanguages` on.
 * Any failure → no (English is always a safe fallback).
 */
const receiverLocalesAllowed = cache(async (): Promise<boolean> => {
  if (!featureEnabled({ features: { receiverLanguages: true } }, 'receiverLanguages')) return false;
  try {
    const { createServerCaller } = await import('@/lib/trpc/server');
    const { auth } = await import('@/auth');
    const session = await auth();
    if (!session?.user?.restaurantId) return true;
    const caller = await createServerCaller();
    return (await caller.receiverLangs.status()).enabled;
  } catch {
    return false;
  }
});

/** The rendered locale (cookie `rm_locale`), receiver locales gated by the flag. */
export const getAppLocale = cache(async (): Promise<AppLocale> => {
  const store = await cookies();
  const raw = resolveAppLocale(store.get(LOCALE_COOKIE)?.value);
  if (!isReceiverLocale(raw)) return raw;
  return (await receiverLocalesAllowed()) ? raw : 'en';
});

/**
 * Server-component translator:
 *   const t = await getT(landing);
 *   t('hero.title')
 */
export async function getT<T extends MessageTree>(ns: Namespace<T>): Promise<Translator<T>> {
  return createTranslator(await getAppLocale(), ns);
}
