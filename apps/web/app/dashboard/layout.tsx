import { redirect } from 'next/navigation';
import { originalProps } from '@/lib/i18n/original';
import { LogOut } from 'lucide-react';
import { auth, signOut } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { ToastProvider } from '@/lib/components';
import { getLocale, getT } from '@/lib/i18n/server';
import { LocaleSwitcher } from '@/lib/i18n/LocaleSwitcher';
import { nav } from '@/lib/i18n/messages/nav';
import { labelForRole } from '@/lib/roles';
import { LocaleSync } from './locale-sync';
import { DesktopNav, MobileNav } from './nav';
import { DashboardSearch } from './search';
import { WorkerStatusBanner } from './worker-status';
import { getWave1Access } from './contracts/access';

/**
 * Dashboard app shell. Sticky frosted header: restaurant + user on the start
 * side, global search + language + sign-out on the end side, and (lg+) a single
 * row of grouped tabs underneath. Below lg the tabs collapse into a menu drawer
 * plus a bottom bar (MobileNav). Logical properties throughout, so RTL (he) and
 * LTR (en) both lay out correctly.
 */
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
  const [t, locale] = await Promise.all([getT(nav), getLocale()]);
  const roleLabel = labelForRole(active.role, locale);
  // Wave-1 nav entry (contracts / price alerts): flag on + finance role; fails silent.
  const wave1Access = await getWave1Access();
  const wave1 = {
    visible: wave1Access.contracts || wave1Access.priceAlerts,
    badge: wave1Access.openAlerts,
  };
  const email = session.user.email ?? '';

  async function logout() {
    'use server';
    await signOut({ redirectTo: '/' });
  }

  return (
    <ToastProvider>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-on-primary"
      >
        {t('skipToContent')}
      </a>
      <div className="min-h-screen pb-20 lg:pb-0">
        <header className="glass sticky top-0 z-40 border-b border-line">
          <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px flow-stream" />
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="flex items-center gap-3 py-3">
              <MobileNav
                role={active.role}
                logout={logout}
                restaurantName={active.restaurantName}
                email={email}
                wave1={wave1}
              />
              <div className="min-w-0 flex-1 lg:flex-none">
                <p className="truncate text-lg font-bold tracking-tight text-ink">
                  {/* Tenant data (usually Hebrew) inside a possibly-English UI: mark the
                      language and isolate its direction without changing alignment. */}
                  <span {...originalProps(active.restaurantName)}>{active.restaurantName}</span>
                </p>
                <p className="truncate text-xs text-subtle">
                  <span className="font-mono tabular-nums">{email}</span>
                  <span aria-hidden="true"> · </span>
                  <span className="text-muted">{roleLabel}</span>
                </p>
              </div>
              <div className="ms-auto hidden items-center gap-2 lg:flex">
                <DashboardSearch role={active.role} className="w-72" />
                <LocaleSwitcher />
                <form action={logout}>
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-xs font-semibold text-muted transition-colors hover:border-primary/40 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                  >
                    <LogOut className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden="true" />
                    {t('signOut')}
                  </button>
                </form>
              </div>
              <LocaleSwitcher className="lg:hidden" />
            </div>
            <DesktopNav role={active.role} wave1={wave1} />
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-6 focus:outline-none sm:px-6 sm:py-8">
          <WorkerStatusBanner />
          <LocaleSync />
          {children}
        </main>
      </div>
    </ToastProvider>
  );
}
