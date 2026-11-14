'use client';

import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Button, Card, Input } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/i18n/format';
import { products as productsNs } from '@/lib/i18n/messages/products';

/**
 * W3-10 · "מיזוג עם מוצר אחר": pick the product that stays and see, before
 * anything happens, what a merge would move and what must be decided. Read-only
 * (products.mergePreview). Applying a merge moves leak history, so it is an
 * owner-signed step and has no button here.
 */
export function MergePanel({ productId }: { productId: string }) {
  const t = useT(productsNs);
  const locale = useLocale();
  const n = (v: number) => formatNumber(v, locale);
  const [raw, setRaw] = useState('');
  const [search, setSearch] = useState('');
  const [intoId, setIntoId] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(raw.trim()), 250);
    return () => clearTimeout(timer);
  }, [raw]);
  const results = trpc.mapping.searchProducts.useQuery({ q: search, limit: 8 }, { enabled: search.length >= 1 });
  const preview = trpc.products.mergePreview.useQuery(
    { fromId: productId, intoId: intoId ?? productId },
    { enabled: !!intoId && intoId !== productId },
  );
  const p = preview.data;

  return (
    <Card className="mt-8 space-y-4 p-4">
      <div>
        <h2 className="text-lg font-semibold text-ink">{t('merge.title')}</h2>
        <p className="text-sm text-muted">{t('merge.intro')}</p>
      </div>
      <div className="space-y-2">
        <label className="block text-sm font-medium text-ink" htmlFor="merge-search">
          {t('merge.searchLabel')}
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
          <Input id="merge-search" value={raw} onChange={(e) => setRaw(e.target.value)} placeholder={t('merge.searchPlaceholder')} className="ps-9" />
        </div>
        <ul className="flex flex-wrap gap-2">
          {(results.data ?? [])
            .filter((r) => r.id !== productId)
            .map((r) => (
              <li key={r.id}>
                <Button size="sm" variant={intoId === r.id ? 'primary' : 'secondary'} onClick={() => setIntoId(r.id)}>
                  <span lang="he">{r.canonicalName}</span>
                </Button>
              </li>
            ))}
        </ul>
      </div>

      {p && (
        <div className="space-y-3 border-t border-line pt-4 text-sm" aria-live="polite">
          <p className="font-medium text-ink" lang="he">
            {t('merge.previewTitle', { from: p.from.name, into: p.into.name })}
          </p>
          <ul className="list-disc space-y-1 ps-5 text-ink">
            <li>{t('merge.aliases', { count: n(p.preview.aliasesAdded.length) })}</li>
            <li>{t('merge.catalogItems', { count: n(p.preview.catalogItemsMoved) })}</li>
            <li>{t('merge.recipes', { count: n(p.preview.recipesRepointed) })}</li>
            <li>{t('merge.openOrders', { count: n(p.preview.openOrderLinesRepointed) })}</li>
            <li>{t('merge.contracts', { count: n(p.preview.contractsMoved) })}</li>
            <li>
              {t('merge.evidence', {
                lines: n(p.evidence.invoiceLines),
                findings: n(p.evidence.findings),
                history: n(p.evidence.priceHistory),
              })}
            </li>
          </ul>
          {p.preview.clean ? (
            <p className="text-muted">{t('merge.clean')}</p>
          ) : (
            <div>
              <p className="font-medium text-ink">{t('merge.conflictsTitle')}</p>
              <ul className="list-disc space-y-1 ps-5 text-ink">
                {p.preview.conflicts.map((c, i) => (
                  <li key={i}>
                    {c.kind === 'UNIT_DIFFERS'
                      ? t('merge.conflictUnit', { from: c.from ?? '—', into: c.into ?? '—' })
                      : c.kind === 'SAME_SUPPLIER_TWO_ROWS'
                        ? t('merge.conflictRows')
                        : t('merge.conflictContracts')}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs text-subtle">{t('merge.applyNote')}</p>
        </div>
      )}
    </Card>
  );
}
