import { AlertCircle } from 'lucide-react';
import { AuthError } from 'next-auth';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { signIn } from '@/auth';
import { Button, Card, Field, Input } from '@/lib/components';
import { featureEnabled } from '@restomatch/api';
import { LanguagePicker } from '@/lib/i18n/LanguagePicker';
import { LocaleSwitcher } from '@/lib/i18n/LocaleSwitcher';
import { auth as authMessages } from '@/lib/i18n/messages/auth';
import { getT } from '@/lib/i18n/server';
import { twoFactorEnabledForEmail } from '@/lib/passwords';
import { safeRelativePath } from '@/lib/safeRedirect';

interface PageProps {
  searchParams: Promise<{
    callbackUrl?: string;
    error?: string;
    email?: string;
    sent?: string;
    reset?: string;
    signedOut?: string;
  }>;
}

/** Auth.js / our own `?error=` codes → message keys. Unknown codes → generic. */
function errorKey(error: string) {
  switch (error) {
    case 'Verification':
      return 'login.errors.verification' as const;
    case 'CredentialsSignin':
      return 'login.errors.credentials' as const;
    case 'rate':
      return 'login.errors.rate' as const;
    case 'EmailSignin':
    case 'EmailSignInError':
    // sendVerificationRequest throwing (the per-mailbox throttle) surfaces as
    // Auth.js "Configuration" — the only server-side failure of that send.
    case 'Configuration':
      return 'login.errors.emailSignin' as const;
    default:
      return 'login.errors.generic' as const;
  }
}

/** Back to /login with an error, keeping callbackUrl (e.g. an invite token) + locked email. */
function back(code: string, redirectTo: string, lockedEmail: string | undefined): string {
  const qs = new URLSearchParams({ error: code });
  if (redirectTo !== '/dashboard') qs.set('callbackUrl', redirectTo);
  if (lockedEmail) qs.set('email', lockedEmail);
  return `/login?${qs.toString()}`;
}

export default async function LoginPage({ searchParams }: PageProps) {
  const { callbackUrl, error, email: invitedEmail, sent, reset, signedOut } = await searchParams;
  const t = await getT(authMessages);
  // Open-redirect guard (D1.7) — the shared, unit-tested same-origin path check.
  const redirectTo = safeRelativePath(callbackUrl);
  // When arriving from an invite link, the address is fixed (acceptInvite is
  // bound to it) — prefill + lock it so an alias/typo can't dead-end the accept.
  const lockedEmail = invitedEmail?.trim() || undefined;

  // Password login (PRIMARY). signIn() handles CSRF internally — never hand-roll
  // a POST to the callback. On bad credentials Auth.js throws CredentialsSignin;
  // we surface a UNIFORM message (no account enumeration).
  async function passwordAction(formData: FormData) {
    'use server';
    const email = String(formData.get('email') ?? '').trim();
    const password = String(formData.get('password') ?? '');
    const rememberMe = formData.get('rememberMe') === 'on';
    if (!email || !password) redirect(back('CredentialsSignin', redirectTo, lockedEmail));
    // The email+IP login throttle lives INSIDE the Credentials authorize()
    // callback (auth.ts) so it is enforced on EVERY entry point — including a
    // script POSTing straight to /api/auth/callback/credentials. Enforcing it
    // here too would double-count the limiter, so it is intentionally not
    // repeated. A throttled/wrong attempt surfaces the same CredentialsSignin.
    try {
      // redirect:false — we pick the destination ourselves (below).
      await signIn('credentials', { email, password, rememberMe, redirect: false });
    } catch (err) {
      if (err instanceof AuthError) redirect(back('CredentialsSignin', redirectTo, lockedEmail));
      throw err;
    }
    // First factor passed. A 2FA-enrolled user goes straight to the second step
    // (with the original destination) so the URL matches the screen; otherwise
    // the middleware would bounce /dashboard and the bar would keep "/dashboard".
    if (await twoFactorEnabledForEmail(email)) {
      redirect(`/login/2fa?callbackUrl=${encodeURIComponent(redirectTo)}`);
    }
    redirect(redirectTo);
  }

  // Magic-link (BACKUP). Always available — every existing user (who has no
  // password) keeps logging in this way. A throttled send (sendMagicLink throws)
  // surfaces as an AuthError → friendly message instead of the error page.
  async function magicLinkAction(formData: FormData) {
    'use server';
    const email = String(formData.get('email') ?? '').trim();
    if (!email) return;
    try {
      await signIn('nodemailer', { email, redirectTo });
    } catch (err) {
      if (err instanceof AuthError) redirect(back('EmailSignin', redirectTo, lockedEmail));
      throw err; // the success NEXT_REDIRECT → /login/check-email
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center p-6">
      <div className="absolute end-4 top-4">
        {/* Receiver languages (S14): a receiver picks ar/ru/th/ti before signing in
            (only the FEATURES_OFF kill-switch applies — no restaurant yet). */}
        {featureEnabled({ features: { receiverLanguages: true } }, 'receiverLanguages') ? (
          <LanguagePicker />
        ) : (
          <LocaleSwitcher />
        )}
      </div>
      <Card elevated flow padding="lg" className="w-full max-w-md">
        <h1 className="mb-2 text-2xl font-bold text-ink">{t('login.title')}</h1>
        <p className="mb-6 text-sm text-muted">{t('login.subtitle')}</p>

        {error ? (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2 rounded-md border-s-4 border-danger bg-danger/5 px-3 py-2 text-sm text-danger"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t(errorKey(error))}</span>
          </div>
        ) : null}

        {sent || reset || signedOut ? (
          <div
            role="status"
            className="mb-4 rounded-md border-s-4 border-success bg-success/5 px-3 py-2 text-sm text-success"
          >
            {reset ? t('login.resetDone') : signedOut ? t('login.signedOut') : t('login.sent')}
          </div>
        ) : null}

        {/* PRIMARY — email + password */}
        <form action={passwordAction} className="space-y-4">
          <Field
            label={t('login.email')}
            htmlFor="email"
            hint={lockedEmail ? t('login.invitedHint') : undefined}
          >
            <Input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              dir="ltr"
              placeholder={t('login.emailPlaceholder')}
              defaultValue={lockedEmail}
              readOnly={!!lockedEmail}
            />
          </Field>
          <Field label={t('login.password')} htmlFor="password">
            <Input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              dir="ltr"
              placeholder="••••••••"
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" name="rememberMe" className="h-4 w-4 accent-brand" />
            {t('login.rememberMe')}
          </label>
          <Button type="submit" className="w-full">
            {t('login.submit')}
          </Button>
        </form>

        <div className="my-5 flex items-center gap-3 text-xs text-subtle">
          <span className="h-px flex-1 bg-border" />
          {t('login.or')}
          <span className="h-px flex-1 bg-border" />
        </div>

        {/* BACKUP — magic link */}
        <form action={magicLinkAction} className="space-y-3">
          <Input
            aria-label={t('login.magicLabel')}
            name="email"
            type="email"
            required
            autoComplete="email"
            dir="ltr"
            placeholder={t('login.emailPlaceholder')}
            defaultValue={lockedEmail}
            readOnly={!!lockedEmail}
          />
          <Button type="submit" variant="secondary" className="w-full">
            {t('login.magicSubmit')}
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-subtle">
          <Link href="/reset" className="text-brand hover:underline">
            {t('login.forgot')}
          </Link>
        </p>
      </Card>
    </main>
  );
}
