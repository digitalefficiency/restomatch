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
