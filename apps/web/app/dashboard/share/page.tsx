import { auth } from '@/auth';
import { enabledFeatures } from '@/lib/ingest/features';
import { ShareClient } from './share-client';

export const dynamic = 'force-dynamic';

/**
 * W3-03b · the PWA share target lands here (any role, never a 404). The
 * service worker parked the share on the device (`?id=`); without a worker the
 * server route forwarded only the text (`?text=&title=&url=`, `files=lost`).
 * Text → order capture (which handles roles that cannot order); files → kept
 * on the phone for the delivery. No ₪ on this page.
 */
export default async function SharePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  const features = await enabledFeatures(session?.user?.restaurantId);
  const q = await searchParams;
  const one = (k: string) => (typeof q[k] === 'string' ? (q[k] as string).slice(0, 8000) : '');
  const role = session?.user?.role ?? null;
  return (
    <ShareClient
      id={one('id') || null}
      fallback={{ title: one('title'), text: one('text'), url: one('url') }}
      filesLost={one('files') === 'lost'}
      orderCapture={features.includes('orderCapture')}
      canReceive={role === 'owner' || role === 'manager' || role === 'receiver'}
    />
  );
}
