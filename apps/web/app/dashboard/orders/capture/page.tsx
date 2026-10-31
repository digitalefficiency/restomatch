import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { SectionHeader } from '@/lib/components';
import { getT } from '@/lib/i18n/server';
import { ingest } from '@/lib/i18n/messages/ingest';
import { enabledFeatures } from '@/lib/ingest/features';
import { FieldMode } from '../field-mode';
import { CaptureClient } from './capture-client';
import { ShareForward } from './share-forward';
import { orders as ordersNs } from '@/lib/i18n/messages/orders';

export const dynamic = 'force-dynamic';

/**
 * Order capture (flag `orderCapture`): the owner pastes or shares the order
 * message they already sent the supplier on WhatsApp → a draft PO → one-tap
 * confirm. `?text=` pre-fills it (PWA share target, inbox "open"). A disabled
 * feature, or a role that cannot create orders, is invisible (404).
 */
export default async function OrderCapturePage({
  searchParams,
}: {
  searchParams: Promise<{ text?: string; title?: string }>;
}) {
  const session = await auth();
  const role = session?.user?.role;
  const features = await enabledFeatures(session?.user?.restaurantId);
  if (!features.includes('orderCapture')) notFound();
  const { text, title } = await searchParams;
  const t = await getT(ingest);
  const initialText = [title, text].filter((s): s is string => typeof s === 'string' && s.trim() !== '').join('\n').slice(0, 8000);
  // A WhatsApp share never 404s (orders-17): a role that cannot create orders
  // gets an in-shell T4 page that keeps the text and forwards it to the manager.
  if (role !== 'owner' && role !== 'manager') {
    const to = await getT(ordersNs);
    return (
      <FieldMode className="mx-auto max-w-3xl">
        <SectionHeader level={1} title={to('w2.shareReceiverTitle')} subtitle={to('w2.shareReceiverBody')} />
        <ShareForward text={initialText} />
      </FieldMode>
    );
  }

  return (
    <FieldMode className="mx-auto max-w-3xl">
      <SectionHeader level={1} title={t('orderCapture.title')} subtitle={t('orderCapture.subtitle')} />
      <CaptureClient initialText={initialText} />
    </FieldMode>
  );
}
