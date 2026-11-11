import { AuthError } from 'next-auth';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { signIn } from '@/auth';
import { auth as authMessages } from '@/lib/i18n/messages/auth';
import { getT } from '@/lib/i18n/server';
import { twoFactorEnabledForEmail } from '@/lib/passwords';
import { safeRelativePath } from '@/lib/safeRedirect';
import { AuthShell, authTitle } from '../../(auth)/_components/AuthShell';
import { Notice } from '../../(auth)/_components/Notice';
import { SubmitButton } from '../../(auth)/_components/SubmitButton';
import { codeLoginErrorCode } from '../_lib/codeErrors';
import { requestLoginCode } from '../_lib/sendLoginCode';
import { clearHint, readHint, writeHint } from '../hint';
import { maskEmail, resendWaitSec } from '../hintCodec';
import { LoginCodeForm } from './LoginCodeForm';

export const dynamic = 'force-dynamic';
export const generateMetadata = () => authTitle('shell.titles.checkEmail');

/**
 * W3-07b slice b: enter the 6-digit sign-in code. The address comes from the
 * httpOnly sign-in hint (never the URL). Verification runs in the `email-code`
 * Credentials provider (auth.ts): limiter + durable ceilings there. A locked
 * or throttled attempt says so, without inviting a new code (M5).
 */
export default async function LoginCodePage({ searchParams }: { searchParams: Promise<{ e?: string; resent?: string }> }) {
  const [{ e, resent }, t, hint] = await Promise.all([searchParams, getT(authMessages), readHint()]);
  if (!hint) redirect('/login');
  const locked = e === 'rate';

  async function verifyAction(formData: FormData) {
    'use server';
    const h = await readHint();
    if (!h) redirect('/login');
    const next = safeRelativePath(h.next);
    try {
      await signIn('email-code', {
        email: h.email,
        code: String(formData.get('code') ?? ''),
        rememberMe: formData.get('rememberMe') === 'on' ? 'true' : 'false',
        redirect: false,
      });
    } catch (err) {
      if (err instanceof AuthError) redirect(`/login/code?e=${codeLoginErrorCode(err)}`);
      throw err;
    }
    await clearHint();
    if (await twoFactorEnabledForEmail(h.email)) redirect(`/login/2fa?callbackUrl=${encodeURIComponent(next)}`);
    redirect(next);
  }

  async function resendAction() {
    'use server';
    const h = await readHint();
    if (!h) redirect('/login');
    // UX countdown only (cookie); the real limits are inside requestLoginCode.
    if (resendWaitSec(h.sentAt) > 0) redirect('/login/code');
    if (!(await requestLoginCode(h.email))) redirect('/login/code?e=rate');
    await writeHint({ ...h, sentAt: Date.now() });
    redirect('/login/code?resent=1');
  }

  return (
    <AuthShell>
      <h1 className="mb-2 text-2xl font-bold text-ink">{t('codeLogin.title')}</h1>
      <p className="text-base text-ink" data-testid="login-code-sent">
        {t('codeLogin.sentTo')}
      </p>
      <p className="mb-2 text-base font-semibold text-ink">
        <bdi dir="ltr" data-testid="login-code-email">
          {maskEmail(hint.email)}
        </bdi>
      </p>
      <p className="mb-6 text-sm text-muted">{t('codeLogin.validFor')}</p>
      {resent && !e ? (
        <Notice tone="success" className="mb-4">
          {t('codeLogin.resent')}
        </Notice>
      ) : null}
      {e ? (
        <Notice tone="error" id="login-code-error" className="mb-4">
          {locked ? t('codeLogin.errors.rate') : t('codeLogin.errors.wrongCode')}
        </Notice>
      ) : null}
      <LoginCodeForm
        action={verifyAction}
        error={Boolean(e)}
        disabled={locked}
        labels={{ code: t('codeLogin.codeLabel'), submit: t('codeLogin.submit'), rememberMe: t('login.rememberMe') }}
      />
      {locked ? null : (
        <form action={resendAction} className="mt-3">
          <SubmitButton variant="ghost" className="min-h-11 w-full text-sm" data-testid="login-code-resend">
            {t('codeLogin.resend')}
          </SubmitButton>
        </form>
      )}
      <p className="mt-6 text-center text-sm">
        <Link href="/login" className="inline-flex min-h-11 items-center font-medium text-primary hover:underline">
          {t('codeLogin.useOther')}
        </Link>
      </p>
    </AuthShell>
  );
}
