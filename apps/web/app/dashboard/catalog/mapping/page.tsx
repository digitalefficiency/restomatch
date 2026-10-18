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
  const [initial, t, tc] = await Promise.all([caller.mapping.unmapped(), getT(catalogNs), getT(components)]);

  return (
    <div>
      <Breadcrumbs
        label={tc('breadcrumbs.label')}
        items={[{ label: t('mapping.breadcrumb'), href: '/dashboard/catalog' }, { label: t('mapping.title') }]}
      />
      <SectionHeader level={1} title={t('mapping.title')} subtitle={t('mapping.subtitle')} />
      <SkuMapper initial={initial} />
    </div>
  );
}
