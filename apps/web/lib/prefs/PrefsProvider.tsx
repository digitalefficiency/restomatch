'use client';

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { UserRole } from '@restomatch/db';
import { useNavViewer } from '@/lib/nav/NavProvider';
import {
  TEXT_SCALE,
  defaultPrefs,
  resolvePrefs,
  tokenDensity,
  withChoice,
  type Density,
  type DisplayChoices,
  type DisplayPrefs,
  type TextSize,
} from './schema';
import { getDisplayChoices, setDisplayChoices, subscribeDisplay } from './store';
import { useIsTouch } from './media';

interface PrefsContextValue {
  /** The viewer's role on the active restaurant (D4 defaults density by role). */
  role: UserRole | null;
  /** What the server read from the cookie: the snapshot for SSR and hydration. */
  serverChoices: DisplayChoices;
}

const PrefsContext = createContext<PrefsContextValue | null>(null);
// Two @types/react copies in the workspace (see lib/i18n/client.tsx): cast like the other providers.
const PrefsCtxProvider = PrefsContext.Provider as unknown as React.ComponentType<{
  value: PrefsContextValue | null;
  children: React.ReactNode;
}>;

const NO_CHOICES: DisplayChoices = Object.freeze({}) as DisplayChoices;

export interface PrefsApi extends DisplayPrefs {
  /** Explicit choices stored on this device (missing = default). */
  choices: DisplayChoices;
  /** The role's defaults ("חזרה לברירת המחדל"). */
  defaults: DisplayPrefs;
  role: UserRole | null;
  /** True on a phone or a touch pointer: density is fixed there and desk-only settings are absent. */
  touch: boolean;
  /** The density actually applied on this device (the touch size on a phone, whatever the choice). */
  appliedDensity: Density;
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
 */
export function usePrefs(): PrefsApi {
  const ctx = useContext(PrefsContext);
  const viewer = useNavViewer();
  const serverChoices = ctx?.serverChoices ?? NO_CHOICES;
  const choices = useSyncExternalStore(subscribeDisplay, getDisplayChoices, () => serverChoices);
  const touch = useIsTouch();
  const role = ctx?.role ?? viewer?.role ?? null;
  return useMemo(() => {
    const prefs = resolvePrefs(choices, role);
    const set = <K extends keyof DisplayPrefs>(key: K, value: DisplayPrefs[K]) =>
      setDisplayChoices(withChoice(getDisplayChoices(), role, key, value));
    return {
      ...prefs,
      choices,
      defaults: defaultPrefs(role),
      role,
      touch,
      appliedDensity: touch ? 'regular' : prefs.density,
      setDensity: (d) => set('density', d),
      setTextSize: (t) => set('textSize', t),
      setSingleKeys: (on) => set('singleKeys', on),
      reset: () => setDisplayChoices({}),
    };
  }, [choices, role, touch]);
}

/**
 * Applies the display preferences to everything inside it, from the first
 * HTML: a `display: contents` wrapper carrying `data-density` (the DS2 token
 * density modes in globals.css), `data-text-size` and `data-single-keys`, and a
 * root font-size rule when the text is large. After hydration the same values
 * are mirrored onto <html> so portals (dialogs, toasts, popovers) follow too,
 * and restored when the provider unmounts. A nested provider passes through.
 *
 * Usually mounted through the server component `PrefsRoot`, which reads the
 * cookie. `role` defaults to the dashboard viewer's role (NavProvider).
 */
export function PrefsProvider({
  initial,
  role,
  children,
}: {
  initial: DisplayChoices;
  role?: UserRole | null;
  children: React.ReactNode;
}) {
  const outer = useContext(PrefsContext);
  const viewer = useNavViewer();
  const resolvedRole = role ?? viewer?.role ?? null;
  const value = useMemo(() => ({ role: resolvedRole, serverChoices: initial }), [resolvedRole, initial]);
  if (outer) return <>{children}</>;
  return (
    <PrefsCtxProvider value={value}>
      <PrefsApplier>{children}</PrefsApplier>
    </PrefsCtxProvider>
  );
}

function PrefsApplier({ children }: { children: React.ReactNode }) {
  const p = usePrefs();
  const density = tokenDensity(p.appliedDensity);
  const keys = p.singleKeys ? 'on' : 'off';

  useEffect(() => {
    const html = document.documentElement;
    const before = {
      density: html.dataset.density,
      textSize: html.dataset.textSize,
      singleKeys: html.dataset.singleKeys,
      fontSize: html.style.fontSize,
    };
    html.dataset.density = density;
    html.dataset.textSize = p.textSize;
    html.dataset.singleKeys = keys;
    html.style.fontSize = p.textSize === 'regular' ? '' : TEXT_SCALE[p.textSize];
    return () => {
      const restore = (k: 'density' | 'textSize' | 'singleKeys', v: string | undefined) => {
        if (v === undefined) delete html.dataset[k];
        else html.dataset[k] = v;
      };
      restore('density', before.density);
      restore('textSize', before.textSize);
      restore('singleKeys', before.singleKeys);
      html.style.fontSize = before.fontSize;
    };
  }, [density, p.textSize, keys]);

  return (
    <>
      {p.textSize !== 'regular' ? <style>{`:root{font-size:${TEXT_SCALE[p.textSize]}}`}</style> : null}
      <div data-rm-prefs="" data-density={density} data-text-size={p.textSize} data-single-keys={keys} className="contents">
        {children}
      </div>
    </>
  );
}
