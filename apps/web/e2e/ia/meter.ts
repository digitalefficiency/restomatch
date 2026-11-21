import type { Page } from '@playwright/test';
import type { DensityCounts } from './budget';

/**
 * IA-01 — counts one loaded screen in the browser (inside `<main>`, first fold = the
 * viewport at load, folds closed). Marked attributes win; until the owning packages add
 * them (one line per component, DoD-6b) the meter falls back to heuristics:
 *
 * | count   | marked                         | heuristic                                                     |
 * |---------|--------------------------------|---------------------------------------------------------------|
 * | blocks  | `[data-block]`                 | outermost card surfaces (radius ≥12, border or fill, ≥120×60) |
 * | numbers | `[data-num]`, `<Money>` `<bdi>`| digit tokens in visible text (`₪1,234.50`, `7.11.2026` = one) |
 * | T2      | —                              | computed colour / background / border = `--c-danger*`/`--c-warn*`, outermost mark only |
 * | primary | `[data-primary]`               | a button / link filled with `--c-primary-bold`                |
 * | rows    | `[data-row]`                   | `tbody tr`, `[role=row]`, `[data-record]`, `ul/ol > li` in main |
 * | figures | `[data-figure]`                | none (needs the mark)                                         |
 *
 * Words use the copy metric (W2-16 MECHANISM §5.1): letters only; data rows
 * (`tbody`, `[data-record]`) and `[data-copy-exempt]` are not "explanation" words.
 */
export async function measureDensity(page: Page): Promise<DensityCounts> {
  return page.evaluate(() => {
    const main = (document.querySelector('main') ?? document.body) as HTMLElement;
    const H = window.innerHeight;
    const W = window.innerWidth;
    const HIDDEN = '.sr-only, [aria-hidden="true"], [hidden], script, style, noscript, template';
    const NOT_COPY = 'tbody, [data-record], [data-copy-exempt]';
    const WORD = /[A-Za-zא-ת][A-Za-zא-ת'"׳״\-]*/g;
    const NUM = /\d(?:[\d,.:/]*\d)?/g;

    const visible = (el: Element): boolean => {
      if (el.closest(HIDDEN)) return false;
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const inFold = (r: DOMRect): boolean => r.bottom > 0 && r.top < H && r.right > 0 && r.left < W;
    const elInFold = (el: Element): boolean => visible(el) && inFold(el.getBoundingClientRect());

    // ── words + digit tokens from visible text nodes ────────────────────────────────
    let words = 0;
    let pageWords = 0;
    let digitTokens = 0;
    const textNums: Element[] = [];
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || !visible(el)) continue;
      const text = n.textContent ?? '';
      const range = document.createRange();
      range.selectNodeContents(n);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      const fold = inFold(rect);
      if (!el.closest(NOT_COPY)) {
        const w = (text.match(WORD) ?? []).length;
        pageWords += w;
        if (fold) words += w;
      }
      if (fold && !el.closest('[data-num], bdi')) {
        const k = (text.match(NUM) ?? []).length;
        if (k) {
          digitTokens += k;
          for (let i = 0; i < k; i++) textNums.push(el);
        }
      }
    }
    const markedNums = [...main.querySelectorAll('[data-num], bdi')].filter(
      (el) => elInFold(el) && /\d/.test(el.textContent ?? '') && !el.parentElement?.closest('[data-num], bdi'),
    );
    const numbers = markedNums.length + digitTokens;

    // ── T2 marks: danger / warn token colours, outermost only ───────────────────────
    const root = getComputedStyle(document.documentElement);
    const t2Rgb = new Set<string>();
    for (const fam of ['danger', 'warn']) {
      for (const suffix of ['', '-bold', '-bold-hover', '-subtle', '-subtle-hover', '-border-subtle']) {
        const v = root.getPropertyValue(`--c-${fam}${suffix}`).trim();
        const p = v.split(/\s+/).map(Number);
        if (p.length === 3 && p.every((x) => Number.isFinite(x))) t2Rgb.add(`${p[0]},${p[1]},${p[2]}`);
      }
    }
    const primaryRgb = (() => {
      const p = root.getPropertyValue('--c-primary-bold').trim().split(/\s+/).map(Number);
      return p.length === 3 ? `${p[0]},${p[1]},${p[2]}` : '';
    })();
    const rgbOf = (css: string): string | null => {
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(css);
      if (!m || (m[4] !== undefined && Number(m[4]) === 0)) return null;
      return `${m[1]},${m[2]},${m[3]}`;
    };
    const isMark = (el: Element): boolean => {
      const s = getComputedStyle(el);
      const hasOwnText = [...el.childNodes].some((c) => c.nodeType === 3 && /\S/.test(c.textContent ?? ''));
      const fg = hasOwnText ? rgbOf(s.color) : null;
      const bg = rgbOf(s.backgroundColor);
      const bd = Number.parseFloat(s.borderTopWidth) > 0 || Number.parseFloat(s.borderInlineStartWidth) > 0 ? rgbOf(s.borderTopColor) : null;
      return [fg, bg, bd].some((c) => c !== null && t2Rgb.has(c));
    };
    const all = [...main.querySelectorAll('*')].filter(elInFold);
    const marks = all.filter(isMark);
    const markSet = new Set(marks);
    const outerMarks = marks.filter((el) => {
      for (let p = el.parentElement; p && p !== main; p = p.parentElement) if (markSet.has(p)) return false;
      return true;
    });

    // ── primary buttons ─────────────────────────────────────────────────────────────
    const markedPrimary = [...main.querySelectorAll('[data-primary]')].filter(elInFold);
    const filledPrimary = [...main.querySelectorAll('button, a, [role="button"], input[type="submit"]')].filter(
      (el) => elInFold(el) && !el.closest('[data-primary]') && primaryRgb !== '' && rgbOf(getComputedStyle(el).backgroundColor) === primaryRgb,
    );
    const primary = markedPrimary.length + filledPrimary.length;

    // ── blocks ──────────────────────────────────────────────────────────────────────
    const markedBlocks = [...main.querySelectorAll('[data-block]')].filter(elInFold);
    let blockEls: Element[] = markedBlocks;
    if (!markedBlocks.length) {
      // A card surface (Card: `rounded-2xl border bg-surface`, sections alike): rounded ≥12px,
      // a border or a filled background, at least 60px tall. Outermost surface only.
      const isSurface = (el: Element): boolean => {
        const s = getComputedStyle(el);
        if (Number.parseFloat(s.borderTopLeftRadius) < 12) return false;
        const r = el.getBoundingClientRect();
        if (r.height < 60 || r.width < 120) return false;
        return Number.parseFloat(s.borderTopWidth) > 0 || rgbOf(s.backgroundColor) !== null;
      };
      const surfaces = all.filter(isSurface);
      const surfaceSet = new Set(surfaces);
      blockEls = surfaces.filter((el) => {
        for (let p = el.parentElement; p && p !== main; p = p.parentElement) if (surfaceSet.has(p)) return false;
        return true;
      });
      if (!blockEls.length) {
        let top: Element = main;
        for (let i = 0; i < 2 && top.children.length === 1; i++) top = top.children[0]!;
        blockEls = [...top.children].filter(elInFold);
      }
    }

    // ── rows / cards ────────────────────────────────────────────────────────────────
    const markedRows = [...main.querySelectorAll('[data-row]')];
    const rowEls = (markedRows.length
      ? markedRows
      : [...main.querySelectorAll('tbody tr, [role="row"], [data-record], ul > li, ol > li')].filter(
          (el) => !el.closest('nav') && !el.parentElement?.closest('tbody tr, [role="row"], [data-record]'),
        )
    ).filter(elInFold);
    const rows = rowEls.map((row) => ({
      numbers: markedNums.filter((n) => row.contains(n)).length + textNums.filter((n) => row.contains(n)).length,
      t2: outerMarks.filter((m) => row.contains(m)).length,
    }));

    // ── figures ─────────────────────────────────────────────────────────────────────
    const figures = [...main.querySelectorAll('[data-figure]')]
      .filter(visible)
      .map((el) => ({ id: el.getAttribute('data-figure') ?? '', value: (el.textContent ?? '').trim() }));

    return {
      words,
      pageWords,
      blocks: blockEls.length,
      numbers,
      t2: outerMarks.length,
      primary,
      rows,
      figures,
      marked: {
        blocks: markedBlocks.length > 0,
        numbers: markedNums.length > 0,
        primary: markedPrimary.length > 0,
        figures: figures.length > 0,
      },
    };
  });
}
