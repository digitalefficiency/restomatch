import { AlertCircle } from 'lucide-react';
import { signIn } from '@/auth';
import { Button, Card, Field, Input } from '@/lib/components';

interface PageProps {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}

export default async function LoginPage({ searchParams }: PageProps) {
  const { callbackUrl, error } = await searchParams;

  async function action(formData: FormData) {
    'use server';
    const email = String(formData.get('email') ?? '').trim();
    if (!email) return;
    await signIn('nodemailer', {
      email,
      redirectTo: callbackUrl ?? '/dashboard',
    });
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card elevated flow padding="lg" className="w-full max-w-md">
        <h1 className="mb-2 text-2xl font-bold text-ink">כניסה ל-RestoMatch</h1>
        <p className="mb-6 text-sm text-muted">
          הזן את כתובת המייל שלך — נשלח לך קישור-קסם להתחברות.
        </p>

        {error ? (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2 rounded-md border-r-4 border-danger bg-danger/5 px-3 py-2 text-sm text-danger"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              {error === 'Verification'
                ? 'הקישור פג תוקף או שכבר נעשה בו שימוש. נסה שוב.'
                : 'אירעה שגיאה בהתחברות. נסה שוב.'}
            </span>
          </div>
        ) : null}

        <form action={action} className="space-y-4">
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
            שלח לי קישור התחברות
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-subtle">
          ב-development הקישור יודפס ל-stdout של השרת.
        </p>
      </Card>
    </main>
  );
}
