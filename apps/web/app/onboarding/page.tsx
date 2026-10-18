import { redirect } from 'next/navigation';
import { auth, signOut } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { Card } from '@/lib/components';
import { LocaleSwitcher } from '@/lib/i18n/LocaleSwitcher';
import { onboarding } from '@/lib/i18n/messages/onboarding';
import { getT } from '@/lib/i18n/server';
import { OnboardingForm } from './form';

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login?callbackUrl=/onboarding');
  }
  if (session.user.twoFactorPending) redirect('/login/2fa');

  const caller = await createServerCaller();
  const memberships = await caller.onboarding.myMemberships();

  if (memberships.length > 0) {
    redirect('/dashboard');
  }

  const t = await getT(onboarding);

  async function logout() {
    'use server';
    await signOut({ redirectTo: '/login?signedOut=1' });
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center p-6">
      <div className="absolute end-4 top-4 flex items-center gap-3">
        <LocaleSwitcher />
        <form action={logout}>
          <button type="submit" className="text-xs text-muted hover:text-ink">
            {t('signOut')}
          </button>
        </form>
      </div>
      <Card elevated flow padding="lg" className="w-full max-w-lg">
        <h1 className="mb-2 text-2xl font-bold text-ink">{t('title')}</h1>
        <p className="mb-6 text-sm text-muted">{t('subtitle')}</p>
        <OnboardingForm />
        <p className="mt-6 text-xs leading-relaxed text-subtle">{t('invitedNote')}</p>
      </Card>
    </main>
  );
}
