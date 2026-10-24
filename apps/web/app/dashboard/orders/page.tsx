import { Plus } from 'lucide-react';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { LinkButton, SectionHeader } from '@/lib/components';
import { getT } from '@/lib/i18n/server';
import { orders as ordersNs } from '@/lib/i18n/messages/orders';
import { OrdersList } from './list-client';
import { ZesttImportButton } from './import-client';

export default async function OrdersPage() {
  const caller = await createServerCaller();
  const [initial, memberships, session, t] = await Promise.all([
    caller.orders.list({ limit: 50 }),
    caller.onboarding.myMemberships(),
    auth(),
    getT(ordersNs),
  ]);
  const active =
    memberships.find((m) => m.restaurantId === session?.user?.restaurantId) ?? memberships[0];
  const canEdit = active?.role === 'owner' || active?.role === 'manager';
  // Same credential gate as orders.importPo — without it the button could only
  // answer with a "not configured" error, so don't offer it.
  const ocrReady = Boolean(process.env.ANTHROPIC_API_KEY);

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
              {ocrReady ? <ZesttImportButton /> : null}
              <LinkButton href="/dashboard/orders/new" size="sm">
                <Plus className="h-4 w-4" aria-hidden="true" /> {t('newOrder')}
              </LinkButton>
            </div>
          ) : undefined
        }
      />
      <OrdersList initial={initial} canEdit={canEdit} />
    </div>
  );
}
