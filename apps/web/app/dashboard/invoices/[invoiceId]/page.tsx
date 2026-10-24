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

  const [memberships, session, overContract, dockPrice] = await Promise.all([
    caller.onboarding.myMemberships(),
    auth(),
    // Wave-1 "over contract" line badges — {} when the flag/role is off (fail silent).
    overContractBadgesForInvoice(invoiceId),
    // Flag `dockPriceContext`: "your usual price" under PRICE_HIGHER lines ({} when off).
    dockPriceNotesForInvoice(invoiceId),
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

  return (
    <div>
      <SectionHeader
        level={1}
        title={t('correction.title')}
        subtitle={t('correction.subtitle')}
      />
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
      <InvoiceCorrection invoice={invoice} canEdit={canEdit} lineBadges={mergeLineBadges(overContract, dockPrice)} />
    </div>
  );
}
