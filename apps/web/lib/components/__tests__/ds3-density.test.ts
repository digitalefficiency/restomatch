// DS3-01 × DS3-06: the shared components read the device's display density (lib/prefs/README.md, "Who reads what").
import './reactGlobal';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { UserRole } from '@restomatch/db';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/dashboard/approvals',
  useSearchParams: () => new URLSearchParams(),
}));

const { I18nProvider } = await import('../../i18n/client');
const { NavProvider } = await import('../../nav/NavProvider');
const { DataTable } = await import('../table/DataTable');
const { ViewToolbar } = await import('../views/ViewToolbar');
const { DEFAULT_VIEW, parseView, serializeView } = await import('../views/state');

// Loosely typed createElement: two @types/react majors are hoisted in the workspace (STATE.md).
const h = createElement as unknown as (type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]) => ReactElement;
const viewer = (role: UserRole) => ({ role, features: [], showChain: false, branch: null });
const render = (el: ReactElement, role?: UserRole) =>
  renderToStaticMarkup(h(I18nProvider, { locale: 'he' }, role ? h(NavProvider, { value: viewer(role) }, el) : el));

type Row = { id: string; n: number };
const table = (props: Record<string, unknown> = {}) =>
  h(DataTable, {
    id: 'density-test',
    caption: 'פערים',
    rows: [{ id: 'a', n: 1 }] satisfies Row[],
    columns: [{ id: 'n', header: 'מספר', kind: 'number', value: (r: Row) => r.n, identity: true }],
    rowKey: (r: Row) => r.id,
    defaultSort: { id: 'n', desc: false },
    ...props,
  });
const tableDensityOf = (html: string) => html.match(/<table[^>]*data-density="([a-z]+)"/)?.[1] ?? html.match(/data-density="([a-z]+)"/)?.[1];

describe('DataTable takes its default density from the display preference (DS3-06)', () => {
  it('no choice yet: the role decides (D4) — the bookkeeper compact, everyone else regular', () => {
    expect(tableDensityOf(render(table(), 'bookkeeper'))).toBe('compact');
    for (const role of ['owner', 'manager', 'chef', 'receiver'] as const) expect(tableDensityOf(render(table(), role)), role).toBe('default');
    // outside the dashboard (no viewer): today's default
    expect(tableDensityOf(render(table()))).toBe('default');
  });

  it('a density passed by the caller still wins (every public prop keeps working)', () => {
    expect(tableDensityOf(render(table({ density: 'default' }), 'bookkeeper'))).toBe('default');
    expect(tableDensityOf(render(table({ density: 'compact' }), 'owner'))).toBe('compact');
  });
});

describe('the views density switch takes its default from the preference; the address wins', () => {
  const toolbar = (view = DEFAULT_VIEW) => h(ViewToolbar, { page: 'approvals', view, density: true });
  const checked = (html: string) => html.match(/<button[^>]*role="radio" aria-checked="true"[^>]*title="([^"]+)"/)?.[1];

  it('parseView: the page passes the preference as the default; an explicit d still wins', () => {
    expect(parseView(new URLSearchParams(''), { density: 'compact' })).toMatchObject({ density: 'compact', densityDefault: 'compact' });
    expect(parseView(new URLSearchParams('d=comfortable'), { density: 'compact' }).density).toBe('comfortable');
    // without a default the parser is exactly what it was (no new field)
    expect(parseView(new URLSearchParams(''))).toEqual(DEFAULT_VIEW);
    // a value outside the vocabulary is ignored
    expect(parseView(new URLSearchParams(''), { density: 'huge' as never }).density).toBe(DEFAULT_VIEW.density);
  });

  it('serializeView: d only when the choice differs from the page default', () => {
    const compactDefault = parseView(new URLSearchParams(''), { density: 'compact' });
    expect(serializeView(compactDefault).get('d')).toBeNull();
    expect(serializeView({ ...compactDefault, density: 'comfortable' }).get('d')).toBe('comfortable');
    expect(serializeView({ ...DEFAULT_VIEW, density: 'compact' }).get('d')).toBe('compact');
    expect(serializeView(DEFAULT_VIEW).get('d')).toBeNull();
  });

  it('the switch shows what the page renders, labelled רגיל / צפוף', () => {
    expect(checked(render(toolbar(), 'bookkeeper'))).toBe('רגיל');
    expect(checked(render(toolbar(parseView(new URLSearchParams(''), { density: 'compact' })), 'bookkeeper'))).toBe('צפוף');
    expect(checked(render(toolbar({ ...DEFAULT_VIEW, density: 'compact' }), 'owner'))).toBe('צפוף');
  });
});

describe('viewDefaults (server): the preference in force on the requesting device', () => {
  it('the choice, else the role default; the regular size on a phone or tablet', async () => {
    const prefsServer = await import('../../prefs/server');
    const { viewDefaults } = await import('../views/defaults');
    const choices = vi.spyOn(prefsServer, 'readDisplayChoices');
    const hints = vi.spyOn(prefsServer, 'readDeviceHints');
    choices.mockResolvedValue({});
    hints.mockResolvedValue({ coarse: false, apple: false });
    expect(await viewDefaults('bookkeeper')).toEqual({ density: 'compact' });
    expect(await viewDefaults('owner')).toEqual({ density: 'comfortable' });
    choices.mockResolvedValue({ density: 'compact' });
    expect(await viewDefaults('owner')).toEqual({ density: 'compact' });
    hints.mockResolvedValue({ coarse: true, apple: false });
    expect(await viewDefaults('bookkeeper')).toEqual({ density: 'comfortable' });
    choices.mockRestore();
    hints.mockRestore();
  });
});
