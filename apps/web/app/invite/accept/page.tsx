import { createHash } from 'node:crypto';
import { Info } from 'lucide-react';
import { redirect } from 'next/navigation';
import { eq, invitations, users } from '@restomatch/db';
import { auth, signOut } from '@/auth';
import { authDb } from '@/lib/authDb';
import { createServerCaller } from '@/lib/trpc/server';
import { LinkButton } from '@/lib/components';
import { auth as authMessages } from '@/lib/i18n/messages/auth';
import { getLocale, getT } from '@/lib/i18n/server';
import { localizeServerError } from '@/lib/serverErrors';
import { AuthShell, authTitle } from '../../(auth)/_components/AuthShell';
import { SubmitButton } from '../../(auth)/_components/SubmitButton';
import { clearHint } from '../../login/hint';
import { invitationExpired, inviteFailure, type InviteFailure } from './failure';

export const generateMetadata = () => authTitle('shell.titles.invite');

interface PageProps {
  searchParams: Promise<{ token?: string }>;
}

/**
 * Who the invite is for and who sent it — only for the calm error states
 * (auth-11). Looked up by the token's hash on the identity connection, exactly
 * like team.acceptInvite: holding the token is what proves you were invited,
 * and the invited address is already in the invite link itself.
 */
async function inviteContext(
  token: string,
): Promise<{ email: string; inviter: string | null; status: string; expiresAt: Date } | null> {
  const hash = createHash('sha256').update(token).digest('hex');
  const [row] = await authDb
    .select({ email: invitations.email, inviter: users.name, status: invitations.status, expiresAt: invitations.expiresAt })
    .from(invitations)
    .leftJoin(users, eq(users.id, invitations.invitedByUserId))
    .where(eq(invitations.tokenHash, hash))
    .limit(1);
  return row ? { email: row.email, inviter: row.inviter?.trim() || null, status: row.status, expiresAt: row.expiresAt } : null;
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
  const caller = await createServerCaller();
  let failure: InviteFailure | null = null;
  let message = '';
  try {
    await caller.team.acceptInvite({ token });
  } catch (e) {
    failure = inviteFailure(e);
    message = localizeServerError(e, locale, (await getT(authMessages))('invite.genericError'));
  }

  // redirect() must run outside the try/catch (it throws NEXT_REDIRECT). Go via
  // the refresh handler so the cookie carries the new membership's role (this
  // RSC cannot write cookies) and the edge role gate applies immediately.
  if (!failure) redirect('/api/session/refresh?next=%2Fdashboard');

  const [t, memberships, ctx] = await Promise.all([
    getT(authMessages),
    caller.onboarding.myMemberships().catch(() => []),
    failure === 'wrongEmail' || failure === 'expired' || failure === 'used' ? inviteContext(token) : Promise.resolve(null),
  ]);
  // acceptInvite flips an expired invite's status to 'expired' on the first
  // open, so every later open reports it as "used". The expiry date is stable:
  // derive the state from it, so an expired invite reads EXPIRED every time.
  if (failure === 'used' && ctx && invitationExpired(ctx)) failure = 'expired';
  // A user with no membership is never sent to /dashboard (it would bounce them
  // to "create a restaurant" — the wrong door for an invitee).
  const isMember = memberships.length > 0;
  const current = session.user.email ?? '';
  const invitedEmail = ctx?.email ?? null;
  const backToInvite = `/invite/accept?token=${encodeURIComponent(token)}`;

  async function switchAccount() {
    'use server';
    const qs = new URLSearchParams({ callbackUrl: backToInvite });
    if (invitedEmail) qs.set('email', invitedEmail);
    await clearHint();
    await signOut({ redirectTo: `/login?${qs.toString()}` });
  }

  const copy = {
    expired: {
      title: t('inviteState.expiredTitle'),
      body: ctx?.inviter ? t('inviteState.expiredBody', { inviter: ctx.inviter }) : t('inviteState.expiredBodyNoName'),
    },
    wrongEmail: {
      title: t('inviteState.wrongEmailTitle'),
      body: invitedEmail ? t('inviteState.wrongEmailBody', { current, invited: invitedEmail }) : message,
    },
    used: { title: t('inviteState.usedTitle'), body: t('inviteState.usedBody') },
    notFound: { title: t('inviteState.notFoundTitle'), body: t('inviteState.notFoundBody') },
    other: { title: t('inviteState.genericTitle'), body: message },
  }[failure];

  return (
    <AuthShell>
      {/* T4: a stale or mis-addressed invite is information, not an alarm. */}
      <div className="mb-2 flex items-center gap-2 text-ink">
        <Info className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
        <h1 className="text-xl font-bold">{copy.title}</h1>
      </div>
      <p className="text-base text-ink" data-testid="invite-state" data-state={failure}>
        {copy.body}
      </p>

      <div className="mt-6 space-y-3">
        {failure === 'wrongEmail' ? (
          <form action={switchAccount}>
            <SubmitButton className="min-h-12 w-full text-base">
              {invitedEmail ? t('inviteState.signOutAndUse', { email: invitedEmail }) : t('inviteState.signOutAndUseGeneric')}
            </SubmitButton>
          </form>
        ) : null}
        {isMember ? (
          <LinkButton
            href="/dashboard"
            variant={failure === 'wrongEmail' ? 'secondary' : 'primary'}
            className="min-h-12 w-full text-base"
          >
            {t('inviteState.toAccount')}
          </LinkButton>
        ) : failure !== 'wrongEmail' ? (
          <form action={switchAccount}>
            <SubmitButton variant="secondary" className="min-h-12 w-full text-base">
              {t('inviteState.otherAccount')}
            </SubmitButton>
          </form>
        ) : null}
      </div>
    </AuthShell>
  );
}
