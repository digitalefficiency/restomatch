import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { Breadcrumbs, SectionHeader, displayName, trpcErrorCode } from '@/lib/components';
import { getLocale, getT } from '@/lib/i18n/server';
import { components } from '@/lib/i18n/messages/components';
import { orders as ordersNs } from '@/lib/i18n/messages/orders';
import { OrderDetail } from './detail-client';
import { SupplierDocumentPreview } from '../supplier-document';
import { SupplierConfirmCard } from './supplier-confirm-card';
import { ltrIsolate, poRefOf } from '../order-logic';

export default async function OrderDetailPage({ params }: { params: Promise<{ poId: string }> }) {
  const { poId } = await params;
  const caller = await createServerCaller();
  const [t, tc, locale] = await Promise.all([getT(ordersNs), getT(components), getLocale()]);

  let data: Awaited<ReturnType<typeof caller.orders.get>>;
  try {
    data = await caller.orders.get({ poId });
  } catch (err) {
    // Only a missing (or malformed) id is "not found"; an outage is an error with
    // retry (error.tsx), never "this order does not exist".
    const code = trpcErrorCode(err);
    if (code === 'NOT_FOUND' || code === 'BAD_REQUEST') notFound();
    throw err;
  }
  if (!data.po) notFound();

  const [memberships, session, docSettings] = await Promise.all([
    caller.onboarding.myMemberships(),
    auth(),
    caller.orders.documentSettings(),
  ]);
  const active =
    memberships.find((m) => m.restaurantId === session?.user?.restaurantId) ?? memberships[0];
  // Owner decision 31.10 (pilot): the chef creates, edits, sends and cancels orders.
  const canManage = active?.role === 'owner' || active?.role === 'manager';
  const canEdit = canManage || active?.role === 'chef';
  const supplier = data.supplierName
    ? displayName(data.supplierName, data.supplierNameEn, locale).primary
    : null;
  const title = supplier ? t('detail.title', { supplier }) : t('detail.titleNoSupplier');
  const ref = poRefOf(data.po.id);

  return (
    <div>
      <Breadcrumbs
        label={tc('breadcrumbs.label')}
        items={[
          { label: t('detail.breadcrumb'), href: '/dashboard/orders' },
          // Isolated: in RTL a bare "#F8E05686" renders as "F8E05686#".
          { label: ltrIsolate(`#${ref}`) },
        ]}
      />
      <SectionHeader
        level={1}
        title={title}
        subtitle={data.po?.status === 'draft' ? t('detail.subtitle') : undefined}
      />
      <OrderDetail
        data={data}
        canEdit={canEdit}
        pricedDocument={docSettings.enabled}
        restaurantName={active?.restaurantName ?? ''}
      />
      {canEdit && docSettings.enabled && data.lines.length > 0 ? (
        <div className="mt-6">
          {/* Keyed on the order's content so an edited line re-fetches the preview. */}
          <SupplierDocumentPreview
            key={[
              data.po.status,
              ...data.lines.map((l) => `${l.id}:${l.qtyOrdered}:${l.unit}:${l.unitPriceExpected}:${l.rawDescription}`),
            ].join('|')}
            poId={data.po.id}
            settings={canManage ? { showPrices: docSettings.showPrices } : null}
          />
        </div>
      ) : null}
      {/* Wave-1 `supplierConfirm`: renders nothing when the flag is off. */}
      <SupplierConfirmCard
        poId={data.po.id}
        status={data.po.status}
        canEdit={canManage}
        restaurantName={active?.restaurantName ?? ''}
      />
    </div>
  );
}
