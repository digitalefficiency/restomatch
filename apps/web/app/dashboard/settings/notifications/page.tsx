import type { Metadata } from 'next';
import { SectionHeader } from '@/lib/components';
import { getT } from '@/lib/i18n/server';
import { common } from '@/lib/i18n/messages/common';
import { NotificationsClient } from './notifications-client';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(common);
  return { title: `${t('pwa.notify.title')} — RestoMatch` };
}

/**
 * W3-03b · "התראות": this phone's push subscription and the per-event switches
 * for the caller's role (every role; the receiver sees field events only). The
 * data is the caller's own (push.* procedures scope to the session). Push
 * permission is asked only from the button. No ₪ on this page.
 */
export default async function NotificationsPage() {
  const t = await getT(common);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <SectionHeader level={1} title={t('pwa.notify.title')} subtitle={t('pwa.notify.subtitle')} />
      <NotificationsClient />
    </div>
  );
}
