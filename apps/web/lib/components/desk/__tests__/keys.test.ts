import { describe, expect, it } from 'vitest';
import { deskKeyOf, isTypingTarget, moveIndex } from '../keys';

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
