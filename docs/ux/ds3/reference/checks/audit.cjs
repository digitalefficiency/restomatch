// DS3 reference · contrast (5:1 held), text floors and target sizes, walked through the states of every mock-up.
//   node audit.cjs [1440|390]
// Contrast, text-size floors and target sizes of everything drawn inside the mock-ups, in each finish and at two widths.
// usage: node tools/audit.cjs <width> <lux|clean|lux-ink> [light|dark]
const { chromium } = require('playwright'); const fs = require('node:fs'); const path = require('node:path');
const W = Number(process.argv[2] || 1440), FIN = process.argv[3] || 'clean', THEME = process.argv[4] || 'light';
const page = fs.readFileSync(process.env.PAGE || path.join(__dirname, '..', 'reference.html'), 'utf8');
const html = `<!doctype html><html data-theme="${THEME}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}[hidden]{display:none!important}</style></head><body>${page}</body></html>`;
const INPAGE = () => {
  const parse = s => { const m = String(s).match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,\/]\s*([\d.]+%?))?\s*\)/); if (!m) return null; const a = m[4] === undefined ? 1 : (String(m[4]).endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])); return { r: +m[1], g: +m[2], b: +m[3], a }; };
  const all = s => (String(s).match(/rgba?\([^)]*\)/g) || []).map(parse).filter(Boolean);
  const over = (t, b) => ({ r: t.r * t.a + b.r * (1 - t.a), g: t.g * t.a + b.g * (1 - t.a), b: t.b * t.a + b.b * (1 - t.a), a: 1 });
  const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = c => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const hex = c => '#' + [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
  // every colour the background behind an element can have (a gradient gives several), composited down to the page
  const bgs = el => {
    if (!el || el === document.documentElement) return [{ r: 255, g: 255, b: 255, a: 1 }];
    const cs = getComputedStyle(el); const under = bgs(el.parentElement);
    let layers = [];
    if (cs.backgroundImage && cs.backgroundImage.includes('gradient')) layers = all(cs.backgroundImage);
    const bc = parse(cs.backgroundColor);
    if (!layers.length && bc && bc.a > 0) layers = [bc];
    if (!layers.length) return under;
    const out = []; for (const l of layers) for (const u of under) out.push(over(l, u));
    return out;
  };
  const sig = el => { const p = []; let e = el; for (let i = 0; e && i < 3 && !e.classList.contains('rm'); i++, e = e.parentElement) p.unshift(e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : '')); return p.join(' > '); };
  window.__scan = (label) => {
    const res = { label, lowContrast: [], smallText: [], smallTargets: [], n: 0 };
    for (const root of document.querySelectorAll('.rm')) {
      if (!root.checkVisibility()) continue;
      const field = root.classList.contains('phone'); const narrow = root.classList.contains('is-narrow');
      const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let nd = tw.nextNode(); nd; nd = tw.nextNode()) {
        if (!nd.nodeValue.trim()) continue;
        const el = nd.parentElement; if (!el || el.closest('.sr, [hidden]')) continue;
        if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
        const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue;
        const cs = getComputedStyle(el); const fs = parseFloat(cs.fontSize); const fw = parseInt(cs.fontWeight, 10) || 400;
        const dis = !!el.closest('[disabled], [aria-disabled="true"]');
        let op = 1; for (let e = el; e && e !== document.documentElement; e = e.parentElement) op *= parseFloat(getComputedStyle(e).opacity);
        const col = parse(cs.color); if (!col) continue; col.a *= op;
        const back = bgs(el); let worst = Infinity, wb = null;
        for (const bg of back) { const rr = ratio(over(col, bg), bg); if (rr < worst) { worst = rr; wb = bg; } }
        res.n++;
        if (!dis && fs < 24 && (!res.min || worst < res.min.ratio)) res.min = { ratio: Math.round(worst * 100) / 100, fg: hex(over(col, wb)), bg: hex(wb), text: nd.nodeValue.trim().slice(0, 20), where: sig(el) };
        const need = (fs >= 24 || (fs >= 18.66 && fw >= 700)) ? 3 : 4.5;
        if (!dis && worst < need) res.lowContrast.push({ ratio: Math.round(worst * 100) / 100, need, text: nd.nodeValue.trim().slice(0, 24), fg: hex(over(col, wb)), bg: hex(wb), fs, where: sig(el) });
        const floor = field ? 14 : 12;
        if (fs < floor - 0.01) res.smallText.push({ fs, floor, text: nd.nodeValue.trim().slice(0, 24), where: sig(el) });
      }
      for (const t of root.querySelectorAll('a[href], button, [role="option"]')) {
        if (!t.checkVisibility() || t.closest('[inert]') || t.disabled) continue;
        const r = t.getBoundingClientRect(); if (r.width < 1) continue;
        const floor = field ? 48 : narrow ? 44 : 24;
        const inline = getComputedStyle(t).display === 'inline' && t.parentElement && t.parentElement.textContent.trim().length > t.textContent.trim().length + 4;
        if (!inline && (r.height < floor - 0.5 || r.width < Math.min(floor, 44) - 0.5)) res.smallTargets.push({ w: Math.round(r.width), h: Math.round(r.height), floor, text: (t.getAttribute('aria-label') || t.textContent).trim().slice(0, 22), where: sig(t) });
      }
    }
    return res;
  };
};
(async () => {
  const b = await chromium.launch(require('./launch.cjs')());
  const p = await b.newPage({ viewport: { width: W, height: W < 600 ? 844 : 900 }, isMobile: W < 600, hasTouch: W < 600 });
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await p.setContent(html, { waitUntil: 'networkidle' }); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(400);
  if (FIN !== 'lux' && await p.$(`button[data-finish="${FIN}"]`)) await p.click(`button[data-finish="${FIN}"]`);   // the reference page has one finish and no switch
  await p.evaluate(INPAGE); await p.waitForTimeout(200);
  const out = []; const scan = async l => out.push(await p.evaluate(l => window.__scan(l), l));
  const wait = ms => p.waitForTimeout(ms); const wide = W >= 932;
  await p.click('[data-act="bill"]'); await p.click('[data-act="more"]'); await wait(350);
  await scan('home open + desk as loaded + phone list + kit');
  if (wide) { await p.click('#desk-row-2'); await wait(100); await scan('desk: warning gap selected'); await p.click('#desk-row-0'); await wait(100); }
  await p.click('#desk [data-act="claim"]'); await wait(450);
  await p.click('#desk [data-act="pay"]'); await wait(450);
  await scan('desk: toast + reasons bar');
  await p.click('#desk [data-reason="0"]'); await wait(450);
  await p.click('#desk [data-act="claim"]'); await wait(450); await p.click('#desk [data-act="claim"]'); await wait(450);
  await scan('desk: all decided');
  await p.click('#ph-live [data-p="edit"][data-i="5"]'); await wait(450);
  await scan('phone: quantity sheet empty');
  for (const k of ['5', '.', '5']) await p.click(`#ph-over [data-p="key"][data-d="${k}"]`);
  await p.click('#ph-over [data-p="dmg"]'); await scan('phone: quantity sheet with note');
  await p.click('#ph-over [data-p="save"]'); await wait(650);
  await p.click('#ph-main'); await wait(450); await p.click('#ph-over [data-p="spot-ok"]'); await wait(50);
  await scan('phone: spot check with message');
  await p.locator('#ph-over .ph-x').click(); await wait(650);
  for (let i = 0; i < 11; i++) { const s = '#ph-live .ln:not(.is-ok):not(.is-gap) [data-p="ok"]'; if (await p.locator(s).count()) await p.locator(s).first().click(); }
  await p.click('#ph-main'); await wait(450); await scan('phone: before closing');
  await p.click('#ph-over [data-p="close-nodoc"]'); await wait(700); await scan('phone: closed');
  await p.click('#ph-over [data-p="slip"]'); await wait(450); await scan('phone: gap slip');
  // example 4: the menu in its states, and every settings section
  await p.locator('#shell').scrollIntoViewIfNeeded();
  if (wide) {
    await p.click('#ex4 .mn-g[data-g="procure"]'); await wait(80); await scan('shell: purchasing open');
    await p.click('#ex4 .mn-g[data-g="money"]'); await wait(80); await scan('shell: money folded');
    await p.click('#ex4 .mn-g[data-g="money"]'); await p.click('#ex4 [data-m="star"]'); await wait(80); await scan('shell: favourite');
    await p.click('#ex4 .mn-toggle'); await wait(150); await scan('shell: collapsed');
    await p.click('#ex4 .mn-tile[data-g="money"]'); await wait(150); await scan('shell: list of a group');
    await p.keyboard.press('Escape'); await p.keyboard.press('End'); await wait(120); await scan('shell: label of a control');
    await p.click('#ex4 .mn-toggle'); await wait(150);
    await p.click('#ex1 .mn-toggle'); await wait(150); await scan('home: collapsed'); await p.click('#ex1 .mn-toggle'); await wait(150);
    await p.click('#ex2 .mn-toggle'); await wait(150); await scan('desk: menu open, queue empty');
    await p.click('#desk [data-act="reset"]'); await wait(450); await scan('desk: menu open, queue full'); await p.click('#ex2 .mn-toggle'); await wait(150);
  }
  for (const id of ['account', 'security', 'privacy', 'biz', 'letter', 'rules']) { await p.click('#sh-sects [data-sect="' + id + '"]'); await wait(60); await scan('settings: ' + id); }
  for (let i = 0; i < 6; i++) await p.click('#sh-body [data-num="pp"][data-d="1"]');
  for (let i = 0; i < 5; i++) await p.click('#sh-body [data-num="pa"][data-d="1"]');
  await wait(60); await scan('settings: changed, not saved');
  await p.click('#sh-body [data-do="save"]'); await wait(80); await p.click('#sh-body [data-do="log"]'); await wait(60); await scan('settings: saved, history open');
  if (wide) { await p.click('#ex4 [data-m="cmd"]'); await wait(150); await scan('settings: Ctrl K'); await p.keyboard.type('קקק'); await wait(60); await scan('settings: Ctrl K, nothing found'); await p.keyboard.press('Escape'); }
  await p.fill('#sh-q', 'מעמ'); await wait(60); await scan('settings: search result'); await p.fill('#sh-q', 'קקק'); await wait(60); await scan('settings: search, nothing found');
  const uniq = (rows, key) => { const m = new Map(); for (const r of rows) { const k = key(r); if (!m.has(k)) m.set(k, r); } return [...m.values()]; };
  const lowC = uniq(out.flatMap(o => o.lowContrast.map(x => ({ ...x, state: o.label }))), x => x.where + x.fg + x.bg).sort((a, b) => a.ratio - b.ratio);
  const small = uniq(out.flatMap(o => o.smallText), x => x.where + x.fs);
  const targets = uniq(out.flatMap(o => o.smallTargets.map(x => ({ ...x, state: o.label }))), x => x.where + x.w + 'x' + x.h);
  const mins = out.map(o => o.min).filter(Boolean).sort((x, y) => x.ratio - y.ratio);
  console.log('  lowest text contrast:', JSON.stringify(mins[0]));
  console.log(JSON.stringify({ width: W, finish: FIN, theme: THEME, textNodes: out.reduce((a, o) => a + o.n, 0), lowContrast: lowC.length, smallText: small.length, smallTargets: targets.length, errs }));
  for (const x of lowC.slice(0, 14)) console.log('  contrast', x.ratio, '<', x.need, x.fg, 'on', x.bg, JSON.stringify(x.text), x.where, '|', x.state);
  for (const x of small.slice(0, 12)) console.log('  small text', x.fs, '<', x.floor, JSON.stringify(x.text), x.where);
  for (const x of targets.slice(0, 16)) console.log('  target', x.w + 'x' + x.h, '<', x.floor, JSON.stringify(x.text), x.where, '|', x.state);
  await b.close();
})().catch(e => { console.error('CRASH', e.message.slice(0, 700)); process.exit(2); });
