import { Boxes, Upload } from 'lucide-react';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { Card, EmptyState, LinkButton } from '@/lib/components';
import { getT } from '@/lib/i18n/server';
import { suppliers as suppliersNs } from '@/lib/i18n/messages/suppliers';
import { CatalogBrowser } from '../../catalog/browser';

/**
 * Catalog tab — the supplier's price list, scoped via CatalogBrowser's
 * lockedSupplierId (filter dropdown hidden, items locked to this supplier).
 * Owners/managers get the same inline add/edit controls as the catalog page.
 * Empty → a clear "import price list" CTA (pre-selects this supplier).
 */
export async function SupplierCatalogTab({ supplierId }: { supplierId: string }) {
  const caller = await createServerCaller();
  const [suppliers, initial, memberships, session, t] = await Promise.all([
    caller.suppliers.list({}),
    caller.catalog.items({ supplierId, limit: 50 }),
    caller.onboarding.myMemberships(),
    auth(),
    getT(suppliersNs),
  ]);
  const active =
    memberships.find((m) => m.restaurantId === session?.user?.restaurantId) ?? memberships[0];
  const canEdit = active?.role === 'owner' || active?.role === 'manager';

  const importHref = `/dashboard/catalog/import?supplierId=${supplierId}`;

  if (initial.length === 0) {
    return (
      <Card elevated>
        <EmptyState
          icon={<Boxes className="h-6 w-6" />}
          title={t('catalogTab.emptyTitle')}
          description={t('catalogTab.emptyBody')}
          action={
            <LinkButton href={importHref} size="sm">
              <Upload className="h-4 w-4" aria-hidden="true" /> {t('catalogTab.import')}
            </LinkButton>
          }
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <LinkButton href={importHref} size="sm" variant="secondary">
          <Upload className="h-4 w-4" aria-hidden="true" /> {t('catalogTab.import')}
        </LinkButton>
      </div>
      <CatalogBrowser suppliers={suppliers} initial={initial} lockedSupplierId={supplierId} canEdit={canEdit} />
    </div>
  );
}
