'use client';

import { TriangleAlert } from 'lucide-react';
import { Badge } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { contracts } from '@/lib/i18n/messages/contracts';
import { formatIls } from '@/lib/money';
import { trpc } from '@/lib/trpc/client';

type Item = { productId?: string | null; unit?: string | null };

const keyOf = (productId: string, unit: string) => `${productId}|${unit.trim()}`;

/**
 * Flag `contracts` in the new-order wizard: the contract unit price in force
 * today for each (product, unit) the wizard shows — catalog rows and the lines
 * being built. Returns a lookup `(productId, unit) → price | undefined`; with
 * the flag off (or no contracts) it always answers undefined, so the wizard
 * keeps pre-filling the catalog list price exactly as before.
 */
export function useOrderContractPrices(supplierId: string | null | undefined, items: ReadonlyArray<Item>) {
  const wanted = new Map<string, { productId: string; unit: string }>();
  for (const it of items) {
    const unit = it.unit?.trim();
    if (it.productId && unit) wanted.set(keyOf(it.productId, unit), { productId: it.productId, unit });
  }
  const list = [...wanted.values()].sort((a, b) => keyOf(a.productId, a.unit).localeCompare(keyOf(b.productId, b.unit)));
  const q = trpc.contracts.orderPrices.useQuery(
    { supplierId: supplierId ?? '', items: list.slice(0, 500) },
    { enabled: !!supplierId && list.length > 0, staleTime: 5 * 60_000, retry: false, placeholderData: (prev) => prev },
  );
  const byKey = new Map((q.data?.enabled ? q.data.prices : []).map((p) => [keyOf(p.productId, p.unit), p.contractPrice]));
  return (productId?: string | null, unit?: string | null): number | undefined =>
    productId && unit ? byKey.get(keyOf(productId, unit)) : undefined;
}

/**
 * "₪x/unit above the contract" (T2 warn) when the price typed for a line is
 * above its contract price. Renders nothing otherwise.
 */
export function OverContractNote({ price, contract }: { price: number | undefined; contract: number | undefined }) {
  const t = useT(contracts);
  const locale = useLocale();
  if (price === undefined || contract === undefined) return null;
  const over = Math.round(price * 100) - Math.round(contract * 100);
  if (over <= 0) return null;
  const money = (v: number) => formatIls(v, { locale, maximumFractionDigits: 2 });
  return (
    <span data-testid="over-contract-note" title={t('order.overContractTitle', { contract: money(contract), price: money(price) })}>
      <Badge tone="warning-solid" icon={<TriangleAlert className="h-3 w-3" aria-hidden="true" />}>
        {t('order.overContract', { amount: money(over / 100) })}
      </Badge>
    </span>
  );
}
