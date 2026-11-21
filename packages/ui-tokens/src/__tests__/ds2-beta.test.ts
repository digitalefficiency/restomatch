// DS2 phase 2 (train β): the font swap (D2, D3, D10, D11; VERDICT §8–§9).
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ACTIVE_FACE, activeFonts, cssVariables, DS2_PHASE, faces, fontPreloads, fontUrl } from '../index';

const pub = (url: string) => fileURLToPath(new URL(`../../../../apps/web/public${url}`, import.meta.url));
const bytes = (url: string) => statSync(pub(url)).size;
const KB = 1024;

describe('DS2 β font swap', () => {
  it('is phase 2 with Plex active', () => {
    expect(DS2_PHASE).toBe(2);
    expect(ACTIVE_FACE).toBe('plex');
    expect(activeFonts.ui.startsWith("'IBM Plex Sans Hebrew', 'IBM Plex Sans Hebrew Fallback'")).toBe(true);
  });

  it('D3: identifiers use the UI family, no mono face', () => {
    expect(activeFonts.id).toBe('var(--font-ui)');
    expect(cssVariables()).not.toMatch(/Plex Mono/);
  });

  it('D11: Frank Ruhl Libre is the display role only, never preloaded', () => {
    expect(activeFonts.display.startsWith("'Frank Ruhl Libre'")).toBe(true);
    for (const list of Object.values(fontPreloads())) for (const href of list) expect(href).not.toMatch(/frank-ruhl/);
  });

  it('every @font-face file exists, with its OFL licence beside it', () => {
    for (const set of [faces.plex, faces.display]) {
      for (const w of set.weights) for (const s of set.subsets) expect(bytes(fontUrl(set, s, w))).toBeGreaterThan(1000);
      expect(readFileSync(pub(`${set.dir}/OFL.txt`), 'utf8')).toMatch(/SIL Open Font License, Version 1\.1/);
    }
    expect(cssVariables()).toContain("font-family: 'IBM Plex Sans Hebrew Fallback';");
  });

  it('PERF: preloaded font bytes ≤ 50 KB (he) and both subsets carry Hebrew money', () => {
    const he = fontPreloads().he;
    const total = he.reduce((n, href) => n + bytes(href), 0);
    expect(total).toBeLessThanOrEqual(50 * KB);
    // ₪ lives in the hebrew subset and digits in latin: both are preloaded.
    expect(he.some((h) => h.includes('-hebrew-400-'))).toBe(true);
    expect(he.some((h) => h.includes('-latin-400-'))).toBe(true);
  });

  it('PERF: all four app weights × hebrew + latin fit the first-load budget', () => {
    const p = faces.plex;
    const total = p.weights.reduce((n, w) => n + bytes(fontUrl(p, 'hebrew', w)) + bytes(fontUrl(p, 'latin', w)), 0);
    // The owner home paints all four weights (measured 99.8 KiB, docs/ux/ds2/beta/RESULTS.md).
    expect(total).toBeLessThanOrEqual(100 * KB);
  });

  it('the Heebo files stay for the undo (ACTIVE_FACE = heebo)', () => {
    expect(bytes('/fonts/heebo/heebo-hebrew-wght.woff2')).toBeGreaterThan(1000);
  });
});
