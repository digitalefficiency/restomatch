'use client';

import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { Card } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { suppliers as suppliersNs } from '@/lib/i18n/messages/suppliers';
import { formatPercent } from '@/lib/i18n/format';
import { DAY_KEYS } from '../form-logic';
import { telHref, termsValueOf } from '../terms';
import { windowParts } from './read-only';

type SupplierWithFlags = inferRouterOutputs<AppRouter>['suppliers']['get'];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 py-2 sm:grid-cols-3">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-sm text-ink sm:col-span-2">{children}</dd>
    </div>
  );
}

/** The supplier's details, read-only — for roles that can't write suppliers (the bookkeeper). */
export function SupplierDetailsReadOnly({ s }: { s: SupplierWithFlags }) {
  const t = useT(suppliersNs);
  const locale = useLocale();
  const none = t('table.none');
  const terms = termsValueOf(s.paymentTerms);
  const termsText =
    terms.choice === 'none'
      ? none
      : terms.choice === 'other'
        ? (s.paymentTerms ?? none)
        : terms.choice === 'eomN'
          ? locale === 'he'
            ? `שוטף+${terms.days}`
            : `EOM+${terms.days}`
          : t(`terms.${terms.choice}`);
  const deliveryDays = DAY_KEYS.filter((d) => s.deliverySchedule?.[d]?.length);
  return (
    <Card elevated data-testid="supplier-details-readonly">
      <h3 className="mb-2 text-base font-bold text-ink">{t('form.detailsTitle')}</h3>
      <dl className="divide-y divide-line">
        <Row label={t('form.name')}>{s.name}</Row>
        {s.nameEn ? <Row label={t('form.nameEn')}>{s.nameEn}</Row> : null}
        <Row label={t('form.businessId')}>
          {s.businessId ? <bdi dir="ltr" className="tabular-nums">{s.businessId}</bdi> : none}
        </Row>
        <Row label={t('form.email')}>
          {s.contactEmail ? (
            <a href={`mailto:${s.contactEmail}`} dir="ltr" className="text-primary hover:underline">
              {s.contactEmail}
            </a>
          ) : (
            none
          )}
        </Row>
        <Row label={t('form.whatsapp')}>
          {s.contactWhatsapp ? (
            <a href={telHref(s.contactWhatsapp)} className="text-primary hover:underline">
              <bdi dir="ltr" className="tabular-nums">{s.contactWhatsapp}</bdi>
            </a>
          ) : (
            none
          )}
        </Row>
        <Row label={t('terms.label')}>{termsText}</Row>
        <Row label={t('form.vatRate')}>
          {s.vatRate === null ? t('form.vatDefault') : formatPercent(Number(s.vatRate), locale, 2)}
        </Row>
        <Row label={t('form.deliveryTitle')}>
          {deliveryDays.length === 0
            ? none
            : deliveryDays.map((d) => `${t(`days.${d}`)} ${s.deliverySchedule?.[d]?.[0] ?? ''}`.trim()).join(' · ')}
        </Row>
      </dl>
    </Card>
  );
}

/** The order schedule, read-only. */
export function SupplierScheduleReadOnly({ s }: { s: SupplierWithFlags }) {
  const t = useT(suppliersNs);
  const windows = s.orderSchedule?.windows ?? [];
  return (
    <Card elevated data-testid="supplier-schedule-readonly">
      <h3 className="mb-2 text-base font-bold text-ink">{t('detail.tabs.schedule')}</h3>
      {windows.length === 0 ? (
        <p className="text-sm text-muted">{t('overview.rhythmNone')}</p>
      ) : (
        <ul className="divide-y divide-line">
          {windows.map((w, i) => {
            const p = windowParts(w);
            return (
              <li key={i} className="py-2 text-sm text-ink tabular-nums">
                {p.days.map((d) => t(`days.${d}`)).join(', ')} · {t('schedule.cutoff')} {p.cutoff} ·{' '}
                {p.delivery.kind === 'lead'
                  ? `${t('schedule.leadDays')}: ${p.delivery.days}`
                  : `${t('schedule.deliversOn')}: ${t(`days.${p.delivery.day}`)}`}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
