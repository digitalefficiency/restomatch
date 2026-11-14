import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isPublicPath } from '@/lib/publicPaths';
import robots from '@/app/robots';
import sitemap from '@/app/sitemap';
import { MARKETING_ROUTES } from '@/app/(marketing)/_components/seo';
import {
  LEGAL_LINKS,
  LEGAL_NAV_LABEL,
  LEGAL_PAGE_PATHS,
  SUPPORT_LINKS,
  legalHref,
} from '../registry';

/** G-11 · deep-fix class 15 fix #2: one ordered legal list, everything derives from it. */
const pages = LEGAL_LINKS.filter((l) => l.kind !== 'action').map((l) => l.href.split('#')[0]!);

describe('legal registry', () => {
  it('holds the fixed order every shell renders', () => {
    expect(LEGAL_LINKS.map((l) => l.id)).toEqual([
      'accessibility',
      'privacy',
      'terms',
      'cookies',
      'cookieSettings',
    ]);
    expect(LEGAL_LINKS.map((l) => l.href)).toEqual([
      '/accessibility',
      '/privacy',
      '/terms',
      '/cookies',
      '/cookies#cookie-settings',
    ]);
    expect(LEGAL_LINKS.find((l) => l.id === 'cookieSettings')?.kind).toBe('action');
    expect(LEGAL_PAGE_PATHS).toEqual(['/accessibility', '/privacy', '/terms', '/cookies']);
  });

  it('labels every link in he and en (non-empty, Hebrew gershayim never ASCII quotes)', () => {
    for (const l of [...LEGAL_LINKS, ...SUPPORT_LINKS, { label: LEGAL_NAV_LABEL }]) {
      expect(l.label.he.trim()).not.toBe('');
      expect(l.label.en.trim()).not.toBe('');
      expect(l.label.he).toMatch(/[֐-׿]/);
      expect(l.label.he).not.toMatch(/["']/);
    }
    expect(LEGAL_LINKS[0]!.label).toEqual({ he: 'הצהרת נגישות', en: 'Accessibility statement' });
  });

  it('legalHref resolves ids and refuses unknown ones', () => {
    expect(legalHref('privacy')).toBe('/privacy');
    expect(legalHref('cookieSettings')).toBe('/cookies#cookie-settings');
    expect(() => legalHref('nope' as never)).toThrow();
  });

  it('every legal page is public — a subset of publicPaths, never its source', () => {
    for (const p of pages) expect(isPublicPath(p), p).toBe(true);
  });

  it('every legal page is in the sitemap, and no action (#hash) is', () => {
    const urls = sitemap().map((e) => new URL(e.url));
    const paths = urls.map((u) => u.pathname);
    for (const p of pages) expect(paths, p).toContain(p);
    expect(urls.some((u) => u.hash !== '')).toBe(false);
    for (const p of pages) expect(MARKETING_ROUTES).toContain(p);
  });

  it('every legal page is in robots `allow` and matches no `disallow`', () => {
    const rules = robots().rules;
    const rule = (Array.isArray(rules) ? rules : [rules]).find((r) => r.userAgent === '*')!;
    const allow = ([] as string[]).concat(rule.allow ?? []);
    const disallow = ([] as string[]).concat(rule.disallow ?? []);
    for (const p of pages) {
      expect(allow, p).toContain(p);
      expect(
        disallow.filter((d) => p === d || p.startsWith(d.endsWith('/') ? d : `${d}/`)),
        p,
      ).toEqual([]);
    }
  });

  it('registry.ts has zero imports (it must load inside global-error)', () => {
    const src = readFileSync(fileURLToPath(new URL('../registry.ts', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/^\s*import\s/m);
    expect(src).not.toMatch(/\brequire\(|\bimport\(/);
    expect(src).not.toMatch(/\bfrom\s+['"]/);
  });
});
