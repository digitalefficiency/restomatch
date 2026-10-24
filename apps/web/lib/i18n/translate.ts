import { baseLocaleOf, DEFAULT_LOCALE, type AppLocale, type Locale, type ReceiverLocale } from './config';

/**
 * Tiny, dependency-free message runtime.
 *
 * A namespace is a nested object of strings authored in Hebrew (the source of
 * truth) plus an English twin whose shape is enforced by `Shape<typeof he>` —
 * a missing English key is a type error AND fails `i18n.test.ts`.
 *
 * Interpolation: `{name}` placeholders, filled from the vars object.
 * Fallback chain: active locale → Hebrew → the key itself (never throws).
 *
 * Receiver locales (ar/ru/th/ti) are OVERLAYS: a namespace may carry
 * `extra[locale]`, a deep-partial of the English shape. Lookup for a receiver
 * locale is overlay → English → Hebrew → key, so a screen nobody translated
 * renders in English. Receiver-facing namespaces declare their overlays with
 * `CompleteOverlays<…>` (every key, every receiver locale — a type error
 * otherwise); everything else simply has none.
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

/** Same keys as T but every key optional (an overlay may cover a subtree). */
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends string ? string : DeepPartial<T[K]> };

/** Per-receiver-locale overlays (any subset of keys). */
export type Overlays<T> = { readonly [L in ReceiverLocale]?: DeepPartial<Shape<T>> };

/**
 * Complete overlays: every receiver locale, every key of T. Use with the whole
 * namespace (`CompleteOverlays<typeof he>`) or with the receiver-facing slice
 * of a larger one (`CompleteOverlays<Pick<typeof he, 'login'>>`).
 */
export type CompleteOverlays<T> = { readonly [L in ReceiverLocale]: Shape<T> };

export interface Namespace<T extends MessageTree = MessageTree> {
  readonly name: string;
  readonly he: T;
  readonly en: Shape<T>;
  readonly extra?: Overlays<T>;
}

export type Translator<T extends MessageTree> = ((key: MessageKey<T>, vars?: MessageVars) => string) & {
  /** Base (he/en) locale — what formatters and non-receiver code expect. */
  readonly locale: Locale;
  /** The rendered locale, including receiver locales. */
  readonly appLocale: AppLocale;
};

export function defineMessages<T extends MessageTree>(name: string, he: T, en: Shape<T>): Namespace<T> {
  return { name, he, en };
}

/** Attach receiver-locale overlays to a namespace (returns a new namespace). */
export function withReceiverLocales<T extends MessageTree>(ns: Namespace<T>, extra: Overlays<T>): Namespace<T> {
  return { ...ns, extra };
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

export function createTranslator<T extends MessageTree>(locale: AppLocale, ns: Namespace<T>): Translator<T> {
  const chain: Array<MessageTree | undefined> =
    locale === 'he'
      ? [ns.he]
      : locale === 'en'
        ? [ns.en as MessageTree, ns[DEFAULT_LOCALE]]
        : [ns.extra?.[locale] as MessageTree | undefined, ns.en as MessageTree, ns[DEFAULT_LOCALE]];
  const t = (key: MessageKey<T>, vars?: MessageVars): string => {
    let raw: string | undefined;
    for (const tree of chain) {
      raw = lookup(tree, key);
      if (raw !== undefined) break;
    }
    return interpolate(raw ?? key, vars);
  };
  return Object.assign(t, { locale: baseLocaleOf(locale), appLocale: locale });
}
