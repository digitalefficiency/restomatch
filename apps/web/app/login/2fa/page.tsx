import { AlertCircle } from 'lucide-react';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { Button, Card, Field, Input } from '@/lib/components';
import { cancelTwoFactorAction, verifyTwoFactorAction } from './actions';

interface PageProps {
  searchParams: Promise<{ error?: string }>;
}

/**
 * Second-factor (TOTP) screen — Epic C.1.
 *
 * The session-layer 2FA gate (middleware + auth.config) routes a 2FA-enrolled
 * user here after their FIRST factor (password OR magic-link). This page only
 * accepts the second factor; the server action verifies a TOTP code (±1 step) or
 * a one-time recovery code and clears the pending flag. Inert for users without
 * 2FA enrolled (the gate never sends them here).
 */
export default async function TwoFactorPage({ searchParams }: PageProps) {
  const session = await auth();
  // Not signed in at all → start over. Already past the gate → go to the app.
  if (!session?.user?.id) redirect('/login');
  if (!session.user.twoFactorPending) redirect('/dashboard');

  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card elevated flow padding="lg" className="w-full max-w-md">
        <h1 className="mb-2 text-2xl font-bold text-ink">אימות דו-שלבי</h1>
        <p className="mb-6 text-sm text-muted">
          הזינו את הקוד בן 6 הספרות מאפליקציית האימות, או קוד שחזור חד-פעמי.
        </p>

        {error ? (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2 rounded-md border-r-4 border-danger bg-danger/5 px-3 py-2 text-sm text-danger"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>הקוד שגוי או שפג תוקפו. נסו שוב.</span>
          </div>
        ) : null}

        <form action={verifyTwoFactorAction} className="space-y-4">
          <Field label="קוד אימות" htmlFor="code">
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
          <Button type="submit" className="w-full">
            אימות
          </Button>
        </form>

        <form action={cancelTwoFactorAction} className="mt-4 text-center">
          <button type="submit" className="text-sm text-brand hover:underline">
            התחברות עם חשבון אחר
          </button>
        </form>
      </Card>
    </main>
  );
}
