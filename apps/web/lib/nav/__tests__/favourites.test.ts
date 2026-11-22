import { describe, expect, it } from 'vitest';
import { MAX_FAVOURITES, sanitizeFavourites, toggleFavourite } from '../favourites';

describe('toggleFavourite', () => {
  it('caps favourites at five', () => {
    expect(MAX_FAVOURITES).toBe(5);
  });

  it('adds an absent key at the end', () => {
    expect(toggleFavourite([], 'approvals')).toEqual({ list: ['approvals'], added: true, full: false });
    expect(toggleFavourite(['approvals', 'inbox'], 'leaks')).toEqual({ list: ['approvals', 'inbox', 'leaks'], added: true, full: false });
  });

  it('removes a present key and keeps the order of the rest', () => {
    expect(toggleFavourite(['approvals', 'inbox', 'leaks'], 'inbox')).toEqual({ list: ['approvals', 'leaks'], added: false, full: false });
  });

  it('accepts the fifth star', () => {
    expect(toggleFavourite(['a', 'b', 'c', 'd'], 'e')).toEqual({ list: ['a', 'b', 'c', 'd', 'e'], added: true, full: false });
  });

  it('refuses a sixth star: the list stays the same and full is true', () => {
    const five = ['a', 'b', 'c', 'd', 'e'];
    const result = toggleFavourite(five, 'f');
    expect(result).toEqual({ list: ['a', 'b', 'c', 'd', 'e'], added: false, full: true });
    expect(result.list).not.toBe(five);
  });

  it('still removes from a full list', () => {
    expect(toggleFavourite(['a', 'b', 'c', 'd', 'e'], 'c')).toEqual({ list: ['a', 'b', 'd', 'e'], added: false, full: false });
  });

  it('refuses an add to a list already past the cap, and still removes from it', () => {
    const six = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(toggleFavourite(six, 'g')).toEqual({ list: six, added: false, full: true });
    expect(toggleFavourite(six, 'f')).toEqual({ list: ['a', 'b', 'c', 'd', 'e'], added: false, full: false });
  });

  it('never mutates its input', () => {
    const list = Object.freeze(['a', 'b']);
    expect(() => {
      toggleFavourite(list, 'c');
      toggleFavourite(list, 'a');
    }).not.toThrow();
    expect(list).toEqual(['a', 'b']);
  });
});

describe('sanitizeFavourites', () => {
  const allowed: ReadonlySet<string> = new Set(['approvals', 'inbox', 'leaks', 'orders', 'recipes', 'team']);

  it('keeps the user order, drops duplicates and caps at five', () => {
    expect(sanitizeFavourites(['team', 'inbox', 'team', 'approvals', 'leaks', 'orders', 'recipes'], allowed)).toEqual([
      'team',
      'inbox',
      'approvals',
      'leaks',
      'orders',
    ]);
  });

  it('drops keys this viewer cannot open without spending a place on them', () => {
    expect(sanitizeFavourites(['branches', 'approvals', 'chain', 'inbox', 'leaks', 'orders', 'recipes'], allowed)).toEqual([
      'approvals',
      'inbox',
      'leaks',
      'orders',
      'recipes',
    ]);
  });

  it('is empty when nothing is allowed', () => {
    expect(sanitizeFavourites(['approvals', 'inbox'], new Set())).toEqual([]);
  });
});
