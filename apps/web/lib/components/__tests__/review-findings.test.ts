import './reactGlobal';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { safeHref } from '../Button';
import { creepStep } from '../data-viz/palette';
import { dateFieldValue, formatKeypadText, parseKeypadQuantity, parseMoneyInput, parseQuantityInput } from '../form/parse';
import { daysUntil } from '../money/format';
import { isTopChrome } from '../overlay/ChromeMetrics';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** Pre-merge review of #153 (W1-01) — each case failed before its fix. */
describe('review findings', () => {
  it('1 · the keypad comma is a decimal: 1,250 kg is 1.25, and 1.125 round-trips', () => {
    expect(parseKeypadQuantity('1,250')).toBe(1.25);
    expect(parseKeypadQuantity('12')).toBe(12);
    expect(parseKeypadQuantity(',5')).toBe(0.5);
    expect(parseKeypadQuantity(formatKeypadText(1.125))).toBe(1.125);
    expect(parseKeypadQuantity(formatKeypadText(1250))).toBe(1250);
    // typed fields keep the documented rule (comma groups of three = thousands)
    expect(parseQuantityInput('1,250')).toBe(1250);
  });

  it('2 · an invalid or out-of-range typed date posts nothing and is flagged', () => {
    expect(dateFieldValue('25.10.2026')).toEqual({ iso: '2026-10-25', invalid: false });
    expect(dateFieldValue('')).toEqual({ iso: null, invalid: false });
    expect(dateFieldValue('25.10.20')).toEqual({ iso: '2020-10-25', invalid: false });
    expect(dateFieldValue('31.02.2026')).toEqual({ iso: null, invalid: true });
    expect(dateFieldValue('25.1')).toEqual({ iso: null, invalid: true });
    expect(dateFieldValue('25.10.2026', { max: '2026-10-01' })).toEqual({ iso: null, invalid: true });
  });

  it('3 · safeHref rejects backslash and control-character protocol-relative hrefs', () => {
    for (const bad of ['/\\evil.com', '\\\\evil.com', '/\t/evil.com', '\t//evil.com', ' //evil.com', '/\n/evil.com', 'java\tscript:alert(1)']) {
      expect(safeHref(bad), JSON.stringify(bad)).toBe('#');
    }
    expect(safeHref('/dashboard')).toBe('/dashboard');
  });

  it('5 · deadlines count calendar days in Israel, like formatDay', () => {
    // 22:30 UTC on 30 Oct is already 31 Oct in Jerusalem (UTC+2): due 31 Oct = today.
    expect(daysUntil('2026-10-31', new Date('2026-10-30T22:30:00Z'))).toBe(0);
    expect(daysUntil('2026-11-01', new Date('2026-10-30T22:30:00Z'))).toBe(1);
    expect(daysUntil(new Date('2026-10-30T22:30:00Z'), new Date('2026-10-31T08:00:00Z'))).toBe(0);
  });

  it('6 · a lone separator is not ₪0', () => {
    for (const s of ['.', ',', ',,', '.,']) {
      expect(parseMoneyInput(s), s).toBeNull();
      expect(parseQuantityInput(s), s).toBeNull();
    }
  });

  it('8 · creep classes are literal strings Tailwind can see', () => {
    const src = read('../data-viz/palette.ts');
    for (let i = 1; i <= 5; i += 1) {
      expect(src).toContain(`'bg-creep-${i}'`);
      expect(src).toContain(`'text-on-creep-${i}'`);
    }
    expect(creepStep(0.7)).toMatchObject({ step: 4, bg: 'bg-creep-4', text: 'text-on-creep-4' });
  });

  it('9 · a sticky top-0 header counts as chrome even before it sticks (consent strip above it)', () => {
    expect(isTopChrome({ position: 'sticky', top: '0px' }, 57)).toBe(true);
    expect(isTopChrome({ position: 'fixed', top: '0px' }, 0)).toBe(true);
    expect(isTopChrome({ position: 'static', top: 'auto' }, 0)).toBe(false);
    expect(isTopChrome({ position: 'sticky', top: 'auto' }, 400)).toBe(false);
  });

  it('10 · the coarse-pointer link floor is opt-in, not every table/list link', () => {
    const css = read('../../../app/globals.css');
    expect(css).not.toMatch(/table a,\s*li > a/);
    expect(css).toMatch(/\[data-row-link\]/);
  });
});
