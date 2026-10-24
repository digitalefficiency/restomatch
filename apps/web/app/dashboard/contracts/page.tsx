import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServerCaller } from '@/lib/trpc/server';
import { Badge, SectionHeader, cn } from '@/lib/components';
import { formatNumber } from '@/lib/i18n/format';
import { getLocale, getT } from '@/lib/i18n/server';
import { contracts as contractsNs } from '@/lib/i18n/messages/contracts';
import { getWave1Access } from './access';
import { AlertsPanel } from './alerts-panel';
import { ContractsPanel } from './contracts-panel';
import { resolveTab, visibleTabs } from './logic';
import { OverContractCard } from './over-contract';
import { ThresholdsPanel } from './thresholds-panel';

export const dynamic = 'force-dynamic';

/**
 * Contracts & price alerts (wave-1 `contracts` + `priceAlerts`).
 * URL-driven tabs (?tab=contracts|alerts|thresholds); a tab whose feature flag
 * is off is hidden, and the whole page 404s when both are off or the role is
 * not finance-tier (receiver/chef are already redirected by the middleware via
 * ROUTE_ROLES).
 */
export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const access = await getWave1Access();
  const tabs = visibleTabs(access);
  if (!access.finance || tabs.length === 0) notFound();
  const { tab: rawTab } = await searchParams;
  const tab = resolveTab(rawTab, tabs)!;

  const caller = await createServerCaller();
  const [t, locale, suppliers] = await Promise.all([
    getT(contractsNs),
    getLocale(),
    caller.suppliers.list({}),
  ]);
  const supplierOptions = suppliers.map((s) => ({ id: s.id, name: s.name, nameEn: s.nameEn }));

  return (
    <div>
      <SectionHeader level={1} title={t('title')} subtitle={t('subtitle')} />

      <nav aria-label={t('tabs.label')} className="mb-6 overflow-x-auto border-b border-line">
        <ul className="flex gap-1">
          {tabs.map((key) => (
            <li key={key}>
              <Link
                aria-current={tab === key ? 'page' : undefined}
                href={`/dashboard/contracts?tab=${key}`}
                scroll={false}
                className={cn(
                  '-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2 text-sm font-semibold transition-colors',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
                  tab === key ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-ink',
                )}
              >
                {t(`tabs.${key}`)}
                {key === 'alerts' && access.openAlerts > 0 ? (
                  <Badge tone="danger">{formatNumber(access.openAlerts, locale)}</Badge>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {tab === 'contracts' ? (
        <>
          <ContractsPanel suppliers={supplierOptions} canManage={access.canManage} />
          <OverContractCard />
        </>
      ) : tab === 'alerts' ? (
        <AlertsPanel canManage={access.canManage} />
      ) : (
        <ThresholdsPanel suppliers={supplierOptions} canManage={access.canManage} />
      )}
    </div>
  );
}
