/**
 * W2-11 · the supplier page has 5 tabs: סקירה · מחירים · הזמנות · כרטסת · פרטים.
 * Every old `?tab=` keeps resolving: catalog/contract → prices, schedule →
 * details (#days-and-times), leak → overview (the leak card sits under it).
 */
export type SupplierTab = 'overview' | 'prices' | 'orders' | 'ledger' | 'details';

const LEGACY: Record<string, SupplierTab> = {
  overview: 'overview',
  leak: 'overview',
  prices: 'prices',
  catalog: 'prices',
  contract: 'prices',
  orders: 'orders',
  ledger: 'ledger',
  details: 'details',
  schedule: 'details',
};

export function supplierTabs(opts: { ledger: boolean }): SupplierTab[] {
  return ['overview', 'prices', 'orders', ...(opts.ledger ? (['ledger'] as const) : []), 'details'];
}

/** A raw `?tab=` → the tab to show; unknown or unavailable → overview (the default). */
export function resolveSupplierTab(raw: string | null | undefined, opts: { ledger: boolean }): SupplierTab {
  const t = raw ? LEGACY[raw] : undefined;
  if (!t) return 'overview';
  if (t === 'ledger' && !opts.ledger) return 'overview';
  return t;
}

/** The anchor a legacy tab scrolls to inside its new home. */
export function legacyAnchor(raw: string | null | undefined): string | null {
  if (raw === 'schedule') return 'days-and-times';
  if (raw === 'contract') return 'contract';
  if (raw === 'leak') return 'leak-card';
  return null;
}
