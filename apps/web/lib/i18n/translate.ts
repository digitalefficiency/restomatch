import { baseLocaleOf, DEFAULT_LOCALE, type AppLocale, type Locale, type ReceiverLocale } from './config';

/**
 * Tiny, dependency-free message runtime.
 *
 * A namespace is a nested object of strings authored in Hebrew (the source of
 * truth) plus an English twin whose shape is enforced by `Shape<typeof he>` —
 * a missing English key is a type error AND fails `i18n.test.ts`.
 *
 * Interpolation: `{name}` placeholders, filled from the vars object, plus
 * ICU-lite plurals: `{count, plural, =0 {…} one {…} two {…} other {# …}}`,
 * resolved with `Intl.PluralRules` for the rendered locale (Hebrew has a dual:
 * יום אחד · יומיים · 3 ימים). `#` is the count, locale-formatted. Strings
 * without plural syntax render exactly as before.
 * Fallback chain (he/en): active locale → Hebrew → the key itself (never throws).
 *
 * Receiver locales (ar/ru/th/ti) are OVERLAYS: a namespace may carry
 * `extra[locale]`, a deep-partial of the English shape. Lookup for a receiver
 * locale depends on whether the namespace has overlays at all:
 *   - overlaid namespace (`ns.extra` set): overlay → Hebrew → key. A receiver
 *     at an Israeli restaurant reads the floor's Hebrew better than English,
 *     so a key the overlay does not cover (a slice overlay, or a key added
 *     before its translation lands) falls back to Hebrew, never English.
 *   - namespace without overlays: English → Hebrew → key, so a non-receiver
 *     screen (owner/bookkeeper tooling) renders in English.
 * Receiver-facing namespaces declare their overlays with `CompleteOverlays<…>`
 * (every key, every receiver locale — a type error otherwise), either over the
 * whole namespace or over its receiver-facing slice.
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

/** Per-call options. `raw` lists var names spliced verbatim (no bidi isolation): file names, CSV keys. */
export interface TranslateOptions {
  readonly raw?: readonly string[];
}

export type Translator<T extends MessageTree> = ((
  key: MessageKey<T>,
  vars?: MessageVars,
  opts?: TranslateOptions,
) => string) & {
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

const PLURAL_START = /\{\s*(\w+)\s*,\s*plural\s*,/g;
const PLURAL_CATEGORIES = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);

/** Index of the `}` closing the `{` at `open`, or -1. */
function closingBrace(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i += 1) {
    if (s[i] === '{') depth += 1;
    else if (s[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

/** `=0 {…} one {…} other {…}` → selector → message; null when malformed. */
function pluralOptions(body: string): Map<string, string> | null {
  const options = new Map<string, string>();
  let i = 0;
  while (i < body.length) {
    const m = /^\s*(=\d+|[a-z]+)\s*\{/.exec(body.slice(i));
    if (!m) return /^\s*$/.test(body.slice(i)) && options.has('other') ? options : null;
    const open = i + m[0].length - 1;
    const close = closingBrace(body, open);
    if (close < 0) return null;
    const selector = m[1]!;
    if (!selector.startsWith('=') && !PLURAL_CATEGORIES.has(selector)) return null;
    options.set(selector, body.slice(open + 1, close));
    i = close + 1;
  }
  return options.has('other') ? options : null;
}

/** Resolve every `{name, plural, …}` whose count is in `vars`; anything else is left verbatim. */
function resolvePlurals(template: string, vars: MessageVars, intlLocale: string): string {
  let out = '';
  let from = 0;
  PLURAL_START.lastIndex = 0;
  for (let m = PLURAL_START.exec(template); m; m = PLURAL_START.exec(template)) {
    const close = closingBrace(template, m.index);
    if (close < 0) break;
    const raw = template.slice(m.index, close + 1);
    const options = pluralOptions(template.slice(m.index + m[0].length, close));
    const n = Number(vars[m[1]!]);
    let resolved = raw;
    if (options && Object.prototype.hasOwnProperty.call(vars, m[1]!) && Number.isFinite(n)) {
      const message =
        options.get(`=${n}`) ?? options.get(new Intl.PluralRules(intlLocale).select(n)) ?? options.get('other')!;
      resolved = resolvePlurals(message, vars, intlLocale).replace(/#/g, new Intl.NumberFormat(intlLocale).format(n));
    }
    out += template.slice(from, m.index) + resolved;
    from = close + 1;
    PLURAL_START.lastIndex = from;
  }
  return out + template.slice(from);
}

/* ── Bidi isolation (copy-rtl-13) ─────────────────────────────────────────────
 * A value spliced into a sentence of the other direction scrambles it: in a
 * Hebrew sentence "בהזמנה מ-{supplier}." with "Coca-Cola Ltd." renders the
 * period on the wrong side and pulls the quote marks apart (Lab I). The fix is
 * an FSI…PDI isolate (U+2068/U+2069) around the value, so the browser lays it
 * out as one unit.
 *
 * Direction-aware default: a value is isolated only when it can actually
 * reorder, i.e. it holds a letter of the OTHER direction (Latin in he/ar,
 * Hebrew/Arabic in en/ru/th/ti) together with anything that is not a letter
 * (a space, digit, period, hyphen, quote). Pure numerals, formatted ₪/%
 * strings, same-script text and a single other-script word pass through
 * untouched, so every existing string renders byte-identical.
 */
export const FSI = '\u2068';
export const PDI = '\u2069';
const RTL_LETTER = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const LTR_LETTER = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u052F\u0E00-\u0E7F\u1200-\u139F]/;
const LETTERS_ONLY = /^[\p{L}\p{M}]+$/u;
const RTL_LOCALES = /^(he|iw|ar|fa|ur|yi)\b/i;

/** True when `intlLocale` renders right-to-left. */
export function isRtlLocale(intlLocale: string): boolean {
  return RTL_LOCALES.test(intlLocale);
}

/** Would `value`, spliced into a sentence of `rtl` direction, need an isolate? */
export function needsIsolation(value: string, rtl: boolean): boolean {
  if (value.includes(FSI)) return false; // already isolated by the caller
  const opposite = rtl ? LTR_LETTER : RTL_LETTER;
  return opposite.test(value) && !LETTERS_ONLY.test(value);
}

/** Wrap in FSI…PDI when needed (see `needsIsolation`). */
export function isolate(value: string, rtl: boolean): string {
  return needsIsolation(value, rtl) ? FSI + value + PDI : value;
}

/** Remove FSI/LRI/RLI/PDI marks: for tests and plain-text exports that must not carry them. */
export function stripIsolates(s: string): string {
  return s.replace(/[\u2066-\u2069]/g, '');
}

export function interpolate(
  template: string,
  vars?: MessageVars,
  intlLocale = 'he-IL',
  opts?: TranslateOptions,
): string {
  if (!vars) return template;
  const withPlurals = template.includes('plural') ? resolvePlurals(template, vars, intlLocale) : template;
  const rtl = isRtlLocale(intlLocale);
  const raw = opts?.raw;
  return withPlurals.replace(/\{(\w+)\}/g, (match, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(vars, name)) return match;
    const value = String(vars[name]);
    return raw?.includes(name) ? value : isolate(value, rtl);
  });
}

export function createTranslator<T extends MessageTree>(locale: AppLocale, ns: Namespace<T>): Translator<T> {
  const chain: Array<MessageTree | undefined> =
    locale === 'he'
      ? [ns.he]
      : locale === 'en'
        ? [ns.en as MessageTree, ns[DEFAULT_LOCALE]]
        : ns.extra
          ? // Receiver locale, overlaid namespace: a gap falls back to Hebrew, never English.
            [ns.extra[locale] as MessageTree | undefined, ns[DEFAULT_LOCALE]]
          : // Receiver locale, no overlays (non-receiver screen): English.
            [ns.en as MessageTree, ns[DEFAULT_LOCALE]];
  // Plural categories follow the RENDERED language (ru has few/many, he has a dual).
  const pluralLocale = locale === 'he' ? 'he-IL' : locale === 'en' ? 'en-GB' : locale;
  const t = (key: MessageKey<T>, vars?: MessageVars, opts?: TranslateOptions): string => {
    let raw: string | undefined;
    for (const tree of chain) {
      raw = lookup(tree, key);
      if (raw !== undefined) break;
    }
    return interpolate(raw ?? key, vars, pluralLocale, opts);
  };
  return Object.assign(t, { locale: baseLocaleOf(locale), appLocale: locale });
}
