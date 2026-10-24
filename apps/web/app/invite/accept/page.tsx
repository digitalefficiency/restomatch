import { AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { Card } from '@/lib/components';
import { auth as authMessages } from '@/lib/i18n/messages/auth';
import { getLocale, getT } from '@/lib/i18n/server';
import { localizeServerError } from '@/lib/serverErrors';

interface PageProps {
  searchParams: Promise<{ token?: string }>;
}

/**
 * Invite acceptance. The invitee arrives here already signed-in (the invite
 * email links to /login?callbackUrl=/invite/accept?token=…, so the magic-link
 * flow lands here authenticated). We exchange the token for a membership via
 * team.acceptInvite, which enforces token/email/expiry/status server-side.
 */
export default async function InviteAcceptPage({ searchParams }: PageProps) {
  const { token } = await searchParams;
  if (!token) redirect('/dashboard');

  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/invite/accept?token=${token}`)}`);
  }

  const locale = await getLocale();
  let error: string | null = null;
  try {
    const caller = await createServerCaller();
    await caller.team.acceptInvite({ token });
  } catch (e) {
    error = localizeServerError(e, locale, (await getT(authMessages))('invite.genericError'));
  }

  // redirect() must run outside the try/catch (it throws NEXT_REDIRECT). Go via
  // the refresh handler so the cookie carries the new membership's role (this
  // RSC cannot write cookies) and the edge role gate applies immediately.
  if (!error) redirect('/api/session/refresh?next=%2Fdashboard');

  const t = await getT(authMessages);
  return (
    <main className="flex min-h-screen items-center justify-center p-6 pb-[calc(1.5rem+var(--consent-h,0px))]">
      <Card elevated flow padding="lg" className="w-full max-w-md">
        <div className="mb-2 flex items-center gap-2 text-danger">
          <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
          <h1 className="text-xl font-bold">{t('invite.failedTitle')}</h1>
        </div>
        <p className="text-sm text-muted">{error}</p>
        <Link
          href="/dashboard"
          className="mt-6 inline-block text-sm font-semibold text-primary hover:underline"
        >
          {t('invite.back')}
        </Link>
      </Card>
    </main>
  );
}
