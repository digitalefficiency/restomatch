import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { Breadcrumbs, SectionHeader, displayName } from '@/lib/components';
import { getLocale, getT } from '@/lib/i18n/server';
import { components } from '@/lib/i18n/messages/components';
import { products as productsNs } from '@/lib/i18n/messages/products';
import { ProductEditor } from './product-client';

export default async function ProductPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const caller = await createServerCaller();

  let detail: Awaited<ReturnType<typeof caller.catalog.productDetail>>;
  try {
    detail = await caller.catalog.productDetail({ productId });
  } catch {
    notFound(); // malformed id → BAD_REQUEST; treat like a missing product
  }
  const [suppliers, memberships, session, t, tc, locale] = await Promise.all([
    caller.suppliers.list({ includeInactive: true }),
    caller.onboarding.myMemberships(),
    auth(),
    getT(productsNs),
    getT(components),
    getLocale(),
  ]);
  if (!detail) notFound();

  const active =
    memberships.find((m) => m.restaurantId === session?.user?.restaurantId) ?? memberships[0];
  const canEdit = active?.role === 'owner' || active?.role === 'manager';
  const name = displayName(detail.product.canonicalName, detail.product.nameEn, locale);

  return (
    <div>
      <Breadcrumbs
        label={tc('breadcrumbs.label')}
        items={[{ label: t('breadcrumb'), href: '/dashboard/catalog' }, { label: name.primary }]}
      />
      <SectionHeader
        level={1}
        title={name.primary}
        subtitle={
          <>
            {name.secondary ? (
              <span className="mb-1 block text-base text-subtle" lang="he" dir="rtl">
                {name.secondary}
              </span>
            ) : null}
            {t('subtitle')}
          </>
        }
      />
      <ProductEditor detail={detail} suppliers={suppliers} canEdit={canEdit} />
    </div>
  );
}
