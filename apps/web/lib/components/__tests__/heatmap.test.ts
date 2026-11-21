import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LeakHeatmap } from '../LeakHeatmap';
import { formatPercent } from '../../i18n/format';

// The node test runner compiles .tsx with the classic JSX runtime.
(globalThis as unknown as { React?: typeof React }).React = React;

const cell = (deltaPct: number) => ({
  productName: 'Draft beer keg 30L',
  supplierName: 'Steinberg Beverages',
  deltaPct,
  monthExcessIls: 110,
});

describe('LeakHeatmap', () => {
  it('tiles use the same 1-decimal percent as the detective table', () => {
    for (const locale of ['he', 'en'] as const) {
      const html = renderToStaticMarkup(createElement(LeakHeatmap, { items: [cell(0.10638), cell(0.07)], locale }));
      expect(html).toContain(formatPercent(0.10638, locale, 1)); // 10.6%, not 11%
      expect(html).toContain(formatPercent(0.07, locale, 1)); // 7%
      expect(html).not.toContain('+11%');
    }
  });
});

describe('LeakHeatmap — RTL, tokens and reachable tiles (W2-09c)', () => {
  const render = (items: Parameters<typeof LeakHeatmap>[0]['items']) =>
    renderToStaticMarkup(createElement(LeakHeatmap, { items, locale: 'he' }));

  it('no dir="ltr", no font-mono, no hex colour on the tiles', () => {
    const html = render([cell(0.3)]);
    expect(html).not.toContain('dir="ltr"');
    expect(html).not.toContain('font-mono');
    expect(html).not.toMatch(/#[0-9A-Fa-f]{6}|rgb\(\d/);
    expect(html).toMatch(/bg-creep-[1-5]/);
  });

  it('every tile has a full-sentence name (not title= only)', () => {
    const html = render([cell(0.3)]);
    expect(html).not.toContain('title=');
    expect(html).toMatch(/aria-label="Draft beer keg 30L · Steinberg Beverages: \+/);
  });

  it('with href a tile is a link (a door) stamped with the drill contract in agorot', () => {
    const html = render([{ ...cell(0.3), href: '/dashboard/leaks#creep-1' }]);
    expect(html).toMatch(/<a href="\/dashboard\/leaks#creep-1"/);
    expect(html).toContain('data-drill=""');
    expect(html).toContain('data-drill-total="11000"');
  });
});
