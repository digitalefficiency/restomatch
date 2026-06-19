import { Truck } from 'lucide-react';
import { createServerCaller } from '@/lib/trpc/server';
import {
  EmptyState,
  EntitlementUpsell,
  SectionHeader,
  entitlementCauseOf,
} from '@/lib/components';
import { SuppliersList } from './list';
import { SuppliersTabs } from './tabs';
import { SupplierManager } from './manager';

const PAGE = 9;

export default async function SuppliersPage() {
  const caller = await createServerCaller();

  // Scorecards are advanced_analytics-gated; render the upsell in that tab
  // instead of failing the whole page (management stays available to everyone).
  let scorecardsNode: React.ReactNode;
  try {
    const scorecards = await caller.owner.suppliers({ limit: PAGE });
    scorecardsNode =
      scorecards.length === 0 ? (
        <EmptyState
          icon={<Truck className="h-6 w-6" />}
          title="אין עדיין נתוני ספקים"
          description="הדוח מתבסס על השוואות (match runs) מהזמן האחרון. ברגע שייכנסו קבלות וחשבוניות, הספקים יופיעו כאן."
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
      <SectionHeader
        level={1}
        title="ספקים"
        subtitle="הקמת ספקים, פרטי קשר ותנאי תשלום — והדירוג שמראה מי מוסיף עלויות סמויות."
      />
      <SuppliersTabs management={<SupplierManager />} scorecards={scorecardsNode} />
    </div>
  );
}
