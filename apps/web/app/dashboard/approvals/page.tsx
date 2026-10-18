import { CheckCircle2 } from 'lucide-react';
import { createServerCaller } from '@/lib/trpc/server';
import { EmptyState, SectionHeader } from '@/lib/components';
import { ViewToolbar, hasFilters, parseView } from '@/lib/components/views';
import { getLocale, getT } from '@/lib/i18n/server';
import { approvals } from '@/lib/i18n/messages/approvals';
import { views as viewsNs } from '@/lib/i18n/messages/views';
import { ApprovalsList, type QueueFilters } from './list';
import { discrepancyLabel, displayName, severityLabel } from './vocab';

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // View controls: type / severity / supplier filters + density, all in the URL.
  const view = parseView(await searchParams);
  const filters: QueueFilters = {
    ...(view.filters.types.length ? { types: view.filters.types } : {}),
    ...(view.filters.severities.length ? { severities: view.filters.severities } : {}),
    ...(view.filters.supplierIds.length ? { supplierIds: view.filters.supplierIds } : {}),
  };
  const caller = await createServerCaller();
  const [t, tv, locale] = await Promise.all([getT(approvals), getT(viewsNs), getLocale()]);
  const [queue, options] = await Promise.all([
    caller.approvals.myQueue({ limit: 50, ...filters }),
    caller.owner.viewOptions(),
  ]);

  return (
    <div>
      <SectionHeader level={1} title={t('title')} subtitle={t('subtitle')} />

      <ViewToolbar
        page="approvals"
        view={view}
        density
        saved
        filters={['type', 'severity', 'supplier']}
        options={options}
        exportData={{
          columns: [
            { key: 'type', label: tv('csv.type') },
            { key: 'severity', label: tv('csv.severity') },
            { key: 'product', label: tv('csv.product') },
            { key: 'supplier', label: tv('csv.supplier') },
            { key: 'invoice', label: tv('csv.invoice') },
            { key: 'amount', label: tv('csv.leak') },
            { key: 'date', label: tv('csv.date') },
          ],
          rows: queue.map((d) => ({
            type: discrepancyLabel(t, d.type),
            severity: severityLabel(t, d.severity),
            product: displayName(locale, d.productName, d.productNameEn),
            supplier: displayName(locale, d.supplierName, d.supplierNameEn),
            invoice: d.invoiceNumber ?? '',
            amount: Number(d.deltaAmount ?? 0),
            date: new Date(d.createdAt).toISOString().slice(0, 10),
          })),
        }}
      />

      {queue.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="h-6 w-6" />}
          title={t('empty.title')}
          description={hasFilters(view) ? tv('filteredNote') : t('empty.description')}
        />
      ) : (
        <ApprovalsList
          // Remount when the filters change so the client list re-seeds from the server page.
          key={JSON.stringify(filters)}
          initial={queue}
          filters={filters}
          density={view.density}
        />
      )}
    </div>
  );
}
