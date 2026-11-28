// Round 17: one check for each finding of the confirmation review of Version 5 that was fixed.
// Real pointer, touch and keyboard events.   usage: node verify17.cjs
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const out = []; let fails = 0;
const ok = (name, cond, detail) => { out.push((cond ? 'ok   ' : 'FAIL ') + name + (cond || detail == null ? '' : '  → ' + JSON.stringify(detail))); if (!cond) fails++; };
(async () => { var b; try {
  b = await chromium.launch(require('./launch.cjs')());
  const page = fs.readFileSync(path.join(__dirname, '..', 'reference.html'), 'utf8');
  const file = path.join(require('./launch.cjs').outDir(), '_verify17.html');
  fs.writeFileSync(file, '<!doctype html><html lang="he" dir="rtl" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0">' + page + '</body></html>');
  const open = async (w, h) => { const phone = w < 600; const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: phone, isMobile: phone }); const p = await ctx.newPage(); p._errs = []; p._phone = phone; p.on('pageerror', e => p._errs.push(e.message)); await p.emulateMedia({ reducedMotion: 'reduce' }); await p.goto('file://' + file); await p.waitForTimeout(500); return p; };
  const into = async (p, sel, off) => { await p.evaluate(([s, o]) => { const r = document.querySelector(s).getBoundingClientRect(); window.scrollBy({ top: r.top - o, behavior: 'instant' }); }, [sel, off == null ? 64 : off]); await p.waitForTimeout(150); };
  const T = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }, sel);
  const tap = async (p, sel) => { const l = p.locator(sel).first(); if (p._phone) await l.tap(); else await l.click(); await p.waitForTimeout(300); };
  const role = async (p, r) => { await p.evaluate(x => document.querySelector('[data-role="' + x + '"]').click(), r); await p.waitForTimeout(250); };
  const docst = async (p, v) => { await p.evaluate(x => document.querySelector('[data-docst="' + x + '"]').click(), v); await p.waitForTimeout(300); };
  const active = p => p.evaluate(() => { const a = document.activeElement; return a === document.body ? 'BODY' : (a.getAttribute('data-ivp') || a.getAttribute('data-fl') || a.getAttribute('data-dv') || a.getAttribute('data-iv') || a.id || a.className || a.tagName); });
  const zoom = async (p, scope) => parseInt(await T(p, scope + ' .dv-z'), 10);
  const mainTop = p => p.evaluate(() => Math.round(document.querySelector('#ivp-root .ivp-main').scrollTop));
  const seen = (p, sel, inSel) => p.evaluate(([s, i]) => { const e = document.querySelector(s), c = document.querySelector(i); if (!e || !c) return null; const r = e.getBoundingClientRect(), k = c.getBoundingClientRect(); return r.top >= k.top - 1 && r.bottom <= k.bottom + 1 && r.height > 0; }, [sel, inSel]);

  // ================= a desk, 1440 =================
  let p = await open(1440, 900); await into(p, '#inv-page');

  // V4 / N8 (behaviour): the tag is one word in the margin and covers no print, on all four papers, also turned
  const tagClear = async () => p.evaluate(() => {
    const tg = document.querySelector('#ivp-root .sd-tag'); if (!tg) return { none: true };
    const t = tg.getBoundingClientRect(), hits = [];
    document.querySelectorAll('#ivp-root .sd-tb td, #ivp-root .sd-tb th, #ivp-root .sd-tot, #ivp-root .sd-meta, #ivp-root .sd-ft').forEach(c => { const r = c.getBoundingClientRect(); if (r.left < t.right - 1 && r.right > t.left + 1 && r.top < t.bottom - 1 && r.bottom > t.top + 1) hits.push(c.className + ':' + c.textContent.slice(0, 12)); });
    const cv = document.querySelector('#ivp-root .dv-cv').getBoundingClientRect();
    return { text: tg.textContent, hits, size: Math.round(parseFloat(getComputedStyle(tg).fontSize) * t.height / tg.offsetHeight * 10) / 10, inCanvas: t.right <= cv.right + 1 && t.left >= cv.left - 1 };
  });
  const tags = [];
  for (let i = 0; i < 4; i++) { tags.push(await tagClear()); await tap(p, '#ivp-root [data-dv="turn"]'); tags.push(await tagClear()); for (let j = 0; j < 3; j++) await tap(p, '#ivp-root [data-dv="turn"]'); if (i < 3) await tap(p, '#ivp-root [data-ivp="next"]'); }
  ok('V4 the tag reads "פער" and covers no print on any of the four papers, upright or turned', tags.every(t => t.text === 'פער' && t.hits.length === 0), tags);
  ok('V6 the tag keeps a readable size on the screen (12 px) and stays inside the canvas', tags.every(t => Math.abs(t.size - 12) < 1 && t.inCanvas), tags.map(t => [t.size, t.inCanvas]));
  for (let i = 0; i < 3; i++) await tap(p, '#ivp-root [data-ivp="prev"]');
  const mkW = await p.evaluate(() => { const m = document.querySelector('#ivp-root .sd-mk'); const k = parseFloat(getComputedStyle(m).getPropertyValue('--k')); const s = m.getBoundingClientRect().width / m.offsetWidth; return Math.round(2 * k * s * 100) / 100; });
  ok('V6 the outline of the mark is 2 px on the screen', Math.abs(mkW - 2) < .15, mkW);

  // N8 (words): the printed order number is never a SKU of the same paper
  const po = await p.evaluate(() => { const I = window.__INV; return I.invs.filter(x => x.lines).map(x => { const h = I.doc.sheet(x), n = (h.match(/PO-(\d+)/) || [])[1]; return [x.n, n, x.lines.some((l, i) => I.doc.sku(x, i) === n)]; }); });
  ok('N8w no printed order number equals a SKU on its paper', po.every(r => r[1] && !r[2]), po);

  // N10 (words) / V8: the pressed "fit" tool is ink
  const fit = await p.evaluate(() => { const b = document.querySelector('#ivp-root [data-dv="fit"]'); return [b.getAttribute('aria-pressed'), getComputedStyle(b).color, getComputedStyle(b.querySelector('svg')).color]; });
  ok('N10w the pressed "fit" icon has the button\'s ink, not a warning colour', fit[0] === 'true' && fit[1] === fit[2], fit);

  // N1 (behaviour): from the dialog's mark back to the card: the pane returns to its head and the focus is in sight
  await p.evaluate(() => { document.querySelector('#ivp-root .ivp-main').scrollTop = 260; }); await p.waitForTimeout(150);
  await tap(p, '#ivp-root [data-dv="full"]'); await tap(p, '.ivp-full .sd-mk');
  ok('N1b a press on the mark in the dialog closes it, returns the pane to its head and lands on a decision in sight',
    (await p.evaluate(() => document.querySelector('.ivp-full').hidden)) && (await mainTop(p)) === 0 && (await active(p)) === 'claim' && (await seen(p, '#ivp-root [data-ivp="claim"]', '#ivp-root .ivp-main')), [await mainTop(p), await active(p)]);

  // N4 (words): the keys are heard on the viewer's buttons and anywhere in the dialog
  await p.focus('#ivp-root [data-dv="in"]'); await p.keyboard.press('r'); await p.waitForTimeout(150);
  const rot1 = await p.evaluate(() => document.querySelector('#ivp-root .dv-sh').style.transform.includes('rotate(90deg)'));
  await p.keyboard.press('r'); await p.keyboard.press('r'); await p.keyboard.press('r'); await p.keyboard.press('+'); await p.waitForTimeout(150);
  const zb = await zoom(p, '#ivp-root'); await p.keyboard.press('0'); await p.waitForTimeout(100);
  ok('N4w R and + are heard with the focus on a tool of the viewer', rot1 && zb === 125 && (await zoom(p, '#ivp-root')) === 100, [rot1, zb]);
  await tap(p, '#ivp-root [data-dv="full"]'); const zf0 = await zoom(p, '.ivp-full'); await p.keyboard.press('+'); await p.waitForTimeout(150);
  ok('N4w + is heard in the dialog with the focus on "סגרו את המסמך"', (await active(p)) === 'close' && (await zoom(p, '.ivp-full')) === zf0 + 25, [await active(p), zf0, await zoom(p, '.ivp-full')]);
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);

  // N3 (behaviour): a trackpad pinch that doubles (the sum of deltaY is -69.3) doubles, at any speed; the buttons return to the grid
  const cr = await p.evaluate(() => { const r = document.querySelector('#ivp-root .dv-cv').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const pinch = async (n, total) => { await p.mouse.move(cr.x, cr.y); await p.keyboard.down('Control'); for (let i = 0; i < n; i++) { await p.mouse.wheel(0, total / n); await p.waitForTimeout(4); } await p.keyboard.up('Control'); await p.waitForTimeout(150); return zoom(p, '#ivp-root'); };
  const z16 = await pinch(16, -69.3); await tap(p, '#ivp-root [data-dv="fit"]');
  const z62 = await pinch(62, -69.3); await tap(p, '#ivp-root [data-dv="fit"]');
  const z200 = await pinch(200, -69.3);
  ok('N3b a pinch that doubles gives about 200% in 16, 62 and 200 events', [z16, z62, z200].every(z => Math.abs(z - 200) <= 3), [z16, z62, z200]);
  await pinch(10, 20); const zOff = await zoom(p, '#ivp-root'); await tap(p, '#ivp-root [data-dv="in"]'); const zUp = await zoom(p, '#ivp-root'); await tap(p, '#ivp-root [data-dv="out"]'); await tap(p, '#ivp-root [data-dv="out"]');
  ok('N3b after a pinch the buttons step to the quarters', zOff % 25 !== 0 && zUp % 25 === 0 && zUp > zOff && (await zoom(p, '#ivp-root')) === zUp - 50, [zOff, zUp, await zoom(p, '#ivp-root')]);
  await tap(p, '#ivp-root [data-dv="fit"]');

  // N2 (behaviour) / N5 (words): the pinned bar's button by keyboard
  await p.evaluate(() => { const m = document.querySelector('#ivp-root .ivp-main'); m.scrollTop = m.scrollHeight; }); await p.waitForTimeout(200);
  const before = await mainTop(p);
  await p.focus('#ivp-root [data-ivp="next"]'); await p.keyboard.press('Tab'); await p.waitForTimeout(200);
  const pin = await p.evaluate(() => { const bt = document.querySelector('#ivp-root .ivp-pin [data-ivp="top"]'), sp = document.querySelector('#ivp-root .ivp-pin > div > span'); return [bt.getAttribute('aria-label'), sp.getAttribute('aria-hidden'), document.querySelector('#ivp-root .ivp-pin').classList.contains('is-stuck')]; });
  ok('N2b Tab reaches the pinned button with no jump of the pane', (await active(p)) === 'top' && Math.abs((await mainTop(p)) - before) < 3 && pin[2], [await active(p), before, await mainTop(p)]);
  ok('N5w the pinned bar is said once: its words are hidden, its button is named', pin[0] === 'להחלטה על הפער' && pin[1] === 'true', pin);
  await p.keyboard.press('Enter'); await p.waitForTimeout(200);
  ok('N2b Enter on it lands on the decision at the head of the pane', (await mainTop(p)) === 0 && (await active(p)) === 'claim', [await mainTop(p), await active(p)]);

  // N6 (behaviour) / V2: nothing in the data pane scrolls sideways or is cut, at rest and with the divider at its stop
  const cut = () => p.evaluate(() => { const m = document.querySelector('#ivp-root .ivp-main'), w = document.querySelector('#ivp-root .tb-wrap'), g = document.querySelector('#ivp-root .ivp-tb td.ivp-g .money'), c = g.closest('td'); const gr = g.getBoundingClientRect(), cr = c.getBoundingClientRect(), mr = m.getBoundingClientRect(); return { main: m.offsetWidth, side: m.scrollWidth - m.clientWidth, wrap: w.scrollWidth - w.clientWidth, amtIn: gr.left >= cr.left - .5 && gr.right <= cr.right + .5 && gr.left >= mr.left - .5 }; });
  const c0 = await cut();
  await p.focus('#ivp-root .ivp-split'); await p.keyboard.press('End'); await p.waitForTimeout(200);
  const c1 = await cut(), sp = await p.evaluate(() => { const s = document.querySelector('#ivp-root .ivp-split'), g = document.querySelector('#ivp-root .ivp-grid'), d = document.querySelector('#ivp-root .ivp-side'); return [s.getAttribute('aria-valuenow'), s.getAttribute('aria-valuemax'), s.getAttribute('aria-valuetext'), Math.round(d.offsetWidth / g.offsetWidth * 100), s.getAttribute('title')]; });
  ok('N6b at rest: no sideways scroll in the data pane, the gap amount whole', c0.side <= 0 && c0.wrap <= 0 && c0.amtIn, c0);
  ok('V2 at the divider\'s stop the data pane keeps 448 px and the gap amount is whole', c1.main >= 448 && c1.side <= 0 && c1.wrap <= 0 && c1.amtIn, c1);
  ok('N5w the divider says its true place, with a unit, and what it is for', sp[0] === sp[1] && sp[2] === sp[0] + '%' && Math.abs(Number(sp[0]) - sp[3]) <= 1 && sp[4] === 'גררו לשינוי רוחב המסמך', sp);

  // V3: with a pane too narrow to read the page at fit width, the next invoice opens at a reading size on the gap line
  await p.keyboard.press('Home'); await p.waitForTimeout(200); await tap(p, '#ivp-root [data-ivp="next"]');
  const small = await p.evaluate(() => { const m = document.querySelector('#ivp-root .sd-mk').getBoundingClientRect(), c = document.querySelector('#ivp-root .dv-cv').getBoundingClientRect(); const td = document.querySelector('#ivp-root .sd-tb tbody td'); return { z: parseInt(document.querySelector('#ivp-root .dv-z').textContent, 10), markIn: m.top >= c.top && m.bottom <= c.bottom, print: Math.round(td.getBoundingClientRect().height / td.offsetHeight * 13 * 10) / 10 }; });
  ok('V3 a narrow document pane opens the next invoice enlarged, on the gap line, at a print of 8 px or more', small.z > 100 && small.markIn && small.print >= 8, small);
  await p.focus('#ivp-root .ivp-split'); await p.keyboard.press('Enter'); await p.waitForTimeout(200); await tap(p, '#ivp-root [data-ivp="prev"]');

  // N5 (behaviour): Tab from "ביטול" returns to the screen only when the decision sent the focus there
  await p.focus('#ivp-root [data-ivp="claim"]'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  await p.keyboard.press('Tab'); const a1 = await active(p); await p.keyboard.press('Tab'); const a2 = await active(p);
  await p.evaluate(() => document.querySelector('#inv-page .iv-toast [data-iv="undo"]').focus()); await p.keyboard.press('Tab'); await p.waitForTimeout(100); const a3 = await active(p);
  ok('N5b after a decision Tab reaches "ביטול" and then "שורות עם פער"; from "ביטול" reached otherwise Tab goes on in page order', a1 === 'undo' && a2 === 'gaps' && a3 !== 'gaps', [a1, a2, a3]);
  await p.evaluate(() => document.querySelector('#inv-page .iv-toast [data-iv="undo"]').click()); await p.waitForTimeout(300);

  // N9 (behaviour): a reason already typed stays when "שלמו כפי שחויב" is pressed inside the dialog
  await tap(p, '#ivp-root [data-ivp="pay"]'); await p.evaluate(() => [...document.querySelectorAll('#ivp-root .bx-ask .chip')].find(c => c.textContent === 'אחר').click()); await p.waitForTimeout(200);
  await p.fill('#ivp-other', 'סוכם עם הספק בטלפון'); await tap(p, '#ivp-root [data-dv="full"]'); await tap(p, '.ivp-full [data-ivp="pay"]');
  const kept = await p.evaluate(() => { const o = document.getElementById('ivp-other'); return [o ? o.value : null, document.activeElement === o, !document.querySelector('#ivp-root [data-ivp="other-ok"]').disabled]; });
  ok('N9b the typed reason is kept, with the focus in it and the button on', kept[0] === 'סוכם עם הספק בטלפון' && kept[1] && kept[2], kept);
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);

  // N9 (words): the pinned line is never cut, also once the gap is decided (the longest: ST-24108)
  await tap(p, '#ivp-root [data-ivp="next"]'); await tap(p, '#ivp-root [data-ivp="pay"]'); await p.evaluate(() => document.querySelector('#ivp-root .bx-ask .chip').click()); await p.waitForTimeout(300);
  await p.evaluate(() => { const m = document.querySelector('#ivp-root .ivp-main'); m.scrollTop = m.scrollHeight; }); await p.waitForTimeout(200);
  const pl = await p.evaluate(() => { const s = document.querySelector('#ivp-root .ivp-pin > div > span'), d = s.parentNode; return [s.textContent.replace(/\s+/g, ' ').trim(), s.scrollWidth <= s.clientWidth + 1, d.offsetHeight, getComputedStyle(s).textOverflow]; });
  ok('N9w the pinned line of a decided gap is whole and names no item', pl[0].startsWith('הפער: שולם כפי שחויב · ₪104.80 לפני מע״מ') && !pl[0].includes('בירה') && pl[1] && pl[3] !== 'ellipsis', pl);
  // N11 (words): the desk's decided row says whose result the amount is
  ok('N11w the desk\'s "הוחלט היום" row reads "הפער: שולם כפי שחויב"', await p.evaluate(() => [...document.querySelectorAll('#dk .row.done .res')].some(r => r.textContent.trim() === 'הפער: שולם כפי שחויב')), await p.evaluate(() => [...document.querySelectorAll('#dk .row.done .res')].map(r => r.textContent)));
  ok('V12 the desk\'s button has the same label as the invoice screen', /^בקשת זיכוי · ₪/.test((await T(p, '#dk-ev [data-dk="claim"]')) || ''), await T(p, '#dk-ev [data-dk="claim"]'));
  ok('no errors at 1440', p._errs.length === 0, p._errs); await p.context().close();

  // ================= a short window, the bookkeeper: the names of the columns stay =================
  p = await open(1280, 720); await into(p, '#inv-page'); await role(p, 'bookkeeper');
  await p.evaluate(() => { const m = document.querySelector('#ivp-root .ivp-main'), r = document.querySelector('#ivp-root .ivp-tb tbody tr:nth-child(7)'); m.scrollTop += r.getBoundingClientRect().top - m.getBoundingClientRect().top - m.clientHeight / 2; }); await p.waitForTimeout(250);
  const hd = await p.evaluate(() => { const m = document.querySelector('#ivp-root .ivp-main').getBoundingClientRect(), th = document.querySelector('#ivp-root .ivp-tb thead tr:last-child th').getBoundingClientRect(), pin = document.querySelector('#ivp-root .ivp-pin > div').getBoundingClientRect(), k = m.width / document.querySelector('#ivp-root .ivp-main').offsetWidth; const row = [...document.querySelectorAll('#ivp-root .ivp-tb tbody tr')].find(r => { const b = r.getBoundingClientRect(); return b.top < th.bottom && b.bottom > th.top; }); return { off: Math.round((th.top - m.top) / k), pinH: Math.round(pin.height / k), bg: getComputedStyle(document.querySelector('#ivp-root .ivp-tb thead tr:last-child th')).backgroundColor, under: !!row }; });
  ok('N10b all lines shown, pane scrolled: the head row stands under the pinned amount with a solid ground', hd.off >= hd.pinH - 2 && hd.off <= hd.pinH + 6 && hd.bg !== 'rgba(0, 0, 0, 0)', hd);
  ok('no errors at 1280', p._errs.length === 0, p._errs); await p.context().close();

  // ================= a phone =================
  for (const [w, h] of [[390, 844], [360, 740]]) {
    p = await open(w, h); await into(p, '#inv-page');
    // V9: the place among the invoices in short, whole to a screen reader
    const pos = await p.evaluate(() => { const e = document.querySelector('#ivp-root .ivp-pos'); return [e.textContent.replace(/\s+/g, ' ').trim(), e.innerText.replace(/\s+/g, ' ').trim(), e.scrollWidth <= e.clientWidth + 1]; });
    ok(w + ' V9 the place reads "1 מתוך 4" and is whole to a screen reader', pos[0] === 'חשבונית 1 מתוך 4 שנמצא בהן פער' && pos[2], pos);
    // V13: the three quantities on one row, the two prices on the next
    const rows = await p.evaluate(() => { const c = [...document.querySelectorAll('#ivp-root .ivp-tb tbody tr.is-hit td[data-l]')].map(t => [t.getAttribute('data-l'), Math.round(t.getBoundingClientRect().top), t.scrollWidth <= t.clientWidth + 1]); return c; });
    ok(w + ' V13 the three quantities share a row, the two prices the next, nothing cut', rows[0][1] === rows[1][1] && rows[1][1] === rows[2][1] && rows[3][1] === rows[4][1] && rows[3][1] > rows[2][1] && rows.every(r => r[2]), rows);
    // N7 (behaviour): the dock's caption of the longest item is whole (ST-24108)
    await tap(p, '#ivp-root [data-ivp="next"]');
    const dk = await p.evaluate(() => { const c = document.querySelector('#ivp-root .ivp-dock .dk-c'); return [c.textContent.replace(/\s+/g, ' ').trim(), c.scrollWidth <= c.clientWidth + 1, getComputedStyle(c).textOverflow]; });
    ok(w + ' N7b the dock names the whole item, "30" included', dk[0].includes('חבית 30') && dk[1] && dk[2] !== 'ellipsis', dk);
    await tap(p, '#ivp-root [data-ivp="prev"]');
    // V1 / N3 (words): without marks the document opens at a size it can be read at, from its head, the start edge in sight
    await docst(p, 'plain'); await into(p, '#ivp-root .ivp-win', 120); await tap(p, '#ivp-root .ivp-win');
    const pl = await p.evaluate(() => { const cv = document.querySelector('.ivp-full .dv-cv'), td = document.querySelector('.ivp-full .sd-tb tbody td'), co = document.querySelector('.ivp-full .sd-co b').getBoundingClientRect(), c = cv.getBoundingClientRect(); return { z: parseInt(document.querySelector('.ivp-full .dv-z').textContent, 10), top: cv.scrollTop, atStart: Math.abs(cv.scrollLeft - (cv.scrollWidth - cv.clientWidth)) < 2, print: Math.round(td.getBoundingClientRect().height / td.offsetHeight * 13 * 10) / 10, name: co.right <= c.right + 1 && co.left >= c.left - 1 && co.top >= c.top, line: document.querySelector('.ivp-full .fl-i').textContent.replace(/\s+/g, ' ').trim() }; });
    ok(w + ' V1 "בלי סימון": the dialog opens enlarged, at the head of the page, the supplier\'s name in sight, and says what to look for', pl.z >= 150 && pl.top === 0 && pl.atStart && pl.print >= 8.5 && pl.name && pl.line.startsWith('חפשו במסמך: עגבניות שרי, מק״ט'), pl);
    await tap(p, '.ivp-full [data-fl="close"]'); await docst(p, 'marks');
    // V14: on a phone the mark in the dialog gives a finger room
    await into(p, '#ivp-root .ivp-win', 120); await tap(p, '#ivp-root .ivp-win');
    const hit = await p.evaluate(() => { const m = document.querySelector('.ivp-full .sd-mk'), r = m.getBoundingClientRect(), b = getComputedStyle(m, '::before'); return Math.round(r.height + 24 * (r.height / m.offsetHeight)); });
    ok(w + ' V14 the mark in the dialog answers a finger over 40 px or more', hit >= 40, hit);
    await tap(p, '.ivp-full [data-fl="close"]');
    ok(w + ' no errors', p._errs.length === 0, p._errs); await p.context().close();
  }
  console.log(out.join('\n')); console.log('\n' + (out.length - fails) + ' of ' + out.length + ' pass');
  await b.close();
} catch (e) { console.log(out.join('\n')); console.log('STOPPED: ' + String(e).slice(0, 700)); if (b) await b.close(); process.exit(1); } })();
