// DS3 reference · the component kit: every card renders, the density switch drives the desk and the kit.
//   node kit-check.cjs [1440|390]
// Check the component kit's live parts and the density switch. usage: node tools/kit-check.cjs <width>
const { chromium } = require('playwright'); const fs = require('node:fs'); const path = require('node:path');
const W = Number(process.argv[2] || 1440);
const OUT = path.join(require('os').tmpdir(), 'ds3-reference-checks');
const page = fs.readFileSync(process.env.PAGE || path.join(__dirname, '..', 'reference.html'), 'utf8');
const html = `<!doctype html><html data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}</style></head><body>${page}</body></html>`;
(async () => {
  const b = await chromium.launch(require('./launch.cjs')());
  const p = await b.newPage({ viewport: { width: W, height: W < 600 ? 844 : 900 }, isMobile: W < 600, hasTouch: W < 600 });
  const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); }); p.on('pageerror', e => errs.push('PAGEERROR ' + String(e).slice(0, 300)));
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await p.setContent(html, { waitUntil: 'networkidle' }); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(300);
  const out = {};
  const txt = async s => (await p.locator(s).first().innerText()).replace(/\s+/g, ' ').trim();
  // palette
  out.cpEmpty = await p.locator('#cp-list .cp-o').count(); out.cpNote0 = await txt('#cp-note');
  await p.fill('#cp-q', 'ירק'); out.cpHe = await p.locator('#cp-list .cp-o').count(); out.cpHeFirst = await txt('#cp-list .cp-o');
  await p.fill('#cp-q', 'hre'); out.cpEn = await p.locator('#cp-list .cp-o').count(); out.cpNoteEn = await txt('#cp-note');
  await p.fill('#cp-q', '24108'); out.cpId = await p.locator('#cp-list .cp-o').count();
  await p.press('#cp-q', 'ArrowDown'); out.cpActive = await p.getAttribute('#cp-q', 'aria-activedescendant');
  await p.press('#cp-q', 'Enter'); out.cpOpen = await txt('#cp-note');
  await p.fill('#cp-q', 'zzzz'); out.cpNone = await txt('#cp-list');
  await p.press('#cp-q', 'Escape'); out.cpAfterEsc = await p.inputValue('#cp-q');
  await p.locator('#cp').screenshot({ path: path.join(OUT, `kit-cp-${W}.png`) });
  // toast specimen
  await p.click('[data-kit="toast"]'); out.kitToast = await p.locator('#kit-toast').isVisible();
  await p.click('[data-kit="toast-undo"]'); out.kitToastAfterUndo = await p.locator('#kit-toast').isVisible();
  // density
  const rowH = async () => p.evaluate(() => { const r = document.querySelector('#desk-rows .row'); const z = Number(document.querySelector('#ex2 .stage > div').style.zoom) || 1; return Math.round(r.getBoundingClientRect().height / z); });
  const tbH = async () => p.evaluate(() => Math.round(document.querySelector('.tb tbody tr').getBoundingClientRect().height));
  out.rowRegular = await rowH(); out.tbRegular = await tbH();
  await p.click('.kit-seg [data-density="compact"]');
  out.rowCompact = await rowH(); out.tbCompact = await tbH();
  out.pressedSync = await p.evaluate(() => [...document.querySelectorAll('[data-density="compact"]')].map(b => b.getAttribute('aria-pressed')).join(','));
  // how many compact rows fit at 1440x900
  out.fitCompact = await p.evaluate(() => {
    const z = Number(document.querySelector('#ex2 .stage > div').style.zoom) || 1; const h = e => e.getBoundingClientRect().height / z;
    const rows = [...document.querySelectorAll('#desk-rows .row')].map(h); const grp = h(document.querySelector('#desk-rows .grp'));
    const avail = 900 - h(document.querySelector('#ex2 .rm-top')) - h(document.querySelector('.desk-head')) - h(document.querySelector('.desk-keys')) - 14;
    const one = Math.min(...rows);
    return { avail: Math.round(avail), single: Math.round(one), grp: Math.round(grp), fit: Math.floor((avail - 2 * grp) / one) };
  });
  await p.locator('#ex2 .stage').screenshot({ path: path.join(OUT, `kit-desk-compact-${W}.png`) });
  await p.locator('.kit-dense').screenshot({ path: path.join(OUT, `kit-table-compact-${W}.png`) });
  await p.click('.kit-seg [data-density="regular"]');
  await p.locator('.kit-dense').screenshot({ path: path.join(OUT, `kit-table-regular-${W}.png`) });
  out.overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  out.srcShown = await p.locator('.kit-n .src').count();
  out.errs = errs;
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})().catch(e => { console.error('FAILED', e.message.slice(0, 700)); process.exit(1); });
