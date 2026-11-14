import { Info, Users } from 'lucide-react';
import { auth } from '@/auth';
import { LinkButton } from '@/lib/components';
import { auth as authMessages } from '@/lib/i18n/messages/auth';
import { getLocale, getT } from '@/lib/i18n/server';
import { labelForRole } from '@/lib/roles';
import { AuthShell, authTitle } from '../../(auth)/_components/AuthShell';
import { Notice } from '../../(auth)/_components/Notice';
import { SubmitButton } from '../../(auth)/_components/SubmitButton';
import { loadInvite } from '../_lib/joinFlow';
import { sendJoinCodeAction } from '../actions';
import { joinAcceptPath } from '../paths';
import { JoinCodeForm } from './JoinCodeForm';

export const dynamic = 'force-dynamic';
// The invite token is in the path: never send it on in a Referer header.
export const generateMetadata = async () => ({ ...(await authTitle('join.title')), referrer: 'no-referrer' as const });

interface PageProps {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ step?: string; e?: string; sent?: string }>;
}

const ERROR_KEYS = ['wrongCode', 'noCode', 'locked', 'name', 'rate', 'policy'] as const;
type JoinErrorKey = (typeof ERROR_KEYS)[number];

/**
 * W3-07b: `/join/<token>` — public. Shows who invited you, to which restaurant
 * and in which role, then proves the invited mailbox with a 6-digit code and
 * lets you set your OWN name and password (no PIN, no shared device login).
 * A dead token (expired / used / revoked / unknown) shows a calm T4 state and
 * never names the restaurant.
 */
export default async function JoinPage({ params, searchParams }: PageProps) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const [t, locale, invite] = await Promise.all([getT(authMessages), getLocale(), loadInvite(token)]);

  if (invite.state !== 'valid') {
    const copy = {
      expired: { title: t('inviteState.expiredTitle'), body: t('inviteState.expiredBodyNoName') },
      used: { title: t('inviteState.usedTitle'), body: t('inviteState.usedBody') },
      notFound: { title: t('inviteState.notFoundTitle'), body: t('inviteState.notFoundBody') },
    }[invite.state];
    return (
      <AuthShell>
        <div className="mb-2 flex items-center gap-2 text-ink">
          <Info className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
          <h1 className="text-xl font-bold">{copy.title}</h1>
        </div>
        <p className="text-base text-ink" data-testid="join-state" data-state={invite.state}>
          {copy.body}
        </p>
        <LinkButton href="/login" variant="secondary" className="mt-6 min-h-12 w-full text-base">
          {t('inviteState.signIn')}
        </LinkButton>
      </AuthShell>
    );
  }

  // No account lookup before the e-mail step: the first screen is the same for an
  // address with or without a RestoMatch account (security review: no oracle for
  // the inviting owner). The send action decides server-side: a code for a new
  // address, a sign-in link for an existing account.
  const session = await auth();
  const signedInAs = session?.user?.id ? (session.user.email ?? '') : null;
  const step = sp.step === 'code' ? 'code' : 'start';
  const errorKey = (ERROR_KEYS as readonly string[]).includes(sp.e ?? '') ? (sp.e as JoinErrorKey) : null;
  const errorText = errorKey ? t(`join.errors.${errorKey}`) : null;

  return (
    <AuthShell>
      <div className="mb-4 flex items-center gap-2 text-ink">
        <Users className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <h1 className="text-xl font-bold">{t('join.invitedTo', { restaurant: invite.restaurantName ?? '' })}</h1>
      </div>
      <div className="mb-6 space-y-1 text-base text-ink" data-testid="join-invite">
        <p data-testid="join-role">{t('join.asRole', { role: labelForRole(invite.role ?? '', locale === 'en' ? 'en' : 'he') })}</p>
        {invite.inviterName ? <p>{t('join.byInviter', { inviter: invite.inviterName })}</p> : null}
        <p className="text-muted">
          {t('join.toEmail', { email: '' })}
          <bdi dir="ltr">{invite.maskedEmail}</bdi>
        </p>
      </div>

      {errorText ? (
        <Notice tone="error" id="join-error" className="mb-4">
          {errorText}
        </Notice>
      ) : null}

      {signedInAs !== null ? (
        // Signed in already: the audited accept page checks the address match.
        <LinkButton href={joinAcceptPath(token)} className="min-h-12 w-full text-base" data-testid="join-signed-in">
          {t('join.signedInJoin', { email: signedInAs })}
        </LinkButton>
      ) : step === 'code' ? (
        <>
          {sp.sent ? (
            <Notice tone="neutral" className="mb-4">
              {t('join.codeSent', { email: invite.maskedEmail ?? '' })}
            </Notice>
          ) : null}
          <JoinCodeForm
            token={token}
            error={errorText ?? undefined}
            labels={{
              name: t('join.nameLabel'),
              nameHint: t('join.nameHint'),
              password: t('join.passwordLabel'),
              passwordHint: t('join.passwordHint'),
              code: t('join.codeLabel'),
              rememberMe: t('join.rememberMe'),
              submit: t('join.submit'),
              showPassword: t('signin.showPassword'),
              hidePassword: t('signin.hidePassword'),
            }}
          />
          <form action={sendJoinCodeAction} className="mt-3">
            <input type="hidden" name="token" value={token} />
            <SubmitButton variant="ghost" className="min-h-11 w-full text-sm">
              {t('join.resendCode')}
            </SubmitButton>
          </form>
        </>
      ) : (
        <form action={sendJoinCodeAction} className="space-y-4">
          <input type="hidden" name="token" value={token} />
          <p className="text-base text-ink">{t('join.stepCodeIntro')}</p>
          <SubmitButton className="min-h-12 w-full text-base" data-testid="join-send-code">
            {t('join.sendCode')}
          </SubmitButton>
        </form>
      )}
    </AuthShell>
  );
}
