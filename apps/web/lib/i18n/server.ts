import 'server-only';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE, resolveLocale, type Locale } from './config';
import { createTranslator, type MessageTree, type Namespace, type Translator } from './translate';

/** Active locale for this request (cookie `rm_locale`, default Hebrew). */
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  return resolveLocale(store.get(LOCALE_COOKIE)?.value);
}

/**
 * Server-component translator:
 *   const t = await getT(landing);
 *   t('hero.title')
 */
export async function getT<T extends MessageTree>(ns: Namespace<T>): Promise<Translator<T>> {
  return createTranslator(await getLocale(), ns);
}
