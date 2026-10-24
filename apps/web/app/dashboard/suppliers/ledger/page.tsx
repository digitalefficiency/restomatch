import { notFound } from 'next/navigation';
import { BookOpen } from 'lucide-react';
import { TRPCError } from '@trpc/server';
import { createServerCaller } from '@/lib/trpc/server';
import { Breadcrumbs, Card, EmptyState, SectionHeader } from '@/lib/components';
import { getT } from '@/lib/i18n/server';
import { components } from '@/lib/i18n/messages/components';
import { suppliers as suppliersNs } from '@/lib/i18n/messages/suppliers';
import { LedgerGridTable } from '../ledger-ui';

export const dynamic = 'force-dynamic';

/**
 * All-suppliers ledger grid (flag `supplierLedger`): supplier × month cells
 * with billed ₪, leak and status, plus the bookkeeper's CSV. Invoice readers
 * only (lib/roles.ts); with the flag off the page doesn't exist.
 */
export default async function SupplierLedgerGridPage() {
  const caller = await createServerCaller();
  const [t, tc] = await Promise.all([getT(suppliersNs), getT(components)]);
  let data;
  try {
    data = await caller.suppliers.ledgerGrid({ months: 6 });
  } catch (err) {
    if (err instanceof TRPCError && err.code === 'FORBIDDEN') notFound();
    throw err;
  }
  return (
    <div className="space-y-4">
      <Breadcrumbs
        label={tc('breadcrumbs.label')}
        items={[{ label: t('detail.breadcrumb'), href: '/dashboard/suppliers' }, { label: t('ledger.gridTitle') }]}
      />
      <SectionHeader level={1} title={t('ledger.gridTitle')} subtitle={t('ledger.gridSubtitle')} />
      {data.suppliers.length === 0 ? (
        <Card elevated>
          <EmptyState icon={<BookOpen className="h-6 w-6" />} title={t('ledger.emptyTitle')} description={t('ledger.emptyBody')} />
        </Card>
      ) : (
        <LedgerGridTable data={data} />
      )}
      <p className="text-xs text-subtle">{t('ledger.note')}</p>
    </div>
  );
}
