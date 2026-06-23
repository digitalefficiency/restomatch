import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { SectionHeader } from '@/lib/components';
import { OrderDetail } from './detail-client';

export default async function OrderDetailPage({ params }: { params: Promise<{ poId: string }> }) {
  const { poId } = await params;
  const caller = await createServerCaller();

  let data: Awaited<ReturnType<typeof caller.orders.get>>;
  try {
    data = await caller.orders.get({ poId });
  } catch {
    notFound();
  }
  if (!data.po) notFound();

  const [memberships, session] = await Promise.all([caller.onboarding.myMemberships(), auth()]);
  const active =
    memberships.find((m) => m.restaurantId === session?.user?.restaurantId) ?? memberships[0];
  const canEdit = active?.role === 'owner' || active?.role === 'manager';

  return (
    <div>
      <SectionHeader
        level={1}
        title={`הזמנה — ${data.supplierName ?? ''}`.trim()}
        subtitle="פרטי ההזמנה והשורות. טיוטה ניתנת לעריכה, שליחה או ביטול."
      />
      <OrderDetail data={data} canEdit={canEdit} />
    </div>
  );
}
