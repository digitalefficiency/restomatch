import { Suspense } from 'react';
import { ReceiptText } from 'lucide-react';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { LinkButton, SectionHeader, Skeleton } from '@/lib/components';
import { ViewToolbar, hasFilters, localDay, parseView } from '@/lib/components/views';
import { getLocale, getT } from '@/lib/i18n/server';
import { approvals } from '@/lib/i18n/messages/approvals';
import { overview } from '@/lib/i18n/messages/overview';
import { views as viewsNs } from '@/lib/i18n/messages/views';
import { payRun as payRunNs } from '@/lib/i18n/messages/payRun';
import { ApprovalsList, FiltersDisclosure, type QueueFilters } from './list';
import { discrepancyLabel, displayName, severityLabel } from './vocab';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * No route-level loading.tsx here: it sits above the page AND the pay run, and on
 * a same-route navigation (filters, density, the pay run's month) it replaced the
 * whole page and could leave the transition suspended (W1-04 soft-nav gate). An
 * un-keyed Suspense inside the page streams the layout-true skeleton on the first
 * load only; later search-param navigations keep the current queue on screen
 * until the new one is ready (approvals-19).
 */
// Cast wrapper: two @types/react majors are hoisted in the workspace (STATE.md).
const SuspenseBoundary = Suspense as unknown as React.ComponentType<{
  fallback: React.ReactNode;
  children?: React.ReactNode;
}>;

export default function ApprovalsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <SuspenseBoundary fallback={<ApprovalsSkeleton />}>
      <ApprovalsContent searchParams={searchParams} />
    </SuspenseBoundary>
  );
}

async function ApprovalsContent({ searchParams }: { searchParams: SearchParams }) {
  // View controls: type / severity / supplier filters + density, all in the URL.
  const view = parseView(await searchParams);
  const filters: QueueFilters = {
    ...(view.filters.types.length ? { types: view.filters.types } : {}),
    ...(view.filters.severities.length ? { severities: view.filters.severities } : {}),
    ...(view.filters.supplierIds.length ? { supplierIds: view.filters.supplierIds } : {}),
  };
  const filtered = hasFilters(view);
  const activeFilters =
    view.filters.types.length + view.filters.severities.length + view.filters.supplierIds.length;
  const caller = await createServerCaller();
  const [t, tv, tp, locale] = await Promise.all([
    getT(approvals),
    getT(viewsNs),
    getT(payRunNs),
    getLocale(),
  ]);
  const [queue, summary, options, session, memberships] = await Promise.all([
    caller.approvals.myQueue({ limit: 50, ...filters }),
    // Server totals: the tiles never sum only the loaded page (approvals-08).
    caller.approvals.queueSummary(filters),
    caller.owner.viewOptions(),
    auth(),
    caller.onboarding.myMemberships(),
  ]);
  // The active membership's role (same lookup as the overview).
  const viewerRole =
    (memberships.find((m) => m.restaurantId === session?.user?.restaurantId) ?? memberships[0])
      ?.role ?? null;
  // Pay run (flag payRun): finance roles get a link to this month's pay run.
  const showPayRun =
    viewerRole === 'owner' || viewerRole === 'manager' || viewerRole === 'bookkeeper'
      ? await caller.payRun.enabled().catch(() => false)
      : false;
  // An empty, unfiltered queue shows its inbox-zero state without a toolbar over nothing (approvals-15).
  const showToolbar = queue.length > 0 || filtered;

  return (
    <div>
      <SectionHeader
        level={1}
        title={t('title')}
        action={
          showPayRun ? (
            <LinkButton
              href="/dashboard/approvals/pay-run"
              variant="secondary"
              size="sm"
              className="touch-target"
              data-testid="approvals-payrun-link"
            >
              <ReceiptText className="h-4 w-4" aria-hidden="true" />
              {tp('open')}
            </LinkButton>
          ) : undefined
        }
      />

      {showToolbar ? (
        <FiltersDisclosure active={activeFilters}>
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
                product:
                  displayName(locale, d.productName, d.productNameEn) ||
                  displayName(locale, d.lineDescription, d.lineDescriptionEn),
                supplier: displayName(locale, d.supplierName, d.supplierNameEn),
                invoice: d.invoiceNumber ?? '',
                amount: Number(d.deltaAmount ?? 0),
                date: localDay(d.createdAt),
              })),
            }}
          />
        </FiltersDisclosure>
      ) : null}

      <ApprovalsList
        // Remount when the filters change so the client list re-seeds from the server page.
        key={JSON.stringify(filters)}
        initial={queue}
        initialSummary={summary}
        filters={filters}
        filtered={filtered}
        filteredNote={tv('filteredNote')}
        density={view.density}
        viewerRole={viewerRole}
      />
    </div>
  );
}

/**
 * Layout-true skeleton (approvals-19), the Suspense fallback of page.tsx: the same header, the phone summary line /
 * desktop 4 tiles, and decision cards at the real card height with the 50/50
 * 48 px button row — so nothing jumps when the queue paints.
 */
async function ApprovalsSkeleton() {
  const t = await getT(overview);
  return (
    <div role="status" aria-label={t('loading')} data-testid="approvals-loading">
      <div className="mb-6 space-y-2">
        <div className="h-0.5 w-10 rounded-full flow-stream" />
        <Skeleton className="h-8 w-44" />
      </div>
      <Skeleton className="mb-3 h-12 w-40 rounded-full sm:hidden" />
      <Skeleton className="mb-4 h-5 w-64 sm:hidden" />
      <div className="mb-5 hidden gap-3 sm:grid sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[88px]" />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-line bg-surface p-4 ps-5">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-2">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-4 w-56" />
              </div>
              <Skeleton className="h-12 w-12 sm:h-10 sm:w-10" />
            </div>
            <Skeleton className="mt-3 h-7 w-40" />
            <Skeleton className="mt-2 h-10 w-full sm:h-6" />
            <div className="mt-3 grid grid-cols-2 gap-2 sm:flex">
              <Skeleton className="h-12 sm:w-44" />
              <Skeleton className="h-12 sm:w-44" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
