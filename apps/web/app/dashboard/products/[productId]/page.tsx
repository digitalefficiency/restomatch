import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { SectionHeader } from '@/lib/components';
import { ProductEditor } from './product-client';

export default async function ProductPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const caller = await createServerCaller();

  const [detail, suppliers, memberships, session] = await Promise.all([
    caller.catalog.productDetail({ productId }),
    caller.suppliers.list({}),
    caller.onboarding.myMemberships(),
    auth(),
  ]);
  if (!detail) notFound();

  const active =
    memberships.find((m) => m.restaurantId === session?.user?.restaurantId) ?? memberships[0];
  const canEdit = active?.role === 'owner' || active?.role === 'manager';

  return (
    <div>
      <SectionHeader
        level={1}
        title="מוצר"
        subtitle="שם המוצר מזין את מנוע ההצלבה והדוחות. עריכת השם, הקטגוריה, היחידה והספק הבלעדי."
      />
      <ProductEditor detail={detail} suppliers={suppliers} canEdit={canEdit} />
    </div>
  );
}
