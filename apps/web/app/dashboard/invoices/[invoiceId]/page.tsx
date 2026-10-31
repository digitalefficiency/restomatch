import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { FileWarning } from 'lucide-react';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { Badge } from '@/lib/components';
import { Banner } from '@/lib/components/feedback';
import { formatDate } from '@/lib/i18n/format';
import { vat } from '@/lib/i18n/messages/vat';
import { enabledFeatures } from '@/lib/ingest/features';
import { formatIls } from '@/lib/money';
import { resolveScan } from '@/lib/supabase/server';
import { getLocale, getT } from '@/lib/i18n/server';
import { invoices } from '@/lib/i18n/messages/invoices';
import { approvals } from '@/lib/i18n/messages/approvals';
import { consolidated as consolidatedNs } from '@/lib/i18n/messages/consolidated';
import { discrepancyLabel, toleranceLabel, resolutionLabel } from '../../approvals/vocab';
import { overContractBadgesForInvoice } from '../../contracts/over-contract';
import { InvoiceCorrection } from './correction-client';
import { dockPriceNotesForInvoice, mergeLineBadges } from './dock-price-notes';
import { ConsolidatedPanel } from './consolidated-panel';
import { Cockpit, type CockpitCopy, type CockpitFrom } from './cockpit';
import { loadDetail } from './load';

export const dynamic = 'force-dynamic';

/** Year·month in Israel time (the register's month rule). */
const ilMonth = (d: Date) => {
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' })
    .format(d)
    .split('-')
    .map(Number);
  return y! * 12 + (m! - 1);
};
/** The register month for [ / ]: `?month=` from the register, else the invoice's own month (≤ 0, ≥ −24). */
function queueMonthOf(param: string | undefined, invoiceDate: Date | string | null): number {
  const raw = param != null ? Number.parseInt(param, 10) : invoiceDate ? ilMonth(new Date(invoiceDate)) - ilMonth(new Date()) : 0;
  return Number.isFinite(raw) ? Math.max(-24, Math.min(0, raw)) : 0;
}

const FROM: readonly CockpitFrom[] = ['approvals', 'payRun', 'inbox', 'register', 'leaks'];
const FROM_HREF: Record<CockpitFrom, string> = {
  approvals: '/dashboard/approvals',
  payRun: '/dashboard/approvals/pay-run',
  inbox: '/dashboard/inbox',
  register: '/dashboard/invoices',
  leaks: '/dashboard/leaks',
};

export async function generateMetadata({ params }: { params: Promise<{ invoiceId: string }> }): Promise<Metadata> {
  const { invoiceId } = await params;
  const d = await loadDetail(invoiceId);
  if (!d) return {};
  const locale = await getLocale();
  const supplier = locale === 'en' && d.supplierNameEn ? d.supplierNameEn : d.supplierName;
  return { title: [d.invoiceNumber, supplier].filter(Boolean).join(' · ') || undefined };
}

/**
 * W2-02 · the invoice cockpit (approvals-39/40/41/48, exec-desktop-02): the
 * document at the start edge, the three-way lines beside it with the ₪ gap,
 * flagged lines expanded, one "decide" CTA, and an explicit OCR edit mode that
 * re-matches on save. Owner, manager, bookkeeper (receiver/chef never: nav gate).
 */
export default async function InvoiceCockpitPage({
  params,
  searchParams,
}: {
  params: Promise<{ invoiceId: string }>;
  searchParams: Promise<{ from?: string; view?: string; month?: string }>;
}) {
  const [{ invoiceId }, sp] = await Promise.all([params, searchParams]);
  const detail = await loadDetail(invoiceId);
  if (!detail) notFound();

  const caller = await createServerCaller();
  const [locale, t, ta, session] = await Promise.all([getLocale(), getT(invoices), getT(approvals), auth()]);
  const role = session?.user?.role ?? null;
  const restaurantId = session?.user?.restaurantId ?? null;
  const finance = role === 'owner' || role === 'manager' || role === 'bookkeeper';
  // OCR edits go through receiving.updateInvoice* (manager tier until W2-05 grants
  // `invoice.correct`); the re-match is already on `invoice.correct` (bookkeeper too).
  const canEdit = role === 'owner' || role === 'manager';
  const canRematch = finance;

  const settled = <T,>(p: Promise<T>) => p.then((value) => ({ ok: true as const, value }), () => ({ ok: false as const }));
  const features = restaurantId ? await enabledFeatures(restaurantId) : [];
  const [invoice, overContract, dockPrice, tc, vatRes, proposalRes, scan] = await Promise.all([
    caller.receiving.getInvoice({ invoiceId }),
    // Wave-1 line badges — {} when the flag/role is off.
    overContractBadgesForInvoice(invoiceId),
    dockPriceNotesForInvoice(invoiceId),
    getT(consolidatedNs),
    // VAT at risk and the consolidated cross-match are ₪ reads: a failure is an
    // in-shell error with retry, never a silent "nothing here" (approvals-45).
    finance && features.includes('vatAtRisk') ? settled(caller.owner.vatAtRisk({ period: 'all', invoiceId })) : Promise.resolve(null),
    finance && detail.consolidated ? settled(caller.consolidated.proposal({ invoiceId })) : Promise.resolve(null),
    detail.hasImage && restaurantId
      ? resolveScan(invoiceId, restaurantId, async () => (await caller.receiving.getInvoice({ invoiceId })).rawImageUrl ?? null).catch(
          () => null,
        )
      : Promise.resolve(null),
  ]);
  const vatRow = vatRes?.ok ? (vatRes.value.rows[0] ?? null) : null;
  const tv = vatRow ? await getT(vat) : null;
  const proposal = proposalRes?.ok ? proposalRes.value : null;
  const partialError = vatRes?.ok === false || proposalRes?.ok === false;

  const from: CockpitFrom = FROM.includes(sp.from as CockpitFrom) ? (sp.from as CockpitFrom) : 'register';
  const supplier = locale === 'en' && detail.supplierNameEn ? detail.supplierNameEn : detail.supplierName;
  const types = new Set([...detail.lines.flatMap((l) => l.findings), ...detail.headerFindings].map((f) => f.type));
  const tolerances = new Set([...detail.lines.flatMap((l) => l.findings), ...detail.headerFindings].map((f) => f.toleranceUsed ?? ''));
  const statuses = new Set([...detail.lines.flatMap((l) => l.findings), ...detail.headerFindings].map((f) => f.resolutionStatus));

  const copy: CockpitCopy = {
    back: t('cockpit.back'),
    fromLabel: t(`cockpit.from.${from}`),
    fromHref: FROM_HREF[from] + (from === 'register' && sp.view ? `?view=${encodeURIComponent(sp.view)}` : ''),
    doc: t('cockpit.doc'),
    lines: t('cockpit.lines'),
    segLabel: t('cockpit.segLabel'),
    viewer: {
      title: t('correction.viewScan'),
      zoomIn: t('cockpit.zoomIn'),
      zoomOut: t('cockpit.zoomOut'),
      rotate: t('cockpit.rotate'),
      zoomTemplate: t('cockpit.zoom', { pct: '{pct}' }),
      openOriginal: t('cockpit.openOriginal'),
      noDoc: t('cockpit.noDoc'),
    },
    col: {
      item: t('cockpit.item'),
      ordered: t('cockpit.ordered'),
      received: t('cockpit.received'),
      billed: t('cockpit.billed'),
      expected: t('cockpit.expected'),
      invoicePrice: t('cockpit.invoicePrice'),
      gap: t('cockpit.gap'),
    },
    source: {
      po_price: t('cockpit.expectedSource.po_price'),
      receipt: t('cockpit.expectedSource.receipt'),
      invoice: t('cockpit.expectedSource.invoice'),
    },
    decideTemplate: t('cockpit.decide', { count: '{count}', amount: '{amount}' }),
    decideOneTemplate: t('cockpit.decideOne', { amount: '{amount}' }),
    noGaps: t('cockpit.noGaps'),
    headerFindings: t('cockpit.headerFindings'),
    review: t('cockpit.review'),
    lowConfidence: t('cockpit.lowConfidence'),
    reconcileTemplate: t('cockpit.reconcile', { lines: '{lines}', vat: '{vat}', vatOk: '{vatOk}' }),
    reconcileUnknown: t('cockpit.reconcileUnknown'),
    editMode: t('cockpit.editMode'),
    exitEdit: t('cockpit.exitEdit'),
    duplicateTemplate: t('cockpit.duplicate', { number: '{number}' }),
    prev: t('cockpit.prev'),
    next: t('cockpit.next'),
    keysHint: t('cockpit.keysHint'),
    flow: {
      label: t('cockpit.flow.label'),
      po: t('cockpit.flow.po'),
      gr: t('cockpit.flow.gr'),
      invoice: t('cockpit.flow.invoice'),
      claim: t('cockpit.flow.claim'),
      missing: t('cockpit.flow.missing'),
    },
    state: detail.state ? t(`state.${detail.state}`) : null,
    findingType: Object.fromEntries([...types].map((ty) => [ty, discrepancyLabel(ta, ty)])),
    tolerance: Object.fromEntries([...tolerances].filter(Boolean).map((x) => [x, t('cockpit.tolerance', { t: toleranceLabel(ta, x) })])),
    resolution: Object.fromEntries([...statuses].map((s) => [s, resolutionLabel(ta, s)])),
  };

  return (
    <div>
      {partialError ? (
        <Banner
          tone="warn"
          title={t('cockpit.loadError')}
          className="mb-4"
          action={
            <a href={`/dashboard/invoices/${invoiceId}?from=${from}`} className="text-sm font-semibold text-primary underline underline-offset-4">
              {t('cockpit.retry')}
            </a>
          }
        />
      ) : null}
      <Cockpit
        detail={JSON.parse(JSON.stringify(detail))}
        title={[detail.invoiceNumber, supplier].filter(Boolean).join(' · ') || t('correction.title')}
        locale={locale}
        from={from}
        view={sp.view ?? null}
        queueMonth={queueMonthOf(sp.month, detail.invoiceDate)}
        copy={copy}
        scan={scan ? { src: scan.signedUrl, mimeType: scan.mimeType } : null}
        showMoney={finance}
        canRematch={canRematch && !detail.consolidated}
        aside={
          <>
            {vatRow && tv ? (
              <div
                role="note"
                data-testid="invoice-vat-at-risk"
                className="mb-4 flex flex-wrap items-start gap-3 rounded-2xl border border-warn/40 bg-surface p-4 shadow-card"
              >
                <FileWarning className="mt-0.5 h-5 w-5 shrink-0 text-warn" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <Badge tone="warning-solid">{tv('invoice.badge', { amount: formatIls(vatRow.vatAtRisk, { locale }) })}</Badge>
                  <p className="mt-2 text-sm text-ink">{vatRow.allocationNumber ? tv('invoice.invalid') : tv('invoice.missing')}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {vatRow.daysLeft >= 0
                      ? tv('invoice.deadline', { date: formatDate(vatRow.deductionDeadline, locale) })
                      : tv('invoice.closed', { date: formatDate(vatRow.deductionDeadline, locale) })}
                  </p>
                </div>
              </div>
            ) : null}
            {/* A חשבונית מרכזת: its cross-match first — that is the job on this page. */}
            {proposal ? (
              <ConsolidatedPanel
                proposal={proposal}
                t={tc}
                locale={locale}
                supplierName={invoice.supplierName}
                invoiceNumber={invoice.invoiceNumber}
              />
            ) : null}
          </>
        }
        editor={
          <InvoiceCorrection
            invoice={invoice}
            canEdit={canEdit}
            canRematch={canRematch}
            lineBadges={mergeLineBadges(overContract, dockPrice)}
          />
        }
      />
    </div>
  );
}
