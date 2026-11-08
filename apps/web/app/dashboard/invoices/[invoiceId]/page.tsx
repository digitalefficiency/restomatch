import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { FileWarning } from 'lucide-react';
import { Badge, SectionHeader } from '@/lib/components';
import { formatDate } from '@/lib/i18n/format';
import { vat } from '@/lib/i18n/messages/vat';
import { enabledFeatures } from '@/lib/ingest/features';
import { formatIls } from '@/lib/money';
import { InvoiceCorrection } from './correction-client';
import { getLocale, getT } from '@/lib/i18n/server';
import { invoices } from '@/lib/i18n/messages/invoices';
import { overContractBadgesForInvoice } from '../../contracts/over-contract';
import { dockPriceNotesForInvoice, mergeLineBadges } from './dock-price-notes';
import { consolidated as consolidatedNs } from '@/lib/i18n/messages/consolidated';
import { ConsolidatedPanel } from './consolidated-panel';
import { StatusChip } from '@/lib/components/feedback';
import { holdReasonKeys } from '../hold-reasons';

export default async function InvoiceCorrectionPage({
  params,
}: {
  params: Promise<{ invoiceId: string }>;
}) {
  const { invoiceId } = await params;
  const caller = await createServerCaller();
  const [locale, t] = await Promise.all([getLocale(), getT(invoices)]);

  // Receiver in English: fill the lines' English names before rendering.
  if (locale === 'en') {
    await Promise.race([
      caller.receiving.ensureEnglish({ invoiceId }).catch(() => null),
      new Promise((resolve) => setTimeout(resolve, 4000)),
    ]);
  }

  let invoice: Awaited<ReturnType<typeof caller.receiving.getInvoice>>;
  try {
    invoice = await caller.receiving.getInvoice({ invoiceId });
  } catch {
    notFound();
  }

  const [memberships, session, overContract, dockPrice, tc] = await Promise.all([
    caller.onboarding.myMemberships(),
    auth(),
    // Wave-1 "over contract" line badges — {} when the flag/role is off (fail silent).
    overContractBadgesForInvoice(invoiceId),
    // Flag `dockPriceContext`: "your usual price" under PRICE_HIGHER lines ({} when off).
    dockPriceNotesForInvoice(invoiceId),
    getT(consolidatedNs),
  ]);
  const active =
    memberships.find((m) => m.restaurantId === session?.user?.restaurantId) ?? memberships[0];
  const canEdit = active?.role === 'owner' || active?.role === 'manager';
  // VAT at risk (flag vatAtRisk): this invoice is above the allocation threshold with no valid number.
  const vatRow =
    active && active.role !== 'chef' && (await enabledFeatures(active.restaurantId)).includes('vatAtRisk')
      ? ((await caller.owner.vatAtRisk({ period: 'all', invoiceId }).catch(() => null))?.rows[0] ?? null)
      : null;
  const tv = vatRow ? await getT(vat) : null;
  // Consolidated invoice ↔ delivery notes (flag consolidatedMatch; read-only; null
  // otherwise). It shows ₪ differences — finance roles only, never a receiver.
  const finance = active?.role === 'owner' || active?.role === 'manager' || active?.role === 'bookkeeper';
  const proposal = finance ? await caller.consolidated.proposal({ invoiceId }).catch(() => null) : null;
  // PILOT (#222): a held invoice says why at the top (S13 #224 review reasons; link-only holds are G-08's).
  // No ₪ in it; finance roles only, like the list it comes from.
  const held = finance
    ? ((await caller.invoices.needsLines().catch(() => null))?.rows.find((r) => r.id === invoiceId && r.reviewReasons.length > 0) ?? null)
    : null;

  return (
    <div>
      <SectionHeader
        level={1}
        title={t('correction.title')}
        subtitle={t('correction.subtitle')}
      />
      {held ? (
        <div
          role="note"
          data-testid="invoice-held-reasons"
          className="mb-4 rounded-2xl border border-line bg-surface-2 p-4"
        >
          {/* The bookkeeper can't edit here — the owner or manager reviews it. */}
          <p className="text-sm font-semibold text-ink">{t(canEdit ? 'needsLines.heldTitle' : 'needsLines.heldTitleReadOnly')}</p>
          <ul className="mt-2 flex flex-wrap gap-1">
            {holdReasonKeys(held.reviewReasons).map((k) => (
              <li key={k}>
                <StatusChip tone="neutral" emphasis="subtle" shape="control" icon={null} label={t(`needsLines.held.${k}`)} />
              </li>
            ))}
          </ul>
          {/* Owner/manager only: the bookkeeper can't open the supplier pages. */}
          {canEdit && held.supplierId && held.reviewReasons.includes('supplier_id_mismatch') ? (
            <Link
              href={`/dashboard/suppliers/${held.supplierId}`}
              data-testid="invoice-held-supplier-link"
              className="mt-2 inline-block text-sm font-semibold text-primary underline underline-offset-4"
            >
              {t('needsLines.supplierDetails')}
            </Link>
          ) : null}
        </div>
      ) : null}
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
      {/* A ריכוז: its cross-match first — that is the job on this page — then the correction form. */}
      {proposal ? (
        <ConsolidatedPanel
          proposal={proposal}
          t={tc}
          locale={locale}
          supplierName={invoice.supplierName}
          invoiceNumber={invoice.invoiceNumber}
        />
      ) : null}
      <InvoiceCorrection invoice={invoice} canEdit={canEdit} lineBadges={mergeLineBadges(overContract, dockPrice)} />
    </div>
  );
}
