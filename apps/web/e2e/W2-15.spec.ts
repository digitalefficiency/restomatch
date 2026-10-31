import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { draftsLabEn, draftsLabHe } from '../app/dashboard/lab/tokens/_drafts/copy';
import { OWNER_STATE } from './env';

/**
 * W2-15 · drafts PR (15a) — checked in a real browser:
 *  3. mono safety net: a `font-mono` ₪ on /dashboard/lab/tokens draws the ₪ glyph from Heebo;
 *  5. lib/drafts: typing survives a reload; the leave sheet stops an in-app link and the back button;
 *     Ctrl+S saves on any layout (lab: /dashboard/lab/tokens?view=drafts);
 *  6. the shared PrintButton: in print media only the scoped root is visible;
 *  DoD-2 axe on the drafts lab, he and en.
 * W2_15_SHOTS=1 also writes the reviewed screens to e2e/__screenshots__/W2-15/.
 */

const TOKENS = '/dashboard/lab/tokens';
const DRAFTS = '/dashboard/lab/tokens?view=drafts';
const ON_DRAFTS = /\/dashboard\/lab\/tokens\?view=drafts$/;
const copy = { he: draftsLabHe, en: draftsLabEn };
const SHOTS = process.env.W2_15_SHOTS ? 'e2e/__screenshots__/W2-15' : null;
const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

test.use({ storageState: OWNER_STATE });

async function setLang(page: Page, lang: 'he' | 'en') {
  const url = test.info().project.use.baseURL!;
  await page.context().addCookies([
    { name: 'rm_locale', value: lang, url },
    { name: 'rm_cookie_consent', value: 'necessary', url },
  ]);
}

/** Start every drafts test from an empty device copy. */
async function freshDrafts(page: Page, lang: 'he' | 'en' = 'he') {
  await setLang(page, lang);
  await page.goto(DRAFTS);
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('rm.draft:')) localStorage.removeItem(k);
  });
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: copy[lang].title })).toBeVisible();
}

const dirtyState = (page: Page) => page.getByTestId('drafts-state');

test.describe('W2-15 · drafts kit, print rule, mono safety net', () => {
  test('3 · safety net: a font-mono ₪ on the tokens lab resolves its glyph to Heebo, not JetBrains Mono', async ({ page }) => {
    await setLang(page, 'he');
    await page.goto(TOKENS);
    await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.id = 'w2-15-mono-ils';
      probe.className = 'font-mono';
      probe.textContent = '₪';
      document.querySelector('[data-lab="tokens"]')?.appendChild(probe);
    });
    await page.evaluate(() => document.fonts.ready);
    const stack = await page.locator('#w2-15-mono-ils').evaluate((el) => getComputedStyle(el).fontFamily);
    expect(stack.replace(/["']/g, '')).toMatch(/^JetBrains Mono, Heebo/);

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#w2-15-mono-ils' });
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    const families = fonts.map((f) => f.familyName);
    expect(families.some((f) => /heebo/i.test(f)), families.join(', ')).toBe(true);
    expect(families.some((f) => /jetbrains/i.test(f)), families.join(', ')).toBe(false);
  });

  test('5 · a draft survives a reload, and Ctrl+S on a Hebrew layout saves it', async ({ page }) => {
    await freshDrafts(page);
    const note = page.getByLabel(draftsLabHe.noteLabel);
    await note.fill('חסרים שני ארגזי עגבניות');
    await expect(dirtyState(page)).toHaveAttribute('data-dirty', 'true');
    // The leave guard's beforeunload prompt: accept it, as a person choosing "reload" would.
    page.once('dialog', (d) => void d.accept());
    await page.reload();
    await expect(note).toHaveValue('חסרים שני ארגזי עגבניות');
    await expect(page.getByText(draftsLabHe.restored)).toBeVisible();
    await expect(dirtyState(page)).toHaveAttribute('data-dirty', 'true');

    // Ctrl+S by physical key: the event a Hebrew layout sends has key "ד", code "KeyS".
    await note.focus();
    await page.evaluate(() => {
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ד', code: 'KeyS', ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });
    await expect(dirtyState(page)).toHaveAttribute('data-dirty', 'false');
  });

  test('5 · the leave sheet stops an in-app link and the back button; "leave anyway" leaves', async ({ page }) => {
    await page.goto('/dashboard');
    await freshDrafts(page);
    await page.getByLabel(draftsLabHe.qtyLabel).fill('12');
    await expect(dirtyState(page)).toHaveAttribute('data-dirty', 'true');

    const sheet = page.getByRole('dialog', { name: draftsLabHe.leaveTitle });
    await page.getByRole('link', { name: draftsLabHe.leaveTest }).click();
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: draftsLabHe.stay }).click();
    await expect(sheet).toBeHidden();
    await expect(page).toHaveURL(ON_DRAFTS);

    await page.evaluate(() => history.back());
    await expect(sheet).toBeVisible();
    await expect(page).toHaveURL(ON_DRAFTS);
    await sheet.getByRole('button', { name: draftsLabHe.leave }).click();
    await expect(page).not.toHaveURL(ON_DRAFTS);
  });

  test('6 · PrintButton: in print media only the scoped root is visible; cleared on afterprint', async ({ page }) => {
    await page.addInitScript(() => {
      window.print = () => {
        (window as unknown as { __printed: number }).__printed = ((window as unknown as { __printed?: number }).__printed ?? 0) + 1;
      };
    });
    await freshDrafts(page);
    await page.getByRole('button', { name: draftsLabHe.print }).click();
    expect(await page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1);
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-printing', '');
    await expect(html).toHaveAttribute('data-print-scope', 'lab-sheet');

    await page.emulateMedia({ media: 'print' });
    const vis = (sel: string) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).visibility);
    expect(await vis('[data-print-root="lab-sheet"] h2')).toBe('visible');
    expect(await vis('#lab-note')).toBe('hidden');
    expect(await page.locator('[data-print-button]').evaluate((el) => getComputedStyle(el).display)).toBe('none');

    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await expect(html).not.toHaveAttribute('data-printing', '');
    await expect(page.locator('[data-print-active]')).toHaveCount(0);
    await page.emulateMedia({ media: 'screen' });
  });

  test('DoD-2 · axe (wcag22aa + best-practice) on the drafts lab, with the leave sheet open, he and en', async ({ page }) => {
    for (const lang of ['he', 'en'] as const) {
      await freshDrafts(page, lang);
      await page.getByLabel(copy[lang].noteLabel).fill('x');
      for (const withSheet of [false, true]) {
        if (withSheet) {
          await page.getByRole('link', { name: copy[lang].leaveTest }).click();
          await expect(page.getByRole('dialog', { name: copy[lang].leaveTitle })).toBeVisible();
        }
        await page.addScriptTag({ content: AXE_SOURCE });
        const violations = await page.evaluate(async () => {
          const axe = (window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: Array<{ id: string; impact: string; nodes: Array<{ target: string[] }> }> }> } }).axe;
          const res = await axe.run(document.querySelector('main') ?? document, {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
          });
          return res.violations
            .filter((v) => v.impact === 'critical' || v.impact === 'serious')
            .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`);
        });
        expect(violations, `${lang}${withSheet ? ' + sheet' : ''}`).toEqual([]);
      }
      await page.keyboard.press('Escape');
    }
  });

  test('DoD-1 · the drafts lab at he 390 / he 1440 / en 1440: no overflow; screens on request', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const [lang, width, height] of [
      ['he', 390, 844],
      ['he', 1440, 900],
      ['en', 1440, 900],
    ] as const) {
      await page.setViewportSize({ width, height });
      await freshDrafts(page, lang);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${lang} ${width}: no horizontal overflow`).toBeLessThanOrEqual(0);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/lab-drafts--${lang}-${width}.png`, fullPage: true, animations: 'disabled' });
    }
  });
});
