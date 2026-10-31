'use client';

import { useCallback, useEffect, useId, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from '@/lib/i18n/client';
import { cn } from '../cn';
import { deskCopy } from '../table/copy';
import { useTableUrlState } from '../table/useTableUrlState';
import { deskKeyOf, moveIndex } from './keys';
import { Peek } from './Peek';
import { useMediaQuery } from './useMediaQuery';

/**
 * Register layout (lens-exec-desktop §3.4 E, §3.6): the list at the
 * inline-start (400 px, 440 at 2xl) and the selected row's detail beside it.
 * The selection is `?sel=` and changes with **no** route change, so Back and
 * shared links restore it. J/K (by `KeyboardEvent.code`, so ח/ל on a Hebrew
 * layout) and ↓/↑ move only while the list has focus; Enter opens the full
 * page, Ctrl/⌘+Enter opens it in a new tab, Esc clears. Below 1280 px the list
 * goes full width and the detail opens in a Peek.
 */
export function SplitPane<Item>({
  items,
  itemKey,
  label,
  renderItem,
  renderDetail,
  detailTitle,
  emptyDetail,
  hrefOf,
  onPrefetch,
  className,
}: {
  items: readonly Item[];
  itemKey: (item: Item) => string;
  /** Accessible name of the list. */
  label: string;
  renderItem: (item: Item, selected: boolean) => React.ReactNode;
  renderDetail: (item: Item) => React.ReactNode;
  detailTitle: (item: Item) => React.ReactNode;
  emptyDetail: React.ReactNode;
  /** Full-page URL of an item (Enter / Ctrl+Enter / the peek's "open full page"). */
  hrefOf?: (item: Item) => string;
  /** Called with the next few ids after a move, so detail data can be warmed. */
  onPrefetch?: (ids: string[]) => void;
  className?: string;
}) {
  const copy = deskCopy(useLocale());
  const [state, update] = useTableUrlState();
  const wide = useMediaQuery('(min-width: 1280px)', true);
  const listRef = useRef<HTMLUListElement>(null);
  const hintId = useId();
  const router = useRouter();
  const selIndex = state.sel ? items.findIndex((i) => itemKey(i) === state.sel) : -1;
  const selected = selIndex >= 0 ? items[selIndex] : undefined;

  const focusItem = useCallback((index: number) => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.focus({ preventScroll: false });
  }, []);

  const select = useCallback(
    (index: number) => {
      const item = items[index];
      if (!item) return;
      update({ sel: itemKey(item) });
      onPrefetch?.(items.slice(index + 1, index + 4).map(itemKey));
    },
    [items, itemKey, update, onPrefetch],
  );

  // Keep the focused option in view when the selection arrives from the URL (Back, a link).
  useEffect(() => {
    if (selIndex < 0) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${selIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selIndex]);

  const open = (item: Item, newTab: boolean) => {
    const href = hrefOf?.(item);
    if (!href) return;
    if (newTab) window.open(href, '_blank', 'noopener');
    else router.push(href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const k = deskKeyOf(e);
    if (!k) return;
    const current = selIndex >= 0 ? selIndex : Number((e.target as HTMLElement).dataset.index ?? -1);
    if (k === 'next' || k === 'prev') {
      e.preventDefault();
      const i = moveIndex(current, k === 'next' ? 1 : -1, items.length);
      select(i);
      focusItem(i);
    } else if (k === 'open' || k === 'openTab') {
      if (selected) {
        e.preventDefault();
        if (!wide && k === 'open') update({ peek: itemKey(selected) });
        else open(selected, k === 'openTab');
      }
    } else if (k === 'peek' || k === 'select') {
      e.preventDefault();
      const target = items[current];
      if (!target) return;
      if (wide) select(current);
      else update({ sel: itemKey(target), peek: itemKey(target) });
    } else if (k === 'escape') {
      if (state.sel || state.peek) {
        e.preventDefault();
        update({ sel: null, peek: null });
      }
    }
  };

  const peekItem = !wide && state.peek ? items.find((i) => itemKey(i) === state.peek) : undefined;

  return (
    <div className={cn('flex min-h-0 gap-6', className)} data-splitpane="">
      <ul
        ref={listRef}
        role="listbox"
        aria-label={label}
        aria-describedby={hintId}
        onKeyDown={onKeyDown}
        className={cn(
          'min-h-0 overflow-y-auto rounded-xl border border-line bg-surface',
          wide ? 'w-[400px] shrink-0 2xl:w-[440px]' : 'w-full',
        )}
      >
        {items.map((item, i) => {
          const id = itemKey(item);
          const on = id === state.sel;
          return (
            <li
              key={id}
              role="option"
              aria-selected={on}
              data-index={i}
              data-row-id={id}
              tabIndex={on || (selIndex < 0 && i === 0) ? 0 : -1}
              onClick={() => (wide ? select(i) : update({ sel: id, peek: id }))}
              className={cn(
                'relative cursor-pointer border-b border-line px-4 py-2 last:border-b-0',
                'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-info',
                on ? 'bg-primary/[0.08] before:absolute before:inset-y-0 before:start-0 before:w-0.5 before:bg-primary' : 'hover:bg-surface-2',
              )}
            >
              {renderItem(item, on)}
            </li>
          );
        })}
      </ul>
      <p id={hintId} className="sr-only">
        {copy.keysHint}
      </p>
      {wide ? (
        <section className="min-w-[560px] flex-1 rounded-xl border border-line bg-surface p-5" data-split-detail="">
          {selected ? renderDetail(selected) : emptyDetail}
        </section>
      ) : (
        <Peek
          open={!!peekItem}
          title={peekItem ? detailTitle(peekItem) : ''}
          fullHref={peekItem ? hrefOf?.(peekItem) : undefined}
          onClose={() => update({ peek: null })}
          returnFocus={() => listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')}
        >
          {peekItem ? renderDetail(peekItem) : null}
        </Peek>
      )}
    </div>
  );
}
