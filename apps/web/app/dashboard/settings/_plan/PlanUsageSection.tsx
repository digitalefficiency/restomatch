import { Badge } from '@/lib/components';
import { formatDate, formatNumber } from '@/lib/i18n/format';
import { getLocale, getT } from '@/lib/i18n/server';
import { settings as settingsMessages } from '@/lib/i18n/messages/settings';
import type { MessageKey } from '@/lib/i18n/translate';
import { planUsageRows, trialDaysLeft, type PlanUsageInput } from './planUsage';
import { PlanUsageFold } from './PlanUsageFold';

type SettingsKey = MessageKey<typeof settingsMessages.he>;

/**
 * W3-07a · "תוכנית ושימוש" — read-only. Data comes from settings.planUsage
 * (getEntitlements / getQuota); nothing here edits a plan or shows a price.
 * The plan and status are always visible (tenant data, [data-record]); the usage
 * rows sit in a "פרטים" fold. Tone: T4 neutral, T2 warning only at ≥90% or blocked.
 */
export async function PlanUsageSection({ data }: { data: PlanUsageInput & { implicit: boolean } }) {
  const [t, locale] = await Promise.all([getT(settingsMessages), getLocale()]);
  const rows = planUsageRows(data);
  const days = trialDaysLeft(data, new Date());
  const warn = rows.some((r) => r.tone === 'T2');

  return (
    <div className="rounded-xl border border-line bg-surface p-5 shadow-card" data-testid="plan-usage">
      <PlanUsageFold
        about={t('plan.title')}
        summary={
          <p className="flex items-center gap-2 text-sm font-semibold text-ink" data-record="">
            {t(`plan.plans.${data.planKey}` as SettingsKey)} · {t(`plan.statuses.${data.status}` as SettingsKey)}
            {warn ? <Badge tone="warning">{t('plan.nearLimit')}</Badge> : null}
          </p>
        }
      >
        {days !== null ? (
          <p className="mt-2 text-xs text-muted" data-record="">
            {t('plan.trialLeft', { days: formatNumber(days, locale) })}
            {data.trialEndsAt ? ` · ${formatDate(data.trialEndsAt, locale)}` : ''}
          </p>
        ) : null}
        {data.implicit ? <p className="mt-2 text-xs text-muted">{t('plan.implicit')}</p> : null}
        <ul className="mt-3 divide-y divide-line text-sm">
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
      </PlanUsageFold>
    </div>
  );
}
