// DS3-01: the shared page header in the clean finish (SPEC §6 type scale, §7 density) and its seam for DS3-02's star.
import './reactGlobal';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/dashboard/approvals',
  useSearchParams: () => new URLSearchParams(),
}));

const { I18nProvider } = await import('../../i18n/client');
const { NavProvider } = await import('../../nav/NavProvider');
const { PageHeader } = await import('../PageHeader');

// Loosely typed createElement: two @types/react majors are hoisted in the workspace (STATE.md).
const h = createElement as unknown as (type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]) => ReactElement;
const render = (el: ReactElement) =>
  renderToStaticMarkup(h(I18nProvider, { locale: 'he' }, h(NavProvider, { value: { role: 'owner', features: [], showChain: false, branch: null } }, el)));

describe('PageHeader (DS3)', () => {
  it('the title is the title-lg role: 24/32 at 600, 20/26 in compact (never 700)', () => {
    const html = render(h(PageHeader, { title: 'אישורים' }));
    expect(html).toMatch(/<h1 tabindex="-1" class="text-title-lg text-fg focus:outline-none">אישורים<\/h1>/);
    expect(html).not.toContain('font-bold');
  });

  it('titleAside sits beside the title, outside the h1, so the heading stays the page name', () => {
    const star = h('button', { type: 'button', 'aria-label': 'הוספה למועדפים', 'aria-pressed': false }, '★');
    const html = render(h(PageHeader, { title: 'אישורים', titleAside: star }));
    expect(html).toMatch(/<h1 tabindex="-1" class="min-w-0 text-title-lg text-fg focus:outline-none">אישורים<\/h1><button type="button" aria-label="הוספה למועדפים"/);
    expect(html.match(/<h1/g)).toHaveLength(1);
  });
});
