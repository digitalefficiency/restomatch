'use client';

import { translateUnit } from '@restomatch/translate/units';
import { useLocale } from '@/lib/i18n/client';
import { originalProps } from '@/lib/i18n/original';

/**
 * A free-text unit (order line, catalog item, product price). English shows
 * the unit through the shared receiving translator (ק״ג → kg, ארגז → case …);
 * an unrecognised Hebrew unit is shown as written and marked as an original.
 */
export function UnitText({ unit, empty = '—' }: { unit: string | null | undefined; empty?: string }) {
  const locale = useLocale();
  if (!unit) return <>{empty}</>;
  const en = locale === 'he' ? null : translateUnit(unit);
  if (!en) return <span {...originalProps(unit)}>{unit}</span>;
  return <>{en}</>;
}
