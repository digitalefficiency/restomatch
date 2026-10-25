import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { CheckCircle2, Clock, Info, MessageCircle, Phone } from 'lucide-react';
import { Card, displayName } from '@/lib/components';
import { formatDate, formatDateTime } from '@/lib/i18n/format';
import { supplierConfirm } from '@/lib/i18n/messages/supplierConfirm';
import { getLocale, getT } from '@/lib/i18n/server';
import { guardSupplierView } from '@/lib/supplierConfirm/guard';
import { supplierPortalView } from '@/lib/supplierConfirm/data';
import { AuthShell } from '../../(auth)/_components/AuthShell';
import { SupplierAnswerForm } from './answer-form';
import { portalContact } from './contact';
import { DiffList } from './Diff';
import { recordedDiff, type PortalLine } from './logic';

export const dynamic = 'force-dynamic';

/** Never indexed; the token must not leak to third parties through Referer. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(supplierConfirm);
  return {
    title: { absolute: `${t('portal.metaTitle')} · RestoMatch` },
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}

/**
 * Public supplier portal (wave-1 `supplierConfirm`): one order behind a 72h
 * magic link. No account, no session — the token is the credential. Unknown,
 * revoked or flag-off links get the portal's own not-found (no dashboard CTA);
 * an expired link explains itself.
 */
export default async function SupplierPortalPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ answered?: string }>;
}) {
  const [{ token }, { answered }] = await Promise.all([params, searchParams]);
  const [t, locale] = await Promise.all([getT(supplierConfirm), getLocale()]);

  const limited = await guardSupplierView(await headers());
  if (limited) return <Shell title={t('portal.invalidTitle')} body={t('portal.errors.rateLimited')} />;

  const res = await supplierPortalView(token);
  if (!res.ok) {
    if (res.error === 'NOT_FOUND') notFound();
    return <Shell title={t('portal.inactiveTitle')} body={t('portal.errors.expired')} />;
  }
  const v = res.view;
  const contact = await portalContact(token).catch(() => null);
  const supplier = displayName(v.supplierName, v.supplierNameEn, locale).primary;
  const lines: PortalLine[] = v.lines.map((l) => ({
    id: l.id,
    name: displayName(l.description, l.descriptionEn, locale).primary,
    sku: l.supplierSku,
    qtyOrdered: l.qtyOrdered,
    unit: l.unit,
    unitPrice: l.unitPrice,
    agreed: l.agreed,
  }));
  const waText = encodeURIComponent(t('portal.whatsappText', { number: v.poNumber, restaurant: v.restaurantName }));

  const contactBar = contact ? (
    <div className="mt-4 rounded-xl border border-line-strong bg-surface px-3 py-3" data-testid="portal-contact">
      <p className="text-sm text-ink">{contact.name ? t('portal.contactWith', { name: contact.name }) : t('portal.contactTitle')}</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <a
          href={`tel:${contact.tel}`}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-line-strong bg-surface text-sm font-semibold text-ink hover:border-primary/40"
        >
          <Phone className="h-4 w-4" aria-hidden="true" />
          {t('portal.call')}
        </a>
        <a
          href={`https://wa.me/${contact.wa}?text=${waText}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-line-strong bg-surface text-sm font-semibold text-ink hover:border-primary/40"
        >
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
          {t('portal.whatsapp')}
        </a>
      </div>
    </div>
  ) : null;

  return (
    <AuthShell width="xl" plain>
      <p className="text-sm font-semibold text-primary">{t('portal.eyebrow')}</p>
      <h1 className="mt-1 text-2xl font-extrabold text-ink sm:text-3xl">
        {t('portal.title', { restaurant: v.restaurantName })}
      </h1>
      <p className="mt-2 text-base text-muted">{t('portal.subtitle')}</p>
      <div className="mt-4 grid gap-1 text-sm text-ink">
        <p>{t('portal.forSupplier', { supplier })}</p>
        <p>
          {t('portal.orderNumber', { number: v.poNumber })}
          {v.expectedDeliveryAt
            ? ` · ${t('portal.delivery', { date: formatDate(v.expectedDeliveryAt, locale, { dateStyle: 'medium' }) })}`
            : null}
        </p>
        <p className="flex items-center gap-1.5 text-muted">
          <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
          {t('portal.expires', { date: formatDateTime(v.expiresAt, locale) })}
        </p>
      </div>

      {v.response ? (
        <>
          {/* auth-03: a second submit (409) lands here — the recorded answer and
              its date, and a plain statement that the new changes were NOT saved. */}
          <Card elevated padding="md" className="mt-6" data-testid="portal-answered">
            <p className="flex items-center gap-2 text-lg font-bold text-ink">
              {answered ? (
                <Info className="h-5 w-5 text-muted" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="h-5 w-5 text-primary" aria-hidden="true" />
              )}
              {t('portal.alreadyTitle')}
            </p>
            <p className="mt-2 text-base text-ink" role={answered ? 'alert' : undefined}>
              {answered
                ? t('portal.conflictBody', { date: formatDateTime(v.response.submittedAt, locale) })
                : t('portal.alreadyBody', { date: formatDateTime(v.response.submittedAt, locale) })}
            </p>
            <div className="mt-4 border-t border-line pt-3">
              {v.response.status === 'confirmed' && !v.response.note ? (
                <p className="text-sm text-ink">{t('portal.recordedConfirmed')}</p>
              ) : (
                <>
                  <p className="mb-1 text-sm font-semibold text-ink">{t('portal.recordedChanges')}</p>
                  <DiffList items={recordedDiff(lines, v.response.lines)} note={v.response.note} />
                </>
              )}
            </div>
          </Card>
          {contactBar}
        </>
      ) : (
        <>
          {contactBar}
          <SupplierAnswerForm token={token} poNumber={v.poNumber} lines={lines} />
        </>
      )}
      <p className="mt-10 text-center text-sm text-muted">{t('portal.poweredBy')}</p>
    </AuthShell>
  );
}

function Shell({ title, body }: { title: string; body: string }) {
  return (
    <AuthShell>
      <div className="text-center">
        <Clock className="mx-auto h-8 w-8 text-muted" aria-hidden="true" />
        <h1 className="mt-3 text-xl font-bold text-ink">{title}</h1>
        <p className="mt-2 text-base text-ink">{body}</p>
      </div>
    </AuthShell>
  );
}
