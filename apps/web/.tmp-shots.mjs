// node shots.mjs <state> <outDir> <prefix> path1 path2 ...   (env: LOCALES=he,en MOBILE=1)
import { chromium } from 'playwright';
const [state, outDir, prefix, ...paths] = process.argv.slice(2);
const locales = (process.env.LOCALES ?? 'he,en').split(',');
const mobile = process.env.MOBILE === '1';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const loc of locales) {
  const ctx = await browser.newContext({
    storageState: state,
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  await ctx.addCookies([{ name: 'rm_locale', value: loc, url: 'http://localhost:3000' }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  for (const p of paths) {
    const name = p.replace(/^\/dashboard\/?/, '').replace(/[/?=&]+/g, '-') || 'overview';
    try {
      await page.goto('http://localhost:3000' + p, { waitUntil: 'networkidle', timeout: 120000 });
    } catch (e) { console.log('nav fail', p, String(e).slice(0, 100)); }
    await page.waitForTimeout(500);
    const file = `${outDir}/${prefix}${name}-${loc}${mobile ? '-mobile' : ''}.png`;
    await page.screenshot({ path: file, fullPage: !mobile });
    console.log(file, errors.length ? 'ERR: ' + errors.join(' | ').slice(0, 400) : '');
    errors.length = 0;
  }
  await ctx.close();
}
await browser.close();
