import { AlertCircle } from 'lucide-react';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { Button, Card, Field, Input } from '@/lib/components';
import { auth as authMessages } from '@/lib/i18n/messages/auth';
import { getT } from '@/lib/i18n/server';
import { safeRelativePath } from '@/lib/safeRedirect';
import { cancelTwoFactorAction, verifyTwoFactorAction } from './actions';

interface PageProps {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
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
 */
export default async function TwoFactorPage({ searchParams }: PageProps) {
  const session = await auth();
  const { error, callbackUrl } = await searchParams;
  const next = safeRelativePath(callbackUrl);
  // Not signed in at all → start over. Already past the gate → go on.
  if (!session?.user?.id) redirect('/login');
  if (!session.user.twoFactorPending) redirect(next);

  const t = await getT(authMessages);

  return (
    <main className="flex min-h-screen items-center justify-center p-6 pb-[calc(1.5rem+var(--consent-h,0px))]">
      <Card elevated flow padding="lg" className="w-full max-w-md">
        <h1 className="mb-2 text-2xl font-bold text-ink">{t('twoFactor.title')}</h1>
        <p className="mb-6 text-sm text-muted">{t('twoFactor.subtitle')}</p>

        {error ? (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2 rounded-md border-s-4 border-danger bg-danger/5 px-3 py-2 text-sm text-danger"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t('twoFactor.error')}</span>
          </div>
        ) : null}

        <form action={verifyTwoFactorAction} className="space-y-4">
          <input type="hidden" name="callbackUrl" value={next} />
          <Field label={t('twoFactor.codeLabel')} htmlFor="code">
            <Input
              id="code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              required
              placeholder="123456"
              dir="ltr"
            />
          </Field>
          <Button type="submit" data-keep-clear className="w-full">
            {t('twoFactor.submit')}
          </Button>
        </form>

        <form action={cancelTwoFactorAction} className="mt-4 text-center">
          <button type="submit" className="text-sm text-primary hover:underline">
            {t('twoFactor.switchAccount')}
          </button>
        </form>
      </Card>
    </main>
  );
}
