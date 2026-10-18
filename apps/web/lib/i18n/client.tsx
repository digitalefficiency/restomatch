'use client';

import { createContext, useContext, useMemo } from 'react';
import { DEFAULT_LOCALE, dirOf, type Locale } from './config';
import { createTranslator, type MessageTree, type Namespace, type Translator } from './translate';

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);
// Cast wrapper: the workspace hoists two @types/react majors (mobile is on 18),
// so a raw Context.Provider fails the JSX element check (see STATE.md).
const LocaleProvider = LocaleContext.Provider as unknown as React.ComponentType<{
  value: Locale;
  children?: React.ReactNode;
}>;

/** Mounted once in the root layout with the request's locale. */
export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <LocaleProvider value={locale}>{children}</LocaleProvider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useDir(): 'rtl' | 'ltr' {
  return dirOf(useLocale());
}

/**
 * Client-component translator:
 *   const t = useT(receiving);
 *   t('scan.title')
 * Import only the namespaces a component needs so the bundle stays small.
 */
export function useT<T extends MessageTree>(ns: Namespace<T>): Translator<T> {
  const locale = useLocale();
  return useMemo(() => createTranslator(locale, ns), [locale, ns]);
}
