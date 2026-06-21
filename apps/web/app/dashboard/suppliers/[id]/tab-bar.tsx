'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { cn } from '@/lib/components';

export type SupplierTab = 'details' | 'catalog' | 'schedule' | 'orders';

const TABS: { key: SupplierTab; label: string }[] = [
  { key: 'details', label: 'פרטים' },
  { key: 'catalog', label: 'קטלוג' },
  { key: 'schedule', label: 'לוח הזמנות' },
  { key: 'orders', label: 'הזמנות' },
];

/**
 * URL-driven tab bar (?tab=details|catalog|schedule|orders). Uses real <Link>s
 * so the active tab is refresh-stable and shareable; the page reads searchParams
 * to render the matching panel server-side.
 */
export function SupplierTabBar({ supplierId }: { supplierId: string }) {
  const params = useSearchParams();
  const raw = params.get('tab');
  const active: SupplierTab = TABS.some((t) => t.key === raw)
    ? (raw as SupplierTab)
    : 'details';

  return (
    <div role="tablist" aria-label="תצוגת ספק" className="flex gap-1 border-b border-line">
      {TABS.map((t) => (
        <Link
          key={t.key}
          role="tab"
          aria-selected={active === t.key}
          href={`/dashboard/suppliers/${supplierId}?tab=${t.key}`}
          scroll={false}
          className={cn(
            '-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition-colors',
            active === t.key
              ? 'border-primary text-primary'
              : 'border-transparent text-muted hover:text-ink',
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
