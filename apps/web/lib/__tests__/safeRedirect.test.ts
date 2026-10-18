import { describe, expect, it } from 'vitest';
import { safeRelativePath } from '../safeRedirect';

describe('safeRelativePath', () => {
  it('accepts a same-origin absolute path', () => {
    expect(safeRelativePath('/dashboard')).toBe('/dashboard');
    expect(safeRelativePath('/dashboard/settings')).toBe('/dashboard/settings');
    expect(safeRelativePath('/scans/abc-123?tab=lines#top')).toBe('/scans/abc-123?tab=lines#top');
  });

  it('keeps printable punctuation like hyphens and underscores', () => {
    expect(safeRelativePath('/dashboard/sub-page_2')).toBe('/dashboard/sub-page_2');
  });

  it('rejects protocol-relative URLs', () => {
    expect(safeRelativePath('//evil.com')).toBe('/dashboard');
    expect(safeRelativePath('//evil.com/path')).toBe('/dashboard');
  });

  it('rejects absolute URLs with a scheme', () => {
    expect(safeRelativePath('https://evil.com')).toBe('/dashboard');
    expect(safeRelativePath('http://evil.com')).toBe('/dashboard');
    expect(safeRelativePath('javascript:alert(1)')).toBe('/dashboard');
  });

  it('rejects backslash open-redirect tricks', () => {
    expect(safeRelativePath('/\\evil.com')).toBe('/dashboard');
    expect(safeRelativePath('\\\\evil.com')).toBe('/dashboard');
    expect(safeRelativePath('/path\\..\\evil')).toBe('/dashboard');
  });

  it('rejects values that do not start with a single slash', () => {
    expect(safeRelativePath('dashboard')).toBe('/dashboard');
    expect(safeRelativePath('')).toBe('/dashboard');
  });

  it('rejects embedded whitespace / control characters', () => {
    expect(safeRelativePath('/foo bar')).toBe('/dashboard');
    expect(safeRelativePath('/foo\tbar')).toBe('/dashboard');
    expect(safeRelativePath('/foo\nbar')).toBe('/dashboard');
  });

  it('rejects non-string input and honours a custom fallback', () => {
    expect(safeRelativePath(undefined)).toBe('/dashboard');
    expect(safeRelativePath(null)).toBe('/dashboard');
    expect(safeRelativePath(42)).toBe('/dashboard');
    expect(safeRelativePath('//evil.com', '/home')).toBe('/home');
  });
});
