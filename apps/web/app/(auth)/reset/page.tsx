import { AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { Button, Card, Field, Input } from '@/lib/components';
import { MIN_PASSWORD_LENGTH } from '@/lib/passwordPolicy';
import { requestPasswordResetAction, resetPasswordAction } from '../actions';

interface PageProps {
  searchParams: Promise<{ token?: string; sent?: string; error?: string; wait?: string }>;
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="mb-4 flex items-start gap-2 rounded-md border-r-4 border-danger bg-danger/5 px-3 py-2 text-sm text-danger"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

export default async function ResetPage({ searchParams }: PageProps) {
  const { token, sent, error, wait } = await searchParams;

  // ── Mode 2: a reset token is present → choose a new password ──
  if (token) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <Card elevated flow padding="lg" className="w-full max-w-md">
          <h1 className="mb-2 text-2xl font-bold text-ink">בחירת סיסמה חדשה</h1>
          <p className="mb-6 text-sm text-muted">
            הזינו סיסמה חדשה. כל המכשירים המחוברים יתנתקו לאחר האיפוס.
          </p>
          {error === 'mismatch' ? <ErrorBox>הסיסמאות אינן תואמות.</ErrorBox> : null}
          {error === 'policy' ? (
            <ErrorBox>הסיסמה חייבת להכיל לפחות {MIN_PASSWORD_LENGTH} תווים.</ErrorBox>
          ) : null}
          {error === 'token' ? (
            <ErrorBox>הקישור אינו תקף, פג תוקפו או שכבר נעשה בו שימוש. בקשו קישור חדש.</ErrorBox>
          ) : null}
          <form action={resetPasswordAction} className="space-y-4">
            <input type="hidden" name="token" value={token} />
            <Field label="סיסמה חדשה" htmlFor="password">
              <Input
                id="password"
                name="password"
                type="password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                autoComplete="new-password"
                placeholder="••••••••••"
              />
            </Field>
            <Field label="אימות סיסמה" htmlFor="confirm">
              <Input
                id="confirm"
                name="confirm"
                type="password"
                required
                autoComplete="new-password"
                placeholder="••••••••••"
              />
            </Field>
            <Button type="submit" className="w-full">
              עדכון סיסמה
            </Button>
          </form>
        </Card>
      </main>
    );
  }

  // ── Mode 1: request a reset link ──
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card elevated flow padding="lg" className="w-full max-w-md">
        <h1 className="mb-2 text-2xl font-bold text-ink">איפוס סיסמה</h1>
        <p className="mb-6 text-sm text-muted">
          הזינו את כתובת המייל שלכם — אם קיים חשבון, יישלח אליו קישור לאיפוס.
        </p>
        {sent ? (
          <div
            role="status"
            className="mb-4 rounded-md border-r-4 border-success bg-success/5 px-3 py-2 text-sm text-success"
          >
            אם הכתובת רשומה אצלנו, שלחנו אליה קישור לאיפוס סיסמה. בדקו את תיבת הדואר.
          </div>
        ) : null}
        {error === 'rate' ? (
          <ErrorBox>יותר מדי בקשות. נסו שוב בעוד כ-{wait ?? 15} דקות.</ErrorBox>
        ) : null}
        <form action={requestPasswordResetAction} className="space-y-4">
          <Field label="כתובת מייל" htmlFor="email">
            <Input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@restaurant.co.il"
            />
          </Field>
          <Button type="submit" className="w-full">
            שליחת קישור איפוס
          </Button>
        </form>
        <p className="mt-6 text-center text-xs text-subtle">
          <Link href="/login" className="text-brand hover:underline">
            חזרה לכניסה
          </Link>
        </p>
      </Card>
    </main>
  );
}
