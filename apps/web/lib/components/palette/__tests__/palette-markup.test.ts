import '../../__tests__/reactGlobal';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// The palette asks `search.global` through tRPC; static markup needs no network.
vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    search: {
      global: { useQuery: () => ({ data: undefined, isError: false, isFetching: false }) },
    },
  },
}));

import { CommandPalette, type CommandPaletteProps } from '../CommandPalette';
import { ShortcutSheet, type ShortcutSheetProps } from '../ShortcutSheet';

// DS3-02 · the palette's look and a11y contract in static markup (sidebar spec §1.6, §8).
// Typing, focus and the dialog's modality need a real DOM: the shell's e2e covers them.
const h = createElement as unknown as (
  type: unknown,
  props?: Record<string, unknown> | null,
  ...children: unknown[]
) => ReactElement;

const palette = (over: Partial<CommandPaletteProps> = {}) =>
  renderToStaticMarkup(
    h(CommandPalette, {
      open: true,
      onClose: () => undefined,
      role: 'owner',
      locale: 'he',
      screens: [],
      canSee: () => true,
      onNavigate: () => undefined,
      commands: [
        { id: 'rail', label: 'כיווץ התפריט', keys: ['Mod', 'B'], run: () => undefined },
        { id: 'density', label: 'תצוגה צפופה', run: () => undefined },
      ],
      ...over,
    }),
  );

const sheet = (over: Partial<ShortcutSheetProps> = {}) =>
  renderToStaticMarkup(
    h(ShortcutSheet, {
      open: true,
      onClose: () => undefined,
      locale: 'he',
      canGo: () => true,
      ...over,
    }),
  );

/** The opening tag of the first element matching `re`. */
const tag = (html: string, re: RegExp) => html.match(re)?.[0] ?? '';

describe('<CommandPalette> markup', () => {
  const html = palette();

  it('a native dialog 14vh from the top, min(640px, 100vw - 32px) wide, overlay radius, e3', () => {
    const dialog = tag(html, /<dialog\b[^>]*>/);
    for (const cls of [
      'top-[14vh]',
      'w-[min(640px,calc(100vw-32px))]',
      'rounded-overlay',
      'shadow-e3',
    ])
      expect(dialog, cls).toContain(cls);
  });

  it('the input row is 52 px and flex: none, holding the combobox', () => {
    const row = html.slice(html.indexOf('<label'), html.indexOf('</label>'));
    expect(tag(row, /<label\b[^>]*>/)).toMatch(/class="[^"]*\bh-\[52px\][^"]*\bflex-none\b/);
    expect(row).toMatch(/<input[^>]*role="combobox"[^>]*aria-controls="rm-palette-list"/);
  });

  it('the selected option: surface-2 plus a 2 × 16 primary notch at inline-start, not a full-height edge', () => {
    const selected = tag(html, /<div[^>]*role="option"[^>]*aria-selected="true"[^>]*>/);
    for (const cls of [
      'bg-surface-2',
      'before:start-0',
      'before:w-0.5',
      'before:h-4',
      'before:bg-primary',
    ])
      expect(selected, cls).toContain(cls);
    expect(selected).not.toMatch(/inset-y-0|shadow-\[inset/);
    expect(tag(html, /<div[^>]*role="option"[^>]*aria-selected="false"[^>]*>/)).not.toContain(
      'before:',
    );
  });

  it('a shortcut chip is an aria-hidden <kbd dir="ltr">, and its keys are read with the option', () => {
    const option = html.slice(
      html.indexOf('id="rm-palette-list-0"'),
      html.indexOf('id="rm-palette-list-1"'),
    );
    expect(option).toMatch(/<kbd dir="ltr" aria-hidden="true"[^>]*>Ctrl B<\/kbd>/);
    expect(option).toContain('<span class="sr-only">, קיצור Ctrl B</span>');
    const plain = html.slice(html.indexOf('id="rm-palette-list-1"'));
    expect(plain.slice(0, plain.indexOf('</div>'))).not.toContain('<kbd');
  });

  it('display commands show at 0 characters under "תצוגה"', () => {
    expect(html).toMatch(/role="group" aria-label="תצוגה"/);
    expect(html).toContain('כיווץ התפריט');
  });

  it('the status line sits outside the listbox (a listbox owns options and groups only)', () => {
    const list = html.indexOf('role="listbox"');
    const status = html.indexOf('role="status"');
    expect(list).toBeGreaterThan(-1);
    expect(status).toBeGreaterThan(list);
    const listbox = html.slice(list, status);
    expect(listbox).not.toContain('<p');
  });

  it('the footer adds the money line for roles that can open a money action, never for chef or receiver', () => {
    expect(html).toContain('פעולת כסף נפתחת במסך שלה · לא מאשרים מכאן');
    const field = (r: CommandPaletteProps['role']) =>
      palette({ role: r, canSee: (href) => !/approvals|recovery/.test(href) });
    expect(field('chef')).not.toContain('פעולת כסף');
    expect(field('receiver')).not.toContain('פעולת כסף');
    expect(palette({ locale: 'en' })).toContain(
      'A money action opens on its own screen · nothing is approved here',
    );
  });

  it('chef and receiver: a ₪ waiting item never renders (second guard), a ₪-free one does', () => {
    const waiting = [
      { kind: 'waiting', id: 'w1', label: '3 פערים · ‏104.80 ₪', href: '/dashboard/approvals' },
      { kind: 'waiting', id: 'w2', label: 'המשלוח הבא: ירקות השרון', href: '/dashboard/receiving' },
    ] as const;
    for (const role of ['chef', 'receiver'] as const) {
      const out = palette({ role, waiting: [...waiting] });
      expect(out, role).not.toContain('₪');
      expect(out, role).toContain('המשלוח הבא');
    }
    expect(palette({ waiting: [...waiting] })).toContain('104.80');
  });

  it('a closed palette renders an empty dialog', () => {
    expect(palette({ open: false })).toMatch(/^<dialog\b[^>]*><\/dialog>$/);
  });
});

describe('<ShortcutSheet> single-key switch (sidebar spec §8)', () => {
  it('renders a labelled switch only when both singleKeys and onSingleKeysChange are given', () => {
    const on = sheet({ singleKeys: true, onSingleKeysChange: () => undefined });
    const button = on.slice(
      on.indexOf('<button type="button" role="switch"'),
      on.indexOf('</button>'),
    );
    expect(button).toMatch(
      /role="switch" aria-checked="true" aria-describedby="rm-shortcuts-single-hint"/,
    );
    expect(button).toContain('קיצורים בתו אחד');
    expect(on).toMatch(/<p id="rm-shortcuts-single-hint"[^>]*>צירופי Ctrl תמיד פעילים<\/p>/);
    expect(sheet({ singleKeys: false, onSingleKeysChange: () => undefined })).toContain(
      'aria-checked="false"',
    );
    expect(sheet({ singleKeys: true })).not.toContain('role="switch"');
    expect(sheet({ onSingleKeysChange: () => undefined })).not.toContain('role="switch"');
    expect(sheet()).not.toContain('role="switch"');
  });

  it('keeps the shortcut lists', () => {
    const html = sheet({ singleKeys: true, onSingleKeysChange: () => undefined, locale: 'en' });
    expect(html).toContain('Keyboard shortcuts');
    expect(html).toContain('Single-key shortcuts');
    expect(html).toMatch(/<dl\b/);
  });
});
