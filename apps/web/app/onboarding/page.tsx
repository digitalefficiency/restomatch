import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { Card } from '@/lib/components';
import { OnboardingForm } from './form';

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login');
  }

  const caller = await createServerCaller();
  const memberships = await caller.onboarding.myMemberships();

  if (memberships.length > 0) {
    redirect('/dashboard');
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card elevated padding="lg" className="w-full max-w-lg">
        <h1 className="mb-2 text-2xl font-bold text-slate-900">ברוך הבא ל-RestoMatch</h1>
        <p className="mb-6 text-sm text-slate-500">
          תחילה — בוא נצור את המסעדה שלך. תיכנס אוטומטית כבעלים.
        </p>
        <OnboardingForm />
      </Card>
    </main>
  );
}
