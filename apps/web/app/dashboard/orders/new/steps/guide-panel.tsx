'use client';

import { useMemo, useState } from 'react';
import { History, Minus, Plus } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { UnitText } from '@/lib/components/UnitText';
import { Button, Card, Spinner, cn, displayName } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/i18n/format';
import { orders as ordersNs } from '@/lib/i18n/messages/orders';
import { fillLikeLastTime, guideQtyOf, setGuideQty, type GuideItem, type GuideLine } from '../../w2-logic';

/**
 * The order guide (W2-06 §5.1, orders-01): what this restaurant usually orders
 * from the supplier. Every row starts EMPTY with a ghost "בד״כ 5"; one tap on
 * the ghost takes the usual qty, 48 px steppers adjust it, and "כמו בפעם
 * הקודמת" fills every row at once (with undo). Grouped by category.
 */
export function GuidePanel<L extends GuideLine>({
  supplierId,
  lines,
  onLines,
  newKey,
}: {
  supplierId: string;
  lines: L[];
  onLines: (next: L[]) => void;
  newKey: () => string;
}) {
  const t = useT(ordersNs);
  const locale = useLocale();
  const guide = trpc.orders.orderGuide.useQuery({ supplierId }, { enabled: !!supplierId, retry: false, staleTime: 60_000 });
  const [undo, setUndo] = useState<{ lines: L[]; filled: number } | null>(null);

  const items: GuideItem[] = useMemo(
    () =>
      (guide.data?.rows ?? []).map((r) => ({
        key: r.key,
        productId: r.productId,
        name: r.name,
        nameEn: r.nameEn,
        unit: r.unit,
        usualQty: r.usualQty,
        lastQty: r.lastQty,
        unitPrice: (r as { unitPrice?: number | null }).unitPrice ?? null,
        category: r.category,
      })) as Array<GuideItem & { category: string | null }>,
    [guide.data],
  );
  const groups = useMemo(() => {
    const m = new Map<string, Array<GuideItem & { category?: string | null }>>();
    for (const it of items as Array<GuideItem & { category: string | null }>) {
      const k = it.category ?? t('w2.uncategorized');
      m.set(k, [...(m.get(k) ?? []), it]);
    }
    return [...m.entries()];
  }, [items, t]);

  if (guide.isLoading) {
    return (
      <Card elevated>
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner className="h-4 w-4" /> {t('wizard.searching')}
        </p>
      </Card>
    );
  }
  if (guide.isError || items.length === 0) {
    return guide.isError ? null : (
      <p className="text-sm text-muted" data-testid="guide-empty">
        {t('w2.guideEmpty')}
      </p>
    );
  }

  const set = (g: GuideItem, qty: number) => {
    setUndo(null);
    onLines(setGuideQty(lines, g, Math.max(0, Math.round(qty * 1000) / 1000), newKey));
  };
  const fillAll = () => {
    const r = fillLikeLastTime(lines, items, newKey);
    onLines(r.lines);
    setUndo(r.filled > 0 ? { lines: r.undo, filled: r.filled } : null);
  };
  const num = (n: number) => formatNumber(n, locale, { maximumFractionDigits: 3 });

  return (
    <Card elevated data-testid="order-guide">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-ink">{t('w2.guideTitle')}</h2>
        <Button variant="secondary" size="sm" className="min-h-12" onClick={fillAll} data-testid="guide-same-as-last">
          <History className="h-4 w-4" aria-hidden="true" /> {t('w2.sameAsLast')}
        </Button>
      </div>
      {undo ? (
        <p role="status" className="mb-2 flex flex-wrap items-center gap-2 text-sm text-muted" data-testid="guide-undo">
          {t('w2.sameAsLastDone', { count: num(undo.filled) })}
          <button
            type="button"
            className="min-h-12 rounded px-2 font-medium text-primary underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onClick={() => {
              onLines(undo.lines);
              setUndo(null);
            }}
          >
            {t('w2.undo')}
          </button>
        </p>
      ) : null}
      <div className="space-y-3">
        {groups.map(([cat, rows]) => (
          <section key={cat} aria-label={cat}>
            <h3 className="mb-1 text-xs font-semibold text-muted">{cat}</h3>
            <ul className="divide-y divide-line/60 rounded-xl border border-line">
              {rows.map((g) => {
                const qty = guideQtyOf(lines, g);
                const name = displayName(g.name, g.nameEn, locale).primary;
                return (
                  <li key={g.key} data-testid="guide-row" className="flex min-h-16 items-center justify-between gap-2 px-3 py-1.5">
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-ink">{name}</span>
                      <span className="block text-xs text-subtle">
                        <UnitText unit={g.unit} />
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      {qty > 0 ? (
                        <>
                          <StepButton label={`−1 ${name}`} onClick={() => set(g, qty - 1)}>
                            <Minus className="h-5 w-5" aria-hidden="true" />
                          </StepButton>
                          <span className="min-w-10 text-center text-base font-semibold tabular-nums text-ink" data-testid="guide-qty">
                            {num(qty)}
                          </span>
                          <StepButton label={`+1 ${name}`} onClick={() => set(g, qty + 1)}>
                            <Plus className="h-5 w-5" aria-hidden="true" />
                          </StepButton>
                        </>
                      ) : (
                        <button
                          type="button"
                          data-testid="guide-ghost"
                          onClick={() => set(g, g.usualQty)}
                          aria-label={t('w2.usualAria', { qty: num(g.usualQty), unit: g.unit, name })}
                          className="inline-flex min-h-12 items-center gap-1 rounded-control border border-dashed border-line-strong px-3 text-sm text-muted hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          <Plus className="h-4 w-4 text-primary" aria-hidden="true" />
                          {t('w2.usual', { qty: num(g.usualQty) })}
                        </button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </Card>
  );
}

function StepButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        'inline-flex h-12 w-12 items-center justify-center rounded-control border border-line-strong bg-surface text-ink',
        'hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
      )}
    >
      {children}
    </button>
  );
}
