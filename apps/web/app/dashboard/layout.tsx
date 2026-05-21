import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth, signOut } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';

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
      <header className="border-b border-neutral-800 bg-surface">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-6">
          <div>
            <h1 className="text-xl font-semibold text-white">{active.restaurantName}</h1>
            <p className="text-xs text-neutral-400">
              {session.user.email} · {labelForRole(active.role)}
            </p>
          </div>
          <nav className="flex gap-1 text-sm">
            <NavLink href="/dashboard">סקירה</NavLink>
            <NavLink href="/dashboard/approvals">תור אישורים</NavLink>
            <NavLink href="/dashboard/leaks">בלש דליפות</NavLink>
            <NavLink href="/dashboard/suppliers">ספקים</NavLink>
          </nav>
          <form action={logout}>
            <button className="text-sm text-neutral-400 hover:text-white border border-neutral-700 rounded-md px-3 py-1.5">
              התנתק
            </button>
          </form>
        </div>
      </header>
      <div className="max-w-6xl mx-auto px-6 py-8">{children}</div>
    </main>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="px-3 py-1.5 rounded-md text-neutral-300 hover:bg-neutral-800 hover:text-white"
    >
      {children}
    </Link>
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
