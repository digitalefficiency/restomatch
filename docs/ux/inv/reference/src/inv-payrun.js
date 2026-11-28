/* ---------- the pay run: what can be paid, and why each of the others waits ----------
   The pay run is switched off for the pilot restaurant; this mock-up shows it on the demo data.
   Nothing here records a payment (the product has no such record yet): the only action is the export
   that exists today, and the way to the decision. */
var root = document.getElementById('pr-root');
if (!root) return;
var app = root.closest('.rm-app');
var X = INV.D.payrunExtra;
var dense = function () { return INV.role().k === 'bookkeeper' && !INV.narrow(app); };
var cash = function (n) { return dense() ? amt(n) : money(n, false, true); };
var dKey = function (d) { var p = d.split('.'); return p[2] + p[1] + p[0]; };
var byDue = function (a, b) { return dKey(a.due) < dKey(b.due) ? -1 : dKey(a.due) > dKey(b.due) ? 1 : 0; };
/* the groups of what waits: with a person first (yours, then the others'), then what waits for a document */
var held = function () {
  var r = INV.role(), out = [], open = INV.invs.filter(function (x) { return INV.state(x) === 'flagged_open'; });
  [r.k].concat(['owner', 'manager', 'bookkeeper'].filter(function (k) { return k !== r.k; })).forEach(function (k) {
    var l = open.filter(function (x) { return x.gap.role === k; }).sort(function (a, b) { return b.gap.days - a.gap.days; });
    if (!l.length) return;
    out.push({ k: k, t: (l.length === 1 ? 'מחכה' : 'מחכות') + (k === r.k ? ' להחלטה שלכם' : ' להחלטה של ' + ROLES[k].the), person: true, mine: k === r.k, can: r.can.indexOf(k) >= 0,
      tone: l.some(function (x) { return x.gap.sev === 'block'; }) ? 'leak' : 'warn', list: l });
  });
  var link = INV.invs.filter(function (x) { return INV.state(x) === 'awaiting_link'; }).sort(byDue);
  if (link.length) out.push({ k: 'link', t: 'ממתינות לשיוך', note: 'השיוך לתעודות המשלוח עוד לא פעיל.', list: link });
  /* a missing allocation number waits for an action: asking the supplier for it */
  out.push({ k: 'alloc', t: 'חסר מספר הקצאה', tone: 'warn', note: 'בקשו את המספר מהספק, כדי לקזז ' + money(X.vatAtRisk, true) + ' מע״מ.', list: [X] });
  out.forEach(function (g) { g.sum = INV.sum(g.list, function (x) { return x.total; }); });
  return out;
};
var payable = function () {
  return INV.invs.filter(function (x) { var k = INV.state(x); return k === 'clean' || k === 'claim_open' || k === 'approved'; }).sort(byDue);
};
var dueT = function (x) { return '<bdi class="id">' + x.due + '</bdi>' + (x.left != null ? '<small> · נותרו ' + nDays(x.left) + '</small>' : ''); };
var paint = function () {
  var hs = held(), ps = payable(), d = dense(), first = null;
  var heldSum = INV.sum(hs, function (g) { return g.sum; }), heldN = hs.reduce(function (a, g) { return a + g.list.length; }, 0);
  var paySum = INV.sum(ps, function (x) { return x.total; });
  var gapRows = hs.filter(function (g) { return g.person; }), gapSum = 0, gapInv = 0;
  gapRows.forEach(function (g) { g.list.forEach(function (x) { gapSum += x.gap.amt; gapInv += x.total; }); });
  gapSum = Math.round(gapSum * 100) / 100; gapInv = Math.round(gapInv * 100) / 100;
  var gapN = gapRows.reduce(function (a, g) { return a + g.list.length; }, 0);
  hs.forEach(function (g) { if (!first && g.person && g.can) first = g; });
  var h = '<p class="pr-off">' + icon('help') + '<span>ריצת התשלומים כבויה אצלכם בפיילוט, וזו הדמיה על נתוני ההדגמה.</span></p>';
  h += '<div class="pr-head"><h1 aria-level="4">ריצת תשלומים</h1><span class="reg-month">כל מה שפתוח</span><span class="sp"></span><button class="btn btn-secondary" data-pr="export">ייצוא להנהלת החשבונות</button></div>';
  h += '<div class="pr-tiles"><div class="pr-tile"><span class="pt-t">ניתן לשלם<span class="c">' + ps.length + '</span></span><span class="pt-v">' + money(paySum) + '</span><span class="pt-s">כולל מע״מ</span></div>' +
    '<div class="pr-tile is-held"><span class="pt-t">בהשהיה<span class="c">' + heldN + '</span></span><span class="pt-v">' + money(heldSum) + '</span><span class="pt-s">כולל מע״מ</span></div>' +
    (gapRows.length ? '<p class="pr-say">' + (gapN === 1 ? 'פער של <b>' + money(gapSum, true) + '</b> לפני מע״מ מחזיק חשבונית של <b>' : 'פערים של <b>' + money(gapSum, true) + '</b> לפני מע״מ מחזיקים חשבוניות של <b>') + money(gapInv, true) + '</b> כולל מע״מ.</p>' : '<p class="pr-say">אין פער שמחזיק חשבונית.</p>') + '</div>';
  h += '<div class="pr-sec"><h2 aria-level="5">למה חשבוניות בהשהיה</h2></div><div class="pr-groups">';
  hs.forEach(function (g) {
    h += '<section class="pr-grp' + (g.person ? ' is-person' : '') + '" aria-label="' + g.t + '"><div class="pg-h">' + (g.tone ? '<i class="dot dot-' + g.tone + '" aria-hidden="true"></i>' : '<i class="dot" aria-hidden="true"></i>') +
      '<b>' + g.t + '</b><span class="c">' + g.list.length + '</span><span class="pg-sum">' + money(g.sum) + ' <small>כולל מע״מ</small></span><span class="sp"></span>' +
      (g.person ? (g === first ? '<button class="btn btn-primary btn-sm" data-pr="decide" data-g="' + g.list[0].gap.id + '">להחלטה</button>'
        : g.can ? '<button class="btn btn-secondary btn-sm" data-pr="decide" data-g="' + g.list[0].gap.id + '">להחלטה</button>' : '<span class="pg-note">לקריאה בלבד</span>')
        : '<span class="pg-note">' + g.note + '</span>') + '</div><ul class="pg-rows">';
    g.list.forEach(function (x) {
      h += '<li><span class="pr-sup">' + x.sup + '</span><span class="pr-n"><bdi class="id">' + x.n + '</bdi></span><span class="pr-due">' + dueT(x) + '</span>' +
        '<span class="pr-why">' + (x.gap && g.person ? 'פער של ' + money(x.gap.amt, true) + ' לפני מע״מ · ' + (x.gap.esc ? 'מהיום' : nDays(x.gap.days)) + '<small>' + INV.rule(x.gap) + '</small>' : '') + '</span>' +
        '<span class="pr-amt">' + money(x.total, false, true) + '<small class="nar-only"> כולל מע״מ</small></span></li>';
    });
    h += '</ul></section>';
  });
  h += '</div>';
  h += '<div class="pr-sec"><h2 aria-level="5">ניתן לשלם</h2><span class="c">' + ps.length + '</span></div>';
  var notes = ps.some(function (x) { return x.gap && INV.result(x.gap); });
  h += '<div class="tb-wrap"><table class="tb pr-tb' + (notes ? ' has-notes' : '') + '"><thead><tr><th>ספק</th><th>מספר</th><th>לתשלום עד</th><th>' + (notes ? 'הערה' : '<span class="sr">הערה</span>') + '</th><th class="n">' + (d ? 'סכום, ₪ כולל מע״מ' : 'סכום כולל מע״מ') + '</th></tr></thead><tbody>' +
    ps.map(function (x) {
      var r = x.gap ? INV.result(x.gap) : null;
      return '<tr' + (r ? ' class="is-new"' : '') + '><td>' + x.sup + '</td><td><bdi class="id">' + x.n + '</bdi></td><td class="pr-due">' + dueT(x) + '</td>' + ('<td class="pr-note">' +
        (r ? (r.how === 'claim' ? money(x.gap.amt, true) + ' בבקשת זיכוי, לפני מע״מ' : 'הפער: שולם כפי שחויב') + ' · הוחלט היום' : '') + '</td>') + '<td class="n" data-la="כולל מע״מ">' + cash(x.total) + '</td></tr>';
    }).join('') + '</tbody><tfoot><tr><td colspan="4">סך הכול, ' + nInv(ps.length) + '</td><td class="n" data-la="כולל מע״מ">' + cash(paySum) + '</td></tr></tfoot></table></div>';
  root.innerHTML = h;
};
root.addEventListener('click', function (e) {
  var b = e.target.closest ? e.target.closest('[data-pr]') : null; if (!b) return;
  var a = b.getAttribute('data-pr');
  if (a === 'decide') { var g = INV.gaps.filter(function (v) { return v.id === b.getAttribute('data-g'); })[0]; INV.toDesk(g); }
  else if (a === 'export') INV.toast(app, 'בהדמיה לא נוצר קובץ');
});
INV.on(function () { paint(); });
paint();
