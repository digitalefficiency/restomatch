// DS2 β gate probe: font bytes, ₪ platform fonts (CDP), CLS, clipped ₪. Run from apps/web.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const env = {};
for (const line of fs.readFileSync(path.join(__dirname, 'env'), 'utf8').split('\n')) {
  const m = /^export (\w+)='(.*)'$/.exec(line);
  if (m) env[m[1]] = m[2];
}
const need = (m) => require(require.resolve(m, { paths: [process.cwd()] }));
const BASE = env.LAB_URL;
const ROUTES = (process.env.ROUTES || '/dashboard,/dashboard/approvals,/dashboard/leaks,/dashboard/leaks/breakdown,/dashboard/leaks/claims,/dashboard/recovery,/dashboard/inbox,/dashboard/suppliers/ledger,/dashboard/reports,/dashboard/orders').split(',');
const WIDTHS = (process.env.WIDTHS || '1440,1280,390').split(',').map(Number);
const LOCALES = (process.env.LOCALES || 'he,en').split(',');
const role = process.env.ROLE || 'owner';
(async () => {
  const { chromium } = need('@playwright/test');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const auth = path.join(__dirname, `auth-${role}.json`);
  const results = [];
  for (const locale of LOCALES) for (const vw of WIDTHS) for (const route of ROUTES) {
    const phone = vw < 600;
    const ctx = await browser.newContext({ viewport: { width: vw, height: phone ? 844 : 900 }, isMobile: phone, hasTouch: phone, locale: locale === 'en' ? 'en-US' : 'he-IL', storageState: fs.existsSync(auth) ? auth : undefined });
    await ctx.addCookies([{ name: 'rm_cookie_consent', value: 'necessary', url: BASE }, { name: 'rm_locale', value: locale, url: BASE }]);
    await ctx.addInitScript(() => {
      window.__cls = 0;
      new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
    });
    const page = await ctx.newPage();
    const fonts = new Map();
    page.on('response', async (r) => {
      if (r.url().endsWith('.woff2')) { try { fonts.set(new URL(r.url()).pathname, (await r.body()).length); } catch {} }
    });
    await page.goto(BASE + route, { waitUntil: 'load' });
    if (new URL(page.url()).pathname.startsWith('/login')) {
      const form = page.locator('form', { has: page.locator('input[name="password"]') });
      await form.locator('input[name="email"]').fill(`${role}@kfar-hazeitim.test`);
      await form.locator('input[name="password"]').fill(env.LAB_PASSWORD);
      await form.locator('button[type="submit"]').click();
      await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
      await ctx.storageState({ path: auth });
      fonts.clear();
      await page.goto(BASE + route, { waitUntil: 'load' });
    }
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.evaluate(() => document.fonts.ready);
    const probe = await page.evaluate(() => {
      const els = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.nodeValue.includes('₪')) continue;
        const el = n.parentElement;
        if (!el || el.closest('.sr-only,[aria-hidden="true"]')) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const cs = getComputedStyle(el);
        el.setAttribute('data-fc', String(els.length));
        // Truncated: the money text itself is cut (ellipsis or hidden overflow on it or a
        // non-scrolling ancestor). Off-screen inside a horizontal scroller is NOT truncation.
        let clipped = el.scrollWidth > el.clientWidth + 1 && (cs.overflowX === 'hidden' || cs.overflowX === 'clip' || cs.textOverflow === 'ellipsis');
        let scroller = false;
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          const ac = getComputedStyle(a);
          if (/(auto|scroll)/.test(ac.overflowX)) { scroller = true; break; }
          if (/(hidden|clip)/.test(ac.overflowX)) { const ar = a.getBoundingClientRect(); if (r.right > ar.right + 1 || r.left < ar.left - 1) clipped = true; }
        }
        if (!scroller && (r.right > innerWidth + 1 || r.left < -1)) clipped = true;
        els.push({ text: n.nodeValue.trim().slice(0, 30), clipped });
      }
      return { els, cls: window.__cls };
    });
    const cdp = await ctx.newCDPSession(page);
    const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
    const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '[data-fc]' });
    const foreign = new Map();
    for (const id of nodeIds) {
      const { fonts: pf } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId: id }).catch(async () => { await cdp.send('CSS.enable'); return cdp.send('CSS.getPlatformFontsForNode', { nodeId: id }); });
      for (const f of pf) if (!/IBM Plex Sans Hebrew/.test(f.familyName)) foreign.set(f.familyName, (foreign.get(f.familyName) || 0) + f.glyphCount);
    }
    const bytes = [...fonts.values()].reduce((a, b) => a + b, 0);
    results.push({ route, locale, vw, money: probe.els.length, clipped: probe.els.filter((e) => e.clipped).map((e) => e.text), foreign: Object.fromEntries(foreign), cls: +probe.cls.toFixed(4), fontKB: +(bytes / 1024).toFixed(1), files: [...fonts.keys()].map((p) => p.split('/').pop()) });
    console.log(JSON.stringify(results.at(-1)));
    await ctx.close();
  }
  await browser.close();
})();
