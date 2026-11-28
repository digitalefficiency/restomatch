import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { PageHeader } from '@/lib/components/PageHeader';
import { formatDay } from '@/lib/components/money/format';
import { parseView } from '@/lib/components/views';
import { viewDefaults } from '@/lib/components/views/defaults';
import { formatDate } from '@/lib/i18n/format';
import { getLocale, getT } from '@/lib/i18n/server';
import { overview } from '@/lib/i18n/messages/overview';
import { views as viewsNs } from '@/lib/i18n/messages/views';
import { leaks as leaksNs } from '@/lib/i18n/messages/leaks';
import { recovery as recoveryNs } from '@/lib/i18n/messages/recovery';
import { leakProof as leakProofNs } from '@/lib/i18n/messages/leakProof';
import { approvals as approvalsNs } from '@/lib/i18n/messages/approvals';
import { homeCaller } from './home/caller';
import { FinanceHome } from './home/finance';
import { forcedFailures } from './home/section';
import { ChefHome, ReceiverHome, StaffNeeds } from './home/staff';
import { HomeQuestions } from './home/questions';

/**
 * /dashboard renders by role ("Today", W1-05). The role is resolved BEFORE any
 * money is fetched: the receiver gets the receiving board and the chef the
 * kitchen — neither ever requests owner.kpis / leakHero / leakSummary — while
 * owner, manager and bookkeeper get "מחכה לך" in ₪ plus the honest leak hero.
 * One URL for every role, so the PWA start_url and deep links keep working.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const caller = await createServerCaller();
  const [session, memberships, locale, t] = await Promise.all([
    auth(),
    caller.onboarding.myMemberships(),
    getLocale(),
    getT(overview),
  ]);
  if (memberships.length === 0) redirect('/onboarding');
  const active = memberships.find((m) => m.restaurantId === session?.user?.restaurantId) ?? memberships[0]!;
  const role = active.role;
  const fail = forcedFailures(sp);

  // The page header (DS3: the shared PageHeader, title-lg, the h1 the shell focuses). Its context
  // line: the owner's date (SPEC §10.1 "with the date": weekday + dd.MM.yyyy, Israel time, through
  // the app's own date formatters); the chef's and the receiver's line as before. PageHeader puts
  // the active branch first for a multi-branch member — the product's header contract.
  const now = new Date();
  const context =
    role === 'owner'
      ? t('homeDate', { weekday: formatDate(now, locale, { weekday: 'long' }), date: formatDay(now, locale) })
      : role === 'chef' || role === 'receiver'
        ? t(`homeSubtitle.${role}`)
        : undefined;
  const header = <PageHeader route="home" title={t(`homeTitle.${role}`)} context={context} />;

  // G-08: the "זה אותו מוצר?" line for those who can answer it (owner, manager, chef):
  // under the title on the chef's home; the finance homes put it under the task card.
  const questionsLine = <HomeQuestions caller={caller} role={role} locale={locale} />;

  if (role === 'receiver') {
    return (
      <div data-home="receiver">
        {header}
        {/* The receiving board IS the receiver's "מחכה לך" (one home per number): no strip above it. */}
        <ReceiverHome caller={homeCaller(caller, 'receiver')} t={t} locale={locale} fail={fail} />
      </div>
    );
  }
  if (role === 'chef') {
    return (
      <div data-home="chef">
        {header}
        <StaffNeeds load={() => caller.tasks.mine()} homed={['close_step']} t={t} locale={locale} fail={fail} />
        {questionsLine}
        <ChefHome caller={homeCaller(caller, 'chef')} t={t} locale={locale} fail={fail} />
      </div>
    );
  }

  const [tv, tl, tr, tp, ta, defaults] = await Promise.all([getT(viewsNs), getT(leaksNs), getT(recoveryNs), getT(leakProofNs), getT(approvalsNs), viewDefaults(role)]);
  return (
    <div data-home={role}>
      {/* Finance homes: the work starts right under the title. The manager's and the bookkeeper's
          context line stays hidden (their lens is unchanged); the owner's carries the date. */}
      <div className={role === 'owner' ? '[&>div]:mb-4 sm:[&>div]:mb-5' : '[&>div]:mb-4 [&_[data-testid=page-context]]:hidden'}>{header}</div>
      <FinanceHome
        // The question line sits under the task card, never above the T1 hero.
        questions={<HomeQuestions caller={caller} role={role} locale={locale} spacing="mt-2" />}
        caller={caller}
        role={role}
        restaurantId={active.restaurantId}
        restaurantName={active.restaurantName}
        locale={locale}
        // The display density chosen in הגדרות → תצוגה (else the role's), as every view parses it.
        view={parseView(sp, defaults)}
        fail={fail}
        t={t}
        tv={tv}
        tl={tl}
        tr={tr}
        tp={tp}
        ta={ta}
      />
    </div>
  );
}
