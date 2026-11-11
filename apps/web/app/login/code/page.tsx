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
import { clearHint, readHint } from '../hint';
import { maskEmail } from '../hintCodec';
import { LoginCodeForm } from './LoginCodeForm';

export const dynamic = 'force-dynamic';
export const generateMetadata = () => authTitle('shell.titles.checkEmail');

/**
 * W3-07b slice b: enter the 6-digit sign-in code. The address comes from the
 * httpOnly sign-in hint (never the URL). Verification runs in the `email-code`
 * Credentials provider (auth.ts) — limiter + durable 5-try ceiling there.
 */
export default async function LoginCodePage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const [{ e }, t, hint] = await Promise.all([searchParams, getT(authMessages), readHint()]);
  if (!hint) redirect('/login');

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
      if (err instanceof AuthError) redirect('/login/code?e=wrongCode');
      throw err;
    }
    await clearHint();
    if (await twoFactorEnabledForEmail(h.email)) redirect(`/login/2fa?callbackUrl=${encodeURIComponent(next)}`);
    redirect(next);
  }

  return (
    <AuthShell>
      <h1 className="mb-2 text-2xl font-bold text-ink">{t('codeLogin.title')}</h1>
      <p className="mb-6 text-base text-ink" data-testid="login-code-sent">
        {t('codeLogin.sentTo', { email: '' })}
        <bdi dir="ltr">{maskEmail(hint.email)}</bdi>
      </p>
      {e === 'wrongCode' ? (
        <Notice tone="error" id="login-code-error" className="mb-4">
          {t('codeLogin.errors.wrongCode')}
        </Notice>
      ) : null}
      <LoginCodeForm
        action={verifyAction}
        error={e === 'wrongCode'}
        labels={{ code: t('codeLogin.codeLabel'), submit: t('codeLogin.submit'), rememberMe: t('login.rememberMe') }}
      />
      <p className="mt-6 text-center text-sm">
        <Link href="/login" className="font-medium text-primary hover:underline">
          {t('codeLogin.useOther')}
        </Link>
      </p>
    </AuthShell>
  );
}
