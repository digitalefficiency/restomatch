import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DISPLAY_CHANNEL,
  DISPLAY_COOKIE,
  DISPLAY_COOKIE_MAX_AGE,
  GROUPS_STORAGE,
  RAIL_COOKIE,
  RAIL_COOKIE_MAX_AGE,
  RAIL_STORAGE,
  SINGLE_KEYS_EVENT,
  favouritesStorageKey,
  groupsStorageKey,
  railCookie,
  readFavourites,
  readGroupState,
  readSingleKeys,
  safeStorage,
  singleKeysCookie,
  singleKeysFromCookie,
  writeFavourites,
  writeGroupState,
  writeSingleKeys,
  type CookieDoc,
  type StorageLike,
} from '../prefs';
import type { GroupKey } from '../types';

/** In-memory storage that records exactly what was written. */
class MemoryStorage implements StorageLike {
  readonly data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

/** Storage the browser refuses: private mode, blocked site data, a full quota. */
const refusing: StorageLike = {
  getItem: () => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  },
  setItem: () => {
    throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
  },
};

/** Storage holding `raw` at `key` (the owner's group state unless told otherwise). */
function holding(raw: string, key = groupsStorageKey('owner')): MemoryStorage {
  const s = new MemoryStorage();
  s.data.set(key, raw);
  return s;
}

/** `target` with a `localStorage` getter that throws, as Chromium does with site data blocked. */
function withBlockedStorage<T extends object>(target: T): T {
  return Object.defineProperty(target, 'localStorage', {
    get() {
      throw new DOMException('Access is denied for this document.', 'SecurityError');
    },
  });
}

/** A browser `window` whose `localStorage` getter throws. */
function blockedWindow(): object {
  return withBlockedStorage({ dispatchEvent: () => true });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('keys and constants (spec §13)', () => {
  it('keeps the existing names', () => {
    expect(RAIL_COOKIE).toBe('rm_nav_rail');
    expect(RAIL_STORAGE).toBe('rm:nav:rail');
    expect(GROUPS_STORAGE).toBe('rm:nav:groups');
  });

  it('names the new keys, per role where the spec says so', () => {
    expect(SINGLE_KEYS_EVENT).toBe('rm:keys');
    expect(RAIL_COOKIE_MAX_AGE).toBe(365 * 24 * 60 * 60);
    expect(groupsStorageKey('owner')).toBe('rm:nav:groups:owner');
    expect(groupsStorageKey('bookkeeper')).toBe('rm:nav:groups:bookkeeper');
    expect(favouritesStorageKey('manager')).toBe('rm:nav:fav:manager');
    expect(favouritesStorageKey('chef')).toBe('rm:nav:fav:chef');
  });
});

describe('railCookie', () => {
  it('writes the exact cookie string: 1 / 0, path /, one year, SameSite=Lax', () => {
    expect(railCookie(true)).toBe('rm_nav_rail=1; path=/; max-age=31536000; samesite=lax');
    expect(railCookie(false)).toBe('rm_nav_rail=0; path=/; max-age=31536000; samesite=lax');
  });

  it('adds secure only when asked', () => {
    expect(railCookie(true, true)).toBe('rm_nav_rail=1; path=/; max-age=31536000; samesite=lax; secure');
    expect(railCookie(false, true)).toBe('rm_nav_rail=0; path=/; max-age=31536000; samesite=lax; secure');
    expect(railCookie(true, false)).toBe('rm_nav_rail=1; path=/; max-age=31536000; samesite=lax');
  });
});

describe('safeStorage', () => {
  it('is null on the server', () => {
    expect(typeof window).toBe('undefined');
    expect(safeStorage()).toBeNull();
  });

  it('returns window.localStorage in a browser', () => {
    const local = new MemoryStorage();
    vi.stubGlobal('window', { localStorage: local });
    expect(safeStorage()).toBe(local);
  });

  it('is null when reading localStorage itself throws', () => {
    vi.stubGlobal('window', blockedWindow());
    expect(safeStorage()).toBeNull();
  });

  it('is what every reader and writer uses when no storage is passed', () => {
    const local = new MemoryStorage();
    vi.stubGlobal('window', { localStorage: local, dispatchEvent: () => true });
    writeGroupState('owner', { money: false });
    writeFavourites('owner', ['approvals']);
    expect(readGroupState('owner')).toEqual({ money: false });
    expect(readFavourites('owner')).toEqual(['approvals']);
    // The single-key switch is a cookie (DS3-06's display preference), never localStorage.
    expect([...local.data.keys()].sort()).toEqual(['rm:nav:fav:owner', 'rm:nav:groups:owner']);
  });

  it('turns every reader into its default and every writer into a no-op when the browser blocks storage', () => {
    vi.stubGlobal('window', blockedWindow());
    expect(() => {
      writeGroupState('owner', { money: true });
      writeFavourites('owner', ['approvals']);
      writeSingleKeys(false);
    }).not.toThrow();
    expect(readGroupState('owner')).toBeNull();
    expect(readFavourites('owner')).toEqual([]);
    expect(readSingleKeys()).toBe(true);
  });
});

describe('readGroupState / writeGroupState', () => {
  it('round-trips under the role key, never the legacy one', () => {
    const s = new MemoryStorage();
    writeGroupState('owner', { money: true, leaks: false }, s);
    expect(readGroupState('owner', s)).toEqual({ money: true, leaks: false });
    expect([...s.data.keys()]).toEqual(['rm:nav:groups:owner']);
    expect(readGroupState('manager', s)).toBeNull();
  });

  it('does not read the legacy role-less key', () => {
    expect(readGroupState('owner', holding('{"money":false}', GROUPS_STORAGE))).toBeNull();
  });

  it('reads null when nothing is stored or there is no storage', () => {
    expect(readGroupState('owner', new MemoryStorage())).toBeNull();
    expect(readGroupState('owner', null)).toBeNull();
    expect(readGroupState('owner')).toBeNull();
  });

  it.each(['{oops', 'undefined', '', "{'money':true}"])('reads the non-JSON value %j as null', (raw) => {
    expect(readGroupState('owner', holding(raw))).toBeNull();
  });

  it.each(['[]', '[true,false]', 'null', 'true', '42', '"money"'])('reads the non-object value %s as null', (raw) => {
    expect(readGroupState('owner', holding(raw))).toBeNull();
  });

  it('drops non-boolean values one by one, so only those groups fall back to their defaults', () => {
    const raw = '{"money":"yes","leaks":1,"procure":true,"kitchen":null,"chain":false,"admin":{"open":true}}';
    expect(readGroupState('owner', holding(raw))).toEqual({ procure: true, chain: false });
    expect(readGroupState('owner', holding('{}'))).toEqual({});
  });

  it('drops unknown keys, __proto__ and constructor included', () => {
    const state = readGroupState('owner', holding('{"bogus":true,"__proto__":{"money":true},"constructor":false,"money":false}'));
    expect(state).toEqual({ money: false });
    expect(Object.keys(state ?? {})).toEqual(['money']);
  });

  it('reads null from storage that throws', () => {
    expect(readGroupState('owner', refusing)).toBeNull();
  });

  it('writes only known groups with boolean values, in GROUP_ORDER', () => {
    const s = new MemoryStorage();
    const messy = { admin: false, leaks: true, bogus: true, money: 'yes', kitchen: undefined } as unknown as Partial<Record<GroupKey, boolean>>;
    writeGroupState('manager', messy, s);
    expect(s.data.get('rm:nav:groups:manager')).toBe('{"leaks":true,"admin":false}');
  });

  it('never throws when storage refuses the write or is missing', () => {
    expect(() => writeGroupState('owner', { money: true }, refusing)).not.toThrow();
    expect(() => writeGroupState('owner', { money: true }, null)).not.toThrow();
    expect(() => writeGroupState('owner', { money: true })).not.toThrow();
  });
});

describe('readFavourites / writeFavourites', () => {
  it('round-trips per role, de-duplicated and capped at 5', () => {
    const s = new MemoryStorage();
    writeFavourites('owner', ['approvals', 'inbox', 'approvals', 'leaks', 'orders', 'recipes', 'team'], s);
    expect(s.data.get('rm:nav:fav:owner')).toBe('["approvals","inbox","leaks","orders","recipes"]');
    expect(readFavourites('owner', s)).toEqual(['approvals', 'inbox', 'leaks', 'orders', 'recipes']);
    expect(readFavourites('manager', s)).toEqual([]);
  });

  it('reads none when nothing is stored, there is no storage, or it throws', () => {
    expect(readFavourites('owner', new MemoryStorage())).toEqual([]);
    expect(readFavourites('owner', null)).toEqual([]);
    expect(readFavourites('owner')).toEqual([]);
    expect(readFavourites('owner', refusing)).toEqual([]);
  });

  it.each(['[oops', '{"approvals":true}', '"approvals"', 'null', '7', 'true'])('reads the corrupt value %s as none', (raw) => {
    expect(readFavourites('owner', holding(raw, favouritesStorageKey('owner')))).toEqual([]);
  });

  it('keeps only non-empty strings, first occurrence, at most 5', () => {
    const raw = JSON.stringify(['approvals', 3, null, 'approvals', '', 'inbox', { key: 'x' }, ['y'], true, 'leaks', 'orders', 'recipes', 'team']);
    expect(readFavourites('owner', holding(raw, favouritesStorageKey('owner')))).toEqual(['approvals', 'inbox', 'leaks', 'orders', 'recipes']);
  });

  it('never throws when storage refuses the write or is missing', () => {
    expect(() => writeFavourites('owner', ['approvals'], refusing)).not.toThrow();
    expect(() => writeFavourites('owner', ['approvals'], null)).not.toThrow();
  });
});

/** A `document.cookie` stand-in: reads give `name=value; …`, writes add, replace or (max-age=0) delete one cookie. */
class CookieJar implements CookieDoc {
  readonly jar = new Map<string, string>();
  refuse = false;

  get cookie(): string {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  set cookie(assignment: string) {
    if (this.refuse) return; // cookies blocked: the browser ignores the write
    const [pair = '', ...attrs] = assignment.split(';').map((p) => p.trim());
    const i = pair.indexOf('=');
    const name = pair.slice(0, i);
    if (attrs.includes('max-age=0')) this.jar.delete(name);
    else this.jar.set(name, pair.slice(i + 1));
  }
}

describe('the single-key switch on DS3-06\'s display cookie', () => {
  it('uses DS3-06\'s names: the rm_display cookie, one year, the rm-display channel', () => {
    expect(DISPLAY_COOKIE).toBe('rm_display');
    expect(DISPLAY_COOKIE_MAX_AGE).toBe(365 * 24 * 60 * 60);
    expect(DISPLAY_CHANNEL).toBe('rm-display');
  });

  it('is on unless the device chose keys=off', () => {
    expect(singleKeysFromCookie(undefined)).toBe(true);
    expect(singleKeysFromCookie('')).toBe(true);
    expect(singleKeysFromCookie('rm_nav_rail=1')).toBe(true);
    expect(singleKeysFromCookie('rm_display=keys=off')).toBe(false);
    expect(singleKeysFromCookie('a=1; rm_display=density=compact&keys=off; b=2')).toBe(false);
    expect(singleKeysFromCookie('rm_display=density=compact&keys=on')).toBe(true);
    expect(singleKeysFromCookie('rm_display=density%3Dcompact%26keys%3Doff')).toBe(false);
    // Unknown keys or values never break a page: they read as the default.
    expect(singleKeysFromCookie('rm_display=keys=maybe&zoom=2')).toBe(true);
    expect(singleKeysFromCookie('xrm_display=keys=off')).toBe(true);
  });

  it('writes keys=off, drops the pair when switched back on (the default), and keeps the other choices', () => {
    expect(singleKeysCookie('', false)).toBe('rm_display=keys=off; max-age=31536000; path=/; samesite=lax');
    expect(singleKeysCookie('rm_display=keys=off', true)).toBe('rm_display=; max-age=0; path=/; samesite=lax');
    // DS3-06's fixed pair order: density, text, keys.
    expect(singleKeysCookie('a=1; rm_display=text=large&density=compact', false)).toBe(
      'rm_display=density=compact&text=large&keys=off; max-age=31536000; path=/; samesite=lax',
    );
    expect(singleKeysCookie('rm_display=density=compact&keys=off', true)).toBe(
      'rm_display=density=compact; max-age=31536000; path=/; samesite=lax',
    );
    expect(singleKeysCookie('', false, true)).toBe('rm_display=keys=off; max-age=31536000; path=/; samesite=lax; secure');
  });

  it('round-trips through a cookie jar and leaves other cookies alone', () => {
    const doc = new CookieJar();
    doc.jar.set('rm_nav_rail', '1');
    doc.jar.set('rm_display', 'density=compact');
    expect(readSingleKeys(doc)).toBe(true);
    expect(writeSingleKeys(false, doc)).toBe(true);
    expect(readSingleKeys(doc)).toBe(false);
    expect(doc.jar.get('rm_display')).toBe('density=compact&keys=off');
    expect(writeSingleKeys(true, doc)).toBe(true);
    expect(readSingleKeys(doc)).toBe(true);
    expect(doc.jar.get('rm_display')).toBe('density=compact');
    expect(doc.jar.get('rm_nav_rail')).toBe('1');
  });

  it('is on, and writes nothing, without a document (the server)', () => {
    expect(readSingleKeys()).toBe(true);
    expect(readSingleKeys(null)).toBe(true);
    expect(writeSingleKeys(false)).toBe(false);
    expect(writeSingleKeys(false, null)).toBe(false);
  });

  it('fires SINGLE_KEYS_EVENT on window once per write, after the write lands', () => {
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    const doc = new CookieJar();
    const seen: Array<{ type: string; on: boolean }> = [];
    target.addEventListener(SINGLE_KEYS_EVENT, (e) => seen.push({ type: e.type, on: readSingleKeys(doc) }));
    writeSingleKeys(false, doc);
    writeSingleKeys(true, doc);
    expect(seen).toEqual([
      { type: 'rm:keys', on: false },
      { type: 'rm:keys', on: true },
    ]);
  });

  it('announces nothing when cookies are refused, so a listener that re-reads cannot undo the in-memory switch', () => {
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    const doc = new CookieJar();
    doc.refuse = true;
    let singleKeys = true;
    target.addEventListener(SINGLE_KEYS_EVENT, () => {
      singleKeys = readSingleKeys(doc);
    });
    singleKeys = false; // ShellFrame applies the value in memory first
    expect(writeSingleKeys(false, doc)).toBe(false);
    expect(singleKeys).toBe(false);
  });

  it('never throws when reading or writing the cookie throws', () => {
    const hostile = {
      get cookie(): string {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
      set cookie(_v: string) {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    };
    expect(readSingleKeys(hostile)).toBe(true);
    expect(() => writeSingleKeys(false, hostile)).not.toThrow();
    expect(writeSingleKeys(false, hostile)).toBe(false);
  });
});
