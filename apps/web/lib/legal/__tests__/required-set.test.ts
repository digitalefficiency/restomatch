// React must be global before the component modules evaluate (classic JSX runtime).
import '@/lib/components/__tests__/reactGlobal';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { isPublicPath } from '@/lib/publicPaths';
import GlobalError from '@/app/global-error';
import { LegalLinks, type LegalLinksVariant } from '../LegalLinks';

/**
 * G-11 · deep-fix class 15 fix #1: the legal duty, pinned WITHOUT reading the
 * registry's list. Regulation 35 / ת״י 5568 (statement) and Amendment 13
 * (privacy, terms, cookies): each must exist as a page, be open without a
 * session and be linked from the one list every shell renders. Deleting an entry
 * from `LEGAL_LINKS` (or a page, or its public path) fails here.
 */
const REQUIRED = ['accessibility', 'privacy', 'terms', 'cookies'] as const;
const web = fileURLToPath(new URL('../../../', import.meta.url));
const VARIANTS: LegalLinksVariant[] = ['footer-column', 'inline-row', 'plain'];

describe('required legal set', () => {
  it.each(REQUIRED)('%s has a page file', (x) => {
    expect(existsSync(`${web}app/(marketing)/${x}/page.tsx`)).toBe(true);
  });

  it.each(REQUIRED)('/%s is public', (x) => {
    expect(isPublicPath(`/${x}`)).toBe(true);
  });

  for (const variant of VARIANTS) {
    for (const locale of ['he', 'en'] as const) {
      it(`LegalLinks ${variant} (${locale}) links all four, statement first`, () => {
        const html = renderToStaticMarkup(createElement(LegalLinks, { locale, variant }));
        const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
        for (const x of REQUIRED) expect(hrefs, x).toContain(`/${x}`);
        expect(hrefs[0]).toBe('/accessibility');
        const ids = [...html.matchAll(/data-legal-id="([^"]+)"/g)].map((m) => m[1]);
        expect(ids.length).toBe(hrefs.length);
      });
    }
  }

  it('variants change layout only: same ids in the same order', () => {
    const order = (variant: LegalLinksVariant) =>
      [...renderToStaticMarkup(createElement(LegalLinks, { locale: 'he', variant })).matchAll(/data-legal-id="([^"]+)"/g)].map(
        (m) => m[1],
      );
    expect(order('inline-row')).toEqual(order('footer-column'));
    expect(order('plain')).toEqual(order('footer-column'));
  });

  it('global-error renders outside every provider, with retry and the legal links', () => {
    const html = renderToStaticMarkup(createElement(GlobalError, { error: new Error('x'), reset: () => {} }));
    expect(html).toContain('<html lang="he" dir="rtl"');
    expect(html).toContain('נסו שוב');
    for (const x of REQUIRED) expect(html).toContain(`href="/${x}"`);
    expect(html).toContain('הצהרת נגישות');
  });

  it('no "1.5%" target on the public surfaces G-11 touches (owner decision)', () => {
    const files = [
      'lib/legal/registry.ts',
      'lib/legal/LegalLinks.tsx',
      'app/(marketing)/_components/LegalShell.tsx',
      'app/(marketing)/_components/MarketingShell.tsx',
      'app/(auth)/_components/AuthShell.tsx',
      'app/showcase/_components/ShowcaseFooter.tsx',
      'app/admin/layout.tsx',
      'app/error.tsx',
      'app/global-error.tsx',
      'lib/i18n/messages/marketing/he.ts',
      'lib/i18n/messages/marketing/en.ts',
    ];
    for (const f of files) expect(readFileSync(`${web}${f}`, 'utf8'), f).not.toMatch(/1[.,]5\s*%/);
  });
});
