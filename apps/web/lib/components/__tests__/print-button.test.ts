import './reactGlobal';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { startPrint, type PrintEnv } from '../PrintButton';

function fakeEnv(roots = 1) {
  const dataset: Record<string, string> = {};
  const els = Array.from({ length: roots }, () => {
    const attrs = new Map<string, string>();
    return {
      attrs,
      setAttribute: (n: string, v: string) => void attrs.set(n, v),
      removeAttribute: (n: string) => void attrs.delete(n),
    };
  });
  let after: (() => void) | null = null;
  const sel: string[] = [];
  const env: PrintEnv = {
    root: { dataset },
    querySelectorAll: (s) => {
      sel.push(s);
      return els;
    },
    addEventListener: (_t, fn) => (after = fn),
    removeEventListener: () => (after = null),
    print: vi.fn(),
  };
  return { env, dataset, els, sel, afterprint: () => after?.() };
}

describe('PrintButton (W2-15 one print rule)', () => {
  it('scoped: marks html[data-printing][data-print-scope] + the matching root, prints, clears on afterprint', () => {
    const f = fakeEnv(2);
    startPrint(f.env, 'claim-letter');
    expect(f.sel).toEqual(['[data-print-root="claim-letter"]']);
    expect(f.dataset).toEqual({ printing: '', printScope: 'claim-letter' });
    expect(f.els.every((e) => e.attrs.has('data-print-active'))).toBe(true);
    expect(f.env.print).toHaveBeenCalledTimes(1);
    f.afterprint();
    expect(f.dataset).toEqual({});
    expect(f.els.some((e) => e.attrs.has('data-print-active'))).toBe(false);
  });

  it('unscoped: whole page, data-printing only', () => {
    const f = fakeEnv();
    startPrint(f.env);
    expect(f.sel).toEqual([]);
    expect(f.dataset).toEqual({ printing: '' });
    f.afterprint();
    expect(f.dataset).toEqual({});
  });

  it('globals.css has the generic [data-printing] rule (A4, tokens only) and keeps the xmatch alias', () => {
    const css = readFileSync(fileURLToPath(new URL('../../../app/globals.css', import.meta.url)), 'utf8');
    const start = css.indexOf('/* The one print rule (W2-15)');
    expect(start).toBeGreaterThan(0);
    const block = css.slice(start, css.indexOf('/* ─────', start));
    expect(block).toContain('size: A4');
    expect(block).toContain('html[data-printing][data-print-scope] [data-print-active]');
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).toContain('html[data-print-scope="xmatch"] [data-print-root="xmatch"]');
  });

  it('mono safety net: Heebo right after JetBrains Mono (globals var + ui-tokens stack)', async () => {
    const css = readFileSync(fileURLToPath(new URL('../../../app/globals.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/--font-mono:\s*'JetBrains Mono',\s*'Heebo';/);
    const { typography } = await import('@restomatch/ui-tokens');
    expect(typography.fontFamily.mono.startsWith('"JetBrains Mono", "Heebo"')).toBe(true);
  });
});
