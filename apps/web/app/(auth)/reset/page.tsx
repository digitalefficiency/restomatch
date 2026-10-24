import { AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { Button, Card, Field, Input } from '@/lib/components';
import { LocaleSwitcher } from '@/lib/i18n/LocaleSwitcher';
import { auth as authMessages } from '@/lib/i18n/messages/auth';
import { getT } from '@/lib/i18n/server';
import { MIN_PASSWORD_LENGTH } from '@/lib/passwordPolicy';
import { requestPasswordResetAction, resetPasswordAction } from '../actions';

interface PageProps {
  searchParams: Promise<{ token?: string; sent?: string; error?: string; wait?: string }>;
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="mb-4 flex items-start gap-2 rounded-md border-s-4 border-danger bg-danger/5 px-3 py-2 text-sm text-danger"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

export default async function ResetPage({ searchParams }: PageProps) {
  const { token, sent, error, wait } = await searchParams;
  const t = await getT(authMessages);
  // `wait` is a query param: only ever render a small integer from it.
  const minutes = Math.min(Math.max(Number.parseInt(wait ?? '', 10) || 15, 1), 120);

  // ── Mode 2: a reset token is present → choose a new password ──
  if (token) {
    return (
      <main className="relative flex min-h-screen items-center justify-center p-6">
        <div className="absolute end-4 top-4">
          <LocaleSwitcher />
        </div>
        <Card elevated flow padding="lg" className="w-full max-w-md">
          <h1 className="mb-2 text-2xl font-bold text-ink">{t('reset.chooseTitle')}</h1>
          <p className="mb-6 text-sm text-muted">{t('reset.chooseSubtitle')}</p>
          {error === 'mismatch' ? <ErrorBox>{t('reset.mismatch')}</ErrorBox> : null}
          {error === 'policy' ? <ErrorBox>{t('reset.policy', { min: MIN_PASSWORD_LENGTH })}</ErrorBox> : null}
          {error === 'token' ? (
            <ErrorBox>
              {t('reset.token')}{' '}
              <Link href="/reset" className="font-semibold underline">
                {t('reset.requestNew')}
              </Link>
            </ErrorBox>
          ) : null}
          <form action={resetPasswordAction} className="space-y-4">
            <input type="hidden" name="token" value={token} />
            <Field label={t('reset.newPassword')} htmlFor="password">
              <Input
                id="password"
                name="password"
                type="password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                autoComplete="new-password"
                dir="ltr"
                placeholder="••••••••••"
              />
            </Field>
            <Field label={t('reset.confirm')} htmlFor="confirm">
              <Input
                id="confirm"
                name="confirm"
                type="password"
                required
                autoComplete="new-password"
                dir="ltr"
                placeholder="••••••••••"
              />
            </Field>
            <Button type="submit" className="w-full">
              {t('reset.chooseSubmit')}
            </Button>
          </form>
        </Card>
      </main>
    );
  }

  // ── Mode 1: request a reset link ──
  return (
    <main className="relative flex min-h-screen items-center justify-center p-6">
      <div className="absolute end-4 top-4">
        <LocaleSwitcher />
      </div>
      <Card elevated flow padding="lg" className="w-full max-w-md">
        <h1 className="mb-2 text-2xl font-bold text-ink">{t('reset.requestTitle')}</h1>
        <p className="mb-6 text-sm text-muted">{t('reset.requestSubtitle')}</p>
        {sent ? (
          <div
            role="status"
            className="mb-4 rounded-md border-s-4 border-success bg-success/5 px-3 py-2 text-sm text-success"
          >
            {t('reset.sent')}
          </div>
        ) : null}
        {error === 'rate' ? <ErrorBox>{t('reset.rate', { minutes })}</ErrorBox> : null}
        <form action={requestPasswordResetAction} className="space-y-4">
          <Field label={t('login.email')} htmlFor="email">
            <Input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              dir="ltr"
              placeholder={t('login.emailPlaceholder')}
            />
          </Field>
          <Button type="submit" className="w-full">
            {t('reset.requestSubmit')}
          </Button>
        </form>
        <p className="mt-6 text-center text-xs text-subtle">
          <Link href="/login" className="text-primary hover:underline">
            {t('reset.back')}
          </Link>
        </p>
      </Card>
    </main>
  );
}
