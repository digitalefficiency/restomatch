import { AlertCircle } from 'lucide-react';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { Card } from '@/lib/components';

interface PageProps {
  searchParams: Promise<{ token?: string }>;
}

/**
 * Invite acceptance. The invitee arrives here already signed-in (the invite
 * email links to /login?callbackUrl=/invite/accept?token=…, so the magic-link
 * flow lands here authenticated). We exchange the token for a membership via
 * team.acceptInvite, which enforces token/email/expiry/status server-side.
 */
export default async function InviteAcceptPage({ searchParams }: PageProps) {
  const { token } = await searchParams;
  if (!token) redirect('/dashboard');

  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/invite/accept?token=${token}`)}`);
  }

  let error: string | null = null;
  try {
    const caller = await createServerCaller();
    await caller.team.acceptInvite({ token });
  } catch (e) {
    error = e instanceof Error ? e.message : 'אירעה שגיאה בקבלת ההזמנה.';
  }

  // redirect() must run outside the try/catch (it throws NEXT_REDIRECT).
  if (!error) redirect('/dashboard');

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card elevated flow padding="lg" className="w-full max-w-md">
        <div className="mb-2 flex items-center gap-2 text-danger">
          <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
          <h1 className="text-xl font-bold">קבלת ההזמנה נכשלה</h1>
        </div>
        <p className="text-sm text-muted">{error}</p>
        <a
          href="/dashboard"
          className="mt-6 inline-block text-sm font-semibold text-primary hover:underline"
        >
          חזרה לדשבורד
        </a>
      </Card>
    </main>
  );
}
