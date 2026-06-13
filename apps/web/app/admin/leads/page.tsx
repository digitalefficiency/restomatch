import { createServerCaller } from '@/lib/trpc/server';

export default async function AdminLeadsPage() {
  const caller = await createServerCaller();
  const leads = await caller.admin.listLeads();

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold text-stone-900">לידים</h1>
      <p className="mb-6 text-sm text-stone-500">{leads.length} פניות מהאתר השיווקי</p>

      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-right text-sm">
          <thead className="border-b border-stone-200 bg-stone-50 text-xs text-stone-500">
            <tr>
              <th className="px-4 py-3 font-medium">שם</th>
              <th className="px-4 py-3 font-medium">טלפון</th>
              <th className="px-4 py-3 font-medium">מסעדה</th>
              <th className="px-4 py-3 font-medium">רכש חודשי</th>
              <th className="px-4 py-3 font-medium">מקור</th>
              <th className="px-4 py-3 font-medium">תאריך</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {leads.map((l) => (
              <tr key={l.id} className="hover:bg-stone-50">
                <td className="px-4 py-3 font-medium text-stone-800">{l.name}</td>
                <td className="px-4 py-3 tabular-nums text-stone-600">{l.phone ?? '—'}</td>
                <td className="px-4 py-3 text-stone-600">{l.restaurantName ?? '—'}</td>
                <td className="px-4 py-3 tabular-nums text-stone-600">
                  {l.monthlyProcurementAgorot
                    ? `₪${(l.monthlyProcurementAgorot / 100).toLocaleString('he-IL')}`
                    : '—'}
                </td>
                <td className="px-4 py-3 text-stone-500">{l.source ?? '—'}</td>
                <td className="px-4 py-3 text-stone-500">
                  {new Date(l.createdAt).toLocaleDateString('he-IL')}
                </td>
              </tr>
            ))}
            {leads.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-stone-400">
                  אין לידים עדיין
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
