import { redirect } from 'next/navigation';
import { auth, signOut } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { Button } from '@/lib/components';
import { DashboardNav } from './nav';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login');
  }

  const caller = await createServerCaller();
  const memberships = await caller.onboarding.myMemberships();

  if (memberships.length === 0) {
    redirect('/onboarding');
  }

  const active =
    memberships.find((m) => m.restaurantId === session.user.restaurantId) ?? memberships[0]!;

  async function logout() {
    'use server';
    await signOut({ redirectTo: '/' });
  }

  return (
    <main className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-stone-200 bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div>
            <h1 className="text-xl font-semibold text-stone-900">{active.restaurantName}</h1>
            <p className="text-xs text-stone-500">
              {session.user.email} · {labelForRole(active.role)}
            </p>
          </div>
          <DashboardNav />
          <form action={logout}>
            <Button variant="secondary" size="sm">
              התנתק
            </Button>
          </form>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-6 py-8">{children}</div>
    </main>
  );
}

function labelForRole(role: string): string {
  const map: Record<string, string> = {
    owner: 'בעלים',
    manager: 'מנהל/ת',
    receiver: 'מקבל סחורה',
    bookkeeper: 'חשב/ת',
    chef: 'שף',
  };
  return map[role] ?? role;
}
