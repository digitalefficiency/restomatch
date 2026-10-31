'use client';

import { useEffect, useMemo, useSyncExternalStore, type RefObject } from 'react';
import { useSearchParams } from 'next/navigation';
import { parseTableState, writeTableState, type TableUrlState } from './urlState';

/**
 * The URL is the table's state (sort, cols, sel, peek, view, page, d), so a
 * view is shareable and Back restores it. Writes go through the History API
 * (no navigation, no server round-trip), and every table hook on the page
 * reads `location.search` through one tiny store, so a J/K move or a Peek
 * re-renders in the same frame instead of waiting for the router to sync.
 * `view` and `page` push a history entry (Back undoes them); the rest replace.
 */
const listeners = new Set<() => void>();

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  window.addEventListener('popstate', notify);
  return () => {
    listeners.delete(notify);
    window.removeEventListener('popstate', notify);
  };
}

const readSearch = () => window.location.search;

export function useTableUrlState(): [TableUrlState, (patch: Partial<TableUrlState>) => void] {
  // Router navigations (Link, router.push) re-render through useSearchParams; the
  // snapshot is then read fresh. The server render uses the router's params.
  const params = useSearchParams();
  const serverSearch = params?.toString() ?? '';
  const search = useSyncExternalStore(subscribe, readSearch, () => (serverSearch ? `?${serverSearch}` : ''));
  const state = useMemo(() => parseTableState(new URLSearchParams(search)), [search]);

  return [state, updateTableUrl];
}

/** Writes table keys onto the current URL without a navigation, and notifies every table hook. */
export function updateTableUrl(patch: Partial<TableUrlState>): void {
  const current = new URLSearchParams(window.location.search);
  const next = { ...parseTableState(current), ...patch };
  const qs = writeTableState(next, current).toString();
  const url = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
  if (url === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
  const push = 'view' in patch || 'page' in patch;
  // `null` state: Next.js syncs `useSearchParams` with native History calls (it skips its own entries).
  window.history[push ? 'pushState' : 'replaceState'](null, '', url);
  for (const notify of listeners) notify();
}

type ScalarKey = 'sel' | 'peek' | 'view' | 'page' | 'density';

/**
 * One table key, re-rendering only when that key changes — for a page that
 * reads `view` beside a table, so a J/K move or a Peek does not re-render it.
 */
export function useTableUrlValue<K extends ScalarKey>(key: K): TableUrlState[K] {
  const params = useSearchParams();
  const serverSearch = params?.toString() ?? '';
  const raw = useSyncExternalStore(
    subscribe,
    () => String(parseTableState(new URLSearchParams(window.location.search))[key] ?? ''),
    () => String(parseTableState(new URLSearchParams(serverSearch))[key] ?? ''),
  );
  return parseTableState(new URLSearchParams(raw ? { [key === 'density' ? 'd' : key]: raw } : {}))[key];
}

const SCROLL_PREFIX = 'rm:table-scroll:';

/**
 * Remembers a scroll container's position per table for the tab's
 * session, so Back from a detail page lands on the same row (D8). Storage can
 * throw (private mode, blocked) — the table works without it.
 */
export function useScrollMemory(ref: RefObject<HTMLElement | null>, tableId: string, ready = true): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || !ready) return;
    const key = `${SCROLL_PREFIX}${tableId}`;
    try {
      const saved = Number(window.sessionStorage.getItem(key));
      if (saved > 0) el.scrollTop = saved;
    } catch {
      /* storage unavailable */
    }
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        try {
          window.sessionStorage.setItem(key, String(Math.round(el.scrollTop)));
        } catch {
          /* storage unavailable */
        }
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('scroll', onScroll);
    };
  }, [ref, tableId, ready]);
}
