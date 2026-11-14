import '../../components/__tests__/reactGlobal';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DISPLAY_COOKIE,
  TEXT_SCALE,
  choicesFromCookieHeader,
  defaultPrefs,
  displayCookieAssignment,
  parseDisplayChoices,
  resolvePrefs,
  roleDefaultDensity,
  serializeDisplayChoices,
  tableDensity,
  tokenDensity,
  viewDensity,
  withChoice,
} from '../schema';
import {
  __resetDisplayStoreForTests,
  getDisplayChoices,
  setDisplayChoices,
  singleKeysEnabled,
  subscribeDisplay,
} from '../store';
import { PrefsProvider, usePrefs } from '../PrefsProvider';
import type { DisplayChoices } from '../schema';

/** PrefsProvider with children as the third argument (the workspace's two @types/react copies, see lib/i18n/client.tsx). */
const provider = (initial: DisplayChoices, role: 'owner' | 'bookkeeper' | null, child: ReactElement): ReactElement =>
  createElement(PrefsProvider as unknown as (p: { initial: DisplayChoices; role: typeof role }) => ReactElement, { initial, role }, child);

describe('D4 role defaults', () => {
  it('bookkeeper compact; owner, manager, chef, receiver and no role regular', () => {
    expect(roleDefaultDensity('bookkeeper')).toBe('compact');
    for (const r of ['owner', 'manager', 'chef', 'receiver'] as const) expect(roleDefaultDensity(r)).toBe('regular');
    expect(roleDefaultDensity(null)).toBe('regular');
    expect(defaultPrefs('owner')).toEqual({ density: 'regular', textSize: 'regular', singleKeys: true });
  });

  it('an explicit choice beats the role default; a missing key falls back to it', () => {
    expect(resolvePrefs({}, 'bookkeeper').density).toBe('compact');
    expect(resolvePrefs({ density: 'regular' }, 'bookkeeper').density).toBe('regular');
    expect(resolvePrefs({ density: 'compact', textSize: 'large', singleKeys: false }, 'owner')).toEqual({
      density: 'compact',
      textSize: 'large',
      singleKeys: false,
    });
  });

  it('a choice equal to the role default is not stored', () => {
    expect(withChoice({}, 'owner', 'density', 'regular')).toEqual({});
    expect(withChoice({}, 'owner', 'density', 'compact')).toEqual({ density: 'compact' });
    expect(withChoice({ density: 'compact' }, 'owner', 'density', 'regular')).toEqual({});
    expect(withChoice({}, 'bookkeeper', 'density', 'regular')).toEqual({ density: 'regular' });
    expect(withChoice({ textSize: 'large' }, 'owner', 'singleKeys', false)).toEqual({ textSize: 'large', singleKeys: false });
    expect(withChoice({ singleKeys: false }, 'owner', 'singleKeys', true)).toEqual({});
  });
});

describe('cookie value', () => {
  it('round-trips, in a fixed order, only explicit choices', () => {
    const c = { singleKeys: false, density: 'compact', textSize: 'large' } as const;
    expect(serializeDisplayChoices(c)).toBe('density=compact&text=large&keys=off');
    expect(parseDisplayChoices(serializeDisplayChoices(c))).toEqual(c);
    expect(serializeDisplayChoices({})).toBe('');
    expect(parseDisplayChoices('keys=on')).toEqual({ singleKeys: true });
  });

  it('ignores unknown keys, unknown values and junk, never throws', () => {
    expect(parseDisplayChoices('density=huge&text=large&foo=bar&=x&keys')).toEqual({ textSize: 'large' });
    expect(parseDisplayChoices('%E0%A4%A')).toEqual({});
    expect(parseDisplayChoices(undefined)).toEqual({});
    expect(parseDisplayChoices('density%3Dcompact%26keys%3Doff')).toEqual({ density: 'compact', singleKeys: false });
  });

  it('is read from a cookie header among others', () => {
    expect(choicesFromCookieHeader(`rm_locale=he; ${DISPLAY_COOKIE}=density=compact&keys=off; rm_nav_rail=1`)).toEqual({
      density: 'compact',
      singleKeys: false,
    });
    expect(choicesFromCookieHeader('rm_display_other=density=compact')).toEqual({});
    expect(choicesFromCookieHeader(null)).toEqual({});
  });

  it('is written with the agreed attributes, and deleted when nothing is chosen', () => {
    expect(displayCookieAssignment({ textSize: 'large' }, true)).toBe(
      'rm_display=text=large; max-age=31536000; path=/; samesite=lax; secure',
    );
    expect(displayCookieAssignment({}, false)).toBe('rm_display=; max-age=0; path=/; samesite=lax');
  });

  it('maps to each existing density vocabulary', () => {
    expect(tokenDensity('compact')).toBe('compact');
    expect(tokenDensity('regular')).toBe('default');
    expect(viewDensity('regular')).toBe('comfortable');
    expect(viewDensity('compact')).toBe('compact');
    expect(tableDensity('regular')).toBe('default');
    expect(TEXT_SCALE.large).toBe('110%');
  });
});

/** A minimal `document` whose cookie jar behaves like a browser's for one path. */
function fakeDocument() {
  const jar = new Map<string, string>();
  const doc = {
    visibilityState: 'visible',
    addEventListener: vi.fn(),
    get cookie() {
      return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    set cookie(assignment: string) {
      const [pair, ...attrs] = assignment.split(';').map((s) => s.trim());
      const i = pair!.indexOf('=');
      const name = pair!.slice(0, i);
      const value = pair!.slice(i + 1);
      if (attrs.some((a) => a === 'max-age=0')) jar.delete(name);
      else jar.set(name, value);
    },
  };
  return { doc, jar };
}

describe('client store', () => {
  let jar: Map<string, string>;
  beforeEach(() => {
    __resetDisplayStoreForTests();
    const f = fakeDocument();
    jar = f.jar;
    vi.stubGlobal('document', f.doc);
    vi.stubGlobal('window', { location: { protocol: 'https:' } });
  });
  afterEach(() => {
    __resetDisplayStoreForTests();
    vi.unstubAllGlobals();
  });

  it('reads the cookie once and keeps a stable snapshot until a change', () => {
    jar.set('rm_display', 'density=compact');
    const a = getDisplayChoices();
    expect(a).toEqual({ density: 'compact' });
    expect(getDisplayChoices()).toBe(a);
  });

  it('writes the cookie, notifies readers, and deletes it on reset', () => {
    const seen: number[] = [];
    const off = subscribeDisplay(() => seen.push(1));
    setDisplayChoices({ singleKeys: false });
    expect(jar.get('rm_display')).toBe('keys=off');
    expect(singleKeysEnabled()).toBe(false);
    setDisplayChoices({ singleKeys: false }); // no change, no notification
    setDisplayChoices({});
    expect(jar.has('rm_display')).toBe(false);
    expect(singleKeysEnabled()).toBe(true);
    expect(seen).toHaveLength(2);
    off();
  });
});

describe('PrefsProvider: the first HTML already carries the choices (no flash)', () => {
  beforeEach(() => __resetDisplayStoreForTests());

  const render = (initial: DisplayChoices, role: 'owner' | 'bookkeeper' | null) =>
    renderToStaticMarkup(provider(initial, role, createElement('p', null, 'x')));

  it('compact + large + keys off: wrapper attributes and the root font-size rule', () => {
    const html = render({ density: 'compact', textSize: 'large', singleKeys: false }, 'owner');
    expect(html).toContain('<style>:root{font-size:110%}</style>');
    expect(html).toContain('data-rm-prefs=""');
    expect(html).toContain('data-density="compact"');
    expect(html).toContain('data-text-size="large"');
    expect(html).toContain('data-single-keys="off"');
    expect(html).toContain('class="contents"');
  });

  it('no choices: role defaults, no style element', () => {
    expect(render({}, 'owner')).toContain('data-density="default"');
    expect(render({}, 'bookkeeper')).toContain('data-density="compact"');
    expect(render({}, 'owner')).not.toContain('<style>');
  });

  it('a nested provider passes through (one wrapper, one rule)', () => {
    const html = renderToStaticMarkup(
      provider({ textSize: 'large' }, 'owner', provider({}, 'owner', createElement('p', null, 'x'))),
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
    expect(seen!.touch).toBe(false);
    expect(seen!.appliedDensity).toBe('regular');
  });
});
