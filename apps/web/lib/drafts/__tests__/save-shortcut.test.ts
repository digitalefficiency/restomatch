import { describe, expect, it, vi } from 'vitest';
import { attachSaveShortcut, isSaveShortcut, type KeyTarget } from '../saveShortcut';

function target() {
  let fn: ((e: KeyboardEvent) => void) | null = null;
  const t: KeyTarget = {
    addEventListener: (_t, f) => (fn = f),
    removeEventListener: () => (fn = null),
  };
  const press = (e: Partial<KeyboardEvent>) => {
    const ev = { ctrlKey: false, metaKey: false, altKey: false, repeat: false, key: '', code: '', preventDefault: vi.fn(), ...e };
    fn?.(ev as unknown as KeyboardEvent);
    return ev;
  };
  return { t, press, attached: () => fn !== null };
}

describe('lib/drafts save shortcut (catalog-40)', () => {
  it('matches by physical key: Ctrl+S on a Hebrew layout (key "ד") saves', () => {
    expect(isSaveShortcut({ ctrlKey: true, metaKey: false, code: 'KeyS' })).toBe(true);
    expect(isSaveShortcut({ ctrlKey: false, metaKey: true, code: 'KeyS' })).toBe(true);
    expect(isSaveShortcut({ ctrlKey: true, metaKey: false, code: 'KeyD' })).toBe(false);
    expect(isSaveShortcut({ ctrlKey: false, metaKey: false, code: 'KeyS' })).toBe(false);
    expect(isSaveShortcut({ ctrlKey: true, metaKey: false, altKey: true, code: 'KeyS' })).toBe(false);
  });

  it('runs onSave once and swallows the browser "save page" dialog', () => {
    const k = target();
    const onSave = vi.fn();
    attachSaveShortcut(k.t, onSave);
    const ev = k.press({ ctrlKey: true, key: 'ד', code: 'KeyS' });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(ev.preventDefault).toHaveBeenCalled();
    k.press({ ctrlKey: true, key: 'ד', code: 'KeyS', repeat: true });
    expect(onSave).toHaveBeenCalledTimes(1);
    k.press({ key: 'ד', code: 'KeyS' });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('disabled: still swallowed, does nothing; cleanup detaches', () => {
    const k = target();
    const onSave = vi.fn();
    const off = attachSaveShortcut(k.t, onSave, () => false);
    const ev = k.press({ metaKey: true, key: 's', code: 'KeyS' });
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
    off();
    expect(k.attached()).toBe(false);
  });
});
