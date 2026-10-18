'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { cn } from '@/lib/components';
import { useT } from '@/lib/i18n/client';
import { suppliers } from '@/lib/i18n/messages/suppliers';
import { contracts } from '@/lib/i18n/messages/contracts';

export type SupplierTab = 'details' | 'catalog' | 'schedule' | 'orders' | 'contract';

const BASE_TABS: SupplierTab[] = ['details', 'catalog', 'schedule', 'orders'];

/**
 * URL-driven tab bar (?tab=details|catalog|schedule|orders). Uses real <Link>s
 * so the active tab is refresh-stable and shareable; the page reads searchParams
 * to render the matching panel server-side. Scrolls horizontally on phones.
 * `showContract` adds the wave-1 "contract" tab (flag + finance role, decided
 * server-side by the layout).
 */
export function SupplierTabBar({ supplierId, showContract = false }: { supplierId: string; showContract?: boolean }) {
  const t = useT(suppliers);
  const tContracts = useT(contracts);
  const TABS: SupplierTab[] = showContract ? [...BASE_TABS, 'contract'] : BASE_TABS;
  const params = useSearchParams();
  const raw = params.get('tab');
  const active: SupplierTab = TABS.includes(raw as SupplierTab) ? (raw as SupplierTab) : 'details';

  return (
    <nav aria-label={t('detail.tabsLabel')} className="overflow-x-auto border-b border-line">
      <ul className="flex gap-1">
        {TABS.map((key) => (
          <li key={key}>
            <Link
              aria-current={active === key ? 'page' : undefined}
              href={`/dashboard/suppliers/${supplierId}?tab=${key}`}
              scroll={false}
              className={cn(
                '-mb-px inline-block whitespace-nowrap border-b-2 px-4 py-2 text-sm font-semibold transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
                active === key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted hover:text-ink',
              )}
            >
              {key === 'contract' ? tContracts('supplierTab.tab') : t(`detail.tabs.${key}`)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
