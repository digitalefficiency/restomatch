import { DEFAULT_LOCALE, type Locale } from './config';

/**
 * Tiny, dependency-free message runtime.
 *
 * A namespace is a nested object of strings authored in Hebrew (the source of
 * truth) plus an English twin whose shape is enforced by `Shape<typeof he>` —
 * a missing English key is a type error AND fails `i18n.test.ts`.
 *
 * Interpolation: `{name}` placeholders, filled from the vars object.
 * Fallback chain: active locale → Hebrew → the key itself (never throws).
 */
export interface MessageTree {
  [key: string]: string | MessageTree;
}

/** Same keys as T, every leaf a string — the type the English file must satisfy. */
export type Shape<T> = { [K in keyof T]: T[K] extends string ? string : Shape<T[K]> };

/** Dotted paths to every string leaf of T, e.g. `'hero.title'`. */
export type MessageKey<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${MessageKey<T[K]>}`;
}[keyof T & string];

export type MessageVars = Record<string, string | number>;

export interface Namespace<T extends MessageTree = MessageTree> {
  readonly name: string;
  readonly he: T;
  readonly en: Shape<T>;
}

export type Translator<T extends MessageTree> = ((key: MessageKey<T>, vars?: MessageVars) => string) & {
  readonly locale: Locale;
};

export function defineMessages<T extends MessageTree>(name: string, he: T, en: Shape<T>): Namespace<T> {
  return { name, he, en };
}

export function lookup(tree: MessageTree | undefined, key: string): string | undefined {
  let node: string | MessageTree | undefined = tree;
  for (const part of key.split('.')) {
    if (node === undefined || typeof node === 'string') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

export function interpolate(template: string, vars?: MessageVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

export function createTranslator<T extends MessageTree>(locale: Locale, ns: Namespace<T>): Translator<T> {
  const primary = (locale === 'he' ? ns.he : ns.en) as MessageTree;
  const fallback = ns[DEFAULT_LOCALE] as MessageTree;
  const t = (key: MessageKey<T>, vars?: MessageVars): string => {
    const raw = lookup(primary, key) ?? lookup(fallback, key) ?? key;
    return interpolate(raw, vars);
  };
  return Object.assign(t, { locale });
}
