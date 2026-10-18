import { Plus, ShoppingCart } from 'lucide-react';
import { createServerCaller } from '@/lib/trpc/server';
import { Card, EmptyState, LinkButton } from '@/lib/components';
import { getT } from '@/lib/i18n/server';
import { suppliers as suppliersNs } from '@/lib/i18n/messages/suppliers';
import { OrdersTable } from '../../orders/orders-table';

/**
 * Orders tab — this supplier's purchase orders (orders.list filtered by
 * supplierId): date + status + estimated total. Empty → first-order CTA.
 */
export async function SupplierOrdersTab({ supplierId }: { supplierId: string }) {
  const caller = await createServerCaller();
  const [orders, t] = await Promise.all([
    caller.orders.list({ supplierId, limit: 50 }),
    getT(suppliersNs),
  ]);

  const newOrderHref = `/dashboard/orders/new?supplierId=${supplierId}`;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <LinkButton href={newOrderHref} size="sm">
          <Plus className="h-4 w-4" aria-hidden="true" /> {t('ordersTab.newOrder')}
        </LinkButton>
      </div>

      {orders.length === 0 ? (
        <Card elevated>
          <EmptyState
            icon={<ShoppingCart className="h-6 w-6" />}
            title={t('ordersTab.emptyTitle')}
            description={t('ordersTab.emptyBody')}
            action={
              <LinkButton href={newOrderHref} size="sm">
                {t('ordersTab.firstOrder')}
              </LinkButton>
            }
          />
        </Card>
      ) : (
        <OrdersTable orders={orders} hideSupplier />
      )}
    </div>
  );
}
