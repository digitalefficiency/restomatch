// DS3 · the clean finish (docs/ux/ds3/SPEC.md §2, §3, §5, kit cards "כסף", "סטטוס", "ההשוואה המשולשת").
import './reactGlobal';
import { readFileSync } from 'node:fs';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { formatIls } from '../../money';
import { I18nProvider } from '../../i18n/client';
import type { Locale } from '../../i18n/config';
import { Badge, type BadgeTone } from '../Badge';
import { CountBadge, pillToneOf, StatusChip, StatusDot, type StatusTone } from '../feedback/StatusChip';
import { DeadlineChip } from '../money/DeadlineChip';
import { EmptyState as EmptyStateComp } from '../EmptyState';
import { MatchStrip } from '../money/MatchStrip';
import { bellPanelEnd } from '../notifications/place';
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
  it('default stays ONE text node: other packages\' e2e specs find ₪ and its digits in a single node', () => {
    for (const locale of ['he', 'en'] as const) {
      const html = render(h(Money, { value: 1104.8, context: 'line' }), locale);
      const text = formatIls(1104.8, { maximumFractionDigits: 2, locale });
      expect(html).toContain(`<bdi class="num whitespace-nowrap">${text}</bdi>`);
      expect(html).not.toContain('data-money=');
    }
  });

  it('split: the text byte for byte, the ₪ sign and the agorot in their own quiet spans', () => {
    for (const locale of ['he', 'en'] as const) {
      const html = render(h(Money, { value: 1104.8, context: 'line', split: true }), locale);
      expect(textOf(html)).toBe(formatIls(1104.8, { maximumFractionDigits: 2, locale }));
      expect(html).toMatch(/<span data-money="cur" class="[^"]*text-fg-tertiary[^"]*">₪<\/span>/);
      expect(html).toMatch(/<span data-money="dec" class="text-fg-tertiary[^"]*">\.80<\/span>/);
      expect(html).toContain('max(0.74em,var(--fs-caption))');
      expect(html).not.toMatch(/dir=/);
    }
  });

  it('split: whole shekels have no agorot span; a coloured figure keeps one colour', () => {
    const tile = render(h(Money, { value: 760, context: 'tile', split: true }));
    expect(tile).toContain('data-money="cur"');
    expect(tile).not.toContain('data-money="dec"');
    const green = render(h(Money, { value: 296, context: 'line', state: 'claimed', split: true }));
    // `claimed` reads the T3 family since DS3-00 700952c0 (it was text-primary; both are #00573B).
    expect(green).toContain('text-gold');
    expect(green).not.toContain('text-primary');
    expect(green).not.toContain('text-fg-tertiary');
    expect(render(h(Money, { value: 296, context: 'line', split: true, quietParts: false }))).not.toContain('text-fg-tertiary');
  });

  it('split: inside a filled ancestor the quiet parts take the fill\'s word colour (never grey on a fill)', () => {
    const html = render(h('span', { className: 'bg-primary-bold text-on-bold' }, h(Money, { value: 152.5, context: 'line', split: true })));
    const cls = (part: string) => (html.match(new RegExp(`<span data-money="${part}" class="([^"]*)"`))?.[1] ?? '').split('&amp;').join('&');
    const [cur, dec] = [cls('cur'), cls('dec')];
    for (const cls of [cur, dec]) {
      expect(cls).toContain('[.text-on-bold_&]:text-inherit');
      expect(cls).toContain('[.text-on-primary_&]:text-inherit');
    }
  });

  it('a money figure is never red, in any state', () => {
    for (const state of ['leak', 'atRisk', 'caught', 'claimed', 'credited', 'returned', 'outstanding', 'pending', 'spend', 'zero'] as const) {
      expect(render(h(Money, { value: 38.7, state }))).not.toMatch(/danger/);
      expect(render(h(Money, { value: 38.7, state, split: true }))).not.toMatch(/danger/);
    }
  });

  it('D8 header symbol: figure only (one node by default, agorot quiet with split), the ₪ amount in the title', () => {
    const plain = render(h(Money, { value: 38.7, context: 'line', symbol: 'header' }));
    expect(textOf(plain)).not.toContain('₪');
    expect(plain).not.toContain('data-money=');
    expect(plain).toMatch(/title="[^"]*38\.70[^"]*₪/);
    const split = render(h(Money, { value: 38.7, context: 'line', symbol: 'header', split: true }));
    expect(textOf(split)).not.toContain('₪');
    expect(split).toContain('data-money="dec"');
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
    // good news is the leaf green of the ok family (SPEC §2 --ok-sub / --ok-bd), not the brand
    expect(PILL_TONE.ok).toBe('border-ok-subtle bg-ok-subtle text-fg');
    expect(PILL_TONE.solid).toContain('text-on-bold');
    expect(PILL_TONE.neutral).toContain('text-fg-secondary');
    expect(PILL_TONE.neutral).not.toMatch(/warn|danger/);
  });

  it('renders a 6 px dot by default, an explicit icon instead, or nothing with icon={null}', () => {
    const dot = render(h(StatusChip, { tone: 'warn', label: 'ממתינה לתשובה' }));
    expect(dot).toContain('data-pill="warn"');
    // DS3-00 indicator roles: the amber dot carries its 3:1 ring (SPEC §2 --warn-solid, --warn-ring).
    expect(dot).toMatch(/data-dot="warn" class="inline-block size-1\.5 shrink-0 rounded-full forced-color-adjust-none bg-warn-dot ring-1 ring-warn-dot-ring"/);
    expect(render(h(StatusChip, { tone: 'neutral', label: 'x', icon: null }))).not.toContain('data-dot');
  });

  it('StatusDot is 8 px beside a label and 6 px inside a pill', () => {
    expect(render(h(StatusDot, { tone: 'leak' }))).toContain('size-2');
    expect(render(h(StatusDot, { tone: 'leak', size: 'sm' }))).not.toContain('size-2');
    expect(DOT_TONE.leak).toBe('bg-danger-dot');
    expect(DOT_TONE.ok).toBe('bg-ok-dot');
    expect(DOT_TONE.neutral).toBe('bg-neutral-dot');
    // the 8 px amber dot: an inset ring, so it stays 8 px
    expect(render(h(StatusDot, { tone: 'warn' }))).toContain('ring-[1.5px] ring-inset ring-warn-dot-ring');
    expect(render(h(StatusDot, { tone: 'leak' }))).not.toContain('ring-');
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

  it('unknown is never 0: a quantity not counted says so, a missing price is "אין"; the dock leaves billed out', () => {
    const dock = render(h(MatchStrip, { ordered: 12, received: null }));
    expect(textOf(dock)).toContain('לא נספר');
    expect(dock).not.toContain('data-cell="billed"');
    const price = render(h(MatchStrip, { kind: 'price', ordered: 10, received: null, billed: 11 }));
    expect(textOf(price)).toContain('אין');
  });

  it('an off cell never changes the strip height; a ₪ gap is drawn through <Money> in ink', () => {
    const plain = render(h(MatchStrip, { ordered: 1, received: 1, billed: 1 }));
    const off = render(h(MatchStrip, { ordered: 1, received: 1, billed: 2, off: 'billed', gap: { value: 52.4, kind: 'ils', direction: 'more' } }));
    for (const html of [plain, off]) for (const m of html.matchAll(/data-cell="\w+"[^>]*class="([^"]*)"/g)) expect(m[1]).toContain('border ');
    expect(off).toContain('[&amp;_[data-money-figure]]:text-fg');
    expect(off).toContain('data-money-figure');
    expect(textOf(off)).toContain('יותר ב־');
  });

  it('a gap passed as a node stays audible where it stands', () => {
    const html = render(h(MatchStrip, { ordered: 10, received: 7, billed: 10, unit: 'kg', off: 'received', gap: h('span', null, '3 kg short') }), 'en');
    expect(html).toMatch(/<span data-gap=""[^>]*>/);
    expect(html).not.toMatch(/aria-hidden="true" data-gap=""/);
    expect(html).toContain('aria-label="Ordered 10, Received 7, Billed 10 kg"');
  });

  it('neutral pills keep the clock of what is pending (T4); a neutral fact can take a dot', () => {
    const pending = render(h(StatusChip, { tone: 'neutral', label: 'ממתינה לשיוך' }));
    expect(pending).toContain('lucide-clock');
    expect(pending).not.toContain('data-dot');
    const fact = render(h(StatusChip, { tone: 'neutral', label: 'תקינה', icon: h(StatusDot, { tone: 'neutral', size: 'sm' }) }));
    expect(fact).toContain('data-dot="neutral"');
  });

  it('prices go through <Money>, per unit; a percentage gap is formatted', () => {
    const html = render(
      h(MatchStrip, { kind: 'price', ordered: 522.6, received: null, billed: 575, unit: 'חבית', off: 'billed', tone: 'warn', gap: { value: 0.1, kind: 'pct', direction: 'more' } }),
    );
    expect(html).toContain('data-money="cur"');
    expect(textOf(html)).toContain(formatIls(575, { maximumFractionDigits: 2 }));
    expect(textOf(html)).toContain('לחבית');
    expect(textOf(html)).toContain('10% יותר');
    // the price strip is one sentence too, prices through formatIls
    expect(html).toContain(`aria-label="הוזמן ${formatIls(522.6, { maximumFractionDigits: 2 })}, התקבל אין, חויב ${formatIls(575, { maximumFractionDigits: 2 })} לחבית, 10% יותר"`);
  });

  it('no gap without an off cell; the supplier letter names the third column "בחשבונית"', () => {
    const html = render(h(MatchStrip, { ordered: 1, received: 1, billed: 1, gap: { value: 1, kind: 'qty', direction: 'less' }, billedLabel: 'invoice' }));
    expect(html).not.toContain('data-gap');
    expect(textOf(html)).toContain('בחשבונית');
  });
});

describe('buttons and key caps (kit "כפתורים ומקשים", SPEC §5)', () => {
  it('DS3 heights: sm 32 · md 36 · lg 44 · xl 60 (the phone primary); coarse pointers keep 44', async () => {
    const { Button } = await import('../Button');
    expect(render(h(Button, { size: 'sm' }, 'x'))).toContain('min-h-8');
    const md = render(h(Button, {}, 'x'));
    expect(md).toContain('min-h-9');
    expect(md).toContain('[@media(pointer:coarse)]:min-h-11');
    expect(render(h(Button, { size: 'lg' }, 'x'))).toContain('min-h-11');
    const xl = render(h(Button, { size: 'xl' }, 'x'));
    expect(xl).toContain('min-h-[3.75rem]');
    expect(xl).toContain('text-lead'); // 18 px at 500, the reference's .ph-cta
    expect(md).toContain('font-medium');
  });

  it('the shortcut is written on the button, decorative, and announced as aria-keyshortcuts', async () => {
    const { Button, LinkButton } = await import('../Button');
    const primary = render(h(Button, { kbd: '1' }, 'בקשת זיכוי'));
    expect(primary).toContain('aria-keyshortcuts="1"');
    expect(primary).toMatch(/<kbd aria-hidden="true" data-kbd="" class="[^"]*bg-on-bold\/15[^"]*">1<\/kbd>/);
    expect(textOf(primary)).toBe('בקשת זיכוי1');
    const secondary = render(h(Button, { kbd: '2', variant: 'secondary' }, 'שלמו כפי שחויב'));
    expect(secondary).toMatch(/<kbd[^>]*class="[^"]*bg-surface-sunken[^"]*">2<\/kbd>/);
    expect(render(h(Button, {}, 'x'))).not.toContain('<kbd');
    expect(render(h(LinkButton, { href: '/x', kbd: 'G' }, 'x'))).toContain('aria-keyshortcuts="G"');
  });

  it('a key cap is never a dir="ltr" wrapper (ratchet N4) and uses the kbd type role', async () => {
    const { Kbd } = await import('../Kbd');
    const html = render(h(Kbd, {}, 'Ctrl K'));
    expect(html).not.toMatch(/dir=/);
    expect(html).toContain('text-kbd');
    expect(html).toContain('[direction:ltr]');
  });
});

describe('change against a previous period (kit "שינוי מול תקופה קודמת")', () => {
  it('colour by meaning: good is green, bad keeps ink words with a leak-coloured arrow, flat is grey', async () => {
    const { Delta } = await import('../money/Delta');
    const good = render(h(Delta, { current: 746, previous: 760, goodWhen: 'down', showPercent: true, about: 'בדליפה' }));
    expect(good).toContain('data-delta="good"');
    // good news is the T3 role (the recovered green, #00573B), never the action role (SPEC §2 correction of 14.11)
    expect(good).toMatch(/<span data-delta="good" class="[^"]*text-gold/);
    expect(good).not.toContain('text-primary');
    expect(textOf(good)).toContain('ירידה של');
    expect(textOf(good)).toContain('בדליפה');
    expect(textOf(good)).toContain(formatIls(14));
    const bad = render(h(Delta, { current: 846, previous: 760, goodWhen: 'down' }));
    expect(bad).toContain('data-delta="bad"');
    expect(bad).toMatch(/<span data-delta="bad" class="[^"]*text-fg[^"]*"/);
    expect(bad).toMatch(/<svg[^>]*class="[^"]*stroke-danger-dot/);
    // the amount itself is never red
    expect(bad.replace(/<svg[\s\S]*?<\/svg>/g, '')).not.toContain('text-danger');
    const flat = render(h(Delta, { current: 760, previous: 760, goodWhen: 'down' }));
    expect(flat).toContain('data-delta="flat"');
    expect(textOf(flat)).toBe('ללא שינוי');
  });

  it('a negligible change takes no colour, only when the screen sets the threshold', async () => {
    const { Delta } = await import('../money/Delta');
    const tiny = render(h(Delta, { current: 761, previous: 760, goodWhen: 'down', flatBelow: 0.02 }));
    expect(tiny).toContain('data-delta="flat"');
    expect(textOf(tiny)).toBe('ללא שינוי מהותי');
    expect(render(h(Delta, { current: 761, previous: 760, goodWhen: 'down' }))).toContain('data-delta="bad"');
  });
});

describe('where the amount comes from (kit "מאיפה הסכום")', () => {
  it('the formula with the real numbers, a source per number, the eye only for a scanned value', async () => {
    const { Calculation } = await import('../Calculation');
    const html = render(
      h(Calculation, {
        terms: ['3 ק״ג', h(Money, { value: 12.9, context: 'line', split: true })],
        result: h(Money, { value: 38.7, context: 'line', split: true, quietParts: false }),
        sources: [
          { value: '9.5 ק״ג', kind: 'scan', text: 'נקרא מהחשבונית, שורה 2' },
          { value: '6.5 ק״ג', kind: 'count', text: 'נספר בקבלה, 15.10.2026' },
        ],
      }),
    );
    expect(textOf(html)).toContain('3 ק״ג×');
    expect(textOf(html)).toContain('=');
    expect(textOf(html)).toContain(formatIls(38.7, { maximumFractionDigits: 2 }));
    expect(html).toContain('data-calc-source="scan"');
    expect(html).toContain('lucide-eye');
    expect((html.match(/lucide-eye/g) ?? []).length).toBe(1);
  });

  it('CalculationFold is closed on first render and names its panel', async () => {
    const { CalculationFold } = await import('../Calculation');
    const html = render(h(CalculationFold, { about: 'הפער בשורה', children: 'x' }));
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/<div id="[^"]+-panel" hidden="" aria-label="פירוט החישוב" role="group"/);
  });
});

describe('the credit-request track (kit "מסלול של בקשת זיכוי")', () => {
  it('one current step with aria-current and its action; states in words for screen readers', async () => {
    const { StatusRail } = await import('../StatusRail');
    const html = render(
      h(StatusRail, {
        label: 'מסלול הבקשה',
        steps: [
          { key: 'sent', label: 'נשלחה לספק', detail: '12.10.2026, בוואטסאפ', state: 'done' },
          { key: 'wait', label: 'ממתינה לתשובה', detail: '9 ימים בלי תשובה', state: 'now', action: h('button', null, 'שלחו תזכורת') },
          { key: 'ok', label: 'הספק אישר', state: 'todo', action: h('button', null, 'never') },
        ],
      }),
    );
    expect(html).toContain('<ol aria-label="מסלול הבקשה"');
    expect((html.match(/aria-current="step"/g) ?? []).length).toBe(1);
    expect(textOf(html)).toContain('שלחו תזכורת');
    expect(textOf(html)).not.toContain('never');
    expect(textOf(html)).toContain('· בוצע');
    expect(textOf(html)).toContain('· השלב הנוכחי');
    expect(html).toMatch(/data-rail-step="now"[^>]*><span aria-hidden="true" class="[^"]*bg-warn-dot[^"]*ring-4 ring-warn-subtle/);
    expect(html).toContain('border-warn-dot-ring');
  });
});

describe('an answer from the data (kit "תשובה מהנתונים")', () => {
  it('figures with their meaning, facts as grey pills, the tag and one action', async () => {
    const { DataAnswer } = await import('../DataAnswer');
    const html = render(
      h(DataAnswer, {
        question: 'כמה דלף החודש?',
        figures: [{ value: h(Money, { value: 760, context: 'tile' }), caption: 'דליפה מתחילת אוקטובר' }],
        facts: ['35 חשבוניות נבדקו'],
        action: h('a', { href: '/x' }, 'להחלטה'),
      }),
    );
    expect(html).toContain('<dt class="sr-only">דליפה מתחילת אוקטובר</dt>');
    expect(html).toContain('data-pill="neutral"');
    expect(textOf(html)).toContain('תשובה מהנתונים');
  });
});

describe('loading, empty, error (kit "טעינה, ריק, שגיאה")', () => {
  it('an empty state is calm and can sit inside a card; an error has no red and no icon', () => {
    const inline = render(h(EmptyStateComp, { kind: 'inbox-zero', title: 'אין פערים פתוחים', description: 'נבדקו 35 חשבוניות', variant: 'inline' }));
    expect(inline).not.toContain('rounded-card border');
    expect(inline).toContain('bg-ok-subtle text-ok');
    const error = render(h(EmptyStateComp, { kind: 'error', title: 'הסכום לא נטען' }));
    expect(error).not.toMatch(/danger/);
    expect(error).not.toContain('<svg');
    expect(render(h(EmptyStateComp, { title: 'ריק' }))).not.toMatch(/rounded-2xl|\/10\b/);
  });

  it('ErrorNotice says what is safe, offers one action, stays announced, never red', async () => {
    const { ErrorNotice } = await import('../EntitlementUpsell');
    const html = render(h(ErrorNotice, { title: 'הסכום לא נטען', safe: 'ההחלטות שכבר התקבלו שמורות.', action: h('button', null, 'נסו שוב') }));
    expect(html).toContain('role="alert"');
    expect(textOf(html)).toContain('ההחלטות שכבר התקבלו שמורות.');
    expect(html).not.toMatch(/danger/);
  });

  it('a delayed skeleton waits (SPEC §9: one second, on a DS3-00 motion token) before it fades in (CSS only, server-safe)', async () => {
    const { Skeleton } = await import('../Skeleton');
    const html = render(h(Skeleton, { variant: 'card', delayed: true }));
    expect(html).toContain('[@starting-style]:opacity-0');
    expect(html).toContain('[transition-delay:var(--dur-skeleton-wait,0ms)]');
    expect(render(h(Skeleton, { variant: 'card' }))).not.toContain('starting-style');
  });
});

describe('icons: Lucide plus four product glyphs, and the two-tone state (SPEC §6)', () => {
  it('at rest an icon is exactly the glyph (1.75 stroke, decorative)', async () => {
    const { Icon } = await import('../icon/Icon');
    const { Inbox } = await import('lucide-react');
    const html = render(h(Icon, { as: Inbox }));
    expect(html).toMatch(/^<svg[^>]*stroke-width="1.75"[^>]*aria-hidden="true"/);
    expect(html).not.toContain('data-icon-state');
  });

  it('active: stroke 2 and a filled copy underneath at .18, composited once; marked: .9', async () => {
    const { Icon } = await import('../icon/Icon');
    const { Inbox } = await import('lucide-react');
    const active = render(h(Icon, { as: Inbox, state: 'active' }));
    expect(active).toContain('data-icon-state="active"');
    expect(active).toMatch(/<svg[^>]*fill="currentColor" stroke="none"[^>]*style="opacity:0.18"/);
    expect(active).toContain('stroke-width="2"');
    expect(render(h(Icon, { as: Inbox, state: 'marked' }))).toContain('opacity:0.9');
  });

  it('the product glyphs carry their own fill layer and take --i-duo; the credit glyph mirrors in RTL', async () => {
    const { Icon } = await import('../icon/Icon');
    const { CreditGlyph, LeakGlyph, MatchGlyph, ReceiptGlyph } = await import('../icon/glyphs');
    const leak = render(h(Icon, { as: LeakGlyph, state: 'active' }));
    expect(leak).toContain('--i-duo:0.18');
    expect(leak).toContain('fill-opacity:var(--i-duo, 0)');
    expect(render(h(Icon, { as: CreditGlyph }))).toContain('rtl:-scale-x-100');
    for (const g of [MatchGlyph, ReceiptGlyph]) expect(render(h(Icon, { as: g, label: 'x' }))).toContain('role="img"');
  });
});

describe('tabs, filters and controls (kit "לשוניות ומסננים", SPEC §5)', () => {
  it('Tabs say their count also at zero, as a quiet number; the current tab has an ink underline', async () => {
    const { Tabs } = await import('../form/Tabs');
    const html = render(
      h(Tabs, {
        label: 'תצוגות',
        items: [
          { href: '?v=a', label: 'להחלטה', count: 4, current: true },
          { href: '?v=b', label: 'לבדיקה', count: 0 },
        ],
      }),
    );
    expect(textOf(html)).toContain('להחלטה4');
    expect(textOf(html)).toContain('לבדיקה0');
    expect(html).toMatch(/aria-current="page" class="[^"]*border-fg text-fg/);
    expect(html).toContain('[@media(pointer:coarse)]:min-h-11');
  });

  it('an active filter chip stays on screen with a remove button named after it', async () => {
    const { FilterChip } = await import('../form/FilterChip');
    const html = render(h(FilterChip, { label: 'ספק: ירקות השרון', active: true, onRemove: () => {} }));
    expect(html).toContain('aria-label="הסרת הסינון ספק: ירקות השרון"');
    expect(html).not.toContain('bg-primary-subtle');
  });

  it('Switch: role=switch, the row is its label, the state written beside it, no opacity when disabled', async () => {
    const { Switch } = await import('../form/Switch');
    const html = render(h(Switch, { checked: true, onCheckedChange: () => {}, label: 'קיצורים בתו אחד', hint: 'J ו־K לתנועה' }));
    expect(html).toMatch(/<label for="sw-[^"]+" data-switch=""/);
    expect(html).toContain('role="switch" aria-checked="true"');
    expect(html).toMatch(/aria-labelledby="sw-[^"]+-label" aria-describedby="sw-[^"]+-hint"/);
    expect(textOf(html)).toContain('פעיל');
    const off = render(h(Switch, { checked: false, disabled: true, onCheckedChange: () => {}, label: 'x' }));
    expect(off).not.toMatch(/opacity/);
    expect(textOf(off)).toContain('כבוי');
  });

  it('NumberField holds its limits and says them; steppers stop at the limits', async () => {
    const { NumberField } = await import('../form/NumberField');
    const html = render(h(NumberField, { value: 20, min: 0, max: 20, onValueChange: () => {}, label: 'סף כמות', unit: '%' }));
    expect(textOf(html)).toContain('בין 0 ל־20');
    expect(html).toMatch(/aria-label="הוספה"[^>]*disabled=""|disabled=""[^>]*aria-label="הוספה"/);
    expect(html).toMatch(/aria-describedby="nf-[^"]+-limits"/);
    expect(html).not.toMatch(/aria-valuemin/);
  });

  it('Tooltip is decorative, dark, with an optional key cap; the control keeps its own name', async () => {
    const { Tooltip } = await import('../Tooltip');
    const html = render(h(Tooltip, { label: 'הגדרות', kbd: 'G S' }, h('button', { 'aria-label': 'הגדרות' }, 'x')));
    expect(html).toMatch(/<span aria-hidden="true" class="invisible absolute/);
    expect(html).toContain('bg-fg');
    expect(html).toContain('group-hover/tip:[transition-delay:var(--dur-tooltip-rest,0ms)]');
    expect(html).toContain('<kbd');
  });
});

describe('charts (kit "גרפים", SPEC §10.1)', () => {
  it('pace line: both series span the same days on one scale, step after, never mirrored', async () => {
    const { PACE_BOX, pacePath, paceGeometry } = await import('../data-viz/PaceLine');
    // the reference's own drawing: a 2-point running total holds, then rises at the next day
    expect(pacePath([10, 20], 20)).toBe(`M0,${PACE_BOX.baseline} V33 H240 V2`);
    const g = paceGeometry({ cur: [0, 5, 5, 9], prev: [2, 4, 8, 12] });
    expect(g.end).toEqual({ x: PACE_BOX.width, y: 17.5 }); // 64 − 9/12 × 62: the larger series sets the scale
    expect(g.prev).toMatch(/H240 V2$/); // the previous period's same days reach the top at the right edge
    expect(paceGeometry({ cur: [3, 7], prev: null }).prev).toBeNull();
    // nothing below the baseline, nothing above the box, even for a correction
    expect(pacePath([4, -2], 4)).toBe(`M0,${PACE_BOX.baseline} V2 H240 V${PACE_BOX.baseline}`);
  });

  it('pace line: one figure named by its sentence, the drawing hidden, the legend readable; entry parts for the home', async () => {
    const { PaceLine } = await import('../data-viz/PaceLine');
    const html = render(h(PaceLine, { series: { cur: [0, 4, 9], prev: [1, 5, 11] }, curLabel: 'אוקטובר', prevLabel: 'ספטמבר, אותם ימים', label: 'הדליפה המצטברת מול אותם ימים בספטמבר', testId: 'pace' }));
    expect(html).toMatch(/^<figure aria-label="הדליפה המצטברת מול אותם ימים בספטמבר" data-pace-line="" data-testid="pace"/);
    expect(html).toMatch(/<svg viewBox="-2 -6 250 78"[^>]*aria-hidden="true"/);
    expect(textOf(html)).toBe('אוקטוברספטמבר, אותם ימים');
    for (const part of ['fade', 'draw', 'pop']) expect(html).toContain(`data-entry-part="${part}"`);
    expect(html).toContain('pathLength="1"');
    expect(html).not.toMatch(/#[0-9a-f]{3,6}\b/i); // colours are roles
    // no previous period: no dashed line and no legend for it
    const alone = render(h(PaceLine, { series: { cur: [0, 4, 9], prev: null }, curLabel: 'אוקטובר', prevLabel: 'ספטמבר, אותם ימים', label: 'x' }));
    expect(alone).not.toContain('data-entry-part="fade"');
    expect(textOf(alone)).toBe('אוקטובר');
  });

  it('split bar: the leak indicator solid, the second part hatched (pattern, not only colour), decorative unless named', async () => {
    const { SplitBar } = await import('../data-viz/SplitBar');
    const html = render(h(SplitBar, { first: 296, second: 464 }));
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('role="img"');
    expect(html).toContain('bg-danger-dot');
    expect(html).toContain('repeating-linear-gradient(135deg,rgb(var(--c-danger-dot))');
    expect(html.match(/forced-color-adjust-none/g)).toHaveLength(2);
    expect(html).toContain('flex-grow:296');
    const named = render(h(SplitBar, { first: 1, second: 0, label: 'שולם במלואו' }));
    expect(named).toContain('role="img" aria-label="שולם במלואו"');
    expect(named.match(/<i /g)).toHaveLength(1); // an empty part is not drawn
  });
});

describe('handoff corrections (CHANGES.md 14.11, DS3-01)', () => {
  it('radii: the phone-flow button has 12 px corners; icons 16 in content, 18 in the top bar', async () => {
    const { Button } = await import('../Button');
    const { Icon } = await import('../icon/Icon');
    const { Check } = await import('lucide-react');
    expect(render(h(Button, { size: 'xl' }, 'אישור: 24 ק״ג'))).toContain('rounded-card');
    expect(render(h(Icon, { as: Check }))).toContain('h-4 w-4');
    expect(render(h(Icon, { as: Check, size: 'bar' }))).toContain('size-[1.125rem]');
  });

  it("a card's border is --rule (MetricTile, the region empty state)", async () => {
    const { MetricTile } = await import('../money/MetricTile');
    expect(render(h(MetricTile, { label: 'דליפה החודש', value: 760 }))).toContain('border-line-rule');
    expect(render(h(EmptyStateComp, { kind: 'inbox-zero', title: 'אין פערים פתוחים' }))).toContain('rounded-card border border-line-rule');
  });

  it('wording: never a singular imperative; "הכול" spelled in full', async () => {
    const { he: viewsHe } = await import('../../i18n/messages/views/he');
    const { he: commonHe } = await import('../../i18n/messages/common/he');
    expect(viewsHe.toolbar.clearFilters).toBe('ניקוי הסינון');
    expect(viewsHe.toolbar).toMatchObject({ apply: 'החלה', save: 'שמירה', delete: 'מחיקה', reset: 'איפוס תצוגה' });
    expect(JSON.stringify(commonHe)).not.toMatch(/הכל(?!ו)/);
  });
});

describe("DS3-03's requests to the shared components", () => {
  it('Delta from a change computed upstream (agorot-exact, its own percent rule), the SPEC sentence', async () => {
    const { Delta } = await import('../money/Delta');
    const down = render(h(Delta, { change: { agorot: -1400, share: -0.02 }, goodWhen: 'down', showPercent: true, about: 'לעומת אותם ימים בספטמבר' }));
    expect(down).toContain('data-delta="good"');
    expect(textOf(down)).toContain('ירידה של');
    expect(textOf(down)).toContain(formatIls(14));
    expect(textOf(down)).toContain('(2%)');
    expect(textOf(down)).toContain('לעומת אותם ימים בספטמבר');
    // a thin base quotes no percent; a rise in leak keeps its words and ₪ in ink, only the arrow is red
    const up = render(h(Delta, { change: { agorot: 5000, share: null }, goodWhen: 'down', showPercent: true }));
    expect(up).toContain('data-delta="bad"');
    expect(textOf(up)).not.toContain('%');
    expect(up).toMatch(/<svg[^>]*class="[^"]*stroke-danger-dot/);
    expect(up).not.toMatch(/text-danger(?!-dot)/);
  });

  it('TaskRow carries the decision row\'s blocking count (the one solid pill, apart from the count line)', async () => {
    const { taskRow } = await import('../notifications/rows');
    const task = { type: 'decision', tone: 'danger', deepLink: '/dashboard/approvals', ilsAgorot: 76000, count: 7, blocking: 3, detail: {}, entityId: 'x' };
    const t = ((k: string) => k) as never;
    const row = taskRow(task as never, t, 'he', (a: number) => String(a));
    expect(row?.blocking).toBe(3);
    const other = taskRow({ ...task, type: 'claim_to_send', blocking: 0 } as never, t, 'he', (a: number) => String(a));
    expect(other).not.toHaveProperty('blocking');
  });

  it('request 9: the small button is 32 px with 13 px text at 500 (DS3-00\'s sub role), LinkButton too', async () => {
    const { Button, LinkButton } = await import('../Button');
    for (const html of [render(h(Button, { size: 'sm' }, 'x')), render(h(LinkButton, { href: '/x', size: 'sm' }, 'x'))]) {
      expect(html).toContain('min-h-8');
      expect(html).toContain('text-sub');
      expect(html).toContain('font-medium');
      expect(html).not.toContain('text-body-sm');
    }
    // the other sizes keep their roles
    expect(render(h(Button, {}, 'x'))).toContain('text-body-sm');
  });

  it('request 5: Money context="display" is the home hero on the money-hero role, ₪ in its glyph span, whole shekels', () => {
    const html = render(h(Money, { value: 759.54, context: 'display' }));
    expect(html).toContain('text-money-hero');
    expect(html).not.toContain('text-metric-hero');
    expect(html).toContain('<span class="money-glyph">₪</span>');
    expect(textOf(html)).toBe(formatIls(759.54, { maximumFractionDigits: 0 }));
    expect(html).toMatch(/title="סכום מדויק: [^"]*759\.54/);
    // `hero` keeps metric-hero for the screens that use it today
    expect(render(h(Money, { value: 760, context: 'hero' }))).toContain('text-metric-hero');
  });

  it('DeltaBadge: a good change in the T3 role, a bad one in ink with the leak-coloured arrow', async () => {
    const { DeltaBadge } = await import('../views/DeltaBadge');
    const good = render(h(DeltaBadge, { current: 80, previous: 100, compare: 'prev' }));
    expect(good).toContain('text-gold');
    expect(good).not.toContain('text-primary');
    const bad = render(h(DeltaBadge, { current: 120, previous: 100, compare: 'prev' }));
    expect(bad).toContain('text-fg');
    expect(bad).toMatch(/stroke-danger-dot/);
  });
});

describe("DS3-00's requests to the shared components (PR #346, request 3)", () => {
  const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

  it('floating layers rest on sh2 with the flyout\'s --rule ring, never the card shadow and a border (SPEC §4)', () => {
    for (const file of ['views/ViewToolbar.tsx', 'PageHeader.tsx', 'notifications/Bell.tsx', 'table/Popover.tsx', 'overlay/RowActions.tsx']) {
      const src = read(file);
      expect(src, file).toContain('ring-1 ring-line-rule');
      expect(src, file).not.toMatch(/border border-line bg-surface p-\d shadow-(card|e2)/);
      expect(src, file).not.toContain('shadow-card');
    }
    // the views toolbar's phone sheet: 16 px top corners, sh2, no border
    expect(read('views/ViewToolbar.tsx')).toContain('rounded-t-overlay bg-surface p-0 text-ink shadow-e3');
  });

  it('one focus indicator: no component adds a focus ring beside the global outline', () => {
    const owned = ['views/ViewToolbar.tsx', 'views/TvMode.tsx', 'PageHeader.tsx', 'notifications/Bell.tsx', 'Breadcrumbs.tsx', 'Toast.tsx'];
    for (const file of owned) expect(read(file), file).not.toMatch(/focus-visible:ring-|focus-visible:outline-on-bold/);
  });

  it('focus inside scroll containers is drawn inward; on the dark toast it is white (DS3-00 hooks)', () => {
    expect(read('table/DataTable.tsx')).toContain('data-focus="inset"');
    expect(read('table/Popover.tsx')).toContain('data-focus="inset"');
    expect(read('Toast.tsx')).toContain('data-focus="on-dark"');
  });

  it('menus, rows and quiet icon buttons hover on --hover', () => {
    for (const file of ['overlay/RowActions.tsx', 'overlay/Sheet.tsx', 'money/Token.tsx', 'views/BreakdownChart.tsx']) {
      const src = read(file);
      expect(src, file).toContain('hover:bg-surface-hover');
      expect(src, file).not.toMatch(/hover:bg-surface-(2|sunken)\b/);
    }
  });

  it('a card has 12 px corners and the --rule border (D6, SPEC §4)', async () => {
    const { Card } = await import('../Card');
    const html = render(h(Card, null, 'x'));
    expect(html).toContain('rounded-card');
    expect(html).toContain('border-line-rule');
    expect(html).not.toContain('rounded-2xl');
    // tones keep their own edge
    expect(render(h(Card, { tone: 'warn' }, 'x'))).toContain('border-warn/40');
  });
});

describe('review fixes (accessibility of the shared components)', () => {
  it('forced colours: every button and the toast keep a 1 px ButtonText edge; a checked segment an outline', async () => {
    const { Button } = await import('../Button');
    for (const variant of ['primary', 'secondary', 'ghost', 'danger']) {
      expect(render(h(Button, { variant }, 'x')), variant).toContain('forced-colors:border-[color:ButtonText]');
    }
    const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
    expect(read('Toast.tsx')).toMatch(/bg-fg [^"]*forced-colors:border-\[color:ButtonText\]/);
    const { SegmentedControl } = await import('../form/SegmentedControl');
    const seg = render(h(SegmentedControl, { label: 'צפיפות', value: 'a', onChange: () => {}, options: [{ value: 'a', label: 'רגיל' }, { value: 'b', label: 'צפוף' }] }));
    expect(seg).toMatch(/aria-checked="true"[^>]*forced-colors:outline-\[color:Highlight\]/);
    expect(seg).not.toMatch(/aria-checked="false"[^>]*forced-colors:outline/);
  });

  it('a phone keeps the 44 px target on the segmented control; the switch track is 44 × 26 (SPEC §5), also on a phone', async () => {
    const { SegmentedControl } = await import('../form/SegmentedControl');
    for (const size of ['sm', 'md']) {
      const seg = render(h(SegmentedControl, { label: 'x', value: 'a', size, onChange: () => {}, options: [{ value: 'a', label: 'א' }, { value: 'b', label: 'ב' }] }));
      expect(seg, size).toContain('[@media(pointer:coarse)]:min-h-11');
    }
    const { Switch } = await import('../form/Switch');
    const sw = render(h(Switch, { label: 'התראות', checked: true, onCheckedChange: () => {} }));
    expect(sw).toMatch(/role="switch"[^>]*class="[^"]*h-\[1\.625rem\] min-h-\[1\.625rem\] w-11 [^"]*p-\[3px\]/);
  });

  it('NumberField: `label` names the input itself, not only the group', async () => {
    const { NumberField } = await import('../form/NumberField');
    const html = render(h(NumberField, { label: 'סף כמות', value: 5, min: 0, max: 20, onValueChange: () => {} }));
    expect(html).toMatch(/<input[^>]*aria-label="סף כמות"/);
  });

  it('where the amount comes from: the operator and the equals sign are read, not hidden', async () => {
    const { Calculation } = await import('../Calculation');
    const html = render(h(Calculation, { terms: ['3 ק״ג', '12.90'], operator: 'times', result: '38.70' }));
    expect(html).not.toMatch(/aria-hidden="true"[^>]*>(×|=)</);
    expect(html).toMatch(/>×</);
    expect(html).toMatch(/>=</);
  });

  it('Delta: the percent sits after a space outside its isolate, never glued to the ₪', async () => {
    const { Delta } = await import('../money/Delta');
    const html = render(h(Delta, { current: 746, previous: 760, goodWhen: 'down', showPercent: true }));
    expect(html).toMatch(/<bdi class="whitespace-nowrap"><span class="num">\([^)]*%\)<\/span><\/bdi>/);
    expect(html).not.toMatch(/<bdi[^>]*>\s+\(/);
    // `bdi.num` is the money figure (W1-01 reads every one for a ₪ left of the digits): none here lacks a ₪
    const figures = html.match(/<bdi class="num[^"]*"[^>]*>[\s\S]*?<\/bdi>/g) ?? [];
    expect(figures.length).toBeGreaterThan(0);
    for (const f of figures) expect(f, f).toContain('₪');
    const count = render(h(Delta, { current: 12, previous: 10, goodWhen: 'down', kind: 'count', showPercent: true }));
    expect(count.match(/<bdi class="num/g) ?? []).toHaveLength(0);
  });

  it('the credit-request track keeps its markers in forced colours (like the dots)', () => {
    const src = readFileSync(new URL('../StatusRail.tsx', import.meta.url), 'utf8');
    expect(src).toContain('size-2.5 rounded-full forced-color-adjust-none');
  });
});

describe('review fixes (fidelity to the reference)', () => {
  const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

  it('the number pad types from a hardware keyboard: digits, "." or "," for the point, Backspace; never a combination', async () => {
    const { keypadKeyOf } = await import('../overlay/QtyKeypad');
    expect(keypadKeyOf({ key: '7' })).toBe('7');
    expect(keypadKeyOf({ key: '.' })).toBe('.');
    expect(keypadKeyOf({ key: ',' })).toBe('.');
    expect(keypadKeyOf({ key: 'Backspace' })).toBe('del');
    expect(keypadKeyOf({ key: 'a' })).toBeNull();
    expect(keypadKeyOf({ key: 'Enter' })).toBeNull();
    expect(keypadKeyOf({ key: '5', ctrlKey: true })).toBeNull();
    expect(keypadKeyOf({ key: '5', metaKey: true })).toBeNull();
  });

  it('the quantity sheet is as tall as its content, on sh2 without a border, its title on the DS3 role', async () => {
    const { Sheet } = await import('../overlay/Sheet');
    const html = render(h(Sheet, { open: true, onClose: () => {}, title: 'כמה הגיע?', detent: 'auto' }, 'x'));
    expect(html).toContain('data-detent="auto"');
    expect(html).toContain('max-h-[calc(100dvh-0.75rem)]');
    expect(html).not.toMatch(/h-\[(92|50)dvh\]/);
    expect(html).not.toMatch(/<dialog[^>]*border-line/);
    expect(html).toMatch(/<h2[^>]*class="text-title-sm/);
    expect(read('overlay/QtyKeypad.tsx')).toContain('detent="auto"');
  });

  it('the top-bar bell: 32 × 32 at the desk, 44 under 1024 or on touch, an 18 px glyph, an ink dot and never a count; a 384 px panel', () => {
    const src = read('notifications/Bell.tsx');
    // The sidebar spec is binding on sizes (DS3 SPEC §10.4): §1.5 32 × 32, §11 44 × 44 under 1024; DS3 SPEC §5 44 px touch target.
    expect(src).toMatch(/data-testid="bell-trigger"[\s\S]{0,700}className="relative inline-flex size-8 [^"]*max-lg:size-11 \[@media\(pointer:coarse\)\]:size-11"/);
    expect(src).not.toMatch(/\bsize-9\b/);
    expect(src).toContain('<Icon as={BellIcon} size="bar" />');
    // The dot keeps its place beside the glyph at every box size: 2 px outside the 18 px glyph's corner.
    expect(src).toMatch(/data-testid="bell-dot"\s+className="absolute end-\[calc\(50%-11px\)\] top-\[calc\(50%-11px\)\] size-2 rounded-full bg-fg ring-2 ring-surface/);
    // §1.6: the desk panel is 384 wide (and still never wider than the window).
    expect(src).toContain('w-[384px] max-w-[calc(100vw-2rem)]');
    expect(src).not.toContain('w-[360px]');
    expect(src).not.toMatch(/bell-dot[\s\S]{0,400}\{cappedCount/);
    // the number is still said: it is part of the trigger's name
    expect(src).toMatch(/const label = unseen > 0 \? `\$\{t\('bell\.label'\)\}, \$\{t\('bell\.unseen', \{ count: cappedCount\(unseen, locale\) \}\)\}`/);
  });

  it('the desk panel sits below-end of the bell (sidebar SPEC §1.6), whole and inside the window', () => {
    // Hebrew: the end edge is the left, and the panel's end edge lands on the bell's.
    expect(bellPanelEnd({ left: 170, right: 202 }, 1440, true)).toBe(170);
    // English: the end edge is the right.
    expect(bellPanelEnd({ left: 1238, right: 1270 }, 1440, false)).toBe(170);
    // Never closer than 16 px to the window's edge.
    expect(bellPanelEnd({ left: 4, right: 36 }, 1440, true)).toBe(16);
    // A bell far from the end still leaves the 384 px panel whole.
    expect(bellPanelEnd({ left: 900, right: 932 }, 1100, true)).toBe(1100 - 16 - 384);
    // A window narrower than the panel: it fills the window less the two gutters.
    expect(bellPanelEnd({ left: 300, right: 332 }, 400, true)).toBe(16);
    // The component places it before it shows (no jump) and again when the window resizes.
    const src = read('notifications/Bell.tsx');
    expect(src).toMatch(/place\(\);\s+d\.showModal\(\);/);
    expect(src).toContain("window.addEventListener('resize', place)");
    expect(src).toContain('anchor={trigger}');
  });

  it('a figure that failed to load offers its one action when there is one; otherwise the words stay', () => {
    const plain = render(h(Money, { value: null, unavailable: true }));
    expect(textOf(plain)).toBe('לא זמין · נסו שוב');
    expect(plain).not.toContain('<button');
    const withRetry = render(h(Money, { value: null, unavailable: true, onRetry: () => {} }));
    expect(textOf(withRetry)).toBe('לא זמין, נסו שוב');
    expect(withRetry).toMatch(/<button type="button" class="[^"]*min-h-6[^"]*">נסו שוב<\/button>/);
    expect(textOf(render(h(Money, { value: null, unavailable: true, onRetry: () => {} }), 'en'))).toBe('Unavailable, try again');
  });

  it('the views toolbar: its switches are the kit\'s segmented control, its buttons the small secondary, its filters pills', () => {
    const src = read('views/ViewToolbar.tsx');
    expect(src).toContain("on ? 'bg-surface text-fg shadow-e1 ring-1 ring-inset ring-fg");
    expect(src).toContain('className="inline-flex rounded-control bg-surface-sunken p-0.5"');
    expect(src).toContain('min-h-8 items-center gap-1.5 rounded-control border border-line-strong bg-surface px-3 text-sub');
    expect(src).toContain('rounded-pill');
    expect(src).not.toMatch(/bg-primary\/15|border-primary\/40 text-primary/);
    expect(src).not.toMatch(/\bcn\(chip/);
  });

  it('cards rest on sh1; the calculation opens in a 12 px --rule panel; the tooltip fades on its named duration', async () => {
    const { Card } = await import('../Card');
    expect(render(h(Card, null, 'x'))).toContain('shadow-e1');
    expect(render(h(Card, { elevated: true }, 'x'))).toContain('data-elevated="true"');
    expect(read('Calculation.tsx')).toContain('rounded-card border border-line-rule bg-surface p-3');
    expect(read('Tooltip.tsx')).toContain('duration-menu-tooltip');
  });
});

describe('review fixes (correctness)', () => {
  it('no time value outside the tokens: no delay from Tailwind\'s default scale in the shared components', async () => {
    const { readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const root = new URL('..', import.meta.url).pathname;
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (name === '__tests__' || name === 'node_modules' || (dir.replace(/\/$/, '') === root.replace(/\/$/, '') && ['palette', 'hero', 'desk'].includes(name))) continue;
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name)) files.push(p);
      }
    };
    walk(root);
    const offScale = files.filter((f) => /\bdelay-(75|100|150|200|300|500|700|1000)\b/.test(readFileSync(f, 'utf8')));
    expect(offScale).toEqual([]);
  });

  it('a change shown as ₪0 is no change: never "עלייה של ₪0" with an arrow; the basis stays in the sentence', async () => {
    const { Delta } = await import('../money/Delta');
    const tiny = render(h(Delta, { change: { agorot: 40, share: null }, goodWhen: 'down' }));
    expect(tiny).toContain('data-delta="flat"');
    expect(textOf(tiny)).toBe('ללא שינוי מהותי');
    expect(textOf(tiny)).not.toContain('₪0');
    const tinyAbout = render(h(Delta, { change: { agorot: -49, share: -0.001 }, goodWhen: 'down', about: 'לעומת אותם ימים בספטמבר' }));
    expect(textOf(tinyAbout)).toBe('ללא שינוי מהותי לעומת אותם ימים בספטמבר');
    // shekel figures: under half a shekel rounds to ₪0 inline
    expect(render(h(Delta, { current: 100.3, previous: 100, goodWhen: 'down' }))).toContain('data-delta="flat"');
    // from half a shekel the change shows, as before
    const half = render(h(Delta, { change: { agorot: 50, share: null }, goodWhen: 'down' }));
    expect(half).toContain('data-delta="bad"');
    expect(textOf(half)).toContain('עלייה של');
    // no change at all keeps its own words, with the basis
    expect(textOf(render(h(Delta, { current: 5, previous: 5, about: 'בדליפה' })))).toBe('ללא שינוי בדליפה');
    // counts and percents are not money: a small count change still shows
    expect(render(h(Delta, { current: 1, previous: 0, kind: 'count', goodWhen: 'up' }))).toContain('data-delta="good"');
  });

  it('NumberField: leaving an unedited field saves nothing; the arrows and steppers start from what is typed', async () => {
    const { blurAction, fieldNumber } = await import('../form/NumberField');
    // a stored 2.5 shown as "3" (0 decimals), or a stored 25 above max: untouched, nothing is committed
    expect(blurAction('3', '3', 0)).toEqual({ kind: 'none' });
    expect(blurAction('25', '25', 0)).toEqual({ kind: 'none' });
    expect(blurAction('abc', '3', 0)).toEqual({ kind: 'reset' });
    expect(blurAction('', '3', 0)).toEqual({ kind: 'reset' });
    expect(blurAction('4', '3', 0)).toEqual({ kind: 'commit', n: 4 });
    expect(blurAction('2,5', '3', 1)).toEqual({ kind: 'commit', n: 2.5 });
    expect(fieldNumber('7', 3, 0)).toBe(7);
    expect(fieldNumber('7.5', 3, 1)).toBe(7.5);
    expect(fieldNumber('x', 3, 0)).toBe(3);
    const src = readFileSync(new URL('../form/NumberField.tsx', import.meta.url), 'utf8');
    expect(src).not.toMatch(/commit\(value [+-] step\)/);
    expect(src.match(/commit\(base\(\) [+-] step\)/g)).toHaveLength(4);
  });

  it("the quantity sheet names the item also when nothing was ordered (an arrival that wasn't on the order)", async () => {
    const { QtyKeypad } = await import('../overlay/QtyKeypad');
    const noop = () => {};
    const named = render(h(QtyKeypad, { open: true, onClose: noop, onConfirm: noop, name: 'עגבניות שרי', unit: 'ק״ג' }));
    expect(textOf(named)).toContain('עגבניות שרי');
    const ordered = render(h(QtyKeypad, { open: true, onClose: noop, onConfirm: noop, name: 'עגבניות שרי', unit: 'ק״ג', ordered: 6.5 }));
    expect(textOf(ordered)).toContain('עגבניות שרי');
    expect(textOf(ordered)).toContain('6.5');
  });
});

describe("DS3-07's requests: digits that line up or change in place are tabular in any face; no measure in ch", () => {
  const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

  it('identifiers, deadlines and tile context render in tabular figures', async () => {
    const { Token } = await import('../money/Token');
    const { MetricTile } = await import('../money/MetricTile');
    expect(render(h(Token, { value: 'ST-24108', kind: 'invoice' }))).toMatch(/<bdi dir="ltr" class="[^"]*tabular-nums/);
    expect(render(h(DeadlineChip, { due: '2026-12-12', today: new Date('2026-11-21T09:00:00+02:00') }))).toContain('tabular-nums');
    expect(render(h(MetricTile, { label: 'דליפה החודש', value: 760, context: '35 חשבוניות נבדקו' }))).toMatch(/<p class="[^"]*tabular-nums[^"]*">35 חשבוניות נבדקו/);
  });

  it('the table, the batch bar, the change badge, the phone cards, the bell and the pad keep their digits in place', () => {
    const table = read('table/DataTable.tsx');
    expect(table).toContain('<p data-table-showing className="tabular-nums">');
    expect(table).toContain("c.kind === 'date' && 'tabular-nums'");
    expect(table).toMatch(/bg-surface px-\[var\(--cell-px,16px\)\] tabular-nums',\s*c\.identity/);
    expect(read('table/BatchBar.tsx')).toContain('<span data-batch-count className="tabular-nums">');
    expect(read('views/DeltaBadge.tsx')).toContain('<span className="tabular-nums">{text}</span>');
    expect(read('table/MobileCardList.tsx')).toContain('text-sm tabular-nums text-muted');
    expect(read('KpiCard.tsx')).toContain('<p className="text-xs tabular-nums text-muted">{subtitle}</p>');
    expect(read('StatCard.tsx')).toContain('<p className="mt-1 text-xs tabular-nums text-muted">{hint}</p>');
    expect(read('notifications/Bell.tsx').match(/tabular-nums text-(muted|primary)/g)).toHaveLength(2);
    expect(read('overlay/QtyKeypad.tsx')).toContain('<span className="tabular-nums">');
  });

  it('no reading measure or size in ch or ex in the shared components (they differ between the fallback and the face)', async () => {
    const { readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const root = new URL('..', import.meta.url).pathname;
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (name === '__tests__' || name === 'node_modules' || (dir.replace(/\/$/, '') === root.replace(/\/$/, '') && ['palette', 'hero', 'desk'].includes(name))) continue;
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name)) files.push(p);
      }
    };
    walk(root);
    const offenders = files.filter((f) => /max-w-prose|\[[0-9.]+(ch|ex)\]/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
