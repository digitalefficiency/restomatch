import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { TRPCError } from '@trpc/server';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { ReceivingWizard } from './wizard';

export const dynamic = 'force-dynamic';

export default async function ReceivingPoPage({
  params,
}: {
  params: Promise<{ poId: string }>;
}) {
  const { poId } = await params;
  const caller = await createServerCaller();
  const session = await auth();
  const restaurantId = session?.user?.restaurantId ?? null;

  let po;
  try {
    po = await caller.receiving.getPo({ poId });
  } catch (err) {
    if (err instanceof TRPCError && err.code === 'NOT_FOUND') notFound();
    throw err;
  }

  // Normalize numerics / dates for the client boundary.
  const poForClient = {
    id: po.id,
    supplierId: po.supplierId,
    supplierName: po.supplierName,
    expectedAt: po.expectedAt ? new Date(po.expectedAt).toISOString() : null,
    status: po.status,
    totalEstimated: po.totalEstimated != null ? Number(po.totalEstimated) : null,
    lines: po.lines.map((l) => ({
      id: l.id,
      productId: l.productId ?? null,
      rawDescription: l.rawDescription ?? null,
      qtyOrdered: Number(l.qtyOrdered),
      unit: l.unit,
      unitPriceExpected: l.unitPriceExpected != null ? Number(l.unitPriceExpected) : null,
    })),
  };

  return (
    <div dir="rtl">
      <Link
        href="/dashboard/receiving"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink"
      >
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
        חזרה לרשימת המשלוחים
      </Link>

      <ReceivingWizard po={poForClient} restaurantId={restaurantId} />
    </div>
  );
}
