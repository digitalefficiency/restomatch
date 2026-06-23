import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { SectionHeader } from '@/lib/components';
import { InvoiceCorrection } from './correction-client';

export default async function InvoiceCorrectionPage({
  params,
}: {
  params: Promise<{ invoiceId: string }>;
}) {
  const { invoiceId } = await params;
  const caller = await createServerCaller();

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
        title="תיקון חשבונית"
        subtitle="תקנו ערכים שזוהו שגוי ב-OCR (כמות / מחיר / סכום) והריצו התאמה מחדש — מספר הדליפה מחושב מהשורות האלה."
      />
      <InvoiceCorrection invoice={invoice} canEdit={canEdit} />
    </div>
  );
}
