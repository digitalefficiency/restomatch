'use client';

import { usePathname } from 'next/navigation';
import { LinkButton } from '@/lib/components';
import { useT } from '@/lib/i18n/client';
import { nav } from '@/lib/i18n/messages/nav';
import { trpc } from '@/lib/trpc/client';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const KINDS: { re: RegExp; kind: 'invoice' | 'po' | 'supplier' | 'count' }[] = [
  { re: new RegExp(`^/dashboard/invoices/(${UUID})(?:/|$)`, 'i'), kind: 'invoice' },
  { re: new RegExp(`^/dashboard/orders/(${UUID})(?:/|$)`, 'i'), kind: 'po' },
  { re: new RegExp(`^/dashboard/suppliers/(${UUID})(?:/|$)`, 'i'), kind: 'supplier' },
  { re: new RegExp(`^/dashboard/inventory/(${UUID})(?:/|$)`, 'i'), kind: 'count' },
];

/** The record a 404'd dashboard path names, if it is one `nav.whereIs` can look up. */
export function recordOfPath(pathname: string): { kind: 'invoice' | 'po' | 'supplier' | 'count'; id: string } | null {
  for (const k of KINDS) {
    const m = k.re.exec(pathname);
    if (m) return { kind: k.kind, id: m[1]!.toLowerCase() };
  }
  return null;
}

/**
 * In-shell 404 (W2-08 §5.6): if the record is in another branch the viewer is a
 * member of, say so and offer "פתחו שם" through the branch-aware
 * `/dashboard/go?r=&to=` link. Otherwise (foreign tenant, or no such id — the
 * server answers both the same) it renders nothing.
 */
export function WhereIs() {
  const t = useT(nav);
  const pathname = usePathname() ?? '';
  const rec = recordOfPath(pathname);
  const q = trpc.nav.whereIs.useQuery(rec ?? { kind: 'invoice', id: '00000000-0000-0000-0000-000000000000' }, {
    enabled: rec !== null,
    retry: false,
    staleTime: 60_000,
  });
  if (!rec || !q.data?.found) return null;
  const href = `/dashboard/go?${new URLSearchParams({ r: q.data.restaurantId, to: q.data.path }).toString()}`;
  return (
    <div data-testid="where-is" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2">
      <p className="text-sm text-ink">
        {t('whereIs.belongs', { branch: '⁨' + q.data.name + '⁩' })}
      </p>
      <LinkButton href={href} variant="primary" className="min-h-[44px]" data-testid="where-is-open">
        {t('whereIs.open')}
      </LinkButton>
    </div>
  );
}
