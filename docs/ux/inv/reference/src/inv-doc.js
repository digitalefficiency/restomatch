/* ---------- the supplier's own document, and the viewer that shows it ----------
   In the product this is the stored file of the invoice: a photo, a scan, or a PDF. Here each one is drawn from the
   same demo data as the rest of the page, so the document and the screen always agree. Every supplier detail on it
   is invented. */
var W = 760, H = 1075, MIN = 50, MAX = 400, STEP = 25, PAD = 16;
var SUP = {
  'ירקות השרון': { tag: 'שיווק ירקות ופירות טריים', addr: 'השוק הסיטונאי, מחסן 14', tel: '03-555-0114', idn: '000000114', kind: 'photo', hue: '#2F6B3C', mark: 'יה', pre: '10', unit: 'ק״ג', units: { 'חסה ערבית': 'יח׳', 'פטרוזיליה': 'צרור', 'כוסברה': 'צרור' } },
  'משקאות שטיינברג': { tag: 'הפצת משקאות למסעדות', addr: 'אזור התעשייה הצפוני, המלאכה 8', tel: '04-555-0108', idn: '000000108', kind: 'pdf', hue: '#1F4E79', mark: 'מש', pre: '70', unit: 'יח׳', units: { 'קולה זירו 330 מ״ל (ארגז 24)': 'ארגז', 'בירה מהחבית, חבית 30 ל׳': 'חבית', 'מיץ תפוזים סחוט': 'ליטר', 'יין אדום קברנה': 'בקבוק', 'מים מינרליים 1.5 ל׳ (שישייה)': 'שישייה' } },
  'קצביית הכרם': { tag: 'בשר טרי ומוצריו', addr: 'רחוב הכרם 21', tel: '02-555-0121', idn: '000000121', kind: 'pdf', hue: '#5B4636', mark: 'קה', pre: '30', unit: 'ק״ג', units: {} },
  'דגי הים התיכון': { tag: 'דגים טריים ופירות ים', addr: 'הנמל, רציף 3', tel: '08-555-0103', idn: '000000103', kind: 'photo', hue: '#1D5F6E', mark: 'די', pre: '50', unit: 'ק״ג', units: {} }
};
var fmt = function (n) { return Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); };
var qn = function (n) { return String(Math.round(n * 1000) / 1000); };
var digits = function (x) { return Number(String(x.n).replace(/\D/g, '')) || 0; };
var sup = function (x) { return SUP[x.sup] || { tag: '', addr: '', tel: '', idn: '000000000', kind: 'pdf', hue: '#333', mark: x.sup.charAt(0), pre: '90', unit: 'יח׳', units: {} }; };
/* what the page knows about the file: its type, and for a PDF its pages. Where a file came from is not said here. */
var kind = function (x) { return sup(x).kind; };
var kindT = function (x, short) { return kind(x) === 'photo' ? 'תמונה' : short ? 'PDF' : 'PDF · עמוד 1 מתוך 1'; };
var sku = function (x, i) { return sup(x).pre + (101 + i * 7); };
var unit = function (x, i) { var s = sup(x); return s.units[x.lines[i][0]] || s.unit; };
/* The document is a picture to a screen reader: one name, nothing of its print read out a second time.
   The product's marks live in a layer beside the picture, so they stay controls. */
var sheet = function (x) {
  var s = sup(x), vat = Math.round((x.total - x.net) * 100) / 100, d = digits(x);
  var rows = x.lines.map(function (l, i) {
    return '<tr data-line="' + i + '"><td class="c">' + (i + 1) + '</td><td class="c l">' + sku(x, i) + '</td><td>' + l[0] + '</td><td class="n">' + qn(l[3]) + '</td><td class="c">' + unit(x, i) + '</td><td class="n">' + fmt(l[5]) + '</td><td class="n">' + fmt(l[3] * l[5]) + '</td></tr>';
  }).join('');
  var h = '<div class="sd' + (s.kind === 'photo' ? ' is-photo' : '') + '" dir="rtl" lang="he" style="--sd-hue:' + s.hue + '"><div class="sd-paper" role="img" aria-label="המסמך כפי שהגיע מ' + x.sup + ', ' + x.n + '"><div class="sd-in" aria-hidden="true">';
  h += '<div class="sd-hd"><div class="sd-co"><b>' + x.sup + '</b><span>' + s.tag + '</span><span>' + s.addr + ' · טל׳ <i>' + s.tel + '</i></span><span>עוסק מורשה <i>' + s.idn + '</i></span></div><div class="sd-logo">' + s.mark + '</div></div>';
  h += '<div class="sd-title"><b>חשבונית מס</b><span class="sd-no">' + x.n + '</span><span class="sd-orig">מקור</span></div>';
  h += '<div class="sd-meta"><div class="sd-to"><span>לכבוד</span><b>כפר הזיתים בע״מ</b><span>סניף כפר הזיתים · מסעדה</span><span>ח.פ. <i>000000001</i></span></div>' +
    '<dl><dt>תאריך</dt><dd><i>' + x.date + '</i></dd><dt>תעודת משלוח</dt><dd><i>' + s.pre + String(d % 10000) + '</i></dd><dt>הזמנה</dt><dd><i>PO-' + s.pre + String(d % 1000 + 400) + '</i></dd><dt>תנאי תשלום</dt><dd>30 יום</dd><dt>לתשלום עד</dt><dd><i>' + x.due + '</i></dd></dl></div>';
  h += '<table class="sd-tb"><thead><tr><th class="c">#</th><th class="c">מק״ט</th><th>תיאור</th><th class="n">כמות</th><th class="c">יח׳</th><th class="n">מחיר ליח׳</th><th class="n">סה״כ ₪</th></tr></thead><tbody>' + rows + '</tbody></table>';
  h += '<div class="sd-tot"><div><span>סה״כ לפני מע״מ</span><b>' + fmt(x.net) + '</b></div><div><span>' + (x.vat ? 'מע״מ ' + x.vat + '%' : 'מע״מ בשיעור אפס') + '</span><b>' + fmt(vat) + '</b></div><div class="is-sum"><span>סה״כ לתשלום ₪</span><b>' + fmt(x.total) + '</b></div></div>';
  /* a photo taken when the goods arrived carries the receiver's stamp and signature; a PDF does not */
  h += '<div class="sd-ft">' + (s.kind !== 'photo' ? '<div class="sd-rc sd-un"><span>שם המקבל: ____________________</span><span>חתימה: ____________________</span></div>' :
    '<div class="sd-rc"><span class="sd-stamp"><b>נתקבל</b><span>כפר הזיתים</span><i>' + x.gr + '</i></span>' +
    '<svg class="sd-sig" viewBox="0 0 150 46"><path d="M4 31c9-15 17-23 21-17 4 7-9 22-4 23 7 1 12-19 20-20 6 0-4 15 2 16 6 0 9-11 15-11 4 0 0 9 5 9 6 0 9-13 18-15 8-2 12 6 23 3 9-2 17-9 40-12"/></svg></div>') +
    '<p>מסמך ממוחשב · ' + x.sup + ' · עמוד 1 מתוך 1</p></div>';
  return h + '</div></div><div class="sd-ov"></div></div>';
};
/* The product's marks on the document. In the product they come from the place of each line on the page, which the
   reading must keep (it does not today); here they are measured from the drawn document.
   marks: [{ line, tone: 'block' | 'warn' | 'done', label, tag }]; hot: every line answers a press; press: the mark is a control. */
var markInto = function (sh, x, marks, hot, press) {
  var paper = sh.querySelector('.sd-paper'), tb = sh.querySelector('.sd-tb'), ov = sh.querySelector('.sd-ov'); if (!paper || !tb || !ov) return;
  ov.innerHTML = '';
  var off = function (n) { var t = 0, l = 0; while (n && n !== paper) { t += n.offsetTop; l += n.offsetLeft; n = n.offsetParent; } return { t: t, l: l }; };
  var box = function (el, tr, padX, padY) { var o = off(tr), b = off(tb); el.style.top = (o.t - padY) + 'px'; el.style.left = (b.l - padX) + 'px'; el.style.width = (tb.offsetWidth + 2 * padX) + 'px'; el.style.height = (tr.offsetHeight + 2 * padY) + 'px'; };
  if (hot) x.lines.forEach(function (l, i) {
    var tr = sh.querySelector('tr[data-line="' + i + '"]'); if (!tr) return;
    var a = document.createElement('span'); a.className = 'sd-hot'; a.setAttribute('data-line', i); a.setAttribute('aria-hidden', 'true'); box(a, tr, 4, 0); ov.appendChild(a);
  });
  (marks || []).forEach(function (m) {
    var tr = sh.querySelector('tr[data-line="' + m.line + '"]'); if (!tr) return;
    var b = document.createElement(press ? 'button' : 'span'); if (press) { b.type = 'button'; b.setAttribute('aria-label', m.label); }
    b.className = 'sd-mk is-' + m.tone; b.setAttribute('data-line', m.line);
    box(b, tr, 8, 3);
    if (m.tag) { var t = document.createElement('span'); t.className = 'sd-tag'; t.textContent = m.tag; b.appendChild(t); }
    ov.appendChild(b);
  });
};
/* where one line sits on the document, in the document's own pixels: for a still crop of the page around it */
var lineBox = function (sh, line) {
  var tr = sh.querySelector('tr[data-line="' + line + '"]'), sd = sh.querySelector('.sd'); if (!tr || !sd) return null;
  var t = 0, n = tr; while (n && n !== sd) { t += n.offsetTop; n = n.offsetParent; }
  return { top: t, h: tr.offsetHeight };
};
/* a sign that stays for a moment: an animation where motion is welcome, a still outline where it is not */
var blink = function (el, cls) {
  el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
  if (el._bl) clearTimeout(el._bl); el._bl = setTimeout(function () { el.classList.remove(cls); el._bl = null; }, 1600);
};
/* one viewer per place it is shown in. The element is kept across repaints of the screen around it, so the size,
   the turn and the place a person scrolled to are theirs until they open another invoice. */
var viewer = function (name, full) {
  var el = document.createElement('div'); el.className = 'dv';
  el.innerHTML = '<div class="dv-bar" role="toolbar" aria-label="כלי המסמך">' +
    '<span class="dv-kind"></span><span class="sp"></span>' +
    '<button class="rm-ico" data-dv="out" aria-label="הקטינו" aria-keyshortcuts="-">' + icon('minus') + '</button><output class="dv-z num" aria-label="גודל התצוגה">100%</output><button class="rm-ico" data-dv="in" aria-label="הגדילו" aria-keyshortcuts="Plus">' + icon('plus') + '</button>' +
    '<button class="rm-ico" data-dv="fit" aria-label="התאימו לרוחב" aria-keyshortcuts="0">' + icon('fit') + '</button><button class="rm-ico" data-dv="turn" aria-label="סובבו ברבע סיבוב" aria-keyshortcuts="R">' + icon('rotate') + '</button>' +
    (full ? '' : '<button class="rm-ico" data-dv="full" aria-label="פתחו במסך מלא">' + icon('expand') + '</button>') + '</div>' +
    '<div class="dv-cv" dir="ltr" tabindex="0" role="group" aria-label="' + name + '"><div class="dv-sz"><div class="dv-sh"></div></div></div>';
  var cv = el.querySelector('.dv-cv'), sz = el.querySelector('.dv-sz'), sh = el.querySelector('.dv-sh'), out = el.querySelector('.dv-z');
  var st = { x: null, zoom: 100, rot: 0, marks: [], hot: false, press: false, s: 1 }, onLine = null, onFull = null;
  var k = function () { var w = cv.offsetWidth; return w ? cv.getBoundingClientRect().width / w : 1; };   /* the stage may be scaled */
  var mid = function () { cv.scrollLeft = (cv.scrollWidth - cv.clientWidth) / 2; };
  var w0 = function () { return st.rot % 180 !== 0 ? H : W; };
  /* on the whole screen of a desk, "fit" stops at a width a page is read at, not at the width of the window */
  var base = function () { return Math.min(cv.clientWidth - 2 * PAD, full ? 920 : 1e4) / w0(); };
  var centre = function () { return { x: cv.scrollWidth > cv.clientWidth ? (cv.scrollLeft + cv.clientWidth / 2) / cv.scrollWidth : .5, y: cv.scrollHeight ? (cv.scrollTop + cv.clientHeight / 2) / cv.scrollHeight : 0 }; };
  /* a button at its stop stays in the Tab order and says it is off: switching it off under the focus would drop the focus */
  var stop = function (a, on) { el.querySelector('[data-dv="' + a + '"]').setAttribute('aria-disabled', String(!!on)); };
  var layout = function (keep, at) {
    if (!st.x || !cv.clientWidth) return;
    var side = st.rot % 180 !== 0, h0 = side ? W : H, c = at || centre();
    var s = st.s = base() * st.zoom / 100;
    sz.style.width = Math.round(w0() * s) + 'px'; sz.style.height = Math.round(h0 * s) + 'px';
    var t = st.rot === 90 ? 'translate(' + H * s + 'px,0) ' : st.rot === 180 ? 'translate(' + W * s + 'px,' + H * s + 'px) ' : st.rot === 270 ? 'translate(0,' + W * s + 'px) ' : '';
    sh.style.transform = t + 'rotate(' + st.rot + 'deg) scale(' + s + ')'; sh.style.setProperty('--rot', st.rot + 'deg'); sh.style.setProperty('--k', String(Math.round(1000 / s) / 1000));
    out.textContent = Math.round(st.zoom) + '%';
    stop('out', st.zoom <= MIN); stop('in', st.zoom >= MAX);
    el.querySelector('[data-dv="fit"]').setAttribute('aria-pressed', String(Math.abs(st.zoom - 100) < .5));
    if (keep) { cv.scrollLeft = c.x * cv.scrollWidth - cv.clientWidth / 2; cv.scrollTop = c.y * cv.scrollHeight - cv.clientHeight / 2; }
  };
  var api = {
    el: el, state: st,
    show: function (x, marks, hot, press) {
      var same = st.x === x; st.x = x; st.marks = marks || []; st.hot = !!hot; st.press = press == null ? !!hot : !!press;
      if (!same) { sh.innerHTML = sheet(x); st.zoom = 100; st.rot = 0; el.querySelector('.dv-kind').textContent = kindT(x); }
      markInto(sh, x, st.marks, st.hot, st.press); layout(same); if (!same) { cv.scrollTop = 0; mid(); }
    },
    centre: centre,
    layout: function (at) { layout(true, at); },
    zoom: function (z) { st.zoom = Math.max(MIN, Math.min(MAX, z)); layout(true); },
    /* one step of the buttons, the keys and a wheel notch: to the next quarter, also from a size a pinch left */
    step: function (d) { api.zoom(d > 0 ? Math.floor(st.zoom / STEP + 1e-6) * STEP + STEP : Math.ceil(st.zoom / STEP - 1e-6) * STEP - STEP); },
    /* the print is too small to read when the whole page is fitted to a narrow pane */
    small: function () { return base() < .6; },
    /* the head of the page at a given size, with the edge a Hebrew page starts at in sight */
    top: function (z) { st.zoom = Math.max(MIN, Math.min(MAX, z || 100)); layout(false); cv.scrollTop = 0; if (cv.scrollWidth > cv.clientWidth) cv.scrollLeft = cv.scrollWidth; else mid(); },
    /* the size at which the print is about `want` of its life size, in the steps the buttons use, never under "fit" */
    zoomFor: function (want) { return Math.max(100, Math.min(200, Math.ceil(want / base() * 4) * 25)); },
    fit: function () { st.zoom = 100; layout(true); mid(); },
    turn: function () { st.rot = (st.rot + 90) % 360; layout(false); cv.scrollTop = 0; mid(); },
    /* bring one line of the document into the pane, larger when asked. The numbers of a Hebrew invoice are printed
       at its left: "end" keeps that edge of the line in sight when the whole line is wider than the pane. */
    seek: function (line, zoom, align, quiet) {
      if (zoom && st.zoom < zoom) { st.zoom = zoom; layout(true); }
      var m = sh.querySelector('.sd-mk[data-line="' + line + '"]') || sh.querySelector('.sd-hot[data-line="' + line + '"]') || sh.querySelector('tr[data-line="' + line + '"]'); if (!m) return;
      var r = m.getBoundingClientRect(), c = cv.getBoundingClientRect(), kk = k();
      cv.scrollTop += ((r.top + r.height / 2) - (c.top + c.height / 2)) / kk;
      if (align === 'end' && st.rot === 0 && r.width > c.width - 24 * kk) cv.scrollLeft += (r.left - c.left - 12 * kk) / kk;
      else cv.scrollLeft += ((r.left + r.width / 2) - (c.left + c.width / 2)) / kk;
      if (!quiet) blink(m, 'is-flash');
    },
    /* on opening, the marked line is in sight: the document moves only when the mark would sit low in the pane or under it */
    reveal: function (line) {
      var m = sh.querySelector('.sd-mk[data-line="' + line + '"]'); if (!m) return;
      var r = m.getBoundingClientRect(), c = cv.getBoundingClientRect();
      if (r.bottom > c.top + c.height * .66 || r.top < c.top) cv.scrollTop += ((r.top + r.height / 2) - (c.top + c.height / 2)) / k();
    },
    /* a quiet outline on one line while the pointer is on its row in the table */
    hint: function (line) {
      Array.prototype.forEach.call(sh.querySelectorAll('.sd-hot.is-hint'), function (h) { h.classList.remove('is-hint'); });
      if (line == null) return; var h = sh.querySelector('.sd-hot[data-line="' + line + '"]'); if (h) h.classList.add('is-hint');
    },
    onLine: function (f) { onLine = f; }, onFull: function (f) { onFull = f; },
    keep: function () { return { l: cv.scrollLeft, t: cv.scrollTop }; },
    back: function (p) { if (p) { cv.scrollLeft = p.l; cv.scrollTop = p.t; } },
    focus: function () { cv.focus({ preventScroll: true }); }
  };
  var moved = false;
  el.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-dv], .sd-mk, .sd-hot') : null; if (!b || b.getAttribute('aria-disabled') === 'true') return;
    if (b.classList.contains('sd-mk') || b.classList.contains('sd-hot')) { if (!moved && onLine) onLine(Number(b.getAttribute('data-line')), b.classList.contains('sd-mk')); return; }
    var a = b.getAttribute('data-dv');
    if (a === 'in') api.step(1); else if (a === 'out') api.step(-1); else if (a === 'fit') api.fit(); else if (a === 'turn') api.turn(); else if (a === 'full' && onFull) onFull(b);
  });
  /* + - 0 R: heard wherever the focus is in the viewer (its buttons included), and wherever its owner hands them on */
  api.key = function (e) {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (e.key === '+' || e.key === '=') { api.step(1); e.preventDefault(); }
    else if (e.key === '-') { api.step(-1); e.preventDefault(); }
    else if (e.key === '0') { api.fit(); e.preventDefault(); }
    else if (e.code === 'KeyR') { api.turn(); e.preventDefault(); }
  };
  el.addEventListener('keydown', api.key);
  /* a wheel notch (or a wheel that counts in lines) is one step; a pinch on a trackpad arrives as many small turns
     counted in pixels, whose sum is -100 times the natural log of the scale, and the size follows them */
  cv.addEventListener('wheel', function (e) {
    if (!e.ctrlKey && !e.metaKey) return; e.preventDefault();
    if (e.deltaMode !== 0 || Math.abs(e.deltaY) >= 50) api.step(e.deltaY < 0 ? 1 : -1); else api.zoom(st.zoom * Math.exp(-e.deltaY / 100));
  }, { passive: false });
  /* a mouse drags the document; a finger scrolls it, and two fingers change its size */
  var drag = null;
  cv.addEventListener('pointerdown', function (e) {
    moved = false; if (e.pointerType !== 'mouse' || e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, l: cv.scrollLeft, t: cv.scrollTop, id: e.pointerId };
  });
  var drop = function () { drag = null; cv.classList.remove('is-drag'); };
  cv.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!(e.buttons & 1)) { drop(); return; }   /* the button went up somewhere the pane could not see */
    var kk = k(), dx = (e.clientX - drag.x) / kk, dy = (e.clientY - drag.y) / kk;
    if (!moved && Math.abs(dx) + Math.abs(dy) < 5) return;
    if (!moved) { moved = true; cv.classList.add('is-drag'); try { cv.setPointerCapture(drag.id); } catch (err) { /* the pointer is gone */ } }
    cv.scrollLeft = drag.l - dx; cv.scrollTop = drag.t - dy;
  });
  cv.addEventListener('pointerup', drop); cv.addEventListener('pointercancel', drop);
  var pinch = null, gap = function (t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); };
  cv.addEventListener('touchstart', function (e) { if (e.touches.length === 2) pinch = { d: gap(e.touches), z: st.zoom }; }, { passive: true });
  cv.addEventListener('touchmove', function (e) { if (pinch && e.touches.length === 2) { e.preventDefault(); api.zoom(pinch.z * gap(e.touches) / pinch.d); } }, { passive: false });
  cv.addEventListener('touchend', function () { pinch = null; }, { passive: true });
  return api;
};
INV.doc = { sheet: sheet, kind: kind, kindT: kindT, sku: sku, unit: unit, markInto: markInto, lineBox: lineBox, blink: blink, viewer: viewer, W: W, H: H };
