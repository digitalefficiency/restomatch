import { redirect } from 'next/navigation';
import { auth, signOut } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login');
  }

  const caller = await createServerCaller();
  const memberships = await caller.onboarding.myMemberships();

  if (memberships.length === 0) {
    redirect('/onboarding');
  }

  const active = memberships.find((m) => m.restaurantId === session.user.restaurantId) ?? memberships[0]!;

  async function logout() {
    'use server';
    await signOut({ redirectTo: '/' });
  }

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-3xl mx-auto">
        <header className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white">{active.restaurantName}</h1>
            <p className="text-sm text-neutral-400 mt-1">
              {session.user.email} · {labelForRole(active.role)}
            </p>
          </div>
          <form action={logout}>
            <button className="text-sm text-neutral-400 hover:text-white border border-neutral-700 rounded-md px-3 py-1.5">
              התנתק
            </button>
          </form>
        </header>

        <div className="rounded-xl border border-neutral-800 bg-surface p-6">
          <h2 className="text-lg font-semibold mb-3">סטטוס המערכת</h2>
          <ul className="space-y-2 text-sm text-neutral-300">
            <li>• Auth.js v5 + Drizzle adapter — פעיל</li>
            <li>• tRPC v11 + multi-tenant RBAC — פעיל</li>
            <li>• Postgres + pgvector — פעיל</li>
            <li>• Milestone 1 — Foundation</li>
          </ul>
        </div>
      </div>
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
