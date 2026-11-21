// VR-2 before/after shots for owner sign-off: OUT=<dir> node vr2.cjs
'use strict';
const fs = require('node:fs'), path = require('node:path');
const env = {}; for (const l of fs.readFileSync(path.join(__dirname, 'env'), 'utf8').split('\n')) { const m = /^export (\w+)='(.*)'$/.exec(l); if (m) env[m[1]] = m[2]; }
const { chromium } = require(require.resolve('@playwright/test', { paths: [process.cwd()] }));
const OUT = process.env.OUT; fs.mkdirSync(OUT, { recursive: true });
const SHOTS = [['owner', '/dashboard', 1440], ['owner', '/dashboard', 390], ['owner', '/dashboard/approvals', 1440], ['owner', '/dashboard/recovery', 1440], ['owner', '/dashboard/leaks/breakdown', 1440], ['bookkeeper', '/dashboard/suppliers/ledger', 1440]];
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  for (const [role, route, vw] of SHOTS) {
    const auth = path.join(__dirname, `auth-${role}.json`);
    const ctx = await b.newContext({ viewport: { width: vw, height: vw < 600 ? 844 : 900 }, deviceScaleFactor: 2, isMobile: vw < 600, locale: 'he-IL', storageState: fs.existsSync(auth) ? auth : undefined });
    await ctx.addCookies([{ name: 'rm_cookie_consent', value: 'necessary', url: env.LAB_URL }, { name: 'rm_locale', value: 'he', url: env.LAB_URL }]);
    const p = await ctx.newPage();
    await p.goto(env.LAB_URL + route);
    if (new URL(p.url()).pathname.startsWith('/login')) {
      const form = p.locator('form', { has: p.locator('input[name="password"]') });
      await form.locator('input[name="email"]').fill(`${role}@kfar-hazeitim.test`);
      await form.locator('input[name="password"]').fill(env.LAB_PASSWORD);
      await form.locator('button[type="submit"]').click();
      await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
      await ctx.storageState({ path: auth });
      await p.goto(env.LAB_URL + route);
    }
    await p.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: path.join(OUT, `${route.replace(/[^a-z0-9]+/gi, '_')}__${role}__${vw}.png`) });
    await ctx.close();
  }
  await b.close();
})();
