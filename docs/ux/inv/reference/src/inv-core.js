/* ---------- the invoices area: one store behind the four mock-ups ----------
   The figures are the demo restaurant's, read from today's screens (tools/gen_data.py checks the sums).
   Who decides a gap follows the product's routing as it is today: a blocking gap waits for the owner, a gap of
   2% to 5% of its invoice waits for the manager; the owner may decide the manager's gaps too. */
var D = /*DATA*/{}/*END*/;
var ROLES = {
  owner: { k: 'owner', t: 'בעלים', the: 'הבעלים', to: 'לבעלים', name: 'דנה כהן', ini: 'ד', sub: 'בעלים, 3 סניפים', can: ['owner', 'manager', 'bookkeeper'] },
  manager: { k: 'manager', t: 'ניהול', the: 'הניהול', to: 'לניהול', name: 'יואב שגיא', ini: 'י', sub: 'ניהול, 3 סניפים', can: ['manager'] },
  bookkeeper: { k: 'bookkeeper', t: 'הנהלת חשבונות', the: 'הנהלת החשבונות', to: 'להנהלת החשבונות', name: 'מיכל אורן', ini: 'מ', sub: 'הנהלת חשבונות, 3 סניפים', can: ['bookkeeper'] }
};
var S = { role: 'owner', done: {}, log: [], seq: 0 };
var invs = D.invoices;
var gaps = invs.filter(function (x) { return x.gap; }).map(function (x) { var g = x.gap; g.inv = x; return g; });
var subs = [];
var emit = function (why) { subs.forEach(function (f) { f(why); }); tell(); };
var INV = window.__INV = {
  D: D, ROLES: ROLES, invs: invs, gaps: gaps,
  role: function () { return ROLES[S.role]; },
  setRole: function (r) { if (ROLES[r] && r !== S.role) { S.role = r; emit('role'); } },
  on: function (f) { subs.push(f); },
  isOpen: function (g) { return !S.done[g.id]; },
  result: function (g) { return S.done[g.id] || null; },
  open: function () { return gaps.filter(function (g) { return !S.done[g.id]; }); },
  /* may the person who looks decide this gap */
  can: function (g) { return ROLES[S.role].can.indexOf(g.role) >= 0; },
  /* is it routed to the person who looks */
  mine: function (g) { return g.role === S.role; },
  decide: function (g, how, reason) {
    if (S.done[g.id] || !INV.can(g)) return false;
    S.done[g.id] = { how: how, by: S.role, was: g.role, reason: reason || '', seq: ++S.seq };
    S.log.unshift({ g: g, how: how, by: S.role, was: g.role, reason: reason || '', seq: S.seq });
    emit('decide'); return true;
  },
  undo: function (g) {
    if (!S.done[g.id]) return false;
    var q = S.done[g.id].seq; delete S.done[g.id]; S.log = S.log.filter(function (e) { return e.seq !== q; });
    emit('undo'); return true;
  },
  log: function () { return S.log; },
  /* the state of an invoice as people see it */
  state: function (x) {
    if (x.st !== 'flagged_open') return x.st;
    var r = S.done[x.gap.id]; return !r ? 'flagged_open' : r.how === 'claim' ? 'claim_open' : 'clean';
  },
  sum: function (list, f) { return Math.round(list.reduce(function (a, x) { return a + f(x); }, 0) * 100) / 100; }
};
BUS.who = function () { return ROLES[S.role]; };
/* the amount beside "אישורים" in the menu: what the person who looks may decide */
BUS.inv = function () {
  var o = INV.open().filter(function (g) { return INV.can(g); });
  return { n: o.length, sum: INV.sum(o, function (g) { return g.amt; }), block: o.filter(function (g) { return g.sev === 'block'; }).length,
    claimed: INV.sum(S.log.filter(function (e) { return e.how === 'claim'; }), function (e) { return e.g.amt; }) };
};

/* ---------- words and small pieces every screen of the area shares ---------- */
var amt = function (n) { var p = Number(n).toFixed(2).split('.'); return '<span class="money acc"><span>' + Number(p[0]).toLocaleString('en-US') + '<span class="dec">.' + p[1] + '</span></span></span>'; };
var nDays = function (n) { return n === 1 ? 'יום אחד' : n === 2 ? 'יומיים' : n + ' ימים'; };
var nInv = function (n) { return n === 1 ? 'חשבונית אחת' : n + ' חשבוניות'; };
var nGaps = function (n) { return n === 1 ? 'פער אחד' : n + ' פערים'; };
var ST_T = { in_ocr: 'בקריאה', awaiting_count: 'ממתינה לספירה', awaiting_link: 'ממתינה לשיוך', clean: 'תקינה', flagged_open: 'פער פתוח', claim_open: 'לבקשת זיכוי',
  held_duplicate: 'כפולה אפשרית', approved: 'אושרה לתשלום', paid: 'שולמה' };
INV.amt = amt; INV.nDays = nDays; INV.nInv = nInv; INV.nGaps = nGaps; INV.ST_T = ST_T;
/* the state of an invoice: colour only when money waits for a person */
INV.pill = function (x) {
  var k = INV.state(x), t = ST_T[k];
  if (k === 'flagged_open') return '<span class="st ' + (x.gap.sev === 'block' ? 'st-leak' : 'st-warn') + '">' + t + '</span>';
  if (k === 'held_duplicate') return '<span class="st st-leak">' + t + '</span>';
  if (k === 'awaiting_link' || k === 'in_ocr' || k === 'awaiting_count') return '<span class="st iv-wait">' + icon('clock') + t + '</span>';
  if (k === 'claim_open') return '<span class="st iv-wait">' + icon('credit', 'flip') + t + '</span>';
  return '<span class="iv-quiet">' + t + '</span>';
};
/* with whom a gap is: "אצלכם" for the people it is routed to, the role's name for everyone else */
INV.who = function (g) { return INV.mine(g) ? 'אצלכם' : 'אצל ' + ROLES[g.role].the; };
/* why it is with them, in the restaurant's own numbers (the routing rule that sent it there) */
/* one phrase per routing rule, the same words wherever a gap is shown */
INV.because = function (g) {
  if (g.esc) return 'הניהול העביר אחרי ' + nDays(g.days);
  if (g.rule === 'severity-block') return g.kind === 'price' ? 'עליית מחיר של 10% ומעלה חוסמת תשלום' : 'חיוב על יותר ממה שהתקבל חוסם תשלום';
  if (g.rule === 'cumulative-medium') return 'הפערים בחשבונית בין\u00a0₪50\u00a0ל־₪300 לפני מע״מ';
  return '';
};
INV.why = function (g) { return 'כי ' + INV.because(g); };
INV.rule = function (g) { return INV.because(g) + '.'; };
INV.line = function (g) { return INV.who(g) + ' ' + (g.esc ? 'מהיום' : nDays(g.days)) + ', ' + INV.why(g) + '.'; };
/* what a decision is called once it is made */
INV.doneT = function (how) { return how === 'claim' ? 'נוסף לבקשת הזיכוי' : 'שולם כפי שחויב'; };
/* the amount beside "שולם כפי שחויב" is the gap's, not what was paid: the sentence says so */
INV.doneLine = function (g, r) {
  return r.how === 'claim' ? 'נוסף לבקשת הזיכוי, ₪' + g.amt.toFixed(2) + ' לפני מע״מ' : 'הפער של ₪' + g.amt.toFixed(2) + ' לפני מע״מ נסגר, שולם כפי שחויב';
};
/* words a person typed are shown as text */
INV.esc = function (t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };

/* ---------- one toast per mock-up: what was done, and ten seconds to take it back ---------- */
var T_UNDO = 10000;
/* keys are read by the physical key, so they work while the keyboard is set to Hebrew (as the product does today) */
INV.key = function (e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return '';
  var c = e.code || '';
  if (c === 'ArrowDown') return 'down'; if (c === 'ArrowUp') return 'up';
  if (c === 'Enter' || c === 'NumpadEnter') return 'enter'; if (c === 'Space') return 'space'; if (c === 'Escape') return 'esc';
  if (c === 'BracketLeft') return '['; if (c === 'BracketRight') return ']';
  if (!PREF.keys) return '';
  if (c === 'KeyJ') return 'down'; if (c === 'KeyK') return 'up'; if (c === 'KeyZ') return 'z';
  if (c === 'Digit1' || c === 'Numpad1') return '1'; if (c === 'Digit2' || c === 'Numpad2') return '2'; if (c === 'Digit3' || c === 'Numpad3') return '3';
  return '';
};
/* one quiet announcer per mock-up; it exists before its first words, so a screen reader hears them */
INV.say = function (app, t) {
  var el = app.querySelector('.iv-live');
  if (!el) return;
  el.textContent = ''; el.textContent = t;
};
$$('.rm-app.iv').forEach(function (a) {
  if (a.querySelector('.iv-live')) return;
  var el = document.createElement('p'); el.className = 'sr iv-live'; el.setAttribute('role', 'status'); a.querySelector('.rm-main').appendChild(el);
});
INV.narrow = function (app) { return app.classList.contains('is-narrow'); };
/* the message stays where the person is looking: over the bottom of the part of the mock-up that is on screen.
   A mock-up is taller than a screen, so a message pinned to its end would appear out of sight. */
var placeToast = function (el) {
  if (el.hidden) return;
  var box = el.parentNode, r = box.getBoundingClientRect(), k = (r.width / box.offsetWidth) || 1;
  var app = el.closest('.rm-app'), vh = window.innerHeight, h = el.offsetHeight * k, gap = 16 * k;
  var floor = Math.min(r.bottom, vh), bar = INV.narrow(app) ? app.querySelector('.ev-bar, .ivp-dock') : null;
  if (bar) { var br = bar.getBoundingClientRect(); if (br.top < floor && br.bottom > 0 && br.top > 0) floor = br.top; }
  /* in the desk's list the legend of the keys stays readable under the message */
  var keys = box.querySelector('.desk-keys');
  if (keys && keys.offsetParent) { var kr = keys.getBoundingClientRect(); if (kr.top < floor && kr.top > 0) floor = kr.top; }
  var toc = document.querySelector('.toc'), roof = Math.max(r.top, toc ? toc.getBoundingClientRect().bottom : 0);
  var y = Math.max(roof + 8 * k, Math.min(floor - h - gap, r.bottom - h - 8 * k));
  var f = document.activeElement;
  if (INV.narrow(app) && f && f !== document.body && app.contains(f) && !el.contains(f) && f.tagName !== 'INPUT') {
    var fr = f.getBoundingClientRect();
    if (fr.height < 120 && fr.bottom > y - 4 && fr.top < y + h + 4) y = Math.max(roof + 8 * k, fr.top - h - 12 * k);
  }
  el.style.top = Math.round((y - r.top) / k) + 'px';
};
/* the screens may want to know that a message with "ביטול" is up (the desk keeps its Z in the legend) */
var tellToast = function (el, on) { var a = el.closest('.rm-app'); if (a) a.classList.toggle('has-undo', !!on); };
var toastBox = function (app) { var l = INV.narrow(app) ? null : app.querySelector('.desk-list'); return l || app.querySelector('.rm-main'); };
var hideToast = function (el) { el.hidden = true; if (el._t && el._t.timer) { clearTimeout(el._t.timer); el._t.timer = null; } tellToast(el, false); };
var plainText = function (html) { var d = document.createElement('div'); d.innerHTML = html; return d.textContent; };
INV.toast = function (app, text, onUndo, undone) {
  var el = app.querySelector('.iv-toast'), box = toastBox(app);
  if (!el) { el = document.createElement('div'); el.className = 'toast iv-toast'; el.hidden = true; }
  if (el.parentNode !== box) box.appendChild(el);
  el.removeAttribute('role');
  var t = el._t || (el._t = { timer: null, left: 0, t0: 0 });
  var hide = function () { hideToast(el); };
  var arm = function (ms) { if (t.timer) clearTimeout(t.timer); t.left = ms; t.t0 = Date.now(); t.timer = setTimeout(hide, ms); };
  if (!el._bound) {
    el._bound = true;
    var pause = function () { if (!t.timer) return; clearTimeout(t.timer); t.timer = null; t.left = Math.max(0, t.left - (Date.now() - t.t0)); el.classList.add('is-paused'); };
    var resume = function () { if (el.hidden || t.timer) return; el.classList.remove('is-paused'); arm(Math.max(800, t.left)); };
    el.addEventListener('mouseenter', pause); el.addEventListener('mouseleave', resume); el.addEventListener('focusin', pause); el.addEventListener('focusout', resume);
    el.addEventListener('click', function (e) { if (e.target.closest('[data-iv="undo"]') && el._undo) { var u = el._undo, w = el._undone; hide(); u(); INV.say(app, w || 'ההחלטה בוטלה.'); } });
    var again = function () { placeToast(el); };
    window.addEventListener('scroll', again, { passive: true }); window.addEventListener('resize', again);
    app.addEventListener('focusin', again);
  }
  /* one message at a time, as the product keeps one decision that can be taken back */
  $$('.iv-toast').forEach(function (o) { if (o !== el) hideToast(o); });
  el._undo = onUndo || null; el._undone = undone || '';
  el.innerHTML = '<span>' + text + '</span>' + (onUndo ? '<button data-iv="undo">ביטול</button><i class="tm" aria-hidden="true"></i>' : '');
  el.classList.remove('is-paused'); el.classList.toggle('is-instant', reduce);
  el.hidden = true; void el.offsetWidth; el.hidden = false; placeToast(el); arm(onUndo ? T_UNDO : 4000); tellToast(el, !!onUndo);
  INV.say(app, plainText(text) + '.');
  return hide;
};
/* a decision made anywhere: the store changes, every screen repaints, the place it was made says so */
INV.act = function (app, g, how, reason, afterUndo) {
  if (!INV.decide(g, how, reason)) return false;
  /* deciding a gap that waits for another role says so: the owner has just decided in the manager's place */
  INV.toast(app, INV.doneT(how) + ', ' + (INV.mine(g) ? g.inv.sup : 'החלטתם במקום ' + ROLES[g.role].the), function () { INV.undo(g); if (afterUndo) afterUndo(); });
  return true;
};
/* moving between the mock-ups lands on the mock-up itself, with its role switch in view */
INV.show = function (id, keep) {
  var a = document.getElementById(id), st = a ? (a.closest('.stage') || a) : null; if (!st) return;
  var bar = st.previousElementSibling && st.previousElementSibling.classList.contains('stage-bar') ? st.previousElementSibling : st;
  if (id === 'inv-page' && a.classList.contains('is-narrow')) bar = st;
  var toc = document.querySelector('.toc'), top = bar.getBoundingClientRect().top - (toc ? toc.getBoundingClientRect().height : 0) - 12;
  /* when the screen is taller than the window, what the person came for wins over the role switch */
  var k = keep ? a.querySelector(keep) : null;
  if (k && k.offsetParent) top = Math.max(top, k.getBoundingClientRect().bottom - window.innerHeight + 12);
  window.scrollBy({ top: top, behavior: reduce ? 'instant' : 'smooth' });
};
/* which invoice the invoice page shows; the register and the desk send people there */
var focusN = 'SH-24121';
INV.focus = function (n, jump) {
  if (n) { focusN = n; emit('focus'); }
  if (jump) { INV.show('inv-page'); var h = document.querySelector('#ivp-root h1'); if (h) h.focus({ preventScroll: true }); }
  return invs.filter(function (x) { return x.n === focusN; })[0];
};

/* the register, the invoice page and the pay run send people to the desk, on the gap they came for */
var deskSel = null;
INV.toDesk = function (g) {
  deskSel = g ? g.id : null; emit('desk');
  INV.show('inv-desk', '.ev-bar');
};
INV.deskSel = function () { var v = deskSel; deskSel = null; return v; };

/* ---------- where the month's money is: every invoice is in exactly one place ----------
   With the people who look, with another role, waiting for a document, clear, or marked paid.
   The places add up to the month. */
INV.places = function () {
  var r = S.role, out = [], open = invs.filter(function (x) { return INV.state(x) === 'flagged_open'; });
  var tone = function (l) { return l.some(function (x) { return x.gap.sev === 'block'; }) ? 'leak' : 'warn'; };
  var gapsOf = function (l) { return INV.sum(l, function (x) { return x.gap.amt; }); };
  [r].concat(['owner', 'manager', 'bookkeeper'].filter(function (k) { return k !== r; })).forEach(function (k) {
    var l = open.filter(function (x) { return x.gap.role === k; });
    if (!l.length) return;
    out.push({ k: 'r-' + k, t: k === r ? 'אצלכם' : 'אצל ' + ROLES[k].the, tone: tone(l), list: l, gaps: gapsOf(l), mine: k === r, can: ROLES[r].can.indexOf(k) >= 0 });
  });
  var st = function (keys) { return invs.filter(function (x) { return keys.indexOf(INV.state(x)) >= 0; }); };
  out.push({ k: 'wait', t: 'ממתינות לשיוך', tone: '', list: st(['awaiting_link', 'in_ocr', 'awaiting_count']) });
  var noNum = function (x) { return !!x.needsAlloc && !x.alloc; };
  var lack = st(['clean', 'claim_open', 'approved']).filter(noNum);
  if (lack.length) out.push({ k: 'alloc', t: 'חסר מספר הקצאה', tone: 'warn', list: lack });
  out.push({ k: 'ok', t: 'בלי פער פתוח', tone: '', list: st(['clean', 'claim_open', 'approved']).filter(function (x) { return !noNum(x); }) });
  out.push({ k: 'paid', t: 'שולמו', tone: '', list: st(['paid']) });
  out.forEach(function (p) { p.sum = INV.sum(p.list, function (x) { return x.total; }); });
  return out;
};

/* ---------- escalation, reasons, and what happened to an invoice ---------- */
/* a manager may send a gap of theirs to the owner; it stays visible to them, read-only */
INV.escalate = function (g) {
  if (S.done[g.id] || g.role !== 'manager' || S.role !== 'manager') return false;
  g.role = 'owner'; g.esc = { by: 'manager', seq: ++S.seq }; emit('escalate'); return true;
};
INV.unescalate = function (g) { if (!g.esc) return false; g.role = g.esc.by; delete g.esc; emit('undo'); return true; };
/* paying as billed asks why first (the same reasons the approvals desk offers) */
INV.reasons = function (g) {
  return g.kind === 'price' ? ['המחיר עודכן בהסכמה', 'מבצע או הנחה שלא נכללו בהזמנה', 'סכום זניח', 'הכלל או הסף שגויים', 'אחר'] : ['הגיע בפועל, הקבלה שגויה', 'יגיע במשלוח הבא', 'הספק כבר זיכה', 'סכום זניח', 'אחר'];
};
var hhmm = function () { var d = new Date(), z = function (n) { return (n < 10 ? '0' : '') + n; }; return z(d.getHours()) + ':' + z(d.getMinutes()); };
var stamp = {};
/* a toast belongs to the person who acted: when someone else looks, it goes */
INV.on(function (why) { if (why === 'role') $$('.iv-toast').forEach(hideToast); });
/* the screens are drawn again when a mock-up crosses between the wide and the phone layout */
INV.repaint = function () { emit('fit'); };
INV.on(function (why) { if (why === 'decide' || why === 'escalate') { S.log.forEach(function (e) { if (!stamp[e.seq]) stamp[e.seq] = hhmm(); }); gaps.forEach(function (g) { if (g.esc && !stamp[g.esc.seq]) stamp[g.esc.seq] = hhmm(); }); } });
INV.when = function (seq) { return D.today + ' · ' + (stamp[seq] || hhmm()); };
/* the history of one invoice, newest first, built only from what the product records:
   the order, the receipt (with its time), the photo, the check, the routing, and every decision */
INV.history = function (x) {
  var g = x.gap, h = [];
  h.push({ at: x.po, t: 'ההזמנה נשלחה לספק' });
  h.push({ at: x.gr, t: 'הסחורה התקבלה ונספרה', by: 'קבלת סחורה' });
  h.push({ at: x.gr, t: 'החשבונית נקלטה ונבדקה מול ההזמנה והקבלה, נמצא פער אחד', by: 'המערכת' });
  h.push({ at: x.gr, t: 'הפער הגיע ' + ROLES[g.esc ? g.esc.by : g.role].to, why: INV.rule(g.esc ? { rule: 'cumulative-medium', kind: g.kind } : g) });
  if (g.esc) h.push({ at: INV.when(g.esc.seq), t: 'הועבר לבעלים', by: ROLES[g.esc.by].t, live: true });
  var r = S.done[g.id];
  if (r) h.push({ at: INV.when(r.seq), t: INV.doneLine(g, r), by: ROLES[r.by].t + (r.was && r.was !== r.by ? ', במקום ' + ROLES[r.was].the : ''), why: r.reason || '', live: true });
  return h.reverse();
};
