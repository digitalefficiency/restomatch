import { AuthError } from 'next-auth';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth, signIn, signOut } from '@/auth';
import { Field, Input, LinkButton } from '@/lib/components';
import { auth as authMessages } from '@/lib/i18n/messages/auth';
import { getT } from '@/lib/i18n/server';
import { twoFactorEnabledForEmail } from '@/lib/passwords';
import { safeRelativePath } from '@/lib/safeRedirect';
import { AuthShell, authTitle } from '../(auth)/_components/AuthShell';
import { Notice } from '../(auth)/_components/Notice';
import { PasswordInput } from '../(auth)/_components/PasswordInput';
import { OutsideSubmitButton } from '../(auth)/_components/OutsideSubmitButton';
import { SubmitButton } from '../(auth)/_components/SubmitButton';
import { PwaSessionGuard } from '@/lib/pwa/PwaSessionGuard';
import { TrpcProvider } from '@/lib/trpc/client';
import { LOGOUT_FORM_ATTR } from '@/lib/pwa/offlineQueue';
import { clearHint, readHint, writeHint } from './hint';
import { FALLBACK_AFTER_FAILS } from './hintCodec';
import { QueuedPhotosNote } from './QueuedPhotosNote';

export const generateMetadata = () => authTitle('shell.titles.login');

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
    case 'EmailMissing':
      return 'signin.emailMissing' as const;
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
  // Open-redirect guard (D1.7) — the shared, unit-tested same-origin path check.
  const redirectTo = safeRelativePath(callbackUrl);
  // When arriving from an invite link, the address is fixed (acceptInvite is
  // bound to it) — prefill + lock it so an alias/typo can't dead-end the accept.
  const lockedEmail = invitedEmail?.trim() || undefined;

  // auth-26: a fully signed-in user is not asked to sign in again. With a
  // destination (an invite to a 2nd restaurant, a deep link) they go straight
  // there; without one they get "continue / switch user". A 2FA-pending session
  // keeps the form (it may want to switch account).
  const session = await auth();
  const signedInEmail = session?.user?.id && !session.user.twoFactorPending ? (session.user.email ?? '') : null;
  if (signedInEmail !== null && callbackUrl && !redirectTo.startsWith('/login')) redirect(redirectTo);

  const [t, hint] = await Promise.all([getT(authMessages), readHint()]);
  // auth-06: a wrong password keeps the typed address (from the httpOnly hint,
  // never the URL) and puts the cursor back in the password field. Only right
  // after a failed attempt: on a shared device the next person (or a page after
  // sign-out) never sees the previous person's address.
  const prefill = lockedEmail ?? (error === 'CredentialsSignin' ? hint?.email : undefined);
  const wrongPassword = error === 'CredentialsSignin';
  const offerFallback = wrongPassword && (hint?.fails ?? 0) >= FALLBACK_AFTER_FAILS;

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
      if (err instanceof AuthError) {
        // The count is per browser and only drives the UI (the email-link
        // fallback); the real throttle + lockout stay in authorize().
        const prev = await readHint();
        const fails = prev && prev.email === email ? prev.fails + 1 : 1;
        await writeHint({ email, fails, sentAt: prev?.sentAt ?? null, next: prev?.next ?? null });
        redirect(back('CredentialsSignin', redirectTo, lockedEmail));
      }
      throw err;
    }
    await clearHint();
    // First factor passed. A 2FA-enrolled user goes straight to the second step
    // (with the original destination) so the URL matches the screen; otherwise
    // the middleware would bounce /dashboard and the bar would keep "/dashboard".
    if (await twoFactorEnabledForEmail(email)) {
      redirect(`/login/2fa?callbackUrl=${encodeURIComponent(redirectTo)}`);
    }
    redirect(redirectTo);
  }

  // Magic-link (BACKUP). Always available — every existing user (who has no
  // password) keeps logging in this way. The SAME email field feeds it (the
  // button's formAction). A throttled send (sendMagicLink throws) surfaces as an
  // AuthError → friendly message instead of the error page.
  async function magicLinkAction(formData: FormData) {
    'use server';
    const email = String(formData.get('email') ?? '').trim();
    if (!email) redirect(back('EmailMissing', redirectTo, lockedEmail));
    // "Check your email" shows the (masked) address and times the resend.
    await writeHint({ email, fails: 0, sentAt: Date.now(), next: redirectTo });
    try {
      // redirect:false — go straight to our page instead of hopping through
      // /api/auth/verify-request (a route-handler redirect a server action's
      // soft navigation can stall on).
      await signIn('nodemailer', { email, redirectTo, redirect: false });
    } catch (err) {
      if (err instanceof AuthError) redirect(back('EmailSignin', redirectTo, lockedEmail));
      throw err;
    }
    redirect('/login/check-email');
  }

  async function switchUserAction() {
    'use server';
    await clearHint();
    await signOut({ redirectTo: '/login' });
  }

  if (signedInEmail !== null) {
    return (
      <AuthShell>
        <h1 className="mb-2 text-2xl font-bold text-ink">{t('login.title')}</h1>
        <p className="mb-6 text-sm text-muted">{t('signin.signedInAs', { email: signedInEmail })}</p>
        <LinkButton href={redirectTo} className="min-h-12 w-full text-base">
          {t('signin.continue')}
        </LinkButton>
        {/* An explicit sign-out: the same shared-device rule as the dashboard
            (PwaSessionGuard uploads this user's queued photos first, or asks
            before deleting any). The guard uploads through tRPC, and /login
            sits outside the dashboard's provider, so it brings its own. */}
        <TrpcProvider>
          <PwaSessionGuard userId={session!.user!.id!} />
          <form action={switchUserAction} className="mt-3" {...{ [LOGOUT_FORM_ATTR]: '' }}>
            <SubmitButton variant="secondary" className="min-h-12 w-full text-base">
              {t('signin.switchUser')}
            </SubmitButton>
          </form>
        </TrpcProvider>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <h1 className="mb-2 text-2xl font-bold text-ink">{t('login.title')}</h1>
      <p className="mb-6 text-sm text-muted">{t('login.subtitle')}</p>

      <QueuedPhotosNote />

      {error && !offerFallback ? (
        <Notice tone="error" id="login-error">
          {t(errorKey(error))}
        </Notice>
      ) : null}

      {sent || reset || signedOut ? (
        <Notice tone="success">{reset ? t('login.resetDone') : signedOut ? t('login.signedOut') : t('login.sent')}</Notice>
      ) : null}

      {offerFallback ? (
        // auth-25: after repeated failures, say that sign-in locks and offer
        // the passwordless way in — same uniform text, no enumeration.
        <Notice tone="error" id="login-error">
          <p>{t('login.errors.credentials')}</p>
          <p className="mt-1 text-ink">{t('signin.lockoutHint')}</p>
          <OutsideSubmitButton
            form="login-form"
            variant="secondary"
            formAction={magicLinkAction}
            formNoValidate
            className="mt-2 min-h-11 w-full"
            data-testid="magic-fallback"
          >
            {t('signin.magicFallback')}
          </OutsideSubmitButton>
        </Notice>
      ) : null}

      {/* ONE form, ONE email field (auth-05). The password submit is the form's
          ONLY in-tree submit, so Enter always tries the password; the email-link
          buttons sit outside and join the same form through form="login-form". */}
      <form id="login-form" action={passwordAction} className="space-y-4">
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
            autoComplete="username"
            dir="ltr"
            className="min-h-11 text-base rtl:text-right"
            placeholder={t('login.emailPlaceholder')}
            defaultValue={prefill}
            readOnly={!!lockedEmail}
            aria-describedby={lockedEmail ? 'email-hint' : undefined}
          />
        </Field>
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <label htmlFor="password" className="block text-sm font-medium text-muted">
              {t('login.password')}
            </label>
            <Link href="/reset" className="inline-flex min-h-6 items-center text-sm font-medium text-primary hover:underline">
              {t('signin.forgotShort')}
            </Link>
          </div>
          <PasswordInput
            id="password"
            name="password"
            required
            autoComplete="current-password"
            dir="ltr"
            className="rtl:text-right"
            showLabel={t('signin.showPassword')}
            hideLabel={t('signin.hidePassword')}
            autoFocus={wrongPassword}
            aria-invalid={wrongPassword || undefined}
            aria-describedby={wrongPassword ? 'login-error' : undefined}
          />
        </div>
        <label className="flex min-h-11 items-center gap-3 text-sm text-ink">
          <input type="checkbox" name="rememberMe" className="h-5 w-5 accent-primary" />
          {t('login.rememberMe')}
        </label>
        <SubmitButton className="min-h-12 w-full text-base">
          {t('login.submit')}
        </SubmitButton>
      </form>

      <div className="my-4 flex items-center gap-3 text-xs text-muted" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        {t('login.or')}
        <span className="h-px flex-1 bg-line" />
      </div>

      {/* data-keep-clear on the LOWER of the two sign-in buttons: the cookie
          bar waits until it is scrolled clear, so both stay tappable (auth-31). */}
      <OutsideSubmitButton
        form="login-form"
        variant="secondary"
        formAction={magicLinkAction}
        formNoValidate
        data-keep-clear
        className="min-h-12 w-full text-base"
      >
        {t('login.magicSubmit')}
      </OutsideSubmitButton>

      <p className="mt-6 text-center text-sm text-muted">
        {t('signin.newHere')}{' '}
        <Link href="/showcase" className="font-medium text-primary hover:underline">
          {t('signin.demo')}
        </Link>
      </p>
    </AuthShell>
  );
}
