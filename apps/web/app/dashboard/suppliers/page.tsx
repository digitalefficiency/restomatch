import { Truck } from 'lucide-react';
import { createServerCaller } from '@/lib/trpc/server';
import {
  EmptyState,
  EntitlementUpsell,
  SectionHeader,
  entitlementCauseOf,
} from '@/lib/components';
import { SuppliersList } from './list';

const PAGE = 9;

export default async function SuppliersPage() {
  const caller = await createServerCaller();

  let scorecards: Awaited<ReturnType<typeof caller.owner.suppliers>> = [];
  try {
    scorecards = await caller.owner.suppliers({ limit: PAGE });
  } catch (err) {
    const ent = entitlementCauseOf(err);
    if (ent) {
      return (
        <div>
          <SectionHeader
            level={1}
            title="דירוג ספקים"
            subtitle="ספק שגדל ב-clean match% הוא ספק שלא מוסיף עלויות סמויות."
          />
          <EntitlementUpsell cause={ent} />
        </div>
      );
    }
    throw err;
  }

  return (
    <div>
      <SectionHeader
        level={1}
        title="דירוג ספקים"
        subtitle="ספק שגדל ב-clean match% הוא ספק שלא מוסיף עלויות סמויות."
      />

      {scorecards.length === 0 ? (
        <EmptyState
          icon={<Truck className="h-6 w-6" />}
          title="אין עדיין נתוני ספקים"
          description="הדוח מתבסס על השוואות (match runs) מהזמן האחרון. ברגע שייכנסו קבלות וחשבוניות, הספקים יופיעו כאן."
        />
      ) : (
        <SuppliersList initial={scorecards} />
      )}
    </div>
  );
}
