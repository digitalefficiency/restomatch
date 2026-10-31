'use client';

import { UnitText } from '@/lib/components/UnitText';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/i18n/format';
import { supplierConfirm } from '@/lib/i18n/messages/supplierConfirm';
import { formatIls } from '@/lib/money';
import type { DiffItem } from './logic';

/**
 * The supplier's changes in words: "חוסר: עגבניות 6/10 ק״ג · מחיר: שמן ₪14.20".
 * One renderer for the live summary above the primary, the done card and the
 * recorded answer, so all three always say the same thing. ₪ sits in a plain
 * `<bdi>` (no `dir`) so it lands left of the digits in Hebrew.
 */
export function DiffList({
  items,
  note,
  limit,
  className,
}: {
  items: DiffItem[];
  note?: string | null;
  /** Show at most this many, then "and N more". */
  limit?: number;
  className?: string;
}) {
  const t = useT(supplierConfirm);
  const locale = useLocale();
  const shown = limit ? items.slice(0, limit) : items;
  const rest = items.length - shown.length;
  return (
    <ul className={className ?? 'space-y-1 text-sm text-ink'}>
      {shown.map((d) => (
        <li key={`${d.kind}-${d.lineId}`}>
          {d.kind === 'out' ? (
            <>
              <span className="font-semibold">{t('portal.diffOut')}:</span> {d.name}
            </>
          ) : d.kind === 'price' ? (
            <>
              <span className="font-semibold">{t('portal.diffPrice')}:</span> {d.name}{' '}
              <bdi className="tabular-nums">{formatIls(d.price, { locale, maximumFractionDigits: 2 })}</bdi>
              {' / '}
              <UnitText unit={d.unit} />
            </>
          ) : (
            <>
              <span className="font-semibold">{t(d.kind === 'short' ? 'portal.diffShort' : 'portal.diffMore')}:</span> {d.name}{' '}
              <bdi className="tabular-nums">
                {formatNumber(d.qty, locale)}/{formatNumber(d.ordered, locale)}
              </bdi>{' '}
              <UnitText unit={d.unit} />
            </>
          )}
        </li>
      ))}
      {rest > 0 ? <li className="text-muted">{t('portal.moreChanges', { count: formatNumber(rest, locale) })}</li> : null}
      {note ? (
        <li>
          <span className="font-semibold">{t('portal.diffNote')}:</span> {note}
        </li>
      ) : null}
    </ul>
  );
}
