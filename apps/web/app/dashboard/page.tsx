import { redirect } from 'next/navigation';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Wallet } from 'lucide-react';
import { createServerCaller } from '@/lib/trpc/server';
import { KpiCard, SectionHeader } from '@/lib/components';

export default async function DashboardPage() {
  const caller = await createServerCaller();
  const memberships = await caller.onboarding.myMemberships();
  if (memberships.length === 0) {
    redirect('/onboarding');
  }
  const kpis = await caller.owner.kpis();

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
