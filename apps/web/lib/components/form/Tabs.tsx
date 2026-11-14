import Link from 'next/link';
import { cnMerge as cn } from '../cn';

export interface TabItem {
  href: string;
  label: React.ReactNode;
  count?: number;
  current?: boolean;
}

/**
 * In-page navigation tabs (links, so each view has a URL), in the clean finish (DS3 kit
 * "לשוניות ומסננים"): every tab says how many wait in it — also when that is zero — as a quiet
 * number; the current one is ink with a 2 px ink underline and `aria-current="page"`. 44 px on
 * coarse pointers. Scrolls sideways on narrow screens instead of wrapping.
 */
export function Tabs({ items, label, className }: { items: TabItem[]; label: string; className?: string }) {
  return (
    <nav aria-label={label} className={cn('border-b border-line-rule', className)}>
      <ul className="-mb-px flex gap-5 overflow-x-auto">
        {items.map((it) => (
          <li key={it.href} className="shrink-0">
            <Link
              href={it.href}
              aria-current={it.current ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-10 items-center border-b-2 pb-2.5 pt-2 text-body-sm font-medium transition-colors duration-micro ease-standard [@media(pointer:coarse)]:min-h-11',
                it.current ? 'border-fg text-fg' : 'border-transparent text-fg-secondary hover:text-fg',
              )}
            >
              {it.label}
              {typeof it.count === 'number' && Number.isFinite(it.count) ? (
                <span className="num ms-1.5 font-normal text-fg-tertiary">{it.count}</span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
