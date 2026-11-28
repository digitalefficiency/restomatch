// Round 16: one check for each finding of the independent review that was fixed. Real pointer, touch and keyboard events.
// usage: node verify16.cjs
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const out = []; let fails = 0;
const ok = (name, cond, detail) => { out.push((cond ? 'ok   ' : 'FAIL ') + name + (cond || detail == null ? '' : '  → ' + JSON.stringify(detail))); if (!cond) fails++; };
(async () => { var b; try {
  b = await chromium.launch(require('./launch.cjs')());
  const page = fs.readFileSync(path.join(__dirname, '..', 'reference.html'), 'utf8');
  const file = path.join(require('./launch.cjs').outDir(), '_verify16.html');
  fs.writeFileSync(file, '<!doctype html><html lang="he" dir="rtl" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0">' + page + '</body></html>');
  const open = async (w, h, motion) => { const phone = w < 600; const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: phone, isMobile: phone }); const p = await ctx.newPage(); p._errs = []; p._phone = phone; p.on('pageerror', e => p._errs.push(e.message)); await p.emulateMedia({ reducedMotion: motion ? 'no-preference' : 'reduce' }); await p.goto('file://' + file); await p.waitForTimeout(1300); return p; };
  const into = async (p, sel, off) => { await p.evaluate(([s, o]) => { const r = document.querySelector(s).getBoundingClientRect(); window.scrollBy({ top: r.top - o, behavior: 'instant' }); }, [sel, off == null ? 64 : off]); await p.waitForTimeout(150); };
  const T = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }, sel);
  const tap = async (p, sel) => { const l = p.locator(sel).first(); if (p._phone) await l.tap(); else await l.click(); await p.waitForTimeout(300); };
  const role = async (p, r) => { await p.evaluate(x => document.querySelector('[data-role="' + x + '"]').click(), r); await p.waitForTimeout(250); };
  const docst = async (p, v) => { await p.evaluate(x => document.querySelector('[data-docst="' + x + '"]').click(), v); await p.waitForTimeout(300); };
  const active = p => p.evaluate(() => { const a = document.activeElement; return a === document.body ? 'BODY' : (a.getAttribute('data-ivp') || a.getAttribute('data-fl') || a.getAttribute('data-dv') || a.getAttribute('data-iv') || a.className || a.tagName); });
  const zoom = (p, scope) => T(p, scope + ' .dv-z');

  // ================= a desk =================
  let p = await open(1440, 900); await into(p, '#inv-page');
  // B1: the panes hand the wheel back to the page at their ends
  await p.evaluate(() => { const m = document.querySelector('#ivp-root .ivp-main'); m.scrollTop = m.scrollHeight; });
  const mr = await p.evaluate(() => { const r = document.querySelector('#ivp-root .ivp-main').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const y0 = await p.evaluate(() => scrollY); await p.mouse.move(mr.x, mr.y); await p.mouse.wheel(0, 400); await p.waitForTimeout(400);
  const y1 = await p.evaluate(() => scrollY);
  ok('B1 the wheel over the data pane, at its end, goes on to the page', y1 > y0 + 100, { y0, y1 });
  await into(p, '#inv-page'); await p.evaluate(() => { document.querySelector('#ivp-root .ivp-main').scrollTop = 0; const c = document.querySelector('#ivp-root .dv-cv'); c.scrollTop = c.scrollHeight; });
  const cr = await p.evaluate(() => { const r = document.querySelector('#ivp-root .dv-cv').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const y2 = await p.evaluate(() => scrollY); await p.mouse.move(cr.x, cr.y); await p.mouse.wheel(0, 400); await p.waitForTimeout(400);
  ok('B1 the wheel over the document, at its end, goes on to the page', (await p.evaluate(() => scrollY)) > y2 + 100);
  await into(p, '#inv-page'); await p.evaluate(() => { document.querySelector('#ivp-root .dv-cv').scrollTop = 0; });
  // W12 / B20: one picture, nothing of its print read twice, the mark a control beside it
  const a11y = await p.evaluate(() => { const pa = document.querySelector('#ivp-root .sd-paper'), mk = document.querySelector('#ivp-root .sd-mk'); return [pa.getAttribute('role'), pa.getAttribute('aria-label'), pa.querySelector('.sd-in').getAttribute('aria-hidden'), mk.tagName, !!mk.closest('[role="img"]'), document.querySelector('#ivp-root .dv-sh').getAttribute('role')]; });
  ok('W12 the document is one named picture, its print hidden from a screen reader, the mark a button outside it', a11y[0] === 'img' && a11y[1].includes('המסמך כפי שהגיע מירקות השרון') && a11y[2] === 'true' && a11y[3] === 'BUTTON' && a11y[4] === false && a11y[5] === null, a11y);
  // W6: the mark's name follows its state and the person
  const l1 = await p.evaluate(() => document.querySelector('#ivp-root .sd-mk').getAttribute('aria-label'));
  await role(p, 'bookkeeper'); const l2 = await p.evaluate(() => document.querySelector('#ivp-root .sd-mk').getAttribute('aria-label')); await role(p, 'owner');
  ok('W6 the mark is named by what it shows and what the person can do', l1 === 'פער בשורה של עגבניות שרי. לפרטים ולהחלטה' && l2 === 'פער בשורה של עגבניות שרי. לפרטי הפער', { l1, l2 });
  // W21: the viewer's keys are named
  const ks = await p.evaluate(() => ['out', 'in', 'fit', 'turn'].map(k => document.querySelector('#ivp-root [data-dv="' + k + '"]').getAttribute('aria-keyshortcuts')).join(' '));
  ok('W21 the viewer names its keys on the buttons', ks === '- Plus 0 R', ks);
  // W7 / W20: the printed terms agree with the due date; each supplier's document has its own numbers
  const terms = await p.evaluate(() => { const I = window.__INV, f = n => I.doc.sheet(I.invs.find(x => x.n === n)); const g = h => (h.match(/PO-\d+/) || [''])[0]; return [f('SH-24121').includes('שוטף'), g(f('ST-24108')), g(f('HK-24108')), g(f('MF-24108'))]; });
  ok('W7 the document no longer prints terms that disagree with its own due date', terms[0] === false);
  ok('W20 three suppliers, three order numbers', new Set(terms.slice(1)).size === 3, terms);
  // B12 / B2: a size button at its stop keeps the focus
  await p.locator('#ivp-root [data-dv="out"]').focus(); await p.keyboard.press('Enter'); await p.keyboard.press('Enter'); await p.keyboard.press('Enter'); await p.waitForTimeout(150);
  ok('B12 "הקטינו" at its stop keeps the focus and says it is off', (await zoom(p, '#ivp-root')) === '50%' && (await active(p)) === 'out' && await p.evaluate(() => document.activeElement.getAttribute('aria-disabled') === 'true'), [await zoom(p, '#ivp-root'), await active(p)]);
  await tap(p, '#ivp-root [data-dv="fit"]');
  // B5: a trackpad pinch (many small turns of the wheel with Ctrl) changes the size little by little
  await p.mouse.move(cr.x, cr.y); await p.keyboard.down('Control'); for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, -8); await p.waitForTimeout(20); } await p.keyboard.up('Control'); await p.waitForTimeout(150);
  const zp = parseInt(await zoom(p, '#ivp-root'), 10);
  /* six turns of 8 px are a pinch of exp(0.48): about 162% */
  ok('B5 six small Ctrl+wheel turns follow the pinch, not to the stop', zp > 150 && zp < 175, zp);
  await p.keyboard.down('Control'); await p.mouse.wheel(0, -100); await p.keyboard.up('Control'); await p.waitForTimeout(150);
  const zn = parseInt(await zoom(p, '#ivp-root'), 10);
  ok('B5 one wheel notch with Ctrl is one step, to the next quarter', zn === Math.floor(zp / 25) * 25 + 25, [zp, zn]);
  await tap(p, '#ivp-root [data-dv="fit"]');
  // B19: the tag stays upright after a quarter turn
  await tap(p, '#ivp-root [data-dv="turn"]');
  const tg = await p.evaluate(() => { const r = document.querySelector('#ivp-root .sd-tag').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
  ok('B19 after a quarter turn the tag still reads across', tg[0] > tg[1] * 1.5, tg);
  for (let i = 0; i < 3; i++) await tap(p, '#ivp-root [data-dv="turn"]');
  // B3: with motion off, the table and the document still answer each other with a sign that stays
  await tap(p, '#ivp-root [data-ivp="all"]');
  await p.evaluate(() => { const cv = document.querySelector('#ivp-root .dv-cv'), h = document.querySelector('#ivp-root .sd-hot[data-line="1"]'); cv.scrollTop += h.getBoundingClientRect().top - cv.getBoundingClientRect().top - 60; }); await p.waitForTimeout(100);
  await tap(p, '#ivp-root .sd-hot[data-line="1"]');
  const still = await p.evaluate(() => { const a = getComputedStyle(document.querySelector('#ivp-root .ivp-tb tr[data-i="1"] td')).backgroundColor, o = getComputedStyle(document.querySelector('#ivp-root .ivp-tb tr[data-i="2"] td')).backgroundColor; return [a, o]; });
  ok('B3 motion off: the pressed line\'s row is tinted', still[0] !== still[1], still);
  ok('W14 the announcement names the table', /השורה מסומנת בטבלה/.test(await T(p, '#inv-page .iv-live') || ''), await T(p, '#inv-page .iv-live'));
  await p.locator('#ivp-root .ivp-ln[data-i="8"]').focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(250);
  const stillDoc = await p.evaluate(() => { const h = document.querySelector('#ivp-root .sd-hot[data-line="8"]'); return getComputedStyle(h).boxShadow; });
  ok('B3 motion off: Enter on a row outlines its line on the document', stillDoc !== 'none', stillDoc);
  await p.waitForTimeout(1800);
  ok('B3 the sign goes after a moment', await p.evaluate(() => !document.querySelector('#ivp-root .ivp-tb tr.is-seek') && !document.querySelector('#ivp-root .sd-hot.is-flash')));
  // B11: the amount is pinned as soon as the card's numbers have left the pane
  await p.evaluate(() => { const m = document.querySelector('#ivp-root .ivp-main'), ev = document.querySelector('#ivp-root .bx-ev'); m.scrollTop = 0; m.scrollTop = ev.getBoundingClientRect().bottom - m.getBoundingClientRect().top + 14; }); await p.waitForTimeout(200);
  const pin = await p.evaluate(() => { const pn = document.querySelector('#ivp-root .ivp-pin'), bx = document.querySelector('#ivp-root .ivp-box').getBoundingClientRect(), m = document.querySelector('#ivp-root .ivp-main').getBoundingClientRect(); return [pn.classList.contains('is-stuck'), bx.bottom > m.top + 20]; });
  ok('B11 the amount is pinned while the foot of the card is still in the pane', pin[0] && pin[1], pin);
  await p.evaluate(() => { document.querySelector('#ivp-root .ivp-main').scrollTop = 0; }); await p.waitForTimeout(150);
  // B14: the divider keeps what the person looked at in the middle
  await tap(p, '#ivp-root [data-dv="in"]'); await tap(p, '#ivp-root [data-dv="in"]'); await tap(p, '#ivp-root [data-ivp="find"]');
  const off = () => p.evaluate(() => { const c = document.querySelector('#ivp-root .dv-cv').getBoundingClientRect(), m = document.querySelector('#ivp-root .sd-mk').getBoundingClientRect(); return Math.round((m.left + m.width / 2) - (c.left + c.width / 2)); });
  const c0 = await off(); await p.locator('#ivp-root .ivp-split').focus(); for (let i = 0; i < 6; i++) await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(200); const c1 = await off();
  ok('B14 moving the divider keeps the same place of the document in the middle', Math.abs(c1 - c0) <= 24, { c0, c1 });
  await p.keyboard.press('Enter'); await tap(p, '#ivp-root [data-dv="fit"]');
  // B4: "ביטול" is one Tab away after a decision
  await tap(p, '#ivp-root [data-ivp="pay"]'); await tap(p, '#ivp-root .bx-ask .chip');
  const af = await active(p); await p.keyboard.press('Tab'); await p.waitForTimeout(100); const u = await active(p);
  ok('B4 after a decision the next Tab is "ביטול"', (af === 'nextgap' || /ivp-box/.test(af)) && u === 'undo', { af, u });
  await p.keyboard.press('Shift+Tab'); await p.waitForTimeout(100);
  ok('B4 Shift+Tab goes back to where the focus was', (await active(p)) === af, await active(p));
  // W1: "paid as billed" beside the gap's amount says it is the gap's result
  const tag = await T(p, '#ivp-root .sd-mk .sd-tag');
  await p.evaluate(() => { const m = document.querySelector('#ivp-root .ivp-main'); m.scrollTop = m.scrollHeight; }); await p.waitForTimeout(200);
  const pinT = await T(p, '#ivp-root .ivp-pin');
  ok('W1 the tag and the pinned line say "הפער: שולם כפי שחויב"', !tag && pinT.startsWith('הפער: שולם כפי שחויב') && pinT.includes('38.70'), { tag, pinT });
  const l3 = await p.evaluate(() => document.querySelector('#ivp-root .sd-mk').getAttribute('aria-label'));
  ok('W6 a decided mark is named by its result', l3 === 'הפער: שולם כפי שחויב, בשורה של עגבניות שרי. לפרטים', l3);
  await p.evaluate(() => { document.querySelector('#ivp-root .ivp-main').scrollTop = 0; }); await tap(p, '#inv-page .iv-toast [data-iv="undo"]');
  // B2: the whole screen holds the focus and hears Escape wherever the focus fell
  await tap(p, '#ivp-root [data-dv="full"]');
  ok('B17 on the whole screen only the mark answers a press', await p.evaluate(() => document.querySelectorAll('.ivp-full .sd-hot').length === 0 && document.querySelector('.ivp-full .sd-mk').tagName === 'BUTTON'));
  const inert = await p.evaluate(() => [...document.body.children].filter(c => !c.classList.contains('ivp-full') && c.tagName !== 'SCRIPT' && c.tagName !== 'STYLE').every(c => c.hasAttribute('inert')));
  ok('B2 the page behind the whole screen is out of reach', inert);
  await p.locator('.ivp-full .fl-t').click(); await p.waitForTimeout(100);
  const inside = await p.evaluate(() => document.querySelector('.ivp-full').contains(document.activeElement));
  await p.keyboard.press('Shift+Tab'); await p.waitForTimeout(100);
  const inside2 = await p.evaluate(() => { const f = document.querySelector('.ivp-full'); return f.contains(document.activeElement) && document.activeElement !== f; });
  ok('B2 a press on the title keeps the focus inside, and Shift+Tab stays inside', inside && inside2, { inside, inside2 });
  await p.evaluate(() => document.activeElement.blur()); await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  ok('B2 Escape closes it even when nothing holds the focus', await p.evaluate(() => document.querySelector('.ivp-full').hidden));
  ok('B2 the page is back in reach', await p.evaluate(() => ![...document.body.children].some(c => c.hasAttribute('inert'))));
  // B6 / W4 / W10: the whole screen says which item, and what to look for when nothing is marked
  await tap(p, '#ivp-root [data-dv="full"]');
  const f1 = await T(p, '.ivp-full .fl-s');
  await p.keyboard.press('Escape'); await docst(p, 'plain'); await tap(p, '#ivp-root [data-dv="full"]');
  const f2 = await T(p, '.ivp-full .fl-s');
  ok('B6 the whole screen names the item', f1.startsWith('עגבניות שרי') && f1.includes('חויבו 9.5 ק״ג, התקבלו 6.5 ק״ג') && f1.includes('הפער ₪38.70 לפני מע״מ'), f1);
  ok('B6 unmarked, the whole screen says what to look for', f2.startsWith('חפשו במסמך: עגבניות שרי, מק״ט 10129.'), f2);
  const lines = await p.evaluate(() => [...document.querySelectorAll('.ivp-full .fl-s p')].map(e => e.textContent.replace(/\s+/g, ' ').trim().split(' ').length));
  ok('W10 each line under the document is twelve words or fewer', lines.every(n => n <= 12), lines);
  await p.keyboard.press('Escape'); await docst(p, 'marks');
  await tap(p, '#ivp-root [data-ivp="next"]'); await tap(p, '#ivp-root [data-dv="full"]');
  const f3 = await T(p, '.ivp-full .fl-g');
  ok('W10 a price gap under the document carries its VAT basis', f3.includes('₪575.00 במקום ₪522.60 לחבית, לפני מע״מ') && f3.includes('הפער ₪104.80 לפני מע״מ'), f3);
  await p.keyboard.press('Escape'); await tap(p, '#ivp-root [data-ivp="prev"]');
  ok('W11 the toolbar says what the file is, and pages only for a PDF', (await T(p, '#ivp-root .dv-kind')) === 'תמונה', await T(p, '#ivp-root .dv-kind'));
  ok('no errors at 1440', p._errs.length === 0, p._errs); await p.context().close();

  // B15: a tablet in the phone layout opens the whole screen at a size that fits it
  p = await open(768, 1024); await into(p, '#inv-page');
  await p.evaluate(() => document.querySelector('#ivp-root [data-ivp="full"]').click()); await p.waitForTimeout(400);
  ok('B15 at 768 wide the whole screen opens at 100%', (await zoom(p, '.ivp-full')) === '100%', await zoom(p, '.ivp-full'));
  await p.keyboard.press('Escape'); ok('no errors at 768', p._errs.length === 0, p._errs); await p.context().close();

  // ================= a phone =================
  for (const [w, h] of [[390, 844], [360, 740]]) {
    p = await open(w, h); await into(p, '#inv-page');
    // B8: the jump into an invoice lands on the screen itself
    await p.evaluate(() => { window.scrollTo({ top: 0, behavior: 'instant' }); window.__INV.focus('SH-24121', true); }); await p.waitForTimeout(500);
    const land = await p.evaluate(() => { const a = document.getElementById('inv-page').getBoundingClientRect(), t = document.querySelector('.toc'), w = document.querySelector('#ivp-root .ivp-win').getBoundingClientRect(), d = document.querySelector('#ivp-root .ivp-dock').getBoundingClientRect(); return { top: Math.round(a.top - (t ? t.getBoundingClientRect().bottom : 0)), winBottom: Math.round(w.bottom), dockTop: Math.round(d.top) }; });
    ok('B8 ' + w + 'x' + h + ': the jump lands on the screen, under the contents bar', land.top >= 0 && land.top <= 30, land);
    if (h >= 800) ok('B8 ' + w + 'x' + h + ': the window onto the document is clear of the docked decisions', land.winBottom <= land.dockTop + 2, land);
    // W13: the window's name contains its visible words
    const wn = await p.evaluate(() => { const b = document.querySelector('#ivp-root .ivp-win'); return [b.getAttribute('aria-label'), b.querySelector('.ivp-win-x').textContent.trim()]; });
    ok('W13 ' + w + ': the window is named by its visible words', wn[0].includes(wn[1]) && wn[1] === 'פתחו את המסמך', wn);
    // B7: the whole screen opens with the line's numbers in sight
    await tap(p, '#ivp-root .ivp-win');
    const cells = await p.evaluate(() => { const f = document.querySelector('.ivp-full'), c = f.querySelector('.dv-cv').getBoundingClientRect(), tds = f.querySelectorAll('tr[data-line="4"] td'); const vis = td => { const r = td.getBoundingClientRect(); return r.left >= c.left - 1 && r.right <= c.right + 1 && r.top >= c.top && r.bottom <= c.bottom; }; return { z: f.querySelector('.dv-z').textContent, qty: vis(tds[3]), price: vis(tds[5]), total: vis(tds[6]), nameLeft: Math.round(tds[2].getBoundingClientRect().left - c.left) }; });
    ok('B7 ' + w + 'x' + h + ': the whole screen shows the line\'s quantity, price and total', cells.qty && cells.price && cells.total, cells);
    // B16: from the mark, the page lands on the head of the gap's card
    await p.evaluate(() => document.querySelector('.ivp-full .sd-mk').click()); await p.waitForTimeout(350);
    const box = await p.evaluate(() => { const b = document.querySelector('#ivp-root .ivp-box').getBoundingClientRect(), t = document.querySelector('.toc'); return Math.round(b.top - (t ? t.getBoundingClientRect().bottom : 0)); });
    ok('B16 ' + w + 'x' + h + ': the mark leads to the head of the card, under the contents bar', box >= 4 && box <= 40, box);
    // a decision and the caption after it
    await tap(p, '#ivp-root .ivp-dock [data-ivp="claim"]');
    ok('W16 ' + w + ': after a decision the caption says the line that was decided', (await T(p, '#ivp-root .ivp-win-c')).includes('השורה שהוחלט עליה מסומנת'), await T(p, '#ivp-root .ivp-win-c'));
    await tap(p, '#inv-page .iv-toast [data-iv="undo"]');
    ok('no sideways scroll at ' + w, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    ok('no errors at ' + w, p._errs.length === 0, p._errs); await p.context().close();
  }
  // B15: words half typed into "הסיבה" survive a window that crosses between desk and phone widths
  p = await open(1000, 800); await into(p, '#inv-page');
  await tap(p, '#ivp-root [data-ivp="pay"]'); await p.evaluate(() => [...document.querySelectorAll('#ivp-root .bx-ask .chip')].find(c => c.textContent === 'אחר').click()); await p.waitForTimeout(200);
  await p.fill('#ivp-other', 'סיכום עם הספק'); await p.setViewportSize({ width: 820, height: 800 }); await p.waitForTimeout(700);
  ok('B15 the reason typed so far survives the change of layout', (await p.evaluate(() => { const o = document.getElementById('ivp-other'); return o ? o.value : null; })) === 'סיכום עם הספק');
  ok('no errors across the resize', p._errs.length === 0, p._errs); await p.context().close();
  // with motion on: the signs are animations and end on their own
  p = await open(1440, 900, true); await into(p, '#inv-page'); await tap(p, '#ivp-root [data-ivp="find"]');
  ok('motion on: "הציגו את השורה" flashes the mark', await p.evaluate(() => getComputedStyle(document.querySelector('#ivp-root .sd-mk')).animationName !== 'none'));
  ok('no errors with motion on', p._errs.length === 0, p._errs); await p.context().close();
  console.log(out.join('\n')); console.log('\n' + (out.length - fails) + ' of ' + out.length + ' pass');
  await b.close();
} catch (e) { console.log(out.join('\n')); console.log('STOPPED: ' + String(e).slice(0, 600)); if (b) await b.close(); process.exit(1); } })();
