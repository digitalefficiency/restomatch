import type { UserRole } from '@restomatch/db';
import type { Locale } from '@/lib/i18n/config';
import { displayName } from '@/lib/components/displayName';

export interface SearchResults {
  suppliers: Array<{ id: string; name: string; nameEn?: string | null }>;
  products: Array<{ id: string; canonicalName: string; nameEn?: string | null }>;
  invoices: Array<{ id: string; invoiceNumber: string | null }>;
}

export interface SearchOption {
  kind: 'screen' | 'supplier' | 'product' | 'invoice';
  id: string;
  label: string;
  /** Hebrew original under an English label, when it differs. */
  secondary?: string;
  href: string;
}

/** The section routes `search.global` results open (suppliers, products, invoices). */
export const RECORD_SECTIONS = ['/dashboard/suppliers', '/dashboard/catalog', '/dashboard/invoices'] as const;

/**
 * Flatten `search.global` into keyboard-navigable options, in display order
 * (suppliers → products → invoices). Groups whose destination the role can't
 * open are dropped (`canSee` receives the section route, e.g.
 * `/dashboard/suppliers`), so a receiver never gets a link that 403s.
 */
export function buildSearchOptions(
  data: SearchResults,
  opts: { locale: Locale; canSee: (sectionHref: string) => boolean; noInvoiceNumber: string },
): SearchOption[] {
  const out: SearchOption[] = [];
  if (opts.canSee('/dashboard/suppliers')) {
    for (const s of data.suppliers) {
      const d = displayName(s.name, s.nameEn, opts.locale);
      out.push({
        kind: 'supplier',
        id: s.id,
        label: d.primary,
        secondary: d.secondary ?? undefined,
        href: `/dashboard/suppliers/${s.id}`,
      });
    }
  }
  if (opts.canSee('/dashboard/catalog')) {
    for (const p of data.products) {
      const d = displayName(p.canonicalName, p.nameEn, opts.locale);
      out.push({
        kind: 'product',
        id: p.id,
        label: d.primary,
        secondary: d.secondary ?? undefined,
        href: `/dashboard/products/${p.id}`,
      });
    }
  }
  if (opts.canSee('/dashboard/invoices')) {
    for (const i of data.invoices) {
      out.push({
        kind: 'invoice',
        id: i.id,
        label: i.invoiceNumber ?? opts.noInvoiceNumber,
        href: `/dashboard/invoices/${i.id}`,
      });
    }
  }
  return out;
}

/**
 * What the role can actually find (ia-nav-04): the placeholder never promises
 * more. The receiver and the chef open no supplier, product or invoice page
 * (they see no ₪), so their search finds screens only.
 */
export function searchPlaceholderKey(role: UserRole) {
  if (role === 'receiver' || role === 'chef') return 'search.placeholderScreens' as const;
  return 'search.placeholder' as const;
}

/** A registry screen the viewer may open (label already localized). */
export interface SearchScreen {
  key: string;
  href: string;
  label: string;
  aliases: readonly string[];
}

/**
 * Fold a query or a label for matching: case, niqqud, geresh/gershayim and
 * quotes, Hebrew final letters (ך→כ…), and runs of whitespace.
 */
export function normalizeSearch(s: string): string {
  return s
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[\u0591-\u05C7]/g, '')
    .replace(/[׳״'"`]/g, '')
    .replace(/ך/g, 'כ')
    .replace(/ם/g, 'מ')
    .replace(/ן/g, 'נ')
    .replace(/ף/g, 'פ')
    .replace(/ץ/g, 'צ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The "מסכים" section: registry screens whose label or alias contains the
 * query (from 1 character, no network). Label-prefix matches first, then
 * alias-prefix, then anywhere; at most `limit`.
 */
export function buildScreenOptions(query: string, screens: readonly SearchScreen[], limit = 6): SearchOption[] {
  const q = normalizeSearch(query);
  if (!q) return [];
  const scored: Array<{ s: SearchScreen; score: number }> = [];
  for (const s of screens) {
    const label = normalizeSearch(s.label);
    const aliases = s.aliases.map(normalizeSearch);
    let score = -1;
    if (label.startsWith(q)) score = 0;
    else if (label.split(' ').some((w) => w.startsWith(q))) score = 1;
    else if (aliases.some((a) => a.startsWith(q))) score = 2;
    else if (label.includes(q) || aliases.some((a) => a.includes(q))) score = 3;
    if (score >= 0) scored.push({ s, score });
  }
  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map(({ s }) => ({ kind: 'screen' as const, id: s.key, label: s.label, href: s.href }));
}
