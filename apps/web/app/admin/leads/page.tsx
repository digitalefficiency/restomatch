import { createServerCaller } from '@/lib/trpc/server';
import { LeadEraseButton } from './erase-button';

export default async function AdminLeadsPage() {
  const caller = await createServerCaller();
  const leads = await caller.admin.listLeads();

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-ink">לידים</h1>
      <p className="mb-6 text-sm text-muted">
        <span className="font-mono tabular-nums">{leads.length}</span> פניות מהאתר השיווקי
      </p>

      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        <table className="w-full text-right text-sm">
          <thead className="border-b border-line bg-surface-2 font-mono text-xs uppercase tracking-wider text-subtle">
            <tr>
              <th className="px-4 py-3 font-medium">שם</th>
              <th className="px-4 py-3 font-medium">טלפון</th>
              <th className="px-4 py-3 font-medium">מסעדה</th>
              <th className="px-4 py-3 font-medium">רכש חודשי</th>
              <th className="px-4 py-3 font-medium">מקור</th>
              <th className="px-4 py-3 font-medium">תאריך</th>
              <th className="px-4 py-3 font-medium">פרטיות</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {leads.map((l) => (
              <tr key={l.id} className="transition-colors hover:bg-surface-2">
                <td className="px-4 py-3 font-medium text-ink">{l.name}</td>
                <td className="px-4 py-3 font-mono tabular-nums text-muted">{l.phone ?? '—'}</td>
                <td className="px-4 py-3 text-muted">{l.restaurantName ?? '—'}</td>
                <td className="px-4 py-3 font-mono tabular-nums text-gold">
                  {l.monthlyProcurementAgorot
                    ? `₪${(l.monthlyProcurementAgorot / 100).toLocaleString('he-IL')}`
                    : '—'}
                </td>
                <td className="px-4 py-3 text-subtle">{l.source ?? '—'}</td>
                <td className="px-4 py-3 font-mono tabular-nums text-subtle">
                  {new Date(l.createdAt).toLocaleDateString('he-IL')}
                </td>
                <td className="px-4 py-3">
                  <LeadEraseButton leadId={l.id} />
                </td>
              </tr>
            ))}
            {leads.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-subtle">
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
