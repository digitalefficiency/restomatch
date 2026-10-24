import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { Breadcrumbs, SectionHeader, displayName } from '@/lib/components';
import { getLocale, getT } from '@/lib/i18n/server';
import { components } from '@/lib/i18n/messages/components';
import { orders as ordersNs } from '@/lib/i18n/messages/orders';
import { OrderDetail } from './detail-client';
import { SupplierDocumentPreview } from '../supplier-document';

export default async function OrderDetailPage({ params }: { params: Promise<{ poId: string }> }) {
  const { poId } = await params;
  const caller = await createServerCaller();
  const [t, tc, locale] = await Promise.all([getT(ordersNs), getT(components), getLocale()]);

  let data: Awaited<ReturnType<typeof caller.orders.get>>;
  try {
    data = await caller.orders.get({ poId });
  } catch {
    notFound();
  }
  if (!data.po) notFound();

  const [memberships, session, docSettings] = await Promise.all([
    caller.onboarding.myMemberships(),
    auth(),
    caller.orders.documentSettings(),
  ]);
  const active =
    memberships.find((m) => m.restaurantId === session?.user?.restaurantId) ?? memberships[0];
  const canEdit = active?.role === 'owner' || active?.role === 'manager';
  const supplier = data.supplierName
    ? displayName(data.supplierName, data.supplierNameEn, locale).primary
    : null;
  const title = supplier ? t('detail.title', { supplier }) : t('detail.titleNoSupplier');

  return (
    <div>
      <Breadcrumbs
        label={tc('breadcrumbs.label')}
        items={[
          { label: t('detail.breadcrumb'), href: '/dashboard/orders' },
          ...(supplier ? [{ label: supplier, href: `/dashboard/suppliers/${data.po.supplierId}?tab=orders` }] : []),
          { label: t('detail.titleNoSupplier') },
        ]}
      />
      <SectionHeader level={1} title={title} subtitle={t('detail.subtitle')} />
      <OrderDetail data={data} canEdit={canEdit} />
      {canEdit && docSettings.enabled && data.lines.length > 0 ? (
        <div className="mt-6">
          {/* Keyed on the order's content so an edited line re-fetches the preview. */}
          <SupplierDocumentPreview
            key={[
              data.po.status,
              ...data.lines.map((l) => `${l.id}:${l.qtyOrdered}:${l.unit}:${l.unitPriceExpected}:${l.rawDescription}`),
            ].join('|')}
            poId={data.po.id}
          />
        </div>
      ) : null}
    </div>
  );
}
