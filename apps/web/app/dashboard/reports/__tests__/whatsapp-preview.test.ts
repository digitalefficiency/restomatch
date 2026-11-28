// W3-08 · G-16 crawl (#331): the WhatsApp bubble follows the MESSAGE's
// language, as WhatsApp does — a Hebrew message is RTL (₪ left of the digits),
// an English one LTR ("₪533"). The text is passed through untouched.
import '../../../../lib/components/__tests__/reactGlobal';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WhatsAppPreview, bubbleDir } from '../monthly/whatsapp-preview';

const h = createElement as unknown as (type: unknown, props?: Record<string, unknown> | null) => ReactElement;

describe('WhatsApp preview direction', () => {
  it('Hebrew message → dir="rtl", text unchanged', () => {
    const text = '*דוח החודש · נובמבר 2026*\nהמספר: ‏533 ‏₪';
    const html = renderToStaticMarkup(h(WhatsAppPreview, { text, locale: 'he' }));
    expect(html).toMatch(/<pre[^>]* dir="rtl"/);
    expect(html).toContain('lang="he"');
    expect(html).toContain('‏533 ‏₪');
  });

  it('English message → dir="ltr" ("₪533" stays LTR)', () => {
    const text = '*Month report · November 2026*\nThe number: ₪533';
    const html = renderToStaticMarkup(h(WhatsAppPreview, { text, locale: 'en' }));
    expect(html).toMatch(/<pre[^>]* dir="ltr"/);
    expect(html).toContain('₪533');
  });

  it('locale → direction (Arabic RTL too, region tags ignored)', () => {
    expect(bubbleDir('he')).toBe('rtl');
    expect(bubbleDir('he-IL')).toBe('rtl');
    expect(bubbleDir('ar')).toBe('rtl');
    expect(bubbleDir('en')).toBe('ltr');
  });
});
