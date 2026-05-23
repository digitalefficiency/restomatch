import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
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
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-lg bg-white border border-slate-200 rounded-xl p-8">
        <h1 className="text-2xl font-bold mb-2 text-slate-900">ברוך הבא ל-RestoMatch</h1>
        <p className="text-sm text-slate-500 mb-6">
          תחילה — בוא נצור את המסעדה שלך. תיכנס אוטומטית כבעלים.
        </p>
        <OnboardingForm />
      </div>
    </main>
  );
}
