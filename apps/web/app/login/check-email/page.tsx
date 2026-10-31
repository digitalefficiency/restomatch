import { Mail } from 'lucide-react';
import { AuthError } from 'next-auth';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { signIn } from '@/auth';
import { auth as authMessages } from '@/lib/i18n/messages/auth';
import { getT } from '@/lib/i18n/server';
import { safeRelativePath } from '@/lib/safeRedirect';
import { AuthShell, authTitle } from '../../(auth)/_components/AuthShell';
import { Notice } from '../../(auth)/_components/Notice';
import { readHint, writeHint } from '../hint';
import { maskEmail, resendWaitSec } from '../hintCodec';
import { ResendButton } from './ResendButton';

export const generateMetadata = () => authTitle('shell.titles.checkEmail');

/**
 * "Check your email" (auth-07, phase 1): which address the link went to
 * (masked, from the httpOnly sign-in hint — never the URL), a 30 s resend,
 * one-tap Gmail / Outlook, and the spam hint. The link itself is unchanged.
 */
export default async function CheckEmailPage({ searchParams }: { searchParams: Promise<{ resent?: string; error?: string }> }) {
  const [{ resent, error }, t, hint] = await Promise.all([searchParams, getT(authMessages), readHint()]);

  async function resendAction() {
    'use server';
    const h = await readHint();
    if (!h) redirect('/login');
    // A UX countdown only: it rides on a cookie the browser holds, so it is no
    // security control. The real limit is the per-mailbox MAGIC_LINK_LIMIT
    // inside sendMagicLink (lib/rateLimit.ts), which this never bypasses.
    if (resendWaitSec(h.sentAt) > 0) redirect('/login/check-email');
    const next = safeRelativePath(h.next);
    await writeHint({ ...h, sentAt: Date.now() });
    try {
      await signIn('nodemailer', { email: h.email, redirectTo: next, redirect: false });
    } catch (err) {
      if (err instanceof AuthError) redirect('/login/check-email?error=1');
      throw err;
    }
    redirect('/login/check-email?resent=1');
  }

  return (
    <AuthShell>
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/12 text-primary ring-1 ring-primary/25">
          <Mail className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="mb-2 text-2xl font-bold text-ink">{t('checkEmail.title')}</h1>
        <p className="text-base text-ink" data-testid="check-email-body">
          {hint ? t('mail.sentTo', { email: maskEmail(hint.email) }) : t('checkEmail.body')}
        </p>
      </div>

      <div className="mt-6">
        {resent ? <Notice tone="success">{t('mail.resent')}</Notice> : null}
        {error ? <Notice tone="error">{t('login.errors.emailSignin')}</Notice> : null}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <a
          href="https://mail.google.com/mail/u/0/#inbox"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-12 items-center justify-center rounded-xl border border-line-strong bg-surface px-3 text-sm font-semibold text-ink hover:border-primary/40"
        >
          {t('mail.openGmail')}
        </a>
        <a
          href="https://outlook.live.com/mail/0/inbox"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-12 items-center justify-center rounded-xl border border-line-strong bg-surface px-3 text-sm font-semibold text-ink hover:border-primary/40"
        >
          {t('mail.openOutlook')}
        </a>
      </div>

      {hint ? (
        <form action={resendAction} className="mt-3">
          <ResendButton
            waitSec={resendWaitSec(hint.sentAt)}
            label={t('mail.resend')}
            countdownTemplate={t('mail.resendIn', { seconds: '{seconds}' })}
          />
        </form>
      ) : null}

      <p className="mt-6 text-center text-sm text-muted">{t('mail.spam')}</p>

      {process.env.NODE_ENV !== 'production' ? (
        <p className="mt-4 text-center text-xs text-muted">
          {t('checkEmail.devHint')} <code className="font-mono text-primary">──── MAGIC LINK ────</code>.
        </p>
      ) : null}

      <p className="mt-6 flex flex-wrap justify-center gap-x-4 text-sm">
        <Link href="/login" className="inline-flex min-h-11 items-center font-medium text-primary hover:underline">
          {t('mail.usePassword')}
        </Link>
      </p>
    </AuthShell>
  );
}
