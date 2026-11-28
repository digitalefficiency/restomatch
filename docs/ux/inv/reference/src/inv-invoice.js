/* ---------- the page of one invoice: the supplier's document itself, beside what the product read in it and found ----------
   Two panes at a desk (what was found and the decision; the document), one column on a phone with the document one tap away.
   Deciding here is a proposal: today the page only links to the approvals desk (owner rule C2).
   Marking a line on the document is a proposal too: the reading does not keep where a line sits. The switch above the
   screen shows the three states a document can be in: marked, unmarked (what is stored today), and no file at all. */
var root = document.getElementById('ivp-root');
if (!root) return;
var app = root.closest('.rm-app');
var SPLIT = 58, SPLIT_MIN = 34, SPLIT_MAX = 62, MAIN_MIN = 448, GUT = 20, st = { all: null, ask: false, other: false, doc: 'marks', split: SPLIT };
/* the same order as the register: what blocks a payment first, the longest wait first */
var withLines = INV.invs.filter(function (x) { return x.lines; }).sort(function (a, b) { return (a.gap.sev === 'block' ? 0 : 1) - (b.gap.sev === 'block' ? 0 : 1) || b.gap.days - a.gap.days; });
var q = function (n) { return String(n).replace(/\.0$/, ''); };
/* a number and its unit stay on one line in an item's name */
var nb = function (t) { return String(t).replace(/(\d) (?=[א-ת]{1,2}[׳״])/g, '$1\u00A0'); };
var nar = function () { return INV.narrow(app); };
var dense = function () { return INV.role().k === 'bookkeeper' && !nar(); };
var cash = function (n) { return dense() ? amt(n) : money(n, false, true); };
/* the gap line first; the bookkeeper, who reads the whole invoice, gets every line */
var showAll = function () { return st.all == null ? INV.role().k === 'bookkeeper' && !nar() : st.all; };
var V = null, VF = null, full = null, last = '', opener = null;
/* the next gap the person who looks may decide, their own first */
var nextMine = function (not) {
  return INV.open().filter(function (g) { return g !== not && INV.can(g); }).sort(function (a, b) { return (INV.mine(a) ? 0 : 1) - (INV.mine(b) ? 0 : 1) || (a.sev === 'block' ? 0 : 1) - (b.sev === 'block' ? 0 : 1) || b.days - a.days; })[0] || null;
};
/* what a decision is called where it stands beside the gap's amount or on the document: the amount is the gap's,
   never a payment, so "paid as billed" says whose result it is */
var doneW = function (r) { return r.how === 'claim' ? 'נוסף לבקשת הזיכוי' : 'הפער: שולם כפי שחויב'; };
var skuOf = function (x) { return '<bdi dir="ltr">' + INV.doc.sku(x, x.gap.line) + '</bdi>'; };
/* the two numbers that disagree, as the card says them */
var evT = function (g) { return g.kind === 'qty' ? g.calc[0] : g.calc[0].split(',')[0] + ', לפני מע״מ'; };
var marks = function (x) {
  if (st.doc !== 'marks') return [];
  var g = x.gap, r = INV.result(g);
  return [{ line: g.line, tone: r ? 'done' : g.sev === 'block' ? 'block' : 'warn', tag: r ? '' : 'פער',
    label: (r ? doneW(r) + ', בשורה של ' : 'פער בשורה של ') + g.item + '. ' + (r ? 'לפרטים' : INV.can(g) ? 'לפרטים ולהחלטה' : 'לפרטי הפער') }];
};
/* what the documents say about the line: the order, the goods receipt, the invoice */
var evHtml = function (x) {
  var g = x.gap, l = x.lines[g.line], u = ' ' + g.unit, h = '<div class="bx-ev"><dl class="bx-cmp">';
  var d = Math.round((l[3] - l[2]) * 1000) / 1000;
  if (g.kind === 'qty') h += '<div><dt>הוזמן</dt><dd class="num">' + q(l[1]) + u + '</dd></div><div class="bx-pair"><div class="is-off"><dt>התקבל</dt><dd class="num">' + q(l[2]) + u + '</dd></div><div class="is-off"><dt>חויב</dt><dd class="num">' + q(l[3]) + u + '</dd></div><span class="bx-diff">חויבו ' + q(d) + u + ' יותר</span></div>';
  else h += '<div class="bx-pair"><div class="is-off"><dt>מחיר צפוי</dt><dd>' + money(l[4]) + '</dd></div><div class="is-off"><dt>מחיר בחשבונית</dt><dd>' + money(l[5]) + '</dd></div><span class="bx-diff">' + g.pct.toFixed(1) + '% יותר</span></div><div><dt>כמות</dt><dd class="num">' + q(l[3]) + u + '</dd></div>';
  h += '</dl><div class="bx-amt"><span>הפער</span><b>' + money(g.amt) + '</b><small>לפני מע״מ</small><em>' + g.calc[1] + '</em></div></div>';
  if (g.kind === 'price') h += '<p class="bx-basis">המחירים ליחידה, לפני מע״מ.</p>';
  return h;
};
var actHtml = function (g) {
  return '<button class="btn btn-primary" data-ivp="claim">בקשת זיכוי<span class="num"> · ₪' + g.amt.toFixed(2) + '</span></button>' +
    '<button class="btn btn-secondary" data-ivp="pay">שלמו כפי שחויב</button>';
};
var boxHtml = function (x) {
  var g = x.gap, r = INV.result(g), can = INV.can(g), h = '';
  h += '<div class="ivp-box' + (r ? ' is-done' : g.sev === 'block' ? ' is-block' : ' is-warn') + (!r && INV.mine(g) ? ' is-mine' : '') + '" tabindex="-1" role="group" aria-label="הפער וההחלטה">';
  h += '<div class="bx-h"><b>' + g.title + '</b><span class="bx-item">' + nb(g.item) + '</span><span class="sp"></span>' +
    (r ? '' : '<span class="st ' + (g.sev === 'block' ? 'st-solid' : 'st-warn') + '">' + (g.sev === 'block' ? 'חוסם תשלום' : 'אזהרה') + '</span>') + '</div>';
  h += evHtml(x);
  if (r) {
    var nx = nextMine(g);
    h += '<p class="bx-done">' + icon('check') + '<b>' + INV.doneT(r.how) + '</b><span><bdi dir="ltr">' + INV.when(r.seq) + '</bdi> · ' + ROLES[r.by].t + (r.reason ? ' · ' + r.reason : '') + '</span></p>';
    h += '<p class="bx-fx">' + (r.how === 'claim' ? money(g.amt, true) + ' לפני מע״מ נוספו לבקשת הזיכוי לספק.' : 'הפער נסגר בלי בקשת זיכוי.') + '</p>';
    if (nx) h += '<div class="bx-act"><button class="btn btn-secondary" data-ivp="nextgap">' + (INV.mine(nx) ? 'לפער הבא שמחכה לכם' : 'לפער הבא, אצל ' + ROLES[nx.role].the) + '</button></div>';
  } else {
    h += '<p class="iv-line bx-who">' + INV.line(g) + '</p>';
    if (can && st.ask && st.other) {
      h += '<div class="bx-ask" role="group" aria-label="סיבה אחרת לתשלום כפי שחויב"><label class="iv-other"><span>הסיבה</span><input type="text" id="ivp-other" maxlength="120" autocomplete="off" aria-required="true" aria-describedby="ivp-other-h"></label><span class="sr" id="ivp-other-h">כתבו סיבה כדי להמשיך</span>' +
        '<button class="btn btn-secondary btn-sm" data-ivp="other-ok" disabled>שלמו כפי שחויב</button><button class="btn btn-quiet btn-sm" data-ivp="back">חזרה</button></div>';
    } else if (can && st.ask) {
      h += '<div class="bx-ask" role="group" aria-label="למה לשלם כפי שחויב"><span>למה לשלם כפי שחויב?</span>' +
        INV.reasons(g).map(function (t, i) { return '<button class="chip" data-ivp="reason" data-i="' + i + '">' + t + '</button>'; }).join('') +
        '<button class="btn btn-quiet btn-sm" data-ivp="back">חזרה</button></div>';
    } else if (can) {
      var extra = (INV.mine(g) && INV.role().k === 'manager' ? '<button class="btn btn-quiet" data-ivp="esc">העבירו לבעלים</button>' : '') + (!INV.mine(g) ? '<span class="bx-note">גם אתם רשאים להחליט</span>' : '');
      if (!nar() || extra) h += '<div class="bx-act">' + (nar() ? '' : actHtml(g)) + extra + '</div>';
      h += '<ul class="bx-fx"><li>"בקשת זיכוי" מוסיפה ' + money(g.amt, true) + ' לפני מע״מ לבקשה שנשלחת לספק.</li><li>תשלום כפי שחויב סוגר את הפער בלי בקשת זיכוי.</li></ul>';
    } else {
      h += '<p class="bx-ro">ההחלטה אצל ' + ROLES[g.role].the + ', ואין צורך בפעולה מצדכם.</p>';
    }
  }
  return h + '</div>';
};
var linesHtml = function (x) {
  var g = x.gap, open = INV.isOpen(g), d = dense(), all = showAll(), link = st.doc === 'marks' && !nar(), rows = x.lines.map(function (l, i) { return { l: l, i: i, hit: i === g.line }; });
  var list = all ? rows : rows.filter(function (r) { return r.hit; });
  var h = '<div class="ivp-sec"><h2 aria-level="5">שורות החשבונית</h2><span class="ivp-basis">המחירים והפער לפני מע״מ</span><span class="sp"></span><div class="kit-seg" role="group" aria-label="אילו שורות להציג">' +
    '<button data-ivp="gaps" aria-pressed="' + !all + '">שורות עם פער</button><button data-ivp="all" aria-pressed="' + all + '">כל ' + x.lines.length + ' השורות</button></div></div>';
  /* the columns stand in the order of the three documents: what was ordered, what was received, what was billed */
  h += '<div class="tb-wrap"><table class="tb ivp-tb"><colgroup><col class="c-item"><col class="c-o"><col class="c-r"><col class="c-q"><col class="c-p"><col class="c-p"><col class="c-gap"></colgroup><thead><tr class="ivp-grp"><td></td><th class="gs" scope="colgroup">הזמנה<small><bdi dir="ltr">' + x.po + '</bdi></small></th><th class="gs" scope="colgroup">קבלת סחורה<small><bdi dir="ltr">' + x.gr.split(' · ')[0] + '</bdi></small></th><th class="gs" colspan="2" scope="colgroup">חשבונית<small><bdi dir="ltr">' + x.date + '</bdi></small></th><td class="gs" colspan="2"></td></tr>' +
    '<tr><th>פריט</th><th class="n gs">הוזמן</th><th class="n gs">התקבל</th><th class="n gs">חויב</th><th class="n">' + (d ? 'מחיר, ₪' : 'מחיר') + '</th><th class="n gs">' + (d ? 'מחיר צפוי, ₪' : 'מחיר צפוי') + '</th><th class="n">' + (d ? 'פער, ₪ לפני מע״מ' : 'פער לפני מע״מ') + '</th></tr></thead><tbody>';
  list.forEach(function (r) {
    var l = r.l, offQ = l[2] !== l[3], offP = l[4] !== l[5];
    h += '<tr data-i="' + r.i + '" class="' + (r.hit ? 'is-hit' + (open ? (g.sev === 'block' ? ' is-block' : ' is-warn') : ' is-done') : '') + '"><td>' +
      (link ? '<button class="ivp-ln" data-ivp="row" data-i="' + r.i + '" aria-label="' + l[0] + ', הציגו במסמך">' + l[0] + '</button>' : l[0]) + '</td><td class="n num gs" data-l="הוזמן"><span class="qn">' + q(l[1]) + '</span></td>' +
      '<td class="n num gs' + (offQ ? ' is-off' : '') + '" data-l="התקבל"><span class="qn">' + q(l[2]) + '</span></td><td class="n num gs' + (offQ ? ' is-off' : '') + '" data-l="חויב"><span class="qn">' + q(l[3]) + '</span></td>' +
      '<td class="n' + (offP ? ' is-off' : '') + '" data-l="מחיר בחשבונית">' + cash(l[5]) + '</td><td class="n gs' + (offP ? ' is-off' : '') + '" data-l="מחיר צפוי">' + cash(l[4]) + '</td>' +
      '<td class="n ivp-g"' + (r.hit ? ' data-l="פער לפני מע״מ"' : '') + '>' + (r.hit ? cash(g.amt) : '') + '</td></tr>';
  });
  h += '</tbody></table></div>';
  if (!all) h += '<p class="ivp-more">ועוד ' + (x.lines.length - list.length) + ' שורות בלי פער.</p>';
  return h;
};
var sumHtml = function (x) {
  var g = x.gap, open = INV.isOpen(g), vat = Math.round((x.total - x.net) * 100) / 100;
  return '<div class="ivp-pay"><div class="ivp-sec"><h2 aria-level="5">התשלום</h2>' + (open ? '<span class="st iv-wait">' + icon('clock') + 'בהשהיה</span>' : '<span class="iv-quiet">ניתן לשלם</span>') + '</div>' +
    '<p class="pay-l">' + (open ? 'ההחלטה על הפער תשחרר את החשבונית לתשלום.' : 'אין פער פתוח, והחשבונית בין אלה שניתן לשלם.') + '</p>' +
    '<dl class="ivp-sum"><div><dt>לתשלום עד</dt><dd><bdi class="id">' + x.due + '</bdi></dd></div><div><dt>לפני מע״מ</dt><dd>' + money(x.net) + '</dd></div><div><dt>מע״מ</dt><dd>' + money(vat) + '</dd></div><div class="is-tot"><dt>כולל מע״מ</dt><dd>' + money(x.total) + '</dd></div></dl>' +
    '<ul class="ivp-chk"><li>' + icon('check') + 'השורות מסתכמות בסכום שלפני מע״מ, והמע״מ תואם.</li><li>' + icon('check') + 'מספר הקצאה לא נדרש בסכום הזה.</li></ul></div>';
};
var chainHtml = function (x) {
  var g = x.gap, cl = INV.result(g) && INV.result(g).how === 'claim';
  return '<div class="ivp-sec"><h2 aria-level="5">המסמכים שנבדקו</h2></div><ol class="ivp-chain" aria-label="שרשרת המסמכים"><li>הזמנה<small><bdi dir="ltr">' + x.po + '</bdi></small></li><li>קבלת סחורה<small><bdi dir="ltr">' + x.gr.split(' · ')[0] + '</bdi></small></li><li class="is-here">חשבונית<small><bdi dir="ltr">' + x.date + '</bdi></small></li>' +
    '<li class="' + (cl ? 'is-on' : 'is-off') + '">בקשת זיכוי<small>' + (cl ? 'נפתחה היום' : 'אין') + '</small></li></ol>';
};
var histHtml = function (x) {
  return '<div class="ivp-sec"><h2 aria-level="5">מה קרה עם החשבונית</h2></div><ol class="ivp-hist">' + INV.history(x).map(function (e) {
    return '<li' + (e.live ? ' class="is-live"' : '') + '><span class="h-at"><bdi dir="ltr">' + e.at + '</bdi></span><span class="h-t">' + e.t + (e.by ? '<small> · ' + e.by + '</small>' : '') + '</span>' + (e.why ? '<span class="h-why">' + e.why + '</span>' : '') + '</li>';
  }).join('') + '</ol>';
};
/* where to look on the document: a marked line when the reading kept its place, the printed words to look for when not.
   The page never talks about a mark that is not there. */
var findHtml = function (x) {
  var g = x.gap, r = INV.result(g);
  if (st.doc === 'marks') return '<div class="ivp-find">' + icon('locate') + '<span>' + (r ? 'השורה שהוחלט עליה מסומנת במסמך.' : 'בשורה המסומנת: ' + evT(g) + '.') + '</span><button class="btn btn-quiet btn-sm" data-ivp="find">הציגו את השורה</button></div>';
  return '<div class="ivp-find is-plain">' + icon('search') + '<span>חפשו במסמך: <b>' + nb(g.item) + '</b>, מק״ט ' + skuOf(x) + '.</span></div>';
};
var factsHtml = function (x) {
  return '<dl class="ivp-facts"><div class="is-main"><dt>סכום החשבונית</dt><dd>' + money(x.total) + '<small>כולל מע״מ</small></dd></div>' +
    '<div><dt>תאריך החשבונית</dt><dd><bdi class="id">' + x.date + '</bdi></dd></div><div><dt>לתשלום עד</dt><dd><bdi class="id">' + x.due + '</bdi><small>נותרו ' + nDays(x.left) + '</small></dd></div></dl>';
};
/* a phone: the two decisions stay at the foot of the screen while the invoice is on it */
var dockHtml = function (x) {
  var g = x.gap; if (!nar() || INV.result(g) || !INV.can(g) || st.ask) return '';
  return '<div class="ivp-dock" role="group" aria-label="ההחלטה על הפער"><p class="dk-c">הפער <b>' + money(g.amt) + '</b> לפני מע״מ · ' + nb(g.item) + '</p>' + actHtml(g) + '</div>';
};
/* a desk: once the numbers of the gap have scrolled away, its amount stays at the head of the pane, with the way back */
var pinHtml = function (x) {
  var g = x.gap, r = INV.result(g);
  /* the card under it says all of this; a screen reader hears the button's own name only */
  return '<div class="ivp-pin"><div><span aria-hidden="true">' + (r ? doneW(r) : 'הפער') + ' · <b>' + money(g.amt) + '</b> <small>לפני מע״מ</small>' + (r ? '' : ' · ' + nb(g.item)) + '</span><button class="btn btn-quiet btn-sm" data-ivp="top" aria-label="' + (r || !INV.can(g) ? 'לפרטי הפער' : 'להחלטה על הפער') + '">' + (r || !INV.can(g) ? 'לפרטי הפער' : 'להחלטה') + '</button></div></div>';
};
var stuck = function () {
  var m = root.querySelector('.ivp-main'), ev = root.querySelector('.ivp-box .bx-ev'), p = root.querySelector('.ivp-pin'); if (!m || !ev || !p) return;
  var on = ev.getBoundingClientRect().bottom < m.getBoundingClientRect().top + 6;
  /* the bar is never taken away from under the focus */
  if (!on && p.contains(document.activeElement)) return;
  p.classList.toggle('is-stuck', on);
};
var cur = function () { var x = INV.focus(); return x && x.lines ? x : withLines[0]; };
/* the phone's window onto the document: the lines around the gap when its place is known, the head of the page when not */
var drawWin = function (el, x) {
  el.innerHTML = INV.doc.sheet(x); INV.doc.markInto(el, x, marks(x), false, false);
  var box = el.parentNode, w = box.clientWidth, hh = box.clientHeight, b = st.doc === 'marks' ? INV.doc.lineBox(el, x.gap.line) : null, tb = el.querySelector('.sd-tb');
  var left = 0, n = tb; while (n && n !== el) { left += n.offsetLeft; n = n.offsetParent; }
  var s = b ? w / 610 : w / INV.doc.W, tx = b ? -(left - 10) * s : 0, ty = b ? Math.max(hh - INV.doc.H * s, Math.min(0, hh / 2 - (b.top + b.h / 2) * s)) : 0;
  el.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + s + ')';
};
/* at a desk the screen is as tall as the window lets it be, also when the mock-up is drawn smaller than life */
var frame = function () {
  var main = app.querySelector('.rm-main'); if (!main) return;
  if (nar()) { main.style.removeProperty('--ivp-h'); return; }
  var k = (app.getBoundingClientRect().width / app.offsetWidth) || 1;
  main.style.setProperty('--ivp-h', Math.round(Math.max(480, Math.min(860, window.innerHeight - 150)) / k) + 'px');
};
var paint = function (focusSel) {
  frame();
  var x = cur(), i = withLines.indexOf(x), g = x.gap, n = nar(), key = x.n + '|' + n + '|' + st.doc, same = key === last, h = '';
  var keepV = V && V.el.parentNode ? V.keep() : null, m0 = root.querySelector('.ivp-main'), keepM = m0 ? m0.scrollTop : 0;
  /* words half typed into "הסיבה" survive a repaint (a window that crosses between desk and phone widths) */
  var o0 = document.getElementById('ivp-other'), keepO = o0 ? { v: o0.value, f: document.activeElement === o0 } : null;
  if (V && V.el.parentNode) V.el.parentNode.removeChild(V.el);
  h += '<div class="ivp-top"><a class="ivp-back" href="#register" data-ivp="list">' + icon('fwd') + 'לרשימת החשבוניות</a><span class="sp"></span><span class="ivp-pos"><span class="ivp-pos-w">חשבונית </span><b class="num">' + (i + 1) + '</b> מתוך ' + withLines.length + '<span class="ivp-pos-w"> שנמצא בהן פער</span></span>' +
    '<button class="rm-ico" data-ivp="prev" aria-label="החשבונית הקודמת" aria-keyshortcuts="["' + (i === 0 ? ' disabled' : '') + '>' + icon('down', 'up') + '</button><button class="rm-ico" data-ivp="next" aria-label="החשבונית הבאה" aria-keyshortcuts="]"' + (i === withLines.length - 1 ? ' disabled' : '') + '>' + icon('down') + '</button></div>';
  h += '<div class="ivp-head"><div class="ivp-id"><h1 aria-level="4" tabindex="-1"><bdi class="id">' + x.n + '</bdi> · ' + x.sup + '</h1>' + INV.pill(x) + '</div>' + factsHtml(x) + '</div>';
  var data = (n ? '' : pinHtml(x)) + boxHtml(x) + sumHtml(x) + linesHtml(x) + (n ? chainHtml(x) : '') + histHtml(x);
  if (st.doc === 'none') {
    h += '<div class="ivp-grid is-nodoc"><div class="ivp-main"><p class="ivp-nodoc">' + icon('file-x') + 'אין קובץ מצורף לחשבונית הזו.</p>' + data + '</div></div>';
  } else if (n) {
    h += '<div class="ivp-docn"><button class="ivp-win" data-ivp="full" aria-label="פתחו את המסמך במסך מלא"><span class="ivp-win-sh" aria-hidden="true"></span><span class="ivp-win-x">' + icon('expand') + 'פתחו את המסמך</span></button>' +
      '<p class="ivp-win-c">' + INV.doc.kindT(x, true) + (st.doc === 'marks' ? (INV.result(g) ? ' · השורה שהוחלט עליה מסומנת' : ' · השורה עם הפער מסומנת') : ' · חפשו במסמך: ' + nb(g.item) + ', מק״ט ' + skuOf(x)) + '</p></div>';
    h += '<div class="ivp-grid"><div class="ivp-main">' + data + '</div></div>';
  } else {
    h += '<div class="ivp-grid" style="--doc:' + st.split + '%"><div class="ivp-main">' + data + '</div>' +
      '<div class="ivp-split" role="separator" tabindex="0" aria-orientation="vertical" aria-label="רוחב המסמך" aria-valuemin="' + SPLIT_MIN + '" aria-valuemax="' + SPLIT_MAX + '" aria-valuenow="' + st.split + '" aria-valuetext="' + st.split + '%" title="גררו לשינוי רוחב המסמך"></div>' +
      '<div class="ivp-side"><div class="ivp-vslot"></div>' + findHtml(x) + '</div></div>';
  }
  root.innerHTML = h + dockHtml(x);
  var slot = root.querySelector('.ivp-vslot');
  if (slot) {
    if (!V) { V = INV.doc.viewer('המסמך מהספק'); V.onLine(onDocLine); V.onFull(openFull); }
    slot.appendChild(V.el); V.show(x, marks(x), st.doc === 'marks');
    /* the document opens on the marked line for those who decide; the bookkeeper reads it from its head */
    if (same) V.back(keepV);
    else if (V.small()) { if (st.doc === 'marks' && INV.role().k !== 'bookkeeper') V.seek(g.line, V.zoomFor(.7), 'end', true); else V.top(V.zoomFor(.7)); }
    else if (st.doc === 'marks' && INV.role().k !== 'bookkeeper') V.reveal(g.line);
    syncSplit();
  }
  var win = root.querySelector('.ivp-win-sh'); if (win) drawWin(win, x);
  var m1 = root.querySelector('.ivp-main'); if (m1 && same) m1.scrollTop = keepM;
  var o1 = document.getElementById('ivp-other');
  if (o1 && keepO) { o1.value = keepO.v; var okb = root.querySelector('[data-ivp="other-ok"]'); if (okb) okb.disabled = !keepO.v.trim(); if (keepO.f && !focusSel) o1.focus({ preventScroll: true }); }
  stuck();
  last = key;
  if (full && !full.hidden) fillFull();
  if (focusSel) { var f = root.querySelector(focusSel); if (f) f.focus({ preventScroll: true }); }
};
/* ---- the document and the data point at each other ---- */
var flashRow = function (i) {
  var tr = root.querySelector('.ivp-tb tr[data-i="' + i + '"]'); if (!tr) return;
  INV.doc.blink(tr, 'is-seek');
  var m = root.querySelector('.ivp-main'), r = tr.getBoundingClientRect(), c = m.getBoundingClientRect(), k = (c.width / m.offsetWidth) || 1;
  if (r.top < c.top + 56 * k || r.bottom > c.bottom - 8) m.scrollTop += ((r.top + r.height / 2) - (c.top + c.height / 2)) / k;
};
var onDocLine = function (line, isGap) {
  var x = cur();
  if (full && !full.hidden) { if (isGap) closeFull(true); return; }
  if (isGap) { var b = root.querySelector('.ivp-box'), m = root.querySelector('.ivp-main'); if (m) m.scrollTop = 0; stuck(); if (b) { INV.doc.blink(b, 'is-seek'); (root.querySelector('[data-ivp="claim"]') || b).focus({ preventScroll: true }); } return; }
  if (!showAll()) { st.all = true; paint(); if (V) V.focus(); }
  flashRow(line); INV.say(app, x.lines[line][0] + ', השורה מסומנת בטבלה.');
};
var find = function () {
  var x = cur();
  if (nar()) { openFull(root.querySelector('[data-ivp="full"]')); return; }
  if (V) { V.seek(x.gap.line, V.zoomFor(1), 'end'); V.focus(); }
};
/* ---- the document on the whole screen, with the decision under it ---- */
var fillFull = function () {
  var x = cur(), g = x.gap, r = INV.result(g), can = INV.can(g), h = '';
  full.querySelector('.fl-t').innerHTML = '<bdi class="id">' + x.n + '</bdi> · ' + x.sup;
  /* which item the gap is about, and what to look for when nothing on the document is marked */
  h += '<div class="fl-s"><p class="fl-i">' + (st.doc === 'marks' ? '<b>' + nb(g.item) + '</b>' : 'חפשו במסמך: <b>' + nb(g.item) + '</b>, מק״ט ' + skuOf(x) + '.') + '</p>' +
    '<p class="fl-g"><span>' + evT(g) + '</span><span class="fl-a">הפער ' + money(g.amt) + ' <small>לפני מע״מ</small></span></p></div>';
  if (r) h += '<p class="fl-w">' + doneW(r) + ' · ' + ROLES[r.by].t + '</p>';
  else if (can) h += '<div class="fl-act">' + actHtml(g) + '</div>';
  else h += '<p class="fl-w">ההחלטה אצל ' + ROLES[g.role].the + '.</p>';
  full.querySelector('.fl-f').innerHTML = h;
  /* here the mark leads to the decision; the other lines have nothing to answer, so they are not offered */
  VF.show(x, marks(x), false, st.doc === 'marks');
};
/* while the document covers the screen, the page behind it is out of reach: the keys are heard wherever the focus
   is, and the focus cannot leave */
var lock = function (on) {
  document.documentElement.classList.toggle('ivp-lock', on);
  Array.prototype.forEach.call(document.body.children, function (c) {
    if (c === full) return;
    if (on && !c.hasAttribute('inert')) { c.setAttribute('inert', ''); c._ivpInert = true; }
    else if (!on && c._ivpInert) { c.removeAttribute('inert'); c._ivpInert = false; }
  });
};
document.addEventListener('keydown', function (e) {
  if (!full || full.hidden) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFull(); return; }
  if (e.key !== 'Tab') return;
  var f = Array.prototype.filter.call(full.querySelectorAll('button, [tabindex="0"]'), function (el) { return !el.disabled && el.offsetParent; }); if (!f.length) return;
  var a = document.activeElement, first = f[0], lastEl = f[f.length - 1];
  if (!full.contains(a) || a === full) { e.preventDefault(); (e.shiftKey ? lastEl : first).focus(); }
  else if (e.shiftKey && a === first) { e.preventDefault(); lastEl.focus(); }
  else if (!e.shiftKey && a === lastEl) { e.preventDefault(); first.focus(); }
}, true);
var openFull = function (from) {
  if (st.doc === 'none') return;
  if (!full) {
    full = document.createElement('div'); full.className = 'rm ivp-full'; full.setAttribute('dir', 'rtl'); full.setAttribute('lang', 'he'); full.setAttribute('data-font', app.getAttribute('data-font') || 'gsans');
    full.setAttribute('role', 'dialog'); full.setAttribute('aria-modal', 'true'); full.setAttribute('aria-label', 'המסמך מהספק במסך מלא'); full.tabIndex = -1; full.hidden = true;
    full.innerHTML = '<div class="fl-h"><b class="fl-t"></b><span class="sp"></span><button class="rm-ico" data-fl="close" aria-label="סגרו את המסמך">' + icon('x') + '</button></div><div class="fl-v"></div><div class="fl-f"></div>';
    document.body.appendChild(full);
    VF = INV.doc.viewer('המסמך', true); VF.onLine(onDocLine); full.querySelector('.fl-v').appendChild(VF.el);
    full.addEventListener('keydown', VF.key);
    full.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-fl], [data-ivp]') : null; if (!b) return;
      if (b.getAttribute('data-fl') === 'close') { closeFull(); return; }
      var a = b.getAttribute('data-ivp'), g = cur().gap;
      if (a === 'claim') { closeFull(true); INV.act(app, g, 'claim', '', back); after(); }
      else if (a === 'pay') { closeFull(true); if (!st.ask) { st.ask = true; st.other = false; } paint(st.other ? '#ivp-other' : '.bx-ask .chip'); seeAsk(); }
    });
  }
  opener = from || document.activeElement; full.classList.toggle('is-narrow', nar()); full.hidden = false; lock(true);
  fillFull(); VF.fit();
  /* the print is brought to a size it can be read at, and no larger; the line's numbers are kept in sight */
  if (st.doc === 'marks') VF.seek(cur().gap.line, VF.zoomFor(.7), 'end'); else VF.top(VF.zoomFor(.7));
  full.querySelector('[data-fl="close"]').focus({ preventScroll: true });
};
var closeFull = function (toBox) {
  if (!full || full.hidden) return;
  full.hidden = true; lock(false);
  if (toBox && !nar()) { var m0 = root.querySelector('.ivp-main'), b0 = root.querySelector('.ivp-box'); if (m0) m0.scrollTop = 0; stuck(); if (b0) INV.doc.blink(b0, 'is-seek'); }
  var f = toBox ? (root.querySelector('[data-ivp="claim"]') || root.querySelector('.ivp-box')) : (opener && opener.isConnected ? opener : root.querySelector('[data-ivp="full"], [data-dv="full"]'));
  if (f) f.focus({ preventScroll: true });
  /* a phone that came from the mark lands on the head of the gap's card, under the page's contents bar */
  if (toBox && nar()) { var bx = root.querySelector('.ivp-box'), toc = document.querySelector('.toc'); if (bx) window.scrollBy({ top: bx.getBoundingClientRect().top - ((toc ? toc.getBoundingClientRect().bottom : 0) + 12), behavior: 'instant' }); }
  opener = null;
};
/* the question "why" opens in the card: the card comes into sight when the press was made away from it */
var seeAsk = function () {
  var a = root.querySelector('.bx-ask'), m = root.querySelector('.ivp-main'); if (!a) return;
  if (!nar()) { if (m) m.scrollTop = 0; stuck(); return; }
  var r = a.getBoundingClientRect(); if (r.top < 70 || r.bottom > window.innerHeight - 12) a.scrollIntoView({ block: 'center' });
};
var step = function (d) {
  var i = withLines.indexOf(cur()), to = withLines[i + d]; if (!to) return false;
  st.ask = false; INV.focus(to.n); return true;
};
/* after a decision the focus goes to the way onward, or to the box that now says what was decided;
   after "ביטול" it goes back to the first decision */
var after = function () { var f = root.querySelector('[data-ivp="nextgap"]') || root.querySelector('.ivp-box'); if (f) f.focus({ preventScroll: true }); };
var back = function () { var f = root.querySelector('[data-ivp="claim"]') || root.querySelector('.ivp-box'); if (f) f.focus({ preventScroll: true }); };
root.addEventListener('click', function (e) {
  var b = e.target.closest ? e.target.closest('[data-ivp]') : null; if (!b || b.disabled) return;
  var a = b.getAttribute('data-ivp'), x = cur(), g = x.gap;
  if (a === 'prev' || a === 'next') { step(a === 'next' ? 1 : -1); var f = root.querySelector('[data-ivp="' + a + '"]'); if (f && !f.disabled) f.focus({ preventScroll: true }); else { var o = root.querySelector('[data-ivp="' + (a === 'next' ? 'prev' : 'next') + '"]'); if (o) o.focus({ preventScroll: true }); } }
  else if (a === 'list') { e.preventDefault(); INV.show('inv-reg'); var r0 = nar() ? document.querySelector('#reg-root h1') : (document.querySelector('#reg-root tbody tr[tabindex="0"]') || document.getElementById('reg-q')); if (r0) r0.focus({ preventScroll: true }); }
  else if (a === 'gaps' || a === 'all') { st.all = a === 'all'; paint('[data-ivp="' + a + '"]'); }
  else if (a === 'row') { var li = Number(b.getAttribute('data-i')); if (V) V.seek(li, 0); }
  else if (a === 'find') find();
  else if (a === 'top') { var mm = root.querySelector('.ivp-main'); if (mm) mm.scrollTop = 0; stuck(); (root.querySelector('[data-ivp="claim"]') || root.querySelector('.ivp-box')).focus({ preventScroll: true }); }
  else if (a === 'full') openFull(b);
  else if (a === 'claim') { st.ask = false; INV.act(app, g, 'claim', '', back); after(); }
  else if (a === 'pay') { st.ask = true; st.other = false; paint('.bx-ask .chip'); seeAsk(); }
  else if (a === 'back') { if (st.other) { st.other = false; paint('.bx-ask .chip'); } else { st.ask = false; paint('[data-ivp="pay"]'); } }
  else if (a === 'reason') {
    var why = INV.reasons(g)[Number(b.getAttribute('data-i'))];
    if (why === 'אחר') { st.other = true; paint('#ivp-other'); }
    else { st.ask = false; INV.act(app, g, 'pay', why, back); after(); }
  }
  else if (a === 'other-ok') { var txt = (document.getElementById('ivp-other').value || '').trim(); if (txt) { st.ask = false; st.other = false; INV.act(app, g, 'pay', 'אחר: ' + INV.esc(txt), back); after(); } }
  else if (a === 'esc') { if (INV.escalate(g)) { INV.toast(app, 'הועבר לבעלים, ' + x.sup, function () { INV.unescalate(g); back(); }, 'ההעברה בוטלה.'); after(); } }
  else if (a === 'nextgap') { var nx = nextMine(g); if (nx) { st.ask = false; INV.focus(nx.inv.n); var c = root.querySelector('[data-ivp="claim"]'); if (c) c.focus({ preventScroll: true }); } }
});
/* the pointer on a row of the table shows its line on the document */
root.addEventListener('mouseover', function (e) { var tr = e.target.closest ? e.target.closest('.ivp-tb tbody tr[data-i]') : null; if (V && st.doc === 'marks') V.hint(tr ? Number(tr.getAttribute('data-i')) : null); });
root.addEventListener('mouseleave', function () { if (V) V.hint(null); });
/* "ביטול" is offered for ten seconds: by keyboard it is the next stop after the decision, not the last one on the screen */
var undoBtn = function () { return app.querySelector('.iv-toast:not([hidden]) [data-iv="undo"]'); };
root.addEventListener('keydown', function (e) {
  var t = e.target, k = INV.key(e);
  if (t && t.classList && t.classList.contains('ivp-split')) {
    var d = e.key === 'ArrowLeft' ? -2 : e.key === 'ArrowRight' ? 2 : 0, to = e.key === 'Home' ? SPLIT_MIN : e.key === 'End' ? splitMax() : e.key === 'Enter' ? SPLIT : d ? st.split + d : null;
    if (to != null) { e.preventDefault(); setSplit(to); }
    return;
  }
  if (e.key === 'Tab' && !e.shiftKey && t && t.getAttribute && (t.getAttribute('data-ivp') === 'nextgap' || (t.classList.contains('ivp-box') && !root.querySelector('[data-ivp="nextgap"]')))) {
    var u = undoBtn(); if (u) { e.preventDefault(); u.focus(); u._sent = true; u.addEventListener('blur', function () { u._sent = false; }, { once: true }); return; }
  }
  if (k === 'esc' && st.ask) { st.ask = false; st.other = false; paint('[data-ivp="pay"]'); return; }
  if (k === 'enter' && t && t.id === 'ivp-other') { e.preventDefault(); var ok = root.querySelector('[data-ivp="other-ok"]'); if (ok && !ok.disabled) ok.click(); return; }
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
});
app.addEventListener('keydown', function (e) {
  if (e.key !== 'Tab' || !e.target.matches || !e.target.matches('.iv-toast [data-iv="undo"]')) return;
  if (!e.target._sent) return;   /* reached in the page's own order: Tab goes on in that order */
  var to = e.shiftKey ? (root.querySelector('[data-ivp="nextgap"]') || root.querySelector('.ivp-box')) : root.querySelector('[data-ivp="gaps"]');
  if (to) { e.preventDefault(); to.focus(); }
});
/* the divider between the data and the document: dragged, or moved with the arrows; a double press puts it back.
   What the person was looking at on the document stays in the middle of the pane while its width changes. */
var splitMax = function () {
  var gr = root.querySelector('.ivp-grid'), w = gr ? gr.offsetWidth : 0;
  return w ? Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, Math.floor((w - MAIN_MIN - GUT) / w * 100))) : SPLIT_MAX;
};
var syncSplit = function () {
  var sp = root.querySelector('.ivp-split'); if (!sp) return;
  var mx = splitMax(), v = Math.min(st.split, mx);
  sp.setAttribute('aria-valuemax', mx); sp.setAttribute('aria-valuenow', v); sp.setAttribute('aria-valuetext', v + '%');
};
var setSplit = function (p) {
  var gr = root.querySelector('.ivp-grid'), sp = root.querySelector('.ivp-split'); if (!gr || !sp) return;
  st.split = Math.max(SPLIT_MIN, Math.min(splitMax(), Math.round(p)));
  var at = V ? V.centre() : null;
  gr.style.setProperty('--doc', st.split + '%'); syncSplit(); if (V) V.layout(at);
};
var pull = null;
root.addEventListener('pointerdown', function (e) {
  var sp = e.target.closest ? e.target.closest('.ivp-split') : null; if (!sp || e.button > 0) return;
  e.preventDefault(); pull = e.pointerId; sp.classList.add('is-on'); try { sp.setPointerCapture(pull); } catch (err) { /* the pointer is gone */ }
});
root.addEventListener('pointermove', function (e) {
  if (pull == null || e.pointerId !== pull) return;
  var r = root.querySelector('.ivp-grid').getBoundingClientRect(); setSplit((e.clientX - r.left) / r.width * 100);
});
var release = function (e) { if (pull == null || e.pointerId !== pull) return; pull = null; var sp = root.querySelector('.ivp-split'); if (sp) sp.classList.remove('is-on'); };
root.addEventListener('pointerup', release); root.addEventListener('pointercancel', release);
root.addEventListener('dblclick', function (e) { if (e.target.closest && e.target.closest('.ivp-split')) setSplit(SPLIT); });
/* [ and ] walk the invoices, as on today's page, whenever the pointer or the focus is on this screen;
   the shell's own [ (the side menu) stays out of it */
document.addEventListener('keydown', function (e) {
  var k = INV.key(e); if (k !== '[' && k !== ']') return;
  if (full && !full.hidden) return;
  var t = e.target, on = app.matches(':hover') || app.contains(document.activeElement);
  if (!on || (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA'))) return;
  var side = app.querySelector('.rm-side'); if (side && side.contains(document.activeElement)) return;
  e.stopPropagation(); e.preventDefault();
  var had = root.contains(document.activeElement);
  if (step(k === ']' ? 1 : -1) && had) { var f = root.querySelector('[data-ivp="' + (k === ']' ? 'next' : 'prev') + '"]:not([disabled])') || root.querySelector('.ivp-top .rm-ico:not([disabled])'); if (f) f.focus({ preventScroll: true }); }
}, true);
root.addEventListener('scroll', function (e) { if (e.target.classList && e.target.classList.contains('ivp-main')) stuck(); }, true);
root.addEventListener('input', function (e) { if (e.target.id === 'ivp-other') { var ok = root.querySelector('[data-ivp="other-ok"]'); if (ok) ok.disabled = !e.target.value.trim(); } });
/* the switch above the screen: the document with its line marked, the document as it is stored today, and no file */
document.addEventListener('click', function (e) {
  var b = e.target.closest ? e.target.closest('[data-docst]') : null; if (!b) return;
  st.doc = b.getAttribute('data-docst');
  Array.prototype.forEach.call(b.parentNode.querySelectorAll('[data-docst]'), function (o) { o.setAttribute('aria-pressed', String(o === b)); });
  paint();
});
/* a new size of the window: the frame, the document's fit and the phone's window follow, and nothing else is redrawn */
document.addEventListener('rm:fit', function () {
  frame(); if (V && V.el.parentNode) V.layout(); syncSplit();
  var w = root.querySelector('.ivp-win-sh'); if (w) drawWin(w, cur());
  if (full && !full.hidden) { full.classList.toggle('is-narrow', nar()); VF.layout(); }
});
INV.on(function (why) { if (why !== 'fit') { st.ask = false; st.other = false; } paint(); });
paint();
