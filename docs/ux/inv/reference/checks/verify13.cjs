// Round 13: checks for the confirmation pass, lens "words".
// usage: node verify13.cjs
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const out = []; let fails = 0;
const ok = (name, cond, detail) => { out.push((cond ? 'ok   ' : 'FAIL ') + name + (cond || detail == null ? '' : '  → ' + JSON.stringify(detail))); if (!cond) fails++; };
(async () => {
  const b = await chromium.launch(require('./launch.cjs')());
  const page = fs.readFileSync(path.join(__dirname, '..', 'reference.html'), 'utf8');
  const file = path.join(require('./launch.cjs').outDir(), '_verify13.html');
  fs.writeFileSync(file, '<!doctype html><html lang="he" dir="rtl" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0">' + page + '</body></html>');
  const open = async (w, h) => { const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 }); p._errs = []; p.on('pageerror', e => p._errs.push(e.message)); await p.goto('file://' + file); await p.emulateMedia({ reducedMotion: 'reduce' }); await p.waitForTimeout(1300); return p; };
  const T = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }, sel);
  let p = await open(1440, 900);
  ok('month card says the open part', (await T(p, '#reg-root .reg-pl.is-all .pl-s')) === 'פערים פתוחים של ₪296.00 לפני מע״מ', await T(p, '#reg-root .reg-pl.is-all .pl-s'));
  // one invoice left in a filter: the singular
  await p.fill('#reg-q', 'SH-24121'); await p.waitForTimeout(200);
  ok('one invoice is said in the singular', (await T(p, '#reg-root .reg-cnt')) === 'מוצגת חשבונית אחת מתוך 37', await T(p, '#reg-root .reg-cnt'));
  await p.fill('#reg-q', ''); await p.waitForTimeout(150);
  // a decision: the stamp reads date then time in the box, the history and the desk
  await p.evaluate(() => document.querySelector('#ivp-root [data-ivp="claim"]').click()); await p.waitForTimeout(250);
  const order = await p.evaluate(() => {
    const pos = (root, sel) => { const e = document.querySelector(sel); if (!e) return null; const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const m = n.nodeValue.match(/(\d\d\.\d\d\.\d{4}) · (\d\d:\d\d)/); if (m) { const r1 = document.createRange(), r2 = document.createRange(); r1.setStart(n, m.index); r1.setEnd(n, m.index + 10); r2.setStart(n, m.index + 13); r2.setEnd(n, m.index + 18); return r1.getBoundingClientRect().left < r2.getBoundingClientRect().left; } } return null; };
    return { box: pos(0, '#ivp-root .bx-done'), hist: pos(0, '#ivp-root .ivp-hist li') };
  });
  ok('the stamp is drawn date first in the box and in the history', order.box === true && order.hist === true, order);
  ok('after one decision the role card speaks of one gap', (await T(p, '#reg-root .reg-pl .pl-s')).startsWith('פער של ₪104.80'), await T(p, '#reg-root .reg-pl .pl-s'));
  ok('pay run: a group of one is in the singular', await p.evaluate(() => [...document.querySelectorAll('#pr-root .pg-h b')].some(e => e.textContent === 'מחכה להחלטה שלכם')));
  for (let i = 0; i < 3; i++) { await p.evaluate(() => { const c = document.querySelector('#dk-ev [data-dk="claim"]'); if (c) c.click(); }); await p.waitForTimeout(150); }
  ok('everything decided: the month card says so', (await T(p, '#reg-root .reg-pl.is-all .pl-s')) === 'אין פערים פתוחים', await T(p, '#reg-root .reg-pl.is-all .pl-s'));
  const body = await p.evaluate(() => document.body.innerText);
  ok('the base of the percentage is asked, not announced', body.includes('עוד שתי שאלות קטנות, בלי דחיפות.') && body.includes('ההמלצה: להשאיר כך, ולכתוב את הבסיס במסך ההגדרות.') && !body.includes('מחכה להחלטה שלך'));
  ok('no errors at 1440', p._errs.length === 0, p._errs); await p.close();

  // the bookkeeper's register with the summary open fits at the mock-up's design width
  for (const w of [1280, 1024, 960]) {
    p = await open(w, 800);
    await p.evaluate(() => document.querySelector('[data-role="bookkeeper"]').click()); await p.waitForTimeout(200);
    await p.evaluate(() => document.querySelector('#reg-root tbody tr[data-n="HK-24108"]').click()); await p.waitForTimeout(250);
    const f = await p.evaluate(() => { const t = document.querySelector('#reg-root .tb-wrap'); return [t.scrollWidth, t.clientWidth]; });
    ok('bookkeeper register with the summary fits at ' + w, f[0] <= f[1] + 1, f); await p.close();
  }
  // narrow phones: the held total stays inside its tile
  for (const w of [390, 360, 320]) {
    p = await open(w, 740);
    const t = await p.evaluate(() => { const tile = document.querySelector('#pr-root .pr-tile.is-held').getBoundingClientRect(), m = document.querySelector('#pr-root .pr-tile.is-held .money'); const r = document.createRange(); r.selectNodeContents(m); const mr = r.getBoundingClientRect(); return [Math.round(mr.left - tile.left), Math.round(tile.right - mr.right)]; });
    ok('the held total is inside its tile at ' + w, t[0] >= 4 && t[1] >= 4, t); await p.close();
  }
  // the roles table is a list before it would scroll sideways
  for (const w of [768, 740]) {
    p = await open(w, 900);
    const f = await p.evaluate(() => { const t = document.querySelector('#roles .tbl-wrap'); return [t.scrollWidth, t.clientWidth, document.documentElement.scrollWidth, document.documentElement.clientWidth]; });
    ok('the roles table does not scroll sideways at ' + w, f[0] <= f[1] + 1 && f[2] <= f[3] + 1, f); await p.close();
  }
  console.log(out.join('\n')); console.log('\n' + (out.length - fails) + ' of ' + out.length + ' pass');
  await b.close();
})();
