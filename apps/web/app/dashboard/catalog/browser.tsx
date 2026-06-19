'use client';

import { useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { Boxes, Search } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Badge, Button, Card, EmptyState, Input, Spinner } from '@/lib/components';
import { formatIls } from '@/lib/money';

type Outputs = inferRouterOutputs<AppRouter>;
type CatalogItem = Outputs['catalog']['items'][number];
type Supplier = Outputs['suppliers']['list'][number];

const PAGE = 50;

export function CatalogBrowser({
  suppliers,
  initial,
}: {
  suppliers: Supplier[];
  initial: CatalogItem[];
}) {
  const [supplierId, setSupplierId] = useState<string>('');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(PAGE);

  const q = trpc.catalog.items.useQuery(
    {
      supplierId: supplierId || undefined,
      search: search.trim() || undefined,
      limit,
    },
    { initialData: !supplierId && !search.trim() && limit === PAGE ? initial : undefined },
  );

  const items = q.data ?? [];
  const hasMore = items.length >= limit;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem]">
          <label className="mb-1.5 block text-sm font-medium text-muted" htmlFor="cat-supplier">
            ספק
          </label>
          <select
            id="cat-supplier"
            value={supplierId}
            onChange={(e) => { setSupplierId(e.target.value); setLimit(PAGE); }}
            className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-ink focus:border-primary/50 focus:outline-none"
          >
            <option value="">כל הספקים</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div className="relative min-w-[16rem] flex-1">
          <label className="mb-1.5 block text-sm font-medium text-muted" htmlFor="cat-search">
            חיפוש
          </label>
          <Search className="pointer-events-none absolute bottom-2.5 right-3 h-4 w-4 text-subtle" aria-hidden />
          <Input
            id="cat-search"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setLimit(PAGE); }}
            placeholder="שם מוצר / מק״ט"
            className="pr-9"
          />
        </div>
      </div>

      {q.isLoading ? (
        <div className="flex items-center gap-2 py-8 text-muted"><Spinner className="h-4 w-4" /> טוען קטלוג…</div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Boxes className="h-6 w-6" />}
          title="הקטלוג ריק"
          description="ייבאו מחירון ספק מקובץ Excel/CSV כדי להתחיל."
        />
      ) : (
        <Card elevated padding="none" className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-subtle">
                <th className="px-4 py-3 font-medium">ספק</th>
                <th className="px-4 py-3 font-medium">תיאור הספק</th>
                <th className="px-4 py-3 font-medium">מוצר</th>
                <th className="px-4 py-3 font-medium">מק״ט</th>
                <th className="px-4 py-3 font-medium">יחידה</th>
                <th className="px-4 py-3 font-medium">מחיר מחירון</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-b border-line/60 last:border-0 hover:bg-surface-2/60">
                  <td className="px-4 py-3 text-muted">{it.supplierName}</td>
                  <td className="px-4 py-3 text-ink">{it.supplierNameRaw}</td>
                  <td className="px-4 py-3 text-muted">{it.canonicalName ?? '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-subtle">{it.supplierSku ?? '—'}</td>
                  <td className="px-4 py-3 text-muted">{it.unit ?? '—'}</td>
                  <td className="px-4 py-3 font-mono tabular-nums text-ink">
                    {it.listPrice != null ? formatIls(Number(it.listPrice), { maximumFractionDigits: 2 }) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {!it.active && <Badge tone="neutral">לא פעיל</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {hasMore && (
        <div className="flex justify-center">
          <Button variant="secondary" size="sm" loading={q.isFetching} onClick={() => setLimit((l) => l + PAGE)}>
            טען עוד
          </Button>
        </div>
      )}
    </div>
  );
}
