import { createServerCaller } from '@/lib/trpc/server';

export default async function DashboardPage() {
  const caller = await createServerCaller();
  const kpis = await caller.owner.kpis();

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">סקירה כללית</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi
          label="הפסד פוטנציאלי החודש"
          value={formatCurrency(kpis.monthPotentialLossIls)}
          tone="warning"
          subtitle="דיסקרפנסיות פתוחות עם חומרה בינונית ומעלה"
        />
        <Kpi
          label="חיסכון שנשמר החודש"
          value={formatCurrency(kpis.monthSavingsCapturedIls)}
          tone="accent"
          subtitle="כסף שמנעת לאחר אישור/דחיית הפרשים"
        />
        <Kpi
          label="ממתינות לאישור"
          value={kpis.pendingApprovalsCount.toString()}
          tone="default"
          subtitle="חריגות בתור — מנהל/בעלים"
        />
        <Kpi
          label="התאמות נקיות השבוע"
          value={`${kpis.weekCleanMatchPct.toFixed(1)}%`}
          tone={kpis.weekCleanMatchPct >= 80 ? 'accent' : 'warning'}
          subtitle="ממוצע מהשבעה ימים האחרונים"
        />
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  subtitle,
  tone,
}: {
  label: string;
  value: string;
  subtitle?: string;
  tone: 'default' | 'accent' | 'warning';
}) {
  const accent =
    tone === 'accent'
      ? 'text-accent'
      : tone === 'warning'
        ? 'text-warning'
        : 'text-white';
  return (
    <div className="rounded-xl border border-neutral-800 bg-surface p-5">
      <p className="text-xs uppercase tracking-wider text-neutral-500 mb-2">{label}</p>
      <p className={`text-3xl font-bold ${accent}`}>{value}</p>
      {subtitle ? <p className="text-xs text-neutral-500 mt-2">{subtitle}</p> : null}
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
