import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { SectionHeader } from '@/lib/components';
import { InvoiceCorrection } from './correction-client';
import { getLocale, getT } from '@/lib/i18n/server';
import { invoices } from '@/lib/i18n/messages/invoices';

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

  const [memberships, session] = await Promise.all([caller.onboarding.myMemberships(), auth()]);
  const active =
    memberships.find((m) => m.restaurantId === session?.user?.restaurantId) ?? memberships[0];
  const canEdit = active?.role === 'owner' || active?.role === 'manager';

  return (
    <div>
      <SectionHeader
        level={1}
        title={t('correction.title')}
        subtitle={t('correction.subtitle')}
      />
      <InvoiceCorrection invoice={invoice} canEdit={canEdit} />
    </div>
  );
}
