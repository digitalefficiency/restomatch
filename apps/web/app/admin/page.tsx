import Link from 'next/link';
import { createServerCaller } from '@/lib/trpc/server';

const PLAN_LABEL: Record<string, string> = {
  trial: 'ניסיון',
  basic: 'בסיס',
  pro: 'מקצועי',
  chain: 'רשת',
};
const STATUS_LABEL: Record<string, string> = {
  trialing: 'ניסיון',
  active: 'פעיל',
  past_due: 'חוב פתוח',
  canceled: 'בוטל',
};

export default async function AdminRestaurantsPage() {
  const caller = await createServerCaller();
  const restaurants = await caller.admin.listRestaurants();

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-ink">מסעדות</h1>
      <p className="mb-6 text-sm text-muted">
        <span className="font-mono tabular-nums">{restaurants.length}</span> מסעדות במערכת
      </p>

      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        <table className="w-full text-right text-sm">
          <thead className="border-b border-line bg-surface-2 font-mono text-xs uppercase tracking-wider text-subtle">
            <tr>
              <th className="px-4 py-3 font-medium">מסעדה</th>
              <th className="px-4 py-3 font-medium">תוכנית</th>
              <th className="px-4 py-3 font-medium">סטטוס</th>
              <th className="px-4 py-3 font-medium">סריקות החודש</th>
              <th className="px-4 py-3 font-medium">משתמשים</th>
              <th className="px-4 py-3 font-medium">נוצרה</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {restaurants.map((r) => (
              <tr key={r.id} className="transition-colors hover:bg-surface-2">
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/restaurants/${r.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {r.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted">
                  {PLAN_LABEL[r.planKey] ?? r.planKey}
                  {r.implicit ? <span className="mr-1 text-xs text-subtle">(משתמע)</span> : null}
                </td>
                <td className="px-4 py-3 text-muted">{STATUS_LABEL[r.status] ?? r.status}</td>
                <td className="px-4 py-3 font-mono tabular-nums text-ink">{r.ocrScansThisMonth}</td>
                <td className="px-4 py-3 font-mono tabular-nums text-ink">{r.members}</td>
                <td className="px-4 py-3 font-mono tabular-nums text-subtle">
                  {new Date(r.createdAt).toLocaleDateString('he-IL')}
                </td>
              </tr>
            ))}
            {restaurants.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-subtle">
                  אין מסעדות עדיין
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
