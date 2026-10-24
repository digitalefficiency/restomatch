'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/components';
import { useT } from '@/lib/i18n/client';
import { suppliers } from '@/lib/i18n/messages/suppliers';

export type SupplierTab = 'details' | 'catalog' | 'schedule' | 'orders' | 'leak';

const BASE_TABS: SupplierTab[] = ['details', 'catalog', 'schedule', 'orders'];

/**
 * URL-driven tab bar (?tab=details|catalog|schedule|orders). Uses real <Link>s
 * so the active tab is refresh-stable and shareable; the page reads searchParams
 * to render the matching panel server-side. Scrolls horizontally on phones.
 */
export function SupplierTabBar({ supplierId, leakTab = false }: { supplierId: string; leakTab?: boolean }) {
  // Flag `supplierLeakCard` adds the "Leak" tab.
  const TABS: SupplierTab[] = leakTab ? [...BASE_TABS, 'leak'] : BASE_TABS;
  const t = useT(suppliers);
  const params = useSearchParams();
  // The print card (/suppliers/[id]/leak-card) belongs to the Leak tab.
  const raw = usePathname().endsWith('/leak-card') ? 'leak' : params.get('tab');
  const active: SupplierTab = TABS.includes(raw as SupplierTab) ? (raw as SupplierTab) : 'details';
  // Phones scroll the row: keep the active tab (e.g. the last one, Leak) on screen.
  const activeRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);

  return (
    <nav aria-label={t('detail.tabsLabel')} className="overflow-x-auto border-b border-line">
      <ul className="flex gap-1">
        {TABS.map((key) => (
          <li key={key}>
            <Link
              ref={active === key ? activeRef : undefined}
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
              {t(`detail.tabs.${key}`)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
