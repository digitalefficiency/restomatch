import { CheckCircle2, ReceiptText } from 'lucide-react';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { EmptyState, LinkButton, SectionHeader } from '@/lib/components';
import { ViewToolbar, hasFilters, localDay, parseView } from '@/lib/components/views';
import { getLocale, getT } from '@/lib/i18n/server';
import { approvals } from '@/lib/i18n/messages/approvals';
import { views as viewsNs } from '@/lib/i18n/messages/views';
import { payRun as payRunNs } from '@/lib/i18n/messages/payRun';
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
  const [t, tv, tp, locale] = await Promise.all([getT(approvals), getT(viewsNs), getT(payRunNs), getLocale()]);
  const [queue, options, session, memberships] = await Promise.all([
    caller.approvals.myQueue({ limit: 50, ...filters }),
    caller.owner.viewOptions(),
    auth(),
    caller.onboarding.myMemberships(),
  ]);
  // The active membership's role (same lookup as the overview).
  const viewerRole =
    (memberships.find((m) => m.restaurantId === session?.user?.restaurantId) ?? memberships[0])?.role ?? null;
  // Pay run (flag payRun): finance roles get a link to this month's pay run.
  const showPayRun =
    viewerRole === 'owner' || viewerRole === 'manager' || viewerRole === 'bookkeeper'
      ? await caller.payRun.enabled().catch(() => false)
      : false;

  return (
    <div>
      <SectionHeader
        level={1}
        title={t('title')}
        subtitle={t('subtitle')}
        action={
          showPayRun ? (
            <LinkButton href="/dashboard/approvals/pay-run" variant="secondary" size="sm" className="min-h-11 sm:min-h-0" data-testid="approvals-payrun-link">
              <ReceiptText className="h-4 w-4" aria-hidden="true" />
              {tp('open')}
            </LinkButton>
          ) : undefined
        }
      />

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
            date: localDay(d.createdAt),
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
          viewerRole={viewerRole}
        />
      )}
    </div>
  );
}
