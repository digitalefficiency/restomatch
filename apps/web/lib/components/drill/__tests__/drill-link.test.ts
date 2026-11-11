import React, { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '@/lib/i18n/client';
import type { Locale } from '@/lib/i18n/config';
import { formatIls } from '@/lib/money';
import { DrillLink, drillAttrs } from '../DrillLink';

(globalThis as unknown as { React?: typeof React }).React = React;
const h = createElement as unknown as (type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]) => ReactElement;
const render = (props: Record<string, unknown>, locale: Locale = 'he') =>
  renderToStaticMarkup(h(I18nProvider, { locale }, h(DrillLink, props, 'x')));
const attr = (html: string, name: string) => html.match(new RegExp(`${name}="([^"]*)"`))?.[1]?.replace(/&quot;/g, '"');

describe('DrillLink (the drill contract)', () => {
  it('renders <a data-drill data-drill-total={agorot}> to its href', () => {
    const html = render({ href: '/dashboard/leaks/breakdown?state=unpaid', totalAgorot: 29600, label: 'נתפס לפני תשלום', rows: 4 });
    expect(html).toMatch(/^<a /);
    expect(attr(html, 'href')).toBe('/dashboard/leaks/breakdown?state=unpaid');
    expect(html).toContain('data-drill=""');
    expect(attr(html, 'data-drill-total')).toBe('29600');
  });

  it('accessible name: scope + the same ₪ + the row count (he/en, plurals)', () => {
    const he = attr(render({ href: '/x', totalAgorot: 29600, label: 'נתפס לפני תשלום', rows: 4 }), 'aria-label');
    expect(he).toBe(`נתפס לפני תשלום ${formatIls(296, { locale: 'he' })} — פתחו 4 שורות`);
    expect(attr(render({ href: '/x', totalAgorot: 29600, label: 'L', rows: 1 }), 'aria-label')).toMatch(/פתחו שורה אחת$/);
    const en = attr(render({ href: '/x', totalAgorot: 46354, label: 'Paid, to claim', rows: 9, context: 'line' }, 'en'), 'aria-label');
    expect(en).toBe(`Paid, to claim ${formatIls(463.54, { locale: 'en', maximumFractionDigits: 2 })} — open 9 rows`);
    expect(attr(render({ href: '/x', totalAgorot: 100, label: 'L' }), 'aria-label')).toMatch(/פתחו את הפירוט$/);
  });

  it('rejects non-integer agorot (a shekel float is a bug, not a door)', () => {
    expect(() => drillAttrs(759.54)).toThrow(RangeError);
    expect(drillAttrs(75954)).toEqual({ 'data-drill': '', 'data-drill-total': '75954' });
  });
});
