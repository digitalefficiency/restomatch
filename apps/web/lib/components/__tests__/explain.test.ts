import './reactGlobal';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../../i18n/client';
import type { AppLocale } from '../../i18n/config';
import { explain } from '../../i18n/messages/explain';
import { RECEIVER_CONCEPTS } from '../../i18n/messages/explain/explain.receiver';
import { createTranslator, lookup, type MessageTree } from '../../i18n/translate';
import { Explain, explainId } from '../Explain';

// W2-16 · the in-place fold. Static markup + a11y contract (MECHANISM §2.4). The click/focus/
// scroll behaviour needs a real DOM and is asserted in e2e/W2-16.spec.ts (fold contract).
const h = createElement as unknown as (type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]) => ReactElement;
const render = (el: ReactElement, locale: AppLocale = 'he') => renderToStaticMarkup(h(I18nProvider, { locale }, el));

function attr(html: string, tag: string, name: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*\\s${name}="([^"]*)"`, 'g');
  return [...html.matchAll(re)].map((m) => m[1]!);
}

describe('<Explain> markup and a11y contract', () => {
  const html = render(h(Explain, { line: h('span', null, '2 חשבוניות ממתינות'), body: 'לרוב חשבונית מרכזת.', about: 'ממתינות לשיוך', id: 'pending' }));

  it('a native button, collapsed, controlling an existing hidden panel', () => {
    expect(html).toMatch(/<button type="button" aria-expanded="false" aria-controls="pending-panel"/);
    expect(html).toMatch(/<div id="pending-panel" hidden=""[^>]*data-explain-panel/);
    expect(html).toContain('data-explain-toggle');
  });

  it('the name starts with the visible label, then the sr-only "about"; no aria-label / title', () => {
    const button = html.slice(html.indexOf('<button'), html.indexOf('</button>'));
    expect(button.replace(/<[^>]+>/g, '')).toBe('למה? · ממתינות לשיוך');
    expect(button).toContain('<span class="sr-only"> · ממתינות לשיוך</span>');
    expect(button).not.toMatch(/aria-label|title=/);
    expect(button).toMatch(/<svg[^>]*aria-hidden="true"/);
  });

  it('the panel is plain: no role, not live, and nothing points at it with aria-describedby', () => {
    const panel = html.slice(html.indexOf('<div id="pending-panel"'));
    expect(panel).not.toMatch(/role=|aria-live|aria-describedby/);
    expect(html).not.toMatch(/aria-describedby/);
  });

  it('44 px target (48 in field mode), tokens only, print shows the panel and hides the toggle', () => {
    const cls = attr(html, 'button', 'class')[0]!.replace(/&amp;/g, '&');
    for (const c of ['min-h-11', 'min-w-11', 'text-primary', 'rounded-control', '[[data-mode=field]_&]:min-h-12', 'print:hidden']) expect(cls).toContain(c);
    expect(cls).not.toMatch(/#[0-9a-f]{3,6}/i);
    expect(attr(html, 'div', 'class').some((c) => c.includes('border-s-2') && c.includes('print:!block'))).toBe(true);
  });

  it('the three labels render from the explain namespace (he and en)', () => {
    for (const [label, he, en] of [['why', 'למה?', 'Why?'], ['details', 'פרטים', 'Details'], ['how', 'איך חישבנו?', 'How we got this']] as const) {
      expect(render(h(Explain, { body: 'x', about: 'a', label }))).toContain(`${he}<span`);
      expect(render(h(Explain, { body: 'x', about: 'a', label }), 'en')).toContain(`${en}<span`);
    }
  });

  it('a receiver locale gets its own toggle label (never English)', () => {
    expect(render(h(Explain, { body: 'x', about: 'a' }), 'ar')).toContain('لماذا؟');
  });

  it('an empty body renders no toggle (the line alone)', () => {
    expect(render(h(Explain, { line: 'שורה', body: '  ', about: 'a' }))).toBe('שורה');
    expect(render(h(Explain, { body: '', about: 'a' }))).toBe('');
  });

  it('two instances get distinct ids; React 19 id characters are stripped', () => {
    const two = render(h('div', null, h(Explain, { body: 'א', about: 'a' }), h(Explain, { body: 'ב', about: 'b' })));
    const ids = attr(two, 'button', 'aria-controls');
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(explainId('«r0»')).toBe('r0');
    expect(explainId(':R1a:')).toBe('R1a');
  });
});

describe('explain namespace', () => {
  function leafPaths(tree: MessageTree, prefix = ''): string[] {
    return Object.entries(tree).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : leafPaths(v, `${prefix}${k}.`)));
  }

  it('receiver overlays cover the toggles and every receiver concept, in native script', () => {
    const want = ['toggle.why', 'toggle.details', 'toggle.how', ...RECEIVER_CONCEPTS].sort();
    for (const locale of ['ar', 'ru', 'th', 'ti'] as const) {
      const tree = (explain.extra as Record<string, MessageTree>)[locale]!;
      expect(leafPaths(tree).sort()).toEqual(want);
      for (const k of want) expect(lookup(tree, k)).not.toMatch(/[֐-׿]/);
    }
  });

  it('a concept outside the overlay falls back to Hebrew in a receiver locale, never English', () => {
    expect(createTranslator('th', explain)('leakRule')).toBe(explain.he.leakRule);
    expect(createTranslator('ru', explain)('reviewNotGap')).toBe(explain.extra!.ru!.reviewNotGap);
  });

  it('no value holds ₪ or a placeholder', () => {
    for (const tree of [explain.he, explain.en] as MessageTree[]) {
      for (const k of leafPaths(tree)) expect(lookup(tree, k)).not.toMatch(/₪|\{/);
    }
  });
});
