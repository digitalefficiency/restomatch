'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyLike } from '@/lib/components/desk/keys';
import { IDLE, matchKeydown, matchKeyup, type ChordState } from '@/lib/hotkeys';

/** What the shell passes to `usePalette`. Read through a ref, so it may change on every render. */
export interface UsePaletteOptions {
  pathname: string;
  canGo: (href: string) => boolean;
  go: (href: string) => void;
  /** The single-key switch; on when absent. */
  singleKeys?: boolean;
  /** Collapse / expand the side menu. Absent: Ctrl/⌘B and `[` stay the browser's. */
  onRail?: () => void;
}

/**
 * A modal dialog that owns the keyboard (sidebar SPEC §8: Ctrl/⌘B "not while
 * a dialog is open"). Two kinds exist in the app: native `<dialog>`s, which
 * all open with showModal() (palette, cheat sheet, bell, sheets, confirms),
 * and ARIA modals drawn as a `div`, such as the desk `Peek` drawer. A native
 * dialog counts only while `[open]`: overlay/Sheet keeps `aria-modal="true"`
 * on its `<dialog>` while it is closed. The side menu's own 1024–1279
 * overlay must never carry `aria-modal`: Ctrl/⌘B and `[` close it.
 */
export const MODAL_DIALOG = 'dialog[open], [aria-modal="true"]:not(dialog)';

/** One window keydown, as the handler reads it (a DOM `KeyboardEvent` fits). */
export interface PaletteKeyEvent extends KeyLike {
  repeat?: boolean;
  timeStamp: number;
  preventDefault: () => void;
}

/** What one keydown may read and change: the hook's latest options, its chord memory and its state. */
export interface PaletteKeyEnv {
  latest: { readonly current: UsePaletteOptions };
  chord: { current: ChordState };
  setOpen: (update: (open: boolean) => boolean) => void;
  setCheatOpen: (open: boolean) => void;
  setHints: (on: boolean) => void;
  /** True while a modal dialog owns the keys (`MODAL_DIALOG` matches in the page). */
  modalOpen: () => boolean;
}

/**
 * Runs one window keydown through the registry and acts on it. It lives
 * outside the hook so the wiring is unit-tested without a DOM: the single-key
 * switch reaching `matchKeydown`, the menu guard, and which keys are
 * `preventDefault`ed (a key the app does not act on stays the browser's).
 */
export function handlePaletteKeydown(e: PaletteKeyEvent, env: PaletteKeyEnv): void {
  if (e.repeat && e.code !== 'KeyK') return;
  const opts = env.latest.current;
  const { action, state } = matchKeydown(e, env.chord.current, {
    pathname: opts.pathname,
    now: e.timeStamp,
    singleKeys: opts.singleKeys,
  });
  env.chord.current = state;
  if (!action) return;
  switch (action.type) {
    case 'palette':
      e.preventDefault();
      env.setCheatOpen(false);
      env.setOpen((o) => (e.code === 'KeyK' ? !o : true));
      return;
    case 'cheatSheet':
      e.preventDefault();
      env.setCheatOpen(true);
      return;
    case 'go':
      if (opts.canGo(action.href)) {
        e.preventDefault();
        opts.go(action.href);
      }
      return;
    case 'hints':
      env.setHints(action.on);
      return;
    case 'chordStart':
      return;
    case 'rail':
      // A modal dialog (palette, cheat sheet, sheet, bell, a desk Peek) owns
      // the keys: the menu must not move under it.
      if (!opts.onRail || env.modalOpen()) return;
      e.preventDefault();
      opts.onRail();
      return;
  }
}

/**
 * Wires `lib/hotkeys.ts` to `window` for one mounted palette (W3-04). The app
 * shell (DS3-02) calls it once and renders `<CommandPalette {...palette} />`
 * and `<ShortcutSheet …/>` from it.
 *
 * - Ctrl/⌘K toggles the palette; `/` opens it;
 * - `?` opens the cheat sheet (yields on approvals routes);
 * - G-chords navigate when `canGo(href)` (the role's route check);
 * - Ctrl/⌘B and `[` call `onRail` (collapse / expand, or the overlay at
 *   1024–1279), except while a modal dialog is open (`MODAL_DIALOG`,
 *   sidebar SPEC §8);
 * - `singleKeys: false` (the "קיצורים בתו אחד" switch, WCAG 2.1.4) turns off
 *   `/`, `?`, `[` and the G-chords; Ctrl/⌘ combinations stay on;
 * - Alt held shows hint badges (`hints`).
 *
 * Every option is read through `latest`, so the listeners are bound once and
 * a flipped switch or a new `onRail` applies from the next key.
 */
export function usePalette(opts: UsePaletteOptions) {
  const [open, setOpen] = useState(false);
  const [cheatOpen, setCheatOpen] = useState(false);
  const [hints, setHints] = useState(false);
  const chord = useRef<ChordState>(IDLE);
  const latest = useRef(opts);
  latest.current = opts;

  useEffect(() => {
    const env: PaletteKeyEnv = {
      latest,
      chord,
      setOpen,
      setCheatOpen,
      setHints,
      modalOpen: () => document.querySelector(MODAL_DIALOG) !== null,
    };
    const onDown = (e: KeyboardEvent) => handlePaletteKeydown(e, env);
    function onUp(e: KeyboardEvent) {
      const a = matchKeyup(e);
      if (a?.type === 'hints') setHints(false);
    }
    const onBlur = () => setHints(false);
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const close = useCallback(() => setOpen(false), []);
  return { open, setOpen, close, cheatOpen, setCheatOpen, hints };
}
