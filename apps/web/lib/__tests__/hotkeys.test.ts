import { describe, expect, it } from 'vitest';
import {
  CHORD_MS,
  HOTKEYS,
  IDLE,
  keyLabel,
  matchKeydown,
  matchKeyup,
  yieldsQuestionMark,
} from '../hotkeys';

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
    expect(matchKeydown({ code: 'KeyQ' }, g.state, at('/dashboard', 200)).action).toBeNull();
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
