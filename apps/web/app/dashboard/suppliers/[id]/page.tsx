import { createServerCaller } from '@/lib/trpc/server';
import { SupplierDetailsTab } from './tab-details';
import { SupplierCatalogTab } from './tab-catalog';
import { SupplierScheduleTab } from './tab-schedule';
import { SupplierOrdersTab } from './tab-orders';
import { SupplierContractTab } from './tab-contract';
import type { SupplierTab } from './tab-bar';

export const dynamic = 'force-dynamic';

/**
 * Supplier-as-hub panels. The layout renders the header + tab bar; this page
 * reads ?tab= and renders the matching panel (default: details). Catalog/orders
 * are async server components; details/schedule are client (they own the
 * suppliers.get query + mutations) and are seeded with the server-loaded row as
 * `initialData`, so they render immediately instead of waiting on a client
 * round trip (QA saw the Details tab stuck on "Loading supplier…" when that
 * first client request stalled).
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
  const tab: SupplierTab = (['details', 'catalog', 'schedule', 'orders', 'contract'] as const).includes(
    rawTab as SupplierTab,
  )
    ? (rawTab as SupplierTab)
    : 'details';

  switch (tab) {
    case 'catalog':
      return <SupplierCatalogTab supplierId={id} />;
    case 'orders':
      return <SupplierOrdersTab supplierId={id} />;
    case 'contract':
      return <SupplierContractTab supplierId={id} />;
    case 'schedule':
    case 'details':
    default: {
      // Ownership is enforced in suppliers.get (the layout already 404s a foreign id).
      const caller = await createServerCaller();
      const initial = await caller.suppliers.get({ supplierId: id });
      return tab === 'schedule' ? (
        <SupplierScheduleTab supplierId={id} initial={initial} />
      ) : (
        <SupplierDetailsTab supplierId={id} initial={initial} />
      );
    }
  }
}
