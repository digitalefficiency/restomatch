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
import { EmptyState as EmptyStateComp } from '../EmptyState';
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
      expect(html).toMatch(/<span data-money="dec" class="text-fg-tertiary">\.80<\/span>/);
      expect(html).toContain('max(0.74em,var(--fs-caption))');
      expect(html).not.toMatch(/dir=/);
    }
  });

  it('split: whole shekels have no agorot span; a coloured figure keeps one colour', () => {
    const tile = render(h(Money, { value: 760, context: 'tile', split: true }));
    expect(tile).toContain('data-money="cur"');
    expect(tile).not.toContain('data-money="dec"');
    const green = render(h(Money, { value: 296, context: 'line', state: 'claimed', split: true }));
    expect(green).toContain('text-primary');
    expect(green).not.toContain('text-fg-tertiary');
    expect(render(h(Money, { value: 296, context: 'line', split: true, quietParts: false }))).not.toContain('text-fg-tertiary');
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
  it('DS3 heights: sm 32 · md 36 · lg 44 · xl 56; coarse pointers keep 44', async () => {
    const { Button } = await import('../Button');
    expect(render(h(Button, { size: 'sm' }, 'x'))).toContain('min-h-8');
    const md = render(h(Button, {}, 'x'));
    expect(md).toContain('min-h-9');
    expect(md).toContain('[@media(pointer:coarse)]:min-h-11');
    expect(render(h(Button, { size: 'lg' }, 'x'))).toContain('min-h-11');
    expect(render(h(Button, { size: 'xl' }, 'x'))).toContain('min-h-14');
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
    expect(good).toContain('text-primary');
    expect(textOf(good)).toContain('ירידה של');
    expect(textOf(good)).toContain('בדליפה');
    expect(textOf(good)).toContain(formatIls(14));
    const bad = render(h(Delta, { current: 846, previous: 760, goodWhen: 'down' }));
    expect(bad).toContain('data-delta="bad"');
    expect(bad).toMatch(/<span data-delta="bad" class="[^"]*text-fg[^"]*"/);
    expect(bad).toMatch(/<svg[^>]*class="[^"]*text-danger/);
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
    expect(html).toContain('bg-warn-bold');
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
    expect(inline).toContain('bg-primary-subtle');
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

  it('a delayed skeleton waits a second before it fades in (CSS only, server-safe)', async () => {
    const { Skeleton } = await import('../Skeleton');
    const html = render(h(Skeleton, { variant: 'card', delayed: true }));
    expect(html).toContain('[@starting-style]:opacity-0');
    expect(html).toContain('delay-1000');
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
