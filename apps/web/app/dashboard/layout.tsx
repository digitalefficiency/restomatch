import { redirect } from 'next/navigation';
import { auth, signOut } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { Button } from '@/lib/components';
import { DashboardNav } from './nav';
import { DashboardSearch } from './search';

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
      <header className="glass sticky top-0 z-40 border-b border-line">
        <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px flow-stream" />
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-ink">{active.restaurantName}</h1>
            <p className="font-mono text-xs tabular-nums text-subtle">
              {session.user.email} · <span className="font-sans text-muted">{labelForRole(active.role)}</span>
            </p>
          </div>
          <DashboardNav />
          <div className="flex items-center gap-3">
            <DashboardSearch />
            <form action={logout}>
              <Button variant="secondary" size="sm">
                התנתק
              </Button>
            </form>
          </div>
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
