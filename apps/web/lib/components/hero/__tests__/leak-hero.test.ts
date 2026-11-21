// DS3-03 · the leak card of the clean finish (SPEC §10.1), rendered as the server renders it.
import '../../__tests__/reactGlobal';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../../../i18n/client';
import { HeroFold, HeroNote, LeakHero, PacePlaceholder, type LeakHeroPart, type LeakHeroProps } from '..';

// Loosely typed createElement: two @types/react majors are hoisted in the workspace (STATE.md).
const h = createElement as unknown as (type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]) => ReactElement;
/** The same element, typed as the props' node type (the global React namespace's copy). */
const node = (type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]) => h(type, props, ...children) as unknown as React.ReactNode;
const html = (props: LeakHeroProps, locale: 'he' | 'en' = 'he') =>
  renderToStaticMarkup(h(I18nProvider, { locale }, h(LeakHero, props as unknown as Record<string, unknown>)));
/** The opening tag of the element carrying `data-testid="<id>"`. */
const tagOf = (markup: string, id: string) => markup.match(new RegExp(`<[a-z]+[^>]*data-testid="${id}"[^>]*>`))?.[0] ?? '';
const sectionTag = (markup: string) => markup.match(/<section[^>]*>/)?.[0] ?? '';

const UNPAID: LeakHeroPart = {
  label: 'על חשבוניות שעוד לא שולמו',
  value: '₪309',
  agorot: 30866,
  href: '/dashboard/leaks/breakdown#group-unpaid',
  linkLabel: 'לחשבוניות שלא שולמו',
  testId: 'hero-unpaid',
  linkTestId: 'hero-unpaid-link',
  whole: { text: 'כל הסכום על חשבוניות שלא סומנו כשולמו', linkLabel: 'לחשבוניות שלא סומנו כשולמו', linkTestId: 'hero-unpaid-link' },
};
const PAID: LeakHeroPart = {
  label: 'על חשבוניות ששולמו',
  value: '₪461',
  agorot: 46111,
  href: '/dashboard/leaks/claims',
  linkLabel: 'לבקשות הזיכוי',
  testId: 'hero-paid',
  linkTestId: 'hero-paid-link',
  whole: { text: 'כל הסכום על חשבוניות ששולמו', linkLabel: 'לבקשות הזיכוי', linkTestId: 'hero-paid-link' },
};

/** The owner home's leak state as stage 2 wires it (lab figures, 21.11). */
const LEAK: LeakHeroProps = {
  state: 'leak',
  eyebrow: '',
  label: 'דליפה החודש',
  amount: '₪770',
  amountIls: 769.77,
  amountHref: '/dashboard/leaks/breakdown',
  locale: 'he',
  period: 'מתחילת נובמבר',
  pct: '1.9%',
  pctLine: 'מהרכש שנבדק',
  baseLine: ', מתוך ₪41,526 לפני מע״מ',
  delta: { direction: 'up', word: 'עלייה של ₪152 (25%)', text: 'לעומת אותם ימים באוקטובר' },
  splitAria: 'הדליפה מתחלקת לשניים',
  parts: [UNPAID, PAID],
  completeness: { text: '34 חשבוניות נבדקו, ב־13 מהן נמצא פער' },
  pace: node('figure', { 'data-testid': 'leak-hero-pace', 'aria-label': 'הדליפה המצטברת' }),
  why: {
    label: 'איך הגענו לסכום?',
    panelLabel: 'החישוב של הדליפה',
    children: node(HeroNote, { testId: 'hero-pending-link' }, '2 חשבוניות ממתינות לשיוך להזמנה'),
  },
};

/** Exactly the prop shape the 'use client' showcase passes (SampleOwnerHome.tsx): strings, no links. */
const SHOWCASE: LeakHeroProps = {
  state: 'leak',
  eyebrow: 'דליפה שזוהתה · אוקטובר',
  label: 'דליפה החודש',
  amount: '₪760',
  pctLine: '1.8% מהקניות שנבדקו',
  baseLine: 'מתוך ₪42,263 לפני מע״מ',
  splitLabel: 'מתוכם',
  parts: [
    { label: 'על חשבוניות שעוד לא שולמו', value: '₪296', testId: 'sample-part-unpaid' },
    { label: 'על חשבוניות ששולמו', value: '₪464', testId: 'sample-part-paid' },
  ],
  completeness: { text: '35 חשבוניות נבדקו · 13 עם פער' },
};

describe('the clean card: no rail and no danger frame in any state (SPEC §2 T1, §4)', () => {
  const states: LeakHeroProps[] = [
    LEAK,
    { ...LEAK, state: 'clean', amountIls: 0, cleanSentence: 'אין דליפה · 34 חשבוניות נבדקו' },
    { ...LEAK, state: 'pendingOnly' },
    { ...LEAK, state: 'noData', noData: { title: 'עוד לא נבדקו חשבוניות בנובמבר', hint: 'הדליפה תחושב אחרי ההתאמה.', cta: null } },
    SHOWCASE,
  ];
  it.each(states.map((p) => [p.state, p] as const))('%s', (_state, props) => {
    const markup = html(props);
    const section = sectionTag(markup);
    expect(section).toContain('rounded-card');
    expect(section).toContain('border-line-rule');
    expect(section).toContain('shadow-e1');
    expect(section).toContain('aria-labelledby="leak-hero-label"');
    expect(section).not.toMatch(/danger/);
    expect(markup).not.toMatch(/w-1\.5[^"]*rounded-s|rounded-s-2xl/); // the old 6 px rail
    expect(markup).not.toMatch(/border-danger\//);
    expect(markup).not.toMatch(/\bbg-danger(?=["\s])/); // a bare danger fill (the rail); the dot is bg-danger-dot
    expect(markup).not.toMatch(/shadow-card/);
  });
});

describe('leak state (SPEC §10.1)', () => {
  const markup = html(LEAK);

  it('top row: the red dot, the exact h2, the period outside it', () => {
    expect(markup).toContain('data-dot="leak"');
    expect(markup).toMatch(/<h2 id="leak-hero-label"[^>]*>דליפה החודש<\/h2>/);
    expect(markup).toMatch(/<\/h2><span[^>]*data-testid="leak-hero-period"[^>]*>מתחילת נובמבר<\/span>/);
  });

  it('the number: <Money context="hero"> inside the count wrapper, the drill link, the G-16 markers', () => {
    const amount = tagOf(markup, 'leak-hero-amount');
    expect(amount).toMatch(/^<a /);
    expect(amount).toContain('href="/dashboard/leaks/breakdown"');
    expect(amount).toContain('data-money-agorot="76977"');
    expect(amount).toContain('data-money-sum-of="hero-split"');
    expect(markup).toMatch(/data-testid="leak-hero-amount"[^>]*><span data-entry-part="count"[^>]*><span data-money-figure=""[^>]*text-metric-hero/);
    expect(markup).toContain('<span class="money-glyph">₪</span>');
    // No count overlay on the server: it mounts only from the island's effect, beside the link.
    expect(markup).not.toContain('data-hero-count');
  });

  it('the pace slot sits beside the number', () => {
    expect(markup).toContain('data-testid="leak-hero-pace"');
  });

  it('the scale sentence: the % bold, the base in its own span', () => {
    // The base brings its own comma: "1.9% מהרכש שנבדק, מתוך ₪41,526 לפני מע״מ" (no space before it).
    expect(markup).toMatch(/data-testid="leak-hero-pct"[^>]*><b class="font-semibold text-fg">1\.9%<\/b> מהרכש שנבדק<span data-testid="leak-hero-base">, מתוך ₪41,526 לפני מע״מ<\/span><\/p>/);
    // A base without punctuation (the showcase's) is joined with a space.
    expect(html(SHOWCASE)).toMatch(/1\.8% מהקניות שנבדקו <span data-testid="leak-hero-base">מתוך ₪42,263 לפני מע״מ<\/span>/);
  });

  it('the change in words: up keeps ink, only the arrow takes the leak indicator (a money figure is never red)', () => {
    const delta = tagOf(markup, 'leak-hero-delta');
    expect(delta).toContain('data-direction="up"');
    expect(delta).toContain('text-fg');
    expect(delta).not.toMatch(/text-danger/);
    expect(markup).toMatch(/stroke-danger-dot/);
    const down = tagOf(html({ ...LEAK, delta: { direction: 'down', word: 'ירידה של ₪14 (2%)', text: 'לעומת אותם ימים באוקטובר' } }), 'leak-hero-delta');
    expect(down).toContain('text-primary');
    const same = tagOf(html({ ...LEAK, delta: { direction: 'same', word: 'ללא שינוי', text: '' } }), 'leak-hero-delta');
    expect(same).toContain('text-fg-secondary');
    const none = html({ ...LEAK, delta: { none: 'אין נתוני השוואה' } });
    expect(tagOf(none, 'leak-hero-delta')).toContain('data-direction="none"');
  });

  it('the split: the shared bar and a legend whose values add up to the hero, to the agora', () => {
    expect(markup).toContain('data-split-bar=""');
    expect(markup).toMatch(/role="group" aria-label="הדליפה מתחלקת לשניים"/);
    const rows = [...markup.matchAll(/data-money-row-of="hero-split" data-money-agorot="(\d+)"/g)].map((m) => Number(m[1]));
    expect(rows).toEqual([30866, 46111]);
    expect(rows.reduce((a, b) => a + b, 0)).toBe(76977);
    expect(tagOf(markup, 'hero-unpaid-link')).toContain('href="/dashboard/leaks/breakdown#group-unpaid"');
    expect(tagOf(markup, 'hero-paid-link')).toContain('href="/dashboard/leaks/claims"');
    expect(tagOf(markup, 'hero-unpaid-link')).toContain('underline');
    expect(markup).toContain('--split-cols:30866fr 46111fr');
    expect(markup).not.toContain('data-testid="hero-split-single"');
  });

  it('the foot: the completeness line, the toggle, the closed calculation (inert, named, its own content)', () => {
    expect(markup).toMatch(/data-testid="leak-hero-completeness"[^>]*>34 חשבוניות נבדקו, ב־13 מהן נמצא פער</);
    const root = tagOf(markup, 'hero-why');
    expect(root).toContain('data-open="false"');
    const toggle = tagOf(markup, 'hero-why-toggle');
    expect(toggle).toMatch(/^<button /);
    expect(toggle).toContain('aria-expanded="false"');
    expect(toggle).not.toContain('data-explain-toggle');
    const controls = toggle.match(/aria-controls="([^"]+)"/)![1]!;
    expect(markup).toMatch(new RegExp(`<div id="${controls}" inert="" class="[^"]*invisible[^"]*" role="region" aria-label="החישוב של הדליפה">`));
    expect(markup).toContain('data-testid="hero-pending-link"');
  });

  it('every link has an href; no entry motion unless asked', () => {
    expect(markup).not.toMatch(/<a(?![^>]*href=)[^>]*>/);
    expect(sectionTag(markup)).not.toContain('data-entry');
    expect(markup).not.toContain('<style');
  });
});

describe('entry motion, once (v4 H1)', () => {
  it('entry → data-entry on the section and ONE hero-scoped <style> under no-preference', () => {
    const markup = html({ ...LEAK, entry: true });
    expect(sectionTag(markup)).toContain('data-entry=""');
    expect(markup.match(/<style>/g)).toHaveLength(1);
    expect(markup).toMatch(/<style>@media \(prefers-reduced-motion: no-preference\)\{section\[aria-labelledby="leak-hero-label"\]\[data-entry\]/);
    expect(markup).toContain('rm-hero-hold');
  });
  it('no entry → neither; and entry only plays in the leak state with the exact number', () => {
    for (const props of [LEAK, { ...LEAK, entry: true, state: 'clean' as const, amountIls: 0 }, { ...LEAK, entry: true, amountIls: undefined }]) {
      const markup = html(props);
      expect(sectionTag(markup)).not.toContain('data-entry');
      expect(markup).not.toContain('<style');
    }
  });
});

describe('the one-line split: (almost) all of it on one side (v2 C2, v4 H7)', () => {
  it('paid part under ₪0.50 → the unpaid sentence and its honest link, no bar, no sum markers', () => {
    const markup = html({ ...LEAK, amountIls: 769.77, parts: [{ ...UNPAID, agorot: 76977 }, { ...PAID, agorot: 0 }] });
    const single = tagOf(markup, 'hero-split-single');
    expect(single).toMatch(/^<p /);
    expect(markup).toMatch(/data-testid="hero-split-single"[^>]*><span>כל הסכום על חשבוניות שלא סומנו כשולמו<\/span>/);
    expect(tagOf(markup, 'hero-unpaid-link')).toContain('href="/dashboard/leaks/breakdown#group-unpaid"');
    expect(markup).toMatch(/>לחשבוניות שלא סומנו כשולמו<\/a>/);
    expect(markup).not.toContain('data-split-bar');
    expect(markup).not.toContain('data-money-sum-of');
    expect(markup).not.toContain('data-money-row-of');
  });
  it('unpaid part under ₪0.50 → the paid sentence and the credit requests', () => {
    const markup = html({ ...LEAK, parts: [{ ...UNPAID, agorot: 49 }, { ...PAID, agorot: 76928 }] });
    expect(markup).toMatch(/data-testid="hero-split-single"[^>]*><span>כל הסכום על חשבוניות ששולמו<\/span>/);
    expect(tagOf(markup, 'hero-paid-link')).toContain('href="/dashboard/leaks/claims"');
  });
});

describe('showcase (W3-06): the same component with strings only renders no link at all', () => {
  const markup = html(SHOWCASE);
  it('zero <a>, the legend alone (no bar, no money markers), the strings as given', () => {
    expect(markup).not.toContain('<a');
    expect(markup).not.toContain('data-split-bar');
    expect(markup).not.toContain('data-money-');
    expect(markup).toContain('data-testid="sample-part-unpaid"');
    expect(markup).toContain('data-testid="sample-part-paid"');
    expect(markup).toMatch(/role="group" aria-label="מתוכם"/);
    expect(markup).toMatch(/<bdi data-testid="leak-hero-amount">₪760<\/bdi>/);
    expect(markup).toContain('1.8% מהקניות שנבדקו');
    expect(markup).not.toContain('<button');
  });
});

describe('clean, pendingOnly and noData (SPEC §10.1; IA rule 8: unknown is never ₪0)', () => {
  it('clean: ₪0 muted through Money, no dot, no split, the round green tick', () => {
    const markup = html({ ...LEAK, state: 'clean', amountIls: 0, why: null, cleanSentence: 'אין דליפה · 34 חשבוניות נבדקו' });
    expect(markup).not.toContain('data-dot=');
    expect(markup).not.toContain('data-split-bar');
    expect(markup).not.toContain('data-testid="hero-unpaid"');
    expect(markup).not.toContain('data-testid="leak-hero-pace"');
    expect(tagOf(markup, 'leak-hero-amount')).toContain('data-money-agorot="0"');
    expect(markup).toMatch(/data-money-figure=""[^>]*text-muted/);
    expect(markup).toMatch(/data-testid="leak-hero-clean"[^>]*><span class="[^"]*bg-ok-dot[^"]*"/);
    expect(markup).not.toContain('data-testid="hero-why"');
  });

  it('pendingOnly: "—", no ₪, the T4 lines in place (grey, a clock), no change line', () => {
    const markup = html({
      ...LEAK,
      state: 'pendingOnly',
      why: null,
      pending: node(HeroNote, { testId: 'hero-pending-link' }, '2 חשבוניות ממתינות לשיוך להזמנה'),
    });
    expect(markup).toMatch(/data-testid="leak-hero-amount"[^>]*>—</);
    expect(markup).not.toContain('₪770');
    expect(markup).not.toContain('data-testid="leak-hero-delta"');
    expect(markup).not.toContain('data-testid="leak-hero-pct"');
    expect(markup).toMatch(/data-testid="leak-hero-pending"[\s\S]*data-testid="hero-pending-link"/);
    expect(tagOf(markup, 'hero-pending-link')).toContain('text-fg-secondary');
    expect(markup).toContain('lucide-clock');
  });

  it('noData: "—", the title and hint, the CTA as the secondary button (D9: one primary per viewport)', () => {
    const markup = html({
      ...LEAK,
      state: 'noData',
      noData: { title: 'עוד לא נבדקו חשבוניות בנובמבר', hint: 'הדליפה תחושב אחרי ההתאמה.', cta: { label: 'צלמו חשבונית', href: '/dashboard/receiving', testId: 'hero-nodata-cta' } },
    });
    expect(markup).toMatch(/data-testid="leak-hero-amount"[^>]*>—</);
    expect(markup).toContain('עוד לא נבדקו חשבוניות בנובמבר');
    const cta = tagOf(markup, 'hero-nodata-cta');
    expect(cta).toContain('href="/dashboard/receiving"');
    expect(cta).toContain('border-line-strong');
    expect(cta).toContain('bg-surface');
    expect(cta).not.toMatch(/(?<![\w:-])bg-primary-bold(?![\w-])/); // not the filled primary
    expect(markup).not.toContain('data-testid="hero-why"');
    expect(markup).not.toContain('data-testid="leak-hero-delta"');
  });
});

describe('the islands, server side', () => {
  it('HeroFold: closed on the server, its own toggle, no Explain contract', () => {
    const markup = renderToStaticMarkup(h(HeroFold, { label: 'איך הגענו לסכום?', panelLabel: 'החישוב', testId: 'f', toggleTestId: 't', line: 'שורה' }, h('p', null, 'תוכן')));
    expect(markup).toMatch(/<button type="button" aria-expanded="false" aria-controls="(fold-[A-Za-z0-9_-]+)"/);
    expect(markup).toContain('grid-rows-[0fr]');
    expect(markup).toContain('inert=""');
    expect(markup).not.toContain('data-explain');
    expect(markup).not.toContain(' hidden=""');
  });
  it('PacePlaceholder: the shared box ratio, decorative', () => {
    const markup = renderToStaticMarkup(h(PacePlaceholder, {}));
    expect(markup).toContain('viewBox="-2 -6 250 78"');
    expect(markup).toContain('aria-hidden="true"');
  });
});
