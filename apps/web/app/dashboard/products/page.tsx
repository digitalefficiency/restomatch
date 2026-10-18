import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { Breadcrumbs, SectionHeader } from '@/lib/components';
import { getT } from '@/lib/i18n/server';
import { components } from '@/lib/i18n/messages/components';
import { products as productsNs } from '@/lib/i18n/messages/products';
import { NamesGrid } from './names-grid';

/**
 * Bulk "English names" grid — fill `products.name_en` for many products at
 * once so English-speaking staff ("Receiver in English") see real names.
 */
export default async function ProductNamesPage() {
  const caller = await createServerCaller();
  const [initial, memberships, session, t, tc] = await Promise.all([
    caller.products.list({ limit: 100 }),
    caller.onboarding.myMemberships(),
    auth(),
    getT(productsNs),
    getT(components),
  ]);
  const active =
    memberships.find((m) => m.restaurantId === session?.user?.restaurantId) ?? memberships[0];
  const canEdit = active?.role === 'owner' || active?.role === 'manager';

  return (
    <div>
      <Breadcrumbs
        label={tc('breadcrumbs.label')}
        items={[{ label: t('names.breadcrumb'), href: '/dashboard/catalog' }, { label: t('names.title') }]}
      />
      <SectionHeader level={1} title={t('names.title')} subtitle={t('names.subtitle')} />
      <NamesGrid initial={initial} canEdit={canEdit} />
    </div>
  );
}
