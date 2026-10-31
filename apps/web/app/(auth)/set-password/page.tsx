import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { Field } from '@/lib/components';
import { auth as authMessages } from '@/lib/i18n/messages/auth';
import { getT } from '@/lib/i18n/server';
import { hasPassword } from '@/lib/passwords';
import { MIN_PASSWORD_LENGTH } from '@/lib/passwordPolicy';
import { AuthShell, authTitle } from '../_components/AuthShell';
import { Notice } from '../_components/Notice';
import { PasswordInput } from '../_components/PasswordInput';
import { SubmitButton } from '../_components/SubmitButton';
import { changePasswordAction, setPasswordAction } from '../actions';

export const generateMetadata = () => authTitle('shell.titles.setPassword');

interface PageProps {
  searchParams: Promise<{ error?: string; changed?: string }>;
}

function errorKey(error: string) {
  switch (error) {
    case 'mismatch':
      return 'setPassword.errors.mismatch' as const;
    case 'policy':
      return 'setPassword.errors.policy' as const;
    case 'current':
      return 'setPassword.errors.current' as const;
    default:
      return 'setPassword.errors.generic' as const;
  }
}

export default async function SetPasswordPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login?callbackUrl=/set-password');
  // A 2FA-pending session may not touch credentials (the actions re-check too).
  if (session.user.twoFactorPending) redirect('/login/2fa?callbackUrl=/set-password');
  const { error, changed } = await searchParams;
  const existing = await hasPassword(session.user.id);
  const t = await getT(authMessages);

  const eye = { showLabel: t('signin.showPassword'), hideLabel: t('signin.hidePassword') };
  return (
    <AuthShell>
      <h1 className="mb-2 text-2xl font-bold text-ink">
        {existing ? t('setPassword.titleChange') : t('setPassword.titleSet')}
      </h1>
      <p className="mb-6 text-sm text-muted">
        {existing ? t('setPassword.subtitleChange') : t('setPassword.subtitleSet')}
      </p>

      {changed ? <Notice tone="success">{t('setPassword.changed')}</Notice> : null}
      {error ? (
        <Notice tone="error" id="password-error">
          {t(errorKey(error), { min: MIN_PASSWORD_LENGTH })}
        </Notice>
      ) : null}

      <form action={existing ? changePasswordAction : setPasswordAction} className="space-y-4">
        {existing ? (
          <Field label={t('setPassword.current')} htmlFor="current">
            <PasswordInput
              id="current"
              name="current"
              required
              dir="ltr"
              autoComplete="current-password"
              aria-invalid={error === 'current' || undefined}
              {...eye}
            />
          </Field>
        ) : null}
        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium text-muted">
            {t('setPassword.newPassword')}
          </label>
          <p id="password-hint" className="mb-1.5 text-sm text-muted">
            {t('setPassword.hint', { min: MIN_PASSWORD_LENGTH })}
          </p>
          <PasswordInput
            id="password"
            name="password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            dir="ltr"
            aria-describedby={error ? 'password-hint password-error' : 'password-hint'}
            aria-invalid={error === 'policy' || error === 'mismatch' || undefined}
            {...eye}
          />
        </div>
        <Field label={t('setPassword.confirm')} htmlFor="confirm">
          <PasswordInput id="confirm" name="confirm" required dir="ltr" autoComplete="new-password" {...eye} />
        </Field>
        <SubmitButton data-keep-clear className="min-h-12 w-full text-base">
          {existing ? t('setPassword.submitChange') : t('setPassword.submitSet')}
        </SubmitButton>
      </form>
      <p className="mt-6 text-center text-sm">
        <Link href="/dashboard/settings" className="inline-flex min-h-11 items-center font-medium text-primary hover:underline">
          {t('setPassword.back')}
        </Link>
      </p>
    </AuthShell>
  );
}
