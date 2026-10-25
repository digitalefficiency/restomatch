import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { TRPCError } from '@trpc/server';
// The engine's own quantity tolerance — the UI reads it, never redefines it (AGENTS.md).
import { DEFAULT_TOLERANCES } from '@restomatch/matching';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { getAppLocale, getLocale, getT } from '@/lib/i18n/server';
import { isReceiverLocale } from '@/lib/i18n/config';
import { receiving } from '@/lib/i18n/messages/receiving';
import { enabledFeatures } from '@/lib/ingest/features';
import { ReceiverPwa } from '@/lib/pwa/ReceiverPwa';
import { ReceivingWizard, type ReceiptForClient } from './wizard';
import { localizePoLines, type LocalNames } from './_localize';

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

  const [locale, appLocale, t, features] = await Promise.all([
    getLocale(),
    getAppLocale(),
    getT(receiving),
    enabledFeatures(restaurantId),
  ]);
  const pwa = features.includes('receiverPwa');

  // Everything the first paint needs, in parallel (RCV-28). The English /
  // receiver-language names stay capped at 4 s each, and the wizard re-checks
  // after OCR, so a slow translation never holds the driver at the door.
  const englishNames =
    locale === 'en'
      ? Promise.race([
          caller.receiving.ensureEnglish({ poId }).catch(() => null),
          new Promise((resolve) => setTimeout(resolve, 4000)),
        ])
      : Promise.resolve(null);
  const receiverNames: Promise<LocalNames> = isReceiverLocale(appLocale)
    ? Promise.race([
        caller.receiverLangs.localNames({ locale: appLocale, poId }).catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
      ]).then((r) => ({ ...(r?.names ?? {}) })) // plain object for the client boundary
    : Promise.resolve({});
  // Flag `dockPriceContext`: fail silent (off) on any error.
  const priceContext = caller.receiving
    .priceContext({})
    .then((r) => r.enabled)
    .catch(() => false);
  // An existing receipt: resume the count, or show it read-only once closed.
  // Today's list already says whether this PO has one — a fresh PO then costs no
  // NOT_FOUND (every procedure error is reported); a PO outside today's window asks directly.
  const receipt = caller.receiving
    .todayExpectations()
    .catch(() => null)
    .then((today) => {
      const row = today?.find((e) => e.poId === poId);
      if (row && !row.receiptId) return null;
      return caller.receiving.getReceipt(row?.receiptId ? { grId: row.receiptId } : { poId }).catch(() => null);
    });

  // English names first: getPo must read the names it fills.
  await englishNames;
  let po;
  try {
    po = await caller.receiving.getPo({ poId });
  } catch (err) {
    // A malformed id fails zod (BAD_REQUEST) — that is a missing page, not a crash.
    if (err instanceof TRPCError && (err.code === 'NOT_FOUND' || err.code === 'BAD_REQUEST')) notFound();
    throw err;
  }
  const [localNames, dockPriceContext, existing] = await Promise.all([receiverNames, priceContext, receipt]);
  const existingReceipt: ReceiptForClient | null = existing
    ? {
        id: existing.id,
        status: existing.status,
        receivedAt: existing.receivedAt ? new Date(existing.receivedAt).toISOString() : null,
        lines: existing.lines.map((l) => ({
          grLineId: l.grLineId,
          poLineId: l.poLineId,
          productId: l.productId,
          productName: l.productName,
          productNameEn: l.productNameEn,
          rawDescription: l.rawDescription,
          orderedQty: l.orderedQty,
          unit: l.unit,
          qtyReceived: l.qtyReceived,
          qtyRejected: l.qtyRejected,
          rejectReason: l.rejectReason,
          conditionNotes: l.conditionNotes,
        })),
      }
    : null;

  // Normalize numerics / dates for the client boundary.
  const poForClient = {
    id: po.id,
    supplierId: po.supplierId,
    supplierName: po.supplierName,
    supplierNameEn: po.supplierNameEn ?? null,
    expectedAt: po.expectedAt ? new Date(po.expectedAt).toISOString() : null,
    status: po.status,
    totalEstimated: po.totalEstimated != null ? Number(po.totalEstimated) : null,
    features: { dockSlip: po.features.dockSlip },
    lines: localizePoLines(po.lines.map((l) => ({
      id: l.id,
      productId: l.productId ?? null,
      rawDescription: l.rawDescription ?? null,
      rawDescriptionEn: l.rawDescriptionEn ?? null,
      productNameEn: l.productNameEn ?? null,
      qtyOrdered: Number(l.qtyOrdered),
      unit: l.unit,
      unitPriceExpected: l.unitPriceExpected != null ? Number(l.unitPriceExpected) : null,
    })), localNames),
  };

  return (
    <div>
      {pwa && restaurantId && userId ? <ReceiverPwa restaurantId={restaurantId} userId={userId} /> : null}
      <Link
        href="/dashboard/receiving"
        className="mb-2 inline-flex min-h-12 items-center gap-1.5 text-base text-muted transition-colors hover:text-ink"
      >
        <ArrowRight className="h-4 w-4 ltr:-scale-x-100" aria-hidden="true" />
        {t('po.backToList')}
      </Link>

      <ReceivingWizard
        po={poForClient}
        restaurantId={restaurantId}
        offlineQueue={pwa}
        userId={userId}
        localNames={localNames}
        dockPriceContext={dockPriceContext}
        existingReceipt={existingReceipt}
        tolerance={{ qtyPercent: DEFAULT_TOLERANCES.qtyPercent, qtyAbsolute: DEFAULT_TOLERANCES.qtyAbsolute }}
      />
    </div>
  );
}
