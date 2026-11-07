import { redirect } from 'next/navigation';
import { auth, signOut } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { onboarding } from '@/lib/i18n/messages/onboarding';
import { getLocale, getT } from '@/lib/i18n/server';
import { safeRelativePath } from '@/lib/safeRedirect';
import { AuthShell, authTitle } from '../(auth)/_components/AuthShell';
import { clearHint } from '../login/hint';
import { OnboardingForm } from './form';
import { acceptPendingInviteAction } from './actions';
import { pendingInvitesFor } from './pendingInvites';
import { labelForRole } from '@/lib/roles';
import { SubmitButton } from '../(auth)/_components/SubmitButton';
import { Notice } from '../(auth)/_components/Notice';

export const generateMetadata = () => authTitle('shell.titles.onboarding');

/** Where to land after onboarding: the validated `callbackUrl` (e.g. a leak-check claim), never a loop back here. */
function landing(callbackUrl: string | undefined): string {
  const next = safeRelativePath(callbackUrl);
  return next.startsWith('/onboarding') || next.startsWith('/login') ? '/dashboard' : next;
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; invite?: string }>;
}) {
  const { callbackUrl, invite: inviteError } = await searchParams;
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

  const [t, locale, invites] = await Promise.all([getT(onboarding), getLocale(), pendingInvitesFor(session.user.id)]);
  const lang = locale === 'en' ? 'en' : 'he';

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
      {invites.length > 0 ? (
        // W3-07b: an invite is already waiting for this address — joining comes
        // before creating a restaurant, so an invitee never makes a stray tenant.
        <section className="mb-8" aria-labelledby="pending-invites" data-testid="pending-invites">
          <h1 id="pending-invites" className="mb-2 text-2xl font-bold text-ink">
            {t('pending.title')}
          </h1>
          <p className="mb-4 text-sm text-muted">{t('pending.subtitle')}</p>
          {inviteError ? (
            <Notice tone="error" className="mb-4">
              {t('pending.failed')}
            </Notice>
          ) : null}
          <ul className="space-y-3">
            {invites.map((inv) => (
              <li key={inv.id} className="rounded-xl border border-line-strong p-4">
                <p className="text-base font-semibold text-ink">
                  {t('pending.row', { restaurant: inv.restaurantName, role: labelForRole(inv.role, lang) })}
                </p>
                {inv.inviterName ? <p className="text-sm text-muted">{t('pending.by', { inviter: inv.inviterName })}</p> : null}
                <form action={acceptPendingInviteAction} className="mt-3">
                  <input type="hidden" name="invitationId" value={inv.id} />
                  <SubmitButton className="min-h-11 w-full text-base">{t('pending.join')}</SubmitButton>
                </form>
              </li>
            ))}
          </ul>
          <h2 className="mt-8 text-lg font-bold text-ink">{t('pending.orCreate')}</h2>
        </section>
      ) : null}
      {invites.length > 0 ? null : <h1 className="mb-2 text-2xl font-bold text-ink">{t('title')}</h1>}
      <p className="mb-6 text-sm text-muted">{t('subtitle')}</p>
      <OnboardingForm next={next} initialName={session.user.name ?? ''} />
      <p className="mt-6 text-sm leading-relaxed text-muted">{t('invitedNote')}</p>
    </AuthShell>
  );
}
