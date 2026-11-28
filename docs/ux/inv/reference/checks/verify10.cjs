// Round 10: one check per finding of the second review that was fixed.
// usage: node verify10.cjs [1440|1280|390]
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const W = Number(process.argv[2] || 1440), H = W < 600 ? 844 : 900, PHONE = W < 600;
const out = []; let fails = 0;
const ok = (name, cond, detail) => { out.push((cond ? 'ok   ' : 'FAIL ') + name + (cond || detail == null ? '' : '  → ' + JSON.stringify(detail))); if (!cond) fails++; };
(async () => {
  const b = await chromium.launch(require('./launch.cjs')());
  const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: PHONE, isMobile: PHONE });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  const page = fs.readFileSync(path.join(__dirname, '..', 'reference.html'), 'utf8');
  const file = path.join(require('./launch.cjs').outDir(), '_verify.html');
  fs.writeFileSync(file, '<!doctype html><html lang="he" dir="rtl" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0">' + page + '</body></html>');
  const load = async () => { await p.goto('file://' + file); await p.emulateMedia({ reducedMotion: 'reduce' }); await p.waitForTimeout(1300); };
  const role = async r => { await p.evaluate(x => document.querySelector('[data-role="' + x + '"]').click(), r); await p.waitForTimeout(200); };
  const into = async sel => { await p.evaluate(s => { const e = document.querySelector(s); const r = e.getBoundingClientRect(); window.scrollBy({ top: r.top - 90, behavior: 'instant' }); }, sel); await p.waitForTimeout(120); };
  const rect = sel => p.evaluate(s => { const e = document.querySelector(s); if (!e || e.hidden || !e.offsetParent) return null; const r = e.getBoundingClientRect(); return { t: Math.round(r.top), b: Math.round(r.bottom), l: Math.round(r.left), r: Math.round(r.right) }; }, sel);
  const inView = r => !!r && r.t >= 0 && r.b <= H;
  const active = () => p.evaluate(() => { const a = document.activeElement; return a === document.body ? 'BODY' : (a.id ? '#' + a.id : a.tagName + '.' + String(a.className).split(' ')[0] + (a.getAttribute('data-ivp') ? '[' + a.getAttribute('data-ivp') + ']' : '')); });
  const tap = async sel => { const l = p.locator(sel).first(); if (PHONE) await l.tap(); else await l.click(); await p.waitForTimeout(250); };

  // ---------- B4 / V01: the message and its "ביטול" are on screen, and centred
  await load();
  await into('#inv-page');
  await tap('#ivp-root [data-ivp="claim"]');
  let t = await rect('#inv-page .iv-toast');
  ok('invoice page: the message is on screen after a decision', inView(t), t);
  /* round 16: at a desk the message stands over the foot of the data pane, clear of the document beside it */
  if (!PHONE) { const m = await rect('#ivp-root .ivp-main'), d = await rect('#ivp-root .ivp-side'); ok('invoice page: the message stands over the data pane, clear of the document', t && m && d && t.l >= d.r && t.r <= m.r + 4, { t, m, d }); }
  ok('invoice page: the focus is not lost after the decision', (await active()) !== 'BODY', await active());
  await tap('#inv-page .iv-toast [data-iv="undo"]');
  ok('invoice page: after "ביטול" the focus is on the first decision', (await active()).includes('[claim]'), await active());
  ok('invoice page: the undo is announced', (await p.evaluate(() => document.querySelector('#inv-page .iv-live').textContent)).includes('בוטלה'));
  ok('the message has no status role of its own', await p.evaluate(() => [...document.querySelectorAll('.iv-toast')].every(e => !e.hasAttribute('role'))));

  await into('#inv-pay');
  await tap('#pr-root [data-pr="export"]');
  t = await rect('#inv-pay .iv-toast');
  ok('pay run: the export message is on screen', inView(t), t);

  // the desk: decide by the button, the message is on screen and does not cover the decision bar
  await load();
  await into('#inv-desk');
  if (PHONE) { await p.evaluate(() => { const bar = document.querySelector('#dk-ev .ev-bar'); const r = bar.getBoundingClientRect(); window.scrollBy({ top: r.bottom - innerHeight + 4, behavior: 'instant' }); }); await p.waitForTimeout(150); }
  await tap('#dk-ev [data-dk="claim"]');
  t = await rect('#inv-desk .iv-toast'); const bar = await rect('#dk-ev .ev-bar');
  ok('desk: the message is on screen after a decision', inView(t), t);
  ok('desk: the message does not cover the decision bar', !!t && !!bar && (t.b <= bar.t + 1 || t.t >= bar.b - 1 || t.r <= bar.l + 1 || t.l >= bar.r - 1), { t, bar });
  if (!PHONE) { const keys = await rect('#inv-desk .desk-keys'); ok('desk: the message does not cover the keys legend', !keys || t.b <= keys.t + 1, { t, keys }); }

  // ---------- B1: [ and ] stay inside the invoice page
  if (!PHONE) {
    await load(); await into('#inv-page');
    await p.focus('#ivp-root [data-ivp="next"]');
    await p.keyboard.press('BracketRight'); await p.waitForTimeout(150);
    const second = await p.evaluate(() => document.querySelector('#ivp-root h1').textContent);
    await p.keyboard.press('BracketLeft'); await p.waitForTimeout(150);
    const first = await p.evaluate(() => document.querySelector('#ivp-root h1').textContent);
    await p.keyboard.press('BracketLeft'); await p.waitForTimeout(150);
    ok('[ and ] walk the invoices', second.includes('ST-24108') && first.includes('SH-24121'), { second, first });
    ok('[ on the invoice page leaves the side menu alone', await p.evaluate(() => document.getElementById('inv-page').classList.contains('is-rail')));
  }

  // ---------- B5: links between the mock-ups land on the mock-up
  await load(); await into('#inv-reg');
  await tap('#reg-root tbody tr[data-n="ST-24108"]');
  await tap('#reg-root [data-reg="open"]'); await p.waitForTimeout(300);
  let m = await rect('#inv-page');
  ok('"פתחו את החשבונית" lands on the invoice mock-up', !!m && m.t > 40 && m.t < 260, m);
  ok('…on the invoice that was asked for, with the focus on its heading', (await p.evaluate(() => document.querySelector('#ivp-root h1').textContent)).includes('ST-24108') && (await active()).startsWith('H1'), await active());
  await tap('#ivp-root [data-ivp="list"]'); await p.waitForTimeout(300);
  m = await rect('#inv-reg');
  ok('"לרשימת החשבוניות" lands on the register mock-up', !!m && m.t > 40 && m.t < 260, m);
  ok('…and the focus is not lost', (await active()) !== 'BODY', await active());
  await tap('#reg-root [data-reg="first"]'); await p.waitForTimeout(300);
  m = await rect('#inv-desk');
  ok('"להחלטה" lands on the desk mock-up', !!m && m.t > 40 && m.t < 260, m);
  if (!PHONE) { const bt = await rect('#dk-ev [data-dk="claim"]'); ok('…with the decision buttons on screen', inView(bt), bt); }

  // ---------- B6: a question about one gap never moves to another
  await load(); await into('#inv-desk');
  await tap('#dk-ev [data-dk="pay"]');
  ok('desk: the question opens', await p.evaluate(() => !!document.querySelector('#dk-ev .reasons')));
  await p.evaluate(() => document.querySelector('#ivp-root [data-ivp="claim"]').click()); await p.waitForTimeout(200);
  ok('desk: the question closes when its gap was decided elsewhere', await p.evaluate(() => !document.querySelector('#dk-ev .reasons')));

  // ---------- V09 + V05: everything decided is calm; a decided gap has no red or amber evidence
  await load(); await into('#inv-desk');
  for (let i = 0; i < 4; i++) { await p.evaluate(() => { const c = document.querySelector('#dk-ev [data-dk="claim"]'); if (c) c.click(); }); await p.waitForTimeout(120); }
  ok('desk: after the last decision it says "הכול מטופל"', await p.evaluate(() => { const e = document.querySelector('#dk-ev .ev-empty b'); return !!e && e.textContent === 'הכול מטופל'; }));
  ok('desk: the mark of "הכול מטופל" is not green', await p.evaluate(() => { const c = getComputedStyle(document.querySelector('#dk-ev .ev-empty .ic')).color.match(/\d+/g).map(Number); return !(c[1] > c[0] + 30 && c[1] > c[2] + 30); }));
  if (!PHONE) {
    await p.evaluate(() => document.querySelector('#dk-rows .row.done').click()); await p.waitForTimeout(150);
    const cols = await p.evaluate(() => { const o = document.querySelector('#dk-ev .match .off'), d = document.querySelector('#dk-ev .match .delta'), h = document.querySelector('#dk-ev .paper .hit'); return [o && getComputedStyle(o).backgroundColor, d && getComputedStyle(d).color, h && getComputedStyle(h).backgroundColor]; });
    const warm = c => { if (!c) return false; const v = c.match(/\d+/g).map(Number); return v[0] > v[2] + 12; };
    ok('desk: a decided gap has calm evidence (no red, no amber)', !cols.some(warm), cols);
  }
  const paper = await p.evaluate(() => { const h = document.querySelector('#ivp-root .sd-mk'); return h && h.classList.contains('is-done') ? getComputedStyle(h).backgroundColor : null; });
  ok('invoice page: the mark on the supplier document of a decided gap is calm', !!paper && (v => v[0] <= v[2] + 12)(paper.match(/\d+/g).map(Number)), paper);

  // ---------- V11: every frame says who is looking
  await load(); await role('manager');
  const me = await p.evaluate(() => [...document.querySelectorAll('.iv-me')].map(e => e.textContent));
  ok('every frame names the person and the role', me.length === 4 && me.every(x => x === 'יואב שגיא · ניהול'), me);
  ok('every role switch says what it changes', await p.evaluate(() => [...document.querySelectorAll('.stage-bar')].filter(b => b.querySelector('[data-role]')).every(b => b.textContent.length > 40)));
  await role('owner');

  // ---------- V06: the who sentence of a manager's gap stays on one line for the owner
  if (!PHONE) {
    await into('#inv-desk');
    await p.evaluate(() => document.querySelector('#dk-rows .row[data-g]:nth-of-type(1)') && [...document.querySelectorAll('#dk-rows .row')].find(r => r.textContent.includes('HK-24108')).click()); await p.waitForTimeout(150);
    const who = await p.evaluate(() => { const e = document.querySelector('#dk-ev .dk-who'); return e ? Math.round(e.getBoundingClientRect().height) : 0; });
    ok('desk: the who line of a manager\'s gap is one line high', who > 0 && who <= 46, who);
  }

  // ---------- B8 / V07 / V04: the register fits, with and without the summary; cards say their basis
  await load(); await into('#inv-reg');
  const cards = await p.evaluate(() => [...document.querySelectorAll('#reg-root .reg-pl')].map(c => ({ t: c.querySelector('.pl-v').textContent, cut: c.querySelector('.pl-s').scrollWidth > c.querySelector('.pl-s').clientWidth + 1 })));
  ok('register cards: every amount states "כולל מע״מ"', cards.every(c => c.t.includes('כולל מע״מ')), cards);
  if (!PHONE) {
    const fit = () => p.evaluate(() => { const w = document.querySelector('#reg-root .tb-wrap'); return [w.scrollWidth, w.clientWidth]; });
    let f = await fit(); ok('register: the table does not scroll sideways', f[0] <= f[1] + 1, f);
    await tap('#reg-root tbody tr[data-n="HK-24108"]');
    f = await fit(); ok('register with the summary: the table does not scroll sideways', f[0] <= f[1] + 1, f);
    const cut = await p.evaluate(() => [...document.querySelectorAll('#reg-root .reg-pl .pl-s')].filter(e => e.scrollWidth > e.clientWidth + 1).length);
    ok('register with the summary: no card text is cut', cut === 0, cut);
    // B7: arrows never put the focused row under the sticky head or total
    await p.keyboard.press('Escape'); await p.waitForTimeout(100);
    await p.focus('#reg-root tbody tr[tabindex="0"]');
    let hidden = 0;
    for (let i = 0; i < 36; i++) { await p.keyboard.press('ArrowDown'); hidden += await p.evaluate(() => { const r = document.activeElement.getBoundingClientRect(), w = document.querySelector('#reg-root .tb-wrap'), h = w.querySelector('thead').getBoundingClientRect(), f = w.querySelector('tfoot').getBoundingClientRect(); return (r.bottom > f.top + 1 || r.top < h.bottom - 1) ? 1 : 0; }); }
    for (let i = 0; i < 36; i++) { await p.keyboard.press('ArrowUp'); hidden += await p.evaluate(() => { const r = document.activeElement.getBoundingClientRect(), w = document.querySelector('#reg-root .tb-wrap'), h = w.querySelector('thead').getBoundingClientRect(), f = w.querySelector('tfoot').getBoundingClientRect(); return (r.bottom > f.top + 1 || r.top < h.bottom - 1) ? 1 : 0; }); }
    ok('register: an arrow never hides the focused row under the head or the total', hidden === 0, hidden);
  }

  // ---------- B9: the focus after "נקו את הסינון"
  await p.fill('#reg-q', 'zzzz'); await p.waitForTimeout(150);
  await tap('#reg-root [data-reg="clear"]');
  ok(PHONE ? 'register on a phone: after "נקו את הסינון" the focus is on the first row (on screen)' : 'register: after "נקו את הסינון" the focus is in the search field', PHONE ? (await active()).startsWith('TR') : (await active()) === '#reg-q', await active());

  // ---------- the phone
  if (PHONE) {
    await load(); await role('bookkeeper'); await into('#inv-reg');
    const bare = await p.evaluate(() => [...document.querySelectorAll('.rm-app.iv .money')].filter(m => m.offsetParent && !m.querySelector('.cur')).length);
    ok('phone, bookkeeper: every amount carries its ₪', bare === 0, bare);
    const row = await p.evaluate(() => { const r = document.querySelector('#reg-root tbody tr'); const c = [...r.children].filter(x => x.offsetParent); const tx = e => (e.textContent + ' ' + (getComputedStyle(e, '::after').content || '') + ' ' + (getComputedStyle(e, '::before').content || '')).replace(/"/g, ''); return c.map(tx).join(' | '); });
    ok('phone: a register row shows the total with "כולל מע״מ" and the gap with "לפני מע״מ"', /₪[\d,.]+\s+כולל מע״מ/.test(row.replace(/none/g, '')) && row.includes('לפני מע״מ'), row);
    const foot = await p.evaluate(() => { const c = [...document.querySelectorAll('#reg-root tfoot td')].filter(x => x.offsetParent); return c.map(e => e.textContent + ' ' + getComputedStyle(e, '::after').content).join(' | '); });
    ok('phone: the register total row shows its amount', /₪[\d,.]+/.test(foot) && foot.includes('כולל מע״מ'), foot);
    ok('phone: the count says what is on screen', (await p.evaluate(() => document.querySelector('#reg-root .reg-cnt').textContent)).startsWith('מוצגות 8 מתוך'));
    await role('owner');
    await tap('#reg-root tbody tr[data-n="ST-24108"]'); await p.waitForTimeout(450);
    const pk = await rect('#reg-root .reg-peek'), rw = await rect('#reg-root tbody tr[data-n="ST-24108"]');
    ok('phone: the summary of a tapped row is on screen', !!pk && pk.t < H && pk.b <= H + 1 && pk.t > 60, pk);
    ok('phone: the tapped row stays in view above the summary', !!rw && !!pk && rw.t >= 40 && rw.t < pk.t, { rw, pk });
    ok('phone: with the summary open the rows keep their date', await p.evaluate(() => { const d = document.querySelector('#reg-root tbody tr .reg-date'); return !!d && !!d.offsetParent; }));
    const lab = await p.evaluate(() => { const td = document.querySelector('#roles .tbl td[data-l]'); return td ? getComputedStyle(td, '::before').content : ''; });
    ok('phone: the roles table labels its cells', lab.includes('מה רואים'), lab);
    await into('#inv-pay');
    const held = await p.evaluate(() => { const li = document.querySelector('#pr-root .pg-rows li'); const a = li.querySelector('.pr-amt').getBoundingClientRect(), s = li.querySelector('.pr-sup').getBoundingClientRect(); return { sameRow: Math.abs(a.top - s.top) < 8, text: li.querySelector('.pr-amt').innerText }; });
    ok('phone: a held row has its amount beside the supplier, with its basis', held.sameRow && held.text.includes('כולל מע״מ'), held);
  }
  ok('no script errors', errs.length === 0, errs);
  console.log(out.join('\n')); console.log('\n' + (out.length - fails) + ' of ' + out.length + ' pass at ' + W);
  await b.close();
})();
