import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { Breadcrumbs, SectionHeader, displayName } from '@/lib/components';
import { getLocale, getT } from '@/lib/i18n/server';
import { components } from '@/lib/i18n/messages/components';
import { orders as ordersNs } from '@/lib/i18n/messages/orders';
import { OrderDetail } from './detail-client';

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

  const [memberships, session] = await Promise.all([caller.onboarding.myMemberships(), auth()]);
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
      <SectionHeader
        level={1}
        title={title}
        subtitle={data.po?.status === 'draft' ? t('detail.subtitle') : undefined}
      />
      <OrderDetail data={data} canEdit={canEdit} />
    </div>
  );
}
