'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';

/**
 * G-04 Q5 (owner decision 11.11): "נבדק" on one consolidated review item. Writes one
 * append-only audit row through consolidated.markReviewed, bound to the item's key
 * and its current fact, then refreshes the server-rendered panel. A stale screen (the
 * fact changed meanwhile) gets CONFLICT: say so and refresh, so the new fact shows.
 */
export function ReviewButton({
  invoiceId,
  itemKey,
  value,
  label,
  staleLabel,
}: {
  invoiceId: string;
  itemKey: string;
  value: string;
  label: string;
  staleLabel: string;
}) {
  const router = useRouter();
  const [stale, setStale] = useState(false);
  const mark = trpc.consolidated.markReviewed.useMutation({
    onSuccess: () => router.refresh(),
    onError: (e) => {
      if (e.data?.code === 'CONFLICT' || e.data?.code === 'NOT_FOUND') {
        setStale(true);
        router.refresh();
      }
    },
  });
  return (
    <span className="ms-auto inline-flex items-center gap-2">
      {stale ? (
        <span className="text-xs text-muted" role="status">
          {staleLabel}
        </span>
      ) : null}
      <button
        type="button"
        data-testid="xmatch-review-mark"
        disabled={mark.isPending}
        onClick={() => mark.mutate({ invoiceId, key: itemKey, value })}
        className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-60"
      >
        <Check className="h-4 w-4" aria-hidden="true" />
        {label}
      </button>
    </span>
  );
}
