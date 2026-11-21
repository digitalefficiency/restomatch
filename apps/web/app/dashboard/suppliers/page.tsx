import { Truck } from 'lucide-react';
import { createServerCaller } from '@/lib/trpc/server';
import {
  EmptyState,
  EntitlementUpsell,
  SectionHeader,
  entitlementCauseOf,
} from '@/lib/components';
import { getT } from '@/lib/i18n/server';
import { suppliers as suppliersNs } from '@/lib/i18n/messages/suppliers';
import { SuppliersList } from './list';
import { SuppliersTabs } from './tabs';
import { SupplierManager } from './manager';
import { VendorTable } from './vendor-table';
import { canEditSupplier } from './[id]/read-only';
import { auth } from '@/auth';

const PAGE = 9;

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const caller = await createServerCaller();
  const t = await getT(suppliersNs);
  const { view } = await searchParams;

  // Scorecards are advanced_analytics-gated; render the upsell in that tab
  // instead of failing the whole page (management stays available to everyone).
  let scorecardsNode: React.ReactNode;
  try {
    const scorecards = await caller.owner.suppliers({ limit: PAGE });
    scorecardsNode =
      scorecards.length === 0 ? (
        <EmptyState
          icon={<Truck className="h-6 w-6" />}
          title={t('scores.emptyTitle')}
          description={t('scores.emptyBody')}
        />
      ) : (
        <SuppliersList initial={scorecards} />
      );
  } catch (err) {
    const ent = entitlementCauseOf(err);
    if (ent) scorecardsNode = <EntitlementUpsell cause={ent} />;
    else throw err;
  }

  // W2-11 · the owner's vendor table — finance roles only (suppliers.table refuses the rest).
  const table = await caller.suppliers.table({ includeInactive: true }).catch(() => null);
  const role = ((await auth())?.user as { role?: string } | undefined)?.role;
  const defaultTab = table && role === 'owner' ? 'table' : 'manage';
  const initialTab =
    view === 'scores' ? 'scores' : view === 'manage' ? 'manage' : view === 'table' && table ? 'table' : defaultTab;

  return (
    <div>
      <SectionHeader level={1} title={t('title')} subtitle={t('subtitle')} />
      <SuppliersTabs
        initialTab={initialTab}
        defaultTab={defaultTab}
        table={table ? <VendorTable rows={table.rows} totals={table.totals} /> : undefined}
        management={<SupplierManager canEdit={canEditSupplier(role)} />}
        scorecards={scorecardsNode}
      />
    </div>
  );
}
