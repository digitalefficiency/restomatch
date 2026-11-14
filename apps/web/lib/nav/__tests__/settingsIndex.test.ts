import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { UserRole } from '@restomatch/db';
import { he as settingsHe } from '../../i18n/messages/settings/he';
import { en as settingsEn } from '../../i18n/messages/settings/en';
import { ALL_ROLES } from '../../roles';
import { matchRoute } from '../registry';
import { SETTINGS_INDEX, settingsFor } from '../settingsIndex';
import { canOpenPath } from '../visibility';

const SETTINGS_DIR = join(__dirname, '..', '..', '..', 'app', 'dashboard', 'settings');
const HEBREW = /[֐-׿]/;

function sources(dir = SETTINGS_DIR): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== '__tests__') out.push(...sources(p));
    } else if (/\.tsx?$/.test(name)) {
      out.push(readFileSync(p, 'utf8'));
    }
  }
  return out;
}

/** Route of every page.tsx under app/dashboard/settings, relative to it ('' = the page itself). */
function settingsPages(dir = SETTINGS_DIR, rel = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      // `_private` folders and tests are not routes; a `(group)` folder adds no URL segment.
      if (name === '__tests__' || name.startsWith('_')) continue;
      const seg = /^\(.*\)$/.test(name) ? '' : name;
      out.push(...settingsPages(p, [rel, seg].filter(Boolean).join('/')));
    } else if (name === 'page.tsx') {
      out.push(rel);
    }
  }
  return out;
}

const SETTINGS_PATH = '/dashboard/settings';
const PERSONAL = ['account', 'security', 'phone', 'privacy'];
const ids = (entries: readonly { id: string }[]) => entries.map((e) => e.id);

describe('settingsIndex · entries', () => {
  it('every href starts with /dashboard/settings', () => {
    for (const e of SETTINGS_INDEX) expect(e.href.startsWith('/dashboard/settings'), e.id).toBe(true);
  });

  it('ids are unique', () => {
    expect(new Set(ids(SETTINGS_INDEX)).size).toBe(SETTINGS_INDEX.length);
  });

  it('lists the page sections in page order, then the automations page', () => {
    expect(ids(SETTINGS_INDEX)).toEqual(['account', 'security', 'phone', 'profile', 'letterhead', 'rules', 'matching', 'privacy', 'automations']);
  });

  it('every anchor exists as an element id in the settings code', () => {
    const code = sources().join('\n');
    const anchored = SETTINGS_INDEX.filter((e) => e.href.includes('#'));
    expect(anchored.length).toBeGreaterThan(0);
    for (const e of anchored) expect(code, e.id).toContain(`id="${e.href.split('#')[1]}"`);
  });

  it('has one entry per section heading on the settings page, in page order (it cannot fall behind the page)', () => {
    const page = readFileSync(join(SETTINGS_DIR, 'page.tsx'), 'utf8');
    // Every <SectionHeader title={t('…')} …/> except the page's own H1 (`t('title')`, the screen itself).
    const keys = [...page.matchAll(/<SectionHeader\b[^>]*?\btitle=\{t\('([\w.]+)'\)\}/g)].map((m) => m[1]!).filter((k) => k !== 'title');
    expect(keys.length, 'no section headings found: did the page markup change?').toBeGreaterThan(0);
    const titles = keys.map((k) => k.split('.').reduce<unknown>((o, part) => (o as Record<string, unknown> | undefined)?.[part], settingsHe));
    for (const [i, title] of titles.entries()) expect(typeof title, keys[i]).toBe('string');
    const onPage = SETTINGS_INDEX.filter((e) => e.href.split('#')[0] === SETTINGS_PATH).map((e) => e.label.he);
    expect(onPage).toEqual(titles);
  });

  it('covers every settings page under app/dashboard/settings/**', () => {
    const routes = settingsPages().map((rel) => (rel ? `${SETTINGS_PATH}/${rel}` : SETTINGS_PATH));
    expect(routes).toContain(SETTINGS_PATH);
    expect([...new Set(SETTINGS_INDEX.map((e) => e.href.split('#')[0]))].sort()).toEqual(routes.sort());
  });

  it('every path is a real, registered settings page', () => {
    for (const e of SETTINGS_INDEX) {
      const path = e.href.split('#')[0]!;
      const rel = path.replace(/^\/dashboard\/settings\/?/, '');
      expect(existsSync(join(SETTINGS_DIR, rel, 'page.tsx')), e.id).toBe(true);
      expect(matchRoute(path)?.path, e.id).toBe(path);
    }
  });

  it('labels come from the settings messages, Hebrew and English', () => {
    for (const e of SETTINGS_INDEX) {
      expect(e.label.he, e.id).toMatch(HEBREW);
      expect(e.label.en, e.id).not.toMatch(HEBREW);
      expect(e.label.en.trim().length, e.id).toBeGreaterThan(0);
    }
    const account = SETTINGS_INDEX.find((e) => e.id === 'account')!;
    expect(account.label).toEqual({ he: settingsHe.sections.accountTitle, en: settingsEn.sections.accountTitle });
    const letterhead = SETTINGS_INDEX.find((e) => e.id === 'letterhead')!;
    expect(letterhead.label).toEqual({ he: settingsHe.sections.letterheadTitle, en: settingsEn.sections.letterheadTitle });
  });

  it('keywords are plain search words (no ICU placeholders), in both languages', () => {
    for (const e of SETTINGS_INDEX) {
      expect(e.keywords.length, e.id).toBeGreaterThan(0);
      for (const k of e.keywords) {
        expect(k.trim().length, `${e.id}: empty keyword`).toBeGreaterThan(0);
        expect(k, e.id).not.toMatch(/[{}]/);
      }
      expect(e.keywords.some((k) => HEBREW.test(k)), `${e.id}: a Hebrew keyword`).toBe(true);
      expect(e.keywords.some((k) => !HEBREW.test(k)), `${e.id}: an English keyword`).toBe(true);
    }
  });
});

describe('settingsIndex · roles mirror the page', () => {
  it('the restaurant sections use page.tsx `seesRestaurant` roles', () => {
    const page = readFileSync(join(SETTINGS_DIR, 'page.tsx'), 'utf8');
    const line = /const seesRestaurant = ([^;]+);/.exec(page)?.[1] ?? '';
    const sees = [...line.matchAll(/role === '(\w+)'/g)].map((m) => m[1]).sort();
    expect(sees).toEqual(['bookkeeper', 'manager', 'owner']);
    for (const id of ['profile', 'letterhead', 'rules', 'matching']) {
      expect([...(SETTINGS_INDEX.find((e) => e.id === id)?.roles ?? [])].sort(), id).toEqual(sees);
    }
  });

  it('personal sections have no role list (every role)', () => {
    for (const id of PERSONAL) expect(SETTINGS_INDEX.find((e) => e.id === id)?.roles, id).toBeUndefined();
  });

  it('every role an entry admits passes the route gate for its href', () => {
    for (const e of SETTINGS_INDEX) {
      for (const role of e.roles ?? ALL_ROLES) expect(canOpenPath(role, e.href), `${role} → ${e.href}`).toBe(true);
    }
  });
});

describe('settingsFor · filters by role', () => {
  it('chef and receiver get the personal sections only', () => {
    for (const role of ['chef', 'receiver'] as const) expect(ids(settingsFor(role)), role).toEqual(PERSONAL);
  });

  it('owner, manager and bookkeeper get every entry, in index order', () => {
    for (const role of ['owner', 'manager', 'bookkeeper'] as UserRole[]) expect(ids(settingsFor(role)), role).toEqual(ids(SETTINGS_INDEX));
  });

  it('never offers an entry outside its roles', () => {
    for (const role of ALL_ROLES) {
      for (const e of settingsFor(role)) expect(!e.roles || e.roles.includes(role), `${role} ${e.id}`).toBe(true);
    }
  });

  it('returns a fresh array (the index cannot be changed through it)', () => {
    const list = settingsFor('owner');
    list.pop();
    expect(SETTINGS_INDEX.length).toBe(ids(settingsFor('owner')).length);
    expect(list.length).toBe(SETTINGS_INDEX.length - 1);
  });
});
