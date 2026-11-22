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
  chooseOption,
  flatItems,
  paletteStatus,
  parsePrefix,
  recordItems,
  recordSearch,
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
 * colours drop backgrounds, so there it gets the nav's 2 px Highlight outline
 * and the notch keeps its colour, as on the nav's current row (§6).
 */
const SELECTED =
  "bg-surface-2 text-ink before:pointer-events-none before:absolute before:start-0 before:top-[calc(50%-8px)] before:h-4 before:w-0.5 before:rounded-[1px] before:bg-primary before:content-[''] forced-colors:outline forced-colors:outline-2 forced-colors:-outline-offset-2 forced-colors:outline-[color:Highlight] forced-colors:before:forced-color-adjust-none";

/**
 * A key chip, `<kbd dir="ltr">` on every key token (sidebar spec §9): 20 tall,
 * 12/16 500, with the fill chosen by the caller.
 */
const KBD =
  'inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-xs border-b border-line px-1.5 font-sans text-caption font-medium text-muted';

/**
 * A shortcut chip's text: "G A", "Ctrl B". On Apple a modifier glyph joins its
 * key ("⌘B"), as in the sidebar's "⌘K" chip (sidebar spec §1.1).
 */
function chipText(keys: readonly string[], apple: boolean): string {
  return keys
    .map((k) => keyLabel(k, apple))
    .join(' ')
    .replace(/([⌘⌥]) /gu, '$1');
}

/**
 * A copy line with `{q}`: the query goes in as plain text, isolated in its own
 * `<bdi>` (never as HTML). Exported for the markup test.
 */
export function withQuery(template: string, q: string) {
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
  const hints: ReadonlyArray<readonly [key: string, words: string]> = c.footerHints;
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

  const { query } = parsePrefix(raw);
  // `due`: typed but not yet debounced, so the status says "searching", never
  // "no results" for a term nobody has searched yet.
  const search = recordSearch(raw, debounced, open && FINDS_RECORDS[role]);
  const enabled = search.run;
  const results = trpc.search.global.useQuery({ q: debounced }, { enabled, staleTime: 30_000 });

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
    chooseOption(item, {
      // Close now, not on the next render: the dialog hands focus back before a
      // command runs, so whatever the command opens or focuses stays put.
      close: () => {
        dialogRef.current?.close();
        onClose();
      },
      navigate: onNavigate,
      remember: (link) => {
        const next = recordVisit(recents, link, Date.now());
        setRecents(next);
        saveRecents(browserStorage(), next);
      },
    });
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
    } else if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
      // "Esc לסגירה" closes at once, typed text or not: a search field eats the first Esc to clear itself
      // (Chromium), and the dialog then never hears it.
      e.preventDefault();
      onClose();
    }
  }

  const statusKind = paletteStatus({
    query,
    count: items.length,
    pending: search.due || (enabled && results.isFetching),
    failed: enabled && results.isError,
  });
  const status =
    statusKind === 'error'
      ? c.error
      : statusKind === 'searching'
        ? c.searching
        : statusKind === 'noResults'
          ? withQuery(FINDS_RECORDS[role] ? c.noResults : c.noResultsScreens, raw.trim())
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
      className="fixed inset-x-0 top-[14vh] z-sheet m-0 mx-auto w-[min(640px,calc(100vw-32px))] flex-col overflow-hidden rounded-card border border-line bg-surface p-0 text-ink shadow-e3 backdrop:bg-ink/40 open:flex"
    >
      {open ? (
        <>
          {/* 52 px and flex: none, so the row never collapses when the list is empty (§1.6). The
              input fills the row's height (the field is the 52 px header, as in the reference); the
              hairline under it is drawn by ::after, so it takes none of that height, and the focus
              ring sits inside the field (offset −2, as on the nav's rows, §6). */}
          <label className="relative flex h-[52px] flex-none cursor-text items-center gap-3 px-4 after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:border-b after:border-line">
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
              data-focus="inset"
              className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-body text-ink placeholder:text-subtle"
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
                    const keys = item.keys?.length ? chipText(item.keys, apple) : null;
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
                              className={cn(KBD, selected ? 'bg-surface' : 'bg-surface-2')}
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
            {/* Key hints from sm up; each key is its own LTR chip, so ">" never shows mirrored. */}
            {hints.map(([key, words]) => (
              <span key={key} className="hidden items-center gap-1 sm:inline-flex">
                <kbd dir="ltr" className={cn(KBD, 'bg-surface-2')}>
                  {key}
                </kbd>
                {words}
              </span>
            ))}
            {moneyNote ? <span className="sm:ms-auto">{c.footerMoney}</span> : null}
          </div>
        </>
      ) : null}
    </dialog>
  );
}
