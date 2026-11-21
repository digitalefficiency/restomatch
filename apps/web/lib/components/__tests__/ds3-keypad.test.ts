// DS3-01: the number pad of the clean finish (SPEC §5 "Number pad key", §10.3 the quantity sheet; CHANGES.md 21.11).
import './reactGlobal';
import { readFileSync } from 'node:fs';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../../i18n/client';
import type { AppLocale } from '../../i18n/config';
import { keypadDotText, parseKeypadDot, typeKeypadKey, type KeypadKey } from '../form/parse';
import { QtyPad, qtyFar, type QtyPadState } from '../overlay/QtyKeypad';

// Loosely typed createElement: two @types/react majors are hoisted in the workspace (STATE.md).
const h = createElement as unknown as (type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]) => ReactElement;
const render = (el: ReactElement, locale: AppLocale = 'he') => renderToStaticMarkup(h(I18nProvider, { locale }, el));
const textOf = (html: string) => html.replace(/<[^>]*>/g, '').split('&nbsp;').join(' ');
const typeAll = (keys: KeypadKey[], start = '', first = false, whole = false) =>
  keys.reduce((s, k, i) => typeKeypadKey(s, i === 0 ? first : false, k, whole), start);

describe('the typing rule: Latin digits, a point, 4 + 3 digits', () => {
  it('types digits and one point; a leading point becomes "0."', () => {
    expect(typeAll(['2', '4', '.', '5'])).toBe('24.5');
    expect(typeAll(['.', '5'])).toBe('0.5');
    expect(typeAll(['1', '.', '.', '2'])).toBe('1.2');
  });

  it('the first key replaces a value the sheet opened on; ⌫ first clears it', () => {
    expect(typeKeypadKey('24', true, '7')).toBe('7');
    expect(typeKeypadKey('24', true, 'del')).toBe('');
    expect(typeKeypadKey('24', false, 'del')).toBe('2');
    expect(typeKeypadKey('24', true, '.')).toBe('0.');
  });

  it('a lone 0 is replaced; at most four digits before the point and three after it', () => {
    expect(typeAll(['0', '7'])).toBe('7');
    expect(typeAll(['1', '2', '3', '4', '5'])).toBe('1234');
    expect(typeAll(['1', '.', '1', '2', '3', '4'])).toBe('1.123');
  });

  it('whole units take no point', () => {
    expect(typeAll(['1', '.', '2'], '', false, true)).toBe('12');
  });

  it('parses what can be counted, and nothing else', () => {
    expect(parseKeypadDot('')).toBeNull();
    expect(parseKeypadDot('.')).toBeNull();
    expect(parseKeypadDot('0.')).toBe(0);
    expect(parseKeypadDot('6.5')).toBe(6.5);
    expect(parseKeypadDot('12000')).toBe(12000); // a larger value can arrive as the opening value
    expect(parseKeypadDot('1,5')).toBeNull();
    expect(keypadDotText(6.5)).toBe('6.5');
    expect(keypadDotText(24)).toBe('24');
    expect(keypadDotText(1.25)).toBe('1.25');
    expect(keypadDotText(-3)).toBe('0');
  });
});

describe('far from the order', () => {
  it('beyond the tolerance either way; missing and empty are never "far"', () => {
    expect(qtyFar(6.6, 6.5, 3)).toEqual({ far: false, pct: 2 });
    expect(qtyFar(6.7, 6.5, 3).far).toBe(true);
    expect(qtyFar(24, 28.5, 3)).toEqual({ far: true, pct: 16 });
    expect(qtyFar(14, 6.5, 3)).toEqual({ far: true, pct: 115 });
    expect(qtyFar(0, 6.5, 3).far).toBe(false);
    expect(qtyFar(null, 6.5, 3).far).toBe(false);
    expect(qtyFar(5, undefined, 3).far).toBe(false);
  });
});

describe('<QtyPad> (the reference quantity sheet)', () => {
  const pad = (state: Partial<QtyPadState>, props: Record<string, unknown> = {}) =>
    h(QtyPad, { state: { text: '', first: false, damaged: false, ...state }, onChange: () => {}, unit: 'ק״ג', ordered: 28.5, ...props });

  it('twelve 64 px keys on 12 px corners, ⌫ and the point named; the point is off for whole units', () => {
    const html = render(pad({}));
    expect(html.match(/<button[^>]*class="num grid h-16 place-items-center rounded-card/g)).toHaveLength(12);
    expect(html).toContain('aria-label="מחיקה"');
    expect(html).toContain('aria-label="נקודה עשרונית"');
    expect(render(pad({}, { whole: true }))).toMatch(/<button type="button" disabled="" aria-label="נקודה עשרונית"/);
  });

  it('a −/+ stepper of 64 px, minus off while nothing is typed; the empty value is a quiet dash', () => {
    const html = render(pad({}));
    expect(html).toMatch(/<button type="button" disabled="" aria-label="הפחתה" class="grid size-16 place-items-center rounded-card/);
    expect(html).toMatch(/text-fg-tertiary[^"]*">—<\/span>/);
  });

  it('a value the sheet opened on is shown selected (the next key replaces it)', () => {
    const html = render(pad({ text: '24', first: true }));
    expect(html).toMatch(/<span data-selected=""[^>]*bg-info-subtle ring-\[1\.5px\] ring-inset ring-info[^>]*>24<\/span>/);
    expect(render(pad({ text: '24', first: false }))).not.toContain('data-selected');
  });

  it('the quick choices: חסר, פגום (pressed with a tick), כמו בהזמנה only when there is an order', () => {
    const html = render(pad({ text: '24', damaged: true }));
    expect(textOf(html)).toContain('חסר');
    expect(html).toMatch(/aria-pressed="true"[^>]*bg-fg text-on-bold/);
    expect(textOf(html)).toContain('כמו בהזמנה');
    expect(textOf(render(pad({}, { ordered: undefined })))).not.toContain('כמו בהזמנה');
    // "פגום" on a missing line is not pressed: nothing arrived to be damaged
    expect(render(pad({ text: '0', damaged: true }))).toContain('aria-pressed="false"');
  });

  it('far from the order: one plain note above the stepper, never a warning colour on the figure', () => {
    const near = render(pad({ text: '28.5' }));
    expect(near).not.toContain('role="status"');
    const off = render(pad({ text: '24' }));
    expect(off).toMatch(/<p role="status"[^>]*bg-warn-subtle/);
    expect(textOf(off)).toContain('שונה ב־16% מההזמנה (28.5 ק״ג)');
    expect(off.indexOf('role="status"')).toBeLessThan(off.indexOf('aria-label="הפחתה"'));
    expect(textOf(render(pad({ text: '60' })))).toContain('יותר מפי 2 מההזמנה (28.5 ק״ג)');
    expect(off).not.toMatch(/text-warn\b|text-danger/);
  });

  it('counts goods: no ₪ anywhere, in every receiver language', () => {
    for (const locale of ['he', 'en', 'ar', 'ru', 'th', 'ti'] as const) {
      const html = render(pad({ text: '24' }), locale);
      expect(html, locale).not.toContain('₪');
      expect(textOf(html).length, locale).toBeGreaterThan(20);
    }
  });

  it('never reads text back from the page into the pad (CHANGES.md 21.11)', () => {
    const src = readFileSync(new URL('../overlay/QtyKeypad.tsx', import.meta.url), 'utf8');
    expect(src).not.toMatch(/dangerouslySetInnerHTML|innerHTML|getAttribute|\.dataset|data-d=/);
    expect(src).toMatch(/onClick=\{\(\) => press\(k\)\}/);
  });
});
