import { Suspense } from 'react';
import { Plus } from 'lucide-react';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { LinkButton, SectionHeader, Skeleton } from '@/lib/components';
import { getT } from '@/lib/i18n/server';
import { orders as ordersNs } from '@/lib/i18n/messages/orders';
import { OrdersList } from './list-client';
import { ZesttImportButton } from './import-client';
import { MessageCircle } from 'lucide-react';
import { enabledFeatures } from '@/lib/ingest/features';
import { ingest } from '@/lib/i18n/messages/ingest';

/**
 * No route-level loading.tsx under orders/: it would also wrap orders/[poId] and
 * orders/capture, and a streamed boundary above their notFound() sends an unknown
 * order as HTTP 200, not 404 (W1-04). The list's skeleton is the fallback of an
 * un-keyed Suspense inside this page instead (as approvals, 57f4aea9).
 */
// Cast wrapper: two @types/react majors are hoisted in the workspace (STATE.md).
const SuspenseBoundary = Suspense as unknown as React.ComponentType<{
  fallback: React.ReactNode;
  children?: React.ReactNode;
}>;

export default function OrdersPage() {
  return (
    <SuspenseBoundary fallback={<OrdersSkeleton />}>
      <OrdersContent />
    </SuspenseBoundary>
  );
}

async function OrdersContent() {
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
      <OrdersList initial={initial} canEdit={canEdit} showMoney={active?.role !== 'receiver'} />
    </div>
  );
}

/** Layout-true list skeleton: header, search, filter chips, rows. */
async function OrdersSkeleton() {
  const t = await getT(ordersNs);
  return (
    <div role="status" aria-label={t('list.loading')}>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-10 w-36" />
      </div>
      <Skeleton className="mb-4 h-12 w-full max-w-md" />
      <div className="mb-4 flex gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-16" />
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-14" />
        ))}
      </div>
    </div>
  );
}
