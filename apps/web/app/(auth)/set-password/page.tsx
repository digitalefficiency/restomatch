import { AlertCircle } from 'lucide-react';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { Button, Card, Field, Input } from '@/lib/components';
import { hasPassword } from '@/lib/passwords';
import { MIN_PASSWORD_LENGTH } from '@/lib/passwordPolicy';
import { changePasswordAction, setPasswordAction } from '../actions';

interface PageProps {
  searchParams: Promise<{ error?: string; changed?: string }>;
}

export default async function SetPasswordPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login?callbackUrl=/set-password');
  const { error, changed } = await searchParams;
  const existing = await hasPassword(session.user.id);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card elevated flow padding="lg" className="w-full max-w-md">
        <h1 className="mb-2 text-2xl font-bold text-ink">
          {existing ? 'שינוי סיסמה' : 'הגדרת סיסמה'}
        </h1>
        <p className="mb-6 text-sm text-muted">
          {existing
            ? 'הזינו את הסיסמה הנוכחית ובחרו חדשה. שאר המכשירים יתנתקו.'
            : 'בחרו סיסמה כדי להתחבר בלי קישור-קסם בפעם הבאה.'}
        </p>

        {changed ? (
          <div
            role="status"
            className="mb-4 rounded-md border-r-4 border-success bg-success/5 px-3 py-2 text-sm text-success"
          >
            הסיסמה עודכנה בהצלחה.
          </div>
        ) : null}
        {error ? (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2 rounded-md border-r-4 border-danger bg-danger/5 px-3 py-2 text-sm text-danger"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              {error === 'mismatch'
                ? 'הסיסמאות אינן תואמות.'
                : error === 'policy'
                  ? `הסיסמה חייבת להכיל לפחות ${MIN_PASSWORD_LENGTH} תווים.`
                  : error === 'current'
                    ? 'הסיסמה הנוכחית שגויה.'
                    : 'אירעה שגיאה. נסו שוב.'}
            </span>
          </div>
        ) : null}

        <form action={existing ? changePasswordAction : setPasswordAction} className="space-y-4">
          {existing ? (
            <Field label="סיסמה נוכחית" htmlFor="current">
              <Input
                id="current"
                name="current"
                type="password"
                required
                autoComplete="current-password"
              />
            </Field>
          ) : null}
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
            <Input id="confirm" name="confirm" type="password" required autoComplete="new-password" />
          </Field>
          <Button type="submit" className="w-full">
            {existing ? 'עדכון סיסמה' : 'שמירת סיסמה'}
          </Button>
        </form>
      </Card>
    </main>
  );
}
