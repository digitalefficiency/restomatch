import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { LAB_ROW_COUNT, labRows, viewTotals } from '../app/dashboard/lab/desk/_data';
import { OWNER_STATE } from './env';

/**
 * W1-02 desk primitives on /dashboard/lab/desk (500 deterministic rows):
 * DataTable sort/sticky/NumCell/totals, BatchBar + R-12 rules, URL state and
 * Back, J/K by KeyboardEvent.code on a Hebrew layout, Peek, SplitPane, the
 * phone card list, the CSV export header rows, density row heights and axe.
 */

const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const LAB = '/dashboard/lab/desk';
type Locale = 'he' | 'en';
const DESK = { width: 1440, height: 900 };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

test.use({ storageState: OWNER_STATE, viewport: DESK });

async function open(page: Page, locale: Locale, path = LAB) {
  const url = test.info().project.use.baseURL ?? 'http://localhost:3100';
  await page.context().addCookies([
    { name: 'rm_locale', value: locale, url },
    { name: 'rm_cookie_consent', value: 'necessary', url },
  ]);
  await page.goto(path, { waitUntil: 'load' });
  await page.locator('[data-table="lab-desk"], [data-splitpane]').first().waitFor();
}

/** Dispatches a keydown as a Hebrew layout produces it: physical `code`, Hebrew `key`. */
async function hebrewKey(page: Page, code: string, key: string) {
  await page.evaluate(
    ([c, k]) => {
      const el = document.activeElement ?? document.body;
      el.dispatchEvent(new KeyboardEvent('keydown', { code: c, key: k, bubbles: true, cancelable: true }));
    },
    [code, key],
  );
}

const sel = (page: Page) => new URL(page.url()).searchParams.get('sel');

/** The page, sorted by gap ascending, where rows under and over the ₪200 cap meet. */
function crossingPage(): number {
  const ranked = [...labRows()]
    .map((r, i) => ({ r, i }))
    .sort((a, b) => Math.abs(a.r.deltaAgorot) - Math.abs(b.r.deltaAgorot) || a.i - b.i);
  const firstOver = ranked.findIndex((x) => Math.abs(x.r.deltaAgorot) > 20_000);
  return Math.floor((firstOver - 3) / 50) + 1;
}

/** In he: the ₪ glyph renders left of the first digit (DoD-4). */
async function shekelLeftOfDigits(page: Page, selector: string): Promise<boolean[]> {
  return page.$$eval(selector, (els) =>
    els.map((el) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let shekel: DOMRect | null = null;
      let digit: DOMRect | null = null;
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = n.textContent ?? '';
        for (let i = 0; i < text.length; i++) {
          const r = document.createRange();
          r.setStart(n, i);
          r.setEnd(n, i + 1);
          if (text[i] === '₪' && !shekel) shekel = r.getBoundingClientRect();
          if (/\d/.test(text[i]!) && !digit) digit = r.getBoundingClientRect();
        }
      }
      return !!shekel && !!digit && shekel.right <= digit.left + 1;
    }),
  );
}

test.describe('W1-02 DataTable', () => {
  test('one sorted column; ₪ sorts descending first; sticky header, identity and actions', async ({ page }) => {
    await open(page, 'he');
    const sorted = page.locator('th[aria-sort]');
    await expect(sorted).toHaveCount(1);
    await expect(sorted).toHaveAttribute('data-col', 'atRisk');
    await expect(sorted).toHaveAttribute('aria-sort', 'descending');

    await page.locator('th[data-col="total"] button').click();
    await expect(page.locator('th[aria-sort]')).toHaveCount(1);
    await expect(page.locator('th[data-col="total"]')).toHaveAttribute('aria-sort', 'descending');
    await page.locator('th[data-col="supplier"] button').click();
    await expect(page.locator('th[data-col="supplier"]')).toHaveAttribute('aria-sort', 'ascending');
    expect(new URL(page.url()).searchParams.get('sort')).toBe('supplier:asc');

    const pos = await page.evaluate(() => {
      const css = (el: Element | null) => (el ? getComputedStyle(el).position : null);
      const row = document.querySelector('tbody tr[data-row-id]');
      return {
        head: css(document.querySelector('thead th[data-col="total"]')),
        identity: css(row?.children[1] ?? null),
        actions: css(row?.lastElementChild ?? null),
      };
    });
    expect(pos).toEqual({ head: 'sticky', identity: 'sticky', actions: 'sticky' });

    // The header stays in view while the body scrolls.
    const scroller = page.locator('[data-table-scroll]');
    await scroller.evaluate((el) => (el.scrollTop = 800));
    const [headTop, boxTop] = await Promise.all([
      page.locator('thead th[data-col="total"]').evaluate((el) => el.getBoundingClientRect().top),
      scroller.evaluate((el) => el.getBoundingClientRect().top),
    ]);
    expect(Math.abs(headTop - boxTop)).toBeLessThanOrEqual(2);
  });

  for (const locale of ['he', 'en'] as const) {
    test(`NumCell is physically right-aligned and the totals row is the server sum (${locale})`, async ({ page }) => {
      await open(page, locale);
      await expect(page.locator('th[data-col="total"]')).toContainText('(₪)');
      const edges = await page.$$eval('tbody tr[data-row-id]', (trs) =>
        trs.slice(0, 12).map((tr) => {
          const td = tr.querySelector('td:nth-child(5)') as HTMLElement; // total
          const span = td.querySelector('span') as HTMLElement;
          const pad = parseFloat(getComputedStyle(td).paddingRight);
          return Math.round(td.getBoundingClientRect().right - pad - span.getBoundingClientRect().right);
        }),
      );
      for (const gap of edges) expect(Math.abs(gap)).toBeLessThanOrEqual(1);
      const decimals = await page.$$eval('tbody tr[data-row-id] td:nth-child(5) span', (s) =>
        s.slice(0, 12).map((x) => /\.\d{2}$/.test(x.textContent ?? '')),
      );
      expect(decimals.every(Boolean)).toBe(true);

      const { count, sumAgorot } = viewTotals(labRows(), 'all');
      const expected = new Intl.NumberFormat(locale === 'he' ? 'he-IL' : 'en-IL', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(sumAgorot / 100);
      await expect(page.locator('[data-totals-cell]')).toHaveText(expected);
      await expect(page.locator('[data-totals]')).toContainText(String(count));
      await expect(page.locator('[data-table-showing]')).toContainText(String(LAB_ROW_COUNT));
    });
  }

  test('BatchBar: count + Σ₪, block rows disabled with the reason, select-all skips over-cap and unknown rows', async ({ page }) => {
    await open(page, 'he');
    const block = page.locator('tr[data-block]').first();
    await expect(block.locator('input[type=checkbox]')).toBeDisabled();
    await expect(block).toContainText('דורש בדיקה פרטנית');
    // The page (sorted by gap ascending) where rows under and over the ₪200 cap meet.
    await open(page, 'he', `${LAB}?sort=atRisk:asc&page=${crossingPage()}`);

    const pick = page.locator('tr[data-row-id]:not([data-block]):not([data-over-cap]):not([data-amount-unknown])');
    for (let i = 0; i < 3; i++) await pick.nth(i).locator('input[type=checkbox]').check();
    const bar = page.locator('[data-batchbar]');
    await expect(bar.locator('[data-batch-count]')).toHaveText('3 נבחרו');
    const ids = await pick.evaluateAll((trs) => trs.slice(0, 3).map((t) => t.getAttribute('data-row-id')));
    const sum = labRows()
      .filter((r) => ids.includes(r.id))
      .reduce((s, r) => s + Math.abs(r.deltaAgorot), 0);
    await expect(bar.locator('[data-batch-sum]')).toContainText(
      new Intl.NumberFormat('he-IL', { minimumFractionDigits: 2 }).format(sum / 100),
    );
    expect(await shekelLeftOfDigits(page, '[data-batch-sum]')).toEqual([true]);
    // No server enforces the cap yet, so bulk approve stays off, with the reason shown.
    const approve = bar.locator('[data-batch-action="approve"]');
    await expect(approve).toBeDisabled();
    await expect(bar.locator('[data-batch-why="approve"]')).toContainText('כשהשרת יאכוף');
    await expect(approve).toHaveAttribute('aria-describedby', 'batch-why-approve');

    await bar.getByRole('button', { name: /ניקוי/ }).click();
    await expect(bar).toHaveCount(0);
    // Focus goes back into the table, never to <body>.
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('tbody'))).toBe(true);
    await page.getByRole('checkbox', { name: 'בחירת כל השורות המתאימות' }).check();
    const checked = await page.$$eval('tbody input[type=checkbox]:checked', (els) =>
      els.map((e) => {
        const tr = e.closest('tr')!;
        return { held: tr.hasAttribute('data-block') || tr.hasAttribute('data-over-cap') || tr.hasAttribute('data-amount-unknown') };
      }),
    );
    expect(checked.length).toBeGreaterThan(0);
    expect(checked.every((c) => !c.held)).toBe(true);
    // Per-row actions are off in batch mode.
    await expect(page.locator('tbody tr[data-row-id]').first().getByRole('button', { name: 'אישור', exact: true })).toBeDisabled();
    // Esc in the table clears the selection.
    await page.locator('tbody tr[data-row-id]').first().focus();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-batchbar]')).toHaveCount(0);
  });

  test('capped approve (server-enforced lab simulation): over-cap and unknown rows disable it; other actions keep them', async ({ page }) => {
    await open(page, 'he', `${LAB}?sort=atRisk:asc&page=${crossingPage()}&enforced=1`);
    const bar = page.locator('[data-batchbar]');
    const approve = bar.locator('[data-batch-action="approve"]');
    const pick = page.locator('tr[data-row-id]:not([data-block]):not([data-over-cap]):not([data-amount-unknown])');
    for (let i = 0; i < 3; i++) await pick.nth(i).locator('input[type=checkbox]').check();
    await expect(approve).toBeEnabled();
    await expect(approve).toContainText('אישור 3');
    const over = page.locator('tr[data-over-cap]:not([data-block])').first();
    await over.locator('input[type=checkbox]').check();
    await expect(bar.locator('[data-batch-count]')).toHaveText('4 נבחרו');
    await expect(approve).toBeDisabled();
    await expect(bar.locator('[data-batch-why="approve"]')).toContainText('אישור מרוכז רק עד');
    // Only the capped action drops the over-cap row: assign still takes all 4.
    await expect(bar.locator('[data-batch-action="assign"]')).toBeEnabled();
    await expect(bar.locator('[data-batch-action="assign"]')).toContainText('שיוך 4');
    await over.locator('input[type=checkbox]').uncheck();
    await expect(approve).toBeEnabled();
    // Esc from inside the bar clears too, and focus lands back in the table.
    await approve.focus();
    await page.keyboard.press('Escape');
    await expect(bar).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('tbody'))).toBe(true);

    // An unknown (pending) gap is never ₪0: it blocks the capped action with its own reason.
    await open(page, 'he', `${LAB}?sort=atRisk:asc&enforced=1`);
    const unknown = page.locator('tr[data-amount-unknown]').first();
    await unknown.locator('input[type=checkbox]').check();
    await expect(approve).toBeDisabled();
    await expect(bar.locator('[data-batch-why="approve"]')).toContainText('עוד לא ידוע');
  });

  test('a partly failed batch keeps only the failed rows selected and says so', async ({ page }) => {
    await open(page, 'he', `${LAB}?sort=atRisk:asc&page=${crossingPage()}&fail=assign`);
    const pick = page.locator('tr[data-row-id]:not([data-block])');
    const ids = await pick.evaluateAll((trs) => trs.slice(0, 4).map((t) => t.getAttribute('data-row-id')!));
    for (let i = 0; i < 4; i++) await pick.nth(i).locator('input[type=checkbox]').check();
    const bar = page.locator('[data-batchbar]');
    await bar.locator('[data-batch-action="assign"]').click();
    const failing = ids.filter((id) => Number(id.slice(4)) % 2 === 0);
    await expect(bar.locator('[data-batch-count]')).toHaveText(failing.length === 1 ? '1 נבחרו' : `${failing.length} נבחרו`);
    await expect(bar.locator('[data-batch-note]')).toBeVisible();
    const still = await page.$$eval('tbody input[type=checkbox]:checked', (els) => els.map((e) => e.closest('tr')!.getAttribute('data-row-id')));
    expect(still.sort()).toEqual([...failing].sort());
  });

  test('URL state round-trips and Back restores selection and scroll', async ({ page }) => {
    await open(page, 'he');
    await page.locator('th[data-col="total"] button').click();
    await page.locator('[data-view="warn"]').click();
    await expect(page).toHaveURL(/view=warn/);
    await page.getByRole('button', { name: 'עמודות' }).click();
    await page.getByRole('checkbox', { name: 'סטטוס' }).uncheck();
    await page.keyboard.press('Escape');
    await expect(page.locator('th[data-col="status"]')).toHaveCount(0);

    const scroller = page.locator('[data-table-scroll]');
    await scroller.evaluate((el) => (el.scrollTop = 600));
    await page.waitForTimeout(100);
    const row = page.locator('tbody tr[data-row-id]').nth(14);
    const rowId = await row.getAttribute('data-row-id');
    await row.focus();
    await page.keyboard.press('KeyJ');
    await page.keyboard.press('KeyK');
    expect(sel(page)).toBe(rowId);
    const before = new URL(page.url()).searchParams;
    expect(before.get('sort')).toBe('total:desc');
    expect(before.get('cols')).not.toContain('status');

    await row.hover();
    await row.getByRole('button', { name: 'פתיחה', exact: true }).click();
    await page.waitForURL(new RegExp(`/lab/desk/${rowId}$`));
    await page.goBack();
    await page.locator('[data-table="lab-desk"]').waitFor();
    await expect(page.locator(`tr[data-row-id="${rowId}"]`)).toHaveAttribute('data-active', 'true');
    const after = new URL(page.url()).searchParams;
    for (const k of ['sort', 'cols', 'sel', 'view']) expect(after.get(k)).toBe(before.get(k));
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(500);

    // Back once more undoes the view change.
    await page.goBack();
    await expect(page).not.toHaveURL(/view=warn/);
  });

  test('J/K on a Hebrew layout move ?sel= with zero navigations; keys need list focus', async ({ page }) => {
    await open(page, 'he');
    const ids = await page.$$eval('tbody tr[data-row-id]', (trs) => trs.map((t) => t.getAttribute('data-row-id')));
    await page.evaluate(() => ((window as unknown as { __desk: number }).__desk = 1));
    // Outside the list: nothing happens.
    await page.locator('h1').click();
    await hebrewKey(page, 'KeyJ', 'ח');
    expect(sel(page)).toBeNull();
    // Typing in the search box: nothing happens.
    await page.getByRole('searchbox').focus();
    await hebrewKey(page, 'KeyJ', 'ח');
    expect(sel(page)).toBeNull();

    await page.locator('tbody tr[data-row-id]').first().focus();
    for (let i = 0; i < 9; i++) await hebrewKey(page, 'KeyJ', 'ח');
    await expect.poll(() => sel(page)).toBe(ids[9]);
    await hebrewKey(page, 'KeyK', 'ל');
    await expect.poll(() => sel(page)).toBe(ids[8]);
    await expect(page.locator(`tr[data-row-id="${ids[8]}"]`)).toBeFocused();
    // Same document: the marker survives, so no page load happened.
    expect(await page.evaluate(() => (window as unknown as { __desk?: number }).__desk)).toBe(1);
  });

  test('Peek opens from cache in under 100 ms, traps focus, Esc returns focus to the row', async ({ page }) => {
    await open(page, 'he');
    const row = page.locator('tbody tr[data-row-id]').nth(2);
    const rowId = await row.getAttribute('data-row-id');
    await row.focus();
    const ms = await page.evaluate(async () => {
      const t0 = performance.now();
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true }));
      for (let i = 0; i < 60 && !document.querySelector('[data-peek]'); i++) await new Promise((r) => requestAnimationFrame(r));
      return document.querySelector('[data-peek]') ? performance.now() - t0 : Infinity;
    });
    // The <100 ms budget is a production-build number (E2E_PROD=1 against `next start`);
    // dev-mode React is several times slower, so the dev soak only guards against a regression to a fetch.
    expect(ms).toBeLessThan(process.env.E2E_PROD ? 100 : 1000);
    const peek = page.getByRole('dialog');
    await expect(peek).toBeVisible();
    await expect(peek.locator(`[data-peek-row="${rowId}"]`)).toBeVisible();
    expect(new URL(page.url()).searchParams.get('peek')).toBe(rowId);
    // Peek opens at the inline-end edge: the left in Hebrew.
    const box = await peek.boundingBox();
    expect(box!.x).toBeLessThanOrEqual(1);
    expect(box!.width).toBe(520);
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[data-peek]'))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(peek).toHaveCount(0);
    await expect(page.locator(`tr[data-row-id="${rowId}"]`)).toBeFocused();
    expect(new URL(page.url()).searchParams.get('peek')).toBeNull();
  });

  test('CSV export: BOM, header rows (period, scope, filters, generated-at Asia/Jerusalem), totals', async ({ page }) => {
    await open(page, 'he', `${LAB}?view=block`);
    await page.getByRole('button', { name: 'ייצוא' }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'הורדת CSV (Excel)' }).click(),
    ]);
    const text = readFileSync((await download.path())!, 'utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).split('\r\n');
    expect(lines[0]).toBe('חשבוניות לדוגמה');
    expect(lines[1]).toBe('תקופה,אוקטובר 2026 (1–25)');
    expect(lines[2]).toBe('היקף,כפר הזיתים (נתוני מעבדה)');
    expect(lines[3]).toBe('סינון,חוסמים');
    expect(lines[4]).toMatch(/^הופק,\d{2}\.\d{2}\.\d{4} \d{2}:\d{2} \(Asia\/Jerusalem\)$/);
    expect(lines[6]).toContain('סכום (₪)');
    const { count, sumAgorot } = viewTotals(labRows(), 'block');
    expect(lines).toHaveLength(7 + count + 1);
    expect(lines.at(-1)).toContain(`,${sumAgorot / 100},`);
  });

  test('density sets row heights 32 / 48 / 56', async ({ page }) => {
    for (const [d, h] of [
      ['compact', 32],
      ['default', 48],
      ['touch', 56],
    ] as const) {
      await open(page, 'en', `${LAB}?d=${d}`);
      const height = await page.locator('tbody tr[data-row-id]:not([data-block])').first().evaluate((el) => el.getBoundingClientRect().height);
      expect(Math.round(height), d).toBe(h);
    }
  });

  test('designed states: loading, error with retry, empty with an action, no results', async ({ page }) => {
    await open(page, 'he', `${LAB}?state=loading`);
    await expect(page.locator('tbody tr[aria-hidden]')).toHaveCount(8);
    await expect(page.locator('[data-totals]')).toHaveCount(0);
    await open(page, 'he', `${LAB}?state=error`);
    await expect(page.locator('[data-table] [role=alert]')).toHaveText('הנתונים לא נטענו');
    await expect(page.getByRole('button', { name: 'ניסיון חוזר' })).toBeVisible();
    await open(page, 'he', `${LAB}?state=empty`);
    await expect(page.getByText('אין עדיין שורות')).toBeVisible();
    await expect(page.getByRole('button', { name: 'העלאת חשבונית ראשונה' })).toBeVisible();
    await open(page, 'he');
    await page.getByRole('searchbox').fill('zzz-none');
    await expect(page.getByText('אין שורות שתואמות לסינון')).toBeVisible();
    await page.getByRole('button', { name: 'ניקוי הסינון' }).click();
    await expect(page.locator('tbody tr[data-row-id]')).toHaveCount(50);
  });
});

test.describe('W1-02 SplitPane', () => {
  test('J/K swap the detail with no route change; Enter opens the full page; Back restores', async ({ page }) => {
    await open(page, 'he', `${LAB}?mode=split`);
    const options = page.getByRole('listbox', { name: 'רשימת חשבוניות' }).getByRole('option');
    const ids = await options.evaluateAll((els) => els.map((e) => e.getAttribute('data-row-id')));
    await page.evaluate(() => ((window as unknown as { __desk: number }).__desk = 1));
    await hebrewKey(page, 'KeyJ', 'ח');
    expect(sel(page)).toBeNull();
    await options.first().focus();
    // J moves from the focused item, as in the table: 3 presses from item 1 land on item 4.
    for (let i = 0; i < 3; i++) await hebrewKey(page, 'KeyJ', 'ח');
    await expect.poll(() => sel(page)).toBe(ids[3]);
    await expect(page.locator(`[data-split-row="${ids[3]}"]`)).toBeVisible();
    await expect(options.nth(3)).toHaveAttribute('aria-selected', 'true');
    expect(await page.evaluate(() => (window as unknown as { __desk?: number }).__desk)).toBe(1);
    await page.keyboard.press('Enter');
    await page.waitForURL(new RegExp(`/lab/desk/${ids[3]}$`));
    await page.goBack();
    await expect(page.locator(`[data-split-row="${ids[3]}"]`)).toBeVisible();
  });
});

test.describe('W1-02 phone', () => {
  test.use({ ...PHONE });
  for (const locale of ['he', 'en'] as const) {
    test(`below 768 px the columns render as cards; ₪ at the line end; no horizontal scroll (${locale})`, async ({ page }) => {
      await open(page, locale);
      await expect(page.locator('[data-mobile-cards]')).toBeVisible();
      await expect(page.locator('table')).toHaveCount(0);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      const card = page.locator('[data-mobile-cards] li').first();
      const [name, amount] = await Promise.all([
        card.getByRole('button').first().boundingBox(),
        card.locator('span.tabular-nums').first().boundingBox(),
      ]);
      // Inline end: the left in Hebrew, the right in English.
      if (locale === 'he') expect(amount!.x + amount!.width).toBeLessThanOrEqual(name!.x + 1);
      else expect(amount!.x).toBeGreaterThanOrEqual(name!.x + name!.width - 1);
      if (locale === 'he') expect((await shekelLeftOfDigits(page, '[data-mobile-cards] li span.tabular-nums')).slice(0, 5)).toEqual([true, true, true, true, true]);
    });
  }
});

test.describe('W1-02 axe', () => {
  const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
  for (const locale of ['he', 'en'] as const) {
    for (const [name, path] of [
      ['table', LAB],
      ['split', `${LAB}?mode=split`],
      ['peek', `${LAB}?sel=inv-003&peek=inv-003`],
    ] as const) {
      test(`no serious/critical axe violations: ${name} (${locale})`, async ({ page }) => {
        await open(page, locale, path);
        await page.addScriptTag({ content: AXE_SOURCE });
        const violations = await page.evaluate(async (tags) => {
          // @ts-expect-error axe is injected above
          const r = await window.axe.run(document, { runOnly: { type: 'tag', values: tags }, exclude: [['[data-worker-banner]']] });
          return (r.violations as { id: string; impact: string; nodes: { target: string[] }[] }[])
            .filter((v) => v.impact === 'serious' || v.impact === 'critical')
            .map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
        }, WCAG);
        expect(violations).toEqual([]);
      });
    }
  }
});
