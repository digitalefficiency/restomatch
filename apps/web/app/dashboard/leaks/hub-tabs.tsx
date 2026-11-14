import Link from 'next/link';
import { getT } from '@/lib/i18n/server';
import { leaks as leaksNs } from '@/lib/i18n/messages/leaks';
import { cnMerge as cn } from '@/lib/components/cn';

export type HubTab = 'overview' | 'breakdown' | 'proof' | 'prices' | 'report';

const HREF: Record<HubTab, string> = {
  overview: '/dashboard/leaks',
  breakdown: '/dashboard/leaks/breakdown',
  proof: '/dashboard/leaks/proof',
  prices: '/dashboard/leaks#prices',
  report: '/dashboard/leaks/report',
};

/**
 * W2-09c · the leak area is one hub (leaks-20, ia-nav-12 scoped): the same tab
 * row on every page, with the current one marked. Rendered per page — not a
 * `leaks/layout.tsx`, which would also wrap W2-10's `leaks/claims/**`.
 * `proof` shows only with the leakProof flag; `report` only for finance roles.
 */
export async function HubTabs({
  active,
  proof = true,
  report = true,
}: {
  active: HubTab;
  proof?: boolean;
  report?: boolean;
}) {
  const t = await getT(leaksNs);
  const tabs = (['overview', 'breakdown', 'proof', 'prices', 'report'] as const).filter(
    (k) => (k !== 'proof' || proof) && (k !== 'report' || report),
  );
  return (
    <nav aria-label={t('hub.tabsLabel')} className="-mx-1 mb-4 overflow-x-auto print:hidden" data-testid="leak-hub-tabs">
      <ul className="flex min-w-max gap-1 border-b border-line px-1">
        {tabs.map((k) => (
          <li key={k}>
            <Link
              href={HREF[k]}
              aria-current={k === active ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-semibold transition-colors',
                k === active ? 'border-primary text-ink' : 'border-transparent text-muted hover:text-ink',
              )}
            >
              {t(`hub.tabs.${k}`)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
