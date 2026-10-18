import { SupplierDetailsTab } from './tab-details';
import { SupplierCatalogTab } from './tab-catalog';
import { SupplierScheduleTab } from './tab-schedule';
import { SupplierOrdersTab } from './tab-orders';
import type { SupplierTab } from './tab-bar';

export const dynamic = 'force-dynamic';

/**
 * Supplier-as-hub panels. The layout renders the header + tab bar; this page
 * reads ?tab= and renders the matching panel (default: details). Catalog/orders
 * are async server components; details/schedule are client (they own the
 * suppliers.get query + mutations).
 */
export default async function SupplierDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  const tab: SupplierTab = (['details', 'catalog', 'schedule', 'orders'] as const).includes(
    rawTab as SupplierTab,
  )
    ? (rawTab as SupplierTab)
    : 'details';

  switch (tab) {
    case 'catalog':
      return <SupplierCatalogTab supplierId={id} />;
    case 'schedule':
      return <SupplierScheduleTab supplierId={id} />;
    case 'orders':
      return <SupplierOrdersTab supplierId={id} />;
    case 'details':
    default:
      return <SupplierDetailsTab supplierId={id} />;
  }
}
