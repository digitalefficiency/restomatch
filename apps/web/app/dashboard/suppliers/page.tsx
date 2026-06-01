import { ArrowDownRight, ArrowUpRight, Minus, Truck } from 'lucide-react';
import { createServerCaller } from '@/lib/trpc/server';
import { Badge, Card, EmptyState, SectionHeader, type BadgeTone } from '@/lib/components';

export default async function SuppliersPage() {
  const caller = await createServerCaller();
  const scorecards = await caller.owner.suppliers();

  return (
    <div>
      <SectionHeader
        title="דירוג ספקים"
        subtitle="ספק שגדל ב-clean match% הוא ספק שלא מוסיף עלויות סמויות."
      />

      {scorecards.length === 0 ? (
        <EmptyState
          icon={<Truck className="h-6 w-6" />}
          title="אין עדיין נתוני ספקים"
          description="הדוח מתבסס על השוואות (match runs) מהזמן האחרון. ברגע שייכנסו קבלות וחשבוניות, הספקים יופיעו כאן."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {scorecards.map((s) => (
            <Card key={s.supplierId} as="article" elevated>
              <header className="mb-4 flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">{s.supplierName}</h3>
                  <p className="mt-1 text-xs text-slate-500">{s.matchRunsCount} השוואות בתקופה</p>
                </div>
                <TrendBadge trend={s.trend} />
              </header>
              <dl className="space-y-3">
                <Row label="התאמות נקיות" value={`${s.cleanMatchPct.toFixed(1)}%`} />
                <Row
                  label="סטיית מחיר ממוצעת"
                  value={`${(s.avgPriceDeltaPct * 100).toFixed(1)}%`}
                  tone={s.avgPriceDeltaPct > 0.03 ? 'warning' : 'default'}
                />
                <Row
                  label="חשבוניות כפולות"
                  value={s.duplicateInvoicesCount.toString()}
                  tone={s.duplicateInvoicesCount > 0 ? 'danger' : 'default'}
                />
              </dl>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'default' | 'warning' | 'danger';
}) {
  const color =
    tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-slate-900';
  return (
    <div className="flex items-center justify-between">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className={`text-base font-semibold tabular-nums ${color}`}>{value}</dd>
    </div>
  );
}

function TrendBadge({ trend }: { trend: 'up' | 'down' | 'flat' }) {
  const map: Record<typeof trend, { tone: BadgeTone; icon: React.ReactNode; label: string }> = {
    up: { tone: 'accent', icon: <ArrowUpRight className="h-3.5 w-3.5" />, label: 'משתפר' },
    down: { tone: 'danger', icon: <ArrowDownRight className="h-3.5 w-3.5" />, label: 'מדרדר' },
    flat: { tone: 'neutral', icon: <Minus className="h-3.5 w-3.5" />, label: 'יציב' },
  };
  const { tone, icon, label } = map[trend];
  return (
    <Badge tone={tone} icon={icon}>
      {label}
    </Badge>
  );
}
