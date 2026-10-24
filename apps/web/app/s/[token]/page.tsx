import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { Card, displayName } from '@/lib/components';
import { LocaleSwitcher } from '@/lib/i18n/LocaleSwitcher';
import { formatDate, formatDateTime } from '@/lib/i18n/format';
import { supplierConfirm } from '@/lib/i18n/messages/supplierConfirm';
import { getLocale, getT } from '@/lib/i18n/server';
import { guardSupplierView } from '@/lib/supplierConfirm/guard';
import { supplierPortalView } from '@/lib/supplierConfirm/data';
import { SupplierAnswerForm } from './answer-form';

export const dynamic = 'force-dynamic';

/** Never indexed; the token must not leak to third parties through Referer. */
export const metadata: Metadata = {
  title: 'RestoMatch',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

/**
 * Public supplier portal (wave-1 `supplierConfirm`): one order behind a 72h
 * magic link. No account, no session — the token is the credential. Unknown,
 * revoked or flag-off links 404; an expired link explains itself.
 */
export default async function SupplierPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [t, locale] = await Promise.all([getT(supplierConfirm), getLocale()]);

  const limited = await guardSupplierView(await headers());
  if (limited) return <Shell title={t('portal.invalidTitle')} body={t('portal.errors.rateLimited')} />;

  const res = await supplierPortalView(token);
  if (!res.ok) {
    if (res.error === 'NOT_FOUND') notFound();
    return <Shell title={t('portal.invalidTitle')} body={t('portal.errors.expired')} />;
  }
  const v = res.view;
  const supplier = displayName(v.supplierName, v.supplierNameEn, locale).primary;

  // pb-56: the fixed cookie-consent banner must never cover the answer buttons on a phone.
  return (
    <main className="mx-auto min-h-screen w-full max-w-xl px-4 pb-56 pt-6 sm:pt-10">
      <div className="mb-5 flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">{t('portal.eyebrow')}</p>
        <LocaleSwitcher />
      </div>
      <h1 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">
        {t('portal.title', { restaurant: v.restaurantName })}
      </h1>
      <p className="mt-2 text-sm text-muted">{t('portal.subtitle')}</p>
      <div className="mt-4 grid gap-1 text-sm text-muted">
        <p>{t('portal.forSupplier', { supplier })}</p>
        <p>
          {t('portal.orderNumber', { number: v.poNumber })}
          {v.expectedDeliveryAt
            ? ` · ${t('portal.delivery', { date: formatDate(v.expectedDeliveryAt, locale, { dateStyle: 'medium' }) })}`
            : null}
        </p>
        <p className="text-xs text-subtle">
          {t('portal.expires', { date: formatDateTime(v.expiresAt, locale) })}
        </p>
      </div>

      {v.response ? (
        <Card elevated padding="md" className="mt-6">
          <p className="flex items-center gap-2 text-lg font-bold text-ink">
            <CheckCircle2 className="h-5 w-5 text-primary" aria-hidden="true" />
            {t('portal.alreadyTitle')}
          </p>
          <p className="mt-2 text-sm text-muted">
            {t('portal.alreadyBody', { date: formatDateTime(v.response.submittedAt, locale) })}
          </p>
        </Card>
      ) : (
        <SupplierAnswerForm
          token={token}
          lines={v.lines.map((l) => ({
            id: l.id,
            name: displayName(l.description, l.descriptionEn, locale).primary,
            sku: l.supplierSku,
            qtyOrdered: l.qtyOrdered,
            unit: l.unit,
            unitPrice: l.unitPrice,
          }))}
        />
      )}
      <p className="mt-10 text-center text-xs text-subtle">{t('portal.poweredBy')}</p>
    </main>
  );
}

function Shell({ title, body }: { title: string; body: string }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col items-center justify-center px-4 text-center">
      <AlertCircle className="h-8 w-8 text-warn" aria-hidden="true" />
      <h1 className="mt-3 text-xl font-bold text-ink">{title}</h1>
      <p className="mt-2 text-sm text-muted">{body}</p>
      <div className="mt-6">
        <LocaleSwitcher />
      </div>
    </main>
  );
}
