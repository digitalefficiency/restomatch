import { beforeEach, describe, expect, it, vi } from 'vitest';

// The single-key preference is DS3-06's store (R1): the handlers must ask it at every keydown. The mock counts the
// questions and lets a test flip the answer between two keydowns.
const store = vi.hoisted(() => ({ singleKeys: true }));
vi.mock('@/lib/prefs', () => ({ singleKeysEnabled: vi.fn(() => store.singleKeys) }));

import { singleKeysEnabled } from '@/lib/prefs';
import type { DeskController, QueueItem, QueueSummary } from '../desk-types';
import { evidenceKeyDown, rowsKeyDown, useDeskKeys, type DeskKeyEvent, type DeskKeysOptions } from '../use-desk-keys';

/**
 * DS3-04 S3a fix round: the desk's key handlers (use-desk-keys.ts), through their pure cores, on a tiny structural DOM
 * (node vitest has no DOM). Pins: the store is asked once per keydown and never cached; a decision key on a row that
 * is not current never decides the current gap; J/K step from the focused row; Enter / O goes through the controller's
 * focus chain; no key acts from outside its own region or while a sheet is open.
 */

const asked = vi.mocked(singleKeysEnabled);

/** A structural element: attributes, a parent, children; `closest` / `querySelector` for `[attr]` and `[attr="v"]`. */
class FakeEl {
  readonly children: FakeEl[] = [];
  parent: FakeEl | null = null;
  disabled = false;
  readonly focus = vi.fn();
  constructor(
    readonly tagName: string,
    readonly attrs: Record<string, string> = {},
    readonly type?: string,
  ) {}
  append(...kids: FakeEl[]): this {
    for (const k of kids) {
      k.parent = this;
      this.children.push(k);
    }
    return this;
  }
  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }
  matches(selector: string): boolean {
    const m = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(selector);
    if (!m) throw new Error(`FakeEl: unsupported selector ${selector}`);
    const value = this.attrs[m[1]!];
    return value !== undefined && (m[2] === undefined || value === m[2]);
  }
  closest(selector: string): FakeEl | null {
    if (this.matches(selector)) return this;
    return this.parent ? this.parent.closest(selector) : null;
  }
  querySelector(selector: string): FakeEl | null {
    for (const k of this.children) {
      if (k.matches(selector)) return k;
      const deep = k.querySelector(selector);
      if (deep) return deep;
    }
    return null;
  }
  contains(node: unknown): boolean {
    for (let e = node as FakeEl | null; e; e = e.parent) if (e === this) return true;
    return false;
  }
}

/** The desk: three rows (checkbox cell, summary cell) in [data-desk-rows], RTL; the evidence with its heading and bar;
 *  a chip of a sheet rendered as a portal (outside both regions). */
function deskDom() {
  const page = new FakeEl('DIV', { dir: 'rtl', 'data-desk': '' });
  const rows = new FakeEl('DIV', { 'data-desk-rows': '' });
  const mkRow = (id: string) => {
    const check = new FakeEl('INPUT', { 'data-row-check': '', 'data-testid': 'card-select' }, 'checkbox');
    const cell = new FakeEl('DIV', { role: 'gridcell', 'data-row-id': id });
    const row = new FakeEl('DIV', { role: 'row' }).append(new FakeEl('DIV', { role: 'gridcell' }).append(check), cell);
    rows.append(row);
    return { row, check, cell };
  };
  const A = mkRow('A');
  const B = mkRow('B');
  const C = mkRow('C');
  const loadMore = new FakeEl('BUTTON', { 'data-testid': 'load-more' });
  rows.append(loadMore);
  const heading = new FakeEl('H2', { 'data-desk-heading': '' });
  const primary = new FakeEl('BUTTON', { 'data-desk-primary': '' });
  const bar = new FakeEl('DIV', { 'data-testid': 'decision-bar' }).append(primary);
  const evidence = new FakeEl('DIV', { 'data-desk-evidence': '' }).append(heading, bar);
  page.append(rows, evidence);
  const sheetChip = new FakeEl('BUTTON', { 'data-sheet-chip': '' });
  new FakeEl('DIALOG', {}).append(sheetChip);
  return { rows, A, B, C, loadMore, evidence, heading, bar, primary, sheetChip };
}

type KeyEvent = DeskKeyEvent & { preventDefault: ReturnType<typeof vi.fn> };
function keydown(
  code: string,
  target: FakeEl,
  region: FakeEl,
  o: { shiftKey?: boolean; ctrlKey?: boolean; repeat?: boolean; isComposing?: boolean; defaultPrevented?: boolean } = {},
): KeyEvent {
  return {
    code,
    key: '',
    shiftKey: o.shiftKey ?? false,
    ctrlKey: o.ctrlKey ?? false,
    metaKey: false,
    altKey: false,
    repeat: o.repeat ?? false,
    target: target as unknown as EventTarget,
    currentTarget: region as unknown as EventTarget,
    defaultPrevented: o.defaultPrevented ?? false,
    nativeEvent: { isComposing: o.isComposing ?? false },
    preventDefault: vi.fn(),
  };
}

const SUMMARY = { count: 3 } as unknown as QueueSummary;
const gap = (id: string) => ({ id }) as unknown as QueueItem;

/** A plain-object controller: every intent a spy. */
function controller(o: Partial<DeskController> = {}): DeskController {
  return {
    mode: 'desk',
    rows: [],
    tiers: [],
    live: [],
    current: gap('A'),
    currentState: 'open',
    next: gap('B'),
    position: null,
    canPrev: false,
    canNext: true,
    summary: SUMMARY,
    hasMore: false,
    loadingMore: false,
    siblings: [],
    note: null,
    elsewhereText: null,
    asking: null,
    undo: null,
    announcement: '',
    selection: { ids: new Set(), rows: [], sumAgorot: 0, disabled: false, reason: null, note: null, busy: false },
    escalateFor: null,
    keysOpen: false,
    focus: null,
    motion: null,
    select: vi.fn(),
    move: vi.fn(),
    claim: vi.fn(),
    openReasons: vi.fn(),
    closeReasons: vi.fn(),
    pay: vi.fn(),
    requestEscalate: vi.fn(),
    escalate: vi.fn(),
    closeEscalate: vi.fn(),
    undoLast: vi.fn(),
    expireUndo: vi.fn(),
    toggleChecked: vi.fn(),
    clearChecked: vi.fn(),
    approveChecked: vi.fn(),
    approveInvoice: vi.fn(),
    hideElsewhere: vi.fn(),
    retry: vi.fn(),
    loadMore: vi.fn(),
    setKeysOpen: vi.fn(),
    focusQueue: vi.fn(),
    focusHeading: vi.fn(),
    consumeFocus: vi.fn(),
    ...o,
  };
}

const DESK: DeskKeysOptions = { mode: 'desk', wide: true };
const NARROW: DeskKeysOptions = { mode: 'desk', wide: false };
const LIVE_UNDO = { text: 't', sentAt: 1, capAt: 2, instant: true, failed: false, busy: false, ids: ['Z'], bulk: false };

beforeEach(() => {
  store.singleKeys = true;
  asked.mockClear();
});

describe('the single-key store is asked once per keydown, never cached (R1)', () => {
  it('every keydown that reaches the key map asks exactly once — rows and evidence alike', () => {
    const dom = deskDom();
    const c = controller();
    const keys: Array<[string, FakeEl]> = [
      ['KeyJ', dom.A.cell],
      ['ArrowDown', dom.A.cell],
      ['Digit1', dom.A.cell],
      ['KeyQ', dom.A.cell], // no action: still one question
      ['KeyX', dom.B.check],
    ];
    keys.forEach(([code, target], i) => {
      rowsKeyDown(keydown(code, target, dom.rows), c, DESK);
      expect(asked).toHaveBeenCalledTimes(i + 1);
    });
    evidenceKeyDown(keydown('Digit1', dom.primary, dom.evidence), c, DESK);
    evidenceKeyDown(keydown('KeyK', dom.heading, dom.evidence), c, NARROW);
    expect(asked).toHaveBeenCalledTimes(keys.length + 2);
  });
  it('the answer is read at each keydown: off → 1 does nothing, arrows still move; on again → 1 acts', () => {
    const dom = deskDom();
    const c = controller();
    store.singleKeys = false;
    const off = keydown('Digit1', dom.A.cell, dom.rows);
    rowsKeyDown(off, c, DESK);
    expect(c.claim).not.toHaveBeenCalled();
    expect(off.preventDefault).not.toHaveBeenCalled();
    rowsKeyDown(keydown('ArrowDown', dom.A.cell, dom.rows), c, DESK);
    expect(c.move).toHaveBeenCalledWith(1, 'key', 'key', undefined);
    store.singleKeys = true;
    const on = keydown('Digit1', dom.A.cell, dom.rows);
    rowsKeyDown(on, c, DESK);
    expect(c.claim).toHaveBeenCalledWith('key', 'queue');
    expect(on.preventDefault).toHaveBeenCalledTimes(1);
  });
  it('a keydown turned away before the key map (outside a row, a sheet open, typing) does not ask', () => {
    const dom = deskDom();
    rowsKeyDown(keydown('Digit1', dom.loadMore, dom.rows), controller(), DESK);
    rowsKeyDown(keydown('Digit1', dom.A.cell, dom.rows), controller({ keysOpen: true }), DESK);
    rowsKeyDown(keydown('Digit1', dom.A.cell, dom.rows, { isComposing: true }), controller(), DESK);
    evidenceKeyDown(keydown('Digit1', dom.primary, dom.evidence, { defaultPrevented: true }), controller(), DESK);
    expect(asked).not.toHaveBeenCalled();
  });
  it('useDeskKeys hands out the same cores', () => {
    const dom = deskDom();
    const c = controller();
    const { onRowsKeyDown, onEvidenceKeyDown } = useDeskKeys(c, DESK);
    onRowsKeyDown(keydown('Digit1', dom.A.cell, dom.rows) as unknown as React.KeyboardEvent<HTMLElement>);
    onEvidenceKeyDown(keydown('Digit2', dom.primary, dom.evidence) as unknown as React.KeyboardEvent<HTMLElement>);
    expect(c.claim).toHaveBeenCalledWith('key', 'queue');
    expect(c.openReasons).toHaveBeenCalledWith('key', 'bar');
    expect(asked).toHaveBeenCalledTimes(2);
  });
});

describe('a decision key on a row that is not current never decides the current gap', () => {
  it('1 / 2 / 3 on another row’s checkbox: nothing, and the key is not taken (no preventDefault)', () => {
    const dom = deskDom();
    const c = controller(); // current = A
    for (const code of ['Digit1', 'Digit2', 'Digit3', 'Numpad1']) {
      const e = keydown(code, dom.B.check, dom.rows);
      rowsKeyDown(e, c, DESK);
      expect(e.preventDefault, code).not.toHaveBeenCalled();
    }
    expect(c.claim).not.toHaveBeenCalled();
    expect(c.openReasons).not.toHaveBeenCalled();
    expect(c.requestEscalate).not.toHaveBeenCalled();
  });
  it('… nor on another row’s summary cell (a done row clicked keeps the current gap, Q4)', () => {
    const dom = deskDom();
    const c = controller();
    rowsKeyDown(keydown('Digit1', dom.C.cell, dom.rows), c, DESK);
    rowsKeyDown(keydown('Digit2', dom.C.cell, dom.rows), c, DESK);
    rowsKeyDown(keydown('Digit3', dom.C.cell, dom.rows), c, DESK);
    expect(c.claim).not.toHaveBeenCalled();
    expect(c.openReasons).not.toHaveBeenCalled();
    expect(c.requestEscalate).not.toHaveBeenCalled();
  });
  it('no current gap at all: a decision key decides nothing', () => {
    const dom = deskDom();
    const c = controller({ current: null, currentState: null });
    rowsKeyDown(keydown('Digit1', dom.A.cell, dom.rows), c, DESK);
    expect(c.claim).not.toHaveBeenCalled();
  });
  it('on the current row — its summary cell or its own checkbox — 1 / 2 / 3 act (origin queue)', () => {
    const dom = deskDom();
    const c = controller();
    const one = keydown('Digit1', dom.A.cell, dom.rows);
    rowsKeyDown(one, c, DESK);
    expect(c.claim).toHaveBeenCalledWith('key', 'queue');
    expect(one.preventDefault).toHaveBeenCalledTimes(1);
    rowsKeyDown(keydown('Digit2', dom.A.check, dom.rows), c, DESK);
    expect(c.openReasons).toHaveBeenCalledWith('key', 'queue');
    rowsKeyDown(keydown('Digit3', dom.A.cell, dom.rows), c, DESK);
    expect(c.requestEscalate).toHaveBeenCalledWith('queue');
  });
  it('J / K / ↑ / ↓ step from the focused row: another row’s → `from` it; the current row’s → from current', () => {
    const dom = deskDom();
    const c = controller();
    rowsKeyDown(keydown('KeyJ', dom.B.check, dom.rows), c, DESK);
    expect(c.move).toHaveBeenLastCalledWith(1, 'key', 'key', 'B');
    rowsKeyDown(keydown('ArrowUp', dom.C.cell, dom.rows), c, DESK);
    expect(c.move).toHaveBeenLastCalledWith(-1, 'key', 'key', 'C');
    rowsKeyDown(keydown('KeyK', dom.A.cell, dom.rows), c, DESK);
    expect(c.move).toHaveBeenLastCalledWith(-1, 'key', 'key', undefined);
    rowsKeyDown(keydown('KeyJ', dom.A.cell, dom.rows, { repeat: true }), c, DESK); // a held J still moves
    expect(c.move).toHaveBeenLastCalledWith(1, 'key', 'key', undefined);
  });
  it('X toggles the focused row’s checkbox; Z, ? and Esc are not row decisions and act from any row', () => {
    const dom = deskDom();
    const c = controller({ undo: LIVE_UNDO, selection: { ...controller().selection, ids: new Set(['B']) } });
    rowsKeyDown(keydown('KeyX', dom.B.check, dom.rows), c, DESK);
    expect(c.toggleChecked).toHaveBeenCalledWith('B');
    rowsKeyDown(keydown('KeyZ', dom.B.check, dom.rows), c, DESK);
    expect(c.undoLast).toHaveBeenCalledWith('key');
    rowsKeyDown(keydown('Slash', dom.B.cell, dom.rows, { shiftKey: true }), c, DESK);
    expect(c.setKeysOpen).toHaveBeenCalledWith(true);
    rowsKeyDown(keydown('Escape', dom.B.check, dom.rows), c, DESK);
    expect(c.clearChecked).toHaveBeenCalledTimes(1);
  });
});

describe('Enter / O: the evidence heading through the controller (§5.2 {to:"heading"})', () => {
  it('on the current row → focusHeading(current); on another row → focusHeading(that row)', () => {
    const dom = deskDom();
    const c = controller();
    const enter = keydown('Enter', dom.A.cell, dom.rows);
    rowsKeyDown(enter, c, DESK);
    expect(c.focusHeading).toHaveBeenLastCalledWith('A');
    expect(enter.preventDefault).toHaveBeenCalledTimes(1);
    rowsKeyDown(keydown('KeyO', dom.B.cell, dom.rows), c, DESK);
    expect(c.focusHeading).toHaveBeenLastCalledWith('B');
    expect(c.select).not.toHaveBeenCalled(); // the controller selects; the handler moves no focus itself
    expect(dom.heading.focus).not.toHaveBeenCalled();
  });
  it('a controller without focusHeading (an older plain object): the key is left alone', () => {
    const dom = deskDom();
    const c = controller({ focusHeading: undefined });
    const e = keydown('Enter', dom.A.cell, dom.rows);
    rowsKeyDown(e, c, DESK);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(dom.heading.focus).not.toHaveBeenCalled();
  });
});

describe('a key acts only from inside its own region, and never while a sheet is open', () => {
  it('a key from a portal (a sheet’s chip bubbling through the React tree) does nothing', () => {
    const dom = deskDom();
    const c = controller();
    const viaPortal = keydown('Digit1', dom.sheetChip, dom.evidence);
    evidenceKeyDown(viaPortal, c, NARROW);
    rowsKeyDown(keydown('Digit1', dom.sheetChip, dom.rows), c, DESK);
    expect(c.claim).not.toHaveBeenCalled();
    expect(viaPortal.preventDefault).not.toHaveBeenCalled();
  });
  it('the escalate sheet or the keys help open → 1 / 2 / 3 / Esc / Z are theirs, not the desk’s', () => {
    const dom = deskDom();
    for (const open of [
      { escalateFor: { row: gap('A'), origin: 'bar' as const } },
      { keysOpen: true },
    ]) {
      const c = controller({ ...open, undo: LIVE_UNDO });
      for (const code of ['Digit1', 'Digit2', 'Digit3', 'Escape', 'KeyZ']) {
        evidenceKeyDown(keydown(code, dom.primary, dom.evidence), c, DESK);
        evidenceKeyDown(keydown(code, dom.heading, dom.evidence), c, NARROW);
        rowsKeyDown(keydown(code, dom.A.cell, dom.rows), c, DESK);
      }
      expect(c.claim).not.toHaveBeenCalled();
      expect(c.openReasons).not.toHaveBeenCalled();
      expect(c.requestEscalate).not.toHaveBeenCalled();
      expect(c.undoLast).not.toHaveBeenCalled();
      expect(c.focusQueue).not.toHaveBeenCalled();
      expect(c.closeReasons).not.toHaveBeenCalled();
    }
  });
  it('rows: a target outside any row (LoadMore) or the landing (single mode) → nothing', () => {
    const dom = deskDom();
    const c = controller();
    rowsKeyDown(keydown('Digit1', dom.loadMore, dom.rows), c, DESK);
    rowsKeyDown(keydown('Digit1', dom.A.cell, dom.rows), c, { mode: 'single', wide: true });
    expect(c.claim).not.toHaveBeenCalled();
  });
});

describe('the evidence region (§5.2)', () => {
  it('at the desk: every action from the bar (R15); elsewhere only Z and Esc', () => {
    const dom = deskDom();
    const c = controller({ undo: LIVE_UNDO });
    evidenceKeyDown(keydown('Digit1', dom.primary, dom.evidence), c, DESK);
    expect(c.claim).toHaveBeenCalledWith('key', 'bar');
    evidenceKeyDown(keydown('KeyJ', dom.primary, dom.evidence), c, DESK);
    expect(c.move).toHaveBeenCalledWith(1, 'key', 'key');
    const off = keydown('Digit2', dom.heading, dom.evidence);
    evidenceKeyDown(off, c, DESK);
    expect(c.openReasons).not.toHaveBeenCalled();
    expect(off.preventDefault).not.toHaveBeenCalled();
    evidenceKeyDown(keydown('KeyZ', dom.heading, dom.evidence), c, DESK);
    expect(c.undoLast).toHaveBeenCalledWith('key');
    evidenceKeyDown(keydown('Escape', dom.heading, dom.evidence), c, DESK);
    expect(c.focusQueue).toHaveBeenCalledTimes(1);
  });
  it('narrow / landing: anywhere in the evidence; arrows stay native; Esc without asking is left alone', () => {
    const dom = deskDom();
    const c = controller();
    evidenceKeyDown(keydown('Digit3', dom.heading, dom.evidence), c, NARROW);
    expect(c.requestEscalate).toHaveBeenCalledWith('bar');
    const arrow = keydown('ArrowDown', dom.heading, dom.evidence);
    evidenceKeyDown(arrow, c, NARROW);
    expect(c.move).not.toHaveBeenCalled();
    expect(arrow.preventDefault).not.toHaveBeenCalled();
    const esc = keydown('Escape', dom.heading, dom.evidence);
    evidenceKeyDown(esc, c, { mode: 'single', wide: true });
    expect(c.focusQueue).not.toHaveBeenCalled();
    expect(esc.preventDefault).not.toHaveBeenCalled();
  });
  it('asking: only Escape, which closes the reasons row', () => {
    const dom = deskDom();
    const c = controller({ asking: { id: 'A', origin: 'bar' } });
    evidenceKeyDown(keydown('Digit1', dom.primary, dom.evidence), c, DESK);
    expect(c.claim).not.toHaveBeenCalled();
    evidenceKeyDown(keydown('Escape', dom.primary, dom.evidence), c, DESK);
    expect(c.closeReasons).toHaveBeenCalledTimes(1);
  });
  it('Z with no live undo, or a failed one, is left alone', () => {
    const dom = deskDom();
    const none = keydown('KeyZ', dom.heading, dom.evidence);
    evidenceKeyDown(none, controller(), DESK);
    expect(none.preventDefault).not.toHaveBeenCalled();
    const failed = controller({ undo: { ...LIVE_UNDO, failed: true } });
    evidenceKeyDown(keydown('KeyZ', dom.heading, dom.evidence), failed, DESK);
    expect(failed.undoLast).not.toHaveBeenCalled();
  });
});

describe('←/→ inside a row by the physical key (RTL: right = the checkbox cell)', () => {
  it('→ on the summary cell focuses the checkbox; ← on the checkbox focuses the summary cell', () => {
    const dom = deskDom();
    const c = controller();
    rowsKeyDown(keydown('ArrowRight', dom.A.cell, dom.rows), c, DESK);
    expect(dom.A.check.focus).toHaveBeenCalledTimes(1);
    rowsKeyDown(keydown('ArrowLeft', dom.A.check, dom.rows), c, DESK);
    expect(dom.A.cell.focus).toHaveBeenCalledTimes(1);
  });
  it('a disabled checkbox (a block or VAT row) keeps focus where it is', () => {
    const dom = deskDom();
    dom.B.check.disabled = true;
    rowsKeyDown(keydown('ArrowRight', dom.B.cell, dom.rows), controller(), DESK);
    expect(dom.B.check.focus).not.toHaveBeenCalled();
  });
});
