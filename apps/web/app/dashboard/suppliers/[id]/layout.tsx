import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { TRPCError } from '@trpc/server';
import { createServerCaller } from '@/lib/trpc/server';
import Link from 'next/link';
import { MessageCircle, Phone } from 'lucide-react';
import { Badge, Breadcrumbs, LinkButton, displayName } from '@/lib/components';
import { Money } from '@/lib/components/money';
import { waLink } from '@/lib/messageTemplates';
import { components } from '@/lib/i18n/messages/components';
import { suppliers as suppliersNs } from '@/lib/i18n/messages/suppliers';
import { getLocale, getT } from '@/lib/i18n/server';
import { formatIls } from '@/lib/money';
import { formatPercent } from '@/lib/i18n/format';
import { SupplierTabBar } from './tab-bar';
import { loadSupplierOverview } from './overview-data';
import { telHref } from '../terms';

export const dynamic = 'force-dynamic';

/**
 * Supplier-as-hub shell. Loads the supplier (404 via notFound() when missing —
 * ownership is enforced server-side in suppliers.get), renders the breadcrumb +
 * header (name, active badge, the 90-day leak ₪, [וואטסאפ] [חיוג] and the
 * primary [הזמנה חדשה]) and the URL-driven tab bar (W2-11). The tab panels
 * render as `children` per ?tab=.
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

  // W2-11 · ONE 90-day leak ₪ — suppliers.overview, the same figure as the
  // leak card and owner.leakGrouped for this supplier (finance roles; null =
  // unavailable, never ₪0). The overview tab reuses this cached load.
  const overview = await loadSupplierOverview(id);
  const role = ((await auth())?.user as { role?: string } | undefined)?.role;
  const canOrder = role === 'owner' || role === 'manager' || role === 'chef';

  const name = displayName(supplier.name, supplier.nameEn, locale);
  const phone = supplier.contactWhatsapp?.trim() || null;

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
            <h1 title={name.primary} className="truncate text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
              {name.primary}
            </h1>
            <Badge tone={supplier.active ? 'accent' : 'neutral'}>
              {supplier.active ? t('detail.active') : t('detail.inactive')}
            </Badge>
            {supplier.sourcePlatform && <Badge tone="info">{supplier.sourcePlatform}</Badge>}
            <Badge tone="neutral">
              <span className="tabular-nums" data-testid="supplier-vat">
                {supplier.vatRate === null
                  ? t('detail.vatDefault')
                  : t('detail.vat', { rate: formatPercent(Number(supplier.vatRate), locale, 2) })}
              </span>
            </Badge>
          </div>
          {name.secondary ? (
            <p className="mt-1 text-sm text-subtle" lang="he">
              {name.secondary}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-3 sm:items-end">
          <div className="text-end" data-testid="supplier-leak-header" data-agorot={overview?.leakAgorot}>
            <p className="text-xs text-subtle">{t('overview.leakLabel')}</p>
            {overview ? (
              <>
                <Money agorot={overview.leakAgorot} context="hero" decimals={2} locale={locale} className="text-3xl font-extrabold" />
                {overview.leakAgorot > 0 && supplier.leakCardEnabled ? (
                  <Link
                    href={`/dashboard/suppliers/${id}?tab=overview#leak-card`}
                    className="block text-xs font-semibold text-primary underline-offset-2 hover:underline"
                  >
                    {t('overview.leakHow', { amount: formatIls(overview.leakAgorot / 100, { locale, maximumFractionDigits: 2 }) })}
                  </Link>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-subtle">{t('detail.leakNone')}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            {phone ? (
              <>
                <LinkButton href={waLink(phone, '')} variant="secondary" size="md" target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="h-4 w-4" aria-hidden="true" /> {t('overview.whatsapp')}
                </LinkButton>
                <LinkButton href={telHref(phone)} variant="secondary" size="md">
                  <Phone className="h-4 w-4" aria-hidden="true" /> {t('overview.call')}
                </LinkButton>
              </>
            ) : null}
            {canOrder ? (
              <LinkButton href={`/dashboard/orders/new?supplierId=${id}`} variant="primary" size="md">
                {t('overview.newOrder')}
              </LinkButton>
            ) : null}
          </div>
        </div>
      </header>

      <SupplierTabBar supplierId={id} ledgerTab={supplier.ledgerEnabled && overview !== null} />

      <div>{children}</div>
    </div>
  );
}
