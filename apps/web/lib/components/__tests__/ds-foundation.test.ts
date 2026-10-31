import './reactGlobal';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { formatIls } from '../../money';
import { I18nProvider } from '../../i18n/client';
import type { Locale } from '../../i18n/config';
import { consentPlacement } from '../../cookieConsent';
import { Button } from '../Button';
import { EmptyState } from '../EmptyState';
import { Field, Input } from '../Input';
import { Skeleton } from '../Skeleton';
import { Spinner } from '../Spinner';
import { TOAST_MAX, toastDuration } from '../Toast';
import { StatusChip, CountBadge } from '../feedback/StatusChip';
import { creepStep } from '../data-viz/palette';
import { Money } from '../money/Money';
import { daysUntil, deadlineTone, exactText, formatDay, MONEY_DECIMALS, splitGlyph, stateClass } from '../money/format';
import { formatDateField, monthGrid, normalizeDecimal, parseDateInput, parseMoneyInput, parseQuantityInput } from '../form/parse';

// Loosely typed createElement: two @types/react majors are hoisted in the workspace (STATE.md).
const h = createElement as unknown as (type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]) => ReactElement;
const render = (el: ReactElement, locale: Locale = 'he') => renderToStaticMarkup(h(I18nProvider, { locale }, el));
/** Text content of a rendered fragment: characters outside tags (entities decoded enough for ₪ strings). */
function textOf(html: string): string {
  let out = '';
  let inTag = false;
  for (const ch of html) {
    if (ch === '<') inTag = true;
    else if (ch === '>') inTag = false;
    else if (!inTag) out += ch;
  }
  return out.split('&nbsp;').join('\u00A0');
}

const VALUES = [0, 0.5, 1, 7.5, 12.34, 99.99, 104.8, 522.6, 575, 759.54, 1000, 1240, 1759.5, 3571, 13474, 99999.99, 125050.5, 1234567.89, 0.01, 42];

describe('<Money> renders formatIls() output unchanged (acceptance 4)', () => {
  for (const locale of ['he', 'en'] as const) {
    for (const [context, dp] of [
      ['tile', 0],
      ['line', 2],
    ] as const) {
      it(`${locale} · ${dp} dp · 20 values`, () => {
        for (const value of VALUES) {
          const html = render(h(Money, { value, context }), locale);
          expect(textOf(html)).toBe(formatIls(value, { maximumFractionDigits: dp, locale }));
        }
      });
    }
  }

  it('is a plain <bdi> with no dir attribute, Heebo tabular (.num), never mono', () => {
    const html = render(h(Money, { value: 760, context: 'tile' }));
    expect(html).toContain('<bdi class="num');
    expect(html).not.toMatch(/dir=/);
    expect(html).not.toContain('font-mono');
  });

  it('hero splits the glyph into its own span without changing the text', () => {
    const html = render(h(Money, { value: 759.54, context: 'hero' }));
    expect(textOf(html)).toBe(formatIls(759.54, { maximumFractionDigits: 0 }));
    expect(html).toContain('<span class="money-glyph">₪</span>');
    expect(html).toMatch(/title="סכום מדויק: [^"]*759\.54/);
  });

  it('agorot input, precision by context, credit word, unknown is never ₪0', () => {
    expect(textOf(render(h(Money, { agorot: 125050, context: 'line' })))).toBe(formatIls(1250.5, { maximumFractionDigits: 2 }));
    expect(textOf(render(h(Money, { value: 12.3456, context: 'unit' })))).toBe(formatIls(12.3456, { maximumFractionDigits: 4 }));
    expect(textOf(render(h(Money, { value: -120, context: 'inline', credit: true })))).toBe(`זיכוי${formatIls(120)}`);
    expect(textOf(render(h(Money, { value: null })))).toBe('לא זמין · נסו שוב');
    expect(textOf(render(h(Money, { value: undefined }), 'en'))).toBe('Unavailable · try again');
    expect(textOf(render(h(Money, { value: null, pending: true })))).toBe('ממתין');
  });

  it('₪0 never takes danger; money states map to the A9 colours', () => {
    expect(stateClass('leak', 0)).toBe('text-muted');
    expect(stateClass('outstanding', 1759)).toBe('text-ink');
    expect(stateClass('caught', 296)).toBe('text-gold');
    expect(stateClass('claimed', 10)).toBe('text-primary');
    expect(render(h(Money, { value: 0, state: 'leak' }))).not.toContain('danger');
  });

  it('helpers', () => {
    expect(MONEY_DECIMALS).toEqual({ hero: 0, tile: 0, inline: 0, line: 2, unit: 4 });
    expect(exactText(760, 0, 'he')).toBeNull();
    expect(exactText(759.54, 2, 'he')).toBeNull();
    expect(splitGlyph('₪1,234')).toEqual([
      { glyph: true, text: '₪' },
      { glyph: false, text: '1,234' },
    ]);
  });
});

describe('deadlines and dates', () => {
  const today = new Date(2026, 9, 25);
  it('tone: neutral > 7 days, warn ≤ 7, danger only when late', () => {
    expect(deadlineTone(daysUntil(new Date(2026, 10, 10), today))).toBe('neutral');
    expect(deadlineTone(daysUntil(new Date(2026, 9, 31), today))).toBe('warn');
    expect(deadlineTone(daysUntil(new Date(2026, 9, 25), today))).toBe('warn');
    expect(deadlineTone(daysUntil(new Date(2026, 9, 20), today))).toBe('danger');
  });
  it('formatDay is dd.MM.yyyy in Hebrew whatever the runtime locale', () => {
    expect(formatDay('2026-10-01T12:00:00Z', 'he')).toBe('01.10.2026');
    expect(formatDay('2026-10-01T12:00:00Z', 'en')).toBe('01/10/2026');
  });
});

describe('form parsers (MoneyInput / QuantityInput / DateField)', () => {
  it('accepts decimal comma and point, and thousands groups', () => {
    expect(parseMoneyInput('7,5')).toBe(750);
    expect(parseMoneyInput('7.5')).toBe(750);
    expect(parseMoneyInput('1,250.50')).toBe(125050);
    expect(parseMoneyInput('1.250,50')).toBe(125050);
    expect(parseMoneyInput('1,250')).toBe(125000);
    expect(parseMoneyInput('1,250,000')).toBe(125000000);
    expect(parseMoneyInput('0,125')).toBe(13); // a leading 0 is a decimal, half-up to 0.13
    expect(parseMoneyInput('₪ 99.99')).toBe(9999);
    expect(parseMoneyInput('.5')).toBe(50);
    expect(parseMoneyInput('12.345')).toBe(1235);
  });
  it('rejects what is not a number', () => {
    for (const bad of ['', 'abc', '1,2,3', '1.2.3', '-5', '1,25.5', '12a']) expect(parseMoneyInput(bad)).toBeNull();
    expect(normalizeDecimal('  ')).toBeNull();
  });
  it('quantities keep up to 3 decimals', () => {
    expect(parseQuantityInput('2,5')).toBe(2.5);
    expect(parseQuantityInput('0.1234')).toBe(0.123);
  });
  it('dates: dd.mm.yyyy and friends → ISO; impossible dates are null', () => {
    expect(parseDateInput('25.10.2026')).toBe('2026-10-25');
    expect(parseDateInput('1/2/26')).toBe('2026-02-01');
    expect(parseDateInput('25102026')).toBe('2026-10-25');
    expect(parseDateInput('31.02.2026')).toBeNull();
    expect(parseDateInput('10/25/2026')).toBeNull(); // US order is not accepted
    expect(formatDateField('2026-10-01', 'he')).toBe('01.10.2026');
    expect(formatDateField('2026-10-01', 'en')).toBe('01/10/2026');
  });
  it('the calendar grid starts on Sunday (א׳)', () => {
    const grid = monthGrid(2026, 9); // October 2026: the 1st is a Thursday
    expect(grid).toHaveLength(42);
    expect(new Date(`${grid[0]}T00:00:00Z`).getUTCDay()).toBe(0);
    expect(grid[4]).toBe('2026-10-01');
  });
});

describe('Toast v2 timings (R-6)', () => {
  it('5 s plain, ≥ 10 s with an action, errors persist', () => {
    expect(toastDuration('success')).toBe(5000);
    expect(toastDuration('info', { action: { label: 'x', onClick: () => {} } })).toBe(10000);
    expect(toastDuration('success', { action: { label: 'x', onClick: () => {} }, duration: 3000 })).toBe(10000);
    expect(toastDuration('error')).toBe(Number.POSITIVE_INFINITY);
    expect(TOAST_MAX).toBe(3);
  });
});

describe('component contracts', () => {
  it('Field links hint and error through aria-describedby and sets aria-invalid', () => {
    const html = render(h(Field, { label: 'שם', htmlFor: 'n', hint: 'רמז', error: 'שגיאה', children: h(Input, { id: 'n' }) }));
    expect(html).toContain('aria-describedby="n-hint n-error"');
    expect(html).toContain('aria-invalid="true"');
    // hint sits between the label and the control
    expect(html.indexOf('n-hint')).toBeLessThan(html.indexOf('<input'));
  });

  it('Field gives an id-less control an id the label points to, and leaves wrappers alone', () => {
    const html = render(h(Field, { label: 'שם', children: h(Input, {}) }));
    const id = /<label for="([^"]+)"/.exec(html)![1];
    expect(html).toMatch(new RegExp(`<input[^>]* id="${id}"`));
    const wrapped = render(h(Field, { label: 'x', htmlFor: 'q', children: h('div', null, h('input', { id: 'q' })) }));
    expect(wrapped.match(/id="q"/g)).toHaveLength(1);
  });

  it('EmptyState: typed kinds, legacy API still renders centred', () => {
    expect(render(h(EmptyState, { title: 'ריק' }))).toContain('items-center');
    const typed = render(h(EmptyState, { kind: 'no-results', title: 'אין', action: h('button', null, 'נקה') }));
    expect(typed).toContain('data-empty-kind="no-results"');
    expect(typed).toContain('items-start');
  });

  it('Button: v2 sizes, aliases kept, loading is busy with a decorative spinner, disabledReason is linked', () => {
    expect(render(h(Button, { size: 'xl', children: 'x' }))).toContain('min-h-14');
    expect(render(h(Button, { variant: 'gold', children: 'x' }))).toContain('bg-gold-bold');
    expect(render(h(Button, { variant: 'accent', children: 'x' }))).toContain('bg-primary-bold');
    const loading = render(h(Button, { loading: true, children: 'שמירה' }));
    expect(loading).toContain('aria-busy="true"');
    expect(loading).not.toContain('role="status"');
    const reason = render(h(Button, { disabled: true, disabledReason: 'חסר ספק', children: 'שליחה' }));
    const id = /aria-describedby="([^"]+)"/.exec(reason)![1];
    expect(reason).toContain(`id="${id}"`);
    expect(reason).toContain('חסר ספק');
    expect(render(h(Button, { pressed: true, children: 'x' }))).toContain('aria-pressed="true"');
  });

  it('Spinner is motion-essential; decorative inside buttons', () => {
    expect(render(h(Spinner, {}))).toContain('role="status"');
    expect(render(h(Spinner, {}))).toContain('motion-essential');
    expect(render(h(Spinner, { decorative: true }))).toContain('aria-hidden="true"');
  });

  it('Skeleton keeps the v1 box API and uses the motion-safe shimmer', () => {
    const html = render(h(Skeleton, { className: 'h-4 w-10' }));
    expect(html).toContain('rm-shimmer');
    expect(html).toContain('h-4 w-10');
    expect(html).not.toContain('animate-pulse');
  });

  it('StatusChip is icon + word; CountBadge hides at 0', () => {
    const chip = render(h(StatusChip, { tone: 'danger', label: 'חוסם', emphasis: 'bold' }));
    expect(chip).toContain('<svg');
    expect(chip).toContain('חוסם');
    expect(render(h(CountBadge, { count: 0 }))).toBe('');
    expect(textOf(render(h(CountBadge, { count: 140 })))).toBe('99+');
  });

  it('numbers are physically right-aligned in tiles and numeric inputs (owner decision §8.15)', async () => {
    const { MetricTile } = await import('../money/MetricTile');
    expect(render(h(MetricTile, { label: 'x', value: '1' }))).toMatch(/data-num="true" class="[^"]*text-right/);
    const { MoneyInput } = await import('../form/MoneyInput');
    expect(render(h(MoneyInput, {}))).toMatch(/<input[^>]*class="[^"]*text-right/);
  });

  it('LinkButton only renders safe hrefs', async () => {
    const { safeHref } = await import('../Button');
    expect(safeHref('/dashboard/orders/1')).toBe('/dashboard/orders/1');
    expect(safeHref('?density=compact')).toBe('?density=compact');
    expect(safeHref('https://restomatch.co.il')).toBe('https://restomatch.co.il');
    expect(safeHref('javascript:alert(1)')).toBe('#');
    expect(safeHref(' JavaScript:alert(1)')).toBe('#');
    expect(safeHref('//evil.example')).toBe('#');
  });

  it('creep steps flip to white text from step 4', () => {
    expect(creepStep(0).text).toBe('text-on-creep-1');
    expect(creepStep(0.7).step).toBe(4);
    expect(creepStep(1).step).toBe(5);
  });
});

describe('cookie consent placement', () => {
  it('inline inside the app and on auth / portal routes; floating on marketing', () => {
    for (const p of ['/dashboard', '/dashboard/approvals', '/login', '/login/2fa', '/reset', '/s/abc', '/onboarding', '/invite/accept', '/admin']) {
      expect(consentPlacement(p), p).toBe('inline');
    }
    for (const p of ['/', '/pricing', '/cookies', '/showcase/receiver', '/support', '/sitemap']) expect(consentPlacement(p), p).toBe('floating');
  });
});
