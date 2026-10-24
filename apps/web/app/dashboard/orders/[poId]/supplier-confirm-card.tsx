import { CheckCircle2, Clock, FileWarning } from 'lucide-react';
import { Card, SectionHeader, displayName } from '@/lib/components';
import { formatDateTime, formatNumber } from '@/lib/i18n/format';
import { supplierConfirm } from '@/lib/i18n/messages/supplierConfirm';
import { getLocale, getT } from '@/lib/i18n/server';
import { formatIls } from '@/lib/money';
import { UnitText } from '@/lib/components/UnitText';
import { createServerCaller } from '@/lib/trpc/server';
import { SupplierLinkButton } from './supplier-link-button';

const CONFIRMABLE = ['sent', 'confirmed', 'partial'];

/**
 * Wave-1 `supplierConfirm` card on the order page: create/share the supplier
 * link and show the supplier's answer as differences. The PO is never changed.
 * Renders nothing when the flag is off (the procedure refuses) or on any error.
 */
export async function SupplierConfirmCard({
  poId,
  status,
  canEdit,
  restaurantName,
}: {
  poId: string;
  status: string;
  canEdit: boolean;
  restaurantName: string;
}) {
  const caller = await createServerCaller();
  let data: Awaited<ReturnType<typeof caller.supplierConfirm.responses>>;
  try {
    data = await caller.supplierConfirm.responses({ poId });
  } catch {
    return null;
  }
  const [t, locale] = await Promise.all([getT(supplierConfirm), getLocale()]);
  const money = (n: number | null) => (n == null ? '—' : formatIls(n, { locale, maximumFractionDigits: 2 }));
  const r = data.response;

  return (
    <Card elevated padding="md" className="mt-6" data-testid="supplier-confirm-card">
      <SectionHeader level={2} title={t('card.title')} subtitle={t('card.subtitle')} />
      {r ? (
        <div className="mt-2">
          <p className="flex items-center gap-2 font-semibold text-ink">
            {r.status === 'confirmed' ? (
              <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
            ) : (
              <FileWarning className="h-4 w-4 text-warn" aria-hidden="true" />
            )}
            {r.status === 'confirmed' ? t('card.confirmed') : t('card.changes')}
            <span className="text-xs font-normal text-subtle">
              {t('card.answeredAt', { date: formatDateTime(r.submittedAt, locale) })}
            </span>
          </p>
          {r.lines.length > 0 ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-subtle">
                  <tr>
                    <th className="p-2 text-start font-medium">{t('card.item')}</th>
                    <th className="p-2 text-end font-medium">{t('card.ordered')}</th>
                    <th className="p-2 text-end font-medium">{t('card.supplierQty')}</th>
                    <th className="p-2 text-end font-medium">{t('card.orderPrice')}</th>
                    <th className="p-2 text-end font-medium">{t('card.proposed')}</th>
                  </tr>
                </thead>
                <tbody>
                  {r.lines.map((l) => (
                    <tr key={l.poLineId} className="border-t border-line">
                      <td className="p-2 text-ink">{displayName(l.description, l.descriptionEn, locale).primary}</td>
                      <td className="p-2 text-end tabular-nums">
                        {formatNumber(l.qtyOrdered, locale)} <UnitText unit={l.unit} />
                      </td>
                      <td className={`p-2 text-end tabular-nums ${l.qtyAvailable != null ? 'font-semibold text-warn' : 'text-muted'}`}>
                        {l.qtyAvailable != null ? (
                          <>
                            {formatNumber(l.qtyAvailable, locale)} <UnitText unit={l.unit} />
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="p-2 text-end tabular-nums">
                        <bdi dir="ltr">{money(l.unitPriceAgreed)}</bdi>
                        {l.agreed ? (
                          <span className="ms-1 text-xs text-subtle" title={t('card.contractTagTitle')}>
                            ({t('card.contractTag')})
                          </span>
                        ) : null}
                      </td>
                      <td className={`p-2 text-end tabular-nums ${l.proposedUnitPrice != null ? 'font-semibold text-warn' : 'text-muted'}`}>
                        <bdi dir="ltr">{l.proposedUnitPrice != null ? money(l.proposedUnitPrice) : '—'}</bdi>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {r.note ? (
            <p className="mt-3 text-sm text-muted">
              <span className="font-semibold text-ink">{t('card.note')}: </span>
              {r.note}
            </p>
          ) : null}
          <p className="mt-3 text-xs text-subtle">{t('card.poUnchanged')}</p>
        </div>
      ) : (
        <div className="mt-2 space-y-3">
          {CONFIRMABLE.includes(status) ? (
            <>
              <p className="flex items-center gap-2 text-sm text-muted">
                <Clock className="h-4 w-4" aria-hidden="true" />
                {t('card.waiting')}
                {data.latestLink ? (
                  <span className="text-xs text-subtle">
                    · {t('card.lastLink', { date: formatDateTime(data.latestLink.createdAt, locale) })}
                  </span>
                ) : null}
              </p>
              {canEdit ? <SupplierLinkButton poId={poId} restaurantName={restaurantName} /> : null}
            </>
          ) : (
            <p className="text-sm text-muted">{t('card.notSent')}</p>
          )}
        </div>
      )}
    </Card>
  );
}
