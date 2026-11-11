// G11 (DS2 VERDICT §5): ▲/▼ are drawn as icons, never typed. No UI face has
// U+25B2/U+25BC, so a typed mark was painted by a system font.
import '../../__tests__/reactGlobal';
import { createElement as h, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../../../i18n/client';
import { DeltaBadge } from '../DeltaBadge';

const render = (el: ReactElement) => renderToStaticMarkup(h(I18nProvider, { locale: 'he' }, el));

describe('DeltaBadge mark (G11)', () => {
  it.each([
    ['up', 1200, 1000],
    ['down', 800, 1000],
  ] as const)('%s: an SVG mark, no ▲/▼ text', (dir, current, previous) => {
    const html = render(h(DeltaBadge, { current, previous, compare: 'prev' }));
    expect(html).not.toMatch(/[▲▼]/);
    expect(html).toContain(`data-delta-mark="${dir}"`);
    expect(html).toMatch(/<svg[^>]*data-delta-mark/);
  });

  it('flat: no mark at all', () => {
    const html = render(h(DeltaBadge, { current: 1000, previous: 1000, compare: 'prev' }));
    expect(html).not.toContain('data-delta-mark');
    expect(html).not.toMatch(/[▲▼]/);
  });

  it('the down mark is the up mark rotated, never mirrored by direction', () => {
    const down = render(h(DeltaBadge, { current: 800, previous: 1000, compare: 'prev' }));
    expect(down).toMatch(/data-delta-mark="down"[^>]*class="[^"]*rotate-180|class="[^"]*rotate-180[^"]*"[^>]*data-delta-mark="down"/);
  });
});
