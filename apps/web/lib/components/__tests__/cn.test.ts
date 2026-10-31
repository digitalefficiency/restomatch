import { describe, expect, it } from 'vitest';
import { cn as plainCn, cnMerge as cn } from '../cn';

describe('cn stays the v1 plain joiner (existing call sites unchanged)', () => {
  it('keeps every class and only drops falsy parts', () => {
    expect(plainCn('px-3 w-full', false, null, undefined, 'w-20')).toBe('px-3 w-full w-20');
  });
});

describe('cnMerge (tailwind-merge with the token classes)', () => {
  it('filters falsy parts like before', () => {
    expect(cn('a', false, null, undefined, 'b')).toBe('a b');
  });
  it('a later class wins a real conflict', () => {
    expect(cn('w-full px-3', 'w-20')).toBe('px-3 w-20');
    expect(cn('rounded-xl', 'rounded-control')).toBe('rounded-control');
    expect(cn('shadow-card', 'shadow-e2')).toBe('shadow-e2');
    expect(cn('duration-150', 'duration-medium')).toBe('duration-medium');
  });
  it('type roles are sizes, not colours: they never drop a text colour', () => {
    expect(cn('text-caption text-ink')).toBe('text-caption text-ink');
    expect(cn('text-metric-hero', 'text-muted')).toBe('text-metric-hero text-muted');
    expect(cn('text-sm', 'text-body')).toBe('text-body');
  });
  it('token colours conflict with each other as colours', () => {
    expect(cn('text-muted', 'text-ink')).toBe('text-ink');
    expect(cn('bg-surface', 'bg-danger-subtle')).toBe('bg-danger-subtle');
  });
});
