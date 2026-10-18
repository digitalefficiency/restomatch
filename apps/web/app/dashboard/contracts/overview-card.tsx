import Link from 'next/link';
import { ArrowLeft, BellRing } from 'lucide-react';
import { Card } from '@/lib/components';
import { formatNumber } from '@/lib/i18n/format';
import { getLocale, getT } from '@/lib/i18n/server';
import { contracts as contractsNs } from '@/lib/i18n/messages/contracts';
import { getWave1Access } from './access';

/**
 * Overview teaser for open price-trend alerts (wave-1 `priceAlerts`). Renders
 * nothing unless the flag is on, the role is finance-tier and at least one
 * alert is open.
 */
export async function PriceAlertsTeaser() {
  const access = await getWave1Access();
  if (!access.priceAlerts || access.openAlerts <= 0) return null;
  const [t, locale] = await Promise.all([getT(contractsNs), getLocale()]);
  return (
    <Link
      href="/dashboard/contracts?tab=alerts"
      className="mt-4 block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
    >
      <Card elevated padding="md" className="flex flex-wrap items-center justify-between gap-3 border-danger/30 transition-colors hover:border-danger/50">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-danger/12 text-danger ring-1 ring-danger/25">
            <BellRing className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-ink">{t('overview.title')}</p>
            <p className="text-sm text-muted">
              {t('overview.body', { count: formatNumber(access.openAlerts, locale) })}
            </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 text-sm font-semibold text-primary">
          {t('overview.link')}
          <ArrowLeft className="h-4 w-4 ltr:-scale-x-100" aria-hidden="true" />
        </span>
      </Card>
    </Link>
  );
}
