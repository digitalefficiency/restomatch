'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { IDLE, matchKeydown, matchKeyup, type ChordState } from '@/lib/hotkeys';

/**
 * Wires `lib/hotkeys.ts` to `window` for one mounted palette (W3-04). Not
 * mounted anywhere yet: W3-01 gives the layout slot, which renders
 * `<CommandPalette {...palette} />` and `<ShortcutSheet …/>` from this hook.
 *
 * - Ctrl/⌘K toggles the palette; `/` opens it;
 * - `?` opens the cheat sheet (yields on approvals routes);
 * - G-chords navigate when `canGo(href)` (the role's route check);
 * - Alt held shows hint badges (`hints`).
 */
export function usePalette(opts: {
  pathname: string;
  canGo: (href: string) => boolean;
  go: (href: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [cheatOpen, setCheatOpen] = useState(false);
  const [hints, setHints] = useState(false);
  const chord = useRef<ChordState>(IDLE);
  const latest = useRef(opts);
  latest.current = opts;

  useEffect(() => {
    function onDown(e: KeyboardEvent) {
      if (e.repeat && e.code !== 'KeyK') return;
      const { action, state } = matchKeydown(e, chord.current, {
        pathname: latest.current.pathname,
        now: e.timeStamp,
      });
      chord.current = state;
      if (!action) return;
      switch (action.type) {
        case 'palette':
          e.preventDefault();
          setCheatOpen(false);
          setOpen((o) => (e.code === 'KeyK' ? !o : true));
          return;
        case 'cheatSheet':
          e.preventDefault();
          setCheatOpen(true);
          return;
        case 'go':
          if (latest.current.canGo(action.href)) {
            e.preventDefault();
            latest.current.go(action.href);
          }
          return;
        case 'hints':
          setHints(action.on);
          return;
        case 'chordStart':
          return;
      }
    }
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
