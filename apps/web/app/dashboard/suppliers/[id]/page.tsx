import { createServerCaller } from '@/lib/trpc/server';
import { SupplierDetailsTab } from './tab-details';
import { SupplierCatalogTab } from './tab-catalog';
import { SupplierScheduleTab } from './tab-schedule';
import { SupplierOrdersTab } from './tab-orders';
import { SupplierContractTab } from './tab-contract';
import { SupplierLeakTab } from './tab-leak';
import { SupplierLedgerTab } from './tab-ledger';
import { SupplierOverviewTab } from './tab-overview';
import { resolveSupplierTab } from './tab-model';
import { getWave1Access } from '../../contracts/access';

export const dynamic = 'force-dynamic';

/**
 * Supplier-as-hub panels (W2-11): 5 tabs — סקירה · מחירים · הזמנות · כרטסת ·
 * פרטים — default overview. Old `?tab=` values resolve into their new home
 * (tab-model.ts): catalog/contract → prices, schedule → details
 * (#days-and-times), leak → overview with the leak card under it (#leak-card).
 * Details/schedule are client tabs seeded with the server-loaded row as
 * `initialData`, so they render immediately.
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
  const caller = await createServerCaller();
  const initial = await caller.suppliers.get({ supplierId: id });
  const tab = resolveSupplierTab(rawTab, { ledger: initial.ledgerEnabled });

  switch (tab) {
    case 'overview':
      return (
        <div className="space-y-8">
          <SupplierOverviewTab supplierId={id} leakCard={initial.leakCardEnabled} />
          {initial.leakCardEnabled ? (
            <section id="leak-card" className="scroll-mt-24">
              <SupplierLeakTab supplierId={id} />
            </section>
          ) : null}
        </div>
      );
    case 'prices': {
      // Wave-1 contract section: `contracts` flag on + finance role (fails silent → hidden).
      const showContract = (await getWave1Access()).contracts;
      return (
        <div className="space-y-8">
          <SupplierCatalogTab supplierId={id} />
          {showContract ? (
            <section id="contract" className="scroll-mt-24">
              <SupplierContractTab supplierId={id} />
            </section>
          ) : null}
        </div>
      );
    }
    case 'orders':
      return <SupplierOrdersTab supplierId={id} />;
    case 'ledger':
      return <SupplierLedgerTab supplierId={id} />;
    case 'details':
    default:
      return (
        <div className="space-y-8">
          <SupplierDetailsTab supplierId={id} initial={initial} />
          <section id="days-and-times" className="scroll-mt-24">
            <SupplierScheduleTab supplierId={id} initial={initial} />
          </section>
        </div>
      );
  }
}
