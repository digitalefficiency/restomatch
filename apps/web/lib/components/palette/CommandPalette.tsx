'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { UserRole } from '@restomatch/db';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/components/cn';
import { paletteCopy } from './copy';
import { defaultActions } from './actions';
import { loadRecents, rankRecents, recordVisit, saveRecents } from './frecency';
import {
  buildPaletteSections,
  flatItems,
  parsePrefix,
  recordItems,
  type PaletteItem,
  type PaletteScreen,
} from './sections';

/** Roles whose `search.global` returns records (mirrors the server's `SEARCH_KINDS`). */
const FINDS_RECORDS: Readonly<Record<UserRole, boolean>> = {
  owner: true,
  manager: true,
  bookkeeper: true,
  chef: true,
  receiver: false,
};

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  role: UserRole;
  locale: 'he' | 'en';
  /** Registry screens this viewer may open, localized. */
  screens: readonly PaletteScreen[];
  /** The role's route check (`canSeeRoute(role, href)`). */
  canSee: (href: string) => boolean;
  onNavigate: (href: string) => void;
  /** "מחכה לך" (G-12a `awaitingDecision` once it lands). No ₪ for receiver/chef. */
  waiting?: readonly PaletteItem[];
  /** Whether the role may ask (owner/manager; slice b builds the Ask page). */
  canAsk?: boolean;
}

/**
 * The command palette (W3-04): a 640 px modal combobox. One input, grouped
 * results, keyboard-first (↑/↓, Enter, Esc). Records debounce into
 * `search.global` from 2 characters; screens, actions and recents match
 * locally through `normalizeHe` (finals, niqqud, geresh, wrong layout).
 * Not mounted: W3-01's layout slot renders it with `usePalette()`.
 */
export function CommandPalette(props: CommandPaletteProps) {
  const {
    open,
    onClose,
    role,
    locale,
    screens,
    canSee,
    onNavigate,
    waiting = [],
    canAsk = false,
  } = props;
  const c = paletteCopy[locale];
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [raw, setRaw] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);
  const [recents, setRecents] = useState(() =>
    typeof window === 'undefined' ? [] : loadRecents(window.localStorage),
  );
  const listId = 'rm-palette-list';

  // Native modal dialog: focus trap, Esc and the backdrop come with it; focus returns on close.
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) {
      setRaw('');
      setActive(0);
      d.showModal();
      inputRef.current?.focus();
    } else if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(parsePrefix(raw).query), 200);
    return () => clearTimeout(t);
  }, [raw]);

  const { mode } = parsePrefix(raw);
  const enabled = open && FINDS_RECORDS[role] && debounced.length >= 2 && mode !== 'actions';
  const results = trpc.search.global.useQuery({ q: debounced }, { enabled, staleTime: 30_000 });

  const sections = useMemo(() => {
    const records = enabled
      ? recordItems(results.data, {
          locale,
          canSee,
          noInvoiceNumber: c.noInvoiceNumber,
          orderLabel: c.order,
        })
      : [];
    return buildPaletteSections({
      raw,
      waiting,
      recents: rankRecents(recents, Date.now(), canSee),
      screens,
      records,
      actions: defaultActions(c).filter((a) => canSee(a.href)),
      ask: canAsk
        ? (q) => ({
            kind: 'ask',
            id: 'ask',
            label: c.ask(q),
            href: `/dashboard/ask?q=${encodeURIComponent(q)}`,
          })
        : null,
    });
  }, [raw, waiting, recents, screens, enabled, results.data, locale, canSee, c, canAsk]);

  const items = flatItems(sections);
  const safeActive = items.length ? Math.min(active, items.length - 1) : -1;

  function choose(item: PaletteItem) {
    const next = recordVisit(recents, item, Date.now());
    setRecents(next);
    saveRecents(typeof window === 'undefined' ? undefined : window.localStorage, next);
    onClose();
    onNavigate(item.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setActive((safeActive + d + items.length) % items.length);
    } else if (e.key === 'Enter' && safeActive >= 0) {
      e.preventDefault();
      choose(items[safeActive]!);
    }
  }

  const status =
    enabled && results.isError
      ? c.error
      : enabled && results.isFetching && items.length === 0
        ? c.searching
        : raw.trim() && items.length === 0
          ? c.noResults
          : null;

  let index = -1;
  return (
    <dialog
      ref={dialogRef}
      aria-label={c.label}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === dialogRef.current && onClose()}
      className="fixed inset-x-0 top-[12vh] z-sheet m-0 mx-auto w-[min(640px,calc(100vw-2rem))] flex-col overflow-hidden rounded-overlay border border-line bg-surface p-0 text-ink shadow-e3 backdrop:bg-ink/30 open:flex"
    >
      {open ? (
        <>
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-expanded={items.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={safeActive >= 0 ? `${listId}-${safeActive}` : undefined}
            aria-label={c.label}
            placeholder={FINDS_RECORDS[role] ? c.placeholder : c.placeholderScreens}
            value={raw}
            onChange={(e) => {
              setRaw(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            autoComplete="off"
            spellCheck={false}
            className="w-full border-0 border-b border-line bg-surface px-4 py-3.5 text-base text-ink placeholder:text-subtle"
          />
          <div
            id={listId}
            role="listbox"
            aria-label={c.label}
            className="max-h-[60vh] overflow-auto p-1.5"
          >
            {sections.map((s) => (
              <div key={s.key} role="group" aria-label={c.sections[s.key]} className="py-1">
                <div className="px-3 pb-1 pt-1.5 text-xs font-semibold text-subtle">
                  {c.sections[s.key]}
                </div>
                {s.items.map((item) => {
                  index += 1;
                  const i = index;
                  return (
                    <div
                      key={`${item.kind}:${item.id}`}
                      id={`${listId}-${i}`}
                      role="option"
                      aria-selected={i === safeActive}
                      onMouseMove={() => i !== safeActive && setActive(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => choose(item)}
                      className={cn(
                        'flex min-h-10 cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm',
                        i === safeActive ? 'bg-surface-2 text-ink' : 'text-muted',
                      )}
                    >
                      <span className="truncate">{item.label}</span>
                      {item.secondary ? (
                        <span className="shrink-0 truncate text-xs text-subtle" dir="auto">
                          {item.secondary}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))}
            {status ? (
              <p role="status" className="px-3 py-6 text-center text-sm text-subtle">
                {status}
              </p>
            ) : null}
          </div>
          <p className="hidden border-t border-line px-4 py-2 text-xs text-subtle sm:block">
            {c.footer}
          </p>
        </>
      ) : null}
    </dialog>
  );
}
