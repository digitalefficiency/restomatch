// Round 14: checks for the confirmation pass, lenses "behaviour" and "visual". Real pointer and keyboard events.
// usage: node verify14.cjs
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const out = []; let fails = 0;
const ok = (name, cond, detail) => { out.push((cond ? 'ok   ' : 'FAIL ') + name + (cond || detail == null ? '' : '  → ' + JSON.stringify(detail))); if (!cond) fails++; };
(async () => { var b; try {
  b = await chromium.launch(require('./launch.cjs')());
  const page = fs.readFileSync(path.join(__dirname, '..', 'reference.html'), 'utf8');
  const file = path.join(require('./launch.cjs').outDir(), '_verify14.html');
  fs.writeFileSync(file, '<!doctype html><html lang="he" dir="rtl" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0">' + page + '</body></html>');
  const open = async (w, h) => { const phone = w < 600; const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: phone, isMobile: phone }); const p = await ctx.newPage(); p._errs = []; p._phone = phone; p.on('pageerror', e => p._errs.push(e.message)); await p.emulateMedia({ reducedMotion: 'reduce' }); await p.goto('file://' + file); await p.waitForTimeout(1300); return p; };
  const into = async (p, sel, off) => { await p.evaluate(([s, o]) => { const r = document.querySelector(s).getBoundingClientRect(); window.scrollBy({ top: r.top - o, behavior: 'instant' }); }, [sel, off == null ? 90 : off]); await p.waitForTimeout(120); };
  const rect = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); if (!e || e.hidden || !e.offsetParent) return null; const r = e.getBoundingClientRect(); return { t: Math.round(r.top), b: Math.round(r.bottom), l: Math.round(r.left), r: Math.round(r.right) }; }, sel);
  const T = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }, sel);
  const active = p => p.evaluate(() => { const a = document.activeElement; return a === document.body ? 'BODY' : (a.id ? '#' + a.id : a.tagName + '.' + String(a.className).split(' ')[0] + (a.getAttribute('data-dk') ? '[' + a.getAttribute('data-dk') + ']' : '')); });
  const tap = async (p, sel) => { const l = p.locator(sel).first(); if (p._phone) await l.tap(); else await l.click(); await p.waitForTimeout(300); };

  // ---- BH1: a phone opens with the count that matches the eight rows
  let p = await open(390, 844);
  ok('phone, first load: the count line says eight of 37', (await T(p, '#reg-root .reg-cnt')) === 'מוצגות 8 מתוך 37', await T(p, '#reg-root .reg-cnt'));
  // ---- BH5: narrow desk, the focus after a decision and after its undo
  await into(p, '#inv-desk');
  await p.evaluate(() => { const bar = document.querySelector('#dk-ev .ev-bar').getBoundingClientRect(); window.scrollBy({ top: bar.bottom - innerHeight + 4, behavior: 'instant' }); }); await p.waitForTimeout(150);
  await tap(p, '#dk-ev [data-dk="claim"]');
  ok('phone desk: after a decision the focus is not on the page body', (await active(p)) !== 'BODY', await active(p));
  await tap(p, '#inv-desk .iv-toast [data-iv="undo"]');
  ok('phone desk: after "ביטול" the focus is not on the page body', (await active(p)) !== 'BODY', await active(p));
  // ---- C05: the owner's who line on a manager's gap keeps its sentence together
  await p.evaluate(() => { for (let i = 0; i < 2; i++) document.querySelector('#dk-ev [data-dk="down"]').click(); }); await p.waitForTimeout(250);
  const who = await p.evaluate(() => { const s = document.querySelector('#dk-ev .dk-who > span:not(.dk-also)'); return s ? [Math.round(s.getBoundingClientRect().width), document.querySelector('#dk-ev .dk-who').textContent.includes('אצל הניהול')] : null; });
  ok('phone desk: the who sentence of a manager\'s gap is at least 240 px wide', !!who && who[1] && who[0] >= 240, who);
  // ---- C03: everything decided on a phone: the message is clear of "הכול מטופל"
  for (let i = 0; i < 4; i++) { await p.evaluate(() => { const c = document.querySelector('#dk-ev [data-dk="claim"]'); if (c) c.click(); }); await p.waitForTimeout(200); }
  const em = await rect(p, '#dk-ev .ev-empty span:last-child'), ts = await rect(p, '#inv-desk .iv-toast');
  ok('phone desk: the message does not cover "הכול מטופל"', !!em && !!ts && (ts.t >= em.b || ts.b <= em.t), { em, ts });
  // ---- C04: the decided line on the invoice page keeps its result on one line
  const bd = await p.evaluate(() => { const e = document.querySelector('#ivp-root .bx-done b'); return e ? Math.round(e.getBoundingClientRect().height) : 0; });
  ok('phone invoice page: the result of a decision is one line', bd > 0 && bd <= 24, bd);
  ok('no errors on the phone', p._errs.length === 0, p._errs); await p.context().close();

  // ---- BH2 / C01: "להחלטה" keeps the decision on screen on a laptop
  for (const [w, h] of [[1280, 800], [1440, 780], [1366, 768], [1280, 720]]) {
    p = await open(w, h); await into(p, '#inv-reg');
    await tap(p, '#reg-root [data-reg="first"]'); await p.waitForTimeout(250);
    const bt = await rect(p, '#dk-ev [data-dk="claim"]');
    ok('"להחלטה" at ' + w + 'x' + h + ': the decision is on screen', !!bt && bt.t >= 60 && bt.b <= h, bt); await p.context().close();
  }
  p = await open(1440, 900);
  // ---- BH3: the side menu's links land on the screen
  await into(p, '#inv-reg');
  await p.evaluate(() => { const a = [...document.querySelectorAll('#inv-reg .rm-side a[href="#payrun"]')][0]; if (a) a.click(); else { document.querySelector('#inv-reg .rm-side [data-g="money"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); } }); await p.waitForTimeout(300);
  let had = await p.evaluate(() => !!document.querySelector('#inv-reg .rm-side a[href="#payrun"], #inv-reg .mn-fly a[href="#payrun"], #inv-reg a[href="#payrun"]'));
  if (had) { await p.evaluate(() => { const a = document.querySelector('#inv-reg a[href="#payrun"]'); a.click(); }); await p.waitForTimeout(350); }
  const pr = await rect(p, '#inv-pay');
  ok('the menu\'s "ריצת תשלומים" lands on the pay run screen', had && !!pr && pr.t > 40 && pr.t < 260, { had, pr });
  // ---- BH4: [ and ] with the pointer on the invoice and no focus in it
  await into(p, '#inv-page');
  await p.mouse.move(700, 500); await p.evaluate(() => { if (document.activeElement) document.activeElement.blur(); }); await p.waitForTimeout(100);
  await p.keyboard.press('BracketRight'); await p.waitForTimeout(150);
  const h2 = await T(p, '#ivp-root h1');
  await p.keyboard.press('BracketLeft'); await p.waitForTimeout(150);
  const h1 = await T(p, '#ivp-root h1');
  await p.keyboard.press('BracketLeft'); await p.waitForTimeout(150);
  ok('[ and ] work with the pointer on the invoice and nothing focused', h2.includes('ST-24108') && h1.includes('SH-24121'), { h2, h1 });
  ok('…and the side menu stays folded', await p.evaluate(() => document.getElementById('inv-page').classList.contains('is-rail')));
  // ---- BH7: after the last decision the legend keeps Z while "ביטול" is up
  await into(p, '#inv-desk');
  for (let i = 0; i < 4; i++) { await p.locator('#dk-rows').press('Digit1'); await p.waitForTimeout(150); }
  const z = await p.evaluate(() => { const e = document.querySelector('#inv-desk .desk-keys .z-only'); return !!e && getComputedStyle(e).display !== 'none'; });
  ok('desk: after the last decision the legend still shows "Z ביטול"', z);
  // ---- C06: the rules card is above the message
  await p.evaluate(() => document.querySelector('#dk-rows .row.done').click()); await p.waitForTimeout(150);
  await p.locator('#dk-rows').press('KeyZ'); await p.waitForTimeout(200);
  await p.locator('#dk-rows').press('Digit1'); await p.waitForTimeout(200);
  const zi = await p.evaluate(() => [Number(getComputedStyle(document.querySelector('#dk-rules')).zIndex), Number(getComputedStyle(document.querySelector('#inv-desk .iv-toast')).zIndex)]);
  ok('the rules card stacks above the message', zi[0] > zi[1], zi);
  // ---- BH10: a very long unbroken word stays inside its box
  ok('no errors at 1440 (first part)', p._errs.length === 0, p._errs); await p.context().close();
  p = await open(1440, 900);
  await into(p, '#inv-page');
  await p.evaluate(() => document.querySelector('#ivp-root [data-ivp="pay"]').click()); await p.waitForTimeout(150);
  const hasPay = await p.evaluate(() => !!document.querySelector('#ivp-root .bx-ask'));
  if (hasPay) {
    await p.evaluate(() => [...document.querySelectorAll('#ivp-root .bx-ask .chip')].find(c => c.textContent === 'אחר').click()); await p.waitForTimeout(150);
    await p.fill('#ivp-other', 'א'.repeat(120)); await p.press('#ivp-other', 'Enter'); await p.waitForTimeout(300);
    const over = await p.evaluate(() => { const box = document.querySelector('#ivp-root .ivp-box').getBoundingClientRect(), s = document.querySelector('#ivp-root .bx-done span').getBoundingClientRect(); const hw = document.querySelector('#ivp-root .ivp-hist .h-why'); const main = document.querySelector('#ivp-root .ivp-main').getBoundingClientRect(); const hr = hw ? hw.getBoundingClientRect() : null; return [Math.round(box.left - s.left), hr ? Math.round(main.left - hr.left) : 0]; });
    ok('a 120-letter word stays inside the decision box and the history', over[0] <= 1 && over[1] <= 1, over);
  } else ok('a 120-letter word stays inside the decision box and the history', false, 'no open gap to pay');
  ok('no errors at 1440', p._errs.length === 0, p._errs); await p.context().close();
  console.log(out.join('\n')); console.log('\n' + (out.length - fails) + ' of ' + out.length + ' pass');
  await b.close();
} catch (e) { console.log(out.join('\n')); console.log('STOPPED: ' + String(e).slice(0, 400)); if (b) await b.close(); process.exit(1); } })();
