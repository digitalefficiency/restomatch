/**
 * Desk keyboard map (RUBRIC R-9, lens-exec-desktop §3.9). Keys are bound by
 * `KeyboardEvent.code`, the physical key, so they work on a Hebrew layout
 * (ח = KeyJ, ל = KeyK, ס = KeyX). The handlers that use this sit on the list
 * element, so the keys only fire while the list has focus (WCAG 2.1.4), and
 * never while the user is typing.
 */

export type DeskKey = 'next' | 'prev' | 'peek' | 'open' | 'openTab' | 'select' | 'escape';

export interface KeyLike {
  code: string;
  key?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  target?: EventTarget | null;
}

export function isTypingTarget(target: EventTarget | null | undefined): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as { tagName?: string; isContentEditable?: boolean; type?: string };
  if (el.isContentEditable) return true;
  const tag = el.tagName?.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  // A checkbox inside a row is not "typing": J/K still move from it.
  return !['checkbox', 'radio', 'button', 'submit'].includes((el.type ?? 'text').toLowerCase());
}

export function deskKeyOf(e: KeyLike): DeskKey | null {
  if (isTypingTarget(e.target)) return null;
  if (e.altKey) return null;
  const mod = e.ctrlKey || e.metaKey;
  if (e.code === 'Enter' || e.code === 'NumpadEnter') return mod ? 'openTab' : 'open';
  if (mod) return null;
  switch (e.code) {
    case 'KeyJ':
    case 'ArrowDown':
      return 'next';
    case 'KeyK':
    case 'ArrowUp':
      return 'prev';
    case 'Space':
      return 'peek';
    case 'KeyX':
      return 'select';
    case 'Escape':
      return 'escape';
    default:
      return null;
  }
}

/** The next index for a J/K move, clamped to the list (no wrap: the end is the end). */
export function moveIndex(current: number, delta: 1 | -1, length: number): number {
  if (length === 0) return -1;
  if (current < 0) return delta > 0 ? 0 : length - 1;
  return Math.min(length - 1, Math.max(0, current + delta));
}
