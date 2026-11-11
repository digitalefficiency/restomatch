/**
 * Server-side twin of the web runtime's `interpolate()` (apps/web/lib/i18n/translate.ts),
 * for e-mail copy. packages/api cannot import apps/web, so the two stay small and in sync:
 * `{name}` placeholders, ICU-lite plurals with the Hebrew dual, and direction-aware
 * isolation of values (FSI…PDI in plain text, <bdi> in HTML).
 */
export type CopyVars = Record<string, string | number>;

export const FSI = '⁨';
export const PDI = '⁩';
const RTL_LETTER = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const LTR_LETTER = /[A-Za-zÀ-ɏͰ-ϿЀ-ԯ฀-๿ሀ-᎟]/;
const LETTERS_ONLY = /^[\p{L}\p{M}]+$/u;
const PLURAL_START = /\{\s*(\w+)\s*,\s*plural\s*,/g;

/** Same predicate as the web runtime: other-direction letters mixed with anything but letters. */
export function needsIsolation(value: string, rtl: boolean): boolean {
  if (value.includes(FSI)) return false;
  return (rtl ? LTR_LETTER : RTL_LETTER).test(value) && !LETTERS_ONLY.test(value);
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function closingBrace(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i += 1) {
    if (s[i] === '{') depth += 1;
    else if (s[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

function pluralOptions(body: string): Map<string, string> {
  const options = new Map<string, string>();
  const re = /\s*(=\d+|[a-z]+)\s*\{/y;
  let i = 0;
  while (i < body.length) {
    re.lastIndex = i;
    const m = re.exec(body);
    if (!m) break;
    const open = i + m[0].length - 1;
    const close = closingBrace(body, open);
    if (close < 0) break;
    options.set(m[1]!, body.slice(open + 1, close));
    i = close + 1;
  }
  return options;
}

function resolvePlurals(template: string, vars: CopyVars, intlLocale: string): string {
  let out = '';
  let from = 0;
  PLURAL_START.lastIndex = 0;
  for (let m = PLURAL_START.exec(template); m; m = PLURAL_START.exec(template)) {
    const close = closingBrace(template, m.index);
    if (close < 0) break;
    const name = m[1]!;
    const n = Number(vars[name]);
    let resolved = template.slice(m.index, close + 1);
    if (Object.prototype.hasOwnProperty.call(vars, name) && Number.isFinite(n)) {
      const options = pluralOptions(template.slice(m.index + m[0].length, close));
      const message = options.get(`=${n}`) ?? options.get(new Intl.PluralRules(intlLocale).select(n)) ?? options.get('other');
      if (message !== undefined) {
        resolved = resolvePlurals(message, vars, intlLocale).replace(/#/g, new Intl.NumberFormat(intlLocale).format(n));
      }
    }
    out += template.slice(from, m.index) + resolved;
    from = close + 1;
    PLURAL_START.lastIndex = from;
  }
  return out + template.slice(from);
}

export interface FillOptions {
  /** 'he' → RTL sentence, 'en' → LTR. */
  readonly locale: 'he' | 'en';
  /** HTML mode: the template text and every value are escaped; isolated values use <bdi>. */
  readonly html?: boolean;
  /** HTML mode: vars rendered bold. */
  readonly strong?: readonly string[];
  /** Vars whose value is trusted HTML (already escaped markup), spliced as is. */
  readonly trustedHtml?: readonly string[];
  /** Vars spliced verbatim, never isolated (URLs: a linkifier must see them bare). */
  readonly raw?: readonly string[];
}

/** Fill a copy template. Missing vars stay as `{name}` (visible, never a crash). */
export function fill(template: string, vars: CopyVars, opts: FillOptions): string {
  const intlLocale = opts.locale === 'he' ? 'he-IL' : 'en-GB';
  const rtl = opts.locale === 'he';
  const withPlurals = template.includes('plural') ? resolvePlurals(template, vars, intlLocale) : template;
  const parts = withPlurals.split(/(\{\w+\})/g);
  return parts
    .map((part) => {
      const m = /^\{(\w+)\}$/.exec(part);
      if (!m || !Object.prototype.hasOwnProperty.call(vars, m[1]!)) return opts.html ? escapeHtml(part) : part;
      const name = m[1]!;
      const value = String(vars[name]);
      if (opts.html && opts.trustedHtml?.includes(name)) return value;
      const isolated = !opts.raw?.includes(name) && needsIsolation(value, rtl);
      if (!opts.html) return isolated ? FSI + value + PDI : value;
      let out = escapeHtml(value);
      if (isolated) out = `<bdi>${out}</bdi>`;
      if (opts.strong?.includes(name)) out = `<strong>${out}</strong>`;
      return out;
    })
    .join('');
}
