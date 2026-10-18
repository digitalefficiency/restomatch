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

  return (
    <div>
      <SectionHeader level={1} title={t('title')} subtitle={t('subtitle')} />
      <SuppliersTabs
        initialTab={view === 'scores' ? 'scores' : 'manage'}
        management={<SupplierManager />}
        scorecards={scorecardsNode}
      />
    </div>
  );
}
