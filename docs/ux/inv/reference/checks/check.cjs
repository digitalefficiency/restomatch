// Behaviour and rule checks on the built invoices proposal page.
// usage: node check.cjs [width]   (1440 by default; 390 runs the phone subset)
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const W = Number(process.argv[2] || 1440);
const out = []; let fails = 0;
const ok = (name, cond, detail) => { out.push((cond ? 'ok   ' : 'FAIL ') + name + (cond || detail == null ? '' : '  → ' + JSON.stringify(detail))); if (!cond) fails++; };
const num = s => Number(String(s).replace(/[^\d.]/g, ''));
(async () => {
  const b = await chromium.launch(require('./launch.cjs')());
  const p = await b.newPage({ viewport: { width: W, height: W < 600 ? 844 : 1000 }, deviceScaleFactor: 1 });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  const page = fs.readFileSync(path.join(__dirname, '..', 'reference.html'), 'utf8');
  const file = path.join(require('./launch.cjs').outDir(), '_check.html');
  fs.writeFileSync(file, '<!doctype html><html lang="he" dir="rtl" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0">' + page + '</body></html>');
  const load = async () => { await p.goto('file://' + file); await p.waitForTimeout(1500); };
  const role = async r => { await p.evaluate(x => document.querySelector('[data-role="' + x + '"]').click(), r); await p.waitForTimeout(150); };
  const T = sel => p.evaluate(s => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }, sel);
  const key = (sel, code, k) => p.evaluate(([s, c, kk]) => { const e = document.querySelector(s); e.focus(); e.dispatchEvent(new KeyboardEvent('keydown', { code: c, key: kk, bubbles: true, cancelable: true })); }, [sel, code, k]);
  await load();

  // ---------- the page loads clean
  ok('no script errors on load', errs.length === 0, errs);
  const sw = await p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  ok('no sideways scroll at ' + W, sw[0] <= sw[1], sw);
  ok('four mock-ups rendered', (await p.evaluate(() => ['reg-root', 'ivp-root', 'dk-rows', 'pr-root'].map(i => document.getElementById(i).children.length > 0))).every(Boolean));

  // ---------- figures: the places add up to the month, for every role, before and after decisions
  const places = () => p.evaluate(() => [...document.querySelectorAll('#reg-root .reg-pl')].map(e => ({ t: e.querySelector('.pl-t').childNodes.length ? e.querySelector('.pl-t').textContent.replace(/\d+$/, '').trim() : '', n: Number(e.querySelector('.c').textContent), v: e.querySelector('.pl-v').textContent })));
  for (const r of ['owner', 'manager', 'bookkeeper']) {
    await role(r); const pl = await places(); const parts = pl.filter(x => x.t !== 'כל החודש');
    const sum = Math.round(parts.reduce((a, x) => a + num(x.v), 0) * 100) / 100, cnt = parts.reduce((a, x) => a + x.n, 0);
    ok(r + ': places add up to ₪51,913.10 and 37', sum === 51913.10 && cnt === 37, { sum, cnt });
  }
  await role('owner');
  ok('owner headline', (await T('#reg-root .reg-say')).startsWith('פערים של ₪143.50 לפני מע״מ מחכים לכם, ועוד ₪152.50 אצל הניהול.'), await T('#reg-root .reg-say'));
  await role('manager');
  ok('manager headline', (await T('#reg-root .reg-say')).startsWith('פערים של ₪152.50 לפני מע״מ מחכים לכם, ועוד ₪143.50 אצל הבעלים.'), await T('#reg-root .reg-say'));
  await role('bookkeeper');
  ok('bookkeeper headline', (await T('#reg-root .reg-say')).startsWith('אין פער שמחכה לכם, ופערים של ₪296.00 לפני מע״מ אצל אחרים.'), await T('#reg-root .reg-say'));
  ok('bookkeeper has no filled button in the register', (await p.evaluate(() => document.querySelectorAll('#inv-reg .btn-primary').length)) === 0);
  ok('bookkeeper desk is read-only', (await p.evaluate(() => document.querySelectorAll('#dk [data-dk="claim"], #dk [data-dk="pay"]').length)) === 0 && /ההחלטה אצל הבעלים/.test(await T('#dk-ev .ev-bar')));
  ok(W < 600 ? 'bookkeeper on a phone: the density is fixed, no dense rows' : 'bookkeeper rows are dense', await p.evaluate(w => [...document.querySelectorAll('.rm-app.iv')].every(a => a.classList.contains('is-compact') === (w >= 600)), W));
  await role('owner');
  ok('owner rows are regular', await p.evaluate(() => [...document.querySelectorAll('.rm-app.iv')].every(a => !a.classList.contains('is-compact'))));

  // ---------- the desk by role
  const groups = () => p.evaluate(() => [...document.querySelectorAll('#dk-rows [role="group"]')].map(g => ({ t: g.querySelector('.grp b').textContent, n: Number(g.querySelector('.grp .num').textContent), note: (g.querySelector('.grp-n') || {}).textContent || '', rows: g.querySelectorAll('.row').length })));
  let g = await groups();
  ok('owner desk groups', g.length === 2 && g[0].t === 'אצלכם' && g[0].n === 2 && g[1].t === 'אצל הניהול' && g[1].n === 2 && g[1].note === 'גם אתם רשאים להחליט', g);
  await role('manager'); g = await groups();
  ok('manager desk groups', g.length === 2 && g[0].t === 'אצלכם' && g[0].n === 2 && g[1].t === 'אצל הבעלים' && g[1].note === 'לקריאה בלבד', g);
  await role('bookkeeper'); g = await groups();
  ok('bookkeeper desk groups', g.length === 3 && g[0].n === 0 && g[1].t === 'אצל הבעלים' && g[2].t === 'אצל הניהול' && g[1].note === 'לקריאה בלבד' && g[2].note === 'לקריאה בלבד', g);

  // ---------- keys are read by the physical key (Hebrew layout: J types ח, K types ל)
  await role('owner');
  const sel = () => p.evaluate(() => (document.querySelector('#dk-rows .row[aria-selected="true"]') || {}).id || null);
  const s0 = await sel(); await key('#dk-rows', 'KeyJ', 'ח'); const s1 = await sel(); await key('#dk-rows', 'KeyK', 'ל'); const s2 = await sel();
  ok('J and K move the selection on a Hebrew layout', s0 !== s1 && s2 === s0, [s0, s1, s2]);
  await role('bookkeeper'); const before = await T('#dk-sum'); await key('#dk-rows', 'Digit1', '1');
  ok('key 1 does nothing on a read-only gap, and says the sentence the screen shows', (await T('#dk-sum')) === before && (await T('#dk-live')) === 'ההחלטה אצל הבעלים, ואין צורך בפעולה מצדכם.', await T('#dk-live'));

  // ---------- a decision: every screen follows, and it can be taken back
  await role('owner');
  const heldBefore = await T('#pr-root .pr-tile.is-held .pt-v'), payBefore = await T('#pr-root .pr-tile:not(.is-held) .pt-v');
  await key('#dk-rows', 'Digit1', '1'); await p.waitForTimeout(200);
  ok('after a credit request: toast says so, within 8 words', /^נוסף לבקשת הזיכוי, ירקות השרון/.test(await T('#inv-desk .iv-toast')) && (await T('#inv-desk .iv-toast span')).split(' ').length <= 8, await T('#inv-desk .iv-toast'));
  ok('desk: a group "הוחלט היום" with the result and the role', /הוחלט היום/.test(await T('#dk-rows')) && /נוסף לבקשת הזיכוי · בעלים/.test(await T('#dk-rows')));
  ok('register: the invoice is now "לבקשת זיכוי", decided today by the owner', /לבקשת זיכוי/.test(await T('#reg-root tr[data-n="SH-24121"]')) && /הוחלט היום · בעלים/.test(await T('#reg-root tr[data-n="SH-24121"]')), await T('#reg-root tr[data-n="SH-24121"]'));
  ok('register: the gap amount stays on the decided row', /38\.70/.test(await T('#reg-root tr[data-n="SH-24121"] .reg-gap')));
  let pl = await places(); let sum = Math.round(pl.filter(x => x.t !== 'כל החודש').reduce((a, x) => a + num(x.v), 0) * 100) / 100;
  ok('register: places still add up after the decision', sum === 51913.10, sum);
  ok('pay run: the invoice moved to payable', num(await T('#pr-root .pr-tile.is-held .pt-v')) === Math.round((num(heldBefore) - 833.58) * 100) / 100 && num(await T('#pr-root .pr-tile:not(.is-held) .pt-v')) === Math.round((num(payBefore) + 833.58) * 100) / 100, [await T('#pr-root .pr-tile.is-held .pt-v'), await T('#pr-root .pr-tile:not(.is-held) .pt-v')]);
  ok('pay run: the payable row carries the note', /₪38\.70 בבקשת זיכוי, לפני מע״מ · הוחלט היום/.test(await T('#pr-root .pr-tb')));
  ok('headline follows, and one gap is said in the singular', (await T('#reg-root .reg-say')).startsWith('פער של ₪104.80 לפני מע״מ מחכה לכם, ועוד ₪152.50 אצל הניהול.'), await T('#reg-root .reg-say'));
  await key('#dk-rows', 'KeyZ', 'ז'); await p.waitForTimeout(200);
  ok('Z takes the decision back everywhere', (await T('#reg-root .reg-say')).startsWith('פערים של ₪143.50 לפני מע״מ') && num(await T('#pr-root .pr-tile.is-held .pt-v')) === num(heldBefore) && !/הוחלט היום/.test(await T('#dk-rows')));

  // ---------- the owner decides a manager's gap: it says so
  await p.evaluate(() => document.getElementById('dk-row-g-hk').click()); await p.waitForTimeout(100);
  ok('owner on a manager gap: line and tag', /אצל הניהול 6 ימים, כי הפערים בחשבונית בין ₪50 ל־₪300 לפני מע״מ\./.test(await T('#dk-ev .dk-who')) && /גם אתם רשאים להחליט/.test(await T('#dk-ev .dk-who')));
  await p.evaluate(() => document.querySelector('#dk [data-dk="claim"]').click()); await p.waitForTimeout(200);
  ok('toast: decided in the manager\'s place', (await T('#inv-desk .iv-toast span')) === 'נוסף לבקשת הזיכוי, החלטתם במקום הניהול', await T('#inv-desk .iv-toast span'));
  await p.evaluate(() => window.__INV.focus('HK-24108'));
  ok('history: the owner decided in the manager\'s place', /נוסף לבקשת הזיכוי, ₪100\.00 לפני מע״מ · בעלים, במקום הניהול/.test(await T('#ivp-root .ivp-hist')), await T('#ivp-root .ivp-hist li'));
  ok('register: the place is "בלי פער פתוח", and says one of them is in a credit request', /בלי פער פתוח9.*אחת מהן בבקשת זיכוי/.test((await T('#reg-root .reg-map')).replace(/\s/g, ' ')), await T('#reg-root .reg-map'));
  await p.evaluate(() => document.querySelector('#inv-desk .iv-toast [data-iv="undo"]').click()); await p.waitForTimeout(200);

  // ---------- paying as billed asks why first
  await p.evaluate(() => document.getElementById('dk-row-g-sh').click());
  await p.evaluate(() => document.querySelector('#dk [data-dk="pay"]').click()); await p.waitForTimeout(100);
  ok('paying as billed asks for a reason, with the product\'s five choices', (await p.evaluate(() => document.querySelectorAll('#dk-ev .reasons .chip').length)) === 5 && /אחר$/.test(await T('#dk-ev .reasons .chips')));
  await p.evaluate(() => document.querySelector('#dk-ev .reasons .chip').click()); await p.waitForTimeout(200);
  await p.evaluate(() => window.__INV.focus('SH-24121'));
  ok('after paying as billed: the invoice is clear, the reason is kept', /תקינה/.test(await T('#reg-root tr[data-n="SH-24121"]')) && /שולם כפי שחויב/.test(await T('#reg-root tr[data-n="SH-24121"]')) && /הגיע בפועל, הקבלה שגויה/.test(await T('#dk-rows') + await T('#ivp-root')), await T('#reg-root tr[data-n="SH-24121"]'));
  await p.evaluate(() => document.querySelector('#inv-desk .iv-toast [data-iv="undo"]').click()); await p.waitForTimeout(200);

  // ---------- escalation
  await role('manager');
  await p.evaluate(() => document.getElementById('dk-row-g-hk').click());
  await key('#dk-rows', 'Digit3', '3'); await p.waitForTimeout(200); g = await groups();
  ok('manager escalates: the gap is now with the owner, still visible, read-only', g[0].n === 1 && g[1].t === 'אצל הבעלים' && g[1].n === 3 && /הועבר לבעלים, קצביית הכרם/.test(await T('#inv-desk .iv-toast')), g);
  await p.evaluate(() => document.getElementById('dk-row-g-hk').click());
  ok('escalated gap keeps its age', /אצל הבעלים מהיום, כי הניהול העביר אחרי 6 ימים\./.test(await T('#dk-ev .dk-who')), await T('#dk-ev .dk-who'));
  await role('owner');
  ok('the toast leaves when another person looks', await p.evaluate(() => [...document.querySelectorAll('.iv-toast')].every(t => t.hidden)));
  ok('owner sees the escalated gap as theirs', (await groups())[0].n === 3);
  await p.evaluate(() => window.__INV.unescalate(window.__INV.gaps.filter(x => x.id === 'g-hk')[0]));

  // ---------- the invoice page
  await p.evaluate(() => window.__INV.focus('SH-24121'));
  ok('invoice page: line, decision, what each decision does', /אצלכם 10 ימים, כי חיוב על יותר ממה שהתקבל חוסם תשלום\./.test(await T('#ivp-root .bx-who')) && /"בקשת זיכוי" מוסיפה ₪38\.70 לפני מע״מ לבקשה שנשלחת לספק\./.test(await T('#ivp-root ul.bx-fx')));
  ok('invoice page: VAT is an amount, with no false check', /מע״מ₪0\.00/.test((await T('#ivp-root .ivp-sum')).replace(/\s/g, '')) && !/18%/.test(await T('#ivp-root')));
  ok('invoice page: one gap, not two', !/חסר בכמות/.test(await T('#ivp-root')));
  await role('manager');
  ok('invoice page for the manager: read-only sentence, no buttons', /ההחלטה אצל הבעלים, ואין צורך בפעולה מצדכם\./.test(await T('#ivp-root .bx-ro')) && (await p.evaluate(() => document.querySelectorAll('#ivp-root [data-ivp="claim"]').length)) === 0);
  await role('owner');
  await key('#ivp-root .rm-ico:not([disabled])', 'BracketRight', ']'); await p.waitForTimeout(100);
  ok('] walks to the next invoice', /ST-24108/.test(await T('#ivp-root h1')), await T('#ivp-root h1'));
  await p.evaluate(() => window.__INV.focus('SH-24121'));

  // ---------- the pay run
  const grp = await p.evaluate(() => [...document.querySelectorAll('#pr-root .pr-grp')].map(s => ({ t: s.querySelector('.pg-h b').textContent, n: Number(s.querySelector('.pg-h .c').textContent), v: s.querySelector('.pg-sum').textContent })));
  const heldSum = Math.round(grp.reduce((a, x) => a + num(x.v), 0) * 100) / 100;
  ok('pay run: four groups add up to what is held', grp.length === 4 && heldSum === 21115.45 && num(await T('#pr-root .pr-tile.is-held .pt-v')) === 21115.45, { grp, heldSum });
  ok('pay run: says it is off for the pilot', /ריצת התשלומים כבויה אצלכם בפיילוט/.test(await T('#pr-root .pr-off')));
  ok('pay run: no button that marks a payment', !(await p.evaluate(() => [...document.querySelectorAll('#pr-root button')].some(x => /שולם|שלמו|סמנו/.test(x.textContent)))));
  ok('pay run: the held sentence states both VAT bases', /פערים של ₪296\.00 לפני מע״מ מחזיקים חשבוניות של ₪10,148\.93 כולל מע״מ\./.test(await T('#pr-root .pr-say')), await T('#pr-root .pr-say'));

  // ---------- owner rules on what the mock-ups say, for every role
  const BANNED = ['דרישה', 'דרישת', 'תביעה', 'נחסם', 'נחסך', 'הפסד', 'חיסכון', 'חריגה', 'ריכוז', 'הפרש', 'ממצא', '1.5%', 'יעד', 'אשרו', 'הכל '];
  for (const r of ['owner', 'manager', 'bookkeeper']) {
    await role(r);
    const txt = await p.evaluate(() => [...document.querySelectorAll('.rm-app.iv')].map(a => a.innerText).join('\n'));
    const hit = BANNED.filter(w => txt.indexOf(w) >= 0);
    ok(r + ': no banned word in the mock-ups', hit.length === 0, hit);
    const long = await p.evaluate(() => [...document.querySelectorAll('.rm-app.iv .btn, .rm-app.iv .chip, .rm-app.iv .dk-why')].map(x => x.innerText.replace(/\s+/g, ' ').replace(/ ?(Esc|[123Z])$/, '').trim()).filter(t => t.split(' ').filter(w => w && !/^[·₪\d.,]+$/.test(w)).length > 4));
    ok(r + ': buttons are at most 4 words', long.length === 0, long);
    const filled = await p.evaluate(() => [...document.querySelectorAll('.rm-app.iv')].map(a => [...a.querySelectorAll('.btn-primary')].filter(x => x.offsetParent).length));
    ok(r + ': at most one filled button per mock-up', filled.every(n => n <= 1), filled);
    const red = await p.evaluate(() => [...document.querySelectorAll('.rm-app.iv .money')].filter(m => { const c = getComputedStyle(m).color.match(/\d+/g).map(Number); return c[0] > 150 && c[1] < 90 && c[2] < 90; }).length);
    ok(r + ': no money figure in red', red === 0, red);
    const sing = await p.evaluate(() => [...document.querySelectorAll('.rm-app.iv .btn')].map(x => x.innerText.trim()).filter(t => /^(שלם|בקש|העבר|פתח|הצג|נקה|ייצא|החלט|סמן|בחר) /.test(t)));
    ok(r + ': no singular imperative on a button', sing.length === 0, sing);
    const bareMoney = await p.evaluate(() => [...document.querySelectorAll('.rm-app.iv:not(.is-compact) td .money')].filter(m => m.offsetParent && !m.querySelector('.cur')).length);
    ok(r + ': amounts carry ₪ in the regular rows', bareMoney === 0, bareMoney);
  }
  await role('owner');
  // one sentence per visible line, at most 12 words, on the lines the mock-ups write as sentences
  const lines = await p.evaluate(() => [...document.querySelectorAll('.rm-app.iv .iv-line, .rm-app.iv .reg-say, .rm-app.iv .reg-why, .rm-app.iv .row .why, .rm-app.iv .bx-fx li, .rm-app.iv p.bx-fx, .rm-app.iv .pr-say, .rm-app.iv .pr-off span, .rm-app.iv .pg-note, .rm-app.iv .dk-sum span, .rm-app.iv .dk-ro, .rm-app.iv .bx-ro')].map(e => { const c = e.cloneNode(true); c.querySelectorAll('small, button, .dk-also').forEach(x => x.remove()); return c.innerText.replace(/\s+/g, ' ').trim(); }).filter(Boolean));
  const bad = lines.filter(t => t.split(' ').length > 12 || (t.match(/[.!?](\s|$)/g) || []).length > 1);
  ok('written lines: one sentence, at most 12 words', bad.length === 0, bad);
  // dates
  const dts = await p.evaluate(() => [...document.querySelectorAll('.rm-app.iv')].map(a => a.innerText).join(' ').match(/\b\d{1,2}\.\d{1,2}\.\d{2,4}\b/g) || []);
  ok('dates are dd.MM.yyyy', dts.every(d => /^\d{2}\.\d{2}\.\d{4}$/.test(d)), dts.filter(d => !/^\d{2}\.\d{2}\.\d{4}$/.test(d)));

  // ---------- "who decides what"
  await p.evaluate(() => document.getElementById('dk-row-g-sh').click());
  await p.evaluate(() => document.querySelector('#dk [data-dk="rules"]').click()); await p.waitForTimeout(100);
  const rules = await T('#dk-rules');
  ok('rules card: the six lines in the product\'s order', /הסכומים לפני מע״מ, והאחוז מסכום החשבונית כולל מע״מ\..*שנראית כפולה.*הנהלת חשבונות.*פער שחוסם תשלום.*בעלים.*מעל ₪300.*בעלים.*בין ₪50 ל־₪300.*ניהול.*פער ברמת "מידע".*נסגר לבד.*כל פער אחר, גם אזהרה קטנה.*ניהול.*חשבונית שנראית כפולה/.test(rules), rules);
  ok('rules card: focus is inside, Escape closes and returns', await p.evaluate(() => document.getElementById('dk-rules').contains(document.activeElement)));
  await key('#dk-rules [data-dk="rules-close"]', 'Escape', 'Escape'); await p.waitForTimeout(100);
  ok('rules card closed, focus back on the link', await p.evaluate(() => document.getElementById('dk-rules').hidden && document.activeElement && document.activeElement.getAttribute('data-dk') === 'rules'));

  // ---------- the register: search, supplier, summary
  if (W >= 900) {
    await p.evaluate(() => { const q = document.getElementById('reg-q'); q.value = 'שטיינברג'; q.dispatchEvent(new Event('input', { bubbles: true })); }); await p.waitForTimeout(100);
    ok('search narrows the list and keeps the focus in the field', (await p.evaluate(() => document.querySelectorAll('#reg-root tbody tr').length)) >= 1 && /מוצגות \d+ מתוך 37/.test(await T('#reg-root .reg-cnt')) && await p.evaluate(() => document.activeElement.id === 'reg-q'));
    await p.evaluate(() => { const q = document.getElementById('reg-q'); q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true })); });
    await p.evaluate(() => document.querySelector('#reg-root tr[data-n="HK-24108"]').click()); await p.waitForTimeout(100);
    ok('a row opens a read-only summary: no decision buttons, a way to the decision', (await p.evaluate(() => document.querySelectorAll('#reg-root .reg-peek [data-reg="claim"], #reg-root .reg-peek [data-reg="pay"]').length)) === 0 && /להחלטה/.test(await T('#reg-root .reg-peek')));
    await p.evaluate(() => document.querySelector('#reg-root .reg-peek [data-reg="decide"]').click()); await p.waitForTimeout(200);
    ok('"להחלטה" opens the desk on that gap', (await sel()) === 'dk-row-g-hk', await sel());
    ok('the "show all" button is not shown on a wide screen', await p.evaluate(() => { const m = document.querySelector('#reg-root .reg-more'); return !m || getComputedStyle(m).display === 'none'; }));
  } else {
    ok('phone: the register shows the first eight and offers the rest', (await p.evaluate(() => [...document.querySelectorAll('#reg-root tbody tr')].filter(r => r.offsetParent).length)) === 8 && /הציגו את כל 37/.test(await T('#reg-root .reg-more')));
    const small = await p.evaluate(() => [...document.querySelectorAll('.rm-app.iv button, .rm-app.iv a.btn, .rm-app.iv select')].filter(x => x.offsetParent && !x.closest('.rm-side') && !x.closest('.rm-top')).map(x => { const r = x.getBoundingClientRect(); return [x.innerText.trim().slice(0, 24) || x.getAttribute('aria-label') || x.className, Math.round(r.width), Math.round(r.height)]; }).filter(x => x[2] < 44 && x[1] > 0));
    ok('phone: touch targets are at least 44 px high', small.length === 0, small.slice(0, 12));
  }
  ok('no script errors at the end', errs.length === 0, errs);
  console.log(out.join('\n')); console.log('\n' + (out.length - fails) + ' of ' + out.length + ' checks pass at ' + W);
  await b.close(); process.exit(fails ? 1 : 0);
})();
