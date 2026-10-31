import { redirect } from 'next/navigation';
import { auth, signOut } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { onboarding } from '@/lib/i18n/messages/onboarding';
import { getT } from '@/lib/i18n/server';
import { safeRelativePath } from '@/lib/safeRedirect';
import { AuthShell, authTitle } from '../(auth)/_components/AuthShell';
import { clearHint } from '../login/hint';
import { OnboardingForm } from './form';

export const generateMetadata = () => authTitle('shell.titles.onboarding');

/** Who to contact while sign-up is by invitation only (pilot brief). */
const CONTACT_PHONE = '054-3544245';
const CONTACT_EMAIL = 'info@digitalefficiency.co.il';

/** Where to land after onboarding: the validated `callbackUrl` (e.g. a leak-check claim), never a loop back here. */
function landing(callbackUrl: string | undefined): string {
  const next = safeRelativePath(callbackUrl);
  return next.startsWith('/onboarding') || next.startsWith('/login') ? '/dashboard' : next;
}

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string }> }) {
  const { callbackUrl } = await searchParams;
  const next = landing(callbackUrl);
  const self = `/onboarding${callbackUrl ? `?callbackUrl=${encodeURIComponent(next)}` : ''}`;
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=${encodeURIComponent(self)}`);
  }
  if (session.user.twoFactorPending) redirect(`/login/2fa?callbackUrl=${encodeURIComponent(self)}`);

  const caller = await createServerCaller();
  const memberships = await caller.onboarding.myMemberships();

  // auth-09: already a member → on to where they were going (through the
  // session refresh, so the cookie carries the membership + role).
  if (memberships.length > 0) {
    redirect(`/api/session/refresh?next=${encodeURIComponent(next)}`);
  }

  const t = await getT(onboarding);
  // Closed sign-up (pilot): no form for a caller who may not create a restaurant.
  const { open } = await caller.onboarding.signupStatus();

  async function logout() {
    'use server';
    await clearHint();
    await signOut({ redirectTo: '/login?signedOut=1' });
  }

  return (
    <AuthShell
      width="lg"
      headerExtra={
        <form action={logout}>
          <button type="submit" className="inline-flex min-h-11 items-center px-2 text-sm text-muted hover:text-ink hover:underline">
            {t('signOut')}
          </button>
        </form>
      }
    >
      {open ? (
        <>
          <h1 className="mb-2 text-2xl font-bold text-ink">{t('title')}</h1>
          <p className="mb-6 text-sm text-muted">{t('subtitle')}</p>
          <OnboardingForm next={next} initialName={session.user.name ?? ''} />
        </>
      ) : (
        <>
          <h1 className="mb-2 text-2xl font-bold text-ink">{t('closed.title')}</h1>
          <p className="text-base leading-relaxed text-ink">
            {t('closed.body')} {t('closed.contactName')} ·{' '}
            <a href={`tel:${CONTACT_PHONE.replace(/-/g, '')}`} className="font-medium text-primary underline" dir="ltr">
              {CONTACT_PHONE}
            </a>{' '}
            ·{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-primary underline" dir="ltr">
              {CONTACT_EMAIL}
            </a>
          </p>
        </>
      )}
      <p className="mt-6 text-sm leading-relaxed text-muted">{t('invitedNote')}</p>
    </AuthShell>
  );
}
