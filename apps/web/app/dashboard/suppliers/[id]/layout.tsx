import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { TRPCError } from '@trpc/server';
import { createServerCaller } from '@/lib/trpc/server';
import { Badge, Breadcrumbs, displayName } from '@/lib/components';
import { components } from '@/lib/i18n/messages/components';
import { suppliers as suppliersNs } from '@/lib/i18n/messages/suppliers';
import { getLocale, getT } from '@/lib/i18n/server';
import { formatIls } from '@/lib/money';
import { SupplierTabBar } from './tab-bar';
import { getWave1Access } from '../../contracts/access';

export const dynamic = 'force-dynamic';

/**
 * Supplier-as-hub shell. Loads the supplier (404 via notFound() when missing —
 * ownership is enforced server-side in suppliers.get), renders the breadcrumb +
 * header (name, active badge, real-leak ₪ figure), and the URL-driven tab bar.
 * The four tab panels render as `children` per ?tab=.
 *
 * The ₪ leak figure is the supplier's real month-excess from owner.leaks
 * (advanced_analytics-gated). When the gate is closed or there's not enough
 * data, it renders muted — never an estimate.
 */
export default async function SupplierDetailLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}) {
  const { id } = await params;
  const caller = await createServerCaller();
  const [t, tc, locale] = await Promise.all([getT(suppliersNs), getT(components), getLocale()]);

  let supplier;
  try {
    supplier = await caller.suppliers.get({ supplierId: id });
  } catch (err) {
    if (err instanceof TRPCError && (err.code === 'NOT_FOUND' || err.code === 'BAD_REQUEST')) {
      notFound();
    }
    throw err;
  }

  // Real-leak ₪ for this supplier: what was actually PAID above the 90-day
  // median over the last 30 days (paidExcessIls) — the same basis as the leaks
  // page. monthExcessIls is a projection that re-prices past purchases at the
  // latest price and overstated this header (₪328 vs ₪144 paid for HaKerem).
  // owner.leaks is advanced_analytics-gated — a closed gate (or any error) just
  // leaves the figure muted; we never fabricate a number.
  let leakIls: number | null = null;
  const role = (
    (await auth())?.user as { role?: string } | undefined
  )?.role;
  try {
    if (role !== 'owner') throw new Error('owner-only');
    const leaks = await caller.owner.leaks({ limit: 100 });
    const rows = leaks.filter((l) => l.supplierId === id);
    leakIls =
      rows.length > 0
        ? rows.reduce((agorot, l) => agorot + Math.round(l.paidExcessIls * 100), 0) / 100
        : null;
  } catch {
    leakIls = null;
  }

  const name = displayName(supplier.name, supplier.nameEn, locale);
  // Wave-1 contract tab: `contracts` flag on + finance role (fails silent → hidden).
  const showContract = (await getWave1Access()).contracts;

  return (
    <div className="space-y-6">
      <Breadcrumbs
        label={tc('breadcrumbs.label')}
        items={[{ label: t('detail.breadcrumb'), href: '/dashboard/suppliers' }, { label: name.primary }]}
      />

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-2 h-0.5 w-10 rounded-full flow-stream" aria-hidden="true" />
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="truncate text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
              {name.primary}
            </h1>
            <Badge tone={supplier.active ? 'accent' : 'neutral'}>
              {supplier.active ? t('detail.active') : t('detail.inactive')}
            </Badge>
            {supplier.sourcePlatform && <Badge tone="info">{supplier.sourcePlatform}</Badge>}
          </div>
          {name.secondary ? (
            <p className="mt-1 text-sm text-subtle" lang="he">
              {name.secondary}
            </p>
          ) : null}
        </div>
        <div className="shrink-0 text-end">
          <p className="text-xs text-subtle">{t('detail.leakLabel')}</p>
          {leakIls != null ? (
            <p className="font-mono text-2xl font-bold tabular-nums text-warn">
              {formatIls(leakIls, { locale })}
            </p>
          ) : (
            <p className="text-sm text-subtle">{t('detail.leakNone')}</p>
          )}
        </div>
      </header>

      <SupplierTabBar
        supplierId={id}
        showContract={showContract}
        leakTab={supplier.leakCardEnabled}
        ledgerTab={supplier.ledgerEnabled}
      />

      <div>{children}</div>
    </div>
  );
}
