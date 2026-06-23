import Link from 'next/link';
import { Plus } from 'lucide-react';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { Button, SectionHeader } from '@/lib/components';
import { OrdersList } from './list-client';
import { ZesttImportButton } from './import-client';

export default async function OrdersPage() {
  const caller = await createServerCaller();
  const [initial, memberships, session] = await Promise.all([
    caller.orders.list({ limit: 50 }),
    caller.onboarding.myMemberships(),
    auth(),
  ]);
  const active =
    memberships.find((m) => m.restaurantId === session?.user?.restaurantId) ?? memberships[0];
  const canEdit = active?.role === 'owner' || active?.role === 'manager';

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <SectionHeader
          level={1}
          title="הזמנות"
          subtitle="בנו והגישו הזמנות לספקים מתוך הקטלוג — וההזמנה תוצלב אוטומטית מול החשבונית שתתקבל."
        />
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && <ZesttImportButton />}
          <Link href="/dashboard/orders/new">
            <Button variant="primary" size="sm">
              <Plus className="h-4 w-4" /> הזמנה חדשה
            </Button>
          </Link>
        </div>
      </div>
      <OrdersList initial={initial} />
    </div>
  );
}
