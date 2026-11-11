import type { Page } from '@playwright/test';

/**
 * The copy word metric in the browser (MECHANISM §5.1; same regex as lib/copy/words.ts and the
 * auditors' capture.cjs). Visible text nodes inside `main`, folds closed. Excluded: .sr-only,
 * [aria-hidden=true], [hidden], tbody, [data-record] (data rows/cards), [data-copy-exempt].
 */
export interface CopyMeasure {
  /** Words whose text box starts above innerHeight at load. */
  first: number;
  /** Words on the whole page. */
  page: number;
  /** Unfolded blocks of more than 12 words. */
  blocks: Array<{ text: string; words: number }>;
  /** `document.body.innerText` words — the auditors' number, for reconciliation. */
  bodyWords: number;
  /** Words inside [data-copy-exempt] (printed so reviewers can spot abuse). */
  exemptWords: number;
}

export async function measureCopy(page: Page): Promise<CopyMeasure> {
  return page.evaluate(() => {
    const WORD = /[A-Za-zא-ת][A-Za-zא-ת'"׳״\-]*/g;
    const count = (s: string) => (s.match(WORD) ?? []).length;
    const EXCLUDE = '.sr-only, [aria-hidden="true"], [hidden], tbody, [data-record], [data-copy-exempt], script, style, noscript, template';
    const BLOCK = 'p, li, h1, h2, h3, h4, h5, h6, dd, dt, label, figcaption, blockquote, td, th, div, span';
    const main = document.querySelector('main') ?? document.body;
    let first = 0;
    let total = 0;
    const blockWords = new Map<Element, number>();
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || el.closest(EXCLUDE)) continue;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const w = count(n.textContent ?? '');
      if (!w) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      total += w;
      if (rect.top + window.scrollY < window.innerHeight) first += w;
      // Attribute the words to the nearest block-level ancestor (a "block" = one paragraph-like unit).
      let b: Element | null = el;
      while (b && b !== main && getComputedStyle(b).display.startsWith('inline')) b = b.parentElement;
      if (b && b.matches(BLOCK)) blockWords.set(b, (blockWords.get(b) ?? 0) + w);
    }
    const blocks = [...blockWords.entries()]
      .filter(([, w]) => w > 12)
      .map(([el, words]) => ({ text: (el.textContent ?? '').trim().slice(0, 120), words }));
    const exemptWords = [...main.querySelectorAll('[data-copy-exempt]')].reduce((a, e) => a + count((e as HTMLElement).innerText ?? ''), 0);
    return { first, page: total, blocks, bodyWords: count(document.body.innerText), exemptWords };
  });
}

/** The fold contract (W2-16 §5.5): returns human-readable violations (empty = OK). */
export async function foldContract(page: Page): Promise<string[]> {
  const toggles = page.locator('[data-explain-toggle]');
  const n = await toggles.count();
  const out: string[] = [];
  if (n > 3) out.push(`${n} folds on one screen (max 3)`);
  const names = new Set<string>();
  for (let i = 0; i < n; i++) {
    const t = toggles.nth(i);
    if (!(await t.isVisible())) continue;
    const expanded = await t.getAttribute('aria-expanded');
    const controls = await t.getAttribute('aria-controls');
    if (expanded !== 'false') out.push(`toggle ${i} loads aria-expanded=${expanded}`);
    if (!controls) {
      out.push(`toggle ${i} has no aria-controls`);
      continue;
    }
    const panel = page.locator(`[id="${controls}"]`);
    if ((await panel.count()) !== 1 || (await panel.getAttribute('hidden')) === null) out.push(`toggle ${i} → #${controls} is not one hidden element`);
    const field = await t.evaluate((el) => !!el.closest('[data-mode=field]'));
    const box = await t.boundingBox();
    const min = field ? 48 : 44;
    if (!box || box.width < min - 0.5 || box.height < min - 0.5) out.push(`toggle ${i} box ${box?.width}×${box?.height} < ${min}`);
    const inside = await t.evaluate((el) => !!el.closest('dialog, [role=alert], tbody, [data-copy-exempt]'));
    if (inside) out.push(`toggle ${i} sits inside dialog/alert/tbody/exempt`);
    const name = (await t.evaluate((el) => (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim() + '|' + (el.querySelector('.sr-only')?.textContent ?? ''))).trim();
    if (names.has(name)) out.push(`toggle name not unique: ${name}`);
    names.add(name);
    await t.click();
    if ((await t.getAttribute('aria-expanded')) !== 'true') out.push(`toggle ${i} did not expand`);
    if (!(await panel.isVisible())) out.push(`toggle ${i} panel not visible after click`);
    const focused = await t.evaluate((el) => document.activeElement === el);
    if (!focused) out.push(`toggle ${i} lost focus on open`);
    await t.click();
  }
  return out;
}
