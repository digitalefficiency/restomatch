'use client';

import { useEffect, useReducer, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getQueryKey } from '@trpc/react-query';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api'; // type-only (G-16 client-api-value-import safe)
import { waits } from '@restomatch/ui-tokens';
import { trpc } from '@/lib/trpc/client';
import { useLocale } from '@/lib/i18n/client';
import { units4 } from './desk-facts';
import { itemName } from './desk-text';
import type { GapDocument, PaperLine, QueueItem } from './desk-types';

type Detail = inferRouterOutputs<AppRouter>['invoices']['detail'];
type DetailLine = Detail['lines'][number];

/** The invoice lines change only with an edit and a re-match. */
export const DETAIL_STALE_MS = 60_000;
/** A held J: do not fetch every invoice it passes. */
export const DETAIL_SETTLE_MS = 120;
/** A skeleton that became visible (loading ≥ 1 s) stays at least this long (SPEC §9 "long enough not to flash"). */
export const SKELETON_HOLD_MS = 400; // = motion.duration.long of @restomatch/ui-tokens (400 ms); not a CSS duration
/** `Skeleton delayed` appears once loading passes DS3-00's `skeleton-wait` (SPEC §9's one second), read by name. */
const SKELETON_WAIT_MS = Number.parseInt(waits['skeleton-wait'], 10);

/**
 * A cached invoice detail may be shown without the J/K settle only while it is FRESH: within DETAIL_STALE_MS of its
 * fetch and not invalidated. An older copy is stale for `useQuery` too, which refetches it on mount — so a held J
 * across invoices cached minutes ago would fetch every one it passes (§5.13). `state` = the query's react-query state.
 */
export function freshInCache(
  state: { data?: unknown; dataUpdatedAt: number; isInvalidated?: boolean } | null | undefined,
  now: number,
): boolean {
  return state != null && state.data !== undefined && state.isInvalidated !== true && now - state.dataUpdatedAt < DETAIL_STALE_MS;
}

/** The value once it has held still for `ms` (the first value at once). */
function useSettled(value: string | null, ms: number): string | null {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (value === settled) return;
    const h = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(h);
  }, [value, settled, ms]);
  return settled;
}

/**
 * `invoices.detail` sends its NUMERIC columns as JS numbers (Number() on the server, invoices.ts). For NUMERIC(12,3)
 * quantities and NUMERIC(12,4) prices the shortest decimal that round-trips (String(n)) IS the stored decimal, so the
 * detail goes through the same exact units4() as the row (R8); anything else is no value.
 */
function units4OfNumber(n: number | null | undefined): bigint | null {
  return typeof n === 'number' && Number.isFinite(n) ? units4(String(n)) : null;
}

/** The detail's line totals are integer agorot already; a server-redacted price is null and renders empty. */
function agorotOfNumber(n: number | null | undefined): bigint | null {
  return typeof n === 'number' && Number.isSafeInteger(n) ? BigInt(n) : null;
}

/** The row's own invoice line, exact, from the row (shown at once while the detail loads); null without a line. */
function ownLine(locale: 'he' | 'en', row: QueueItem): PaperLine | null {
  if (!row.invoiceLineId) return null;
  const total4 = units4(row.lineTotal);
  return {
    id: row.invoiceLineId,
    name: itemName(locale, row),
    qty4: units4(row.qtyBilled),
    unit: row.billedUnit,
    unitPrice4: units4(row.unitPriceBilled),
    totalAgorot: total4 == null ? null : total4 / 100n, // NUMERIC(12,2): exact
    hit: true,
  };
}

/** The paper (§5.13): the hit line first, then up to two other lines in detail order — no layout shift and no line
 *  number (§0.4). A row whose line is not on the invoice (MISSING, invoice-level gaps) gets the first three, no hit. */
function readyOf(locale: 'he' | 'en', row: QueueItem, d: Detail): GapDocument {
  const all = d.lines;
  const at = row.invoiceLineId ? all.findIndex((l) => l.id === row.invoiceLineId) : -1;
  const toLine = (l: DetailLine, hit: boolean): PaperLine => ({
    id: l.id,
    // The hit line keeps the row's own name (the viewer's language), so loading → ready changes no word.
    name: (hit ? itemName(locale, row) : '') || l.name || l.rawDescription || '',
    qty4: units4OfNumber(l.qtyBilled),
    unit: l.unit,
    unitPrice4: units4OfNumber(l.unitPriceBilled),
    totalAgorot: agorotOfNumber(l.lineTotalAgorot),
    hit,
  });
  const hit = at >= 0 ? all[at] : undefined;
  const lines = hit
    ? [toLine(hit, true), ...all.filter((_, i) => i !== at).slice(0, 2).map((l) => toLine(l, false))]
    : all.slice(0, 3).map((l) => toLine(l, false));
  return {
    status: 'ready',
    lines,
    more: Math.max(0, all.length - lines.length),
    hasImage: d.hasImage || row.hasScan === true,
    grId: d.match?.grId ?? null,
    grReceivedAt: d.match?.grReceivedAt ?? null,
    duplicateOf: d.duplicateOf?.invoiceNumber ?? null,
  };
}

/**
 * The documents of the current gap (DS3-04 spec §5.13): `invoices.detail` for the current gap's invoice only
 * (existing invoiceReaderProcedure, no router change), after the J/K settle; the next gap's invoice is prefetched when
 * it differs; rows of one invoice share the cache. While it loads, the row's own line shows at once. A skeleton that
 * became visible (≥ 1 s) is held SKELETON_HOLD_MS so it never flashes; answers under 1 s switch at once.
 */
export function useGapDocument(current: QueueItem | null, next: QueueItem | null): GapDocument {
  const locale = useLocale();
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const want = current?.invoiceId ?? null;
  const settled = useSettled(want, DETAIL_SETTLE_MS);
  // An invoice fresh in the cache (a sibling's, or the prefetched next one) needs no wait and fetches nothing; a stale
  // copy waits for the settle like any other invoice (useQuery would refetch it at once).
  const cached =
    want != null &&
    freshInCache(queryClient.getQueryState(getQueryKey(trpc.invoices.detail, { invoiceId: want }, 'query')), Date.now());
  const queryId = cached ? want : settled;
  const q = trpc.invoices.detail.useQuery(
    { invoiceId: queryId ?? '' },
    { enabled: queryId != null, staleTime: DETAIL_STALE_MS },
  );

  const nextInvoice = next?.invoiceId ?? null;
  const settledHere = want != null && settled === want;
  useEffect(() => {
    if (!settledHere || nextInvoice == null || nextInvoice === want) return;
    void utils.invoices.detail.prefetch({ invoiceId: nextInvoice }, { staleTime: DETAIL_STALE_MS });
  }, [settledHere, nextInvoice, want, utils]);

  // The skeleton hold: when this invoice began loading, and when its answer may show.
  const data = want != null && queryId === want ? q.data : undefined;
  const [load, setLoad] = useState<{ key: string | null; since: number; readyAt: number | null }>(() => ({
    key: want,
    since: Date.now(),
    readyAt: null,
  }));
  let hold = load;
  if (hold.key !== want) hold = { key: want, since: Date.now(), readyAt: null };
  if (data && hold.readyAt == null) {
    const now = Date.now();
    const shown = now - hold.since >= SKELETON_WAIT_MS; // a skeleton is on screen
    hold = { ...hold, readyAt: shown ? Math.max(now, hold.since + SKELETON_WAIT_MS + SKELETON_HOLD_MS) : now };
  }
  if (hold !== load) setLoad(hold); // derived from this render's inputs (React: adjusting state while rendering)
  const [, wake] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (load.readyAt == null) return;
    const wait = load.readyAt - Date.now();
    if (wait <= 0) return;
    const h = window.setTimeout(wake, wait);
    return () => window.clearTimeout(h);
  }, [load.readyAt]);

  if (!current || want == null) return { status: 'none' };
  const own = ownLine(locale, current);
  if (data) {
    if (hold.readyAt != null && Date.now() < hold.readyAt) return { status: 'loading', own };
    return readyOf(locale, current, data);
  }
  if (queryId === want && q.isError) return { status: 'error', own, retry: () => void q.refetch() };
  return { status: 'loading', own };
}
