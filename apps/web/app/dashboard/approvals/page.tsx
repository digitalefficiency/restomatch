import { Suspense } from 'react';
import { ReceiptText } from 'lucide-react';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { LinkButton, SectionHeader } from '@/lib/components';
import { ViewToolbar, hasFilters, localDay, parseView } from '@/lib/components/views';
import { viewDefaults } from '@/lib/components/views/defaults';
import { getLocale, getT } from '@/lib/i18n/server';
import { approvals } from '@/lib/i18n/messages/approvals';
import { views as viewsNs } from '@/lib/i18n/messages/views';
import { payRun as payRunNs } from '@/lib/i18n/messages/payRun';
import { ApprovalsList, FiltersDisclosure, type QueueFilters } from './list';
import { ApprovalsSkeleton } from './skeleton';
import { BranchStrip } from '../chain/branch-strip';
import { discrepancyLabel, displayName, severityLabel } from './vocab';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  // View controls: type / severity / supplier filters + density, all in the URL. The filters (and so the queries and
  // the list's key) come from the address alone; the density's default is the device preference, read once the
  // role is known (below).
  const sp = await searchParams;
  const filterView = parseView(sp);
  // The notification deep link (`/dashboard/go?…&to=/dashboard/approvals?invoice=<id>`):
  // the queue narrows to that invoice. A foreign or malformed id matches nothing.
  const invoiceParam = typeof sp.invoice === 'string' && UUID.test(sp.invoice) ? sp.invoice : null;
  const filters: QueueFilters = {
    ...(invoiceParam ? { invoiceIds: [invoiceParam] } : {}),
    ...(filterView.filters.types.length ? { types: filterView.filters.types } : {}),
    ...(filterView.filters.severities.length ? { severities: filterView.filters.severities } : {}),
    ...(filterView.filters.supplierIds.length ? { supplierIds: filterView.filters.supplierIds } : {}),
  };
  const filtered = hasFilters(filterView) || invoiceParam != null;
  const activeFilters =
    filterView.filters.types.length + filterView.filters.severities.length + filterView.filters.supplierIds.length;
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
  // The view with the device preference as the density default (the stored choice, else the role's — the bookkeeper
  // starts compact — and the regular size on a phone or tablet); an explicit `d` in the address still wins.
  const view = parseView(sp, await viewDefaults(viewerRole));
  // Pay run (flag payRun): finance roles get a link to this month's pay run.
  const showPayRun =
    viewerRole === 'owner' || viewerRole === 'manager' || viewerRole === 'bookkeeper'
      ? await caller.payRun.enabled().catch(() => false)
      : false;
  // An empty, unfiltered queue shows its inbox-zero state without a toolbar over nothing (approvals-15).
  const showToolbar = queue.length > 0 || filtered;

  return (
    // ≥1280: the desk fills the window below the shell's header (both panes scroll inside it, spec §4.1).
    <div className="xl:flex xl:h-[calc(100dvh-var(--rm-header-h,var(--chrome-header-h))-var(--rm-shell-pad-y,6rem)-var(--consent-h,0px))] xl:min-h-[36rem] xl:flex-col">
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

      {/* W3-01: the per-branch strip (chain owners / bookkeepers with 2+ branches only). */}
      <BranchStrip kind="approvals" then="/dashboard/approvals" />

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
        // #418: the server's clock for this render — the deadline days hydrate unchanged.
        nowMs={Date.now()}
      />
    </div>
  );
}
