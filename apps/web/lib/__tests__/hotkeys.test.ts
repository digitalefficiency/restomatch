import { describe, expect, it } from 'vitest';
import {
  CHORD_MS,
  HOTKEYS,
  IDLE,
  keyLabel,
  matchKeydown,
  matchKeyup,
  yieldsBracket,
  yieldsQuestionMark,
} from '../hotkeys';
import {
  handlePaletteKeydown,
  type PaletteKeyEnv,
  type PaletteKeyEvent,
  type UsePaletteOptions,
} from '../components/palette/usePalette';

const at = (pathname = '/dashboard', now = 0) => ({ pathname, now });
const input = { tagName: 'INPUT', type: 'text' } as unknown as EventTarget;

describe('hotkeys registry', () => {
  it('ids are unique and every chord is G + one letter', () => {
    const ids = HOTKEYS.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const h of HOTKEYS.filter((x) => x.chord)) {
      expect(h.keys[0]).toBe('G');
      expect(h.chord!.code).toBe(`Key${h.keys[1]}`);
      expect(h.chord!.href.startsWith('/dashboard')).toBe(true);
    }
  });
  it('Ctrl/⌘K opens the palette by code, even inside an input', () => {
    expect(matchKeydown({ code: 'KeyK', ctrlKey: true }, IDLE, at()).action).toEqual({
      type: 'palette',
    });
    expect(matchKeydown({ code: 'KeyK', metaKey: true, key: 'ל' }, IDLE, at()).action).toEqual({
      type: 'palette',
    });
    expect(matchKeydown({ code: 'KeyK', metaKey: true, target: input }, IDLE, at()).action).toEqual(
      {
        type: 'palette',
      },
    );
  });
  it('/ opens the palette; nothing else fires inside an input', () => {
    expect(matchKeydown({ code: 'Slash' }, IDLE, at()).action).toEqual({ type: 'palette' });
    expect(matchKeydown({ code: 'Slash', target: input }, IDLE, at()).action).toBeNull();
    expect(matchKeydown({ code: 'KeyG', target: input }, IDLE, at()).action).toBeNull();
    expect(
      matchKeydown({ code: 'Slash', shiftKey: true, target: input }, IDLE, at()).action,
    ).toBeNull();
  });
  it('G-chords resolve within 1,000 ms and expire after', () => {
    const g = matchKeydown({ code: 'KeyG' }, IDLE, at('/dashboard', 100));
    expect(g.action).toEqual({ type: 'chordStart' });
    expect(
      matchKeydown({ code: 'KeyI' }, g.state, at('/dashboard', 100 + CHORD_MS)).action,
    ).toEqual({
      type: 'go',
      href: '/dashboard/invoices',
    });
    expect(
      matchKeydown({ code: 'KeyI' }, g.state, at('/dashboard', 101 + CHORD_MS)).action,
    ).toBeNull();
    expect(matchKeydown({ code: 'KeyZ' }, g.state, at('/dashboard', 200)).action).toBeNull();
  });
  it('? opens the cheat sheet but yields on approvals routes (W2-04 keymap)', () => {
    expect(matchKeydown({ code: 'Slash', shiftKey: true }, IDLE, at()).action).toEqual({
      type: 'cheatSheet',
    });
    expect(
      matchKeydown({ code: 'Slash', shiftKey: true }, IDLE, at('/dashboard/approvals')).action,
    ).toBeNull();
    expect(yieldsQuestionMark('/dashboard/approvals/pay-run')).toBe(true);
    expect(yieldsQuestionMark('/dashboard/approvalsx')).toBe(false);
  });
  it('Alt hold shows hints, release hides them', () => {
    expect(matchKeydown({ code: 'AltLeft', altKey: true }, IDLE, at()).action).toEqual({
      type: 'hints',
      on: true,
    });
    expect(matchKeyup({ code: 'AltRight' })).toEqual({ type: 'hints', on: false });
  });
  it('labels Mod per platform', () => {
    expect(keyLabel('Mod', true)).toBe('⌘');
    expect(keyLabel('Mod', false)).toBe('Ctrl');
  });
});

describe('side-menu keys (sidebar SPEC §8, DS3-02)', () => {
  const off = (pathname = '/dashboard', now = 0) => ({ ...at(pathname, now), singleKeys: false });

  it('lists Ctrl/⌘B and [ as the menu toggle, and the G-chords in spec order', () => {
    expect(
      HOTKEYS.filter((h) => h.id === 'rail' || h.id === 'railBracket').map((h) => [
        h.id,
        h.group,
        h.keys,
      ]),
    ).toEqual([
      ['rail', 'general', ['Mod', 'B']],
      ['railBracket', 'general', ['[']],
    ]);
    expect(
      HOTKEYS.filter((h) => h.chord)
        .map((h) => h.keys[1])
        .join(' '),
    ).toBe('H Q A I P C L O R S B M');
  });

  it('G Q opens לטיפולי, G P the pay run, G B the chain overview', () => {
    const g = matchKeydown({ code: 'KeyG' }, IDLE, at('/dashboard', 100)).state;
    expect(matchKeydown({ code: 'KeyQ' }, g, at('/dashboard', 200)).action).toEqual({
      type: 'go',
      href: '/dashboard#needs-you-title',
    });
    expect(matchKeydown({ code: 'KeyP' }, g, at('/dashboard', 200)).action).toEqual({
      type: 'go',
      href: '/dashboard/approvals/pay-run',
    });
    expect(matchKeydown({ code: 'KeyB' }, g, at('/dashboard', 200)).action).toEqual({
      type: 'go',
      href: '/dashboard/chain',
    });
  });

  it('Ctrl/⌘B toggles the menu by code (Hebrew נ), never while typing', () => {
    expect(matchKeydown({ code: 'KeyB', ctrlKey: true }, IDLE, at()).action).toEqual({
      type: 'rail',
    });
    expect(matchKeydown({ code: 'KeyB', metaKey: true, key: 'נ' }, IDLE, at()).action).toEqual({
      type: 'rail',
    });
    expect(
      matchKeydown({ code: 'KeyB', ctrlKey: true, target: input }, IDLE, at()).action,
    ).toBeNull();
    expect(
      matchKeydown({ code: 'KeyB', ctrlKey: true, shiftKey: true }, IDLE, at()).action,
    ).toBeNull();
    expect(
      matchKeydown({ code: 'KeyB', ctrlKey: true, altKey: true }, IDLE, at()).action,
    ).toBeNull();
  });

  it('[ toggles the menu by the physical key; with any modifier or while typing it does not', () => {
    expect(matchKeydown({ code: 'BracketLeft' }, IDLE, at()).action).toEqual({ type: 'rail' });
    expect(matchKeydown({ code: 'BracketLeft', key: ']' }, IDLE, at()).action).toEqual({
      type: 'rail',
    });
    expect(matchKeydown({ code: 'BracketLeft', shiftKey: true }, IDLE, at()).action).toBeNull();
    expect(matchKeydown({ code: 'BracketLeft', ctrlKey: true }, IDLE, at()).action).toBeNull();
    expect(matchKeydown({ code: 'BracketLeft', metaKey: true }, IDLE, at()).action).toBeNull();
    expect(matchKeydown({ code: 'BracketLeft', altKey: true }, IDLE, at()).action).toBeNull();
    expect(matchKeydown({ code: 'BracketLeft', target: input }, IDLE, at()).action).toBeNull();
  });

  it('Ctrl/⌘B during a pending G toggles the menu and drops the chord', () => {
    const g = matchKeydown({ code: 'KeyG' }, IDLE, at('/dashboard', 100)).state;
    expect(matchKeydown({ code: 'KeyB', ctrlKey: true }, g, at('/dashboard', 200))).toEqual({
      action: { type: 'rail' },
      state: IDLE,
    });
  });

  it('[ yields on the invoice cockpit (W2-02 [ / ] stepping); Ctrl/⌘B still toggles there', () => {
    const cockpit = at('/dashboard/invoices/inv-1');
    expect(matchKeydown({ code: 'BracketLeft' }, IDLE, cockpit)).toEqual({
      action: null,
      state: IDLE,
    });
    expect(matchKeydown({ code: 'KeyB', ctrlKey: true }, IDLE, cockpit).action).toEqual({
      type: 'rail',
    });
    expect(yieldsBracket('/dashboard/invoices/inv-1')).toBe(true);
    expect(yieldsBracket('/dashboard/invoices')).toBe(false);
    expect(yieldsBracket('/dashboard/invoicesx')).toBe(false);
    expect(matchKeydown({ code: 'BracketLeft' }, IDLE, at('/dashboard/invoices')).action).toEqual({
      type: 'rail',
    });
  });

  it('single keys off (WCAG 2.1.4): /, ?, [ and G-chords stop; Ctrl/⌘K, Ctrl/⌘B and Alt stay', () => {
    expect(matchKeydown({ code: 'Slash' }, IDLE, off()).action).toBeNull();
    expect(
      matchKeydown({ code: 'Digit7', key: '/', shiftKey: true }, IDLE, off()).action,
    ).toBeNull();
    expect(matchKeydown({ code: 'Slash', shiftKey: true }, IDLE, off()).action).toBeNull();
    expect(matchKeydown({ code: 'BracketLeft' }, IDLE, off()).action).toBeNull();
    expect(matchKeydown({ code: 'KeyG' }, IDLE, off())).toEqual({ action: null, state: IDLE });
    // A G pressed while they were on does not finish after the switch goes off.
    const g = matchKeydown({ code: 'KeyG' }, IDLE, at('/dashboard', 100)).state;
    expect(matchKeydown({ code: 'KeyI' }, g, off('/dashboard', 200)).action).toBeNull();

    expect(matchKeydown({ code: 'KeyK', ctrlKey: true }, IDLE, off()).action).toEqual({
      type: 'palette',
    });
    expect(matchKeydown({ code: 'KeyB', metaKey: true }, IDLE, off()).action).toEqual({
      type: 'rail',
    });
    expect(matchKeydown({ code: 'AltLeft', altKey: true }, IDLE, off()).action).toEqual({
      type: 'hints',
      on: true,
    });
    expect(matchKeydown({ code: 'Slash' }, IDLE, { ...at(), singleKeys: true }).action).toEqual({
      type: 'palette',
    });
  });

  it('a pending G wins over /: Hebrew KeyQ types "/", so G Q goes to the queue, never the palette', () => {
    const g = matchKeydown({ code: 'KeyG', key: 'ע' }, IDLE, at('/dashboard', 100));
    expect(g.action).toEqual({ type: 'chordStart' });
    const q = matchKeydown({ code: 'KeyQ', key: '/' }, g.state, at('/dashboard', 300));
    expect(q.action).toEqual({ type: 'go', href: '/dashboard#needs-you-title' });
    expect(q.state).toEqual(IDLE);
    // The order itself: the pending G takes even the real Slash key (an unbound chord).
    expect(matchKeydown({ code: 'Slash' }, g.state, at('/dashboard', 300))).toEqual({
      action: null,
      state: IDLE,
    });
  });

  it('a shifted key never finishes a chord, so G then ? still opens the cheat sheet', () => {
    const g = matchKeydown({ code: 'KeyG' }, IDLE, at('/dashboard', 100)).state;
    expect(matchKeydown({ code: 'Slash', shiftKey: true }, g, at('/dashboard', 200))).toEqual({
      action: { type: 'cheatSheet' },
      state: IDLE,
    });
    // In a browser the Shift keydown arrives first, and it already ends the chord.
    expect(
      matchKeydown({ code: 'ShiftLeft', key: 'Shift', shiftKey: true }, g, at('/dashboard', 150)),
    ).toEqual({ action: null, state: IDLE });
  });

  it('/ also binds on key "/" from a non-letter key (German Shift+7), never from a letter key', () => {
    expect(matchKeydown({ code: 'Digit7', key: '/', shiftKey: true }, IDLE, at()).action).toEqual({
      type: 'palette',
    });
    expect(matchKeydown({ code: 'NumpadDivide', key: '/' }, IDLE, at()).action).toEqual({
      type: 'palette',
    });
    expect(matchKeydown({ code: 'KeyQ', key: '/' }, IDLE, at())).toEqual({
      action: null,
      state: IDLE,
    });
    // An expired G does not turn KeyQ back into "/" either.
    const g = matchKeydown({ code: 'KeyG' }, IDLE, at('/dashboard', 100)).state;
    expect(
      matchKeydown({ code: 'KeyQ', key: '/' }, g, at('/dashboard', 101 + CHORD_MS)).action,
    ).toBeNull();
  });
});

describe('the palette hook acts on the registry (usePalette → handlePaletteKeydown)', () => {
  /** The hook's keydown path with fake options, state and page (no DOM, no React). */
  function hook(over: Partial<UsePaletteOptions> = {}) {
    const log = { go: [] as string[], rail: 0 };
    const ui = { open: false, cheat: false, hints: false };
    const page = { modal: false };
    const latest = {
      current: {
        pathname: '/dashboard',
        canGo: () => true,
        go: (href: string) => {
          log.go.push(href);
        },
        onRail: () => {
          log.rail += 1;
        },
        ...over,
      } as UsePaletteOptions,
    };
    const env: PaletteKeyEnv = {
      latest,
      chord: { current: IDLE },
      setOpen: (update) => {
        ui.open = update(ui.open);
      },
      setCheatOpen: (on) => {
        ui.cheat = on;
      },
      setHints: (on) => {
        ui.hints = on;
      },
      modalOpen: () => page.modal,
    };
    /** Presses one key; true when the app took it from the browser (preventDefault). */
    const press = (e: Omit<PaletteKeyEvent, 'timeStamp' | 'preventDefault'>, timeStamp = 0) => {
      let prevented = false;
      handlePaletteKeydown(
        {
          ...e,
          timeStamp,
          preventDefault: () => {
            prevented = true;
          },
        },
        env,
      );
      return prevented;
    };
    return { latest, page, ui, log, press };
  }

  it('Ctrl/⌘B and [ call onRail and take the key from the browser', () => {
    const h = hook();
    expect(h.press({ code: 'KeyB', ctrlKey: true })).toBe(true);
    expect(h.press({ code: 'BracketLeft' })).toBe(true);
    expect(h.log.rail).toBe(2);
  });

  it('a modal dialog (an open <dialog>, a desk Peek) keeps the menu still and the key unhandled', () => {
    const h = hook();
    h.page.modal = true;
    expect(h.press({ code: 'KeyB', metaKey: true })).toBe(false);
    expect(h.press({ code: 'BracketLeft' })).toBe(false);
    expect(h.log.rail).toBe(0);
    h.page.modal = false;
    expect(h.press({ code: 'BracketLeft' })).toBe(true);
    expect(h.log.rail).toBe(1);
  });

  it('without onRail, Ctrl/⌘B and [ stay the browser’s', () => {
    const h = hook({ onRail: undefined });
    expect(h.press({ code: 'KeyB', ctrlKey: true })).toBe(false);
    expect(h.press({ code: 'BracketLeft' })).toBe(false);
  });

  it('a held key (repeat) never toggles the menu again', () => {
    const h = hook();
    expect(h.press({ code: 'BracketLeft', repeat: true })).toBe(false);
    expect(h.press({ code: 'KeyB', ctrlKey: true, repeat: true })).toBe(false);
    expect(h.log.rail).toBe(0);
  });

  it('the single-key switch reaches the registry, and a flipped switch applies from the next key', () => {
    const h = hook({ singleKeys: false });
    expect(h.press({ code: 'Slash' })).toBe(false);
    expect(h.press({ code: 'BracketLeft' })).toBe(false);
    expect(h.press({ code: 'KeyG' }, 100)).toBe(false);
    expect(h.press({ code: 'KeyA' }, 200)).toBe(false);
    expect(h.ui.open).toBe(false);
    expect(h.log).toEqual({ go: [], rail: 0 });
    // Ctrl/⌘ combinations and the Alt hints stay on.
    expect(h.press({ code: 'KeyK', ctrlKey: true })).toBe(true);
    expect(h.ui.open).toBe(true);
    expect(h.press({ code: 'KeyB', ctrlKey: true })).toBe(true);
    expect(h.log.rail).toBe(1);
    h.press({ code: 'AltLeft', altKey: true });
    expect(h.ui.hints).toBe(true);

    h.latest.current = { ...h.latest.current, singleKeys: true };
    expect(h.press({ code: 'BracketLeft' })).toBe(true);
    expect(h.log.rail).toBe(2);
  });

  it('Ctrl/⌘K toggles the palette, / only opens it, and both close the cheat sheet', () => {
    const h = hook();
    expect(h.press({ code: 'Slash', shiftKey: true })).toBe(true);
    expect(h.ui.cheat).toBe(true);
    expect(h.press({ code: 'Slash' })).toBe(true);
    expect(h.ui).toMatchObject({ open: true, cheat: false });
    expect(h.press({ code: 'Slash' })).toBe(true);
    expect(h.ui.open).toBe(true);
    expect(h.press({ code: 'KeyK', metaKey: true })).toBe(true);
    expect(h.ui.open).toBe(false);
  });

  it('a G-chord goes only where canGo allows; elsewhere the key stays the browser’s', () => {
    const h = hook({ canGo: (href) => href !== '/dashboard/approvals/pay-run' });
    h.press({ code: 'KeyG' }, 100);
    expect(h.press({ code: 'KeyQ', key: '/' }, 200)).toBe(true);
    expect(h.ui.open).toBe(false);
    h.press({ code: 'KeyG' }, 300);
    expect(h.press({ code: 'KeyP' }, 400)).toBe(false);
    expect(h.log.go).toEqual(['/dashboard#needs-you-title']);
  });
});
