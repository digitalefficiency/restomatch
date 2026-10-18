'use client';

import { useLocale, useT } from '@/lib/i18n/client';
import { orders } from '@/lib/i18n/messages/orders';
import { originalProps } from '@/lib/i18n/original';
import { unitKey } from '@/app/dashboard/orders/order-logic';

/**
 * A free-text unit (order line, catalog item, product). English shows the
 * common units translated (ק״ג → kg, ארגז → case …); anything unrecognised is
 * shown as written and marked as a Hebrew original.
 */
export function UnitText({ unit, empty = '—' }: { unit: string | null | undefined; empty?: string }) {
  const t = useT(orders);
  const locale = useLocale();
  if (!unit) return <>{empty}</>;
  const key = locale === 'he' ? null : unitKey(unit);
  if (!key) return <span {...originalProps(unit)}>{unit}</span>;
  return <>{t(`unitNames.${key}`)}</>;
}
