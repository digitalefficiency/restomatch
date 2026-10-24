import { AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { Button, Card, Field, Input } from '@/lib/components';
import { auth as authMessages } from '@/lib/i18n/messages/auth';
import { getT } from '@/lib/i18n/server';
import { hasPassword } from '@/lib/passwords';
import { MIN_PASSWORD_LENGTH } from '@/lib/passwordPolicy';
import { changePasswordAction, setPasswordAction } from '../actions';

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

  return (
    <main className="flex min-h-screen items-center justify-center p-6 pb-[calc(1.5rem+var(--consent-h,0px))]">
      <Card elevated flow padding="lg" className="w-full max-w-md">
        <h1 className="mb-2 text-2xl font-bold text-ink">
          {existing ? t('setPassword.titleChange') : t('setPassword.titleSet')}
        </h1>
        <p className="mb-6 text-sm text-muted">
          {existing ? t('setPassword.subtitleChange') : t('setPassword.subtitleSet')}
        </p>

        {changed ? (
          <div
            role="status"
            className="mb-4 rounded-md border-s-4 border-success bg-success/5 px-3 py-2 text-sm text-success"
          >
            {t('setPassword.changed')}
          </div>
        ) : null}
        {error ? (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2 rounded-md border-s-4 border-danger bg-danger/5 px-3 py-2 text-sm text-danger"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t(errorKey(error), { min: MIN_PASSWORD_LENGTH })}</span>
          </div>
        ) : null}

        <form action={existing ? changePasswordAction : setPasswordAction} className="space-y-4">
          {existing ? (
            <Field label={t('setPassword.current')} htmlFor="current">
              <Input
                id="current"
                name="current"
                type="password"
                required
                dir="ltr"
                autoComplete="current-password"
              />
            </Field>
          ) : null}
          <Field
            label={t('setPassword.newPassword')}
            htmlFor="password"
            hint={t('setPassword.hint', { min: MIN_PASSWORD_LENGTH })}
          >
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
          <Field label={t('setPassword.confirm')} htmlFor="confirm">
            <Input id="confirm" name="confirm" type="password" required dir="ltr" autoComplete="new-password" />
          </Field>
          <Button type="submit" data-keep-clear className="w-full">
            {existing ? t('setPassword.submitChange') : t('setPassword.submitSet')}
          </Button>
        </form>
        <p className="mt-6 text-center text-xs">
          <Link href="/dashboard/settings" className="text-brand hover:underline">
            {t('setPassword.back')}
          </Link>
        </p>
      </Card>
    </main>
  );
}
