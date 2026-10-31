import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { Field, Input } from '@/lib/components';
import { auth as authMessages } from '@/lib/i18n/messages/auth';
import { getT } from '@/lib/i18n/server';
import { safeRelativePath } from '@/lib/safeRedirect';
import { AuthShell, authTitle } from '../../(auth)/_components/AuthShell';
import { Notice } from '../../(auth)/_components/Notice';
import { SubmitButton } from '../../(auth)/_components/SubmitButton';
import { cancelTwoFactorAction, verifyTwoFactorAction } from './actions';

export const generateMetadata = () => authTitle('shell.titles.twoFactor');

interface PageProps {
  searchParams: Promise<{ error?: string; callbackUrl?: string; mode?: string }>;
}

/**
 * Second-factor (TOTP) screen — Epic C.1.
 *
 * The session-layer 2FA gate (middleware + auth.config) routes a 2FA-enrolled
 * user here after their FIRST factor (password OR magic-link). This page only
 * accepts the second factor; the server action verifies a TOTP code (±1 step) or
 * a one-time recovery code and clears the pending flag. Inert for users without
 * 2FA enrolled (the gate never sends them here). The original destination (e.g.
 * an invite-accept link) rides along as a validated callbackUrl.
 *
 * auth-08: recovery codes are letters + digits (`xxxxx-xxxxx`), so they get
 * their own mode with a TEXT keyboard — a numeric keypad can't type them. The
 * verifier is the same either way (it accepts both kinds).
 */
export default async function TwoFactorPage({ searchParams }: PageProps) {
  const session = await auth();
  const { error, callbackUrl, mode } = await searchParams;
  const next = safeRelativePath(callbackUrl);
  // Not signed in at all → start over. Already past the gate → go on.
  if (!session?.user?.id) redirect('/login');
  if (!session.user.twoFactorPending) redirect(next);

  const t = await getT(authMessages);
  const recovery = mode === 'recovery';
  const otherMode = new URLSearchParams({ callbackUrl: next });
  if (!recovery) otherMode.set('mode', 'recovery');

  return (
    <AuthShell>
      <h1 className="mb-2 text-2xl font-bold text-ink">{t('twoFactor.title')}</h1>
      <p className="mb-6 text-sm text-muted">{recovery ? t('recovery.subtitle') : t('twoFactor.subtitle')}</p>

      {error ? (
        <Notice tone="error" id="code-error">
          {t('twoFactor.error')}
        </Notice>
      ) : null}

      <form action={verifyTwoFactorAction} className="space-y-4">
        <input type="hidden" name="callbackUrl" value={next} />
        {recovery ? <input type="hidden" name="mode" value="recovery" /> : null}
        {recovery ? (
          <Field label={t('recovery.label')} htmlFor="code" hint={t('recovery.hint')}>
            <Input
              id="code"
              name="code"
              type="text"
              inputMode="text"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              required
              maxLength={32}
              placeholder="abcde-fgh23"
              dir="ltr"
              className="min-h-11 text-base tracking-wider"
              aria-describedby={error ? 'code-hint code-error' : 'code-hint'}
              aria-invalid={error ? true : undefined}
            />
          </Field>
        ) : (
          <Field label={t('twoFactor.codeLabel')} htmlFor="code">
            <Input
              id="code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              required
              maxLength={8}
              placeholder="123456"
              dir="ltr"
              className="min-h-11 text-base tracking-widest"
              aria-describedby={error ? 'code-error' : undefined}
              aria-invalid={error ? true : undefined}
            />
          </Field>
        )}
        <SubmitButton data-keep-clear className="min-h-12 w-full text-base">
          {t('twoFactor.submit')}
        </SubmitButton>
      </form>

      <p className="mt-4 text-center">
        <Link
          href={`/login/2fa?${otherMode.toString()}`}
          className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
          data-testid="twofa-mode-toggle"
        >
          {recovery ? t('recovery.useApp') : t('recovery.useRecovery')}
        </Link>
      </p>

      <form action={cancelTwoFactorAction} className="mt-2 text-center">
        <button type="submit" className="inline-flex min-h-11 items-center text-sm text-muted hover:text-ink hover:underline">
          {t('twoFactor.switchAccount')}
        </button>
      </form>
    </AuthShell>
  );
}
