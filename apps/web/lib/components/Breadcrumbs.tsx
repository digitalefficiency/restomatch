'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { canOpenPath } from '@/lib/nav/visibility';
import { useNavViewer } from '@/lib/nav/NavProvider';

/**
 * Detail-page breadcrumb trail. Pass the localized `label` for the nav
 * landmark. The chevron is drawn for LTR and mirrored under RTL so it always
 * points "deeper" in reading direction. Inside the dashboard a crumb whose
 * page the viewer's role can't open renders as plain text instead of a link
 * that would bounce (e.g. the ledger → ספקים crumb for a bookkeeper).
 */
export function Breadcrumbs({
  items,
  label,
}: {
  items: Array<{ label: React.ReactNode; href?: string }>;
  label: string;
}) {
  const viewer = useNavViewer();
  const canOpen = (href: string) => !viewer || canOpenPath(viewer.role, href);
  return (
    <nav aria-label={label} className="mb-3 text-sm text-muted">
      <ol className="flex min-w-0 flex-wrap items-center gap-1">
        {items.map((it, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i} className="flex min-w-0 items-center gap-1">
              {it.href && !last && canOpen(it.href) ? (
                <Link
                  href={it.href}
                  className="touch-target inline-flex items-center rounded hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                >
                  {it.label}
                </Link>
              ) : (
                <span aria-current={last ? 'page' : undefined} className={last ? 'truncate font-medium text-ink' : 'truncate'}>
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
