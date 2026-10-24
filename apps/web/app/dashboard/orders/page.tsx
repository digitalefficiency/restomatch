import { Plus } from 'lucide-react';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { LinkButton, SectionHeader } from '@/lib/components';
import { getT } from '@/lib/i18n/server';
import { orders as ordersNs } from '@/lib/i18n/messages/orders';
import { OrdersList } from './list-client';
import { ZesttImportButton } from './import-client';
import { DocumentPricesToggle } from './supplier-document';

export default async function OrdersPage() {
  const caller = await createServerCaller();
  const [initial, memberships, session, t, docSettings] = await Promise.all([
    caller.orders.list({ limit: 50 }),
    caller.onboarding.myMemberships(),
    auth(),
    getT(ordersNs),
    caller.orders.documentSettings(),
  ]);
  const active =
    memberships.find((m) => m.restaurantId === session?.user?.restaurantId) ?? memberships[0];
  const canEdit = active?.role === 'owner' || active?.role === 'manager';

  return (
    <div>
      <SectionHeader
        level={1}
        title={t('title')}
        subtitle={t('subtitle')}
        className="flex-wrap"
        action={
          canEdit ? (
            <div className="flex flex-wrap items-start gap-2">
              <ZesttImportButton />
              <LinkButton href="/dashboard/orders/new" size="sm">
                <Plus className="h-4 w-4" aria-hidden="true" /> {t('newOrder')}
              </LinkButton>
            </div>
          ) : undefined
        }
      />
      {canEdit && docSettings.enabled ? <DocumentPricesToggle initialShowPrices={docSettings.showPrices} /> : null}
      <OrdersList initial={initial} canEdit={canEdit} />
    </div>
  );
}
