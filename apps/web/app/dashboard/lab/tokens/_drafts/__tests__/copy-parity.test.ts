import { describe, expect, it } from 'vitest';
import { draftsLabEn, draftsLabHe } from '../copy';

describe('drafts lab copy', () => {
  it('he/en key parity, no empty strings', () => {
    expect(Object.keys(draftsLabEn).sort()).toEqual(Object.keys(draftsLabHe).sort());
    for (const v of [...Object.values(draftsLabHe), ...Object.values(draftsLabEn)]) expect(v.trim()).not.toBe('');
  });

  it('Hebrew buttons are noun forms, no slashes', () => {
    for (const k of ['save', 'discard', 'stay', 'leave', 'print'] as const) expect(draftsLabHe[k]).not.toMatch(/\//);
  });
});
