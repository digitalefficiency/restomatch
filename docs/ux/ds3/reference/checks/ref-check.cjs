// DS3 reference · sanity check: no script errors, every mock-up rendered, one screenshot per mock-up.
//   node ref-check.cjs <absolute path to reference.html> [width=1440] [out dir]
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const FILE = process.argv[2], W = Number(process.argv[3] || 1440), OUT = process.argv[4];
(async () => {
  const b = await chromium.launch(require('./launch.cjs')());
  const p = await b.newPage({ viewport: { width: W, height: 900 }, deviceScaleFactor: 1 });
  const errs = []; p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await p.goto('file://' + FILE); await p.waitForTimeout(1500);
  const r = await p.evaluate(() => {
    const q = (s) => document.querySelectorAll(s).length;
    const fam = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).fontFamily.split(',')[0] : null; };
    return {
      mocks: q('.rm[data-mock]'), finishAttr: q('[data-finish]'),
      menuLinks: [...document.querySelectorAll('aside.mn')].map(a => a.querySelectorAll('a,button').length),
      deskRows: q('#ex2 [data-i]') || q('#ex2 tr') , phoneRows: q('#ph-live [data-p]'), setSects: q('#sh-sects button, #sh-sects a'), kitCards: q('.kit-c'),
      heroText: (document.querySelector('.hero-num') || {}).innerText, font: fam('.rm'), fontsReady: document.fonts.status,
      loaded: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family + ' ' + f.weight).slice(0, 8),
      canvas: getComputedStyle(document.querySelector('.rm')).getPropertyValue('--canvas').trim(), brand: getComputedStyle(document.querySelector('.rm')).getPropertyValue('--brand').trim(),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      stageScale: [...document.querySelectorAll('.stage > div')].map(d => d.style.transform || 'none'),
    };
  });
  console.log(JSON.stringify(r)); console.log('errors:', errs.length, errs.slice(0, 5));
  if (OUT) { fs.mkdirSync(OUT, { recursive: true }); for (const id of ['ex1', 'ex2', 'ex3', 'ex4', 'kit']) { const el = await p.$('#' + id); if (el) await el.screenshot({ path: path.join(OUT, `ref-${id}-${W}.png`) }); } }
  await b.close();
})();
