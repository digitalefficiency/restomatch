import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

/**
 * Detail-page breadcrumb trail. Server-safe; pass the localized `label` for the
 * nav landmark. The chevron is drawn for LTR and mirrored under RTL so it always
 * points "deeper" in reading direction.
 */
export function Breadcrumbs({
  items,
  label,
}: {
  items: Array<{ label: React.ReactNode; href?: string }>;
  label: string;
}) {
  return (
    <nav aria-label={label} className="mb-3 text-sm text-muted">
      <ol className="flex min-w-0 flex-wrap items-center gap-1">
        {items.map((it, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i} className="flex min-w-0 items-center gap-1">
              {it.href && !last ? (
                <Link
                  href={it.href}
                  className="rounded hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                >
                  {it.label}
                </Link>
              ) : (
                <span aria-current={last ? 'page' : undefined} className="truncate font-medium text-ink">
                  {it.label}
                </span>
              )}
              {!last ? (
                <ChevronRight className="h-4 w-4 shrink-0 text-subtle rtl:-scale-x-100" aria-hidden="true" />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
