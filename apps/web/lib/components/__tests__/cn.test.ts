import { describe, expect, it } from 'vitest';
import { cn } from '../cn';

describe('cn (tailwind-merge with the token classes)', () => {
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
