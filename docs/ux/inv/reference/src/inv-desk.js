/* ---------- approvals by role: the same gaps for everyone, grouped by whom each one is with ----------
   Yours first; then the others' as real rows (decidable where the product lets you decide, read-only where not);
   then what was decided today. The evidence and the decision keep the form of the approved desk. */
var dk = document.getElementById('dk');
if (!dk) return;
var app = dk.closest('.rm-app');
var rowsEl = $('#dk-rows'), evEl = $('#dk-ev'), sumEl = $('#dk-sum'), liveEl = $('#dk-live'), rulesEl = $('#dk-rules');
var st = { sel: null, ask: false, other: false };
var say = function (t) { if (liveEl) { liveEl.textContent = ''; liveEl.textContent = t; } };
evEl.setAttribute('tabindex', '-1');
var toList = function () {
  var f = INV.narrow(app) ? (evEl.querySelector('[data-dk="claim"]') || evEl.querySelector('.ev-h') || evEl) : rowsEl;
  f.focus({ preventScroll: true });
};
var bySev = function (a, b) { return (a.sev === 'block' ? 0 : 1) - (b.sev === 'block' ? 0 : 1) || b.days - a.days; };
var groups = function () {
  var r = INV.role(), open = INV.open(), out = [];
  out.push({ k: 'mine', t: 'אצלכם', list: open.filter(INV.mine).sort(bySev), can: true, mine: true });
  ['owner', 'manager', 'bookkeeper'].forEach(function (k) {
    if (k === r.k) return;
    var l = open.filter(function (g) { return g.role === k; }).sort(bySev);
    if (l.length) out.push({ k: k, t: 'אצל ' + ROLES[k].the, list: l, can: r.can.indexOf(k) >= 0 });
  });
  var done = INV.log().map(function (e) { return e.g; });
  if (done.length) out.push({ k: 'done', t: 'הוחלט היום', list: done, done: true });
  return out;
};
var flat = function () { var o = []; groups().forEach(function (g) { o = o.concat(g.list); }); return o; };
var byId = function (id) { return INV.gaps.filter(function (g) { return g.id === id; })[0]; };
var cur = function () {
  var f = flat(), g = byId(st.sel);
  if (g && f.indexOf(g) >= 0) return g;
  return f.filter(INV.isOpen)[0] || null;
};

var renderList = function () {
  var gs = groups(), g0 = cur(), h = '', r0 = INV.role();
  gs.forEach(function (grp) {
    var sum = INV.sum(grp.list, function (g) { return g.amt; });
    h += '<div role="group" aria-label="' + grp.t + '"><div class="grp" role="presentation"><b>' + grp.t + '</b><span class="num">' + grp.list.length + '</span>' +
      (grp.list.length ? '<span class="grp-s">' + money(sum, true) + ' לפני מע״מ</span>' : '') +
      (grp.done || grp.mine ? '' : '<span class="grp-n">' + (grp.can ? 'גם אתם רשאים להחליט' : 'לקריאה בלבד') + '</span>') + '</div>';
    if (grp.mine && !grp.list.length) h += '<p class="dk-none">' + (r0.k === 'bookkeeper' ? 'חשבונית שנראית כפולה תגיע לכאן.' : r0.k === 'manager' ? 'פערים שמגיעים לניהול יופיעו כאן.' : 'פערים חדשים יופיעו כאן.') + '</p>';
    grp.list.forEach(function (g) {
      var r = INV.result(g);
      h += '<div class="row' + (r ? ' done' : '') + '" role="option" id="dk-row-' + g.id + '" aria-selected="' + (g0 === g) + '" data-g="' + g.id + '">' +
        '<span class="dot ' + (r ? '' : g.sev === 'block' ? 'dot-leak' : 'dot-warn') + '" aria-hidden="true"></span>' +
        '<span class="m"><span class="t">' + g.item + '</span><span class="s">' + g.inv.sup + ' · <bdi dir="ltr">' + g.inv.n + '</bdi></span>' +
        (r ? '' : '<span class="why">' + INV.rule(g) + '</span>') + '</span>' +
        '<span class="e"><span class="amt">' + money(g.amt, false, true) + '</span>' +
        (r ? '<span class="res">' + (r.how === 'claim' ? INV.doneT(r.how) + ' · ' + ROLES[r.by].t : 'הפער: שולם כפי שחויב') + '</span>' : '<span class="due">' + (g.esc ? 'מהיום' : nDays(g.days)) + '</span>') + '</span></div>';
    });
    h += '</div>';
  });
  rowsEl.innerHTML = h;
  if (g0) rowsEl.setAttribute('aria-activedescendant', 'dk-row-' + g0.id); else rowsEl.removeAttribute('aria-activedescendant');
  var mayAct = INV.open().some(INV.can), mayEsc = r0.k === 'manager' && INV.open().some(INV.mine);
  var mayUndo = app.classList.contains('has-undo');
  rowsEl.setAttribute('aria-label', 'רשימת הפערים. החצים או J ו־K למעבר' + (mayAct ? ', 1 לבקשת זיכוי, 2 לתשלום כפי שחויב' + (mayEsc ? ', 3 להעברה לבעלים' : '') : '') + (mayAct || mayUndo ? ', Z לביטול' : ''));
  dk.classList.toggle('is-manager', r0.k === 'manager');
  var open = INV.open(), mine = open.filter(INV.mine), held = open.map(function (g) { return g.inv; });
  var l1 = mine.length ? (mine.length === 1 ? 'פער אחד אצלכם, ' : '<b class="num">' + mine.length + '</b> פערים אצלכם, ') + '<b>' + money(INV.sum(mine, function (g) { return g.amt; }), true) + '</b> לפני מע״מ.'
    : open.length ? 'אין פער שמחכה לכם.' : 'אין פערים פתוחים.';
  var l2 = held.length ? (held.length === 1 ? 'חשבונית אחת' : '<b class="num">' + held.length + '</b> חשבוניות') + ' עם פער פתוח, <b>' + money(INV.sum(held, function (x) { return x.total; }), true) + '</b> כולל מע״מ.' : '';
  sumEl.innerHTML = '<span>' + l1 + '</span>' + (l2 ? '<span>' + l2 + '</span>' : '');
  dk.classList.toggle('can-act', !!(g0 && INV.isOpen(g0) && INV.can(g0)));
  dk.classList.toggle('can-esc', !!(g0 && INV.isOpen(g0) && INV.mine(g0) && r0.k === 'manager'));
};
var cell = function (v, unit, flagged, delta, isMoney, tone) {
  if (v == null) return '<td class="na">אין מחיר בקבלה</td>';
  return '<td' + (flagged ? ' class="off' + (tone === 'warn' ? ' is-warn' : '') + '"' : '') + '><div class="v">' + (isMoney ? money(v) : '<span>' + v + '</span><small>' + unit + '</small>') +
    (flagged ? '<span class="delta">' + delta + '</span>' : '') + '</div></td>';
};
var q = function (n) { return String(n).replace(/\.0$/, ''); };
var renderEv = function () {
  var g = cur(), f = flat();
  if (!g) {
    evEl.innerHTML = '<div class="ev-empty"><span class="ic">' + icon('check') + '</span><b>הכול מטופל</b><span>פערים חדשים יופיעו כאן</span></div>';
    return;
  }
  var x = g.inv, l = x.lines[g.line], r = INV.result(g), can = INV.can(g), tone = r ? 'done' : g.sev === 'block' ? 'leak' : 'warn', pos = f.indexOf(g) + 1;
  var u = g.unit, per = g.unit === 'חביות' ? 'מחיר לחבית' : 'מחיר ל' + g.unit;
  var around = x.lines.map(function (v, i) { return [v, i]; }).filter(function (p) { return Math.abs(p[1] - g.line) <= 1; });
  var paper = '<div class="pl ph"><span>' + x.sup + ' · <bdi dir="ltr">' + x.n + '</bdi></span><span>כמות</span><span>מחיר</span><span>סה״כ</span></div>' + around.map(function (p) {
    var v = p[0]; return '<div class="pl' + (p[1] === g.line ? ' hit' : '') + '"><span>' + v[0] + '</span><span>' + q(v[3]) + '</span><span>' + v[5].toFixed(2) + '</span><span>' + (v[3] * v[5]).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '</span></div>'; }).join('');
  var bar;
  if (r) bar = '<span class="was">' + icon('check') + INV.doneT(r.how) + '</span><span class="hint"><bdi dir="ltr">' + INV.when(r.seq) + '</bdi> · ' + ROLES[r.by].t + (r.reason ? ' · ' + r.reason : '') + '</span>';
  else if (!can) bar = '<span class="dk-ro">ההחלטה אצל ' + ROLES[g.role].the + ', ואין צורך בפעולה מצדכם.</span>';
  else if (st.ask && st.other) bar = '<div class="reasons" role="group" tabindex="-1" aria-label="סיבה אחרת לתשלום כפי שחויב"><label class="iv-other"><span class="q">הסיבה</span><input type="text" id="dk-other" maxlength="120" autocomplete="off" aria-required="true" aria-describedby="dk-other-h"></label><span class="sr" id="dk-other-h">כתבו סיבה כדי להמשיך</span>' +
    '<button class="btn btn-secondary btn-sm" data-dk="other-ok" disabled>שלמו כפי שחויב</button><button class="btn btn-quiet btn-sm" data-dk="back" aria-keyshortcuts="Escape">חזרה <kbd aria-hidden="true">Esc</kbd></button></div>';
  else if (st.ask) bar = '<div class="reasons" role="group" aria-label="למה לשלם כפי שחויב"><span class="q">למה לשלם כפי שחויב?</span><button class="btn btn-quiet btn-sm" data-dk="back" aria-keyshortcuts="Escape">חזרה <kbd aria-hidden="true">Esc</kbd></button><span class="chips">' +
    INV.reasons(g).map(function (t, i) { return '<button class="chip" data-dk="reason" data-i="' + i + '">' + t + '</button>'; }).join('') + '</span></div>';
  else {
    var left = INV.open().filter(function (v) { return INV.can(v) && v !== g; }).length;
    bar = '<button class="btn btn-primary btn-lg" data-dk="claim" aria-keyshortcuts="1">בקשת זיכוי · ' + money(g.amt, true) + '<kbd aria-hidden="true">1</kbd></button>' +
      '<button class="btn btn-secondary btn-lg" data-dk="pay" aria-keyshortcuts="2">שלמו כפי שחויב<kbd aria-hidden="true">2</kbd></button>' +
      (INV.mine(g) && INV.role().k === 'manager' ? '<button class="btn btn-quiet btn-lg" data-dk="esc" aria-keyshortcuts="3">העבירו לבעלים<kbd aria-hidden="true">3</kbd></button>' : '') +
      '<span class="sp"></span><span class="hint">' + (left > 1 ? 'אחריו נשארים עוד ' + left + ' פערים' : left === 1 ? 'אחריו נשאר עוד פער אחד' : INV.mine(g) ? 'הפער האחרון שמחכה לכם' : 'הפער האחרון שנשאר פתוח') + '</span>';
  }
  evEl.innerHTML = '<div class="ev-scroll"><div class="ev-top">' +
    (r ? '<span class="st">' + INV.doneT(r.how) + '</span>' : '<span class="st ' + (g.sev === 'block' ? 'st-solid' : 'st-warn') + '">' + (g.sev === 'block' ? 'חוסם תשלום' : 'אזהרה') + '</span>') +
    '<span class="sp"></span><span class="ev-pos">' + pos + ' מתוך ' + f.length + '</span><span class="ev-nav"><button class="rm-ico" data-dk="up" aria-label="הפער הקודם"' + (pos === 1 ? ' disabled' : '') + '>' + icon('down', 'up') + '</button><button class="rm-ico" data-dk="down" aria-label="הפער הבא"' + (pos === f.length ? ' disabled' : '') + '>' + icon('down') + '</button></span></div>' +
    '<h2 class="ev-h" aria-level="5" tabindex="-1">' + g.title + '</h2><p class="ev-meta">' + g.item + ' · ' + x.sup + ' · <a href="#invoice" data-dk="open"><bdi dir="ltr">' + x.n + '</bdi></a></p>' +
    (r ? '' : '<p class="iv-line dk-who' + (INV.mine(g) ? ' is-me' : '') + '">' + icon('users') + '<span>' + INV.line(g) + '</span>' + (can && !INV.mine(g) ? '<span class="dk-also">גם אתם רשאים להחליט</span>' : '') + '<button class="dk-why" data-dk="rules">מי מחליט על מה</button></p>') +
    '<div class="match' + (tone === 'warn' ? ' is-warn' : tone === 'done' ? ' is-done' : '') + '"><table><thead><tr><td></td><th scope="col"><b>הוזמן</b><span>הזמנה מ־<bdi dir="ltr">' + x.po + '</bdi></span></th><th scope="col"><b>התקבל</b><span>נספר, <bdi dir="ltr">' + x.gr + '</bdi></span></th><th scope="col"><b>חויב</b><span>חשבונית <bdi dir="ltr">' + x.n + '</bdi></span></th></tr></thead><tbody>' +
    '<tr><th scope="row">כמות</th>' + cell(q(l[1]), u) + cell(q(l[2]), u, g.kind === 'qty', q(Math.round((l[3] - l[2]) * 10) / 10) + ' ' + u + ' פחות', false, tone) + cell(q(l[3]), u) + '</tr>' +
    '<tr><th scope="row">' + per + '<small>לפני מע״מ</small></th>' + cell(l[4].toFixed(2), '', false, '', true) + cell(null) + cell(l[5].toFixed(2), '', g.kind === 'price', (g.pct != null ? g.pct.toFixed(1) + '% יותר' : ''), true, tone) + '</tr></tbody></table></div>' +
    '<div class="calc"><span>' + g.calc[1] + '</span><span class="op">=</span><span class="res">' + money(g.amt) + '</span><span class="sp"></span><span class="why">לפני מע״מ</span></div>' +
    '<div class="doc"><div class="paper' + (tone === 'warn' ? ' is-warn' : tone === 'done' ? ' is-done' : '') + '" role="img" aria-label="השורה בחשבונית מהספק">' + paper + '</div></div></div>' +
    '<div class="ev-bar">' + bar + '</div>';
};
var render = function () { renderList(); renderEv(); };
var go = function (d) { var f = flat(), i = f.indexOf(cur()), n = f[Math.max(0, Math.min(f.length - 1, i + d))]; if (n) { st.sel = n.id; st.ask = false; render(); var el = document.getElementById('dk-row-' + n.id); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); } };
/* a key pressed on a gap the person may not decide says why, and does nothing */
var refuse = function (g) { say('ההחלטה אצל ' + ROLES[g.role].the + ', ואין צורך בפעולה מצדכם.'); var ro = evEl.querySelector('.dk-ro'); if (ro) { ro.classList.remove('is-nudge'); void ro.offsetWidth; ro.classList.add('is-nudge'); } };
var decide = function (how, reason) {
  var g = cur(); if (!g || !INV.isOpen(g)) return;
  if (!INV.can(g)) { refuse(g); return; }
  var next = INV.open().filter(function (v) { return v !== g && INV.can(v); }).sort(function (a, b) { return (INV.mine(a) ? 0 : 1) - (INV.mine(b) ? 0 : 1) || bySev(a, b); })[0];
  st.ask = false; st.sel = next ? next.id : null;
  INV.act(app, g, how, reason, function () { st.sel = g.id; render(); toList(); });
};
var askWhy = function () {
  var g = cur(); if (!g || !INV.isOpen(g)) return;
  if (!INV.can(g)) { refuse(g); return; }
  st.ask = true; st.other = false; renderEv(); var c = evEl.querySelector('.reasons .chip'); if (c) c.focus({ preventScroll: true });
};
var escalate = function () {
  var g = cur(); if (!g || !INV.isOpen(g) || !INV.mine(g) || INV.role().k !== 'manager') return;
  if (INV.escalate(g)) INV.toast(app, 'הועבר לבעלים, ' + g.inv.sup, function () { INV.unescalate(g); toList(); }, 'ההעברה בוטלה.');
};
dk.addEventListener('click', function (e) {
  var b = e.target.closest ? e.target.closest('[data-dk]') : null, row = e.target.closest ? e.target.closest('.row[data-g]') : null;
  if (b && !b.disabled) {
    var a = b.getAttribute('data-dk');
    if (a === 'up' || a === 'down') { go(a === 'down' ? 1 : -1); var again = evEl.querySelector('[data-dk="' + a + '"]'); if (again && !again.disabled) again.focus({ preventScroll: true }); else toList(); }
    /* the second press of a double press does not decide the next gap too (the product dims the buttons while it saves) */
    else if (a === 'claim') { if (e.detail > 1) return; decide('claim'); toList(); }
    else if (a === 'pay') askWhy();
    else if (a === 'back') {
      if (st.other) { st.other = false; renderEv(); var c2 = evEl.querySelector('.reasons .chip'); if (c2) c2.focus({ preventScroll: true }); }
      else { st.ask = false; renderEv(); var p = evEl.querySelector('[data-dk="pay"]'); if (p) p.focus({ preventScroll: true }); }
    }
    else if (a === 'reason') {
      var why = INV.reasons(cur())[Number(b.getAttribute('data-i'))];
      if (why === 'אחר') { st.other = true; renderEv(); var inp = document.getElementById('dk-other'); if (inp) inp.focus({ preventScroll: true }); }
      else { decide('pay', why); toList(); }
    }
    else if (a === 'other-ok') { var txt = (document.getElementById('dk-other').value || '').trim(); if (txt) { st.other = false; decide('pay', 'אחר: ' + INV.esc(txt)); toList(); } }
    else if (a === 'esc') { escalate(); toList(); }
    else if (a === 'open') { e.preventDefault(); INV.focus(cur().inv.n, true); }
    else if (a === 'rules') openRules(b);
    else if (a === 'rules-close') closeRules();
    return;
  }
  if (row) { st.sel = row.getAttribute('data-g'); st.ask = false; render(); toList(); }
});
rowsEl.addEventListener('keydown', function (e) {
  var k = INV.key(e);
  if (k === 'down') { e.preventDefault(); go(1); }
  else if (k === 'up') { e.preventDefault(); go(-1); }
  else if (k === '1') { e.preventDefault(); decide('claim'); }
  else if (k === '2') { e.preventDefault(); askWhy(); }
  else if (k === '3') { e.preventDefault(); escalate(); }
  else if (k === 'z') { var u = app.querySelector('.iv-toast:not([hidden]) [data-iv="undo"]'); if (u) { e.preventDefault(); u.click(); } }
  else if (e.code === 'Home' || e.code === 'End' || e.code === 'PageUp' || e.code === 'PageDown') { e.preventDefault(); go(e.code === 'Home' ? -99 : e.code === 'End' ? 99 : e.code === 'PageUp' ? -3 : 3); }
  else if (k === 'space') e.preventDefault();
});
dk.addEventListener('keydown', function (e) {
  if (INV.key(e) === 'enter' && e.target && e.target.id === 'dk-other') { e.preventDefault(); var ok = evEl.querySelector('[data-dk="other-ok"]'); if (ok && !ok.disabled) ok.click(); return; }
  if (INV.key(e) !== 'esc') return;
  if (!rulesEl.hidden) { closeRules(); return; }
  if (st.ask) { st.ask = false; st.other = false; renderEv(); toList(); }
});
dk.addEventListener('input', function (e) { if (e.target.id === 'dk-other') { var ok = evEl.querySelector('[data-dk="other-ok"]'); if (ok) ok.disabled = !e.target.value.trim(); } });
/* "who decides what": the product's routing in plain words, with the restaurant's own numbers.
   The order is the order the product checks them in; the first that fits decides. */
var rulesFrom = null;
var openRules = function (from) {
  rulesFrom = from;
  rulesEl.innerHTML = '<div class="rl-card" role="dialog" aria-modal="true" aria-labelledby="rl-h"><div class="rl-top"><h2 id="rl-h" aria-level="5">מי מחליט על מה</h2><button class="rm-ico" data-dk="rules-close" aria-label="סגירה">' + icon('x') + '</button></div>' +
    '<p class="rl-lede">כל פער מגיע לתפקיד שמחליט עליו, והכלל הראשון שמתאים קובע.</p>' +
    '<p class="rl-base">הסכומים לפני מע״מ, והאחוז מסכום החשבונית כולל מע״מ.</p>' +
    '<table class="rl-tb"><thead><tr><th scope="col">מה נמצא</th><th scope="col">אצל מי</th></tr></thead><tbody>' +
    [['חשבונית שנראית כפולה', 'הנהלת חשבונות'], ['פער שחוסם תשלום', 'בעלים'],
      ['הפערים בחשבונית מעל <span class="num">₪300</span>, או מעל <span class="num">5%</span>', 'בעלים'],
      ['הפערים בחשבונית בין&nbsp;<span class="num">₪50</span>&nbsp;ל־<span class="num">₪300</span>, או בין&nbsp;<span class="num">2%</span>&nbsp;ל־<span class="num">5%</span>', 'ניהול'],
      ['פער ברמת "מידע", כשהפערים בחשבונית עד <span class="num">₪50</span> ועד <span class="num">2%</span>', 'נסגר לבד'], ['כל פער אחר, גם אזהרה קטנה', 'ניהול']]
      .map(function (r) { return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>'; }).join('') + '</tbody></table>' +
    '<p class="rl-sub">מה חוסם תשלום</p><ul class="rl-list"><li>חיוב על יותר ממה שהתקבל</li><li>מחיר שעלה ב־10% ומעלה</li><li>פריט או חשבונית בלי הזמנה</li><li>סכום שלא תואם לשורות</li><li>חשבונית שנראית כפולה</li></ul>' +
    '<p class="rl-sub">מה נחשב מידע</p><ul class="rl-list"><li>מחיר נמוך מהמצופה</li><li>סטייה קטנה בכמות</li></ul>' +
    '<p class="rl-note">הבעלים יכולים להחליט גם על פער שהגיע לניהול או להנהלת החשבונות.</p>' +
    '<p class="rl-note">את הסכומים והאחוזים משנים הבעלים במסך ההגדרות.</p></div>';
  rulesEl.hidden = false; var x = rulesEl.querySelector('[data-dk="rules-close"]'); if (x) x.focus({ preventScroll: true });
};
var closeRules = function () { rulesEl.hidden = true; rulesEl.innerHTML = ''; if (rulesFrom && document.contains(rulesFrom)) rulesFrom.focus({ preventScroll: true }); else { var w = evEl.querySelector('[data-dk="rules"]'); if (w) w.focus({ preventScroll: true }); } };
rulesEl.addEventListener('click', function (e) { if (e.target === rulesEl) closeRules(); });
rulesEl.addEventListener('keydown', function (e) {
  /* the card holds the focus while it is open */
  if (e.key !== 'Tab') return;
  var f = $$('button, a[href]', rulesEl); if (!f.length) return;
  var first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});
INV.on(function (why) {
  if (why === 'role') { st.sel = null; if (!rulesEl.hidden) { rulesEl.hidden = true; rulesEl.innerHTML = ''; } }
  if (why === 'desk') { var id = INV.deskSel(); if (id) st.sel = id; }
  if (why !== 'fit' && why !== 'focus') { st.ask = false; st.other = false; }
  render();
  if (why === 'desk') toList();
});
render();
