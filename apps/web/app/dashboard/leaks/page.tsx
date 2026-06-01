import { TRPCError } from '@trpc/server';
import { Droplets, ShieldAlert } from 'lucide-react';
import { createServerCaller } from '@/lib/trpc/server';
import { Badge, Card, EmptyState, SectionHeader } from '@/lib/components';

export default async function LeaksPage() {
  const caller = await createServerCaller();
  let leaks: Awaited<ReturnType<typeof caller.owner.leaks>> = [];
  let forbidden = false;
  try {
    leaks = await caller.owner.leaks({ limit: 50 });
  } catch (err) {
    if (err instanceof TRPCError && err.code === 'FORBIDDEN') {
      forbidden = true;
    } else {
      throw err;
    }
  }

  if (forbidden) {
    return (
      <div>
        <SectionHeader title="בלש הדליפות" />
        <Card
          padding="md"
          className="flex items-center gap-3 border-warning/30 bg-warning/5 text-warning"
        >
          <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span>רק לבעלי תפקיד "בעלים" יש גישה לבלש הדליפות.</span>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <SectionHeader
        title="בלש הדליפות"
        subtitle="מוצרים שבהם המחיר האחרון חורג מהגבול ה-90 ההיסטורי."
      />

      {leaks.length === 0 ? (
        <EmptyState
          icon={<Droplets className="h-6 w-6" />}
          title="לא נמצאו דליפות פעילות"
          description="נדרשים לפחות 3 דגימות מחיר לכל ספק לפני שה-baseline מחושב. המשך לקלוט חשבוניות והדליפות יתחילו לצוף."
        />
      ) : (
        <Card elevated padding="none" className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th scope="col" className="p-3 text-right font-medium">מוצר</th>
                <th scope="col" className="p-3 text-right font-medium">ספק</th>
                <th scope="col" className="p-3 text-right font-medium">מחיר ממוצע</th>
                <th scope="col" className="p-3 text-right font-medium">מחיר אחרון</th>
                <th scope="col" className="p-3 text-right font-medium">שינוי</th>
                <th scope="col" className="p-3 text-right font-medium">הפסד צפוי</th>
              </tr>
            </thead>
            <tbody>
              {leaks.map((row) => (
                <tr
                  key={`${row.productId}-${row.supplierId}`}
                  className="border-t border-slate-100 transition-colors hover:bg-slate-50/60"
                >
                  <td className="p-3">
                    <div className="font-medium text-slate-900">{row.productName}</div>
                    <div className="text-xs text-slate-500">{row.category ?? '—'}</div>
                  </td>
                  <td className="p-3 text-slate-700">{row.supplierName}</td>
                  <td className="p-3 tabular-nums text-slate-700">{formatCurrency(row.baselineP50)}</td>
                  <td className="p-3 tabular-nums text-slate-900">{formatCurrency(row.lastObservedPrice)}</td>
                  <td className="p-3">
                    <Badge tone={row.deltaPct >= 0.1 ? 'danger' : 'warning'}>
                      +{(row.deltaPct * 100).toFixed(1)}%
                    </Badge>
                  </td>
                  <td className="p-3 font-semibold tabular-nums text-slate-900">
                    {formatCurrency(row.monthExcessIls)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    maximumFractionDigits: 2,
  }).format(value);
}
