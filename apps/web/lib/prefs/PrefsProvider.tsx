'use client';

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { UserRole } from '@restomatch/db';
import { useNavViewer } from '@/lib/nav/NavProvider';
import {
  COARSE_QUERY,
  NO_DEVICE_HINTS,
  defaultPrefs,
  densityAttr,
  resolvePrefs,
  tableDensity,
  textSizeRule,
  viewDensity,
  withChoice,
  type Density,
  type DeviceHints,
  type DisplayChoices,
  type DisplayPrefs,
  type TextSize,
} from './schema';
import { getDisplayChoices, setDisplayChoices, subscribeDisplay } from './store';
import { useMediaMatch } from './media';
import { mirrorDisplayAttrs } from './root';

interface PrefsContextValue {
  /** The viewer's role on the active restaurant (D4 defaults density by role). */
  role: UserRole | null;
  /** What the server read from the cookie: the snapshot for SSR and hydration. */
  serverChoices: DisplayChoices;
  /** What the server could tell about the device (User-Agent): the SSR snapshot of the device queries. */
  hints: DeviceHints;
}

const PrefsContext = createContext<PrefsContextValue | null>(null);
// Two @types/react copies in the workspace (see lib/i18n/client.tsx): cast like the other providers.
const PrefsCtxProvider = PrefsContext.Provider as unknown as React.ComponentType<{
  value: PrefsContextValue | null;
  children: React.ReactNode;
}>;

const NO_CHOICES: DisplayChoices = Object.freeze({}) as DisplayChoices;

/** A touch pointer: density is fixed at the regular size and its setting is absent. SSR uses the device hint. */
export function useIsCoarse(): boolean {
  const ctx = useContext(PrefsContext);
  return useMediaMatch(COARSE_QUERY, ctx?.hints.coarse ?? false);
}

const noSubscribe = () => () => {};
const isAppleClient = () =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(`${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`);

/** macOS / iOS: shortcuts are labelled ⌘ (lib/hotkeys.ts keyLabel). SSR uses the device hint. */
export function useIsApple(): boolean {
  const ctx = useContext(PrefsContext);
  const hint = ctx?.hints.apple ?? false;
  return useSyncExternalStore(noSubscribe, isAppleClient, () => hint);
}

export interface PrefsApi extends DisplayPrefs {
  /** Explicit choices stored on this device (missing = default). */
  choices: DisplayChoices;
  /** The role's defaults ("חזרה לברירת המחדל"). */
  defaults: DisplayPrefs;
  role: UserRole | null;
  /** A touch pointer: density is fixed there (SPEC §7). */
  coarse: boolean;
  /** The density the screen really uses: the choice, or 'regular' on a touch pointer. */
  appliedDensity: Density;
  /** The views toolbar's vocabulary, from the density in force (lib/components/views). */
  viewDensity: 'comfortable' | 'compact';
  /** DataTable's vocabulary, from the density in force (lib/components/table). */
  tableDensity: 'default' | 'compact';
  setDensity: (d: Density) => void;
  setTextSize: (t: TextSize) => void;
  setSingleKeys: (on: boolean) => void;
  /** Forget every display choice on this device. */
  reset: () => void;
}

/**
 * The personal display preferences, in force and settable. Works anywhere in
 * the dashboard; inside `PrefsProvider` the first render already has the
 * cookie's values (no flash). Setting acts at once and is stored per device.
 * Readers that size things use `appliedDensity` / `viewDensity` /
 * `tableDensity`; `density` is the choice (the switch's selected value).
 */
export function usePrefs(): PrefsApi {
  const ctx = useContext(PrefsContext);
  const viewer = useNavViewer();
  const serverChoices = ctx?.serverChoices ?? NO_CHOICES;
  const choices = useSyncExternalStore(subscribeDisplay, getDisplayChoices, () => serverChoices);
  const coarse = useIsCoarse();
  const role = ctx?.role ?? viewer?.role ?? null;
  return useMemo(() => {
    const prefs = resolvePrefs(choices, role);
    const applied: Density = coarse ? 'regular' : prefs.density;
    const set = <K extends keyof DisplayPrefs>(key: K, value: DisplayPrefs[K]) =>
      setDisplayChoices(withChoice(getDisplayChoices(), role, key, value));
    return {
      ...prefs,
      choices,
      defaults: defaultPrefs(role),
      role,
      coarse,
      appliedDensity: applied,
      viewDensity: viewDensity(applied),
      tableDensity: tableDensity(applied),
      setDensity: (d) => set('density', d),
      setTextSize: (t) => set('textSize', t),
      setSingleKeys: (on) => set('singleKeys', on),
      reset: () => setDisplayChoices({}),
    };
  }, [choices, role, coarse]);
}

/**
 * Applies the display preferences from the first HTML: a `display: contents`
 * wrapper carrying `data-density` (only "compact": the DS2 token density mode
 * in globals.css), `data-text-size` and `data-single-keys`, and — for large
 * text — a screen-only rule that enlarges the content column (schema.ts
 * `textSizeRule`). After hydration the attributes are mirrored onto <html> so
 * portals follow too, and restored when the provider unmounts. A nested
 * provider passes through.
 *
 * Usually mounted through the server component `PrefsRoot`, which reads the
 * cookie and the device hints. `role` defaults to the dashboard viewer's role
 * (NavProvider).
 */
export function PrefsProvider({
  initial,
  hints,
  role,
  children,
}: {
  initial: DisplayChoices;
  hints?: DeviceHints;
  role?: UserRole | null;
  children: React.ReactNode;
}) {
  const outer = useContext(PrefsContext);
  const viewer = useNavViewer();
  const resolvedRole = role ?? viewer?.role ?? null;
  const resolvedHints = hints ?? NO_DEVICE_HINTS;
  const value = useMemo(
    () => ({ role: resolvedRole, serverChoices: initial, hints: resolvedHints }),
    [resolvedRole, initial, resolvedHints],
  );
  if (outer) return <>{children}</>;
  return (
    <PrefsCtxProvider value={value}>
      <PrefsApplier>{children}</PrefsApplier>
    </PrefsCtxProvider>
  );
}

function PrefsApplier({ children }: { children: React.ReactNode }) {
  const p = usePrefs();
  const density = densityAttr(p.appliedDensity);
  const keys = p.singleKeys ? 'on' : 'off';
  const rule = textSizeRule(p.textSize);

  useEffect(
    () => mirrorDisplayAttrs(document.documentElement.dataset, { density, textSize: p.textSize, singleKeys: keys }),
    [density, p.textSize, keys],
  );

  return (
    <>
      {rule ? <style>{rule}</style> : null}
      <div data-rm-prefs="" data-density={density} data-text-size={p.textSize} data-single-keys={keys} className="contents">
        {children}
      </div>
    </>
  );
}
