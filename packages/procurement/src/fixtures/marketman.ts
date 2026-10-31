import type { FixtureRoute } from '../transport';
import type { MarketManOrder } from '../adapters/marketman';

/**
 * Recorded-shape MarketMan responses for the offline provider (demo + tests).
 * Shapes follow the adapter's documented contract (VERIFY markers in
 * adapters/marketman.ts); values are synthetic, no real account.
 */
const SUPPLIERS = [
  { id: 'mm-sup-1', name: 'ירקות השרון', businessId: '512345678', contactEmail: 'orders@sharon-veg.example' },
  { id: 'mm-sup-2', name: 'מחלבות הגליל', businessId: '513456789' },
];

const PRODUCTS = [
  { id: 'mm-p-1', supplierId: 'mm-sup-1', name: 'עגבניות שרי', sku: 'SH-1001', unit: 'ק״ג', category: 'ירקות' },
  { id: 'mm-p-2', supplierId: 'mm-sup-1', name: 'מלפפונים', sku: 'SH-1002', unit: 'ק״ג', category: 'ירקות' },
  { id: 'mm-p-3', supplierId: 'mm-sup-2', name: 'שמנת מתוקה 38%', sku: 'GL-220', unit: 'ליטר', category: 'חלב' },
];

const ORDERS: MarketManOrder[] = [
  {
    id: 'mm-ord-1001',
    number: 'PO-1001',
    supplierId: 'mm-sup-1',
    supplierName: 'ירקות השרון',
    status: 'sent',
    expectedDeliveryAt: '2026-10-19T06:00:00Z',
    currency: 'ILS',
    totalEstimated: 254.4,
    lines: [
      { id: 'mm-l-1', productId: 'mm-p-1', description: 'עגבניות שרי', qty: 12, unit: 'ק״ג', unitPrice: 12.95 },
      { id: 'mm-l-2', productId: 'mm-p-2', description: 'מלפפונים', qty: 20, unit: 'ק״ג', unitPrice: 4.95 },
    ],
  },
  {
    id: 'mm-ord-1002',
    number: 'PO-1002',
    supplierId: 'mm-sup-2',
    supplierName: 'מחלבות הגליל',
    status: 'confirmed',
    expectedDeliveryAt: '2026-10-20T05:30:00Z',
    currency: 'ILS',
    totalEstimated: 186,
    lines: [{ id: 'mm-l-3', productId: 'mm-p-3', description: 'שמנת מתוקה 38%', qty: 12, unit: 'ליטר', unitPrice: 15.5 }],
  },
];

export const MARKETMAN_FIXTURE: Record<string, FixtureRoute> = {
  '/suppliers': { suppliers: SUPPLIERS },
  '/products': { products: PRODUCTS },
  '/orders/deliveries': (q) => ({
    orders: ORDERS.filter((o) => o.expectedDeliveryAt?.slice(0, 10) === q.date),
  }),
  '/orders': () => ({ orders: ORDERS }),
  '/orders/:id': (_q, p) => ORDERS.find((o) => o.id === p.id),
};
