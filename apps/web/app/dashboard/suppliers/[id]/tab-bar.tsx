'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/components';
import { useT } from '@/lib/i18n/client';
import { suppliers } from '@/lib/i18n/messages/suppliers';
import { resolveSupplierTab, supplierTabs, type SupplierTab } from './tab-model';

export type { SupplierTab } from './tab-model';

/**
 * URL-driven tab bar (W2-11): סקירה · מחירים · הזמנות · כרטסת · פרטים. Real
 * <Link>s, so the active tab is refresh-stable and shareable; old `?tab=`
 * values highlight their new home. `ledgerTab` adds the ledger (flag
 * `supplierLedger`).
 */
export function SupplierTabBar({ supplierId, ledgerTab = false }: { supplierId: string; ledgerTab?: boolean }) {
  const TABS = supplierTabs({ ledger: ledgerTab });
  const t = useT(suppliers);
  const params = useSearchParams();
  // The print card (/suppliers/[id]/leak-card) belongs to the overview.
  const raw = usePathname().endsWith('/leak-card') ? 'leak' : params.get('tab');
  const active: SupplierTab = resolveSupplierTab(raw, { ledger: ledgerTab });
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
                'touch-target -mb-px inline-block whitespace-nowrap border-b-2 px-4 py-2 text-sm font-semibold transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--c-focus))]',
                active === key ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-ink',
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
