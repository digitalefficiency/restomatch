import { describe, expect, it } from 'vitest';
import { deskActionOf, deskKeyOf, isTypingTarget, moveIndex, type DeskActionOptions, type KeyLike } from '../keys';

describe('desk keys bind by KeyboardEvent.code', () => {
  it('J/K work on a Hebrew layout (key = ח/ל, code = KeyJ/KeyK)', () => {
    expect(deskKeyOf({ code: 'KeyJ', key: 'ח' })).toBe('next');
    expect(deskKeyOf({ code: 'KeyK', key: 'ל' })).toBe('prev');
    expect(deskKeyOf({ code: 'KeyX', key: 'ס' })).toBe('select');
  });
  it('a Hebrew letter on another physical key does nothing', () => {
    expect(deskKeyOf({ code: 'KeyY', key: 'ט' })).toBeNull();
  });
  it('maps Space, Enter, Ctrl/⌘+Enter, Esc and the arrows', () => {
    expect(deskKeyOf({ code: 'Space', key: ' ' })).toBe('peek');
    expect(deskKeyOf({ code: 'Enter' })).toBe('open');
    expect(deskKeyOf({ code: 'Enter', metaKey: true })).toBe('openTab');
    expect(deskKeyOf({ code: 'Enter', ctrlKey: true })).toBe('openTab');
    expect(deskKeyOf({ code: 'Escape' })).toBe('escape');
    expect(deskKeyOf({ code: 'ArrowDown' })).toBe('next');
    expect(deskKeyOf({ code: 'ArrowUp' })).toBe('prev');
  });
  it('never fires with a modifier (Ctrl+J, Alt+K) or while typing', () => {
    expect(deskKeyOf({ code: 'KeyJ', ctrlKey: true })).toBeNull();
    expect(deskKeyOf({ code: 'KeyK', altKey: true })).toBeNull();
    const input = { tagName: 'INPUT', type: 'search' } as unknown as EventTarget;
    expect(deskKeyOf({ code: 'KeyJ', target: input })).toBeNull();
    expect(deskKeyOf({ code: 'Space', target: { tagName: 'TEXTAREA' } as unknown as EventTarget })).toBeNull();
    expect(deskKeyOf({ code: 'KeyJ', target: { isContentEditable: true } as unknown as EventTarget })).toBeNull();
  });
  it('a row checkbox is not a typing target', () => {
    expect(isTypingTarget({ tagName: 'INPUT', type: 'checkbox' } as unknown as EventTarget)).toBe(false);
  });
  it('moves within the list without wrapping', () => {
    expect(moveIndex(-1, 1, 5)).toBe(0);
    expect(moveIndex(-1, -1, 5)).toBe(4);
    expect(moveIndex(4, 1, 5)).toBe(4);
    expect(moveIndex(0, -1, 5)).toBe(0);
    expect(moveIndex(2, 1, 0)).toBe(-1);
  });
});

/* DS3-04 §2.3 / §5.2: the approvals desk's decision keys. `singleKeys` is passed as a literal: deskActionOf stays
   pure (the handler asks DS3-06's store, singleKeysEnabled(), at every keydown; the store has its own tests). */
describe('deskActionOf (the approvals desk)', () => {
  const rows: DeskActionOptions = { singleKeys: true, asking: false, region: 'rows' };
  const evidence: DeskActionOptions = { singleKeys: true, asking: false, region: 'evidence' };
  const act = (e: KeyLike, o: Partial<DeskActionOptions> = {}) => deskActionOf(e, { ...rows, ...o });
  const target = (el: Record<string, unknown>) => el as unknown as EventTarget;

  it('J/K/1/2/3/Z/X/O bind by code, so they work on a Hebrew layout', () => {
    expect(act({ code: 'KeyJ', key: 'ח' })).toBe('next');
    expect(act({ code: 'KeyK', key: 'ל' })).toBe('prev');
    expect(act({ code: 'Digit1', key: '1' })).toBe('claim');
    expect(act({ code: 'Digit2', key: '2' })).toBe('pay');
    expect(act({ code: 'Digit3', key: '3' })).toBe('escalate');
    expect(act({ code: 'KeyZ', key: 'ז' })).toBe('undo');
    expect(act({ code: 'KeyX', key: 'ס' })).toBe('select');
    expect(act({ code: 'KeyO', key: 'ם' })).toBe('open');
    expect(act({ code: 'Numpad1', key: '1' })).toBe('claim');
    expect(act({ code: 'Numpad2' })).toBe('pay');
    expect(act({ code: 'Numpad3' })).toBe('escalate');
    expect(act({ code: 'KeyY', key: 'ט' })).toBeNull();
  });

  it('the arrows, Enter and Esc in the rows', () => {
    expect(act({ code: 'ArrowDown' })).toBe('next');
    expect(act({ code: 'ArrowUp' })).toBe('prev');
    expect(act({ code: 'ArrowLeft' })).toBe('cellLeft');
    expect(act({ code: 'ArrowRight' })).toBe('cellRight');
    expect(act({ code: 'Enter' })).toBe('open');
    expect(act({ code: 'NumpadEnter' })).toBe('open');
    expect(act({ code: 'Escape' })).toBe('escape');
  });

  it('Shift only for "?": Shift+Slash → help (keys on, not asking); Shift+Digit1 → null', () => {
    expect(act({ code: 'Slash', key: '?', shiftKey: true })).toBe('help');
    expect(act({ code: 'Slash', key: '?', shiftKey: true }, { singleKeys: false })).toBeNull();
    expect(act({ code: 'Slash', key: '?', shiftKey: true }, { asking: true })).toBeNull();
    expect(act({ code: 'Slash', key: '?', shiftKey: true, repeat: true })).toBeNull();
    expect(act({ code: 'Digit1', key: '!', shiftKey: true })).toBeNull();
    expect(act({ code: 'KeyJ', shiftKey: true })).toBeNull();
    expect(act({ code: 'Slash', key: '/' })).toBeNull();
  });

  it('never with Ctrl, Alt or Meta', () => {
    expect(act({ code: 'Digit1', ctrlKey: true })).toBeNull();
    expect(act({ code: 'KeyJ', altKey: true })).toBeNull();
    expect(act({ code: 'KeyZ', metaKey: true })).toBeNull();
    expect(act({ code: 'ArrowDown', ctrlKey: true })).toBeNull();
    expect(act({ code: 'Escape', metaKey: true })).toBeNull();
  });

  it('a held key only moves: a held Digit1 → null, a held KeyJ / ArrowDown → next', () => {
    expect(act({ code: 'Digit1', repeat: true })).toBeNull();
    expect(act({ code: 'KeyZ', repeat: true })).toBeNull();
    expect(act({ code: 'KeyX', repeat: true })).toBeNull();
    expect(act({ code: 'KeyJ', repeat: true })).toBe('next');
    expect(act({ code: 'KeyK', repeat: true })).toBe('prev');
    expect(act({ code: 'ArrowDown', repeat: true })).toBe('next');
    expect(act({ code: 'Enter', repeat: true })).toBeNull();
    expect(act({ code: 'Escape', repeat: true })).toBeNull();
  });

  it('while the reasons row is open only Escape acts', () => {
    for (const code of ['KeyJ', 'KeyK', 'Digit1', 'Digit2', 'Digit3', 'KeyZ', 'KeyX', 'KeyO', 'ArrowDown', 'ArrowUp', 'Enter']) {
      expect(act({ code }, { asking: true }), code).toBeNull();
      expect(deskActionOf({ code }, { ...evidence, asking: true }), code).toBeNull();
    }
    expect(act({ code: 'Escape' }, { asking: true })).toBe('escape');
    expect(deskActionOf({ code: 'Escape' }, { ...evidence, asking: true })).toBe('escape');
    expect(act({ code: 'Escape', repeat: true }, { asking: true })).toBeNull();
  });

  it('single keys off: J/1/Z/X/O/? do nothing, while ArrowDown/Enter/Escape still act in the rows', () => {
    const off = { singleKeys: false };
    for (const code of ['KeyJ', 'KeyK', 'Digit1', 'Digit2', 'Digit3', 'KeyZ', 'KeyX', 'KeyO', 'Numpad1']) {
      expect(act({ code }, off), code).toBeNull();
    }
    expect(act({ code: 'Slash', shiftKey: true }, off)).toBeNull();
    expect(act({ code: 'ArrowDown' }, off)).toBe('next');
    expect(act({ code: 'ArrowUp' }, off)).toBe('prev');
    expect(act({ code: 'ArrowLeft' }, off)).toBe('cellLeft');
    expect(act({ code: 'Enter' }, off)).toBe('open');
    expect(act({ code: 'Escape' }, off)).toBe('escape');
    // in the evidence region only Escape is left
    expect(deskActionOf({ code: 'ArrowDown' }, { ...evidence, singleKeys: false })).toBeNull();
    expect(deskActionOf({ code: 'KeyJ' }, { ...evidence, singleKeys: false })).toBeNull();
    expect(deskActionOf({ code: 'Escape' }, { ...evidence, singleKeys: false })).toBe('escape');
  });

  it('region evidence: the arrows, Enter, X and O stay native while J/K/1/2/3/Z act', () => {
    const ev = (e: KeyLike) => deskActionOf(e, evidence);
    for (const code of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter', 'NumpadEnter', 'KeyX', 'KeyO']) {
      expect(ev({ code }), code).toBeNull();
    }
    expect(ev({ code: 'KeyJ' })).toBe('next');
    expect(ev({ code: 'KeyK' })).toBe('prev');
    expect(ev({ code: 'Digit1' })).toBe('claim');
    expect(ev({ code: 'Digit2' })).toBe('pay');
    expect(ev({ code: 'Digit3' })).toBe('escalate');
    expect(ev({ code: 'KeyZ' })).toBe('undo');
    expect(ev({ code: 'Escape' })).toBe('escape');
    expect(ev({ code: 'Slash', shiftKey: true })).toBe('help');
  });

  it('never while typing; a row checkbox is not typing', () => {
    const typing = [
      target({ tagName: 'INPUT', type: 'text' }),
      target({ tagName: 'INPUT' }),
      target({ tagName: 'TEXTAREA' }),
      target({ tagName: 'SELECT' }),
      target({ isContentEditable: true }),
    ];
    for (const t of typing) {
      expect(act({ code: 'Digit1', target: t })).toBeNull();
      expect(act({ code: 'KeyJ', target: t })).toBeNull();
      expect(act({ code: 'Escape', target: t })).toBeNull();
      expect(act({ code: 'ArrowDown', target: t })).toBeNull();
    }
    const checkbox = target({ tagName: 'INPUT', type: 'checkbox' });
    expect(act({ code: 'KeyX', target: checkbox })).toBe('select');
    expect(act({ code: 'KeyJ', target: checkbox })).toBe('next');
    expect(act({ code: 'Digit1', target: target({ tagName: 'BUTTON' }) })).toBe('claim');
  });
});
