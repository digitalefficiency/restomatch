import type { FixtureRoute } from '../transport';
import type { ZesterOrder } from '../adapters/zester';

/** Recorded-shape Zester responses (synthetic values) for the offline provider. */
const VENDORS = [
  { vendor_id: 'zs-v-10', name: 'קצביית הכרם', company_number: '514111222', email: 'orders@hakerem.example' },
  { vendor_id: 'zs-v-11', name: 'תבליני פרשמן', company_number: '515222333' },
];

const ITEMS = [
  { item_id: 'zs-i-1', vendor_id: 'zs-v-10', name: 'אנטריקוט טרי', sku: 'KR-01', unit_name: 'ק״ג', category: 'בשר' },
  { item_id: 'zs-i-2', vendor_id: 'zs-v-10', name: 'חזה עוף', sku: 'KR-07', unit_name: 'ק״ג', category: 'עוף' },
  { item_id: 'zs-i-3', vendor_id: 'zs-v-11', name: 'פפריקה מתוקה', sku: 'FR-30', unit_name: 'ק״ג', category: 'תבלינים' },
];

const ORDERS: ZesterOrder[] = [
  {
    order_id: 'zs-o-501',
    order_number: 'Z-501',
    vendor_id: 'zs-v-10',
    vendor_name: 'קצביית הכרם',
    state: 'approved',
    delivery_date: '2026-10-19',
    total: 1464,
    items: [
      { line_id: 'zs-l-1', item_id: 'zs-i-1', item_name: 'אנטריקוט טרי', quantity: 8, unit_name: 'ק״ג', price: 139 },
      { line_id: 'zs-l-2', item_id: 'zs-i-2', item_name: 'חזה עוף', quantity: 12, unit_name: 'ק״ג', price: 29.33 },
    ],
  },
  {
    order_id: 'zs-o-502',
    order_number: 'Z-502',
    vendor_id: 'zs-v-11',
    vendor_name: 'תבליני פרשמן',
    state: 'submitted',
    delivery_date: '2026-10-21',
    total: 96,
    items: [{ line_id: 'zs-l-3', item_id: 'zs-i-3', item_name: 'פפריקה מתוקה', quantity: 2, unit_name: 'ק״ג', price: 48 }],
  },
];

/** Two pages for /purchase-orders, so the pagination path runs offline too. */
export const ZESTER_FIXTURE: Record<string, FixtureRoute> = {
  '/vendors': { data: VENDORS, next_page: null },
  '/items': { data: ITEMS, next_page: null },
  '/purchase-orders': (q) => {
    const list = q.delivery_date ? ORDERS.filter((o) => o.delivery_date === q.delivery_date) : ORDERS;
    if (q.delivery_date) return { data: list, next_page: null };
    return q.page === '2' ? { data: list.slice(1), next_page: null } : { data: list.slice(0, 1), next_page: '2' };
  },
  '/purchase-orders/:id': (_q, p) => ORDERS.find((o) => o.order_id === p.id),
};
