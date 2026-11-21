'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { UserRole } from '@restomatch/db';
import { cn } from '@/lib/components/cn';
import { usePalette } from '@/lib/components/palette';
import {
  RAIL_STORAGE,
  railCookie,
  readFavourites,
  safeStorage,
  writeFavourites,
} from '../prefs';
import { sanitizeFavourites, toggleFavourite as toggleFavouriteIn } from '../favourites';
import { tokenDensity, usePrefs } from '@/lib/prefs';
import { shellModel } from '../shellModel';
import css from './shell.module.css';
import { NavTooltip } from './NavTooltip';
import { PaletteMount } from './PaletteMount';
import type { NavViewer } from '../types';

/** ≥ 1280 · 1024–1279 · < 1024 (sidebar spec §7.1). */
export type Viewport = 'wide' | 'mid' | 'narrow';
/** How the side menu presents right now. `flat` = the chef's and receiver's labelled rail (§1.4). */
export type NavMode = 'panel' | 'rail' | 'overlay' | 'flat' | 'none';

export interface ShellUi {
  role: UserRole;
  flat: boolean;
  /** The rail preference (cookie `rm_nav_rail`), honoured at ≥ 1280. */
  rail: boolean;
  viewport: Viewport | null;
  mode: NavMode;
  overlayOpen: boolean;
  /** Ctrl/⌘ B, `[`, the toggle, the edge, the palette: ≥ 1280 flips the rail, 1024–1279 opens or closes the overlay. */
  toggleRail: () => void;
  /**
   * Set the stored rail preference itself (the settings screen's "תפריט הצד": מורחב / מכווץ). It applies at
   * ≥ 1280, with the collapse motion; below that only the choice is stored (1024–1279 always shows the rail).
   */
  setRail: (on: boolean) => void;
  closeOverlay: (opts?: { restoreFocus?: boolean }) => void;
  /** Register the toggle button, so closing the overlay can give it focus back. */
  toggleRef: React.MutableRefObject<HTMLButtonElement | null>;
  moreOpen: boolean;
  openMore: (opener?: HTMLElement | null) => void;
  closeMore: (opts?: { restoreFocus?: boolean }) => void;
  paletteOpen: boolean;
  openPalette: () => void;
  closePalette: () => void;
  cheatOpen: boolean;
  openCheat: () => void;
  closeCheat: () => void;
  singleKeys: boolean;
  setSingleKeys: (on: boolean) => void;
  favourites: readonly string[];
  toggleFavourite: (key: string) => { added: boolean; full: boolean };
  /** One polite live region for the whole shell (fit rule, favourites). */
  announce: (text: string) => void;
  /** The role's G-chord check; the palette mount sets it (a ref, so the key listener binds once). */
  goCheck: React.MutableRefObject<(href: string) => boolean>;
}

const ShellUiContext = createContext<ShellUi | null>(null);
// Cast like the other providers: two @types/react copies (see lib/i18n/client.tsx).
const ShellUiProvider = ShellUiContext.Provider as unknown as React.ComponentType<{
  value: ShellUi | null;
  children: React.ReactNode;
}>;

export function useShellUi(): ShellUi {
  const ctx = useContext(ShellUiContext);
  if (!ctx) throw new Error('ShellFrame missing');
  return ctx;
}

/** The shell UI when mounted inside the dashboard frame, else null (shared components, tests). */
export function useOptionalShellUi(): ShellUi | null {
  return useContext(ShellUiContext);
}

const FLAT_ROLES: ReadonlySet<UserRole> = new Set(['chef', 'receiver']);

function useViewport(): Viewport | null {
  const [vp, setVp] = useState<Viewport | null>(null);
  useEffect(() => {
    const wide = window.matchMedia('(min-width: 1280px)');
    const desk = window.matchMedia('(min-width: 1024px)');
    const read = () => setVp(wide.matches ? 'wide' : desk.matches ? 'mid' : 'narrow');
    read();
    wide.addEventListener('change', read);
    desk.addEventListener('change', read);
    return () => {
      wide.removeEventListener('change', read);
      desk.removeEventListener('change', read);
    };
  }, []);
  return vp;
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Focus the element that opened an overlay, if it is still in the page. */
function restoreFocus(el: HTMLElement | null) {
  if (el && document.contains(el)) el.focus({ preventScroll: true });
}

/**
 * The app frame (DS3-02). Owns the side menu's state and publishes it as data
 * attributes on #rm-app, where the stylesheet turns them into widths (so the
 * server-rendered cookie gives the final width at first paint, sidebar spec
 * §7.1). Mounts the command palette and the `?` cheat sheet once, bound to the
 * one shortcut registry (lib/hotkeys.ts) on `KeyboardEvent.code`.
 */
export function ShellFrame({
  initialRail,
  viewer,
  sidebar,
  overlays,
  children,
}: {
  initialRail: boolean;
  viewer: NavViewer;
  /** The side menu (rendered first: skip link → menu → top bar → main is the Tab order). */
  sidebar: React.ReactNode;
  /** Modal layers that must stay outside the inert page column (the phone sheet). */
  overlays?: React.ReactNode;
  children: React.ReactNode;
}) {
  const role = viewer.role;
  const flat = FLAT_ROLES.has(role);
  const [rail, setRail] = useState(initialRail);
  const railRef = useRef(initialRail);
  const viewport = useViewport();
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [phase, setPhase] = useState<'out' | 'in' | null>(null);
  const [dir, setDir] = useState<'collapse' | 'expand' | null>(null);
  const busy = useRef(false);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const openerRef = useRef<HTMLElement | null>(null);
  // The single-key switch is a display preference: DS3-06's store (lib/prefs), mounted by the layout, so
  // the account menu, the cheat sheet, the palette, the settings screen and the desk keys share one value.
  const prefs = usePrefs();
  const singleKeys = prefs.singleKeys;
  const setSingleKeys = prefs.setSingleKeys;
  const [favourites, setFavourites] = useState<string[]>([]);
  const [said, setSaid] = useState('');
  const pathname = usePathname();
  const router = useRouter();

  const mode: NavMode =
    viewport === 'narrow'
      ? 'none'
      : flat
        ? 'flat'
        : viewport === 'mid'
          ? overlayOpen
            ? 'overlay'
            : 'rail'
          : rail
            ? 'rail'
            : 'panel';

  // Favourites live in localStorage per role (spec §7.1, §13); read after hydration.
  useEffect(() => {
    setFavourites(readFavourites(role, safeStorage()));
  }, [role]);

  const closeOverlay = useCallback((opts?: { restoreFocus?: boolean }) => {
    setOverlayOpen((open) => {
      if (open && opts?.restoreFocus !== false) requestAnimationFrame(() => restoreFocus(toggleRef.current));
      return false;
    });
  }, []);

  // Leaving 1024–1279 (or navigating) closes the overlay: the new page's h1 takes focus.
  useEffect(() => {
    if (viewport !== 'mid') setOverlayOpen(false);
  }, [viewport]);
  useEffect(() => {
    setOverlayOpen(false);
  }, [pathname]);

  // Store the rail choice and, at ≥ 1280, move to it: the words fade (80 ms), then the width closes (160 ms);
  // expanding, the width opens (200 ms), then the words arrive (140 ms after 130 ms) — sidebar spec §10.
  const applyRail = useCallback((next: boolean, vp: Viewport) => {
    railRef.current = next;
    try {
      document.cookie = railCookie(next, window.location.protocol === 'https:');
    } catch {
      /* cookies blocked: the choice lives for this page only */
    }
    try {
      safeStorage()?.setItem(RAIL_STORAGE, next ? '1' : '0');
    } catch {
      /* the cookie still carries it */
    }
    if (vp !== 'wide' || prefersReducedMotion()) {
      setRail(next);
      return;
    }
    busy.current = true;
    setDir(next ? 'collapse' : 'expand');
    setPhase('out');
    window.setTimeout(() => {
      setRail(next);
      setPhase('in');
      window.setTimeout(
        () => {
          setPhase(null);
          setDir(null);
          busy.current = false;
        },
        next ? 220 : 300,
      );
    }, 80);
  }, []);

  const currentViewport = useCallback(
    (): Viewport =>
      viewport ?? (window.matchMedia('(min-width: 1280px)').matches ? 'wide' : window.matchMedia('(min-width: 1024px)').matches ? 'mid' : 'narrow'),
    [viewport],
  );

  const toggleRail = useCallback(() => {
    if (flat || busy.current) return;
    const vp = currentViewport();
    if (vp === 'narrow') return;
    if (vp === 'mid') {
      setOverlayOpen((o) => !o);
      return;
    }
    applyRail(!railRef.current, vp);
  }, [flat, currentViewport, applyRail]);

  const setRailPref = useCallback(
    (on: boolean) => {
      if (flat || busy.current || railRef.current === on) return;
      applyRail(on, currentViewport());
    },
    [flat, currentViewport, applyRail],
  );

  const openMore = useCallback((opener?: HTMLElement | null) => {
    openerRef.current = opener ?? (document.activeElement as HTMLElement | null);
    setMoreOpen(true);
  }, []);
  const closeMore = useCallback((opts?: { restoreFocus?: boolean }) => {
    setMoreOpen(false);
    if (opts?.restoreFocus === false) return;
    const opener = openerRef.current;
    requestAnimationFrame(() => restoreFocus(opener));
  }, []);

  // A stored key the viewer can no longer open (another restaurant's flags, a renamed route) must not hold
  // one of the five places with no star to remove it: toggle on the list the menu shows.
  const navKeys = useMemo(() => {
    const m = shellModel(viewer);
    return new Set([...m.groups, ...m.footer].flatMap((g) => g.items.map((i) => i.key)));
  }, [viewer]);
  const toggleFavourite = useCallback(
    (key: string) => {
      const res = toggleFavouriteIn(sanitizeFavourites(favourites, navKeys), key);
      if (!res.full) {
        setFavourites(res.list);
        writeFavourites(role, res.list, safeStorage());
      }
      return { added: res.added, full: res.full };
    },
    [favourites, navKeys, role],
  );

  const announce = useCallback((text: string) => {
    // Clear first, so the same words twice are still spoken.
    setSaid('');
    requestAnimationFrame(() => setSaid(text));
  }, []);

  const goCheck = useRef<(href: string) => boolean>(() => false);
  const pal = usePalette({
    pathname,
    canGo: (href) => goCheck.current(href),
    go: (href) => router.push(href),
    singleKeys,
    onRail: toggleRail,
  });

  const value: ShellUi = useMemo(
    () => ({
      role,
      flat,
      rail,
      viewport,
      mode,
      overlayOpen,
      toggleRail,
      setRail: setRailPref,
      closeOverlay,
      toggleRef,
      moreOpen,
      openMore,
      closeMore,
      paletteOpen: pal.open,
      openPalette: () => {
        setMoreOpen(false);
        pal.setCheatOpen(false);
        pal.setOpen(true);
      },
      closePalette: pal.close,
      cheatOpen: pal.cheatOpen,
      openCheat: () => {
        pal.setOpen(false);
        pal.setCheatOpen(true);
      },
      closeCheat: () => pal.setCheatOpen(false),
      singleKeys,
      setSingleKeys,
      favourites,
      toggleFavourite,
      announce,
      goCheck,
    }),
    [
      role,
      flat,
      rail,
      viewport,
      mode,
      overlayOpen,
      toggleRail,
      setRailPref,
      closeOverlay,
      moreOpen,
      openMore,
      closeMore,
      pal,
      singleKeys,
      setSingleKeys,
      favourites,
      toggleFavourite,
      announce,
    ],
  );

  // DS3 "Personal preferences: one contract": the shell carries density and text size from the first HTML.
  // The values come from DS3-06's store (its provider, mounted by the layout, hands over the server's cookie
  // snapshot), so the shell, the settings screen and the tables always agree.
  return (
    <ShellUiProvider value={value}>
      <div
        id="rm-app"
        className={cn(css.app, 'min-h-screen')}
        data-rail={rail ? 'on' : 'off'}
        data-density={tokenDensity(prefs.appliedDensity)}
        data-text={prefs.textSize}
        data-flat={flat ? '' : undefined}
        data-overlay={overlayOpen ? 'open' : undefined}
        data-nav-mode={viewport ? mode : undefined}
        data-nav-phase={phase ?? undefined}
        data-nav-dir={dir ?? undefined}
        data-hints={pal.hints ? '' : undefined}
      >
        {sidebar}
        {overlayOpen ? <div className={css.scrim} aria-hidden="true" onClick={() => closeOverlay()} /> : null}
        <div className={css.col} inert={overlayOpen || undefined}>
          {children}
        </div>
        <NavTooltip mode={mode} />
        <p role="status" aria-live="polite" className="sr-only" data-testid="nav-live">
          {said}
        </p>
      </div>
      {overlays}
      <PaletteMount viewer={viewer} ui={value} />
    </ShellUiProvider>
  );
}
