/* ---------- the register: every invoice of the month, and where each one stands ----------
   The first line says what waits for the person who looks. The cards are the places the month's money is in.
   A row never decides: it opens a read-only summary, and the decision is made on the invoice or on the desk. */
var root = document.getElementById('reg-root');
if (!root) return;
var app = root.closest('.rm-app');
var st = { tab: 'all', q: '', sup: '', sel: null, more: false };
var tabOf = function (x) { var k = INV.state(x); return k === 'flagged_open' || k === 'held_duplicate' ? 'decide' : k === 'paid' ? 'paid' : k === 'clean' || k === 'claim_open' || k === 'approved' ? 'ok' : 'wait'; };
/* the place an invoice is in, as the cards name it */
var placeOf = function (x) { return INV.state(x) === 'flagged_open' ? 'r-' + x.gap.role : tabOf(x) === 'ok' && x.needsAlloc && !x.alloc ? 'alloc' : tabOf(x); };
/* what waits for the person who looks comes first, then what waits for others (blocking before warning, the longest
   wait first), then what waits for a document, what is clear, and what is marked paid; newest first inside each */
var rank = function (x) {
  var t = tabOf(x);
  if (t === 'decide') return [0, INV.mine(x.gap) ? 0 : 1, x.gap.sev === 'block' ? 0 : 1, -x.gap.days];
  return [t === 'wait' ? 1 : t === 'ok' ? 2 : 3, 0, 0, 0];
};
var dKey = function (d) { var p = d.split('.'); return p[2] + p[1] + p[0]; };
var sorted = function (list) {
  return list.slice().sort(function (a, b) {
    var ra = rank(a), rb = rank(b);
    for (var i = 0; i < 4; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
    return dKey(b.date) < dKey(a.date) ? -1 : dKey(b.date) > dKey(a.date) ? 1 : 0;
  });
};
var shown = function () {
  var q = st.q.trim().toLowerCase();
  return sorted(INV.invs.filter(function (x) {
    return (st.tab === 'all' || placeOf(x) === st.tab) && (!st.sup || x.sup === st.sup) && (!q || x.sup.toLowerCase().indexOf(q) >= 0 || x.n.toLowerCase().indexOf(q) >= 0);
  }));
};
var narrow = function () { return INV.narrow(app); };
var dense = function () { return INV.role().k === 'bookkeeper' && !narrow(); };
/* in the regular rows every amount carries its ₪; in the bookkeeper's dense rows the ₪ is in the column head */
var cash = function (n) { return dense() ? amt(n) : money(n, false, true); };
/* with whom, since when, and the rule that sent it there; empty when nobody has to act */
var whoCell = function (x) {
  var k = INV.state(x), g = x.gap;
  if (k === 'flagged_open') {
    return '<span class="reg-who' + (INV.mine(g) ? ' is-me' : '') + '"><b title="' + (INV.mine(g) ? 'הגיע ' + ROLES[g.role].to : '') + '">' + INV.who(g) + '</b><small> · ' + (g.esc ? 'מהיום' : nDays(g.days)) + '</small></span>' +
      '<span class="reg-why">' + INV.rule(g) + '</span>';
  }
  if (g && INV.result(g)) { var r = INV.result(g); return '<span class="reg-who is-sys">הפער: ' + INV.doneT(r.how) + '</span><span class="reg-why">הוחלט היום · ' + ROLES[r.by].t + '</span>'; }
  if (k === 'awaiting_link') return '<span class="reg-who is-sys">' + (x.cons ? 'השיוך לתעודות המשלוח עוד לא פעיל' : 'מחכה לשיוך להזמנה') + '</span>';
  return '';
};
var dueCell = function (x) {
  if (!x.due) return '';
  return '<span class="nar-only">לתשלום עד </span><bdi class="id">' + x.due + '</bdi>' + (INV.state(x) !== 'paid' && x.left != null ? '<small class="reg-left">' + (x.left === 0 ? 'היום האחרון' : 'נותרו ' + nDays(x.left)) + '</small>' : '');
};
var rowHtml = function (x) {
  var k = INV.state(x), open = k === 'flagged_open';
  return '<tr tabindex="-1" data-n="' + x.n + '"' + (st.sel === x.n ? ' aria-current="true"' : '') + ' class="' + (open ? 'is-open' : 'is-calm') + '">' +
    '<td class="reg-sup">' + x.sup + '</td><td><bdi class="id">' + x.n + '</bdi></td><td class="reg-date"><bdi class="id">' + x.date + '</bdi></td>' +
    '<td class="n" data-la="כולל מע״מ">' + cash(x.total) + '</td><td class="reg-due">' + dueCell(x) + '</td><td>' + INV.pill(x) + '</td><td class="reg-whoc">' + whoCell(x) + '</td>' +
    '<td class="n reg-gap"' + (x.gapAmt ? ' data-l="פער לפני מע״מ"' : '') + '>' + (x.gapAmt ? cash(x.gapAmt) : '') + '</td></tr>';
};
/* what the place with no open gap holds: clear invoices, and invoices whose gap is now in a credit request */
var okNote = function (l) {
  var c = l.filter(function (x) { return INV.state(x) === 'claim_open'; }).length;
  return !c ? 'כולן תקינות' : c === 1 ? 'אחת מהן בבקשת זיכוי' : c + ' מהן בבקשת זיכוי';
};
var sups = INV.invs.map(function (x) { return x.sup; }).filter(function (s, i, a) { return a.indexOf(s) === i; }).sort(function (a, b) { return a.localeCompare(b, 'he'); });
/* the first gap the person who looks may decide: their own first */
var firstMine = function () {
  var o = INV.open().filter(INV.can).sort(function (a, b) { return (INV.mine(a) ? 0 : 1) - (INV.mine(b) ? 0 : 1) || (a.sev === 'block' ? 0 : 1) - (b.sev === 'block' ? 0 : 1) || b.days - a.days; });
  return o[0] || null;
};
/* one sentence on top: what waits for you, and what waits for others */
var headline = function () {
  var open = INV.open(), mine = open.filter(INV.mine), rest = open.filter(function (g) { return !INV.mine(g); });
  var sum = function (l) { return money(INV.sum(l, function (g) { return g.amt; }), true); };
  var whoRest = function () { var roles = rest.map(function (g) { return g.role; }).filter(function (r, i, a) { return a.indexOf(r) === i; }); return roles.length === 1 ? 'אצל ' + ROLES[roles[0]].the : 'אצל אחרים'; };
  if (!open.length) return 'אין פערים פתוחים החודש.';
  var wait = mine.length === 1 ? 'פער של ' + sum(mine) + ' לפני מע״מ מחכה לכם' : 'פערים של ' + sum(mine) + ' לפני מע״מ מחכים לכם';
  if (mine.length && rest.length) return wait + ', ועוד ' + sum(rest) + ' ' + whoRest() + '.';
  if (mine.length) return wait + '.';
  return 'אין פער שמחכה לכם, ' + (rest.length === 1 ? 'ופער של ' : 'ופערים של ') + sum(rest) + ' לפני מע״מ ' + whoRest() + '.';
};

var peekHtml = function (x) {
  var k = INV.state(x), g = x.gap, h = '';
  h += '<div class="pk-top"><b class="pk-t"><bdi class="id">' + x.n + '</bdi> · ' + x.sup + '</b><button class="rm-ico" data-reg="close" aria-label="סגירת התקציר">' + icon('x') + '</button></div>';
  h += '<div class="pk-meta">' + INV.pill(x) + '<span><bdi class="id">' + x.date + '</bdi></span></div>';
  h += '<dl class="pk-dl"><div><dt>סכום, כולל מע״מ</dt><dd>' + money(x.total) + '</dd></div>' +
    (x.due ? '<div><dt>לתשלום עד</dt><dd><bdi class="id">' + x.due + '</bdi>' + (k !== 'paid' && x.left != null ? '<small> · נותרו ' + nDays(x.left) + '</small>' : '') + '</dd></div>' : '') + '</dl>';
  if (g && k === 'flagged_open') {
    h += '<div class="pk-gap"><p class="iv-line">' + INV.line(g) + '</p>' +
      '<p class="pk-item"><b>' + g.title + '</b> · ' + g.item + '</p>' +
      '<p class="pk-calc">' + g.calc[0] + '</p><p class="pk-calc"><span>' + g.calc[1] + ' =</span> ' + money(g.amt) + ' <small>לפני מע״מ</small></p>';
    h += INV.can(g)
      ? '<div class="pk-act"><button class="btn btn-secondary btn-sm" data-reg="decide">להחלטה</button></div>'
      : '<p class="pk-ro">ההחלטה אצל ' + ROLES[g.role].the + '.</p>';
    h += '</div>';
  } else if (g && INV.result(g)) {
    var r = INV.result(g);
    h += '<div class="pk-gap"><p class="pk-item"><b>' + (r.how === 'claim' ? 'נוסף לבקשת הזיכוי' : 'הפער נסגר, שולם כפי שחויב') + '</b> · ' + (r.how === 'claim' ? '' : 'פער של ') + money(g.amt) + ' <small>לפני מע״מ</small></p><p class="pk-calc">הוחלט היום · ' + ROLES[r.by].t + (r.reason ? ' · ' + r.reason : '') + '</p></div>';
  } else if (k === 'awaiting_link') {
    h += '<p class="pk-note">' + (x.cons ? 'חשבונית מרכזת.' : 'החשבונית מחכה לשיוך להזמנה.') + '</p>' + (x.cons ? '<p class="pk-note">השיוך שלה לתעודות המשלוח עוד לא פעיל.</p>' : '') +
      '<p class="pk-note">עד השיוך היא לא נספרת בדליפה או בהוצאה.</p>';
  } else if (k === 'paid') {
    h += '<p class="pk-note">מסומנת כשולמה בנתוני ההדגמה.</p>' + (x.gapAmt ? '<p class="pk-note">נמצא בה פער של ' + money(x.gapAmt) + ' לפני מע״מ.</p>' : '');
  } else {
    h += '<p class="pk-note">הותאמה להזמנה ולקבלת הסחורה, בלי פער.</p>';
  }
  if (x.lines) h += '<a class="pk-open" href="#invoice" data-reg="open">פתחו את החשבונית' + icon('prev') + '</a>';
  return h;
};

var paint = function (keepFocus) {
  var all = INV.invs, places = INV.places();
  if (st.tab !== 'all' && !places.filter(function (p) { return p.k === st.tab && p.list.length; }).length) st.tab = 'all';
  var list = shown(), d = dense(), first = firstMine();
  var had = keepFocus && root.contains(document.activeElement) ? document.activeElement.getAttribute('data-n') : null;
  var tot = INV.sum(list, function (x) { return x.total; }), gp = INV.sum(list, function (x) { return x.gapAmt || 0; });
  var gpOpen = INV.sum(list.filter(function (x) { return INV.state(x) === 'flagged_open'; }), function (x) { return x.gapAmt || 0; });
  var x = st.sel ? all.filter(function (v) { return v.n === st.sel; })[0] : null;
  var openAll = all.filter(function (v) { return INV.state(v) === 'flagged_open'; }), gpOpenAll = INV.sum(openAll, function (v) { return v.gapAmt || 0; });
  var nar = narrow(), cut = nar && !st.more && list.length > 8;
  var h = '<div class="reg-main"><div class="reg-head"><h1 aria-level="4" tabindex="-1">חשבוניות</h1><span class="reg-month"><bdi>' + INV.D.month + '</bdi></span><span class="sp"></span>' +
    '<label class="reg-q">' + icon('search') + '<span class="sr">חיפוש ספק או מספר חשבונית</span><input type="search" id="reg-q" placeholder="ספק או מספר חשבונית" value="' + INV.esc(st.q) + '" autocomplete="off"></label></div>' +
    '<div class="reg-lead"><p class="reg-say">' + headline() + '</p>' +
    (first ? '<button class="btn btn-primary" data-reg="first">להחלטה</button>' : INV.open().length ? '<a class="btn btn-secondary" href="#approvals" data-reg="desk">למסך האישורים</a>' : '') + '</div>' +
    '<div class="reg-map" role="group" aria-label="איפה הכסף של החודש, הסכומים כוללים מע״מ">' +
    places.map(function (p) {
      return '<button class="reg-pl' + (p.tone ? ' is-' + p.tone : '') + '" data-tab="' + p.k + '" aria-pressed="' + (st.tab === p.k) + '">' +
        '<span class="pl-t">' + (p.tone ? '<i class="dot dot-' + p.tone + '"></i>' : '') + p.t + '<span class="c">' + p.list.length + '</span></span>' +
        '<span class="pl-v">' + money(p.sum) + '<small>כולל מע״מ</small></span>' +
        '<span class="pl-s">' + (p.gaps ? (p.list.length === 1 ? 'פער של ' : 'פערים של ') + money(p.gaps, true) + ' לפני מע״מ' : p.k === 'wait' ? 'חשבוניות מרכזות' : p.k === 'alloc' ? 'צריך לבקש מהספק' : p.k === 'ok' ? okNote(p.list) : 'בנתוני ההדגמה') + '</span></button>';
    }).join('') +
    '<button class="reg-pl is-all" data-tab="all" aria-pressed="' + (st.tab === 'all') + '"><span class="pl-t">כל החודש<span class="c">' + all.length + '</span></span><span class="pl-v">' + money(INV.D.sums.all) + '<small>כולל מע״מ</small></span><span class="pl-s">' + (openAll.length ? (openAll.length === 1 ? 'פער פתוח של ' : 'פערים פתוחים של ') + money(gpOpenAll, true) + ' לפני מע״מ' : 'אין פערים פתוחים') + '</span></button></div>' +
    '<div class="reg-bar"><span class="reg-cnt">' + (cut ? 'מוצגות 8 מתוך ' + list.length + (st.tab === 'all' && !st.q && !st.sup ? '' : ' שמתאימות') : st.tab === 'all' && !st.q && !st.sup ? 'כל ' + all.length + ' החשבוניות של החודש' : list.length === 1 ? 'מוצגת חשבונית אחת מתוך ' + all.length : 'מוצגות ' + list.length + ' מתוך ' + all.length) + '</span><span class="sp"></span><label class="reg-sel"><span class="sr">סינון לפי ספק</span><select id="reg-sup"><option value="">כל הספקים</option>' +
    sups.map(function (s) { return '<option' + (st.sup === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select>' + icon('down') + '</label></div>';
  if (!list.length) {
    h += '<div class="reg-empty"><b>' + (st.q || st.sup ? 'אין חשבונית שמתאימה לסינון' : 'אין כאן חשבוניות') + '</b>' +
      (st.q || st.sup ? '<button class="btn btn-secondary btn-sm" data-reg="clear">נקו את הסינון</button>' : '') + '</div>';
  } else {
    h += '<div class="tb-wrap"><table class="tb reg-tb"><caption class="sr">חשבוניות החודש. Enter על שורה פותח את התקציר שלה.</caption><thead><tr><th>ספק</th><th>מספר</th><th class="reg-date">תאריך</th><th class="n">' + (d ? 'סכום, ₪ כולל מע״מ' : 'סכום כולל מע״מ') + '</th><th class="reg-due">לתשלום עד</th><th>מצב</th><th>' + (x ? 'אצל מי' : 'אצל מי ולמה') + '</th><th class="n">' + (d ? 'פער, ₪ לפני מע״מ' : 'פער לפני מע״מ') + '</th></tr></thead><tbody>' +
      list.map(rowHtml).join('') + '</tbody><tfoot><tr><td colspan="2">סך הכול, ' + nInv(list.length) + '</td><td class="reg-date"></td><td class="n" data-la="כולל מע״מ">' + cash(tot) + '</td><td class="reg-due"></td><td colspan="2"></td><td class="n">' + (gp ? cash(gp) + (gpOpen && gpOpen !== gp ? '<small class="reg-open">פתוח ' + money(gpOpen, true) + '</small>' : '') : '') + '</td></tr></tfoot></table></div>';
  }
  if (list.length > 8) h += '<button class="btn btn-secondary reg-more" data-reg="more">' + (st.more ? 'הציגו פחות' : 'הציגו את כל ' + list.length) + '</button>';
  h += '</div><aside class="reg-peek" aria-label="תקציר החשבונית"' + (x ? '' : ' hidden') + '>' + (x ? peekHtml(x) : '') + '</aside>';
  root.innerHTML = h; root.classList.toggle('has-peek', !!x); root.classList.toggle('is-all', st.more);
  var rows = $$('tbody tr', root), selIn = !!st.sel && rows.some(function (r) { return r.getAttribute('data-n') === st.sel; });
  rows.forEach(function (r, i) { r.tabIndex = (selIn ? r.getAttribute('data-n') === st.sel : i === 0) ? 0 : -1; });
  if (had) { var again = rows.filter(function (r) { return r.getAttribute('data-n') === had; })[0]; if (again) again.focus({ preventScroll: true }); }
};
var select = function (n, focusPeek) {
  st.sel = n; paint(true);
  if (n) { var r = root.querySelector('tr[data-n="' + n + '"]'); if (r && !focusPeek) r.focus({ preventScroll: true });
    if (r && narrow()) { var toc = document.querySelector('.toc'); window.scrollBy({ top: r.getBoundingClientRect().top - (toc ? toc.getBoundingClientRect().bottom : 0) - 12, behavior: reduce ? 'instant' : 'smooth' }); } if (focusPeek) { var b = root.querySelector('.reg-peek .btn, .reg-peek [data-reg="open"], .reg-peek [data-reg="close"]'); if (b) b.focus({ preventScroll: true }); } }
};
root.addEventListener('click', function (e) {
  var t = e.target, b;
  if ((b = t.closest('[data-tab]'))) { st.tab = b.getAttribute('data-tab'); st.sel = null; paint(); root.querySelector('[data-tab="' + st.tab + '"]').focus({ preventScroll: true }); return; }
  if ((b = t.closest('[data-reg]'))) {
    var a = b.getAttribute('data-reg'), x = INV.invs.filter(function (v) { return v.n === st.sel; })[0];
    if (a === 'close') { var n = st.sel; st.sel = null; paint(); var r = root.querySelector('tr[data-n="' + n + '"]'); if (r) r.focus({ preventScroll: true }); }
    else if (a === 'clear') { st.q = ''; st.sup = ''; paint(); var q0 = narrow() ? root.querySelector('tbody tr[tabindex="0"]') : document.getElementById('reg-q'); if (q0) q0.focus({ preventScroll: true }); }
    else if (a === 'more') {
      st.more = !st.more; paint();
      var m = root.querySelector('[data-reg="more"]'), ninth = st.more ? root.querySelectorAll('tbody tr')[8] : null;
      if (ninth) { $$('tbody tr', root).forEach(function (v) { v.tabIndex = -1; }); ninth.tabIndex = 0; ninth.focus({ preventScroll: true }); }
      else if (m) { m.focus({ preventScroll: true }); if (m.scrollIntoView) m.scrollIntoView({ block: 'center', behavior: 'instant' }); }
    }
    else if (a === 'open') { e.preventDefault(); INV.focus(x.n, true); }
    else if (a === 'first') INV.toDesk(firstMine());
    else if (a === 'desk') { e.preventDefault(); INV.toDesk(null); }
    else if (a === 'decide' && x && x.gap) INV.toDesk(x.gap);
    return;
  }
  if ((b = t.closest('tbody tr[data-n]'))) select(b.getAttribute('data-n'));
});
root.addEventListener('keydown', function (e) {
  var r = e.target.closest ? e.target.closest('tbody tr[data-n]') : null, k = INV.key(e);
  if (k === 'esc' && st.sel) { var n = st.sel; st.sel = null; paint(); var back = root.querySelector('tr[data-n="' + n + '"]'); if (back) back.focus({ preventScroll: true }); return; }
  if (!r) return;
  var rows = $$('tbody tr', root), i = rows.indexOf(r);
  var go = k === 'down' ? 1 : k === 'up' ? -1 : 0;
  if (go) { e.preventDefault(); var nx = rows[Math.max(0, Math.min(rows.length - 1, i + go))]; if (st.sel) select(nx.getAttribute('data-n')); else { rows.forEach(function (v) { v.tabIndex = -1; }); nx.tabIndex = 0; nx.focus(); } }
  else if (k === 'enter' || k === 'space') { e.preventDefault(); select(r.getAttribute('data-n'), true); }
});
root.addEventListener('input', function (e) {
  if (e.target.id === 'reg-q') { st.q = e.target.value; st.sel = null; var pos = e.target.selectionStart; paint(); var q = document.getElementById('reg-q'); q.focus({ preventScroll: true }); try { q.setSelectionRange(pos, pos); } catch (er) {} }
});
root.addEventListener('change', function (e) { if (e.target.id === 'reg-sup') { st.sup = e.target.value; st.sel = null; paint(); document.getElementById('reg-sup').focus({ preventScroll: true }); } });
INV.on(function () { paint(true); });
paint();
