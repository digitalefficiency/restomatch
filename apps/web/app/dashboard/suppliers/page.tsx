import { createServerCaller } from '@/lib/trpc/server';

export default async function SuppliersPage() {
  const caller = await createServerCaller();
  const scorecards = await caller.owner.suppliers();

  return (
    <div>
      <h2 className="text-2xl font-bold mb-2">דירוג ספקים</h2>
      <p className="text-sm text-slate-500 mb-6">
        רעיון: ספק שגדל ב-clean match% הוא ספק שלא מוסיף עלויות סמויות.
      </p>

      {scorecards.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-slate-500">
          אין ספקים עם נתוני קבלה מספיקים. דוח זה מתבסס על match runs מהזמן האחרון.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {scorecards.map((s) => (
            <article
              key={s.supplierId}
              className="rounded-xl border border-slate-200 bg-white p-5"
            >
              <header className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold">{s.supplierName}</h3>
                  <p className="text-xs text-slate-500 mt-1">
                    {s.matchRunsCount} השוואות בתקופה
                  </p>
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
            </article>
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
  const label = trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→';
  const tone =
    trend === 'up'
      ? 'text-accent bg-accent/10'
      : trend === 'down'
        ? 'text-danger bg-danger/10'
        : 'text-slate-500 bg-slate-100';
  return (
    <span
      className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-lg font-bold ${tone}`}
    >
      {label}
    </span>
  );
}
