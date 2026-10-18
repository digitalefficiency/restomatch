import type { Locale } from '@/lib/i18n/config';
import { displayName } from '@/lib/components/displayName';

export interface SearchResults {
  suppliers: Array<{ id: string; name: string; nameEn?: string | null }>;
  products: Array<{ id: string; canonicalName: string; nameEn?: string | null }>;
  invoices: Array<{ id: string; invoiceNumber: string | null }>;
}

export interface SearchOption {
  kind: 'supplier' | 'product' | 'invoice';
  id: string;
  label: string;
  /** Hebrew original under an English label, when it differs. */
  secondary?: string;
  href: string;
}

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
