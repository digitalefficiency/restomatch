// LCP of the owner home on a throttled mid-range Android profile (4x CPU, Fast 3G-ish), median of N.
'use strict';
const fs = require('node:fs'), path = require('node:path');
const env = {}; for (const l of fs.readFileSync(path.join(__dirname, 'env'), 'utf8').split('\n')) { const m = /^export (\w+)='(.*)'$/.exec(l); if (m) env[m[1]] = m[2]; }
const { chromium, devices } = require(require.resolve('@playwright/test', { paths: [process.cwd()] }));
const N = Number(process.env.N || 7);
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const out = [];
  for (let i = 0; i < N; i++) {
    const ctx = await b.newContext({ ...devices['Pixel 7'], locale: 'he-IL', storageState: path.join(__dirname, 'auth-owner.json') });
    await ctx.addCookies([{ name: 'rm_cookie_consent', value: 'necessary', url: env.LAB_URL }, { name: 'rm_locale', value: 'he', url: env.LAB_URL }]);
    const p = await ctx.newPage();
    const cdp = await ctx.newCDPSession(p);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    await p.addInitScript(() => { window.__lcp = 0; window.__lcpNode = ''; window.__cls = 0;
      new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__lcp = e.startTime; window.__lcpNode = (e.element && (e.element.textContent || '').trim().slice(0, 24)) || e.url; } }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); });
    await p.goto(env.LAB_URL + '/dashboard', { waitUntil: 'load' });
    await p.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(1000);
    out.push(await p.evaluate(() => ({ lcp: Math.round(window.__lcp), node: window.__lcpNode, cls: +window.__cls.toFixed(4) })));
    await ctx.close();
  }
  const s = out.map((o) => o.lcp).sort((a, b) => a - b);
  console.log(JSON.stringify({ median: s[Math.floor(s.length / 2)], runs: out }));
  await b.close();
})();
