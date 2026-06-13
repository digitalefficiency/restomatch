import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { isPlatformAdmin } from '@/lib/admin';

/**
 * Platform-admin console gate. Non-admins get a 404 (the section's existence is
 * not advertised). Auth + admin are checked here AND in every adminProcedure.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  if (!(await isPlatformAdmin(session.user.id))) notFound();

  return (
    <main className="min-h-screen bg-stone-50" dir="rtl">
      <header className="sticky top-0 z-30 border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="rounded bg-stone-900 px-2 py-1 text-xs font-bold text-white">
              ADMIN
            </span>
            <span className="text-sm text-stone-600">קונסולת תפעול · RestoMatch</span>
          </div>
          <nav className="flex gap-4 text-sm font-medium text-stone-600">
            <Link href="/admin" className="hover:text-stone-900">
              מסעדות
            </Link>
            <Link href="/admin/leads" className="hover:text-stone-900">
              לידים
            </Link>
            <Link href="/dashboard" className="text-stone-400 hover:text-stone-900">
              ← לדשבורד
            </Link>
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-6 py-8">{children}</div>
    </main>
  );
}
