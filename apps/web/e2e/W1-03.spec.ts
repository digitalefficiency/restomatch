import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { e2eSql, ensurePasswordUser } from './helpers';

/**
 * W1-03 · nav registry + app shell v2 (docs/ux/IMPLEMENTATION-PLAN.md §W1-03).
 * Every role of the seeded demo tenant ("כפר הזיתים", all flags on), phone 390
 * and desktop 1440, Hebrew and English: role bottom bars, the sidebar, titles,
 * route announcements, focus, the "עוד" sheet, field focus mode, help links,
 * the language picker and the admin landmarks.
 */

type Role = 'owner' | 'manager' | 'bookkeeper' | 'chef' | 'receiver';
const ROLES: Role[] = ['owner', 'manager', 'bookkeeper', 'chef', 'receiver'];
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const DESK = { viewport: { width: 1440, height: 900 } };
const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

/** The plan's per-role bars (slot 1 → 4, then "עוד"). */
const BARS: Record<Role, { he: string[]; en: string[] }> = {
  // Owner decision (2026-10-25): no supplier ledger or ₪ screens for the receiver.
  receiver: { he: ['היום', 'קבלות', 'עוד'], en: ['Today', 'Receipts', 'More'] },
  chef: { he: ['היום', 'ספירה', 'מנות', 'עוד'], en: ['Today', 'Count', 'Dishes', 'More'] },
  manager: { he: ['היום', 'הזמנות', 'קבלה', 'אישורים', 'עוד'], en: ['Today', 'Orders', 'Receive', 'Approvals', 'More'] },
  owner: { he: ['בית', 'אישורים', 'מחירים', 'הזמנות', 'עוד'], en: ['Home', 'Approvals', 'Prices', 'Orders', 'More'] },
  bookkeeper: { he: ['בית', 'אישורים', 'תשלומים', 'חשבוניות', 'עוד'], en: ['Home', 'Approvals', 'Payments', 'Invoices', 'More'] },
};

type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;
const states = new Map<Role, StorageState>();

/** The seeded demo password (packages/db/scripts/seed.ts DEFAULT_DEMO_PASSWORD). */
const PASSWORD = process.env.DEMO_PASSWORD ?? 'RestoMatch-Demo-2026!';

/** One password sign-in per role, reused by every test in this file (works on dev and production builds). */
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

async function open(
  browser: Browser,
  baseURL: string,
  role: Role,
  locale: string,
  device: typeof PHONE | typeof DESK,
  path = '/dashboard',
): Promise<Page> {
  const ctx = await browser.newContext({ ...device, baseURL, storageState: await stateFor(browser, baseURL, role) });
  await ctx.addCookies([
    { name: 'rm_locale', value: locale, url: baseURL },
    { name: 'rm_cookie_consent', value: 'necessary', url: baseURL },
  ]);
  const page = await ctx.newPage();
  await page.goto(path);
  await settle(page);
  return page;
}

/** `next dev`'s badge floats over the bottom-start corner; it is not part of the product. */
async function settle(page: Page) {
  // Bounded: sidebar link prefetches can keep the network busy for a while.
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
}

async function axeSerious(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(async () => {
    const w = window as unknown as {
      axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; impact: string; nodes: { target: string[] }[] }[] }> };
    };
    const res = await w.axe.run(
      // The lab worker banner is excluded by the DoD (it reflects the lab, not the shell).
      { exclude: [['nextjs-portal'], ['#main-content [role=status]']] },
      { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } },
    );
    return res.violations
      .filter((v) => v.impact === 'critical' || v.impact === 'serious')
      .flatMap((v) => v.nodes.map((n) => `${v.id} @ ${n.target.join(' ')}`));
  });
}

test.describe.configure({ mode: 'serial' });

for (const role of ROLES) {
  for (const locale of ['he', 'en'] as const) {
    test(`${role} · ${locale} · phone: SSR role bar, geometry, axe`, async ({ browser, baseURL }) => {
      const page = await open(browser, baseURL!, role, locale, PHONE);
      // Server-rendered: the bar is in the HTML, not portalled in after hydration (perf-states-06).
      const html = await (await page.request.get('/dashboard')).text();
      expect(html).toContain('data-testid="bottom-bar"');

      const bar = page.getByTestId('bottom-bar');
      await expect(bar).toBeVisible();
      expect(await bar.locator('li').allInnerTexts()).toEqual(BARS[role][locale]);
      const box = (await bar.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(64);
      // Home is active, with aria-current and a 56×32 pill.
      const active = bar.locator('a[aria-current="page"]');
      await expect(active).toHaveCount(1);
      await expect(active).toHaveAttribute('href', '/dashboard');
      const pill = (await active.locator('span').first().boundingBox())!;
      expect(Math.round(pill.width)).toBe(56);
      expect(Math.round(pill.height)).toBe(32);
      // 12 px labels, never truncated.
      const labels = await bar.locator('li span:last-child').evaluateAll((els) =>
        els.map((el) => ({ fs: getComputedStyle(el).fontSize, cut: el.scrollWidth > el.clientWidth + 1 })),
      );
      for (const l of labels) expect(l).toEqual({ fs: '12px', cut: false });

      // Header: 56 px, no ☰, no e-mail in the visible chrome.
      const header = (await page.locator('header').first().boundingBox())!;
      expect(header.height).toBeLessThanOrEqual(56);
      await expect(page.getByRole('button', { name: /^(open menu|פתיחת תפריט)$/i })).toHaveCount(0);
      await expect(page.getByText(`${role}@kfar-hazeitim.test`, { exact: true })).toBeHidden();
      // The bar never covers content: main reserves its height.
      const pad = await page.locator('main').evaluate((m) => parseFloat(getComputedStyle(m).paddingBottom));
      expect(pad).toBeGreaterThanOrEqual(64);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(await axeSerious(page)).toEqual([]);
      await page.context().close();
    });

    test(`${role} · ${locale} · desktop: sidebar, top bar, title, axe`, async ({ browser, baseURL }) => {
      const page = await open(browser, baseURL!, role, locale, DESK);
      const sidebar = page.getByTestId('sidebar');
      await expect(sidebar).toBeVisible();
      expect(Math.round((await sidebar.boundingBox())!.width)).toBe(248);
      await expect(page.getByTestId('bottom-bar')).toBeHidden();
      // Content starts high: a 56 px top bar, no wrapped tab rows.
      const top = await page.locator('#main-content > div').evaluate((el) => el.getBoundingClientRect().top);
      expect(top).toBeLessThanOrEqual(180);
      // Inline-start: right in Hebrew, left in English.
      const x = (await sidebar.boundingBox())!.x;
      if (locale === 'he') expect(x).toBeGreaterThan(1000);
      else expect(x).toBe(0);
      await expect(sidebar.locator('a[aria-current="page"]')).toHaveAttribute('href', '/dashboard');
      await expect(page).toHaveTitle(/ — RestoMatch$/);
      expect(await axeSerious(page)).toEqual([]);
      await page.context().close();
    });
  }
}

test('bookkeeper: pay run, ledger, integrations and claims are in the sidebar; no dead-end crumb', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL!, 'bookkeeper', 'he', DESK);
  const sidebar = page.getByTestId('sidebar');
  for (const href of ['/dashboard/approvals/pay-run', '/dashboard/suppliers/ledger', '/dashboard/integrations', '/dashboard/leaks/claims']) {
    await expect(sidebar.locator(`a[href="${href}"]`), href).toHaveCount(1);
  }
  // No link to a page the bookkeeper can't open.
  for (const href of ['/dashboard/suppliers', '/dashboard/orders', '/dashboard/team']) {
    await expect(page.locator(`a[href="${href}"]`), href).toHaveCount(0);
  }
  await sidebar.locator('a[href="/dashboard/suppliers/ledger"]').click();
  await page.waitForURL('**/dashboard/suppliers/ledger');
  // The page's own "ספקים" crumb is plain text for this role (SUP-01).
  await expect(page.locator('#main-content nav a[href="/dashboard/suppliers"]')).toHaveCount(0);
  await page.context().close();
});

test('client navigation: title changes, the route is announced, focus moves to the h1', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL!, 'owner', 'he', DESK);
  // The branch shows only with ≥2 memberships (the lab reseed has two, the e2e seed one).
  await expect(page).toHaveTitle(/^בית( · .+)? — RestoMatch$/);
  await page.getByTestId('sidebar').locator('a[href="/dashboard/approvals"]').click();
  await page.waitForURL('**/dashboard/approvals');
  await expect(page).toHaveTitle(/^אישורים( · .+)? — RestoMatch$/);
  await expect
    .poll(() => page.evaluate(() => document.querySelector('next-route-announcer')?.shadowRoot?.textContent ?? ''))
    .toContain('אישורים');
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('H1');
  await page.context().close();
});

test('rail: Ctrl+B (by key code) collapses to 64 px and the choice survives a reload', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL!, 'manager', 'he', DESK);
  await page.keyboard.press('Control+KeyB');
  await expect.poll(async () => Math.round((await page.getByTestId('sidebar').boundingBox())!.width)).toBe(64);
  await page.reload();
  await settle(page);
  expect(Math.round((await page.getByTestId('sidebar').boundingBox())!.width)).toBe(64);
  await page.keyboard.press('Control+KeyB');
  await expect.poll(async () => Math.round((await page.getByTestId('sidebar').boundingBox())!.width)).toBe(248);
  await page.context().close();
});

test('"עוד" sheet: modal (0 of 45 Tab stops escape), Esc returns focus to the opener', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL!, 'owner', 'he', PHONE);
  const more = page.getByTestId('bottom-bar').locator('button[aria-controls="dashboard-drawer"]');
  await more.click();
  const sheet = page.locator('#dashboard-drawer');
  await expect(sheet).toBeVisible();
  let escaped = 0;
  for (let i = 0; i < 45; i++) {
    await page.keyboard.press('Tab');
    if (!(await page.evaluate(() => !!document.activeElement?.closest('#dashboard-drawer')))) escaped += 1;
  }
  expect(escaped).toBe(0);
  // Help, accessibility statement and contact sit in the sheet; the branch list too with ≥2 memberships.
  await expect(sheet.getByTestId('support-links-sheet').locator('a')).toHaveCount(3);
  const multiBranch = (await page.getByTestId('branch-switcher').count()) > 0;
  await expect(sheet.getByTestId('branch-switcher-list')).toHaveCount(multiBranch ? 1 : 0);
  expect(await axeSerious(page)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(more).toBeFocused();
  await page.context().close();
});

test('field routes: no bottom bar, and the shell publishes --rm-bottomnav-h = 0', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL!, 'manager', 'he', PHONE, '/dashboard/orders/new');
  await expect(page.getByTestId('bottom-bar')).toBeHidden();
  expect((await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--rm-bottomnav-h'))).trim()).toBe('0px');
  await page.goto('/dashboard/orders');
  await settle(page);
  await expect(page.getByTestId('bottom-bar')).toBeVisible();
  await page.context().close();
});

test('help · accessibility · contact: same place in the sidebar footer on every route', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL!, 'owner', 'he', DESK);
  let first: { x: number; y: number } | null = null;
  for (const path of ['/dashboard', '/dashboard/approvals', '/dashboard/orders']) {
    await page.goto(path);
    await settle(page);
    const links = page.getByTestId('support-links-sidebar').locator('a');
    await expect(links).toHaveCount(3);
    const b = (await links.first().boundingBox())!;
    if (!first) first = { x: b.x, y: b.y };
    else expect({ x: b.x, y: b.y }).toEqual(first);
  }
  await page.context().close();
});

test('bar labels never truncate at 360 px in he / en / ar / ru', async ({ browser, baseURL }) => {
  for (const role of ['owner', 'manager', 'bookkeeper'] as const) {
    for (const locale of ['he', 'en', 'ar', 'ru']) {
      const page = await open(browser, baseURL!, role, locale, { ...PHONE, viewport: { width: 360, height: 780 } });
      const cut = await page
        .getByTestId('bottom-bar')
        .locator('li span:last-child')
        .evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent));
      expect(cut, `${role} ${locale}`).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${role} ${locale} overflow`).toBe(true);
      await page.context().close();
    }
  }
});

test('search "מסכים": screens by role, from the first characters', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL!, 'bookkeeper', 'he', DESK);
  const input = page.locator('header').getByRole('combobox', { name: 'חיפוש כללי' });
  await input.fill('כרט');
  await expect(page.locator('#dashboard-search-header-list [role=option]').first()).toHaveText('כרטסת ספקים');
  await input.fill('הזמנ');
  // The bookkeeper can't open orders: no screen offered.
  await expect(page.locator('#dashboard-search-header-list [role=group][aria-label="מסכים"]')).toHaveCount(0);
  await page.context().close();
});

test('account menu: sign-out keeps the data-rm-logout form contract', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL!, 'chef', 'he', DESK);
  await page.getByTestId('avatar-menu').click();
  const form = page.locator('#rm-account-panel form[data-rm-logout]');
  await expect(form).toBeVisible();
  await expect(page.locator('#rm-account-panel')).toContainText('chef@kfar-hazeitim.test');
  await page.keyboard.press('Escape');
  await expect(page.locator('#rm-account-panel')).toBeHidden();
  await page.context().close();
});

test('language picker: a button + menu; arrow keys never switch the language', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL!, 'owner', 'he', DESK);
  const picker = page.locator('header [data-testid="language-picker"]');
  await expect(picker).toHaveAttribute('aria-haspopup', 'menu');
  await picker.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('he');
  await page.keyboard.press('Escape');
  await expect(picker).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('he');
  await page.context().close();
});

test('admin layout: skip link, banner, labelled nav, main', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL!, 'owner', 'he', DESK, '/admin');
  await expect(page.locator('a[href="#main-content"]').first()).toBeAttached();
  await expect(page.locator('header nav[aria-label]')).toHaveCount(1);
  await expect(page.locator('main#main-content')).toHaveCount(1);
  await expect(page.locator('main header')).toHaveCount(0);
  await page.context().close();
});

test('receiver: no supplier ledger in the nav, and the URL is refused (owner decision 2026-10-25)', async ({ browser, baseURL }) => {
  for (const device of [PHONE, DESK]) {
    const page = await open(browser, baseURL!, 'receiver', 'he', device);
    await expect(page.locator('header a[href="/dashboard/suppliers/ledger"]')).toHaveCount(0);
    if (device === PHONE) {
      await page.getByTestId('bottom-bar').locator('button[aria-controls="dashboard-drawer"]').click();
      await expect(page.locator('#dashboard-drawer a[href="/dashboard/suppliers/ledger"]')).toHaveCount(0);
    }
    // The route gate refuses it: a bounce home (or the in-shell 403 page once W1-04 lands).
    const res = await page.goto('/dashboard/suppliers/ledger');
    expect(/\/dashboard$/.test(page.url()) || res?.status() === 403).toBe(true);
    await page.context().close();
  }
});

test('a member with no restaurant is sent to /onboarding, not to an error page', async ({ browser, baseURL }) => {
  const email = 'e2e-w103-no-membership@restomatch.test';
  const password = 'W1-03-e2e-password-2026!';
  await ensurePasswordUser({ email, password });
  const sql = e2eSql();
  try {
    // A removed member: the account exists, the membership is gone.
    await sql`delete from memberships where user_id = (select id from users where email = ${email})`;
  } finally {
    await sql.end();
  }
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'rm_cookie_consent', value: 'necessary', url: baseURL! }]);
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.locator('form:has(#password) [name=email]').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('form:has(#password) button[type=submit]').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/onboarding/);
  await ctx.close();
});

test('"עוד" sheet: navigating from it lands focus on the new page h1, not on "עוד"', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL!, 'owner', 'he', PHONE);
  await page.getByTestId('bottom-bar').locator('button[aria-controls="dashboard-drawer"]').click();
  await page.locator('#dashboard-drawer a[href="/dashboard/suppliers"]').click();
  await page.waitForURL('**/dashboard/suppliers');
  await expect(page.locator('#dashboard-drawer')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-controls'))).not.toBe('dashboard-drawer');
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.tagName))
    .toMatch(/^(H1|MAIN)$/);
  await page.context().close();
});

test('"עוד" sheet: Esc in its language menu closes only the menu', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL!, 'owner', 'he', PHONE);
  await page.getByTestId('bottom-bar').locator('button[aria-controls="dashboard-drawer"]').click();
  const sheet = page.locator('#dashboard-drawer');
  const picker = sheet.locator('[data-testid="language-picker"]');
  // The demo tenant has receiver languages on: the six-language picker (a menu).
  if ((await picker.count()) === 0) test.skip(true, 'receiver languages off: the עב/EN toggle has no menu');
  await picker.click();
  await expect(sheet.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet.getByRole('menu')).toBeHidden();
  await expect(sheet).toBeVisible();
  await page.context().close();
});

test('"עוד" sheet: rotating past 1024 px closes it and the app is usable (not inert)', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL!, 'manager', 'he', { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true });
  await page.getByTestId('bottom-bar').locator('button[aria-controls="dashboard-drawer"]').click();
  await expect(page.locator('#dashboard-drawer')).toBeVisible();
  await page.setViewportSize({ width: 1180, height: 820 });
  await expect(page.locator('#dashboard-drawer')).toHaveCount(0);
  await expect(page.locator('#rm-app')).not.toHaveAttribute('inert', '');
  await page.context().close();
});

test("sidebar: the current page's group can still be collapsed", async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL!, 'owner', 'he', DESK, '/dashboard/orders');
  const toggle = page.getByTestId('sidebar').locator('button[aria-controls="rm-nav-group-procure"]');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#rm-nav-group-procure a[href="/dashboard/orders"]')).toBeHidden();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.context().close();
});

test('field route: the task footer sits at the bottom edge once the bar is hidden', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL!, 'chef', 'he', PHONE, '/dashboard/inventory/count');
  await expect(page.getByTestId('bottom-bar')).toBeHidden();
  // The count screen's fixed footer (if a count is open) ends at the viewport bottom, not 72 px above it.
  const footer = page.locator('#main-content div.fixed.inset-x-0').first();
  if ((await footer.count()) > 0 && (await footer.isVisible())) {
    const b = (await footer.boundingBox())!;
    expect(Math.round(b.y + b.height)).toBeGreaterThanOrEqual(844 - 1);
  }
  await page.context().close();
});
