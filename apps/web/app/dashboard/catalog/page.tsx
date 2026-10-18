import { Languages, Link2, Upload } from 'lucide-react';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { LinkButton, SectionHeader } from '@/lib/components';
import { getT } from '@/lib/i18n/server';
import { catalog as catalogNs } from '@/lib/i18n/messages/catalog';
import { CatalogBrowser } from './browser';

export default async function CatalogPage() {
  const caller = await createServerCaller();
  const [suppliers, initial, memberships, session, t] = await Promise.all([
    caller.suppliers.list({}),
    caller.catalog.items({ limit: 50 }),
    caller.onboarding.myMemberships(),
    auth(),
    getT(catalogNs),
  ]);

  // catalog mutations are managerProcedure (owner/manager) — gate the inline
  // add/edit/delete controls on the caller's role on the active restaurant.
  const active =
    memberships.find((m) => m.restaurantId === session?.user?.restaurantId) ?? memberships[0];
  const canEdit = active?.role === 'owner' || active?.role === 'manager';

  return (
    <div>
      <SectionHeader
        level={1}
        title={t('title')}
        subtitle={t('subtitle')}
        className="flex-wrap"
        action={
          canEdit ? (
            <div className="flex flex-wrap gap-2">
              <LinkButton href="/dashboard/products" size="sm" variant="secondary">
                <Languages className="h-4 w-4" aria-hidden="true" /> {t('namesButton')}
              </LinkButton>
              <LinkButton href="/dashboard/catalog/mapping" size="sm" variant="secondary">
                <Link2 className="h-4 w-4" aria-hidden="true" /> {t('mappingButton')}
              </LinkButton>
              <LinkButton href="/dashboard/catalog/import" size="sm">
                <Upload className="h-4 w-4" aria-hidden="true" /> {t('importButton')}
              </LinkButton>
            </div>
          ) : undefined
        }
      />
      <CatalogBrowser suppliers={suppliers} initial={initial} canEdit={canEdit} />
    </div>
  );
}
