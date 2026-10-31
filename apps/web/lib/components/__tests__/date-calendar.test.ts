import './reactGlobal';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../../i18n/client';
import { Calendar, DateField } from '../form/DateField';
import { addDays } from '../form/parse';

const h = createElement as unknown as (type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]) => ReactElement;
const render = (el: ReactElement) => renderToStaticMarkup(h(I18nProvider, { locale: 'he' }, el));
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
const todayButton = (html: string) => /<button[^>]*>היום<\/button>/.exec(html)?.[0] ?? '';
/** The `disabled` HTML attribute (not a `disabled:` Tailwind class). */
const isDisabled = (button: string) => /\sdisabled=""/.test(button);

describe('DateField calendar "Today" respects min/max', () => {
  it('is disabled when today is before min (and enabled when in range)', () => {
    const blocked = render(h(Calendar, { id: 'c', selected: null, min: addDays(today, 3), onPick: () => {}, onClose: () => {} }));
    expect(isDisabled(todayButton(blocked))).toBe(true);
    const blockedMax = render(h(Calendar, { id: 'c', selected: null, max: addDays(today, -3), onPick: () => {}, onClose: () => {} }));
    expect(isDisabled(todayButton(blockedMax))).toBe(true);
    const open = render(h(Calendar, { id: 'c', selected: null, min: addDays(today, -3), onPick: () => {}, onClose: () => {} }));
    expect(todayButton(open)).not.toBe('');
    expect(isDisabled(todayButton(open))).toBe(false);
  });

  it('with min after today the field posts nothing', () => {
    const html = render(h(DateField, { name: 'd', min: addDays(today, 3) }));
    expect(html).toContain('<input type="hidden" name="d" value=""/>');
  });
});
