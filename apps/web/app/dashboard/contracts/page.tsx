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
import { QueuePanel } from './queue-panel';
import { ThresholdsPanel } from './thresholds-panel';

export const dynamic = 'force-dynamic';

/**
 * Contracts & price alerts (wave-1 `contracts` + `priceAlerts`; W2-12 queue).
 * URL-driven tabs (?tab=queue|contracts|alerts|thresholds) — "לטיפול" (queue)
 * is first and default; the legacy keys keep working (home teaser, e-mails).
 * A tab whose feature flag is off is hidden, and the whole page 404s when both
 * are off or the role is not finance-tier (receiver/chef are already
 * redirected by the middleware via ROUTE_ROLES).
 */
export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; add?: string }>;
}) {
  const access = await getWave1Access();
  const tabs = visibleTabs(access);
  if (!access.finance || tabs.length === 0) notFound();
  const { tab: rawTab, add } = await searchParams;
  const tab = resolveTab(rawTab, tabs)!;

  const caller = await createServerCaller();
  const [t, locale, suppliers, queue] = await Promise.all([
    getT(contractsNs),
    getLocale(),
    caller.suppliers.list({}),
    tab === 'queue' ? caller.contracts.queue() : Promise.resolve(null),
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
                  // Focus: the global :focus-visible ring (--c-focus, ≥3:1). Min 44 px target.
                  '-mb-px inline-flex min-h-11 items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2 text-sm font-semibold transition-colors',
                  tab === key ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-ink',
                )}
              >
                {t(`tabs.${key}`)}
                {key === 'alerts' && access.openAlerts > 0 ? (
                  <Badge tone="neutral">{formatNumber(access.openAlerts, locale)}</Badge>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {tab === 'queue' && queue ? (
        <QueuePanel initial={queue} canManage={access.canManage} />
      ) : tab === 'contracts' ? (
        <ContractsPanel suppliers={supplierOptions} canManage={access.canManage} startAdding={add === '1'} />
      ) : tab === 'alerts' ? (
        <AlertsPanel canManage={access.canManage} />
      ) : (
        <ThresholdsPanel suppliers={supplierOptions} canManage={access.canManage} />
      )}
    </div>
  );
}
