import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { Breadcrumbs, SectionHeader } from '@/lib/components';
import { getT } from '@/lib/i18n/server';
import { catalog as catalogNs } from '@/lib/i18n/messages/catalog';
import { components } from '@/lib/i18n/messages/components';
import { SkuMapper } from './mapper';

/**
 * Catalog mapping queue — supplier SKUs (מק״ט) that arrived on an imported order
 * or an OCR'd invoice but aren't yet linked to a product. Linking one teaches
 * the system, backfills the already-imported lines, and makes every future
 * order/invoice from that supplier resolve automatically.
 */
export default async function CatalogMappingPage() {
  const caller = await createServerCaller();
  const [initial, t, tc, session, memberships] = await Promise.all([
    caller.mapping.unmapped(),
    getT(catalogNs),
    getT(components),
    auth(),
    caller.onboarding.myMemberships(),
  ]);
  // G-08: the chef sees only the "זה אותו מוצר?" questions (the server already
  // returns only those to a chef); no search, no new product, no SKU rows.
  const role = (memberships.find((m) => m.restaurantId === session?.user?.restaurantId) ?? memberships[0])?.role;
  const chef = role === 'chef';

  return (
    <div>
      <Breadcrumbs
        label={tc('breadcrumbs.label')}
        items={
          chef
            ? [{ label: t('mapping.chefTitle') }]
            : [{ label: t('mapping.breadcrumb'), href: '/dashboard/catalog' }, { label: t('mapping.title') }]
        }
      />
      <SectionHeader
        level={1}
        title={chef ? t('mapping.chefTitle') : t('mapping.title')}
        subtitle={chef ? t('mapping.chefSubtitle') : t('mapping.subtitle')}
      />
      <SkuMapper initial={initial} chef={chef} />
    </div>
  );
}
