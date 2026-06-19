import Link from 'next/link';
import { Plus } from 'lucide-react';
import { createServerCaller } from '@/lib/trpc/server';
import { Button, SectionHeader } from '@/lib/components';
import { OrdersList } from './list-client';

export default async function OrdersPage() {
  const caller = await createServerCaller();
  const initial = await caller.orders.list({ limit: 50 });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <SectionHeader
          level={1}
          title="הזמנות"
          subtitle="בנו והגישו הזמנות לספקים מתוך הקטלוג — וההזמנה תוצלב אוטומטית מול החשבונית שתתקבל."
        />
        <Link href="/dashboard/orders/new">
          <Button variant="primary" size="sm">
            <Plus className="h-4 w-4" /> הזמנה חדשה
          </Button>
        </Link>
      </div>
      <OrdersList initial={initial} />
    </div>
  );
}
