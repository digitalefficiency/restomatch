import { TRPCError } from '@trpc/server';
import { createServerCaller } from '@/lib/trpc/server';

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
        <h2 className="text-2xl font-bold mb-4">בלש הדליפות</h2>
        <div className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-warning">
          רק לבעלי תפקיד "בעלים" יש גישה לבלש הדליפות.
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-2">בלש הדליפות</h2>
      <p className="text-sm text-neutral-400 mb-6">
        מוצרים שבהם המחיר האחרון חורג מהגבול ה-90 ההיסטורי.
      </p>

      {leaks.length === 0 ? (
        <div className="rounded-xl border border-neutral-800 bg-surface p-6 text-neutral-400">
          לא נמצאו דליפות פעילות. נדרשים לפחות 3 דגימות מחיר לכל ספק לפני שה-baseline מחושב.
        </div>
      ) : (
        <div className="rounded-xl border border-neutral-800 bg-surface overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900/50 text-neutral-400">
              <tr>
                <th className="text-right p-3 font-medium">מוצר</th>
                <th className="text-right p-3 font-medium">ספק</th>
                <th className="text-right p-3 font-medium">מחיר ממוצע</th>
                <th className="text-right p-3 font-medium">מחיר אחרון</th>
                <th className="text-right p-3 font-medium">שינוי</th>
                <th className="text-right p-3 font-medium">הפסד צפוי</th>
              </tr>
            </thead>
            <tbody>
              {leaks.map((row) => (
                <tr
                  key={`${row.productId}-${row.supplierId}`}
                  className="border-t border-neutral-800"
                >
                  <td className="p-3">
                    <div className="font-medium">{row.productName}</div>
                    <div className="text-xs text-neutral-500">{row.category ?? '—'}</div>
                  </td>
                  <td className="p-3">{row.supplierName}</td>
                  <td className="p-3 tabular-nums">{formatCurrency(row.baselineP50)}</td>
                  <td className="p-3 tabular-nums">{formatCurrency(row.lastObservedPrice)}</td>
                  <td className="p-3 tabular-nums">
                    <span
                      className={
                        row.deltaPct >= 0.1
                          ? 'text-danger font-semibold'
                          : 'text-warning font-semibold'
                      }
                    >
                      +{(row.deltaPct * 100).toFixed(1)}%
                    </span>
                  </td>
                  <td className="p-3 tabular-nums">{formatCurrency(row.monthExcessIls)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
