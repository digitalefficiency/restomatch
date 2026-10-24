import { redirect } from 'next/navigation';
import { originalProps } from '@/lib/i18n/original';
import { LogOut } from 'lucide-react';
import { auth, signOut } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { ToastProvider } from '@/lib/components';
import { getLocale, getT } from '@/lib/i18n/server';
import { LanguagePicker } from '@/lib/i18n/LanguagePicker';
import { LocaleSwitcher } from '@/lib/i18n/LocaleSwitcher';
import { nav } from '@/lib/i18n/messages/nav';
import { labelForRole } from '@/lib/roles';
import { enabledFeatures } from '@/lib/ingest/features';
import { PwaSessionGuard } from '@/lib/pwa/PwaSessionGuard';
import { LocaleSync } from './locale-sync';
import { BranchSwitcher } from './branch-switcher';
import { DesktopNav, MobileNav } from './nav';
import { DashboardSearch } from './search';
import { WorkerStatusBanner } from './worker-status';
import { getWave1Access } from './contracts/access';
import { ConsentClearance } from './consent-clearance';
import { TrpcProvider } from '@/lib/trpc/client';

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
  const [t, locale, flags, enabled, receiverLangsOn, recipesFlag] = await Promise.all([
    getT(nav),
    getLocale(),
    caller.recovery.flags(),
    enabledFeatures(active.restaurantId),
    // Receiver languages (S14): the six-language picker replaces עב/EN when on.
    caller.receiverLangs
      .status()
      .then((r) => r.enabled)
      .catch(() => false),
    // Wave-1 flag (MASTER-PLAN §1.3): a disabled feature's nav link is invisible.
    caller.recipes.enabled().catch(() => ({ enabled: false })),
  ]);
  // AI assistant (S14): owner/manager + flag on → nav item.
  const askOn =
    active.role === 'owner' || active.role === 'manager'
      ? await caller.ask
          .status()
          .then((r) => r.enabled)
          .catch(() => false)
      : false;
  // Wave-1 flags that hide nav items when off (MASTER-PLAN §1.3). `aiAssistant`
  // comes only from the S14 role-aware check above.
  const features = [
    ...new Set<string>([
      ...enabled.filter((f) => f !== 'aiAssistant'),
      ...Object.entries(flags)
        .filter(([, on]) => on)
        .map(([key]) => key),
      ...(askOn ? ['aiAssistant'] : []),
      ...(recipesFlag.enabled ? ['recipes'] : []),
    ]),
  ];
  const roleLabel = labelForRole(active.role, locale);
  // Wave-1 nav entry (contracts / price alerts): flag on + finance role; fails silent.
  const wave1Access = await getWave1Access();
  const wave1 = {
    visible: wave1Access.contracts || wave1Access.priceAlerts,
    badge: wave1Access.openAlerts,
  };
  const email = session.user.email ?? '';
  // Branches (S8): the switcher lists every membership; the chain tab is for
  // owners who run more than one branch (the chain router re-checks in the DB).
  // Same rule as the chain router (owner branches on the ACTIVE billing account):
  // ask it only when the user owns more than one restaurant at all.
  const ownedCount = memberships.filter((m) => m.role === 'owner').length;
  let showChain = false;
  if (active.role === 'owner' && ownedCount > 1) {
    showChain = await caller.chain
      .branches()
      .then((b) => b.chainEnabled && b.branches.length > 1)
      .catch(() => false);
  }
  // Stable order in the switcher (the membership query has none): by name, so
  // "כפר הזיתים" comes before "כפר הזיתים — חיפה".
  const switcherBranches = memberships
    .map((m) => ({ restaurantId: m.restaurantId, restaurantName: m.restaurantName, role: m.role }))
    .sort((a, b) => a.restaurantName.localeCompare(b.restaurantName, 'he') || a.restaurantId.localeCompare(b.restaurantId));

  async function logout() {
    'use server';
    await signOut({ redirectTo: '/' });
  }

  return (
    <TrpcProvider>
      <ToastProvider>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-on-primary"
        >
          {t('skipToContent')}
        </a>
        <ConsentClearance />
        {/* Bottom padding: the mobile bottom nav, plus the cookie banner while it is shown. */}
        <div className="min-h-screen pb-[calc(5rem+var(--consent-h,0px))] lg:pb-[var(--consent-h,0px)]">
          <header className="glass sticky top-0 z-40 border-b border-line">
            <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px flow-stream" />
            <div className="mx-auto max-w-6xl px-4 sm:px-6">
              <div className="flex items-center gap-3 py-3">
                <MobileNav
                  role={active.role}
                  features={features}
                  logout={logout}
                  restaurantName={active.restaurantName}
                  email={email}
                  showChain={showChain}
                  wave1={wave1}
                  branchSwitcher={
                    memberships.length > 1 ? (
                      <BranchSwitcher variant="list" branches={switcherBranches} activeId={active.restaurantId} />
                    ) : undefined
                  }
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
                  <BranchSwitcher branches={switcherBranches} activeId={active.restaurantId} />
                  <DashboardSearch role={active.role} className="w-72" />
                  {receiverLangsOn ? <LanguagePicker persist /> : <LocaleSwitcher />}
                  <form action={logout} data-rm-logout="">
                    <button
                      type="submit"
                      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-xs font-semibold text-muted transition-colors hover:border-primary/40 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                    >
                      <LogOut className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden="true" />
                      {t('signOut')}
                    </button>
                  </form>
                </div>
                {receiverLangsOn ? (
                  <LanguagePicker persist className="lg:hidden" />
                ) : (
                  <LocaleSwitcher className="lg:hidden" />
                )}
              </div>
              <DesktopNav role={active.role} showChain={showChain} features={features} wave1={wave1} />
            </div>
          </header>
          <main id="main-content" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-6 focus:outline-none sm:px-6 sm:py-8">
            <WorkerStatusBanner />
            <LocaleSync />
            {/* Always mounted: it only touches an EXISTING receiver queue, so a sign-out from a branch
                without receiverPwa still wipes photos queued on another branch. */}
            <PwaSessionGuard userId={session.user.id} />
            {children}
          </main>
        </div>
      </ToastProvider>
    </TrpcProvider>
  );
}
