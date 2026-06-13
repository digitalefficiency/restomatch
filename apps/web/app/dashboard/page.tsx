import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Activity, AlertTriangle, CheckCircle2, ClipboardCheck, Wallet } from 'lucide-react';
import { createServerCaller } from '@/lib/trpc/server';
import {
  EmptyState,
  EntitlementUpsell,
  KpiCard,
  LeakHeatmap,
  SectionHeader,
  entitlementCauseOf,
} from '@/lib/components';
import { PaginatedActivityFeed } from './activity';

export default async function DashboardPage() {
  const caller = await createServerCaller();
  const memberships = await caller.onboarding.myMemberships();
  if (memberships.length === 0) {
    redirect('/onboarding');
  }
  const kpis = await caller.owner.kpis();

  // Leak grid is owner-only; other roles simply won't see this section. If the
  // feature is gated behind a paid plan, surface a compact upsell teaser rather
  // than hiding the section entirely.
  let leaks: Awaited<ReturnType<typeof caller.owner.leaks>> = [];
  let leaksEntitlementBlocked = false;
  try {
    leaks = await caller.owner.leaks({ limit: 8 });
  } catch (err) {
    if (entitlementCauseOf(err)) {
      leaksEntitlementBlocked = true;
    }
    // Role/other errors: silently omit the section (non-owners don't see it).
    leaks = [];
  }

  const activity = await caller.activity.feed({ limit: 8 });

  return (
    <div>
      <SectionHeader
        title="סקירה כללית"
        subtitle="תמונת מצב יומית — איפה כסף בורח, ומה דורש את ההחלטה שלך עכשיו."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="הפסד פוטנציאלי החודש"
          value={formatCurrency(kpis.monthPotentialLossIls)}
          tone="warning"
          icon={<AlertTriangle className="h-5 w-5" />}
          subtitle="דיסקרפנסיות פתוחות עם חומרה בינונית ומעלה"
        />
        <KpiCard
          label="חיסכון שנשמר החודש"
          value={formatCurrency(kpis.monthSavingsCapturedIls)}
          tone="accent"
          icon={<Wallet className="h-5 w-5" />}
          subtitle="כסף שמנעת לאחר אישור/דחיית הפרשים"
        />
        <KpiCard
          label="ממתינות לאישור"
          value={kpis.pendingApprovalsCount.toString()}
          tone="neutral"
          icon={<ClipboardCheck className="h-5 w-5" />}
          subtitle="חריגות בתור — מנהל/בעלים"
        />
        <KpiCard
          label="התאמות נקיות השבוע"
          value={`${kpis.weekCleanMatchPct.toFixed(1)}%`}
          tone={kpis.weekCleanMatchPct >= 80 ? 'accent' : 'warning'}
          icon={<CheckCircle2 className="h-5 w-5" />}
          subtitle="ממוצע מהשבעה ימים האחרונים"
        />
      </div>

      {leaksEntitlementBlocked ? (
        <div className="mt-10">
          <SectionHeader
            title="בלש דליפות"
            subtitle="המוצרים שדולפים הכי הרבה כסף החודש."
          />
          <EntitlementUpsell
            feature="advanced_analytics"
            title="שדרגו כדי לפתוח את בלש הדליפות"
            compact
          />
        </div>
      ) : leaks.length > 0 ? (
        <div className="mt-10">
          <SectionHeader
            title="בלש דליפות"
            subtitle="המוצרים שדולפים הכי הרבה כסף החודש."
            action={
              <Link
                href="/dashboard/leaks"
                className="text-sm font-medium text-primary hover:text-primary-hover"
              >
                לכל הדליפות →
              </Link>
            }
          />
          <LeakHeatmap items={leaks} max={8} />
        </div>
      ) : null}

      <div className="mt-10">
        <SectionHeader title="פעילות אחרונה" subtitle="מה קרה במערכת לאחרונה." />
        {activity.length > 0 ? (
          <PaginatedActivityFeed initial={activity} />
        ) : (
          <EmptyState
            icon={<Activity className="h-6 w-6" />}
            title="עדיין אין פעילות"
            description="ברגע שתקלוט חשבוניות ותטפל בחריגות, היומן יתחיל להתמלא כאן."
          />
        )}
      </div>
    </div>
  );
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    maximumFractionDigits: 0,
  }).format(value);
}
