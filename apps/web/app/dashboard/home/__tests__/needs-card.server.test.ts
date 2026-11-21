// DS3-03 · the "מחכה לך" card (SPEC §10.1; v2 B4–B6, v4 H4–H6, H10) as the server renders it.
import '../../../../lib/components/__tests__/reactGlobal';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createTranslator } from '@/lib/i18n/translate';
import { overview } from '@/lib/i18n/messages/overview';
import { NeedsYou, type NeedRow } from '../needs-you';

const h = createElement as unknown as (type: unknown, props?: Record<string, unknown> | null) => ReactElement;
const t = createTranslator('he', overview);
type Props = Parameters<typeof NeedsYou>[0];
const html = (p: Partial<Props> & { rows: NeedRow[] }) =>
  renderToStaticMarkup(h(NeedsYou, { title: 'מחכה לך', zero: 'הכול מטופל ✓', moreLabel: (count: number) => t('needs.moreTasks', { count }), ...p }));

const row = (key: string, over: Partial<NeedRow> = {}): NeedRow => ({
  key,
  type: 'claim_to_send',
  tone: 'warn',
  label: `שורה ${key}`,
  agorot: 12_345,
  decimals: 2,
  countText: null,
  sub: '3 בקשות',
  verb: 'לשליחה',
  href: `/dashboard/${key}`,
  dot: 'warn',
  ...over,
});
const decide = row('decide', { type: 'decision', tone: 'danger', label: 'ממתין להחלטה שלך', agorot: 29_600, decimals: 0, sub: '5 פערים', pill: '2 חוסמים תשלום', verb: 'להחלטה', dot: 'leak', basis: 'לפני מע״מ' });

describe('the markup contract the e2e and the meters read', () => {
  it('ul[data-record] > li[data-needs-row] (a real subgrid box, never display:contents) > a[data-testid][data-focus=inset]', () => {
    const markup = html({ rows: [decide, row('claimsUnsent')], primaryFirst: true });
    expect(markup).toMatch(/<section aria-labelledby="needs-you-title" data-testid="needs-you"/);
    expect(markup).toMatch(/<ul data-record=""[^>]*><li data-needs-row="decide" class="col-span-3 grid grid-cols-subgrid"><a data-testid="needs-decide" data-focus="inset"/);
    expect(markup).not.toMatch(/contents/);
    expect(markup).toMatch(/data-testid="needs-decide-value"/);
    expect(markup).toMatch(/data-testid="needs-decide-sub"/);
  });

  it('the solid pill sits INSIDE needs-decide-sub, after an announced " · "', () => {
    const markup = html({ rows: [decide] });
    expect(markup).toMatch(/data-testid="needs-decide-sub">5 פערים · <span data-tone="danger" data-pill="solid"[^>]*>.*2 חוסמים תשלום<\/span><\/span><\/span>/);
  });

  it('the basis caption under an amount; the dot by meaning', () => {
    const markup = html({ rows: [decide, row('payRun', { type: 'payment_due', tone: 'neutral', dot: 'neutral', basis: 'כולל מע״מ' })] });
    expect(markup).toMatch(/data-testid="needs-decide-basis">לפני מע״מ</);
    expect(markup).toMatch(/data-testid="needs-payRun-basis">כולל מע״מ</);
    expect(markup).toMatch(/data-dot="leak"/);
    expect(markup).toMatch(/data-dot="neutral"/);
  });
});

describe('one filled verb, and it follows focus (D7, v4 H6)', () => {
  it('finance homes: row 0 is filled at rest (data-primary), quiet while another row has focus', () => {
    const markup = html({ rows: [decide, row('claimsUnsent'), row('claimsWaiting')], primaryFirst: true });
    expect(markup.match(/data-primary=""/g)).toHaveLength(1);
    expect(markup).toMatch(/data-primary-row=""/);
    expect(markup).toMatch(/data-primary=""[^>]*class="[^"]*bg-primary-bold[^"]*border-transparent|data-primary=""[^>]*class="[^"]*border-transparent[^"]*bg-primary-bold/);
    expect(markup).toContain('group-has-[[data-needs-row]&gt;a:not([data-primary-row]):focus-visible]/needs:bg-transparent');
    // The other rows take the filled look only while their own link has focus.
    expect(markup.match(/group-focus-visible\/row:bg-primary-bold/g)).toHaveLength(2);
  });

  it('the chef’s card (no primaryFirst): no filled verb at all, no focus-following', () => {
    const markup = html({ rows: [row('cutoffs', { agorot: null, countText: '2 ספקים' }), row('count', { agorot: null, countText: '3/9' })] });
    expect(markup).not.toContain('data-primary');
    expect(markup).not.toContain('bg-primary-bold');
  });

  it('the public sample home: static rows (no href) render no link and no primary (W3-06 M11)', () => {
    const markup = html({ rows: [row('decide', { href: undefined, dot: undefined, tone: 'danger' }), row('claims', { href: undefined, dot: undefined })] });
    expect(markup).not.toMatch(/<a /);
    expect(markup).not.toContain('data-primary');
    // Without a meaning, the tone's old reading.
    expect(markup).toMatch(/data-dot="leak"/);
  });
});

describe('the title row, inbox zero', () => {
  it('the basis chip beside the title only when the caller gives one', () => {
    expect(html({ rows: [decide], basisChip: 'לפני מע״מ' })).toMatch(/<h2 id="needs-you-title"[^>]*>מחכה לך<\/h2><span data-testid="needs-you-basis"[^>]*>לפני מע״מ<\/span>/);
    expect(html({ rows: [decide] })).not.toContain('needs-you-basis');
  });

  it('zero inside the card: the green tick only for "all handled"; a line about others is neutral', () => {
    const good = html({ rows: [], zero: 'הכול מטופל ✓ · אין החלטות פתוחות' });
    expect(good).toMatch(/data-testid="needs-you-zero" data-tone="good"/);
    expect(good).toContain('bg-ok-dot');
    const neutral = html({ rows: [], zero: 'אצלך הכול מטופל · 4 ממתינים אצל הבעלים', zeroTone: 'neutral' });
    expect(neutral).toMatch(/data-tone="neutral"/);
    expect(neutral).not.toContain('bg-ok-dot');
  });
});

describe('"עוד": the rest unfold in place above the bottom button (v2 B6, v4 H4)', () => {
  const five = [decide, row('a'), row('b'), row('c', { label: 'ריצת התשלומים של החודש' }), row('d', { label: 'ללא מספר הקצאה' })];

  it('its own list (closed, inert), then the button with the ICU label, then the preview outside it', () => {
    const markup = html({ rows: five, primaryFirst: true });
    const more = markup.slice(markup.indexOf('data-testid="needs-you-more"'));
    expect(more).toMatch(/inert=""[^>]*><ul data-record="" data-needs-list="more"/);
    expect(more).toMatch(/<li data-needs-row="c"[\s\S]*<li data-needs-row="d"/);
    expect(more).toMatch(/<button type="button" aria-expanded="false" aria-controls="fold-[^"]+" data-focus="inset"[^>]*>עוד שתי משימות<svg/);
    expect(more).toMatch(/<\/button><span data-record=""[^>]*>ריצת התשלומים של החודש · ללא מספר הקצאה<\/span>/);
    // The hidden rows never wear the filled look: the primary is row 0 of the visible list.
    expect(markup.match(/data-primary=""/g)).toHaveLength(1);
  });

  it('nothing to fold: no "עוד" at all', () => {
    expect(html({ rows: five.slice(0, 3) })).not.toContain('needs-you-more');
  });
});
