import { createServerCaller } from '@/lib/trpc/server';
import { formatDate, formatNumber } from '@/lib/i18n/format';
import { admin } from '@/lib/i18n/messages/admin';
import { getLocale, getT } from '@/lib/i18n/server';
import { formatIls } from '@/lib/money';
import { isAdmin2faRequired, TwoFactorRequired } from '../TwoFactorRequired';
import { LeadEraseButton } from './erase-button';

export default async function AdminLeadsPage() {
  const caller = await createServerCaller();
  // No authenticator yet: show the enrol prompt instead of a refused admin call.
  if (!(await caller.admin.twoFactorStatus()).enabled) return <TwoFactorRequired />;
  let leads;
  try {
    leads = await caller.admin.listLeads();
  } catch (err) {
    if (isAdmin2faRequired(err)) return <TwoFactorRequired />;
    throw err;
  }
  const [t, locale] = await Promise.all([getT(admin), getLocale()]);

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-ink">{t('leads.title')}</h1>
      <p className="mb-6 text-sm text-muted">{t('leads.count', { count: formatNumber(leads.length, locale) })}</p>

      <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-card">
        <table className="w-full text-start text-sm">
          <thead className="border-b border-line bg-surface-2 font-mono text-xs uppercase tracking-wider text-subtle">
            <tr>
              <th className="px-4 py-3 text-start font-medium">{t('leads.colName')}</th>
              <th className="px-4 py-3 text-start font-medium">{t('leads.colContact')}</th>
              <th className="px-4 py-3 text-start font-medium">{t('leads.colRestaurant')}</th>
              <th className="px-4 py-3 text-start font-medium">{t('leads.colSpend')}</th>
              <th className="px-4 py-3 text-start font-medium">{t('leads.colSource')}</th>
              <th className="px-4 py-3 text-start font-medium">{t('leads.colDate')}</th>
              <th className="px-4 py-3 text-start font-medium">{t('leads.colPrivacy')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {leads.map((l) => (
              <tr key={l.id} className="transition-colors hover:bg-surface-2">
                <td className="px-4 py-3 font-medium text-ink">
                  {l.name}
                  {l.marketingConsent && !l.unsubscribedAt ? (
                    <span className="block text-xs font-normal text-subtle">{t('leads.consent')}</span>
                  ) : l.unsubscribedAt ? (
                    <span className="block text-xs font-normal text-subtle">{t('leads.unsubscribed')}</span>
                  ) : null}
                </td>
                <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted" dir="ltr">
                  {l.phone ? (
                    <a href={`tel:${l.phone.replace(/[^\d+]/g, '')}`} className="block hover:text-ink">
                      {l.phone}
                    </a>
                  ) : null}
                  {l.email ? (
                    <a href={`mailto:${l.email}`} className="block hover:text-ink">
                      {l.email}
                    </a>
                  ) : null}
                  {!l.phone && !l.email ? '—' : null}
                </td>
                <td className="px-4 py-3 text-muted">{l.restaurantName ?? '—'}</td>
                <td className="px-4 py-3 font-mono tabular-nums text-gold">
                  {l.monthlyProcurementAgorot
                    ? formatIls(l.monthlyProcurementAgorot / 100, { maximumFractionDigits: 0, locale })
                    : '—'}
                </td>
                <td className="px-4 py-3 text-subtle">{l.source ?? '—'}</td>
                <td className="px-4 py-3 font-mono tabular-nums text-subtle">{formatDate(l.createdAt, locale)}</td>
                <td className="px-4 py-3">
                  <LeadEraseButton leadId={l.id} />
                </td>
              </tr>
            ))}
            {leads.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-subtle">
                  <p className="font-medium text-muted">{t('leads.empty')}</p>
                  <p className="mt-1 text-xs">{t('leads.emptyHint')}</p>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
