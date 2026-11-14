import { Badge } from '@/lib/components';
import { formatDate, formatNumber } from '@/lib/i18n/format';
import { getLocale, getT } from '@/lib/i18n/server';
import { settings as settingsMessages } from '@/lib/i18n/messages/settings';
import type { MessageKey } from '@/lib/i18n/translate';
import { planUsageRows, trialDaysLeft, type PlanUsageInput } from './planUsage';

type SettingsKey = MessageKey<typeof settingsMessages.he>;

/**
 * W3-07a · "תוכנית ושימוש" — read-only. Data comes from settings.planUsage
 * (getEntitlements / getQuota); nothing here edits a plan or shows a price.
 * Tone: T4 neutral by default, T2 warning only at ≥90% or when blocked.
 */
export async function PlanUsageSection({ data }: { data: PlanUsageInput & { implicit: boolean } }) {
  const [t, locale] = await Promise.all([getT(settingsMessages), getLocale()]);
  const rows = planUsageRows(data);
  const days = trialDaysLeft(data, new Date());

  return (
    <div className="rounded-xl border border-line bg-surface p-5 shadow-card" data-testid="plan-usage">
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-subtle">{t('plan.planLabel')}</dt>
          <dd className="mt-0.5 font-semibold text-ink">{t(`plan.plans.${data.planKey}` as SettingsKey)}</dd>
        </div>
        <div>
          <dt className="text-xs text-subtle">{t('plan.statusLabel')}</dt>
          <dd className="mt-0.5 font-semibold text-ink">
            {t(`plan.statuses.${data.status}` as SettingsKey)}
            {days !== null ? (
              <span className="ms-2 text-xs font-normal text-muted">
                {t('plan.trialLeft', { days: formatNumber(days, locale) })}
                {data.trialEndsAt ? ` · ${formatDate(data.trialEndsAt, locale)}` : ''}
              </span>
            ) : null}
          </dd>
        </div>
      </dl>
      {data.implicit ? <p className="mt-3 text-xs text-muted">{t('plan.implicit')}</p> : null}

      <ul className="mt-4 divide-y divide-line text-sm">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center justify-between gap-3 py-2" data-row={r.key} data-tone={r.tone}>
            <span className="text-muted">{t(`plan.rows.${r.key}` as SettingsKey)}</span>
            <span className="flex items-center gap-2 tabular-nums text-ink">
              {r.limit === null
                ? t('plan.unlimited', { used: formatNumber(r.used, locale) })
                : t('plan.usedOf', { used: formatNumber(r.used, locale), limit: formatNumber(r.limit, locale) })}
              {r.tone === 'T2' ? <Badge tone="warning">{t('plan.nearLimit')}</Badge> : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
