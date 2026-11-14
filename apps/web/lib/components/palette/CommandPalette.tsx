'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type { UserRole } from '@restomatch/db';
import { keyLabel } from '@/lib/hotkeys';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/components/cn';
import { paletteCopy } from './copy';
import { defaultActions } from './actions';
import { browserStorage, loadRecents, rankRecents, recordVisit, saveRecents } from './frecency';
import {
  buildPaletteSections,
  flatItems,
  parsePrefix,
  recordItems,
  withoutMoney,
  type PaletteCommand,
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

/** Roles that never see ₪ (sidebar spec §15): the palette strips it a second time for them. */
const NO_MONEY: ReadonlySet<UserRole> = new Set<UserRole>(['chef', 'receiver']);

/**
 * The selected option: `surface-2` plus the nav's 2 × 16 primary notch at the
 * inline-start edge (sidebar spec §1.6; never a full-height edge). Forced
 * colours drop backgrounds, so an outline keeps the selection visible there.
 */
const SELECTED =
  "bg-surface-2 text-ink before:pointer-events-none before:absolute before:start-0 before:top-[calc(50%-8px)] before:h-4 before:w-0.5 before:rounded-[1px] before:bg-primary before:content-[''] forced-colors:outline forced-colors:outline-2 forced-colors:-outline-offset-2";

/** A copy line with `{q}`: the query goes in as plain text, isolated in its own `<bdi>`. */
function withQuery(template: string, q: string) {
  const at = template.indexOf('{q}');
  if (at < 0) return template;
  return (
    <>
      {template.slice(0, at)}
      <bdi>{q}</bdi>
      {template.slice(at + 3)}
    </>
  );
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  role: UserRole;
  locale: 'he' | 'en';
  /** Registry screens this viewer may open, localized ("מעבר אל"). */
  screens: readonly PaletteScreen[];
  /** The role's route check (`canSeeRoute(role, href)`). */
  canSee: (href: string) => boolean;
  onNavigate: (href: string) => void;
  /** "מחכה לך" (G-12a `awaitingDecision` once it lands). No ₪ for receiver/chef. */
  waiting?: readonly PaletteItem[];
  /** Whether the role may ask (owner/manager; slice b builds the Ask page). */
  canAsk?: boolean;
  /**
   * "תצוגה" (DS3 spec §10.5): display commands such as collapsing the menu or
   * turning single-key shortcuts on and off. They run in place and never
   * navigate; shown without a query too, since the list is short.
   */
  commands?: readonly PaletteCommand[];
  /** "הגדרות": the role's settings sections, localized (e.g. from `settingsFor(role)`); listed once the viewer types. */
  settings?: readonly PaletteScreen[];
  /**
   * G-chord keys by href (`chordsByHref(HOTKEYS)`), shown as chips on "מעבר אל"
   * options. Pass it only while single-key shortcuts are on: a chip for a
   * chord that does nothing would teach the wrong thing.
   */
  chords?: Readonly<Record<string, readonly string[]>>;
}

/**
 * The command palette (W3-04, DS3-02): a 640 px modal combobox, 14vh from the
 * top. One 52 px input row, grouped results, keyboard-first (↑/↓, Enter,
 * Esc). Records debounce into `search.global` from 2 characters; screens,
 * actions, display commands, settings and recents match locally through
 * `normalizeHe` (finals, niqqud, geresh, wrong layout). A link option
 * navigates; a display command closes the palette and runs in place. Money
 * moves only ever link to their own screen.
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
    commands,
    settings,
    chords,
  } = props;
  const c = paletteCopy[locale];
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [raw, setRaw] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);
  const [recents, setRecents] = useState(() => loadRecents(browserStorage()));
  const listId = 'rm-palette-list';
  const apple = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

  // Native modal dialog: focus trap, Esc and the backdrop come with it; focus returns on close.
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) {
      setRaw('');
      setDebounced('');
      setActive(0);
      d.showModal();
      inputRef.current?.focus();
    } else if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(parsePrefix(raw).query), 200);
    return () => clearTimeout(t);
  }, [raw]);

  const { mode, query } = parsePrefix(raw);
  const searchable = open && FINDS_RECORDS[role] && mode !== 'actions';
  const enabled = searchable && debounced.length >= 2;
  const results = trpc.search.global.useQuery({ q: debounced }, { enabled, staleTime: 30_000 });
  // A record search is due but the debounce has not caught up with the input:
  // say "searching", never "no results" for a query nobody has searched yet.
  const settling = searchable && query.length >= 2 && debounced !== query;

  const actions = useMemo(() => defaultActions(c).filter((a) => canSee(a.href)), [c, canSee]);
  // The money note speaks to viewers who can open a money action at all.
  const moneyNote = actions.some((a) => a.money);

  const sections = useMemo(() => {
    const records = enabled
      ? recordItems(results.data, {
          locale,
          canSee,
          noInvoiceNumber: c.noInvoiceNumber,
          orderLabel: c.order,
        })
      : [];
    const built = buildPaletteSections({
      raw,
      waiting,
      recents: rankRecents(recents, Date.now(), canSee),
      screens,
      records,
      actions,
      ask: canAsk
        ? (q) => ({
            kind: 'ask',
            id: 'ask',
            label: c.ask(q),
            href: `/dashboard/ask?q=${encodeURIComponent(q)}`,
          })
        : null,
      commands,
      settings,
      chords,
    });
    return NO_MONEY.has(role) ? withoutMoney(built) : built;
  }, [
    raw,
    waiting,
    recents,
    screens,
    enabled,
    results.data,
    locale,
    canSee,
    c,
    canAsk,
    actions,
    commands,
    settings,
    chords,
    role,
  ]);

  const items = flatItems(sections);
  const safeActive = items.length ? Math.min(active, items.length - 1) : -1;

  // Keep the selected option in view while ↑/↓ walk past the list's edge.
  useEffect(() => {
    if (!open || safeActive < 0) return;
    document.getElementById(`${listId}-${safeActive}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, safeActive]);

  function choose(item: PaletteItem) {
    if (item.kind === 'command') {
      // Close first, so the dialog hands focus back before the command runs and
      // whatever it opens or focuses stays put. A command never navigates.
      dialogRef.current?.close();
      onClose();
      item.run();
      return;
    }
    const next = recordVisit(recents, item, Date.now());
    setRecents(next);
    saveRecents(browserStorage(), next);
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

  const typed = raw.trim();
  const status =
    enabled && results.isError
      ? c.error
      : items.length === 0 && (settling || (enabled && results.isFetching))
        ? c.searching
        : typed && items.length === 0
          ? withQuery(FINDS_RECORDS[role] ? c.noResults : c.noResultsScreens, typed)
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
      className="fixed inset-x-0 top-[14vh] z-sheet m-0 mx-auto w-[min(640px,calc(100vw-32px))] flex-col overflow-hidden rounded-overlay border border-line bg-surface p-0 text-ink shadow-e3 backdrop:bg-ink/30 open:flex"
    >
      {open ? (
        <>
          {/* 52 px and flex: none, so the row never collapses when the list is empty (§1.6). */}
          <label className="flex h-[52px] flex-none cursor-text items-center gap-3 border-b border-line px-4">
            <Search
              aria-hidden="true"
              width={20}
              height={20}
              strokeWidth={1.75}
              className="shrink-0 text-subtle"
            />
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
              className="h-9 min-w-0 flex-1 border-0 bg-transparent p-0 text-body text-ink placeholder:text-subtle"
            />
          </label>
          <div className="max-h-[60vh] min-h-0 overflow-auto">
            <div
              id={listId}
              role="listbox"
              aria-label={c.label}
              className={items.length ? 'p-1.5' : undefined}
            >
              {sections.map((s) => (
                <div key={s.key} role="group" aria-label={c.sections[s.key]} className="py-1">
                  <div className="px-3 pb-1 pt-1.5 text-caption font-semibold text-subtle">
                    {c.sections[s.key]}
                  </div>
                  {s.items.map((item) => {
                    index += 1;
                    const i = index;
                    const selected = i === safeActive;
                    const keys = item.keys?.length
                      ? item.keys.map((k) => keyLabel(k, apple)).join(' ')
                      : null;
                    return (
                      <div
                        key={`${item.kind}:${item.id}`}
                        id={`${listId}-${i}`}
                        role="option"
                        aria-selected={selected}
                        onMouseMove={() => i !== safeActive && setActive(i)}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => choose(item)}
                        className={cn(
                          'relative flex min-h-10 cursor-pointer items-center gap-3 rounded-control px-3 py-2 text-body-sm',
                          selected ? SELECTED : 'text-muted',
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {item.secondary ? (
                          <span
                            className="max-w-[40%] shrink-0 truncate text-caption text-subtle"
                            dir="auto"
                          >
                            {item.secondary}
                          </span>
                        ) : null}
                        {keys ? (
                          <>
                            <kbd
                              dir="ltr"
                              aria-hidden="true"
                              className={cn(
                                'inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-xs border-b border-line px-1.5 font-sans text-caption font-medium text-muted',
                                selected ? 'bg-surface' : 'bg-surface-2',
                              )}
                            >
                              {keys}
                            </kbd>
                            <span className="sr-only">{`, ${c.shortcut} ${keys}`}</span>
                          </>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            {/* Outside the listbox (a listbox owns options and groups only); always mounted, so changes are announced. */}
            <div role="status">
              {status ? (
                <p className="px-3 py-6 text-center text-body-sm text-subtle">{status}</p>
              ) : null}
            </div>
          </div>
          <div
            className={cn(
              'flex-none flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-2.5 text-caption text-subtle',
              moneyNote ? 'flex' : 'hidden sm:flex',
            )}
          >
            <span className="hidden sm:inline">{c.footer}</span>
            {moneyNote ? <span className="sm:ms-auto">{c.footerMoney}</span> : null}
          </div>
        </>
      ) : null}
    </dialog>
  );
}
