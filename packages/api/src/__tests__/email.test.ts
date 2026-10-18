import { describe, expect, it } from 'vitest';
import { canonicalizeEmail } from '../email';

describe('canonicalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(canonicalizeEmail('  User@Example.COM ')).toBe('user@example.com');
  });

  it('strips +tag sub-addressing for any provider', () => {
    expect(canonicalizeEmail('user+anything@example.com')).toBe('user@example.com');
    expect(canonicalizeEmail('user+1@example.com')).toBe('user@example.com');
  });

  it('collapses gmail dot + tag aliases to one mailbox', () => {
    const canon = 'user@gmail.com';
    expect(canonicalizeEmail('u.s.e.r@gmail.com')).toBe(canon);
    expect(canonicalizeEmail('user+promo@gmail.com')).toBe(canon);
    expect(canonicalizeEmail('u.s.er+x@googlemail.com')).toBe(canon);
  });

  it('keeps dots for non-gmail providers (they are significant)', () => {
    expect(canonicalizeEmail('first.last@example.com')).toBe('first.last@example.com');
  });

  it('all gmail aliases of a victim collapse to the same key', () => {
    const variants = [
      'victim@gmail.com',
      'v.i.c.t.i.m@gmail.com',
      'victim+1@gmail.com',
      'victim+2@gmail.com',
      'vic.tim+spam@googlemail.com',
    ];
    const keys = new Set(variants.map(canonicalizeEmail));
    expect(keys.size).toBe(1);
  });

  it('handles non-address input gracefully', () => {
    expect(canonicalizeEmail('not-an-email')).toBe('not-an-email');
  });
});
