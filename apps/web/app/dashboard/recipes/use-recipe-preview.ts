'use client';

import { useEffect, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import type { PreviewInput } from './workbench';

/** The editor waits this long after the last keystroke before it asks the server. */
export const PREVIEW_DEBOUNCE_MS = 250;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/**
 * W3-02 · live plate cost while the chef types: `recipes.preview` (no write)
 * on the debounced draft. The last result stays on screen while the next one
 * loads, so the numbers never blink to "—".
 */
export function useRecipePreview(input: PreviewInput | null) {
  const key = input ? JSON.stringify(input) : null;
  const debounced = useDebounced(key, PREVIEW_DEBOUNCE_MS);
  const parsed = useMemo(() => (debounced ? (JSON.parse(debounced) as PreviewInput) : null), [debounced]);
  const q = trpc.recipes.preview.useQuery(parsed ?? { name: '—', items: [] }, {
    enabled: parsed != null,
    placeholderData: (prev) => prev,
    staleTime: 30_000,
    retry: false,
  });
  return {
    data: parsed ? q.data : undefined,
    /** A newer draft than the one shown is waiting or loading. */
    pending: key !== debounced || q.isFetching,
    error: q.isError,
  };
}
