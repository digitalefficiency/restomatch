import { Plus } from 'lucide-react';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { LinkButton, SectionHeader } from '@/lib/components';
import { getT } from '@/lib/i18n/server';
import { orders as ordersNs } from '@/lib/i18n/messages/orders';
import { OrdersList } from './list-client';
import { ZesttImportButton } from './import-client';
import { MessageCircle } from 'lucide-react';
import { enabledFeatures } from '@/lib/ingest/features';
import { ingest } from '@/lib/i18n/messages/ingest';

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
  // orderCapture (flag): paste / share the WhatsApp order the owner already sent.
  const showCapture = canEdit && (await enabledFeatures(active?.restaurantId)).includes('orderCapture');
  const tIngest = await getT(ingest);
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
              {showCapture ? (
                <LinkButton href="/dashboard/orders/capture" size="sm" variant="secondary" data-testid="order-capture-entry">
                  <MessageCircle className="h-4 w-4" aria-hidden="true" /> {tIngest('orderCapture.entry')}
                </LinkButton>
              ) : null}
              {ocrReady ? <ZesttImportButton /> : null}
              <LinkButton href="/dashboard/orders/new" size="sm">
                <Plus className="h-4 w-4" aria-hidden="true" /> {t('newOrder')}
              </LinkButton>
            </div>
          ) : undefined
        }
      />
      {/* The "prices on supplier orders" setting lives with its preview on each order (orders-25). */}
      <OrdersList initial={initial} canEdit={canEdit} />
    </div>
  );
}
