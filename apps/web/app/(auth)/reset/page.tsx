import { MailCheck } from 'lucide-react';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { Field, Input } from '@/lib/components';
import { auth as authMessages } from '@/lib/i18n/messages/auth';
import { getT } from '@/lib/i18n/server';
import { MIN_PASSWORD_LENGTH } from '@/lib/passwordPolicy';
import { ResendButton } from '../../login/check-email/ResendButton';
import { decodeHint, maskEmail } from '../../login/hintCodec';
import { AuthShell, authTitle } from '../_components/AuthShell';
import { Notice } from '../_components/Notice';
import { PasswordInput } from '../_components/PasswordInput';
import { SubmitButton } from '../_components/SubmitButton';
import { requestPasswordResetAction, resetPasswordAction } from '../actions';
import { RESET_HINT_COOKIE, resetWaitSec } from './resetHint';

export const generateMetadata = () => authTitle('shell.titles.reset');

interface PageProps {
  searchParams: Promise<{ token?: string; sent?: string; error?: string; wait?: string }>;
}

export default async function ResetPage({ searchParams }: PageProps) {
  const { token, sent, error, wait } = await searchParams;
  const t = await getT(authMessages);
  // `wait` is a query param: only ever render a small integer from it.
  const minutes = Math.min(Math.max(Number.parseInt(wait ?? '', 10) || 15, 1), 120);

  // ── Mode 2: a reset token is present → choose a new password ──
  if (token) {
    const describedBy = ['password-hint', error ? 'reset-error' : ''].filter(Boolean).join(' ');
    return (
      <AuthShell>
        <h1 className="mb-2 text-2xl font-bold text-ink">{t('reset.chooseTitle')}</h1>
        <p className="mb-6 text-sm text-muted">{t('reset.chooseSubtitle')}</p>
        {error === 'mismatch' ? <Notice tone="error" id="reset-error">{t('reset.mismatch')}</Notice> : null}
        {error === 'policy' ? <Notice tone="error" id="reset-error">{t('reset.policy', { min: MIN_PASSWORD_LENGTH })}</Notice> : null}
        {error === 'token' ? (
          <Notice tone="error" id="reset-error">
            {t('reset.token')}{' '}
            <Link href="/reset" className="font-semibold underline">
              {t('reset.requestNew')}
            </Link>
          </Notice>
        ) : null}
        <form action={resetPasswordAction} className="space-y-4">
          <input type="hidden" name="token" value={token} />
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-muted">
              {t('reset.newPassword')}
            </label>
            {/* auth-23: the rule is said BEFORE typing, between label and field. */}
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
              showLabel={t('signin.showPassword')}
              hideLabel={t('signin.hidePassword')}
              aria-describedby={describedBy}
              aria-invalid={error === 'policy' || error === 'mismatch' || undefined}
            />
          </div>
          <Field label={t('reset.confirm')} htmlFor="confirm">
            <PasswordInput
              id="confirm"
              name="confirm"
              required
              autoComplete="new-password"
              dir="ltr"
              showLabel={t('signin.showPassword')}
              hideLabel={t('signin.hidePassword')}
              aria-invalid={error === 'mismatch' || undefined}
            />
          </Field>
          <SubmitButton data-keep-clear className="min-h-12 w-full text-base">
            {t('reset.chooseSubmit')}
          </SubmitButton>
        </form>
      </AuthShell>
    );
  }

  // ── Mode 1b: the link was requested → a dedicated "sent" state (auth-23) ──
  const hint = sent ? decodeHint((await cookies()).get(RESET_HINT_COOKIE)?.value) : null;
  if (sent) {
    return (
      <AuthShell>
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/12 text-primary ring-1 ring-primary/25">
            <MailCheck className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="mb-2 text-2xl font-bold text-ink">{t('resetFlow.sentTitle')}</h1>
          <p role="status" className="text-base text-ink">
            {hint ? t('resetFlow.sentTo', { email: maskEmail(hint.email) }) : t('resetFlow.sentGeneric')}
          </p>
          <p className="mt-3 text-sm text-muted">{t('mail.spam')}</p>
        </div>
        {hint ? (
          <form action={requestPasswordResetAction} className="mt-6">
            <input type="hidden" name="email" value={hint.email} />
            <ResendButton
              waitSec={resetWaitSec(hint.sentAt)}
              label={t('resetFlow.resend')}
              countdownTemplate={t('resetFlow.resendIn', { seconds: '{seconds}' })}
            />
          </form>
        ) : null}
        <p className="mt-6 flex flex-wrap justify-center gap-x-6 text-sm">
          <Link href="/reset" className="inline-flex min-h-11 items-center font-medium text-primary hover:underline">
            {t('resetFlow.otherEmail')}
          </Link>
          <Link href="/login" className="inline-flex min-h-11 items-center font-medium text-primary hover:underline">
            {t('reset.back')}
          </Link>
        </p>
      </AuthShell>
    );
  }

  // ── Mode 1: request a reset link ──
  return (
    <AuthShell>
      <h1 className="mb-2 text-2xl font-bold text-ink">{t('reset.requestTitle')}</h1>
      <p className="mb-6 text-sm text-muted">{t('reset.requestSubtitle')}</p>
      {error === 'rate' ? <Notice tone="error">{t('reset.rate', { minutes })}</Notice> : null}
      <form action={requestPasswordResetAction} className="space-y-4">
        <Field label={t('login.email')} htmlFor="email">
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            dir="ltr"
            className="min-h-11 text-base rtl:text-right"
            placeholder={t('login.emailPlaceholder')}
          />
        </Field>
        <SubmitButton data-keep-clear className="min-h-12 w-full text-base">
          {t('reset.requestSubmit')}
        </SubmitButton>
      </form>
      <p className="mt-6 text-center text-sm">
        <Link href="/login" className="inline-flex min-h-11 items-center font-medium text-primary hover:underline">
          {t('reset.back')}
        </Link>
      </p>
    </AuthShell>
  );
}
