import Link from 'next/link';
import { createServerCaller } from '@/lib/trpc/server';
import { formatDate, formatNumber } from '@/lib/i18n/format';
import { admin } from '@/lib/i18n/messages/admin';
import { getLocale, getT } from '@/lib/i18n/server';
import type { MessageKey } from '@/lib/i18n/translate';
import { isAdmin2faRequired, TwoFactorRequired } from './TwoFactorRequired';

type AdminKey = MessageKey<typeof admin.he>;

export default async function AdminRestaurantsPage() {
  const caller = await createServerCaller();
  // No authenticator yet: show the enrol prompt instead of a refused admin call.
  if (!(await caller.admin.twoFactorStatus()).enabled) return <TwoFactorRequired />;
  let restaurants;
  try {
    restaurants = await caller.admin.listRestaurants();
  } catch (err) {
    if (isAdmin2faRequired(err)) return <TwoFactorRequired />;
    throw err;
  }
  const [t, locale] = await Promise.all([getT(admin), getLocale()]);
  const plan = (key: string) => t(`plans.${key}` as AdminKey);
  const status = (key: string) => t(`statuses.${key}` as AdminKey);

  const kpis = [
    { label: t('list.kpiTotal'), value: restaurants.length },
    { label: t('list.kpiPaying'), value: restaurants.filter((r) => !r.implicit && r.status === 'active').length },
    { label: t('list.kpiImplicit'), value: restaurants.filter((r) => r.implicit).length },
    { label: t('list.kpiMembers'), value: restaurants.reduce((sum, r) => sum + r.members, 0) },
  ];

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-ink">{t('list.title')}</h1>
      <p className="mb-6 text-sm text-muted">
        {t('list.count', { count: formatNumber(restaurants.length, locale) })}
      </p>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border border-line bg-surface p-4 shadow-card">
            <p className="text-xs text-subtle">{k.label}</p>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-ink">
              {formatNumber(k.value, locale)}
            </p>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-card">
        <table className="w-full text-start text-sm">
          <thead className="border-b border-line bg-surface-2 font-mono text-xs uppercase tracking-wider text-subtle">
            <tr>
              <th className="px-4 py-3 text-start font-medium">{t('list.colRestaurant')}</th>
              <th className="px-4 py-3 text-start font-medium">{t('list.colPlan')}</th>
              <th className="px-4 py-3 text-start font-medium">{t('list.colStatus')}</th>
              <th className="px-4 py-3 text-start font-medium">{t('list.colScans')}</th>
              <th className="px-4 py-3 text-start font-medium">{t('list.colMembers')}</th>
              <th className="px-4 py-3 text-start font-medium">{t('list.colCreated')}</th>
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
                  {plan(r.planKey)}
                  {r.implicit ? <span className="ms-1 text-xs text-subtle">{t('list.implicit')}</span> : null}
                </td>
                <td className="px-4 py-3 text-muted">
                  {status(r.status)}
                  {r.trialEndsAt ? (
                    <span className="block text-xs text-subtle">
                      {t('list.trialEnds', { date: formatDate(r.trialEndsAt, locale) })}
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3 font-mono tabular-nums text-ink">
                  {formatNumber(r.ocrScansThisMonth, locale)}
                </td>
                <td className="px-4 py-3 font-mono tabular-nums text-ink">{formatNumber(r.members, locale)}</td>
                <td className="px-4 py-3 font-mono tabular-nums text-subtle">
                  {formatDate(r.createdAt, locale)}
                </td>
              </tr>
            ))}
            {restaurants.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-subtle">
                  <p className="font-medium text-muted">{t('list.empty')}</p>
                  <p className="mt-1 text-xs">{t('list.emptyHint')}</p>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
