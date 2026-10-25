import { Suspense as ReactSuspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { originalProps } from '@/lib/i18n/original';
import { auth, signOut } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { ToastProvider } from '@/lib/components';
import { getLocale, getT } from '@/lib/i18n/server';
import { PersistingLanguagePicker } from '@/lib/i18n/PersistingLanguagePicker';
import { LocaleSwitcher } from '@/lib/i18n/LocaleSwitcher';
import { nav } from '@/lib/i18n/messages/nav';
import { isPlatformAdmin } from '@/lib/admin';
import { labelForRole } from '@/lib/roles';
import { NavProvider } from '@/lib/nav/NavProvider';
import { RouteTitle } from '@/lib/nav/RouteTitle';
import { RouteFocus } from '@/lib/nav/useRouteFocus';
import type { NavViewer } from '@/lib/nav';
import { RAIL_COOKIE } from '@/lib/nav/prefs';
import { LocaleSync } from './locale-sync';
import { BranchSwitcher } from './branch-switcher';
import { getWave1Access } from './contracts/access';
import {
  AvatarMenu,
  BottomBar,
  MobileSearchButton,
  MoreSheet,
  SearchSheet,
  ShellFrame,
  Sidebar,
  TopCrumbs,
} from './nav';
import { DashboardSearch } from './search';
import { WorkerStatusBanner } from './worker-status';
import { TrpcProvider } from '@/lib/trpc/client';
import { enabledFeatures } from '@/lib/ingest/features';
import { PwaSessionGuard } from '@/lib/pwa/PwaSessionGuard';

/**
 * Chrome variables, published by the shell for sticky bars, toasts and
 * `scroll-padding` (the bottom bar sets `data-rm-bar="off"` on <html> on field
 * routes and while the on-screen keyboard is open).
 */
// Cast like the context providers: two @types/react copies (see lib/i18n/client.tsx).
const Suspense = ReactSuspense as unknown as React.ComponentType<{ fallback: React.ReactNode; children: React.ReactNode }>;

const CHROME_VARS =
  ':root{--rm-header-h:56px;--rm-bottomnav-h:calc(64px + env(safe-area-inset-bottom))}' +
  ':root[data-rm-bar=off]{--rm-bottomnav-h:0px}' +
  '@media (min-width:1024px){:root{--rm-bottomnav-h:0px}}';

/**
 * Dashboard app shell v2, driven by the nav registry (lib/nav).
 * - Desktop (≥1024): an inline-start sidebar (248 px, or a 64 px rail on
 *   Ctrl/⌘+B) with job-ordered groups, and a 56 px top bar: branch chip ·
 *   breadcrumb · search · language · account menu. Fluid content to 1,600 px.
 * - Phone: a 56 px top bar (branch / restaurant + role · 🔍 · account), a
 *   server-rendered role bottom bar and the "עוד" sheet.
 * The sidebar and the bottom bar sit inside the one <header> landmark; the
 * header has no backdrop-filter, so their `position: fixed` is viewport-based.
 * Logical properties throughout, so RTL (he) and LTR (en) both lay out right.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login');
  }
  const userId = session.user.id;
  const sessionRole = (session.user as { role?: string | null }).role ?? null;

  const caller = await createServerCaller();
  // One parallel stage (perf-states-02): nothing below waits on anything else.
  const [
    memberships,
    t,
    locale,
    flags,
    enabled,
    receiverLangsOn,
    recipesFlag,
    inventoryFlag,
    askEnabled,
    wave1Access,
    chainBranches,
    platformAdmin,
    cookieStore,
  ] = await Promise.all([
    caller.onboarding.myMemberships(),
    getT(nav),
    getLocale(),
    caller.recovery.flags(),
    enabledFeatures(session.user.restaurantId),
    // Receiver languages (S14): the six-language picker replaces עב/EN when on.
    caller.receiverLangs
      .status()
      .then((r) => r.enabled)
      .catch(() => false),
    // Wave-1 flag (MASTER-PLAN §1.3): a disabled feature's nav link is invisible.
    caller.recipes.enabled().catch(() => ({ enabled: false })),
    caller.inventory.enabled().catch(() => ({ enabled: false })),
    // AI assistant (S14): owner/manager + flag on → nav item (role re-checked below).
    sessionRole === 'owner' || sessionRole === 'manager'
      ? caller.ask
          .status()
          .then((r) => r.enabled)
          .catch(() => false)
      : Promise.resolve(false),
    // Wave-1 contracts / price alerts: flag on + finance role, plus the open-alert count; fails silent.
    getWave1Access(),
    // Chain (S8): asked only for owners; the chain router re-checks in the DB.
    sessionRole === 'owner' ? caller.chain.branches().catch(() => null) : Promise.resolve(null),
    isPlatformAdmin(userId).catch(() => false),
    cookies(),
  ]);

  if (memberships.length === 0) {
    redirect('/onboarding');
  }

  const active =
    memberships.find((m) => m.restaurantId === session.user.restaurantId) ?? memberships[0]!;
  // Rare: no active restaurant on the session yet — read the flags of the one we fall back to.
  const activeFeatures =
    active.restaurantId === session.user.restaurantId ? enabled : await enabledFeatures(active.restaurantId);
  const askOn = (active.role === 'owner' || active.role === 'manager') && askEnabled;
  // Wave-1 flags that hide nav items when off (MASTER-PLAN §1.3). `aiAssistant`
  // comes only from the S14 role-aware check above.
  const features = [
    ...new Set<string>([
      ...activeFeatures.filter((f) => f !== 'aiAssistant'),
      ...Object.entries(flags)
        .filter(([, on]) => on)
        .map(([key]) => key),
      ...(askOn ? ['aiAssistant'] : []),
      ...(recipesFlag.enabled ? ['recipes'] : []),
      ...(inventoryFlag.enabled ? ['inventoryCount'] : []),
    ]),
  ].filter((f) => {
    // contracts / priceAlerts follow the role-aware wave-1 access check.
    if (f === 'contracts') return wave1Access.contracts;
    if (f === 'priceAlerts') return wave1Access.priceAlerts;
    return true;
  });
  const roleLabel = labelForRole(active.role, locale);
  const email = session.user.email ?? '';
  // Branches (S8): the switcher lists every membership; the chain group is for
  // owners who run more than one branch (same rule as the chain router: owner
  // branches on the ACTIVE billing account).
  const ownedCount = memberships.filter((m) => m.role === 'owner').length;
  const showChain =
    active.role === 'owner' &&
    ownedCount > 1 &&
    Boolean(chainBranches?.chainEnabled && chainBranches.branches.length > 1);
  // Stable order in the switcher (the membership query has none): by name, so
  // "כפר הזיתים" comes before "כפר הזיתים — חיפה".
  const switcherBranches = memberships
    .map((m) => ({ restaurantId: m.restaurantId, restaurantName: m.restaurantName, role: m.role }))
    .sort((a, b) => a.restaurantName.localeCompare(b.restaurantName, 'he') || a.restaurantId.localeCompare(b.restaurantId));
  const multiBranch = memberships.length > 1;

  const viewer: NavViewer = { role: active.role, features, showChain };
  const badges = { contracts: wave1Access.openAlerts };
  const rail = cookieStore.get(RAIL_COOKIE)?.value === '1';

  async function logout() {
    'use server';
    await signOut({ redirectTo: '/' });
  }

  // Two placements (top bar, "עוד" sheet); the class also keys the picker's menu id.
  const languageFor = (placement?: string) =>
    receiverLangsOn ? <PersistingLanguagePicker className={placement} /> : <LocaleSwitcher className={placement} />;

  return (
    <TrpcProvider>
      <ToastProvider>
        <NavProvider value={{ ...viewer, branch: multiBranch ? active.restaurantName : null }}>
          <style>{CHROME_VARS}</style>
          <a
            href="#main-content"
            data-rm-skip-link=""
            className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-on-primary"
          >
            {t('skipToContent')}
          </a>
          <RouteTitle />
          <RouteFocus />
          <ShellFrame initialRail={rail}>
            <header className="sticky top-0 z-40 border-b border-line bg-surface lg:ps-[var(--rm-sidebar-w)]">
              <Sidebar viewer={viewer} badges={badges} restaurantName={active.restaurantName} roleLabel={roleLabel} />
              {/* 55 px + the header's 1 px border = a 56 px top bar, level with the sidebar's brand row. */}
              <div className="flex h-[55px] items-center gap-2 px-3 sm:px-4 lg:gap-3 lg:px-8">
                {multiBranch ? (
                  // The chip names the branch; the role is in its list and in the account menu.
                  <BranchSwitcher branches={switcherBranches} activeId={active.restaurantId} className="min-w-0" />
                ) : (
                  <div className="min-w-0 lg:hidden">
                    <p className="truncate text-base font-bold text-ink">
                      {/* Tenant data (usually Hebrew) inside a possibly-English UI: mark the
                          language and isolate its direction without changing alignment. */}
                      <span {...originalProps(active.restaurantName)}>{active.restaurantName}</span>
                    </p>
                    <p className="truncate text-xs text-subtle">{roleLabel}</p>
                  </div>
                )}
                {multiBranch ? (
                  <span aria-hidden="true" className="hidden h-5 w-px bg-line lg:block" />
                ) : null}
                <TopCrumbs viewer={viewer} />
                {/* Period / compare chip slot for pages with views (filled from wave 2). */}
                <div id="rm-topbar-period" className="ms-auto hidden items-center lg:flex" />
                <div className="ms-auto flex shrink-0 items-center gap-1 lg:ms-0 lg:gap-2">
                  <div className="hidden lg:block">
                    <DashboardSearch role={active.role} className="w-72" />
                  </div>
                  <MobileSearchButton />
                  {/* Phone: language lives in "עוד", except for the receiver with receiver languages
                      on — that phone is often shared, so it stays one tap away. */}
                  <div className={receiverLangsOn && active.role === 'receiver' ? 'block' : 'hidden lg:block'}>
                    {languageFor()}
                  </div>
                  <AvatarMenu
                    email={email}
                    roleLabel={roleLabel}
                    restaurantName={active.restaurantName}
                    isPlatformAdmin={platformAdmin}
                    logout={logout}
                  />
                </div>
              </div>
              <BottomBar viewer={viewer} badges={badges} />
            </header>
            <main
              id="main-content"
              tabIndex={-1}
              className="pb-[calc(var(--rm-bottomnav-h)+var(--consent-h,0px)+1.5rem)] focus:outline-none lg:ps-[var(--rm-sidebar-w)] lg:pb-[calc(var(--consent-h,0px)+2rem)]"
            >
              <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
                {/* The heartbeat read never holds the page (perf-states-02). */}
                <Suspense fallback={null}>
                  <WorkerStatusBanner />
                </Suspense>
                <LocaleSync />
                {/* Always mounted: it only touches an EXISTING receiver queue, so a sign-out from a branch
                    without receiverPwa still wipes photos queued on another branch. */}
                <PwaSessionGuard userId={userId} />
                {children}
              </div>
            </main>
            {/* Overlays portal to <body>, outside #rm-app, which turns inert while they are open. */}
            <MoreSheet
              viewer={viewer}
              badges={badges}
              language={languageFor('rm-lang-sheet')}
              logout={logout}
              branchList={
                multiBranch ? (
                  <BranchSwitcher variant="list" branches={switcherBranches} activeId={active.restaurantId} />
                ) : undefined
              }
            />
            <SearchSheet role={active.role} />
          </ShellFrame>
        </NavProvider>
      </ToastProvider>
    </TrpcProvider>
  );
}
