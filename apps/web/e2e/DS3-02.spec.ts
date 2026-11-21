import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * DS3-02 · the shell: side menu, top bar, command palette (docs/ux/sidebar/SPEC.md §14, owner-approved
 * 31.10.2026, in the DS3 clean finish). The seeded demo tenant ("כפר הזיתים", every flag on), each role.
 * Ports the spec's acceptance list where it applies to the product, and the behaviour the DS3 reference's
 * menu check asserts (docs/ux/ds3/reference/checks/menu-check.cjs) where it agrees with the spec.
 */

type Role = 'owner' | 'manager' | 'bookkeeper' | 'chef' | 'receiver';
const ROLES: Role[] = ['owner', 'manager', 'bookkeeper', 'chef', 'receiver'];
const PASSWORD = process.env.DEMO_PASSWORD ?? 'RestoMatch-Demo-2026!';
const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;
const states = new Map<Role, StorageState>();

async function stateFor(browser: Browser, baseURL: string, role: Role): Promise<StorageState> {
  if (!states.has(role)) {
    const ctx = await browser.newContext({ baseURL });
    await ctx.addCookies([{ name: 'rm_cookie_consent', value: 'necessary', url: baseURL }]);
    const page = await ctx.newPage();
    await page.goto('/login');
    await page.locator('form:has(#password) [name=email]').fill(`${role}@kfar-hazeitim.test`);
    await page.locator('#password').fill(PASSWORD);
    await page.locator('form:has(#password) button[type=submit]').click();
    await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
    states.set(role, await ctx.storageState());
    await ctx.close();
  }
  return states.get(role)!;
}

interface Opts {
  role?: Role;
  path?: string;
  width?: number;
  height?: number;
  locale?: 'he' | 'en';
  rail?: boolean;
  phone?: boolean;
  reducedMotion?: 'reduce' | 'no-preference';
  forcedColors?: 'active' | 'none';
}

async function open(browser: Browser, baseURL: string, o: Opts = {}): Promise<Page> {
  const { role = 'owner', path = '/dashboard', width = 1440, height = 900, locale = 'he', rail = false, phone = false } = o;
  const ctx = await browser.newContext({
    baseURL,
    viewport: { width, height },
    isMobile: phone,
    hasTouch: phone,
    reducedMotion: o.reducedMotion ?? 'reduce',
    forcedColors: o.forcedColors ?? 'none',
    storageState: await stateFor(browser, baseURL, role),
  });
  await ctx.addCookies([
    { name: 'rm_locale', value: locale, url: baseURL },
    { name: 'rm_cookie_consent', value: 'necessary', url: baseURL },
    { name: 'rm_nav_rail', value: rail ? '1' : '0', url: baseURL },
  ]);
  const page = await ctx.newPage();
  await page.goto(path);
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
  // Hydrated: the frame publishes its mode once it knows the viewport.
  await expect(page.locator('#rm-app[data-nav-mode]')).toHaveCount(1);
  return page;
}

const aside = (page: Page) => page.getByTestId('sidebar');

/** x of each matched element's icon box centre, measured from the menu's inline-start edge. */
async function iconAxis(page: Page, selector: string): Promise<number[]> {
  return page.evaluate((sel) => {
    const a = document.querySelector('[data-testid="sidebar"]')!.getBoundingClientRect();
    const rtl = document.documentElement.dir === 'rtl';
    return [...document.querySelectorAll<HTMLElement>(sel)]
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => {
        const r = el.getBoundingClientRect();
        const c = r.left + r.width / 2;
        return rtl ? a.right - c : c - a.left;
      });
  }, selector);
}

async function axeSerious(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(async () => {
    const w = window as unknown as {
      axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; impact: string; nodes: { target: string[] }[] }[] }> };
    };
    const res = await w.axe.run(
      { exclude: [['nextjs-portal'], ['#main-content [role=status]']] },
      { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } },
    );
    return res.violations
      .filter((v) => v.impact === 'critical' || v.impact === 'serious')
      .flatMap((v) => v.nodes.map((n) => `${v.id} @ ${n.target.join(' ')}`));
  });
}

test.describe.configure({ mode: 'serial' });

test('§14.1 side and width: inline-start edge in he and en; 248 at 1440, 64 rail at 1100', async ({ browser, baseURL }) => {
  const he = await open(browser, baseURL!);
  const r = (await aside(he).boundingBox())!;
  expect(Math.round(r.x + r.width)).toBe(1440);
  expect(Math.round(r.width)).toBe(248);
  await expect(aside(he)).toHaveAttribute('aria-label', 'תפריט צד');
  await expect(aside(he).locator('nav[aria-label="ניווט ראשי"]')).toHaveCount(1);
  await he.context().close();

  const en = await open(browser, baseURL!, { locale: 'en' });
  expect(Math.round((await aside(en).boundingBox())!.x)).toBe(0);
  await en.context().close();

  const mid = await open(browser, baseURL!, { width: 1100, height: 700 });
  expect(Math.round((await aside(mid).boundingBox())!.width)).toBe(64);
  await mid.context().close();
});

test('§14.2 grid: icons on x = 32 in the panel and the rail; labels at 52; badges end at 227', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL!, { path: '/dashboard/approvals' });
  const icons = await iconAxis(page, '[data-testid="sidebar"] :is(a, button)[data-nav-key] > span:first-child, [data-testid="sidebar"] button[data-nav-group] > span:first-child');
  expect(icons.length).toBeGreaterThan(8);
  for (const x of icons) expect(Math.round(x * 2) / 2).toBe(32);
  const labels = await page.evaluate(() => {
    const a = document.querySelector('[data-testid="sidebar"]')!.getBoundingClientRect();
    return [...document.querySelectorAll<HTMLElement>('[data-testid="sidebar"] a[data-nav-key]')]
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => {
        const lab = el.children[1] as HTMLElement;
        return Math.round(a.right - lab.getBoundingClientRect().right);
      });
  });
  for (const x of labels) expect(x).toBe(52);
  const pillEnds = await page.evaluate(() => {
    const a = document.querySelector('[data-testid="sidebar"]')!.getBoundingClientRect();
    return [...document.querySelectorAll<HTMLElement>('[data-testid="sidebar"] [data-nav-badge]')]
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => Math.round(a.right - el.getBoundingClientRect().left));
  });
  for (const x of pillEnds) expect(x).toBe(227);
  await page.context().close();

  const rail = await open(browser, baseURL!, { rail: true, path: '/dashboard/approvals' });
  const tiles = await iconAxis(rail, '[data-testid="sidebar"] :is(a, button)[data-nav-key] > span:first-child, [data-testid="sidebar"] button[data-nav-group] > span:first-child');
  expect(tiles.length).toBeGreaterThan(4);
  for (const x of tiles) expect(x).toBe(32);
  await rail.context().close();
});

test('§14.3–4 Ctrl+B on a Hebrew layout: icons never move sideways; the cookie keeps the rail with no first-paint change', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL!, { reducedMotion: 'no-preference' });
  const sel = '[data-testid="sidebar"] a[data-nav-key="home"] > span:first-child';
  // A Hebrew layout: KeyB types "נ". The binding is on the physical key (KeyboardEvent.code).
  const samples = await page.evaluate(async (s) => {
    const axis = () => {
      const a = document.querySelector('[data-testid="sidebar"]')!.getBoundingClientRect();
      const r = document.querySelector(s)!.getBoundingClientRect();
      return a.right - (r.left + r.width / 2);
    };
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB', key: 'נ', ctrlKey: true, bubbles: true }));
    const t0 = performance.now();
    const out: number[] = [];
    for (const ms of [40, 90, 140, 260]) {
      while (performance.now() - t0 < ms) await new Promise((r) => requestAnimationFrame(r));
      out.push(axis());
    }
    return out;
  }, sel);
  expect(samples).toHaveLength(4);
  for (const x of samples) expect(Math.round(x)).toBe(32);
  await expect.poll(async () => Math.round((await aside(page).boundingBox())!.width)).toBe(64);
  // Reload without clearing storage: the server reads the cookie, so the first paint is the rail.
  const widths: number[] = [];
  await page.exposeFunction('reportWidth', (w: number) => widths.push(w));
  await page.addInitScript(() => {
    new MutationObserver(() => {
      const a = document.querySelector('[data-testid="sidebar"]');
      // Count only once the shell's own styles apply: `next dev` injects CSS by script, so its first frame is
      // unstyled (a production build links the CSS in <head> and every frame counts). What this guards is a
      // width that flips after hydration, which would show here either way.
      if (a && getComputedStyle(a).position === 'fixed') {
        (window as unknown as { reportWidth: (w: number) => void }).reportWidth(Math.round(a.getBoundingClientRect().width));
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await page.reload();
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
  expect(Math.round((await aside(page).boundingBox())!.width)).toBe(64);
  expect(widths.filter((w) => w > 0 && w !== 64)).toEqual([]);
  await page.context().close();
});

test('§14.5 1100×700: the toggle opens the panel over the page; the page is inert and keeps its width; Esc returns to the toggle', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL!, { width: 1100, height: 700 });
  const before = (await page.locator('main').boundingBox())!.width;
  await page.getByTestId('sidebar-toggle').click();
  await expect(page.locator('#rm-app')).toHaveAttribute('data-overlay', 'open');
  expect(Math.round((await aside(page).boundingBox())!.width)).toBe(248);
  expect((await page.locator('main').boundingBox())!.width).toBe(before);
  await expect(page.locator('main').locator('xpath=ancestor::div[@inert]')).toHaveCount(1);
  let escaped = 0;
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    if (!(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="sidebar"]')))) escaped += 1;
  }
  expect(escaped).toBe(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('#rm-app')).not.toHaveAttribute('data-overlay', 'open');
  await expect(page.getByTestId('sidebar-toggle')).toBeFocused();
  await page.context().close();
});

test('§4.2 default-open groups by role; the current page\'s group is always open', async ({ browser, baseURL }) => {
  const expectOpen: Record<'owner' | 'manager' | 'bookkeeper', string[]> = {
    owner: ['money', 'leaks'],
    manager: ['money', 'procure'],
    bookkeeper: ['money', 'leaks'],
  };
  for (const role of ['owner', 'manager', 'bookkeeper'] as const) {
    const page = await open(browser, baseURL!, { role });
    for (const g of expectOpen[role]) await expect(aside(page).locator(`[data-group="${g}"]`)).toHaveAttribute('data-open', 'true');
    await page.context().close();
  }
  const page = await open(browser, baseURL!, { role: 'owner', path: '/dashboard/suppliers' });
  await expect(aside(page).locator('[data-group="procure"]')).toHaveAttribute('data-open', 'true');
  await expect(aside(page).locator('a[data-nav-key="suppliers"]')).toHaveAttribute('aria-current', 'page');
  await page.context().close();
});

test('§14.6 fit: the list fits or fades at every desktop size; כסף stays open while it carries ₪', async ({ browser, baseURL }) => {
  for (const role of ['owner', 'manager', 'bookkeeper'] as const) {
    for (const [width, height] of [
      [1440, 900],
      [1366, 768],
      [1280, 800],
      [1280, 720],
    ] as const) {
      const page = await open(browser, baseURL!, { role, width, height });
      const state = await page.evaluate(() => {
        const sc = document.querySelector<HTMLElement>('[data-testid="sidebar-groups"]')!;
        const over = sc.scrollHeight - sc.clientHeight;
        const masked = getComputedStyle(sc).maskImage !== 'none' || getComputedStyle(sc).webkitMaskImage !== 'none';
        return { over, masked };
      });
      expect(state.over <= 1 || state.masked, `${role} ${width}×${height}`).toBe(true);
      // No two controls overlap.
      const overlaps = await page.evaluate(() => {
        const els = [...document.querySelectorAll<HTMLElement>('[data-testid="sidebar"] :is(a[href], button)')].filter((e) => e.getClientRects().length > 0);
        const rs = els.map((e) => e.getBoundingClientRect());
        let n = 0;
        for (let i = 0; i < rs.length; i++)
          for (let j = i + 1; j < rs.length; j++) {
            const a = rs[i]!;
            const b = rs[j]!;
            if (els[i]!.contains(els[j]!) || els[j]!.contains(els[i]!)) continue;
            if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) n += 1;
          }
        return n;
      });
      expect(overlaps, `${role} ${width}×${height} overlaps`).toBe(0);
      await page.context().close();
    }
  }
  // Open every group at 1280×720: money keeps ₪ open, the page's group stays open.
  const page = await open(browser, baseURL!, { role: 'owner', width: 1280, height: 720, path: '/dashboard/suppliers' });
  for (const g of ['money', 'leaks', 'procure', 'kitchen', 'admin']) {
    const header = aside(page).locator(`button[data-nav-group="${g}"]`);
    if ((await header.count()) && (await header.getAttribute('aria-expanded')) === 'false') await header.click();
  }
  const moneyHasMoney = (await aside(page).locator('[data-group="money"] [data-nav-badge="block"], [data-group="money"] [data-nav-badge="warn"]').count()) > 0;
  if (moneyHasMoney) await expect(aside(page).locator('[data-group="money"]')).toHaveAttribute('data-open', 'true');
  await expect(aside(page).locator('[data-group="procure"]')).toHaveAttribute('data-open', 'true');
  await page.context().close();
});

test('§14.8 Tab order: skip link → switcher → Ctrl K → בית → לטיפולי → כסף → אישורים within 8 Tabs', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL!);
  let tabs = 0;
  let at = '';
  while (tabs < 8 && at !== 'approvals') {
    await page.keyboard.press('Tab');
    tabs += 1;
    at = (await page.evaluate(() => document.activeElement?.getAttribute('data-nav-key') ?? '')) || '';
  }
  expect(at).toBe('approvals');
  expect(tabs).toBeLessThanOrEqual(8);
  await page.context().close();
});

test('§14.9 arrows (RTL): ← opens a group and enters it, → returns and closes; in the rail ← opens the list, Esc returns', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL!, { role: 'owner' });
  const header = aside(page).locator('button[data-nav-group="procure"]');
  if ((await header.getAttribute('aria-expanded')) === 'true') await header.click();
  await header.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(header).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(aside(page).locator('a[data-nav-key="orders"]')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(header).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(header).toHaveAttribute('aria-expanded', 'false');
  // ↓ reaches every row, not only the linked ones (KNOWN-ISSUES: the mock-up stopped at four).
  await aside(page).locator('a[data-nav-key="home"]').focus();
  const seen = new Set<string>();
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('ArrowDown');
    seen.add((await page.evaluate(() => document.activeElement?.getAttribute('data-nav-key') ?? document.activeElement?.getAttribute('data-nav-group') ?? '')) || '');
  }
  for (const k of ['approvals', 'payRun', 'money', 'leaks']) expect(seen.has(k), k).toBe(true);
  await page.context().close();

  const rail = await open(browser, baseURL!, { role: 'owner', rail: true });
  const tile = aside(rail).locator('button[data-nav-group="money"]');
  await tile.focus();
  await rail.keyboard.press('ArrowLeft');
  await expect(rail.locator('[data-fly-panel="money"]')).toBeVisible();
  await expect(rail.locator('[data-fly-panel="money"] a[href]').first()).toBeFocused();
  await rail.keyboard.press('ArrowUp');
  await rail.keyboard.press('ArrowUp');
  expect(await rail.evaluate(() => !!document.activeElement?.closest('[data-fly-panel="money"]'))).toBe(true);
  await rail.keyboard.press('Escape');
  await expect(rail.locator('[data-fly-panel="money"]')).toBeHidden();
  await expect(tile).toBeFocused();
  await rail.context().close();
});

test('§14.9 Hebrew layout: G then Q (which types "/") goes to לטיפולי and never opens the palette', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL!, { role: 'owner', path: '/dashboard/suppliers' });
  await page.locator('h1').first().click();
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const fire = (code: string, key: string) => window.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true }));
    fire('KeyG', 'ע');
    fire('KeyQ', '/');
  });
  await page.waitForURL(/\/dashboard(#needs-you-title)?$/);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await page.context().close();
});

test('§14.10 aim: crossing ניתוח on the way to כסף\'s last row keeps כסף open', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL!, { role: 'owner', rail: true, reducedMotion: 'no-preference' });
  const money = aside(page).locator('button[data-nav-group="money"]');
  const mb = (await money.boundingBox())!;
  await page.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2);
  await expect(page.locator('[data-fly-panel="money"]')).toBeVisible();
  const last = page.locator('[data-fly-panel="money"] li').last();
  const lb = (await last.boundingBox())!;
  const from = { x: mb.x + mb.width / 2, y: mb.y + mb.height / 2 };
  const to = { x: lb.x + lb.width / 2, y: lb.y + lb.height / 2 };
  for (let i = 1; i <= 14; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / 14, from.y + ((to.y - from.y) * i) / 14);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(350);
  await expect(page.locator('[data-fly-panel="money"]')).toBeVisible();
  await expect(page.locator('[data-fly-panel="leaks"]')).toBeHidden();
  await page.context().close();
});

test('§14.11 tooltips: keyboard focus on a rail tile shows it at once, 8 px beside the rail, never over the trigger; Esc hides it', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL!, { role: 'owner', rail: true });
  await aside(page).locator('a[data-nav-key="home"]').focus();
  await page.keyboard.press('ArrowDown');
  const tip = page.getByTestId('nav-tooltip');
  await expect(tip).toBeVisible({ timeout: 200 });
  const t = (await tip.boundingBox())!;
  const a = (await aside(page).boundingBox())!;
  expect(Math.round(a.x - (t.x + t.width))).toBe(8);
  const focused = await page.evaluate(() => {
    const r = document.activeElement!.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  });
  expect(t.x + t.width <= focused.left || t.x >= focused.right || t.y + t.height <= focused.top || t.y >= focused.bottom).toBe(true);
  await page.keyboard.press('Escape');
  await expect(tip).toBeHidden();
  await page.context().close();
});

test('§5.1 badges: at most one solid pill; a folded group shows a dot only for ₪', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL!, { role: 'owner' });
  expect(await aside(page).locator('[data-nav-badge="block"]').count()).toBeLessThanOrEqual(1);
  const money = aside(page).locator('button[data-nav-group="money"]');
  if ((await money.getAttribute('aria-expanded')) === 'true') await money.click();
  const ils = (await aside(page).locator('[data-group="money"] [data-nav-badge="block"], [data-group="money"] [data-nav-badge="warn"]').count()) > 0;
  await expect(aside(page).locator('[data-group="money"] [data-group-dot]')).toHaveCount(ils ? 1 : 0);
  // Counts never bubble: a folded procurement group carries no dot.
  const procure = aside(page).locator('button[data-nav-group="procure"]');
  if ((await procure.getAttribute('aria-expanded')) === 'true') await procure.click();
  await expect(aside(page).locator('[data-group="procure"] [data-group-dot]')).toHaveCount(0);
  await page.context().close();
});

test('§1.4, §14.13–14 chef and receiver: a flat labelled rail, no ₪ anywhere in the shell or the palette, no ledger', async ({ browser, baseURL }) => {
  for (const role of ['chef', 'receiver'] as const) {
    const page = await open(browser, baseURL!, { role });
    expect(Math.round((await aside(page).boundingBox())!.width)).toBe(64);
    await expect(page.getByTestId('sidebar-toggle')).toHaveCount(0);
    await expect(aside(page).locator('[data-group]')).toHaveCount(0);
    const keys = await aside(page).locator('a[data-nav-key]').evaluateAll((els) => els.map((e) => e.getAttribute('data-nav-key')));
    expect(keys).toEqual(role === 'chef' ? ['home', 'orders', 'recipes', 'inventory'] : ['home', 'receiving']);
    await expect(page.locator('[href*="/suppliers/ledger"]')).toHaveCount(0);
    const shellText = await page.evaluate(() => {
      const parts: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>('[data-testid="sidebar"], [data-testid="top-bar"], [data-testid="bottom-bar"]')) {
        parts.push(el.textContent ?? '');
        for (const n of el.querySelectorAll('[aria-label],[title],[data-tip],[data-tip-text]'))
          parts.push(['aria-label', 'title', 'data-tip', 'data-tip-text'].map((a) => n.getAttribute(a) ?? '').join(' '));
      }
      return parts.join('\n');
    });
    expect(shellText).not.toContain('₪');
    await page.keyboard.press('Control+KeyK');
    const dialog = page.locator('dialog[open]');
    await expect(dialog).toBeVisible();
    for (const q of ['', 'אישור', 'דליפה', 'זיכוי', 'ספק', 'תנובה', '1', '24950', '104', '@', '#']) {
      await dialog.locator('input').fill(q);
      await page.waitForTimeout(300);
      expect(await dialog.innerText(), `${role} palette "${q}"`).not.toContain('₪');
    }
    await page.context().close();
  }
});

test('§14.16 popovers: Tab out of the switcher lands on Ctrl K with the menu closed; the account menu opens upward', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL!, { role: 'owner' });
  const switcher = page.getByTestId('branch-switcher');
  if (await switcher.count()) {
    await switcher.click();
    await expect(page.locator('[role="menu"][aria-label]').first()).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('sidebar-cmdk')).toBeFocused();
    await expect(switcher).toHaveAttribute('aria-expanded', 'false');
  }
  const account = page.getByTestId('avatar-menu');
  await account.click();
  const menu = page.getByTestId('account-menu');
  await expect(menu).toBeVisible();
  expect((await menu.boundingBox())!.y + (await menu.boundingBox())!.height).toBeLessThanOrEqual((await account.boundingBox())!.y + 1);
  await expect(menu.locator('[role="menuitemcheckbox"]')).toHaveCount(1);
  await expect(menu.locator('form[data-rm-logout]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(account).toBeFocused();
  await page.context().close();
});

test('§14.17 palette: Ctrl K and the field open it; the input row is 52 px; display commands and settings are there', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL!, { role: 'owner' });
  await page.getByTestId('sidebar-cmdk').click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog).toBeVisible();
  const input = dialog.locator('input');
  expect(Math.round((await input.boundingBox())!.height)).toBeGreaterThanOrEqual(52);
  await input.fill('כיווץ');
  await expect(dialog.getByRole('option', { name: /כיווץ התפריט/ })).toBeVisible();
  await input.fill('סיסמה');
  await expect(dialog.getByRole('option').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.keyboard.press('Control+KeyK');
  await expect(page.locator('dialog[open]')).toBeVisible();
  await page.keyboard.press('Control+KeyK');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await page.context().close();
});

test('favourites: the star puts a screen at the top of the menu (≤ 5), the copy never carries aria-current', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL!, { role: 'owner', path: '/dashboard/suppliers' });
  const star = page.getByTestId('favourite-star');
  await expect(star).toHaveAttribute('aria-pressed', 'false');
  await star.click();
  await expect(star).toHaveAttribute('aria-pressed', 'true');
  const fav = aside(page).locator('[data-group="favourites"]');
  await expect(fav.locator('a[data-nav-key="suppliers"]')).toHaveCount(1);
  await expect(fav.locator('a[aria-current]')).toHaveCount(0);
  await expect(page.getByTestId('nav-live')).toContainText('ספקים');
  await star.click();
  await expect(fav).toHaveCount(0);
  await page.context().close();
});

test('§1.5 top bar: 56 tall, crumbs with a chevron toward the page, the bell, no search box', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL!, { role: 'owner', path: '/dashboard/suppliers' });
  const bar = page.getByTestId('top-bar');
  expect(Math.round((await bar.boundingBox())!.height)).toBe(56);
  await expect(bar.locator('nav[aria-label="מיקום"]')).toHaveCount(1);
  await expect(bar.getByRole('combobox')).toHaveCount(0);
  await expect(bar.getByTestId('bell')).toHaveCount(1);
  await expect(bar.locator('nav[aria-label="מיקום"] [aria-current="page"]')).toHaveText('ספקים');
  await page.context().close();
});

test('§14.19 phone: no horizontal scroll for any role; the "עוד" sheet is a native modal dialog with a 44 × 44 close', async ({ browser, baseURL }) => {
  for (const role of ROLES) {
    const page = await open(browser, baseURL!, { role, width: 390, height: 844, phone: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), role).toBeLessThanOrEqual(0);
    await page.getByTestId('bottom-bar').locator('button[aria-controls="dashboard-drawer"]').click();
    const sheet = page.locator('dialog#dashboard-drawer');
    await expect(sheet).toBeVisible();
    expect(await sheet.evaluate((d) => (d as HTMLDialogElement).open && d.matches(':modal'))).toBe(true);
    const close = sheet.locator('[data-sheet-close]');
    const b = (await close.boundingBox())!;
    expect(b.width).toBeGreaterThanOrEqual(44);
    expect(b.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${role} sheet`).toBeLessThanOrEqual(0);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await page.context().close();
  }
});

test('§14.20 skip link: first Tab shows it; Enter moves focus to main', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL!);
  await page.keyboard.press('Tab');
  const skip = page.locator('[data-rm-skip-link]');
  await expect(skip).toBeFocused();
  expect((await skip.boundingBox())!.y).toBeGreaterThanOrEqual(0);
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('main-content');
  await page.context().close();
});

test('forced colours: the current row keeps a visible Highlight outline', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL!, { forcedColors: 'active', path: '/dashboard/approvals' });
  const outline = await aside(page)
    .locator('a[aria-current="page"]')
    .evaluate((el) => getComputedStyle(el).outlineStyle + ' ' + getComputedStyle(el).outlineWidth);
  expect(outline).toContain('solid');
  expect(outline).toContain('2px');
  await page.context().close();
});

test('§14.21 axe: no serious or critical violation in the panel, rail, flyout, overlay, menus and palette', async ({ browser, baseURL }) => {
  const panel = await open(browser, baseURL!, { role: 'owner', path: '/dashboard/approvals' });
  expect(await axeSerious(panel), 'panel').toEqual([]);
  await panel.getByTestId('avatar-menu').click();
  expect(await axeSerious(panel), 'account menu').toEqual([]);
  await panel.keyboard.press('Escape');
  await panel.getByTestId('sidebar-cmdk').click();
  expect(await axeSerious(panel), 'palette').toEqual([]);
  await panel.context().close();

  const rail = await open(browser, baseURL!, { role: 'owner', rail: true });
  expect(await axeSerious(rail), 'rail').toEqual([]);
  await aside(rail).locator('button[data-nav-group="money"]').click();
  expect(await axeSerious(rail), 'flyout').toEqual([]);
  await rail.context().close();

  const mid = await open(browser, baseURL!, { width: 1100, height: 700 });
  await mid.getByTestId('sidebar-toggle').click();
  expect(await axeSerious(mid), 'overlay').toEqual([]);
  await mid.context().close();

  for (const role of ['manager', 'bookkeeper', 'chef', 'receiver'] as const) {
    const page = await open(browser, baseURL!, { role });
    expect(await axeSerious(page), role).toEqual([]);
    await page.context().close();
  }
});
