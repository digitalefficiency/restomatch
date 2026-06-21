'use client';

import { useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { Boxes, Check, Plus, Search } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Badge, Button, Card, EmptyState, Input, Spinner } from '@/lib/components';

type Outputs = inferRouterOutputs<AppRouter>;
type UnmappedSku = Outputs['mapping']['unmapped'][number];

export function SkuMapper({ initial }: { initial: UnmappedSku[] }) {
  const utils = trpc.useUtils();
  const q = trpc.mapping.unmapped.useQuery(undefined, { initialData: initial });
  const rows = q.data ?? [];

  if (q.isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 text-muted">
        <Spinner className="h-4 w-4" /> טוען מק״טים…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Boxes className="h-6 w-6" />}
        title="הכול ממופה"
        description="אין מק״טים שממתינים למיפוי. כל שורות ההזמנות והחשבוניות מחוברות למוצר."
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        {rows.length} מק״טים ממתינים למיפוי. חיבור מק״ט למוצר מעדכן את כל השורות הקיימות ומלמד את
        המערכת לזיהוי אוטומטי בעתיד.
      </p>
      {rows.map((row) => (
        <MapRow
          key={`${row.supplierId}::${row.supplierSku}`}
          row={row}
          onDone={() => utils.mapping.unmapped.invalidate()}
        />
      ))}
    </div>
  );
}

function MapRow({ row, onDone }: { row: UnmappedSku; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const results = trpc.mapping.searchProducts.useQuery(
    { q: search.trim(), limit: 8 },
    { enabled: open && search.trim().length >= 1 },
  );

  const confirm = trpc.mapping.confirm.useMutation({
    onSuccess: () => {
      setOpen(false);
      onDone();
    },
    onError: (e) => setError(e.message),
  });

  const link = (args: { productId?: string; newProductName?: string }) => {
    setError(null);
    confirm.mutate({
      supplierId: row.supplierId,
      supplierSku: row.supplierSku,
      rawName: row.sampleDescription || row.supplierSku,
      ...args,
    });
  };

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge>{row.supplierName}</Badge>
            <span className="font-mono text-sm text-subtle">מק״ט {row.supplierSku}</span>
            {row.occurrences > 1 && (
              <span className="text-xs text-subtle">· {row.occurrences} שורות</span>
            )}
          </div>
          <div className="mt-1 truncate text-ink">{row.sampleDescription || '—'}</div>
        </div>
        <Button variant={open ? 'secondary' : 'primary'} size="sm" onClick={() => setOpen((v) => !v)}>
          {open ? 'סגור' : 'מיפוי'}
        </Button>
      </div>

      {open && (
        <div className="mt-4 border-t border-line pt-4">
          <div className="relative">
            <Search className="pointer-events-none absolute bottom-2.5 right-3 h-4 w-4 text-subtle" aria-hidden />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="חיפוש מוצר בקטלוג…"
              className="pr-9"
              autoFocus
            />
          </div>

          <div className="mt-3 space-y-1.5">
            {results.isFetching && (
              <div className="flex items-center gap-2 py-2 text-sm text-muted">
                <Spinner className="h-3.5 w-3.5" /> מחפש…
              </div>
            )}
            {(results.data ?? []).map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={confirm.isPending}
                onClick={() => link({ productId: p.id })}
                className="flex w-full items-center justify-between rounded-lg border border-line bg-surface-2 px-3 py-2 text-right text-ink transition hover:border-primary/50 disabled:opacity-50"
              >
                <span className="truncate">{p.canonicalName}</span>
                <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              </button>
            ))}
            {search.trim().length >= 1 && !results.isFetching && (results.data?.length ?? 0) === 0 && (
              <p className="py-1 text-sm text-subtle">לא נמצאו מוצרים תואמים.</p>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3">
            <span className="text-sm text-muted">לא קיים בקטלוג?</span>
            <Button
              variant="secondary"
              size="sm"
              disabled={confirm.isPending || !row.sampleDescription}
              onClick={() => link({ newProductName: row.sampleDescription })}
            >
              <Plus className="h-4 w-4" /> צור מוצר חדש: {row.sampleDescription || '—'}
            </Button>
          </div>

          {confirm.isPending && (
            <div className="mt-2 flex items-center gap-2 text-sm text-muted">
              <Spinner className="h-3.5 w-3.5" /> מקשר ומעדכן שורות…
            </div>
          )}
          {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        </div>
      )}
    </Card>
  );
}
