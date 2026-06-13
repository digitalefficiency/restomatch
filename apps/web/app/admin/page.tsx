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
      <h1 className="mb-1 text-2xl font-semibold text-stone-900">מסעדות</h1>
      <p className="mb-6 text-sm text-stone-500">{restaurants.length} מסעדות במערכת</p>

      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-right text-sm">
          <thead className="border-b border-stone-200 bg-stone-50 text-xs text-stone-500">
            <tr>
              <th className="px-4 py-3 font-medium">מסעדה</th>
              <th className="px-4 py-3 font-medium">תוכנית</th>
              <th className="px-4 py-3 font-medium">סטטוס</th>
              <th className="px-4 py-3 font-medium">סריקות החודש</th>
              <th className="px-4 py-3 font-medium">משתמשים</th>
              <th className="px-4 py-3 font-medium">נוצרה</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {restaurants.map((r) => (
              <tr key={r.id} className="hover:bg-stone-50">
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/restaurants/${r.id}`}
                    className="font-medium text-emerald-700 hover:underline"
                  >
                    {r.name}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  {PLAN_LABEL[r.planKey] ?? r.planKey}
                  {r.implicit ? <span className="mr-1 text-xs text-stone-400">(משתמע)</span> : null}
                </td>
                <td className="px-4 py-3">{STATUS_LABEL[r.status] ?? r.status}</td>
                <td className="px-4 py-3 tabular-nums">{r.ocrScansThisMonth}</td>
                <td className="px-4 py-3 tabular-nums">{r.members}</td>
                <td className="px-4 py-3 text-stone-500">
                  {new Date(r.createdAt).toLocaleDateString('he-IL')}
                </td>
              </tr>
            ))}
            {restaurants.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-stone-400">
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
