import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { SectionHeader } from '@/lib/components';
import { parseView } from '@/lib/components/views';
import { getLocale, getT } from '@/lib/i18n/server';
import { overview } from '@/lib/i18n/messages/overview';
import { views as viewsNs } from '@/lib/i18n/messages/views';
import { leaks as leaksNs } from '@/lib/i18n/messages/leaks';
import { recovery as recoveryNs } from '@/lib/i18n/messages/recovery';
import { leakProof as leakProofNs } from '@/lib/i18n/messages/leakProof';
import { homeCaller } from './home/caller';
import { FinanceHome } from './home/finance';
import { forcedFailures } from './home/section';
import { ChefHome, ReceiverHome } from './home/staff';
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

  const header = (
    <SectionHeader level={1} title={t(`homeTitle.${role}`)} subtitle={t(`homeSubtitle.${role}`)} />
  );

  // G-08: the "זה אותו מוצר?" line for those who can answer it (owner, manager, chef).
  const questionsLine = <HomeQuestions caller={caller} role={role} locale={locale} />;

  if (role === 'receiver') {
    return (
      <div data-home="receiver">
        {header}
        <ReceiverHome caller={homeCaller(caller, 'receiver')} t={t} locale={locale} fail={fail} />
      </div>
    );
  }
  if (role === 'chef') {
    return (
      <div data-home="chef">
        {header}
        {questionsLine}
        <ChefHome caller={homeCaller(caller, 'chef')} t={t} locale={locale} fail={fail} />
      </div>
    );
  }

  const [tv, tl, tr, tp] = await Promise.all([getT(viewsNs), getT(leaksNs), getT(recoveryNs), getT(leakProofNs)]);
  return (
    <div data-home={role}>
      {/* Finance homes: the strip is the answer — no subtitle line pushing it down. */}
      <div className="[&>div]:mb-4 [&_p]:hidden">{header}</div>
      {questionsLine}
      <FinanceHome
        caller={caller}
        role={role}
        restaurantId={active.restaurantId}
        restaurantName={active.restaurantName}
        locale={locale}
        view={parseView(sp)}
        fail={fail}
        t={t}
        tv={tv}
        tl={tl}
        tr={tr}
        tp={tp}
      />
    </div>
  );
}
