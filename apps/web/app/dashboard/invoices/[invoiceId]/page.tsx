import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { SectionHeader } from '@/lib/components';
import { InvoiceCorrection } from './correction-client';
import { getLocale, getT } from '@/lib/i18n/server';
import { invoices } from '@/lib/i18n/messages/invoices';
import { consolidated as consolidatedNs } from '@/lib/i18n/messages/consolidated';
import { ConsolidatedPanel } from './consolidated-panel';

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

  const [memberships, session, tc] = await Promise.all([
    caller.onboarding.myMemberships(),
    auth(),
    getT(consolidatedNs),
  ]);
  const active =
    memberships.find((m) => m.restaurantId === session?.user?.restaurantId) ?? memberships[0];
  const canEdit = active?.role === 'owner' || active?.role === 'manager';
  // Consolidated invoice ↔ delivery notes (flag consolidatedMatch; read-only; null
  // otherwise). It shows ₪ differences — finance roles only, never a receiver.
  const finance = active?.role === 'owner' || active?.role === 'manager' || active?.role === 'bookkeeper';
  const proposal = finance ? await caller.consolidated.proposal({ invoiceId }).catch(() => null) : null;

  return (
    <div>
      <SectionHeader
        level={1}
        title={t('correction.title')}
        subtitle={t('correction.subtitle')}
      />
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
      <InvoiceCorrection invoice={invoice} canEdit={canEdit} />
    </div>
  );
}
