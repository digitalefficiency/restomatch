// Round 11: checks for the findings of the "truth" and "rules" fix-checks.
// usage: node verify11.cjs [1440|390]
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const W = Number(process.argv[2] || 1440), H = W < 600 ? 844 : 900, PHONE = W < 600;
const out = []; let fails = 0;
const ok = (name, cond, detail) => { out.push((cond ? 'ok   ' : 'FAIL ') + name + (cond || detail == null ? '' : '  → ' + JSON.stringify(detail))); if (!cond) fails++; };
(async () => { try {
  var b = await chromium.launch(require('./launch.cjs')());
  const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: PHONE, isMobile: PHONE });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  const page = fs.readFileSync(path.join(__dirname, '..', 'reference.html'), 'utf8');
  const file = path.join(require('./launch.cjs').outDir(), '_verify11.html');
  fs.writeFileSync(file, '<!doctype html><html lang="he" dir="rtl" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0">' + page + '</body></html>');
  const load = async () => { await p.goto('file://' + file); await p.emulateMedia({ reducedMotion: 'reduce' }); await p.waitForTimeout(1300); };
  const into = async sel => { await p.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); window.scrollBy({ top: r.top - 90, behavior: 'instant' }); }, sel); await p.waitForTimeout(120); };
  const T = sel => p.evaluate(s => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }, sel);
  const click = async sel => { await p.evaluate(s => document.querySelector(s).click(), sel); await p.waitForTimeout(180); };

  // ---- "אחר" asks for the reason in words, and what was typed is shown as text
  await load(); await into('#inv-page');
  await click('#ivp-root [data-ivp="pay"]');
  await p.evaluate(() => [...document.querySelectorAll('#ivp-root .bx-ask .chip')].find(c => c.textContent === 'אחר').click()); await p.waitForTimeout(200);
  ok('invoice page: "אחר" opens a field for the reason', await p.evaluate(() => !!document.getElementById('ivp-other') && document.activeElement.id === 'ivp-other'));
  ok('invoice page: the decision is disabled while the reason is empty', await p.evaluate(() => document.querySelector('#ivp-root [data-ivp="other-ok"]').disabled));
  ok('invoice page: nothing was decided yet', await p.evaluate(() => !document.querySelector('#ivp-root .ivp-box.is-done')));
  await p.fill('#ivp-other', 'סוכם בטלפון <b>עם הספק</b>'); await p.waitForTimeout(100);
  ok('invoice page: with a reason the decision is enabled', await p.evaluate(() => !document.querySelector('#ivp-root [data-ivp="other-ok"]').disabled));
  await p.press('#ivp-other', 'Enter'); await p.waitForTimeout(250);
  const done = await T('#ivp-root .bx-done');
  ok('invoice page: the typed reason is recorded as text', !!done && done.includes('אחר: סוכם בטלפון <b>עם הספק</b>') && await p.evaluate(() => !document.querySelector('#ivp-root .bx-done b b, #ivp-root .ivp-hist b')), done);
  const hist = await T('#ivp-root .ivp-hist li');
  ok('history: paying as billed says the amount is the gap\'s', !!hist && hist.includes('הפער של ₪38.70 לפני מע״מ נסגר, שולם כפי שחויב'), hist);

  // ---- after the owner's own gaps, the way onward says whose gap is next
  const next = await T('#ivp-root [data-ivp="nextgap"]');
  ok('invoice page: the next button for the owner\'s other own gap', next === 'לפער הבא שמחכה לכם', next);
  await click('#ivp-root [data-ivp="nextgap"]'); await click('#ivp-root [data-ivp="claim"]');
  const next2 = await T('#ivp-root [data-ivp="nextgap"]');
  ok('invoice page: when the next gap waits for another role the button says so', next2 === 'לפער הבא, אצל הניהול', next2);
  await into('#inv-desk');
  await p.evaluate(() => [...document.querySelectorAll('#dk-rows .row')].find(r => r.textContent.includes('MF-24108')).click()); await p.waitForTimeout(150);
  await click('#dk-ev [data-dk="claim"]');
  const hint = await T('#dk-ev .ev-bar .hint');
  ok('desk: on the last open gap, which waits for the manager, the hint does not say "שמחכה לכם"', hint === 'הפער האחרון שנשאר פתוח', hint);

  // ---- the desk: "אחר" too
  await click('#dk-ev [data-dk="pay"]');
  await p.evaluate(() => [...document.querySelectorAll('#dk-ev .reasons .chip')].find(c => c.textContent === 'אחר').click()); await p.waitForTimeout(200);
  ok('desk: "אחר" opens a field, and the decision waits for words', await p.evaluate(() => !!document.getElementById('dk-other') && document.querySelector('#dk-ev [data-dk="other-ok"]').disabled));
  await p.fill('#dk-other', 'טעות בהזמנה'); await click('#dk-ev [data-dk="other-ok"]');
  ok('desk: after it everything is decided', await p.evaluate(() => { const e = document.querySelector('#dk-ev .ev-empty b'); return !!e && e.textContent === 'הכול מטופל'; }));
  ok('desk: the reason is shown beside the decision', (await T('#dk-rows')).includes('שולם כפי שחויב'));

  // ---- the register summary after paying as billed
  await load(); await into('#inv-desk');
  await click('#dk-ev [data-dk="pay"]'); await click('#dk-ev .reasons .chip'); await into('#inv-reg');
  await p.evaluate(() => document.querySelector('#reg-root tbody tr[data-n="SH-24121"]').click()); await p.waitForTimeout(250);
  const pk = await T('#reg-root .reg-peek .pk-gap');
  ok('register summary: paying as billed is not read as an amount that was paid', !!pk && pk.includes('הפער נסגר, שולם כפי שחויב') && pk.includes('פער של ₪38.70 לפני מע״מ'), pk);
  if (!PHONE) ok('register: with the summary open the column is called "אצל מי"', await p.evaluate(() => [...document.querySelectorAll('#reg-root thead th')].some(t => t.textContent === 'אצל מי')));

  // ---- the pay run: a missing allocation number asks for an action
  await load();
  const al = await p.evaluate(() => { const g = [...document.querySelectorAll('#pr-root .pr-grp')].find(x => x.textContent.includes('חסר מספר הקצאה')); return { note: g.querySelector('.pg-note').textContent, warn: !!g.querySelector('.dot-warn') }; });
  ok('pay run: "חסר מספר הקצאה" says what to do', al.note === 'בקשו את המספר מהספק, כדי לקזז ₪1,123.20 מע״מ.' && al.warn, al);
  ok('pay run: the export button names the action', (await T('#pr-root [data-pr="export"]')) === 'ייצוא להנהלת החשבונות');

  // ---- words
  const body = await p.evaluate(() => document.body.innerText);
  ok('page: "רק מי שהחליט" may take a decision back', body.includes('רק מי שהחליט, ובמשך עשר שניות.') && !body.includes('רק התפקיד שהחליט'));
  ok('page: no "חזרו" or "ייצאו" label is left', await p.evaluate(() => ![...document.querySelectorAll('.rm-app.iv button')].some(b => /חזרו|ייצאו/.test(b.textContent))));
  ok('page: the date of the page is today', body.includes('הצעת עיצוב, 21.11.2026'));
  ok('no script errors', errs.length === 0, errs);
  console.log(out.join('\n')); console.log('\n' + (out.length - fails) + ' of ' + out.length + ' pass at ' + W);
  await b.close(); } catch (e) { console.log(out.join("\n")); console.log("STOPPED: " + String(e).slice(0, 300)); process.exit(1); }
})();
