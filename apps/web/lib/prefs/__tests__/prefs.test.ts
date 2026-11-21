import '../../components/__tests__/reactGlobal';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COARSE_QUERY,
  DENSITY_COOKIE,
  DENSITY_STORAGE,
  NARROW_QUERY,
  PHONE_QUERY,
  SINGLE_KEYS_EVENT,
  SINGLE_KEYS_STORAGE,
  TEXT_COOKIE,
  TEXT_STORAGE,
  choicesFromCookieHeader,
  cookieValue,
  defaultPrefs,
  densityAttr,
  pickDensity,
  pickSingleKeys,
  pickTextSize,
  prefCookieAssignment,
  resolvePrefs,
  roleDefaultDensity,
  shellAttrs,
  tableDensity,
  textAttr,
  textSizeRule,
  tokenDensity,
  viewDensity,
  withChoice,
} from '../schema';
import { mirrorDisplayAttrs } from '../root';
import {
  __resetDisplayStoreForTests,
  getDisplayChoices,
  setDisplayChoices,
  singleKeysEnabled,
  subscribeDisplay,
} from '../store';
import { PrefsProvider, usePrefs } from '../PrefsProvider';
import type { DeviceHints, DisplayChoices } from '../schema';

/** PrefsProvider with children as the third argument (the workspace's two @types/react copies, see lib/i18n/client.tsx). */
const provider = (
  initial: DisplayChoices,
  role: 'owner' | 'bookkeeper' | null,
  child: ReactElement,
  hints?: DeviceHints,
): ReactElement =>
  createElement(
    PrefsProvider as unknown as (p: {
      initial: DisplayChoices;
      role: typeof role;
      hints?: DeviceHints;
    }) => ReactElement,
    { initial, role, hints },
    child,
  );

describe('the contract names (DS3 WORKPLAN, "Personal preferences: one contract")', () => {
  it('are exactly the ones the shell, the desk keys and the density switches read', () => {
    expect(DENSITY_COOKIE).toBe('rm_density');
    expect(DENSITY_STORAGE).toBe('rm:density');
    expect(TEXT_COOKIE).toBe('rm_text');
    expect(TEXT_STORAGE).toBe('rm:text');
    expect(SINGLE_KEYS_STORAGE).toBe('rm:keys:single');
    expect(SINGLE_KEYS_EVENT).toBe('rm:keys');
  });
});

describe('D4 role defaults', () => {
  it('bookkeeper compact; owner, manager, chef, receiver and no role regular', () => {
    expect(roleDefaultDensity('bookkeeper')).toBe('compact');
    for (const r of ['owner', 'manager', 'chef', 'receiver'] as const)
      expect(roleDefaultDensity(r)).toBe('regular');
    expect(roleDefaultDensity(null)).toBe('regular');
    expect(defaultPrefs('owner')).toEqual({
      density: 'regular',
      textSize: 'regular',
      singleKeys: true,
    });
  });

  it('an explicit choice beats the role default; a missing key falls back to it', () => {
    expect(resolvePrefs({}, 'bookkeeper').density).toBe('compact');
    expect(resolvePrefs({ density: 'regular' }, 'bookkeeper').density).toBe('regular');
    expect(
      resolvePrefs({ density: 'compact', textSize: 'large', singleKeys: false }, 'owner'),
    ).toEqual({
      density: 'compact',
      textSize: 'large',
      singleKeys: false,
    });
  });

  it('a density or text choice equal to the role default is not stored; the single-key switch always is', () => {
    expect(withChoice({}, 'owner', 'density', 'regular')).toEqual({});
    expect(withChoice({}, 'owner', 'density', 'compact')).toEqual({ density: 'compact' });
    expect(withChoice({ density: 'compact' }, 'owner', 'density', 'regular')).toEqual({});
    expect(withChoice({}, 'bookkeeper', 'density', 'regular')).toEqual({ density: 'regular' });
    expect(withChoice({ textSize: 'large' }, 'owner', 'textSize', 'regular')).toEqual({});
    expect(withChoice({}, 'owner', 'singleKeys', false)).toEqual({ singleKeys: false });
    expect(withChoice({ singleKeys: false }, 'owner', 'singleKeys', true)).toEqual({
      singleKeys: true,
    });
  });
});

describe('reading stored values: each one only picks a constant', () => {
  it('density, text size and the single-key flag', () => {
    expect(pickDensity('compact')).toBe('compact');
    expect(pickDensity('regular')).toBe('regular');
    for (const junk of ['huge', 'Compact', '', null, undefined, '<b>x</b>', 'compact;']) {
      expect(pickDensity(junk)).toBeUndefined();
      expect(pickTextSize(junk)).toBeUndefined();
    }
    expect(pickTextSize('large')).toBe('large');
    expect(pickSingleKeys('0')).toBe(false);
    expect(pickSingleKeys('1')).toBe(true);
    for (const junk of ['true', 'false', 'off', '', null, undefined])
      expect(pickSingleKeys(junk)).toBeUndefined();
  });

  it('the two cookies, read from a header among others, with the same parser on both sides', () => {
    const header = `rm_locale=he; ${DENSITY_COOKIE}=compact; rm_nav_rail=1; ${TEXT_COOKIE}=large`;
    expect(cookieValue(header, DENSITY_COOKIE)).toBe('compact');
    expect(choicesFromCookieHeader(header)).toEqual({ density: 'compact', textSize: 'large' });
    expect(choicesFromCookieHeader('rm_density_other=compact; rm_text=huge')).toEqual({});
    expect(choicesFromCookieHeader(null)).toEqual({});
    expect(cookieValue('rm_density=%E0%A4%A', DENSITY_COOKIE)).toBe('%E0%A4%A');
  });

  it('cookies are written with the agreed attributes, and deleted when nothing is chosen', () => {
    expect(prefCookieAssignment(TEXT_COOKIE, 'large', true)).toBe(
      'rm_text=large; max-age=31536000; path=/; samesite=lax; secure',
    );
    expect(prefCookieAssignment(DENSITY_COOKIE, null, false)).toBe(
      'rm_density=; max-age=0; path=/; samesite=lax',
    );
  });
});

describe('what the page shows', () => {
  it('maps to each existing density vocabulary', () => {
    expect(tokenDensity('compact')).toBe('compact');
    expect(tokenDensity('regular')).toBe('default');
    expect(viewDensity('regular')).toBe('comfortable');
    expect(viewDensity('compact')).toBe('compact');
    expect(tableDensity('regular')).toBe('default');
  });

  it('writes only compact and large; large text enlarges the content column on screen only', () => {
    expect(densityAttr('compact')).toBe('compact');
    expect(densityAttr('regular')).toBeUndefined();
    expect(textAttr('large')).toBe('large');
    expect(textAttr('regular')).toBeUndefined();
    expect(textSizeRule('regular')).toBeNull();
    expect(textSizeRule('large')).toBe(
      '@media screen{#main-content > *{zoom:var(--text-zoom-large,1.1)}}',
    );
  });

  it('the shell attributes come from the cookies and the role, and density stays regular on a phone', () => {
    expect(shellAttrs('', 'bookkeeper')).toEqual({ density: 'compact', text: undefined });
    expect(shellAttrs('rm_density=regular', 'bookkeeper')).toEqual({
      density: undefined,
      text: undefined,
    });
    expect(shellAttrs('rm_density=compact; rm_text=large', 'owner')).toEqual({
      density: 'compact',
      text: 'large',
    });
    expect(shellAttrs('', 'bookkeeper', { coarse: true, apple: false }).density).toBeUndefined();
  });

  it('the device queries agree with the shell breakpoint (lg = 1024 px)', () => {
    expect(COARSE_QUERY).toBe('(pointer: coarse)');
    expect(NARROW_QUERY).toBe('(max-width: 1023.98px)');
    expect(PHONE_QUERY).toBe(`${NARROW_QUERY} and ${COARSE_QUERY}`);
  });
});

describe('mirroring onto <html>', () => {
  it('sets the attributes and restores what was there, picked from the known values', () => {
    const dataset: Record<string, string | undefined> = { text: 'regular', other: 'kept' };
    const restore = mirrorDisplayAttrs(dataset, { density: 'compact', text: 'large' });
    expect(dataset).toEqual({ density: 'compact', text: 'large', other: 'kept' });
    restore();
    expect(dataset).toEqual({ text: 'regular', other: 'kept' });
  });

  it('a regular density removes the attribute; an unknown earlier value is not written back', () => {
    const dataset: Record<string, string | undefined> = { density: 'default', text: '<img src=x>' };
    const restore = mirrorDisplayAttrs(dataset, { density: undefined, text: undefined });
    expect('density' in dataset).toBe(false);
    expect('text' in dataset).toBe(false);
    restore();
    expect(dataset.density).toBe('default');
    expect('text' in dataset).toBe(false);
  });
});

/**
 * A minimal browser: one cookie jar (one path), localStorage, window and
 * document events. `refuse.storage` makes localStorage writes throw (a full or
 * refused store); `refuse.cookies` makes the browser ignore script cookies.
 */
function fakeBrowser() {
  const jar = new Map<string, string>();
  const assignments: string[] = [];
  const local = new Map<string, string>();
  const refuse = { storage: false, cookies: false };
  const handlers = new Map<string, Array<(e: { key?: string | null }) => void>>();
  const docHandlers = new Map<string, Array<() => void>>();
  const doc = {
    visibilityState: 'visible',
    addEventListener: (type: string, fn: () => void) =>
      docHandlers.set(type, [...(docHandlers.get(type) ?? []), fn]),
    get cookie() {
      return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    set cookie(assignment: string) {
      assignments.push(assignment);
      if (refuse.cookies) return;
      const [pair, ...attrs] = assignment.split(';').map((s) => s.trim());
      const i = pair!.indexOf('=');
      const name = pair!.slice(0, i);
      const value = pair!.slice(i + 1);
      if (attrs.some((a) => a === 'max-age=0')) jar.delete(name);
      else jar.set(name, value);
    },
  };
  const win = {
    location: { protocol: 'https:' },
    localStorage: {
      getItem: (k: string) => local.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (refuse.storage) throw new DOMException('quota', 'QuotaExceededError');
        local.set(k, v);
      },
      removeItem: (k: string) => {
        if (refuse.storage) throw new DOMException('refused', 'SecurityError');
        local.delete(k);
      },
    },
    addEventListener: (type: string, fn: (e: { key?: string | null }) => void) =>
      handlers.set(type, [...(handlers.get(type) ?? []), fn]),
    dispatchEvent: vi.fn((e: Event) => {
      for (const fn of handlers.get(e.type) ?? []) fn({});
      return true;
    }),
  };
  const fire = (type: string, key?: string | null) => {
    for (const fn of handlers.get(type) ?? []) fn({ key });
  };
  const fireDoc = (type: string) => {
    for (const fn of docHandlers.get(type) ?? []) fn();
  };
  return { doc, win, jar, local, assignments, refuse, fire, fireDoc };
}

describe('client store', () => {
  let b: ReturnType<typeof fakeBrowser>;
  beforeEach(() => {
    __resetDisplayStoreForTests();
    b = fakeBrowser();
    vi.stubGlobal('document', b.doc);
    vi.stubGlobal('window', b.win);
  });
  afterEach(() => {
    __resetDisplayStoreForTests();
    vi.unstubAllGlobals();
  });

  it('reads the cookies, the single-key key, and keeps a stable snapshot until a change', () => {
    b.jar.set('rm_density', 'compact');
    b.local.set('rm:keys:single', '0');
    const a = getDisplayChoices();
    expect(a).toEqual({ density: 'compact', singleKeys: false });
    expect(getDisplayChoices()).toBe(a);
  });

  it('falls back to the localStorage mirror when a cookie is gone, and junk reads as not chosen', () => {
    b.local.set('rm:text', 'large');
    b.local.set('rm:density', 'huge');
    expect(getDisplayChoices()).toEqual({ textSize: 'large' });
  });

  it('writes the cookies and their mirrors, the single-key key with its event, and deletes on reset', () => {
    const seen: number[] = [];
    const off = subscribeDisplay(() => seen.push(1));
    setDisplayChoices({ density: 'compact', textSize: 'large', singleKeys: false });
    expect(b.jar.get('rm_density')).toBe('compact');
    expect(b.jar.get('rm_text')).toBe('large');
    expect(b.local.get('rm:density')).toBe('compact');
    expect(b.local.get('rm:text')).toBe('large');
    expect(b.local.get('rm:keys:single')).toBe('0');
    expect(b.win.dispatchEvent).toHaveBeenCalledTimes(1);
    expect(singleKeysEnabled()).toBe(false);
    setDisplayChoices({ density: 'compact', textSize: 'large', singleKeys: false }); // no change, no notification
    setDisplayChoices({});
    expect(b.jar.has('rm_density')).toBe(false);
    expect(b.jar.has('rm_text')).toBe(false);
    expect(b.local.has('rm:density')).toBe(false);
    expect(b.local.has('rm:keys:single')).toBe(false);
    expect(singleKeysEnabled()).toBe(true);
    expect(seen.length).toBeGreaterThanOrEqual(2);
    off();
  });

  it('singleKeysEnabled reads the key itself (no provider, another tab, the shell switch)', () => {
    expect(singleKeysEnabled()).toBe(true);
    b.local.set('rm:keys:single', '0');
    expect(singleKeysEnabled()).toBe(false);
    b.local.set('rm:keys:single', '1');
    expect(singleKeysEnabled()).toBe(true);
  });

  it('follows another tab (storage) and the shell switch in this tab (rm:keys)', () => {
    const seen: string[] = [];
    getDisplayChoices();
    const off = subscribeDisplay(() => seen.push(JSON.stringify(getDisplayChoices())));
    b.local.set('rm:keys:single', '0');
    b.fire(SINGLE_KEYS_EVENT);
    b.local.set('rm:density', 'compact');
    b.fire('storage', 'rm:density');
    b.fire('storage', 'unrelated');
    expect(seen).toEqual(['{"singleKeys":false}', '{"density":"compact","singleKeys":false}']);
    off();
  });

  it('renews the cookies once per page load and restores one the browser dropped (Safari caps script cookies)', () => {
    b.jar.set('rm_density', 'compact');
    b.local.set('rm:text', 'large');
    const off = subscribeDisplay(() => {});
    expect(b.assignments).toEqual([
      'rm_density=compact; max-age=31536000; path=/; samesite=lax; secure',
      'rm_text=large; max-age=31536000; path=/; samesite=lax; secure',
    ]);
    const off2 = subscribeDisplay(() => {});
    expect(b.assignments).toHaveLength(2);
    off();
    off2();
  });

  it('writes nothing on load when nothing is stored', () => {
    const off = subscribeDisplay(() => {});
    expect(b.assignments).toEqual([]);
    off();
  });

  it('a choice the browser refuses to store holds for this page, for readers and for key handlers', () => {
    b.refuse.storage = true;
    b.refuse.cookies = true;
    const off = subscribeDisplay(() => {});
    setDisplayChoices({ density: 'compact', singleKeys: false });
    expect(b.jar.size).toBe(0);
    expect(b.local.size).toBe(0);
    // No event after a refused write (it would hand handlers the old value).
    expect(b.win.dispatchEvent).not.toHaveBeenCalled();
    expect(getDisplayChoices()).toEqual({ density: 'compact', singleKeys: false });
    expect(singleKeysEnabled()).toBe(false);
    // A tab coming back into view re-reads storage, and keeps this page's choices.
    b.fireDoc('visibilitychange');
    expect(getDisplayChoices()).toEqual({ density: 'compact', singleKeys: false });
    expect(singleKeysEnabled()).toBe(false);
    // Another tab's write landed: storage speaks for that key again; the other one stays held.
    b.local.set('rm:keys:single', '1');
    b.fire('storage', 'rm:keys:single');
    expect(getDisplayChoices()).toEqual({ density: 'compact', singleKeys: true });
    expect(singleKeysEnabled()).toBe(true);
    off();
  });

  it('a later write that lands takes over from the page, and so does the shell switch', () => {
    const off = subscribeDisplay(() => {});
    b.refuse.storage = true;
    setDisplayChoices({ singleKeys: false });
    expect(singleKeysEnabled()).toBe(false);
    b.refuse.storage = false;
    setDisplayChoices({ singleKeys: true });
    expect(b.local.get('rm:keys:single')).toBe('1');
    expect(b.win.dispatchEvent).toHaveBeenCalledTimes(1);
    // Nothing held any more: the key itself answers.
    b.local.set('rm:keys:single', '0');
    expect(singleKeysEnabled()).toBe(false);
    // Back to the default, refused: the page holds "on" although storage still says off.
    b.refuse.storage = true;
    b.local.set('rm:keys:single', '0');
    b.fire(SINGLE_KEYS_EVENT);
    setDisplayChoices({});
    expect(singleKeysEnabled()).toBe(true);
    // The shell's own switch (its event comes only after its write landed) takes over.
    b.local.set('rm:keys:single', '0');
    b.fire(SINGLE_KEYS_EVENT);
    expect(singleKeysEnabled()).toBe(false);
    expect(getDisplayChoices()).toEqual({ singleKeys: false });
    off();
  });
});

describe('PrefsProvider: the first HTML already carries the choices (no flash)', () => {
  beforeEach(() => __resetDisplayStoreForTests());

  const render = (initial: DisplayChoices, role: 'owner' | 'bookkeeper' | null) =>
    renderToStaticMarkup(provider(initial, role, createElement('p', null, 'x')));

  it('compact + large: the contract attributes on the wrapper and the content zoom rule', () => {
    const html = render({ density: 'compact', textSize: 'large' }, 'owner');
    expect(html).toContain(
      '<style>@media screen{#main-content > *{zoom:var(--text-zoom-large,1.1)}}</style>',
    ); // raw text: React does not escape a style element
    expect(html).toContain('data-rm-prefs=""');
    expect(html).toContain('data-density="compact"');
    expect(html).toContain('data-text="large"');
    expect(html).not.toContain('data-single-keys');
    expect(html).not.toContain('data-text-size');
    expect(html).toContain('class="contents"');
  });

  it('no choices: role defaults, no style element; regular density and text write no attribute', () => {
    expect(render({}, 'owner')).not.toContain('data-density');
    expect(render({}, 'owner')).not.toContain('data-text');
    expect(render({}, 'bookkeeper')).toContain('data-density="compact"');
    expect(render({}, 'owner')).not.toContain('<style>');
  });

  it('a phone or tablet (User-Agent hint) renders the regular density from the first HTML', () => {
    const html = renderToStaticMarkup(
      provider({}, 'bookkeeper', createElement('p', null, 'x'), { coarse: true, apple: false }),
    );
    expect(html).not.toContain('data-density');
    const chosen = renderToStaticMarkup(
      provider({ density: 'compact' }, 'owner', createElement('p', null, 'x'), {
        coarse: true,
        apple: true,
      }),
    );
    expect(chosen).not.toContain('data-density');
  });

  it('a nested provider passes through (one wrapper, one rule)', () => {
    const html = renderToStaticMarkup(
      provider(
        { textSize: 'large' },
        'owner',
        provider({}, 'owner', createElement('p', null, 'x')),
      ),
    );
    expect(html.match(/data-rm-prefs/g)).toHaveLength(1);
    expect(html.match(/<style>/g)).toHaveLength(1);
  });

  it('usePrefs inside the provider reads the server snapshot during SSR', () => {
    let seen: ReturnType<typeof usePrefs> | null = null;
    function Probe() {
      seen = usePrefs();
      return null;
    }
    renderToStaticMarkup(provider({ density: 'regular' }, 'bookkeeper', createElement(Probe)));
    expect(seen!.density).toBe('regular');
    expect(seen!.defaults.density).toBe('compact');
    expect(seen!.coarse).toBe(false);
    expect(seen!.appliedDensity).toBe('regular');
    expect(seen!.viewDensity).toBe('comfortable');
    expect(seen!.tableDensity).toBe('default');
    expect(seen!.singleKeys).toBe(true);
  });
});
