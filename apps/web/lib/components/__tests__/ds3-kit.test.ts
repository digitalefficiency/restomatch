// DS3 · the clean finish (docs/ux/ds3/SPEC.md §2, §3, §5, kit cards "כסף", "סטטוס", "ההשוואה המשולשת").
import './reactGlobal';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { formatIls } from '../../money';
import { I18nProvider } from '../../i18n/client';
import type { Locale } from '../../i18n/config';
import { Badge, type BadgeTone } from '../Badge';
import { CountBadge, pillToneOf, StatusChip, StatusDot, type StatusTone } from '../feedback/StatusChip';
import { DeadlineChip } from '../money/DeadlineChip';
import { MatchStrip } from '../money/MatchStrip';
import { Money } from '../money/Money';
import { moneyFigureText, moneyGlyph, moneyText, splitMoney } from '../money/format';
import { DOT_TONE, PILL_TONE } from '../tone';

// Loosely typed createElement: two @types/react majors are hoisted in the workspace (STATE.md).
const h = createElement as unknown as (type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]) => ReactElement;
const render = (el: ReactElement, locale: Locale = 'he') => renderToStaticMarkup(h(I18nProvider, { locale }, el));
function textOf(html: string): string {
  let out = '';
  let inTag = false;
  for (const ch of html) {
    if (ch === '<') inTag = true;
    else if (ch === '>') inTag = false;
    else if (!inTag) out += ch;
  }
  return out.split('&nbsp;').join(' ');
}

const VALUES = [0, 0.5, 1, 7.5, 12.34, 99.99, 104.8, 522.6, 575, 759.54, 1000, 1759.5, 13474, 99999.99, 1234567.89, -84.96, -1123, 0.01];

describe('splitMoney: the formatIls() text cut, never changed', () => {
  for (const locale of ['he', 'en'] as const) {
    for (const dp of [0, 2, 4]) {
      it(`${locale} · ${dp} dp: parts rejoin to the exact string; one glyph; agorot only after "."`, () => {
        for (const v of VALUES) {
          const text = formatIls(v, { maximumFractionDigits: dp, locale });
          const parts = splitMoney(text, dp);
          expect(parts.map((p) => p.text).join('')).toBe(text);
          expect(parts.filter((p) => p.kind === 'glyph').map((p) => p.text)).toEqual(['₪']);
          const dec = parts.filter((p) => p.kind === 'dec');
          if (dp === 0) expect(dec).toEqual([]);
          else {
            expect(dec).toHaveLength(1);
            expect(dec[0]!.text).toMatch(/^\.\d{2,4}$/);
          }
        }
      });
    }
  }

  it('the figure-only text (D8 header ₪) splits the same way, with no glyph', () => {
    const parts = splitMoney(moneyFigureText(1104.8, 'line', 'he'), 2);
    expect(parts.some((p) => p.kind === 'glyph')).toBe(false);
    expect(parts.find((p) => p.kind === 'dec')?.text).toBe('.80');
  });

  it('a string it does not recognise stays whole', () => {
    expect(splitMoney('לא זמין', 2)).toEqual([{ kind: 'text', text: 'לא זמין' }]);
  });

  it('moneyGlyph comes from formatIls itself', () => {
    expect(moneyGlyph('he')).toBe('₪');
    expect(moneyGlyph('en')).toBe('₪');
  });
});

describe('<Money> in the clean finish (SPEC §3)', () => {
  it('keeps the text byte for byte, the ₪ sign and the agorot in their own quiet spans', () => {
    for (const locale of ['he', 'en'] as const) {
      const html = render(h(Money, { value: 1104.8, context: 'line' }), locale);
      expect(textOf(html)).toBe(formatIls(1104.8, { maximumFractionDigits: 2, locale }));
      expect(html).toMatch(/<span data-money="cur" class="[^"]*text-fg-tertiary[^"]*">₪<\/span>/);
      expect(html).toMatch(/<span data-money="dec" class="text-fg-tertiary">\.80<\/span>/);
      expect(html).toContain('max(0.74em,var(--fs-caption))');
      expect(html).not.toMatch(/dir=/);
    }
  });

  it('whole shekels have no agorot span; a coloured figure keeps one colour', () => {
    const tile = render(h(Money, { value: 760, context: 'tile' }));
    expect(tile).not.toContain('data-money="dec"');
    const green = render(h(Money, { value: 296, context: 'line', state: 'claimed' }));
    expect(green).toContain('text-primary');
    expect(green).not.toContain('text-fg-tertiary');
    expect(render(h(Money, { value: 296, context: 'line', quietParts: false }))).not.toContain('text-fg-tertiary');
  });

  it('a money figure is never red, in any state', () => {
    for (const state of ['leak', 'atRisk', 'caught', 'claimed', 'credited', 'returned', 'outstanding', 'pending', 'spend', 'zero'] as const) {
      expect(render(h(Money, { value: 38.7, state }))).not.toMatch(/danger/);
    }
  });

  it('D8 header symbol: figure only, agorot still quiet, the ₪ amount in the title', () => {
    const html = render(h(Money, { value: 38.7, context: 'line', symbol: 'header' }));
    expect(textOf(html)).not.toContain('₪');
    expect(html).toContain('data-money="dec"');
    expect(html).toMatch(/title="[^"]*38\.70[^"]*₪/);
  });

  it('the hero keeps its own glyph rule (DS3-03 owns the hero)', () => {
    expect(render(h(Money, { value: 759.54, context: 'hero' }))).toContain('<span class="money-glyph">₪</span>');
  });

  it('moneyText is still the frozen util output', () => {
    expect(moneyText(522.6, 'line', 'he')).toBe(formatIls(522.6, { maximumFractionDigits: 2 }));
  });
});

describe('the status pill (kit "סטטוס", SPEC §2 tiers)', () => {
  it('maps DS2 tones to the clean finish: one solid pill, amber for warnings, green for good news', () => {
    const cases: Array<[StatusTone, 'bold' | 'subtle', string]> = [
      ['danger', 'bold', 'solid'],
      ['danger', 'subtle', 'leak'],
      ['warn', 'bold', 'warn'],
      ['warn', 'subtle', 'warn'],
      ['success', 'subtle', 'ok'],
      ['gold', 'bold', 'ok'],
      ['info', 'subtle', 'info'],
      ['neutral', 'bold', 'neutral'],
    ];
    for (const [tone, emphasis, pill] of cases) expect(pillToneOf(tone, emphasis)).toBe(pill);
  });

  it('the word is ink on every tinted pill and white only on the solid one', () => {
    for (const pill of ['leak', 'warn', 'ok', 'info'] as const) expect(PILL_TONE[pill]).toContain('text-fg');
    expect(PILL_TONE.solid).toContain('text-on-bold');
    expect(PILL_TONE.neutral).toContain('text-fg-secondary');
    expect(PILL_TONE.neutral).not.toMatch(/warn|danger/);
  });

  it('renders a 6 px dot by default, an explicit icon instead, or nothing with icon={null}', () => {
    const dot = render(h(StatusChip, { tone: 'warn', label: 'ממתינה לתשובה' }));
    expect(dot).toContain('data-pill="warn"');
    expect(dot).toMatch(/data-dot="warn" class="size-1\.5 shrink-0 rounded-full bg-warn-bold"/);
    expect(render(h(StatusChip, { tone: 'neutral', label: 'x', icon: null }))).not.toContain('data-dot');
  });

  it('StatusDot is 8 px beside a label and 6 px inside a pill', () => {
    expect(render(h(StatusDot, { tone: 'leak' }))).toContain('size-2');
    expect(render(h(StatusDot, { tone: 'leak', size: 'sm' }))).not.toContain('size-2');
    expect(DOT_TONE.leak).toBe('bg-danger-bold');
  });

  it('Badge draws the same shell with no dot; warning-solid is the amber pill', () => {
    const tones: Array<[BadgeTone, string]> = [
      ['danger-solid', PILL_TONE.solid],
      ['warning-solid', PILL_TONE.warn],
      ['accent', PILL_TONE.ok],
      ['neutral', PILL_TONE.neutral],
    ];
    for (const [tone, classes] of tones) {
      const html = render(h(Badge, { tone }, 'x'));
      for (const c of classes.split(' ')) expect(html).toContain(c);
      expect(html).not.toContain('data-dot');
    }
    expect(render(h(Badge, {}, 'x'))).not.toMatch(/\/12\b|ring-1/);
  });

  it('CountBadge can say zero for a tab', () => {
    expect(render(h(CountBadge, { count: 0 }))).toBe('');
    expect(textOf(render(h(CountBadge, { count: 0, showZero: true })))).toBe('0');
    expect(render(h(CountBadge, { count: Number.NaN, showZero: true }))).toBe('');
  });

  it('a late deadline is the tinted red pill, never the solid one', () => {
    const late = render(h(DeadlineChip, { due: new Date(2026, 9, 20), today: new Date(2026, 9, 25) }));
    expect(late).toContain('data-pill="leak"');
    const near = render(h(DeadlineChip, { due: new Date(2026, 9, 28), today: new Date(2026, 9, 25) }));
    expect(near).toContain('data-pill="warn"');
  });
});

describe('<MatchStrip>: ordered · received · billed in one line', () => {
  it('always in this order, the off cell tinted, the gap written, one summary for assistive tech', () => {
    const html = render(
      h(MatchStrip, { ordered: 9.5, received: 6.5, billed: 9.5, unit: 'ק״ג', off: 'received', gap: { value: 3, kind: 'qty', direction: 'less' } }),
    );
    const order = [...html.matchAll(/data-cell="(\w+)"/g)].map((m) => m[1]);
    expect(order).toEqual(['ordered', 'received', 'billed']);
    expect(html).toMatch(/data-cell="received"[^>]*class="[^"]*bg-danger-subtle/);
    expect(textOf(html)).toContain('3 פחות');
    expect(html).toContain('aria-label="הוזמן 9.5, התקבל 6.5, חויב 9.5 ק״ג, 3 פחות"');
    expect(html).toContain('role="group"');
  });

  it('English and the warn tone', () => {
    const html = render(h(MatchStrip, { ordered: 10, received: 10, billed: 12, unit: 'kg', off: 'billed', tone: 'warn', gap: { value: 2, kind: 'qty', direction: 'more' } }), 'en');
    expect(html).toContain('aria-label="Ordered 10, Received 10, Billed 12 kg, 2 more"');
    expect(html).toMatch(/data-cell="billed"[^>]*class="[^"]*bg-warn-subtle/);
    expect(html).toMatch(/data-gap=""[^>]*class="[^"]*text-warn/);
  });

  it('unknown is "אין", never 0; at the dock the billed cell is left out', () => {
    const dock = render(h(MatchStrip, { ordered: 12, received: null }));
    expect(textOf(dock)).toContain('אין');
    expect(dock).not.toContain('data-cell="billed"');
  });

  it('prices go through <Money>, per unit; a percentage gap is formatted', () => {
    const html = render(
      h(MatchStrip, { kind: 'price', ordered: 522.6, received: null, billed: 575, unit: 'חבית', off: 'billed', tone: 'warn', gap: { value: 0.1, kind: 'pct', direction: 'more' } }),
    );
    expect(html).toContain('data-money="cur"');
    expect(textOf(html)).toContain(formatIls(575, { maximumFractionDigits: 2 }));
    expect(textOf(html)).toContain('לחבית');
    expect(textOf(html)).toContain('10% יותר');
  });

  it('no gap without an off cell; the supplier letter names the third column "בחשבונית"', () => {
    const html = render(h(MatchStrip, { ordered: 1, received: 1, billed: 1, gap: { value: 1, kind: 'qty', direction: 'less' }, billedLabel: 'invoice' }));
    expect(html).not.toContain('data-gap');
    expect(textOf(html)).toContain('בחשבונית');
  });
});
