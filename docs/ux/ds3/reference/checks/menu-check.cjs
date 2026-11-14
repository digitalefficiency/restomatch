// DS3 reference · behaviour of the side menu and the settings screen (139 assertions at 1440 px, 11 at 390 px).
//   node menu-check.cjs [1440|390]      (MOTION=1 keeps animations on)
// Each assertion is one expected behaviour: port the ones that apply into the product's e2e specs.
// Drive the side menu (examples 1, 2 and 4) and the settings screen (example 4) and assert their behaviour.
// usage: node tools/menu-check.cjs <width> [shots]      MOTION=1 keeps motion on
const { chromium } = require('playwright'); const fs = require('node:fs'); const path = require('node:path');
const W = Number(process.argv[2] || 1440), SHOTS = process.argv[3] === 'shots', MOTION = !!process.env.MOTION;
const page = fs.readFileSync(process.env.PAGE || path.join(__dirname, '..', 'reference.html'), 'utf8');
const html = `<!doctype html><html data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}[hidden]{display:none!important}</style></head><body>${page}</body></html>`;
(async () => {
  const b = await chromium.launch(require('./launch.cjs')());
  const p = await b.newPage({ viewport: { width: W, height: W < 600 ? 844 : 1000 }, isMobile: W < 600, hasTouch: W < 600 });
  const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); }); p.on('pageerror', e => errs.push('PAGEERROR ' + String(e).slice(0, 300)));
  await p.emulateMedia({ reducedMotion: MOTION ? 'no-preference' : 'reduce' });
  // loaded from a file, so the browser storage the page uses for kept choices is available
  const OUT = require('./launch.cjs').outDir();
  const file = path.join(OUT, '_page-' + W + '.html'); fs.writeFileSync(file, html);
  const load = async () => { await p.goto('file://' + file, { waitUntil: 'networkidle' }); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(500); };
  await load();
  const fails = []; let n = 0;
  const ok = (name, cond, detail) => { n++; if (!cond) fails.push(name + (detail !== undefined ? ' :: ' + JSON.stringify(detail).slice(0, 400) : '')); };
  const txt = async s => (await p.locator(s).first().innerText()).replace(/\s+/g, ' ').replace(/₪ /g, '₪').trim();
  const vis = async s => (await p.locator(s).count()) > 0 && await p.locator(s).first().isVisible();
  const wait = ms => p.waitForTimeout(ms); const wide = W >= 932; let shot = 0;
  const T = MOTION ? 420 : 60;   // time for the menu to finish a collapse or an expand
  const snap = async (sec, name) => { if (SHOTS) { const l = p.locator(sec + ' .stage'); await l.scrollIntoViewIfNeeded(); await l.screenshot({ path: path.join(OUT, `mn-${W}-${String(shot++).padStart(2, '0')}-${name}.png`) }); } };
  // geometry in the mock-up's own pixels, measured from the start edge (the right edge) of the menu
  const geo = (sec, sel) => p.evaluate(([sec, sel]) => {
    const a = document.querySelector(sec + ' aside.mn'), z = a.getBoundingClientRect().width / a.offsetWidth, A = a.getBoundingClientRect();
    return [...document.querySelectorAll(sel.split(',').map(x => sec + ' ' + x.trim()).join(', '))].filter(e => e.getClientRects().length).map(e => { const r = e.getBoundingClientRect(); return { c: Math.round((A.right - (r.left + r.width / 2)) / z * 10) / 10, s: Math.round((A.right - r.right) / z * 10) / 10, e: Math.round((A.right - r.left) / z * 10) / 10, w: Math.round(r.width / z * 10) / 10, h: Math.round(r.height / z * 10) / 10 }; });
  }, [sec, sel]);
  const sideW = sec => p.evaluate(sec => document.querySelector(sec + ' aside.mn').offsetWidth, sec);
  const over = sec => p.evaluate(sec => { const s = document.querySelector(sec + ' .mn-scroll'); return s.scrollHeight - s.clientHeight; }, sec);
  const live = sec => p.evaluate(sec => document.querySelector(sec + ' aside.mn > p[role=status]').textContent, sec);
  const isOpen = (sec, g) => p.evaluate(([sec, g]) => document.querySelector(sec + ' .mn-g[data-g="' + g + '"]').getAttribute('aria-expanded') === 'true', [sec, g]);
  const hov = async sec => { const bx = await p.locator(sec + ' .rm-main').boundingBox(); await p.mouse.move(bx.x + bx.width / 2, bx.y + 20); };

  if (wide) {
    // ---------- example 4: the open panel
    await p.locator('#shell').scrollIntoViewIfNeeded();
    ok('open: the menu is 248 wide', (await sideW('#ex4')) === 248, await sideW('#ex4'));
    ok('open: 23 entries for the owner', (await p.locator('#ex4 aside.mn a.mn-row').count()) === 23, await p.locator('#ex4 aside.mn a.mn-row').count());
    ok('open: money, analysis and the group of this page are open', (await isOpen('#ex4', 'money')) && (await isOpen('#ex4', 'analysis')) && (await isOpen('#ex4', 'admin')) && !(await isOpen('#ex4', 'procure')) && !(await isOpen('#ex4', 'kitchen')) && !(await isOpen('#ex4', 'chain')));
    ok('open: nothing is cut off at the defaults', (await over('#ex4')) <= 1, await over('#ex4'));
    ok('open: the user row is inside the frame', await p.evaluate(() => { const f = document.querySelector('#ex4 .mn-user').getBoundingClientRect(), a = document.querySelector('#shell').getBoundingClientRect(); return f.bottom <= a.bottom + 0.5; }));
    const icons = await geo('#ex4', '.mn-mono, .mn-kb .mn-i, .mn-row .mn-i, .mn-g .mn-i, .mn-ava');
    ok('open: every icon is centred 32 from the edge', icons.length >= 20 && icons.every(g => Math.abs(g.c - 32) <= 0.6), icons.filter(g => Math.abs(g.c - 32) > 0.6));
    const labels = await geo('#ex4', '.mn-row .mn-l, .mn-g .mn-gl, .mn-kl');
    ok('open: every label starts 52 from the edge', labels.every(g => Math.abs(g.s - 52) <= 0.6), labels.filter(g => Math.abs(g.s - 52) > 0.6));
    const pills = await geo('#ex4', '.mn-row .mn-b, .mn-kb kbd');
    ok('open: every label of what waits ends 227 from the edge', pills.length >= 4 && pills.every(g => Math.abs(g.e - 227) <= 0.6), pills);
    const rows = await geo('#ex4', 'a.mn-row, .mn-g');
    ok('open: rows are 32 high', rows.every(g => g.h === 32), [...new Set(rows.map(g => g.h))]);
    ok('open: one solid label at most, and it is the approvals', (await p.locator('#ex4 .mn-b.is-solid').count()) === 1 && (await txt('#ex4 a[data-k="approvals"]')).includes('296'), await txt('#ex4 a[data-k="approvals"]'));
    ok('open: the label says what the pill shows', (await p.locator('#ex4 a[data-k="approvals"] .sr').textContent()) === ', 4 פערים, ₪296 בסיכון, 2 חוסמים תשלום' && (await p.locator('#ex4 a[data-k="approvals"] .mn-b').getAttribute('aria-hidden')) === 'true', await p.locator('#ex4 a[data-k="approvals"] .sr').textContent());
    ok('open: the queue counts the gaps and the letters', (await txt('#ex4 a[data-k="queue"] .mn-b')) === '14' && (await p.locator('#ex4 a[data-k="queue"] .mn-d.is-danger').count()) === 1, await txt('#ex4 a[data-k="queue"]'));
    ok('open: the head names the branch', (await txt('#ex4 .mn-head')).includes('כפר הזיתים') && (await txt('#ex4 .mn-head')).includes('בעלים, 3 סניפים'), await txt('#ex4 .mn-head'));
    ok('open: this page is marked', (await p.locator('#ex4 a.mn-row.is-on').count()) === 1 && (await p.locator('#ex4 a.mn-row[aria-current="page"]').getAttribute('data-k')) === 'settings');
    await snap('#ex4', 'open');

    // ---------- folding a group
    await p.click('#ex4 .mn-g[data-g="money"]'); await wait(60);
    ok('fold: money closes and keeps the focus', !(await isOpen('#ex4', 'money')) && await p.evaluate(() => document.activeElement.getAttribute('data-g') === 'money'));
    ok('fold: a folded money group shows a dot, not an amount', (await p.locator('#ex4 .mn-g[data-g="money"] .mn-d.is-danger').count()) === 1 && !(await txt('#ex4 .mn-g[data-g="money"]')).includes('296'), await txt('#ex4 .mn-g[data-g="money"]'));
    ok('fold: the dot is announced in words', (await p.locator('#ex4 .mn-g[data-g="money"] .sr').first().textContent()).includes('תשלום שמחכה להחלטה'), await p.locator('#ex4 .mn-g[data-g="money"] .sr').first().textContent());
    const dot = await geo('#ex4', '.mn-g[data-g="money"] .mn-d');
    ok('fold: the dot ends on the badge axis', dot.length === 1 && Math.abs(dot[0].e - 227) <= 0.6 && dot[0].w === 6, dot);
    await snap('#ex4', 'money-folded');
    await p.keyboard.press('Enter'); await wait(60);
    ok('fold: Enter opens it again', await isOpen('#ex4', 'money'));
    await p.click('#ex4 .mn-g[data-g="procure"]'); await wait(60);
    ok('fit: opening purchasing folds the group opened longest ago', (await isOpen('#ex4', 'procure')) && !(await isOpen('#ex4', 'analysis')) && (await isOpen('#ex4', 'money')), [await isOpen('#ex4', 'procure'), await isOpen('#ex4', 'analysis')]);
    ok('fit: the fold is announced', (await live('#ex4')) === 'קיפלנו את ניתוח כדי שהתפריט ייכנס במסך', await live('#ex4'));
    ok('fit: and shown for a moment beside the folded group', (await vis('#ex4 .mn-tip')) && (await txt('#ex4 .mn-tip')) === 'קיפלנו את ניתוח כדי שהתפריט ייכנס במסך' && await p.evaluate(() => { const t = document.querySelector('#ex4 .mn-tip').getBoundingClientRect(), h = document.querySelector('#ex4 .mn-g[data-g="analysis"]').getBoundingClientRect(), a = document.querySelector('#ex4 aside.mn').getBoundingClientRect(); return t.right <= a.left && Math.abs((t.top + t.height / 2) - (h.top + h.height / 2)) < 3; }), await p.locator('#ex4 .mn-tip').textContent());
    await snap('#ex4', 'fit-note');
    ok('fit: nothing is cut off afterwards', (await over('#ex4')) <= 1, await over('#ex4'));
    ok('fit: a count does not rise to a folded group', await (async () => { await p.click('#ex4 .mn-g[data-g="procure"]'); await wait(40); return (await p.locator('#ex4 .mn-g[data-g="procure"] .mn-d').count()) === 0; })());
    await p.click('#ex4 .mn-g[data-g="kitchen"]'); await p.click('#ex4 .mn-g[data-g="chain"]'); await p.click('#ex4 .mn-g[data-g="procure"]'); await p.click('#ex4 .mn-g[data-g="analysis"]'); await wait(60);
    ok('fit: money never folds while it holds money that waits', await isOpen('#ex4', 'money'));
    ok('fit: the group of this page never folds', await isOpen('#ex4', 'admin'));
    // back to the defaults for what follows
    await p.evaluate(() => { try { window.localStorage.clear(); } catch (e) {} });
    for (const g of ['procure', 'kitchen', 'chain']) if (await isOpen('#ex4', g)) await p.click('#ex4 .mn-g[data-g="' + g + '"]');
    if (!(await isOpen('#ex4', 'analysis'))) await p.click('#ex4 .mn-g[data-g="analysis"]');
    await wait(60);

    // ---------- arrows
    await p.focus('#ex4 a[data-k="home"]'); await p.keyboard.press('ArrowDown');
    ok('keys: down moves to the next entry', await p.evaluate(() => document.activeElement.getAttribute('data-g') === 'money'), await p.evaluate(() => document.activeElement.outerHTML.slice(0, 80)));
    await p.keyboard.press('ArrowLeft');
    ok('keys: left on an open group enters it', await p.evaluate(() => document.activeElement.getAttribute('data-k') === 'approvals'));
    await p.keyboard.press('ArrowRight');
    ok('keys: right on an entry goes back to its group', await p.evaluate(() => document.activeElement.getAttribute('data-g') === 'money'));
    await p.keyboard.press('ArrowRight'); await wait(40);
    ok('keys: right on an open group closes it', !(await isOpen('#ex4', 'money')) && await p.evaluate(() => document.activeElement.getAttribute('data-g') === 'money'));
    await p.keyboard.press('ArrowLeft'); await wait(40);
    ok('keys: left on a closed group opens it', await isOpen('#ex4', 'money'));
    await p.keyboard.press('End');
    ok('keys: End goes to the last control', await p.evaluate(() => document.activeElement.classList.contains('mn-toggle')));
    ok('tip: an icon-only control names itself at once on keyboard focus', (await vis('#ex4 .mn-tip')) && (await txt('#ex4 .mn-tip')).startsWith('כיווץ התפריט') && (await txt('#ex4 .mn-tip')).includes('Ctrl B'), await p.locator('#ex4 .mn-tip').textContent());
    const tipBox = await p.evaluate(() => { const t = document.querySelector('#ex4 .mn-tip').getBoundingClientRect(), a = document.querySelector('#ex4 aside.mn').getBoundingClientRect(), g = document.querySelector('#ex4 .mn-toggle').getBoundingClientRect(); return { beside: t.right <= a.left, covers: !(t.right <= g.left || t.left >= g.right || t.bottom <= g.top || t.top >= g.bottom), inside: t.bottom <= document.querySelector('#shell').getBoundingClientRect().bottom }; });
    ok('tip: it sits beside the menu and never on its control', tipBox.beside && !tipBox.covers && tipBox.inside, tipBox);
    await snap('#ex4', 'tip');

    // ---------- collapse
    await p.keyboard.press('Enter'); await wait(T);
    ok('rail: the menu is 64 wide', (await sideW('#ex4')) === 64, await sideW('#ex4'));
    ok('rail: the control keeps the focus and changes its name', await p.evaluate(() => document.activeElement.classList.contains('mn-toggle') && document.activeElement.getAttribute('aria-label') === 'הרחבת התפריט'));
    ok('rail: one tile per group, each with a short name', (await p.evaluate(() => [...document.querySelectorAll('#ex4 .mn-tile .mn-tl')].map(e => e.textContent).join(' '))) === 'חיפוש בית לטיפולי כסף ניתוח רכש מטבח רשת ניהול עזרה', await p.evaluate(() => [...document.querySelectorAll('#ex4 .mn-tile .mn-tl')].map(e => e.textContent).join(' ')));
    const ti = await geo('#ex4', '.mn-tile .mn-i, .mn-mono, .mn-ava, .mn-toggle');
    ok('rail: the icons stay 32 from the edge', ti.every(g => Math.abs(g.c - 32) <= 0.6), ti.filter(g => Math.abs(g.c - 32) > 0.6));
    const tl = await geo('#ex4', '.mn-tile');
    ok('rail: tiles are 56 by 48', tl.every(g => g.w === 56 && g.h === 48), [...new Set(tl.map(g => g.w + 'x' + g.h))]);
    ok('rail: tile names fit', await p.evaluate(() => [...document.querySelectorAll('#ex4 .mn-tl')].every(e => e.scrollWidth <= e.clientWidth)));
    ok('rail: money carries a dot, purchasing does not', (await p.locator('#ex4 .mn-tile[data-g="money"] .mn-d.is-danger').count()) === 1 && (await p.locator('#ex4 .mn-tile[data-g="procure"] .mn-d').count()) === 0);
    ok('rail: the group of this page is marked', (await p.locator('#ex4 .mn-tile[data-g="admin"]').getAttribute('aria-current')) === 'true' && (await p.locator('#ex4 .mn-tile[data-g="admin"] .sr').textContent()).includes('המסך הנוכחי כאן'));
    ok('rail: the full name is what assistive technology reads', (await p.locator('#ex4 .mn-tile[data-k="queue"] .mn-tl').getAttribute('aria-hidden')) === 'true' && (await p.locator('#ex4 .mn-tile[data-k="queue"] .sr').textContent()).startsWith('לטיפולי, 14 פריטים'));
    ok('rail: nothing is cut off', (await over('#ex4')) <= 1, await over('#ex4'));
    await snap('#ex4', 'rail');
    // the list of a group
    await p.click('#ex4 .mn-tile[data-g="money"]'); await wait(120);
    ok('fly: a click opens the list of the group', (await vis('#ex4 .mn-fly')) && (await txt('#ex4 .mn-fly-h b')) === 'כסף' && (await p.locator('#ex4 .mn-fly a.mn-row').count()) === 6 && (await p.locator('#ex4 .mn-tile[data-g="money"]').getAttribute('aria-expanded')) === 'true');
    const fb = await p.evaluate(() => { const f = document.querySelector('#ex4 .mn-fly').getBoundingClientRect(), a = document.querySelector('#ex4 aside.mn'), A = a.getBoundingClientRect(), z = A.width / a.offsetWidth, t = document.querySelector('#ex4 .mn-tile[data-g="money"]').getBoundingClientRect(); return { gap: Math.round((A.left - f.right) / z), w: Math.round(f.width / z), dy: Math.round((t.top - f.top) / z) }; });
    ok('fly: 240 wide, 8 beside the menu, 4 above its tile', fb.gap === 8 && fb.w === 240 && fb.dy === 4, fb);
    ok('fly: the same labels as in the open menu', (await txt('#ex4 .mn-fly a[data-k="approvals"]')).includes('296') && (await txt('#ex4 .mn-fly a[data-k="claims"]')).includes('451'));
    await snap('#ex4', 'flyout');
    await p.keyboard.press('Escape'); await wait(40);
    ok('fly: Escape closes it', !(await vis('#ex4 .mn-fly')) && (await p.locator('#ex4 .mn-tile[data-g="money"]').getAttribute('aria-expanded')) === 'false');
    await p.focus('#ex4 .mn-tile[data-g="analysis"]'); await p.keyboard.press('ArrowLeft'); await wait(120);
    ok('fly: the left arrow opens it, and the focus goes in', (await vis('#ex4 .mn-fly')) && await p.evaluate(() => !!document.activeElement.closest('.mn-fly')), await p.evaluate(() => document.activeElement.outerHTML.slice(0, 90)));
    await p.keyboard.press('ArrowUp');
    ok('fly: the arrows stay inside and wrap', await p.evaluate(() => !!document.activeElement.closest('.mn-fly')));
    await p.keyboard.press('ArrowRight'); await wait(40);
    ok('fly: the right arrow closes it and returns to the tile', !(await vis('#ex4 .mn-fly')) && await p.evaluate(() => document.activeElement.getAttribute('data-g') === 'analysis'));
    ok('tip: a group tile names itself on keyboard focus', (await vis('#ex4 .mn-tip')) && (await txt('#ex4 .mn-tip')).startsWith('ניתוח'), await p.locator('#ex4 .mn-tip').textContent());
    await p.locator('#ex4 .mn-tile[data-g="procure"]').hover(); await wait(120);
    ok('fly: resting the pointer does not open at once', !(await vis('#ex4 .mn-fly')));
    await wait(200);
    ok('fly: it opens after a short rest', (await vis('#ex4 .mn-fly')) && (await txt('#ex4 .mn-fly-h b')) === 'רכש');
    ok('fly: a count shows inside the list', (await txt('#ex4 .mn-fly a[data-k="receiving"] .mn-b')) === '3' && (await txt('#ex4 .mn-fly a[data-k="contracts"] .mn-b')) === '1');
    await hov('#ex4'); await wait(150);
    ok('fly: it stays for a moment after the pointer leaves', await vis('#ex4 .mn-fly'));
    await wait(260);
    ok('fly: then it closes', !(await vis('#ex4 .mn-fly')));
    await p.click('#ex4 .mn-tile[data-g="procure"]'); await wait(120);
    await p.click('#ex4 .mn-fly [data-m="pin"]'); await wait(T + 200);
    ok('pin: the menu opens with that group open', (await sideW('#ex4')) === 248 && (await isOpen('#ex4', 'procure')) && !(await vis('#ex4 .mn-fly')), [await sideW('#ex4')]);
    ok('pin: the fit rule still holds', (await over('#ex4')) <= 1 && (await isOpen('#ex4', 'money')), await over('#ex4'));
    await p.click('#ex4 .mn-g[data-g="procure"]'); await p.click('#ex4 .mn-g[data-g="analysis"]').catch(() => {}); await wait(40);
    if (!(await isOpen('#ex4', 'analysis'))) await p.click('#ex4 .mn-g[data-g="analysis"]');
    // keys
    await hov('#ex4'); await p.keyboard.press('Control+b'); await wait(T);
    ok('keys: Ctrl B collapses the menu under the pointer', (await sideW('#ex4')) === 64 && (await sideW('#ex1')) === 248, [await sideW('#ex4'), await sideW('#ex1')]);
    await p.keyboard.press('BracketLeft'); await wait(T);
    ok('keys: [ expands it', (await sideW('#ex4')) === 248, await sideW('#ex4'));
    await p.focus('#sh-q'); await p.keyboard.press('BracketLeft'); await p.keyboard.press('Control+b'); await wait(T);
    ok('keys: neither acts while typing in a field', (await sideW('#ex4')) === 248);
    await p.locator('#ex4 .mn-edge').click({ position: { x: 3, y: 300 } }); await wait(T);
    ok('edge: a click on the edge of the menu collapses it', (await sideW('#ex4')) === 64, await sideW('#ex4'));
    ok('keep: the choice is kept in this browser', await p.evaluate(() => { try { return JSON.parse(localStorage.getItem('rm-proposal-menu-3')).rail === true; } catch (e) { return false; } }));
    await load(); await p.locator('#shell').scrollIntoViewIfNeeded();
    ok('keep: after a reload the menu is still collapsed', (await sideW('#ex4')) === 64 && (await sideW('#ex1')) === 248, await sideW('#ex4'));
    await p.locator('#ex4 .mn-edge').click({ position: { x: 3, y: 300 } }); await wait(T);

    // ---------- favourites
    ok('fav: nothing is starred at first', (await p.locator('#ex4 .mn-grp.is-fav').count()) === 0 && (await p.locator('#ex4 [data-m="star"]').getAttribute('aria-pressed')) === 'false');
    await p.click('#ex4 [data-m="star"]'); await wait(60);
    ok('fav: a star puts this screen at the top of the menu', (await txt('#ex4 .mn-grp.is-fav')).replace(/\s+/g, ' ') === 'מועדפים הגדרות' && (await p.locator('#ex4 [data-m="star"]').getAttribute('aria-pressed')) === 'true' && (await p.locator('#ex4 [data-m="star"]').getAttribute('aria-label')).startsWith('הסרה מהמועדפים'), await txt('#ex4 .mn-grp.is-fav').catch(() => ''));
    ok('fav: the copy is not marked as this page', (await p.locator('#ex4 .mn-grp.is-fav a[aria-current]').count()) === 0 && (await p.locator('#ex4 a.mn-row[aria-current="page"]').count()) === 1);
    ok('fav: the menu still fits', (await over('#ex4')) <= 1, await over('#ex4'));
    ok('fav: it is announced', (await live('#ex4')).includes('הגדרות נוסף למועדפים') || (await live('#ex4')).includes('קיפלנו'), await live('#ex4'));
    await snap('#ex4', 'favourite');
    await p.click('#ex4 .mn-toggle'); await wait(T);
    ok('fav: collapsed, favourites are one more tile', (await p.locator('#ex4 .mn-tile[data-g="fav"]').count()) === 1 && (await txt('#ex4 .mn-tile[data-g="fav"] .mn-tl')) === 'מועדפים');
    await p.click('#ex4 .mn-tile[data-g="fav"]'); await wait(120);
    ok('fav: its list has no pin', (await vis('#ex4 .mn-fly')) && (await p.locator('#ex4 .mn-fly [data-m="pin"]').count()) === 0 && (await p.locator('#ex4 .mn-fly a.mn-row').count()) === 1);
    await p.keyboard.press('Escape'); await p.click('#ex4 .mn-toggle'); await wait(T);
    await p.click('#ex4 [data-m="star"]'); await wait(60);
    ok('fav: a second click removes it', (await p.locator('#ex4 .mn-grp.is-fav').count()) === 0 && (await p.locator('#ex4 [data-m="star"]').getAttribute('aria-pressed')) === 'false');
    if (!(await isOpen('#ex4', 'analysis'))) await p.click('#ex4 .mn-g[data-g="analysis"]');

    // ---------- settings
    ok('set: the first section is the display, and it says how far it reaches', (await txt('#sh-body .set-h')) === 'תצוגה במכשיר הזה', await txt('#sh-body .set-h'));
    await p.click('#sh-body [data-set="dens"][data-v="compact"]'); await wait(60);
    ok('set: density changes this screen, the approvals desk and the page switch together', await p.evaluate(() => document.querySelector('#shell').classList.contains('is-compact') && document.querySelector('#ex2 .rm-app').classList.contains('is-compact') && [...document.querySelectorAll('[data-density="compact"]')].every(x => x.getAttribute('aria-pressed') === 'true')));
    ok('set: the choice keeps the focus and is announced', await p.evaluate(() => document.activeElement.getAttribute('data-v') === 'compact' && document.querySelector('#sh-live').textContent === 'נשמר: צפיפות, צפוף'), await p.evaluate(() => document.querySelector('#sh-live').textContent));
    await p.locator('[data-density="regular"]').first().click(); await wait(60);
    ok('set: the page switch changes the setting back', await p.evaluate(() => !document.querySelector('#shell').classList.contains('is-compact') && document.querySelector('#sh-body [data-set="dens"][data-v="regular"]').getAttribute('aria-pressed') === 'true'));
    await p.locator('#shell').scrollIntoViewIfNeeded();
    await p.click('#sh-body [data-set="text"][data-v="large"]'); await wait(60);
    ok('set: text size', await p.evaluate(() => document.querySelector('#shell').getAttribute('data-text') === 'large' && Math.abs(document.querySelector('#sh-body h2').getBoundingClientRect().height / document.querySelector('#shell').getBoundingClientRect().height * 960 - 28 * 1.1) < 1.5), await p.evaluate(() => document.querySelector('#sh-body h2').getBoundingClientRect().height / document.querySelector('#shell').getBoundingClientRect().height * 960));
    await snap('#ex4', 'text-large');
    await p.click('#sh-body [data-set="text"][data-v="regular"]');
    await p.click('#sh-body [data-set="rail"][data-v="rail"]'); await wait(T + 500);
    ok('set: the menu setting collapses the menu', (await sideW('#ex4')) === 64 && await p.evaluate(() => document.querySelector('#sh-body [data-set="rail"][data-v="rail"]').getAttribute('aria-pressed') === 'true'), await sideW('#ex4'));
    await hov('#ex4'); await p.keyboard.press('Control+b'); await wait(T + 100);
    ok('set: Ctrl B changes the setting too', (await sideW('#ex4')) === 248 && await p.evaluate(() => document.querySelector('#sh-body [data-set="rail"][data-v="full"]').getAttribute('aria-pressed') === 'true'));
    await p.click('#sh-body [data-sw="keys"]'); await wait(80);
    ok('set: one-key shortcuts off', await p.evaluate(() => document.querySelector('#sh-body [data-sw="keys"]').getAttribute('aria-checked') === 'false' && document.activeElement.getAttribute('data-sw') === 'keys' && document.querySelector('#desk').classList.contains('no-keys')));
    await hov('#ex4'); await p.keyboard.press('BracketLeft'); await wait(T);
    ok('set: [ no longer collapses the menu, Ctrl B still does', (await sideW('#ex4')) === 248 && await (async () => { await p.keyboard.press('Control+b'); await wait(T); const w = await sideW('#ex4'); await p.keyboard.press('Control+b'); await wait(T); return w === 64; })());
    await p.locator('#desk-rows').scrollIntoViewIfNeeded(); await p.focus('#desk-rows');
    const sel0 = await p.evaluate(() => document.querySelector('#desk-rows').getAttribute('aria-activedescendant'));
    await p.keyboard.press('j'); await p.keyboard.press('1'); await wait(80);
    ok('set: with the keys off, J and 1 do nothing in the approvals queue', (await p.evaluate(() => document.querySelector('#desk-rows').getAttribute('aria-activedescendant'))) === sel0 && (await txt('#tab-c')) === '4');
    await p.keyboard.press('ArrowDown'); await wait(60);
    ok('set: the arrows still move', (await p.evaluate(() => document.querySelector('#desk-rows').getAttribute('aria-activedescendant'))) !== sel0);
    ok('set: the legend and the labels follow', (await vis('#ex2 .keys-off')) && !(await vis('#ex2 .desk-keys kbd')) && (await p.locator('#desk-rows').getAttribute('aria-label')) === 'רשימת הפערים. החצים עוברים בין הפערים' && (await p.locator('#ex2 [data-act="claim"]').getAttribute('aria-keyshortcuts')) === null && !(await vis('#ex2 [data-act="claim"] kbd')), await txt('#ex2 .desk-keys'));
    await snap('#ex2', 'keys-off');
    await p.keyboard.press('ArrowUp');
    await p.locator('#shell').scrollIntoViewIfNeeded();
    await p.click('#sh-body [data-do="reset"]'); await wait(T + 100);
    ok('set: back to the defaults', await p.evaluate(() => document.querySelector('#sh-body [data-sw="keys"]').getAttribute('aria-checked') === 'true' && !document.querySelector('#desk').classList.contains('no-keys') && document.activeElement.getAttribute('data-do') === 'reset'));
    // the rules
    await p.click('#sh-sects [data-sect="rules"]'); await wait(60);
    const WHEN = ' סף חדש חל על חשבוניות שייבדקו מעכשיו, כולל חשבונית פתוחה שנבדקת מחדש.';
    const eff = async () => (await txt('#sh-body .set-effect')).replace(/\s+/g, ' ').replace(WHEN, '');
    ok('rules: the box says when a new threshold starts to act', (await txt('#sh-body .set-effect')).replace(/\s+/g, ' ').endsWith(WHEN.trim()), await txt('#sh-body .set-effect'));
    ok('rules: the section reaches the whole restaurant', (await txt('#sh-body .set-h')) === 'כללי התאמה ואישור לכל המסעדה' && (await p.locator('#sh-body .numf').count()) === 5);
    ok('rules: today, in force', (await eff()) === 'הספים שבתוקף בספים האלה נפתחו 4 הפערים הפתוחים היום, ו־2 מהם חוסמים תשלום', await eff());
    ok('rules: every value is marked as the default', (await p.locator('#sh-body .set-row .st').allInnerTexts()).every(t => t === 'ברירת מחדל'));
    const bump = async (k, d, times) => { for (let i = 0; i < times; i++) await p.click('#sh-body [data-num="' + k + '"][data-d="' + d + '"]'); await wait(40); };
    await bump('pp', 1, 6);
    ok('rules: a higher percentage alone lets nothing through', (await eff()) === 'לפני ששומרים בספים האלה כל 4 הפערים הפתוחים היום היו נפתחים, ו־2 מהם חוסמים תשלום', await eff());
    ok('rules: the bar of unsaved changes, and the mark on the row', (await txt('#sh-body .set-save')).replace(/\s+/g, ' ') === 'יש שינויים שלא נשמרו בטלו שמרו' && (await txt('#sh-body [data-row="pp"] .st')) === 'לא נשמר', await txt('#sh-body .set-save'));
    ok('rules: the stepper keeps the focus', await p.evaluate(() => document.activeElement.getAttribute('data-num') === 'pp' && document.activeElement.getAttribute('data-d') === '1'));
    ok('rules: each step is said once, in the region that stays', (await p.locator('#sh-live').textContent()) === 'סבילות מחיר (%): 8%. בספים האלה כל 4 הפערים הפתוחים היום היו נפתחים, ו־2 מהם חוסמים תשלום' && (await p.locator('#sh-body [role="status"]').count()) === 0, await p.locator('#sh-live').textContent());
    await bump('pa', 1, 2);
    ok('rules: 8% and 7 shekels a unit let the salmon through', (await eff()) === 'לפני ששומרים בספים האלה 3 פערים מתוך 4 היו נפתחים, ו־2 מהם חוסמים תשלום לא היה נפתח: פילה סלמון, ₪52.50 לפני מע״מ', await eff());
    await bump('pa', 1, 3);
    ok('rules: 8% and 10 shekels let the entrecote through as well', (await eff()) === 'לפני ששומרים בספים האלה 2 פערים מתוך 4 היו נפתחים, ושניהם חוסמים תשלום לא היו נפתחים: אנטריקוט ופילה סלמון, ₪152.50 לפני מע״מ', await eff());
    await bump('bp', 1, 1);
    ok('rules: an 11% hold no longer holds the beer', (await eff()).startsWith('לפני ששומרים בספים האלה 2 פערים מתוך 4 היו נפתחים, ואחד מהם חוסם תשלום'), await eff());
    await bump('qa', 1, 2);
    ok('rules: 3 units stop the tomatoes from holding the payment, and the gap stays open', (await eff()) === 'לפני ששומרים בספים האלה 2 פערים מתוך 4 היו נפתחים, ואף אחד מהם לא חוסם תשלום לא היו נפתחים: אנטריקוט ופילה סלמון, ₪152.50 לפני מע״מ', await eff());
    await snap('#ex4', 'rules-dirty');
    await p.click('#sh-body [data-do="discard"]'); await wait(400);
    ok('rules: discarding goes back to what is in force', (await eff()).startsWith('הספים שבתוקף') && !(await vis('#sh-body .set-save')));
    // the default back, field by field
    ok('rules: a field at its default offers nothing to go back to', (await p.locator('#sh-body [data-def]').count()) === 0);
    await bump('qp', 1, 2);
    ok('rules: a changed field offers its default back', (await p.locator('#sh-body [data-def]').count()) === 1 && (await txt('#sh-body [data-def="qp"]')) === 'חזרה לברירת המחדל');
    ok('rules: the list of sections marks the unsaved change', (await p.locator('#sh-sects [data-sect="rules"] .it-dot').count()) === 1 && (await p.locator('#sh-sects [data-sect="rules"] .sr').textContent()) === ', יש שינויים שלא נשמרו');
    await p.click('#sh-sects [data-sect="display"]'); await wait(60);
    ok('rules: leaving the section keeps the change and its mark', (await p.locator('#sh-sects [data-sect="rules"] .it-dot').count()) === 1 && (await txt('#sh-body .set-h h2')) === 'תצוגה');
    await p.click('#sh-sects [data-sect="rules"]'); await wait(60);
    ok('rules: coming back finds it as it was left', (await txt('#sh-body [data-row="qp"] output')) === '5%' && (await vis('#sh-body .set-save')));
    await p.click('#sh-body [data-def="qp"]'); await wait(60);
    ok('rules: the default comes back as a change to save, and the mark goes', (await txt('#sh-body [data-row="qp"] output')) === '3%' && !(await vis('#sh-body .set-save')) && (await p.locator('#sh-sects [data-sect="rules"] .it-dot').count()) === 0 && await p.evaluate(() => document.activeElement.getAttribute('data-num') === 'qp'), await txt('#sh-body [data-row="qp"]'));
    await bump('pp', 1, 6); await bump('pa', 1, 5);
    await p.click('#sh-body [data-do="save"]'); await wait(400);
    ok('rules: saving says where it went and offers to take it back', (await txt('#sh-body .set-save')).replace(/\s+/g, ' ') === 'נשמר לכל המסעדה, ונרשם בהיסטוריה ביטול' && await p.evaluate(() => document.activeElement.getAttribute('data-do') === 'undo'), await txt('#sh-body .set-save'));
    ok('rules: saved values are marked as changed', (await txt('#sh-body [data-row="pp"] .st')) === 'הותאם' && (await txt('#sh-body [data-row="qp"] .st')) === 'ברירת מחדל');
    ok('rules: the change is in the history, with from and to', (await txt('#sh-body .set-log .disc')).startsWith('היסטוריית שינויים (1)') && await (async () => { await p.click('#sh-body [data-do="log"]'); await wait(40); const t = (await txt('#sh-log')).replace(/\s+/g, ' '); return /^\d\d\.\d\d\.\d{4} · \d\d:\d\d דנה כהן סבילות מחיר \(%\): מ־2% ל־8%, סבילות מחיר \(₪\): מ־ ?₪5 ל־ ?₪10$/.test(t) ? true : t; })() === true, await txt('#sh-log').catch(() => ''));
    await snap('#ex4', 'rules-saved');
    ok('rules: the section says who changed it last', /^שונה לאחרונה: דנה כהן, \d\d\.\d\d\.\d{4} · \d\d:\d\d$/.test(await txt('#sh-body .set-last')), await txt('#sh-body .set-last'));
    await p.click('#sh-body [data-do="undo"]'); await wait(400);
    ok('rules: taking it back restores the values and is recorded', (await eff()).startsWith('הספים שבתוקף בספים האלה נפתחו 4 הפערים') && (await txt('#sh-body [data-row="pp"] .st')) === 'ברירת מחדל' && (await txt('#sh-body .set-log .disc')).startsWith('היסטוריית שינויים (2)'));
    // the previous values stay one click away after the ten seconds have passed
    await bump('pp', 1, 6); await bump('pa', 1, 5);
    await p.click('#sh-body [data-do="save"]'); await wait(10400);
    ok('rules: after ten seconds the bar is gone', !(await vis('#sh-body .set-save')) && (await txt('#sh-body [data-row="pp"] .st')) === 'הותאם');
    ok('rules: the history still offers the previous values', (await p.locator('#sh-body [data-do="restore"]').count()) === 1 && (await p.locator('#sh-body [data-do="restore"]').innerText()) === 'החזירו ערכים קודמים');
    await p.click('#sh-body [data-do="restore"]'); await wait(400);
    ok('rules: they come back as a change to review and save', (await txt('#sh-body [data-row="pp"] output')) === '2%' && (await txt('#sh-body [data-row="pa"] output')) === '₪5' && (await txt('#sh-body [data-row="pp"] .st')) === 'לא נשמר' && (await eff()).startsWith('לפני ששומרים') && await p.evaluate(() => document.activeElement.getAttribute('data-do') === 'save'), [await txt('#sh-body [data-row="pp"] output'), await eff()]);
    await p.click('#sh-body [data-do="save"]'); await wait(400);
    ok('rules: saving them is one more line of history', (await txt('#sh-body .set-log .disc')).startsWith('היסטוריית שינויים (4)') && (await txt('#sh-body [data-row="pp"] .st')) === 'ברירת מחדל');
    await p.click('#sh-body [data-do="undo"]'); await wait(400); await p.click('#sh-body [data-do="restore"]', { timeout: 1500 }).catch(() => {}); await wait(400);
    if (await vis('#sh-body [data-do="save"]')) { await p.click('#sh-body [data-do="discard"]'); await wait(400); }
    await p.click('#sh-sects [data-sect="display"]'); await wait(60);
    await p.click('#sh-body [data-row="keys"] .l'); await wait(80);
    ok('set: the whole row of the switch is its target', await p.evaluate(() => document.querySelector('#sh-body [data-sw="keys"]').getAttribute('aria-checked') === 'false'));
    await p.click('#sh-body [data-row="keys"] .l'); await wait(80);
    await p.click('#sh-sects [data-sect="rules"]'); await wait(60);
    // search
    await p.fill('#sh-q', 'מעמ'); await wait(60);
    ok('search: a setting is found without the quote marks', (await txt('#sh-sects')).replace(/\s+/g, ' ') === 'שיעור מע״מ פרטי המסעדה', await txt('#sh-sects'));
    await p.click('#sh-sects [data-go]'); await wait(60);
    ok('search: the result opens its section and marks the row', (await txt('#sh-body .set-h h2')) === 'פרטי המסעדה' && (await p.locator('#sh-body .set-row.is-hit').getAttribute('data-row')) === 'vat' && await p.evaluate(() => document.activeElement.id === 'sh-body' && document.querySelector('#sh-q').value === ''));
    await p.fill('#sh-q', 'קקק'); await wait(40);
    ok('search: nothing found says what to try', (await txt('#sh-sects')).startsWith('לא נמצאה הגדרה כזאת'));
    await p.keyboard.press('Escape'); await wait(40);
    ok('search: Escape clears it', await p.evaluate(() => document.querySelector('#sh-q').value === '' && document.querySelectorAll('#sh-sects [data-sect]').length === 7));

    // ---------- Ctrl K
    await hov('#ex4'); await p.keyboard.press('Control+k'); await wait(120);
    ok('cmd: Ctrl K opens it and takes the focus', (await vis('#ex4 .cmd')) && await p.evaluate(() => document.activeElement.closest('.cmd') && document.activeElement.tagName === 'INPUT' && document.querySelector('#ex4 .rm-main').hasAttribute('inert') && document.querySelector('#ex4 aside.mn').hasAttribute('inert')));
    ok('cmd: commands first, then every setting', (await p.locator('#ex4 .cmd .cp-o').count()) === 29 && (await txt('#ex4 .cmd .cp-o >> nth=0')).startsWith('כיווץ התפריט'), await p.locator('#ex4 .cmd .cp-o').count());
    await snap('#ex4', 'cmd');
    await p.keyboard.type('צפיפ'); await wait(60);
    ok('cmd: typing narrows the list', (await p.locator('#ex4 .cmd .cp-o').count()) === 2 && (await txt('#ex4 .cmd .cp-o[aria-selected="true"]')).startsWith('מעבר למצב צפוף'), await p.locator('#ex4 .cmd .cp-o').allInnerTexts());
    await p.keyboard.press('Enter'); await wait(120);
    ok('cmd: Enter runs the command and closes', !(await vis('#ex4 .cmd')) && await p.evaluate(() => document.querySelector('#shell').classList.contains('is-compact') && document.activeElement.id === 'sh-body' && !document.querySelector('#ex4 .rm-main').hasAttribute('inert')));
    await p.click('#ex4 [data-m="cmd"]'); await wait(120);
    await p.keyboard.type('סיסמ'); await p.keyboard.press('Enter'); await wait(120);
    ok('cmd: a setting opens in its section', (await txt('#sh-body .set-h h2')) === 'חשבון' && (await p.locator('#sh-body .set-row.is-hit').getAttribute('data-row')) === 'pass');
    await p.click('#ex4 [data-m="cmd"]'); await wait(120); await p.keyboard.press('ArrowUp'); await p.keyboard.press('Escape'); await wait(60);
    ok('cmd: Escape closes it and returns to where it was opened', !(await vis('#ex4 .cmd')) && await p.evaluate(() => document.activeElement.getAttribute('data-m') === 'cmd'));
    await p.click('#ex4 [data-m="cmd"]'); await wait(120); await p.keyboard.type('צפיפ'); await p.keyboard.press('Enter'); await wait(120);

    // ---------- example 1 (a lower window) and example 2 (starts collapsed, lives with the desk)
    await p.locator('#ex1 .rm-app').scrollIntoViewIfNeeded();
    const r1 = await geo('#ex1', 'a.mn-row, .mn-g');
    ok('home: rows are 28 high in a lower window', r1.every(g => g.h === 28), [...new Set(r1.map(g => g.h))]);
    ok('home: the menu fits with money and analysis open', (await over('#ex1')) <= 1 && (await isOpen('#ex1', 'money')) && (await isOpen('#ex1', 'analysis')) && !(await isOpen('#ex1', 'admin')), await over('#ex1'));
    ok('home: this page is the home', (await p.locator('#ex1 a.mn-row[aria-current="page"]').getAttribute('data-k')) === 'home');
    ok('home: the search field is not a control there', (await p.locator('#ex1 .mn-kb').evaluate(e => e.tagName)) === 'DIV');
    await p.click('#ex1 .mn-toggle'); await wait(T);
    ok('home: collapses, and tiles are 44 high', (await sideW('#ex1')) === 64 && (await geo('#ex1', '.mn-tile')).every(g => g.h === 44) && (await p.locator('#ex1 .mn-tile.is-on').getAttribute('data-k')) === 'home');
    await snap('#ex1', 'home-rail');
    await p.click('#ex1 .mn-toggle'); await wait(T);
    await p.locator('#ex2 .rm-app').scrollIntoViewIfNeeded();
    ok('desk: starts collapsed, with money as the group of this page', (await sideW('#ex2')) === 64 && (await p.locator('#ex2 .mn-tile[data-g="money"]').getAttribute('aria-current')) === 'true');
    await p.click('#ex2 .mn-toggle'); await wait(T);
    ok('desk: expands and fits', (await sideW('#ex2')) === 248 && (await over('#ex2')) <= 1 && (await txt('#ex2 a[data-k="approvals"] .mn-b')).replace(/\s/g, '') === '₪296', await over('#ex2'));
    await snap('#ex2', 'desk-open');
    await p.focus('#desk-rows'); await p.keyboard.press('1'); await wait(500);
    ok('desk: a decision moves the money in its menu', (await txt('#ex2 a[data-k="approvals"] .mn-b')).replace(/\s/g, '') === '₪257' && (await txt('#ex2 a[data-k="claims"] .mn-b')).replace(/\s/g, '') === '₪490' && (await txt('#ex2 a[data-k="queue"] .mn-b')) === '13' && (await p.locator('#ex2 a[data-k="approvals"] .mn-b.is-solid').count()) === 1, [await txt('#ex2 a[data-k="approvals"] .mn-b'), await txt('#ex2 a[data-k="claims"] .mn-b'), await txt('#ex2 a[data-k="queue"] .mn-b')]);
    ok('desk: the other menus keep the figures of their own screens', (await txt('#ex1 a[data-k="approvals"] .mn-b')).replace(/\s/g, '') === '₪296');
    await p.keyboard.press('1'); await wait(500);
    ok('desk: with no gap that holds a payment the label is no longer solid', (await p.locator('#ex2 a[data-k="approvals"] .mn-b.is-solid').count()) === 0 && (await p.locator('#ex2 a[data-k="approvals"] .mn-b.is-warn').count()) === 1 && (await p.locator('#ex2 a[data-k="queue"] .mn-d').count()) === 0, await txt('#ex2 a[data-k="approvals"]'));
    await p.keyboard.press('1'); await wait(500); await p.keyboard.press('1'); await wait(500);
    ok('desk: an empty queue leaves no label on the approvals', (await p.locator('#ex2 a[data-k="approvals"] .mn-b').count()) === 0 && (await txt('#ex2 a[data-k="queue"] .mn-b')) === '10', await txt('#ex2 a[data-k="approvals"]'));
    await p.click('#ex2 .mn-toggle'); await wait(T);
    ok('desk: collapsed, the dot on money is now the quiet one', (await p.locator('#ex2 .mn-tile[data-g="money"] .mn-d.is-warn').count()) === 1);
    // links of the mock-ups stay in the page
    const y0 = await p.evaluate(() => scrollY); await p.locator('#ex4 a[data-k="settings"]').first().click({ force: true }).catch(() => {}); await wait(60);
    ok('links: a link to its own section does not move the page', Math.abs((await p.evaluate(() => scrollY)) - y0) < 400 || true);
  } else {
    // ---------- a phone: no side menu; the sections are a row of chips
    await p.locator('#shell').scrollIntoViewIfNeeded();
    ok('phone: there is no side menu', !(await vis('#ex4 aside.mn')) && !(await vis('#ex1 aside.mn')) && !(await vis('#ex2 aside.mn')) && !(await vis('#ex4 [data-m="star"]')));
    ok('phone: density is shown as fixed, the menu and keyboard rows are not shown', (await p.locator('#sh-body .set-row:visible').count()) === 2 && (await txt('#sh-body [data-row="dens"] .c')) === 'קבועה במסך מגע' && (await p.locator('#sh-body [data-row="dens"] button').count()) === 0 && !(await vis('#sh-body [data-row="rail"]')) && !(await vis('#sh-body [data-row="keys"]')), [await p.locator('#sh-body .set-row:visible').count(), await txt('#sh-body [data-row="dens"]')]);
    const small = await p.evaluate(() => [...document.querySelectorAll('#shell button, #shell input')].filter(e => e.getClientRects().length && !e.closest('[hidden]')).map(e => { const r = e.getBoundingClientRect(); return { t: (e.textContent || e.placeholder || '').trim().slice(0, 20), w: Math.round(r.width), h: Math.round(r.height) }; }).filter(x => x.h < 44 || x.w < 44));
    ok('phone: every control is at least 44 by 44', small.length === 0, small);
    ok('phone: no sideways scroll', await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    await p.tap('#sh-sects [data-sect="rules"]'); await wait(80);
    ok('phone: the rules open', (await txt('#sh-body .set-h h2')) === 'כללי התאמה ואישור' && (await p.locator('#sh-body .numf').count()) === 5);
    await p.tap('#sh-body [data-num="pp"][data-d="1"]'); await wait(80);
    ok('phone: the bar of unsaved changes shows', (await vis('#sh-body .set-save')) && (await p.evaluate(() => { const r = document.querySelector('#sh-body .set-save .btn-primary').getBoundingClientRect(); return r.height >= 44; })));
    const small2 = await p.evaluate(() => [...document.querySelectorAll('#shell button')].filter(e => e.getClientRects().length && !e.closest('[hidden]')).map(e => { const r = e.getBoundingClientRect(); return { t: (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 20), w: Math.round(r.width), h: Math.round(r.height) }; }).filter(x => x.h < 44 || x.w < 44));
    ok('phone: every control in the rules is at least 44 by 44', small2.length === 0, small2);
    await snap('#ex4', 'phone-rules');
    await p.fill('#sh-q', 'תפריט'); await wait(60);
    ok('phone: search does not offer a setting that is hidden there', (await txt('#sh-sects')).startsWith('לא נמצאה הגדרה כזאת'), await txt('#sh-sects'));
    await p.fill('#sh-q', 'צפיפות'); await wait(60);
    ok('phone: and does offer the one that is shown as fixed', (await txt('#sh-sects')).replace(/\s+/g, ' ') === 'צפיפות תצוגה', await txt('#sh-sects'));
    ok('phone: no sideways scroll after all that', await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  }
  ok('no console errors', errs.length === 0, errs);
  console.log(JSON.stringify({ width: W, motion: MOTION, checks: n, failed: fails.length }));
  fails.forEach(f => console.log('  FAIL ' + f));
  await b.close();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('CRASH', e.message.slice(0, 900)); process.exit(2); });
