import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { TRPCError } from '@trpc/server';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { getLocale, getT } from '@/lib/i18n/server';
import { receiving } from '@/lib/i18n/messages/receiving';
import { enabledFeatures } from '@/lib/ingest/features';
import { ReceiverPwa } from '@/lib/pwa/ReceiverPwa';
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
  const userId = session?.user?.id ?? null;

  const [locale, t, features] = await Promise.all([getLocale(), getT(receiving), enabledFeatures(restaurantId)]);
  const pwa = features.includes('receiverPwa');

  // Receiver in English: fill missing English names before the first render.
  // Glossary is instant; the Claude leg (when keyed) is capped so a slow call
  // never blocks the page — the wizard re-checks after OCR.
  if (locale === 'en') {
    await Promise.race([
      caller.receiving.ensureEnglish({ poId }).catch(() => null),
      new Promise((resolve) => setTimeout(resolve, 4000)),
    ]);
  }

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
    supplierNameEn: po.supplierNameEn ?? null,
    expectedAt: po.expectedAt ? new Date(po.expectedAt).toISOString() : null,
    status: po.status,
    totalEstimated: po.totalEstimated != null ? Number(po.totalEstimated) : null,
    lines: po.lines.map((l) => ({
      id: l.id,
      productId: l.productId ?? null,
      rawDescription: l.rawDescription ?? null,
      rawDescriptionEn: l.rawDescriptionEn ?? null,
      productNameEn: l.productNameEn ?? null,
      qtyOrdered: Number(l.qtyOrdered),
      unit: l.unit,
      unitPriceExpected: l.unitPriceExpected != null ? Number(l.unitPriceExpected) : null,
    })),
  };

  return (
    <div>
      {pwa && restaurantId && userId ? <ReceiverPwa restaurantId={restaurantId} userId={userId} /> : null}
      <Link
        href="/dashboard/receiving"
        className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink"
      >
        <ArrowRight className="h-4 w-4 ltr:-scale-x-100" aria-hidden="true" />
        {t('po.backToList')}
      </Link>

      <ReceivingWizard po={poForClient} restaurantId={restaurantId} offlineQueue={pwa} userId={userId} />
    </div>
  );
}
