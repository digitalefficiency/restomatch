import { AlertCircle } from 'lucide-react';
import { AuthError } from 'next-auth';
import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { clientIpFromHeaders } from '@restomatch/api';
import { signIn } from '@/auth';
import { Button, Card, Field, Input } from '@/lib/components';
import { enforceLoginLimit } from '@/lib/rateLimit';

interface PageProps {
  searchParams: Promise<{ callbackUrl?: string; error?: string; email?: string; sent?: string }>;
}

/** Only allow same-origin relative paths as a post-login destination. */
function safeCallback(raw: string | undefined): string {
  if (!raw) return '/dashboard';
  // Reject absolute URLs, protocol-relative (//host) and backslash variants.
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/dashboard';
  return raw;
}

export default async function LoginPage({ searchParams }: PageProps) {
  const { callbackUrl, error, email: invitedEmail, sent } = await searchParams;
  const redirectTo = safeCallback(callbackUrl);
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
    if (!email || !password) redirect('/login?error=CredentialsSignin');
    // Edge rate-limit on email AND IP (C.2). Uniform 'rate' error reveals no
    // lock/account state. The durable floor is the DB lockout in authorize().
    const ip = clientIpFromHeaders(await headers());
    const rl = await enforceLoginLimit(email, ip);
    if (!rl.allowed) redirect('/login?error=rate');
    try {
      await signIn('credentials', { email, password, rememberMe, redirectTo });
    } catch (err) {
      if (err instanceof AuthError) redirect('/login?error=CredentialsSignin');
      throw err; // re-throw the success NEXT_REDIRECT
    }
  }

  // Magic-link (BACKUP). Always available — every existing user (who has no
  // password) keeps logging in this way.
  async function magicLinkAction(formData: FormData) {
    'use server';
    const email = String(formData.get('email') ?? '').trim();
    if (!email) return;
    await signIn('nodemailer', { email, redirectTo });
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card elevated flow padding="lg" className="w-full max-w-md">
        <h1 className="mb-2 text-2xl font-bold text-ink">כניסה ל-RestoMatch</h1>
        <p className="mb-6 text-sm text-muted">התחברו עם הסיסמה שלכם, או קבלו קישור-קסם למייל.</p>

        {error ? (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2 rounded-md border-r-4 border-danger bg-danger/5 px-3 py-2 text-sm text-danger"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              {error === 'Verification'
                ? 'הקישור פג תוקף או שכבר נעשה בו שימוש. נסו שוב.'
                : error === 'CredentialsSignin'
                  ? 'אימייל או סיסמה שגויים.'
                  : error === 'rate'
                    ? 'יותר מדי ניסיונות. נסו שוב מאוחר יותר.'
                    : 'אירעה שגיאה בהתחברות. נסו שוב.'}
            </span>
          </div>
        ) : null}

        {sent ? (
          <div
            role="status"
            className="mb-4 rounded-md border-r-4 border-success bg-success/5 px-3 py-2 text-sm text-success"
          >
            שלחנו קישור התחברות למייל. בדקו את תיבת הדואר.
          </div>
        ) : null}

        {/* PRIMARY — email + password */}
        <form action={passwordAction} className="space-y-4">
          <Field
            label="כתובת מייל"
            htmlFor="email"
            hint={lockedEmail ? 'ההזמנה נשלחה לכתובת הזו — התחברו איתה כדי לקבל גישה.' : undefined}
          >
            <Input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@restaurant.co.il"
              defaultValue={lockedEmail}
              readOnly={!!lockedEmail}
            />
          </Field>
          <Field label="סיסמה" htmlFor="password">
            <Input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              placeholder="••••••••"
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" name="rememberMe" className="h-4 w-4 accent-brand" />
            זכור אותי במכשיר הזה
          </label>
          <Button type="submit" className="w-full">
            כניסה
          </Button>
        </form>

        <div className="my-5 flex items-center gap-3 text-xs text-subtle">
          <span className="h-px flex-1 bg-border" />
          או
          <span className="h-px flex-1 bg-border" />
        </div>

        {/* BACKUP — magic link */}
        <form action={magicLinkAction} className="space-y-3">
          <Input
            aria-label="כתובת מייל לקישור התחברות"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@restaurant.co.il"
            defaultValue={lockedEmail}
            readOnly={!!lockedEmail}
          />
          <Button type="submit" variant="secondary" className="w-full">
            שלחו לי קישור התחברות
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-subtle">
          <Link href="/reset" className="text-brand hover:underline">
            שכחתם סיסמה?
          </Link>
        </p>
      </Card>
    </main>
  );
}
