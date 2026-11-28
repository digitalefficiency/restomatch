// Round 15: the invoice page shows the supplier's document itself. Real pointer, touch and keyboard events.
// usage: node verify15.cjs
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const out = []; let fails = 0;
const ok = (name, cond, detail) => { out.push((cond ? 'ok   ' : 'FAIL ') + name + (cond || detail == null ? '' : '  → ' + JSON.stringify(detail))); if (!cond) fails++; };
(async () => { var b; try {
  b = await chromium.launch(require('./launch.cjs')());
  const page = fs.readFileSync(path.join(__dirname, '..', 'reference.html'), 'utf8');
  const file = path.join(require('./launch.cjs').outDir(), '_verify15.html');
  fs.writeFileSync(file, '<!doctype html><html lang="he" dir="rtl" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0">' + page + '</body></html>');
  const open = async (w, h) => { const phone = w < 600; const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: phone, isMobile: phone }); const p = await ctx.newPage(); p._errs = []; p._phone = phone; p.on('pageerror', e => p._errs.push(e.message)); await p.emulateMedia({ reducedMotion: 'reduce' }); await p.goto('file://' + file); await p.waitForTimeout(1300); return p; };
  const into = async (p, sel, off) => { await p.evaluate(([s, o]) => { const r = document.querySelector(s).getBoundingClientRect(); window.scrollBy({ top: r.top - o, behavior: 'instant' }); }, [sel, off == null ? 64 : off]); await p.waitForTimeout(150); };
  const T = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }, sel);
  const tap = async (p, sel) => { const l = p.locator(sel).first(); if (p._phone) await l.tap(); else await l.click(); await p.waitForTimeout(300); };
  const role = async (p, r) => { await p.evaluate(x => document.querySelector('[data-role="' + x + '"]').click(), r); await p.waitForTimeout(250); };
  const docst = async (p, v) => { await p.evaluate(x => document.querySelector('[data-docst="' + x + '"]').click(), v); await p.waitForTimeout(300); };
  const active = p => p.evaluate(() => { const a = document.activeElement; return a === document.body ? 'BODY' : (a.getAttribute('data-ivp') || a.getAttribute('data-fl') || a.getAttribute('data-dv') || a.className || a.tagName); });
  // is the mark inside the visible part of its canvas?
  const markIn = (p, scope) => p.evaluate(s => { const cv = document.querySelector(s + ' .dv-cv'), m = document.querySelector(s + ' .sd-mk'); if (!cv || !m) return null; const c = cv.getBoundingClientRect(), r = m.getBoundingClientRect(); return { in: r.top >= c.top - 1 && r.bottom <= c.bottom + 1, top: Math.round(r.top - c.top), h: Math.round(c.height) }; }, scope);
  const zoom = (p, scope) => T(p, scope + ' .dv-z');

  // ================= a desk =================
  let p = await open(1440, 900); await into(p, '#inv-page');
  const lab = await p.evaluate(() => { const s = document.querySelector('#ivp-root .dv-sh .sd-paper'); return s ? [s.getAttribute('role'), s.getAttribute('aria-label')] : null; });
  ok('desk: the supplier document is on the page, named as an image', !!lab && lab[0] === 'img' && lab[1].includes('ירקות השרון') && lab[1].includes('SH-24121'), lab);
  ok('desk: the paper carries the supplier, the number and the gap line as printed', await p.evaluate(() => { const s = document.querySelector('#ivp-root .sd'); return !!s && s.textContent.includes('חשבונית מס') && s.textContent.includes('עגבניות שרי') && s.textContent.includes('122.55'); }));
  const wide = await p.evaluate(() => { const d = document.querySelector('#ivp-root .ivp-side').getBoundingClientRect(), m = document.querySelector('#ivp-root .ivp-main').getBoundingClientRect(); return [Math.round(d.width), Math.round(m.width), d.right <= m.left + 2]; });
  ok('desk: the document takes the larger share of the width, at the end edge (left)', wide[0] >= 560 && wide[0] / (wide[0] + wide[1]) > .54 && wide[2], wide);
  let mi = await markIn(p, '#ivp-root'); ok('desk 1440x900: the marked line is in sight on opening', !!mi && mi.in, mi);
  ok('desk: the mark says where the gap is', (await T(p, '#ivp-root .sd-mk .sd-tag')) === 'פער', await T(p, '#ivp-root .sd-mk .sd-tag'));
  // the viewer's own controls
  await tap(p, '#ivp-root [data-dv="in"]'); await tap(p, '#ivp-root [data-dv="in"]');
  ok('viewer: two presses on "הגדלה" give 150%', (await zoom(p, '#ivp-root')) === '150%', await zoom(p, '#ivp-root'));
  await role(p, 'manager'); await role(p, 'owner');
  ok('viewer: the size is kept when the screen repaints around it', (await zoom(p, '#ivp-root')) === '150%', await zoom(p, '#ivp-root'));
  await tap(p, '#ivp-root [data-dv="fit"]');
  ok('viewer: "התאמה לרוחב" goes back to 100% and is marked as on', (await zoom(p, '#ivp-root')) === '100%' && await p.evaluate(() => document.querySelector('#ivp-root [data-dv="fit"]').getAttribute('aria-pressed') === 'true'));
  for (let i = 0; i < 2; i++) await tap(p, '#ivp-root [data-dv="out"]');
  ok('viewer: the size stops at 50% and the button dims', (await zoom(p, '#ivp-root')) === '50%' && await p.evaluate(() => document.querySelector('#ivp-root [data-dv="out"]').getAttribute('aria-disabled') === 'true'), await zoom(p, '#ivp-root'));
  await p.locator('#ivp-root .dv-cv').focus(); await p.keyboard.press('0'); await p.keyboard.press('+'); await p.waitForTimeout(150);
  ok('viewer keys: 0 fits, + enlarges', (await zoom(p, '#ivp-root')) === '125%', await zoom(p, '#ivp-root'));
  await p.keyboard.press('-'); await p.keyboard.press('KeyR'); await p.waitForTimeout(200);
  const turned = await p.evaluate(() => { const s = document.querySelector('#ivp-root .dv-sz'); return [s.offsetWidth, s.offsetHeight]; });
  ok('viewer keys: R turns the paper a quarter turn', turned[0] > turned[1], turned);
  for (let i = 0; i < 3; i++) await p.keyboard.press('KeyR'); await p.waitForTimeout(200);
  // the data and the paper point at each other
  await tap(p, '#ivp-root [data-ivp="find"]');
  mi = await markIn(p, '#ivp-root');
  ok('"הציגו את השורה" enlarges to 125% with the marked line in the middle', (await zoom(p, '#ivp-root')) === '125%' && !!mi && mi.in && Math.abs(mi.top - mi.h / 2) < mi.h * .3, { z: await zoom(p, '#ivp-root'), mi });
  await tap(p, '#ivp-root [data-dv="fit"]');
  ok('desk: the lines open on the gap line alone, with the way to all of them', await p.evaluate(() => document.querySelectorAll('#ivp-root .ivp-tb tbody tr').length === 1 && !!document.querySelector('#ivp-root [data-ivp="all"]')));
  await tap(p, '#ivp-root [data-ivp="all"]');
  await p.evaluate(() => { document.querySelector('#ivp-root .dv-cv').scrollTop = 0; document.querySelector('#ivp-root .ivp-ln[data-i="10"]').scrollIntoView({ block: 'center' }); }); await tap(p, '#ivp-root .ivp-ln[data-i="10"]');
  const seen = await p.evaluate(() => { const cv = document.querySelector('#ivp-root .dv-cv').getBoundingClientRect(), h = document.querySelector('#ivp-root .sd-hot[data-line="10"]').getBoundingClientRect(); return h.top >= cv.top && h.bottom <= cv.bottom; });
  ok('a press on a row of the table brings its line into sight on the paper', seen);
  await p.evaluate(() => { document.querySelector('#ivp-root .ivp-main').scrollTop = 0; });
  await p.evaluate(() => { const cv = document.querySelector('#ivp-root .dv-cv'); const h = document.querySelector('#ivp-root .sd-hot[data-line="1"]'); const r = h.getBoundingClientRect(), c = cv.getBoundingClientRect(); cv.scrollTop += r.top - c.top - 60; }); await p.waitForTimeout(100);
  await tap(p, '#ivp-root .sd-hot[data-line="1"]');
  ok('a press on a line of the paper marks its row in the table', await p.evaluate(() => document.querySelector('#ivp-root .ivp-tb tr[data-i="1"]').classList.contains('is-seek')));
  await p.evaluate(() => { const cv = document.querySelector('#ivp-root .dv-cv'); const m = document.querySelector('#ivp-root .sd-mk'); const r = m.getBoundingClientRect(), c = cv.getBoundingClientRect(); cv.scrollTop += r.top - c.top - 80; }); await p.waitForTimeout(100);
  await tap(p, '#ivp-root .sd-mk');
  ok('a press on the mark goes to the decision', (await active(p)) === 'claim', await active(p));
  const pay = await p.evaluate(() => { const e = document.querySelector('#ivp-root .ivp-pay'); return e ? e.textContent.replace(/\s+/g, ' ') : ''; });
  ok('the payment block says the pay run\'s own word and what the decision releases', pay.includes('בהשהיה') && pay.includes('ההחלטה על הפער תשחרר את החשבונית לתשלום') && pay.includes('לתשלום עד') && pay.includes('כולל מע״מ'), pay.slice(0, 160));
  const pair = await p.evaluate(() => { const e = document.querySelector('#ivp-root .bx-pair'); return e ? e.textContent.replace(/\s+/g, ' ') : ''; });
  ok('the two numbers that disagree stand together, with the difference named', pair.includes('התקבל') && pair.includes('6.5') && pair.includes('חויב') && pair.includes('9.5') && pair.includes('חויבו 3 ק״ג יותר'), pair);
  // the divider
  await p.locator('#ivp-root .ivp-split').focus(); const w0 = await p.evaluate(() => document.querySelector('#ivp-root .ivp-side').offsetWidth);
  await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight'); await p.waitForTimeout(150);
  const w1 = await p.evaluate(() => [document.querySelector('#ivp-root .ivp-side').offsetWidth, document.querySelector('#ivp-root .ivp-split').getAttribute('aria-valuenow')]);
  const mx = await p.evaluate(() => { const g = document.querySelector('#ivp-root .ivp-grid'); return String(Math.min(62, Math.floor((g.offsetWidth - 468) / g.offsetWidth * 100))); });   /* the stop is where the data pane reaches its floor of 448 px */
  ok('the divider moves with the arrows and says its place', w1[0] > w0 && w1[1] === mx, { w0, w1, mx });
  await p.keyboard.press('End'); await p.keyboard.press('ArrowRight'); const vEnd = await p.evaluate(() => document.querySelector('#ivp-root .ivp-split').getAttribute('aria-valuenow'));
  await p.keyboard.press('Home'); const vHome = await p.evaluate(() => document.querySelector('#ivp-root .ivp-split').getAttribute('aria-valuenow'));
  await p.keyboard.press('Enter'); const vMid = await p.evaluate(() => document.querySelector('#ivp-root .ivp-split').getAttribute('aria-valuenow'));
  ok('the divider stops at 34 and at the data pane\'s floor, and Enter puts it back at its resting place', vEnd === mx && vHome === '34' && vMid === '58', [vEnd, vHome, vMid, mx]);
  const box = await p.evaluate(() => { const r = document.querySelector('#ivp-root .ivp-split').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 80 }; });
  await p.mouse.move(box.x, box.y); await p.mouse.down(); await p.mouse.move(box.x - 90, box.y, { steps: 5 }); await p.mouse.up(); await p.waitForTimeout(150);
  const dragged = await p.evaluate(() => Number(document.querySelector('#ivp-root .ivp-split').getAttribute('aria-valuenow')));
  ok('the divider is dragged with the pointer', dragged < 56 && dragged >= 34, dragged);
  await p.locator('#ivp-root .ivp-split').dblclick(); await p.waitForTimeout(150);
  // the amount stays pinned when the card scrolls away
  await p.evaluate(() => { const m = document.querySelector('#ivp-root .ivp-main'); m.scrollTop = 600; }); await p.waitForTimeout(200);
  const pin = await p.evaluate(() => { const e = document.querySelector('#ivp-root .ivp-pin'); return [e.classList.contains('is-stuck'), e.textContent.replace(/\s+/g, ' ').trim()]; });
  ok('scrolled data: the gap and its amount stay pinned, with the way back', pin[0] && pin[1].includes('38.70') && pin[1].includes('לפני מע״מ') && pin[1].includes('להחלטה'), pin);
  await tap(p, '#ivp-root [data-ivp="top"]');
  ok('"להחלטה" goes back to the card and the decision', (await p.evaluate(() => document.querySelector('#ivp-root .ivp-main').scrollTop)) === 0 && (await active(p)) === 'claim', await active(p));
  // a decision: the mark turns calm and says the result; undo brings it back
  await tap(p, '#ivp-root [data-ivp="claim"]');
  const done = await p.evaluate(() => { const m = document.querySelector('#ivp-root .sd-mk'); return [m.classList.contains('is-done'), m.textContent.trim()]; });
  ok('after "בקשת זיכוי" the mark on the paper is calm and carries no tag', done[0] && done[1] === '', done);
  await tap(p, '#inv-page .iv-toast [data-iv="undo"]');
  ok('after "ביטול" the mark is the gap again', await p.evaluate(() => { const m = document.querySelector('#ivp-root .sd-mk'); return m.classList.contains('is-block') && m.textContent.trim() === 'פער'; }));
  // the next invoice: another paper, the size starts over
  await tap(p, '#ivp-root [data-dv="in"]'); await tap(p, '#ivp-root [data-ivp="next"]');
  const nx = await p.evaluate(() => [document.querySelector('#ivp-root .dv-z').textContent, document.querySelector('#ivp-root .dv-kind').textContent, document.querySelector('#ivp-root .sd').textContent.includes('משקאות שטיינברג')]);
  ok('the next invoice shows its own paper, at 100%, and says what kind of file it is', nx[0] === '100%' && nx[1].includes('PDF') && nx[2], nx);
  ok('a price gap: the card sets the expected price beside the invoice price', await p.evaluate(() => { const t = document.querySelector('#ivp-root .bx-cmp').textContent; return t.includes('מחיר צפוי') && t.includes('522.60') && t.includes('מחיר בחשבונית') && t.includes('575.00'); }));
  await tap(p, '#ivp-root [data-ivp="prev"]');
  // the paper on the whole screen
  await tap(p, '#ivp-root [data-dv="full"]');
  const dlg = await p.evaluate(() => { const f = document.querySelector('.ivp-full'); return f && !f.hidden ? [f.getAttribute('role'), f.getAttribute('aria-modal'), f.contains(document.activeElement), f.querySelectorAll('.fl-act .btn').length, getComputedStyle(f).position] : null; });
  ok('"מסך מלא" opens the paper as a dialog over the page, the focus inside, the decision under it', !!dlg && dlg[0] === 'dialog' && dlg[1] === 'true' && dlg[2] && dlg[3] === 2 && dlg[4] === 'fixed', dlg);
  mi = await markIn(p, '.ivp-full'); ok('whole screen: the marked line is in sight', !!mi && mi.in, mi);
  const sheetW = await p.evaluate(() => document.querySelector('.ivp-full .dv-sz').offsetWidth);
  ok('whole screen at a desk: the paper is as wide as a page is read at, not as the window', sheetW >= 700 && sheetW <= 1200, sheetW);
  for (let i = 0; i < 12; i++) await p.keyboard.press('Tab');
  ok('whole screen: Tab stays inside', await p.evaluate(() => document.querySelector('.ivp-full').contains(document.activeElement)));
  await p.keyboard.press('BracketRight'); await p.waitForTimeout(150);
  ok('whole screen: ] does not move to another invoice behind it', (await T(p, '#ivp-root h1')).includes('SH-24121'));
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  ok('Escape closes it and the focus returns to the button that opened it', await p.evaluate(() => document.querySelector('.ivp-full').hidden) && (await active(p)) === 'full', await active(p));
  await tap(p, '#ivp-root [data-dv="full"]'); await tap(p, '.ivp-full [data-ivp="claim"]');
  ok('a decision from the whole screen closes it and is made', await p.evaluate(() => document.querySelector('.ivp-full').hidden && !!document.querySelector('#ivp-root .bx-done')));
  await tap(p, '#inv-page .iv-toast [data-iv="undo"]');
  await role(p, 'bookkeeper'); await tap(p, '#ivp-root [data-dv="full"]');
  ok('whole screen for a role that may not decide: no buttons, one sentence', await p.evaluate(() => { const f = document.querySelector('.ivp-full'); return f.querySelectorAll('.fl-act .btn').length === 0 && f.querySelector('.fl-w').textContent.includes('אצל הבעלים'); }));
  await p.keyboard.press('Escape'); await role(p, 'owner');
  // the three states of a document
  await docst(p, 'plain');
  const plain = await p.evaluate(() => [document.querySelectorAll('#ivp-root .sd-mk').length, !!document.querySelector('#ivp-root .sd'), document.querySelector('#ivp-root .ivp-find').textContent.replace(/\s+/g, ' ').trim(), !!document.querySelector('#ivp-root [data-ivp="find"]'), document.querySelectorAll('#ivp-root .ivp-ln').length]);
  ok('"בלי סימון": the paper is shown as it is, nothing marked, and the page says what to look for', plain[0] === 0 && plain[1] && plain[2].includes('חפשו') && plain[2].includes('עגבניות שרי') && plain[2].includes('10129') && !plain[3] && plain[4] === 0, plain);
  await docst(p, 'none');
  const none = await p.evaluate(() => [!!document.querySelector('#ivp-root .dv'), (document.querySelector('#ivp-root .ivp-nodoc') || {}).textContent, !!document.querySelector('#ivp-root .ivp-box'), document.querySelectorAll('#ivp-root .ivp-tb tbody tr').length]);
  ok('"בלי קובץ": one quiet line, and the data takes the width', !none[0] && /אין קובץ מצורף/.test(none[1] || '') && none[2] && none[3] >= 1, none);
  await docst(p, 'marks');
  ok('back to "עם סימון": the mark is there again', (await p.evaluate(() => document.querySelectorAll('#ivp-root .sd-mk').length)) === 1);
  ok('no sideways scroll of the page at 1440', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  ok('no errors at 1440', p._errs.length === 0, p._errs); await p.context().close();

  // a short laptop
  for (const [w, h] of [[1280, 720], [1366, 768], [1024, 768]]) {
    p = await open(w, h); await into(p, '#inv-page');
    mi = await markIn(p, '#ivp-root');
    const fit = await p.evaluate(() => { const a = document.getElementById('inv-page').getBoundingClientRect(), b = document.querySelector('#ivp-root [data-ivp="claim"]').getBoundingClientRect(); return [Math.round(a.bottom), Math.round(b.bottom)]; });
    ok('at ' + w + 'x' + h + ': the marked line and the decision are both on the first screen', !!mi && mi.in && fit[1] <= h, { mi, fit });
    ok('no errors at ' + w, p._errs.length === 0, p._errs); await p.context().close();
  }

  // ================= a phone =================
  p = await open(390, 844); await into(p, '#inv-page');
  const win = await p.evaluate(() => { const w = document.querySelector('#ivp-root .ivp-win'), m = w && w.querySelector('.sd-mk'); if (!w || !m) return null; const a = w.getBoundingClientRect(), r = m.getBoundingClientRect(); return { h: Math.round(a.height), in: r.top >= a.top && r.bottom <= a.bottom, t: w.querySelector('.ivp-win-x').textContent.trim() }; });
  ok('phone: a window onto the paper shows the marked line, and says how to open it', !!win && win.in && win.h >= 120 && win.t === 'פתחו את המסמך', win);
  const dock = await p.evaluate(() => { const d = document.querySelector('#ivp-root .ivp-dock'); if (!d) return null; const r = d.getBoundingClientRect(), bs = [...d.querySelectorAll('.btn')].map(x => Math.round(x.getBoundingClientRect().height)); return { bottom: Math.round(r.bottom), bs, n: document.querySelectorAll('#ivp-root [data-ivp="claim"]').length, sw: document.documentElement.scrollWidth }; });
  ok('phone: the two decisions are docked at the foot of the screen, 44 px or more, once', !!dock && dock.bottom <= 845 && dock.bottom >= 820 && dock.bs.length === 2 && dock.bs.every(v => v >= 44) && dock.n === 1, dock);
  await tap(p, '#ivp-root .ivp-win');
  const fz = await p.evaluate(() => { const f = document.querySelector('.ivp-full'); return f && !f.hidden ? [f.querySelector('.dv-z').textContent, f.querySelectorAll('.fl-act .btn').length, [...f.querySelectorAll('.fl-act .btn, .fl-h .rm-ico, .dv-bar .rm-ico')].every(x => x.getBoundingClientRect().height >= 44)] : null; });
  mi = await markIn(p, '.ivp-full');
  ok('phone: a tap opens the paper on the whole screen, enlarged on the marked line, the decision under it', !!fz && fz[0] === '150%' && fz[1] === 2 && !!mi && mi.in, { fz, mi });
  ok('phone whole screen: every control is 44 px or more', !!fz && fz[2]);
  await tap(p, '.ivp-full [data-fl="close"]');
  ok('phone: closing returns to the window', (await active(p)) === 'full', await active(p));
  await tap(p, '#ivp-root .ivp-dock [data-ivp="pay"]');
  const ask = await p.evaluate(() => { const a = document.querySelector('#ivp-root .bx-ask'); if (!a) return null; const r = a.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), dock: !!document.querySelector('#ivp-root .ivp-dock') }; });
  ok('phone: "שלמו כפי שחויב" brings the question into sight, and the dock steps aside', !!ask && ask.top >= 56 && ask.bottom <= 844 && !ask.dock, ask);
  await tap(p, '#ivp-root .bx-ask .chip');
  ok('phone: a reason decides, and the dock is gone', await p.evaluate(() => !!document.querySelector('#ivp-root .bx-done') && !document.querySelector('#ivp-root .ivp-dock')));
  await tap(p, '#inv-page .iv-toast [data-iv="undo"]');
  ok('phone: after "ביטול" the dock is back', await p.evaluate(() => !!document.querySelector('#ivp-root .ivp-dock')));
  await docst(p, 'plain');
  const pw = await p.evaluate(() => [document.querySelectorAll('#ivp-root .ivp-win .sd-mk').length, document.querySelector('#ivp-root .ivp-win-c').textContent.replace(/\s+/g, ' ')]);
  ok('phone "בלי סימון": the window shows the head of the page, and the caption says what to look for', pw[0] === 0 && pw[1].includes('חפשו') && pw[1].includes('10129'), pw);
  await tap(p, '#ivp-root [data-ivp="next"]');
  ok('phone "בלי סימון", a PDF: the same window, as for a picture', await p.evaluate(() => !!document.querySelector('#ivp-root .ivp-win') && !document.querySelector('#ivp-root .ivp-tile') && document.querySelector('#ivp-root .ivp-win-c').textContent.includes('PDF')));
  await tap(p, '#ivp-root [data-ivp="prev"]');
  await docst(p, 'none');
  ok('phone "בלי קובץ": no window, one quiet line', await p.evaluate(() => !document.querySelector('#ivp-root .ivp-win') && /אין קובץ מצורף/.test(document.querySelector('#ivp-root .ivp-nodoc').textContent)));
  await docst(p, 'marks');
  ok('no sideways scroll of the page at 390', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  ok('no errors at 390', p._errs.length === 0, p._errs); await p.context().close();
  p = await open(360, 740); await into(p, '#inv-page');
  ok('no sideways scroll of the page at 360', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), await p.evaluate(() => document.documentElement.scrollWidth));
  ok('no errors at 360', p._errs.length === 0, p._errs); await p.context().close();
  console.log(out.join('\n')); console.log('\n' + (out.length - fails) + ' of ' + out.length + ' pass');
  await b.close();
} catch (e) { console.log(out.join('\n')); console.log('STOPPED: ' + String(e).slice(0, 500)); if (b) await b.close(); process.exit(1); } })();
