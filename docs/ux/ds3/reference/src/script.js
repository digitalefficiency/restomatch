(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  /* review round 4 */
  var icon = function (n, cls) { return '<svg class="i' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#i-' + n + '"/></svg>'; };
  var NB = '\u00A0';
  var money = function (n, plain, acc) {
    var p = Number(n).toFixed(2).split('.');
    return '<span class="money' + (acc ? ' acc' : '') + '"><span class="cur"' + (plain ? ' style="color:inherit"' : '') + '>₪</span><span>' +
      Number(p[0]).toLocaleString('en-US') + '<span class="dec"' + (plain ? ' style="color:inherit"' : '') + '>.' + p[1] + '</span></span></span>';
  };
  var qty = function (n) { return String(Math.round(n * 1000) / 1000); };

  /* ---------- motion helpers ---------- */
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var raf = window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : function (f) { return setTimeout(function () { f(Date.now()); }, 16); };
  /* a number that changed is counted to its new value once; it never loops */
  var tween = function (from, to, ms, paint) {
    if (reduce || !ms || from === to) { paint(to); return; }
    var t0 = null;
    var step = function (now) {
      if (t0 == null) t0 = now;
      var k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      paint(k < 1 ? from + (to - from) * e : to);
      if (k < 1) raf(step);
    };
    raf(step);
  };
  var replayCss = function (el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };

  /* ---------- what the mock-ups share: a person's choices, and the open gaps of the approvals desk ---------- */
  var PREF = { keys: true, dens: 'regular' };
  var BUS = { desk: null, subs: [] };
  var tell = function () { BUS.subs.forEach(function (f) { f(); }); };
  /* one density for every table and queue on the page */
  var applyDensity = function (d) {
    PREF.dens = d;
    $$('.rm-app[data-mock="desk"], .rm-app[data-mock="shell"], .rm.kit-dense').forEach(function (m) { m.classList.toggle('is-compact', d === 'compact'); });
    $$('[data-density]').forEach(function (x) { x.setAttribute('aria-pressed', String(x.getAttribute('data-density') === d)); });
    document.dispatchEvent(new Event('rm:dens'));
  };

  /* ---------- stages: scale a fixed-width mock-up down to its container ---------- */
  function fitStages() {
    $$('.stage').forEach(function (st) {
      var w = Number(st.getAttribute('data-w')) || 1240;
      var inner = st.firstElementChild;
      if (!inner) return;
      var narrow = st.clientWidth < 900;
      var app = inner.querySelector('.rm-app');
      if (app) app.classList.toggle('is-narrow', narrow);
      st.classList.toggle('is-narrow', narrow);
      var k = st.clientWidth / w;
      if (narrow || k >= 1) { inner.style.width = '100%'; inner.style.zoom = 1; }
      else { inner.style.width = w + 'px'; inner.style.zoom = k; }
    });
    var pg = $('.pg'), first = $('.stage');
    if (pg && first) { if (first.classList.contains('is-narrow')) pg.setAttribute('data-narrow', ''); else pg.removeAttribute('data-narrow'); }
    document.dispatchEvent(new Event('rm:fit'));
  }
  window.addEventListener('resize', fitStages);
  if (window.ResizeObserver) { try { new ResizeObserver(fitStages).observe(document.body); } catch (e) {} }

  /* ---------- the opening strip: the match is found, once ---------- */
  var sig = $('.sig'), sigAmt = $('#sig-amt');
  var playSigAmount = function (delay) {
    if (!sigAmt) return;
    if (reduce) { sigAmt.textContent = '38.70'; return; }
    sigAmt.textContent = '0.00';
    setTimeout(function () { tween(0, 38.7, 400, function (v) { sigAmt.textContent = v.toFixed(2); }); }, delay);
  };
  playSigAmount(1050);
  $$('[data-replay="sig"]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (!sig) return;
      sig.classList.add('is-reset'); void sig.offsetWidth; sig.classList.remove('is-reset');
      playSigAmount(1050);
    });
  });

  /* ---------- the page's own navigation: knows where you are, shows how far you have read ---------- */
  var toc = $('#toc'), tocIn = toc ? $('.toc-in', toc) : null, tocBar = toc ? $('.toc-bar', toc) : null;
  if (toc && tocIn) {
    var links = $$('a[href^="#"]', tocIn), byId = {};
    links.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a; });
    var setCurrent = function (id) {
      links.forEach(function (a) { if (a === byId[id]) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
      var a = byId[id];
      if (a && tocIn.scrollWidth > tocIn.clientWidth) {
        var box = tocIn.getBoundingClientRect(), r = a.getBoundingClientRect();
        tocIn.scrollLeft += (r.left + r.width / 2) - (box.left + box.width / 2);
      }
    };
    if ('IntersectionObserver' in window) {
      var seen = {};
      var spy = new IntersectionObserver(function (es) {
        es.forEach(function (en) { seen[en.target.id] = en.isIntersecting; });
        var cur = null;
        links.forEach(function (a) { var id = a.getAttribute('href').slice(1); if (seen[id]) cur = cur || id; });
        if (cur) setCurrent(cur);
      }, { rootMargin: '-25% 0px -65% 0px' });
      links.forEach(function (a) { var s = document.getElementById(a.getAttribute('href').slice(1)); if (s) spy.observe(s); });
    }
    var ticking = false;
    var readPos = function () {
      ticking = false;
      var d = document.documentElement, max = d.scrollHeight - window.innerHeight;
      if (tocBar) tocBar.style.setProperty('--read', max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)).toFixed(4) : '0');
    };
    window.addEventListener('scroll', function () { if (!ticking) { ticking = true; raf(readPos); } }, { passive: true });
    readPos();
  }

  /* ---------- "today" screenshots: enlarge in place ---------- */
  $$('[data-zoom]').forEach(function (b) {
    var many = b.textContent.indexOf('הצילומים') >= 0;
    b.addEventListener('click', function () {
      var t = document.getElementById(b.getAttribute('data-zoom'));
      if (!t) return;
      var on = !t.classList.contains('is-wide');
      t.classList.toggle('is-wide', on);
      b.setAttribute('aria-pressed', String(on));
      b.textContent = (on ? 'הקטנת ' : 'הגדלת ') + (many ? 'הצילומים' : 'הצילום');
      /* on a narrow screen the enlarged picture scrolls sideways: open it on the first pin */
      var shot = $('.shot', t), pin = $('.pin', t);
      if (on && shot && pin && shot.scrollWidth > shot.clientWidth) shot.scrollLeft += pin.getBoundingClientRect().left + 9 - (shot.getBoundingClientRect().left + shot.clientWidth / 2);
    });
  });
  document.addEventListener('click', function (e) {
    var img = e.target.closest ? e.target.closest('.shot img') : null;
    if (!img) return;
    var box = img.closest('.ba, .shots4');
    var btn = box && box.id ? $('[data-zoom="' + box.id + '"]') : null;
    if (btn) btn.click();
  });

  /* ---------- switches above the mock-ups: typeface and density ---------- */
  $$('[data-fontpick]').forEach(function (b) {
    b.addEventListener('click', function () {
      var f = b.getAttribute('data-fontpick');
      $$('.rm').forEach(function (m) { m.setAttribute('data-font', f); });
      $$('[data-fontpick]').forEach(function (x) { x.setAttribute('aria-pressed', String(x.getAttribute('data-fontpick') === f)); });
    });
  });
  $$('[data-density]').forEach(function (b) { b.addEventListener('click', function () { applyDensity(b.getAttribute('data-density')); }); });

  /* ---------- 1 · home ---------- */
  /* the bill and the extra tasks unfold in place */
  $$('[data-act="bill"], [data-act="more"]').forEach(function (b) {
    b.addEventListener('click', function () {
      var open = b.getAttribute('aria-expanded') !== 'true';
      b.setAttribute('aria-expanded', String(open));
      var t = document.getElementById(b.getAttribute('aria-controls'));
      if (!t) return;
      var fold = t.closest('.fold');
      if (fold) { fold.classList.toggle('is-open', open); if (open) t.removeAttribute('inert'); else t.setAttribute('inert', ''); }
      else t.hidden = !open;
    });
  });
  /* the headline counts up and the pace line draws, once, when the screen comes into view */
  var home = $('.rm-app[data-mock="home"]');
  var heroNum = home ? $('.hero-num .money span:last-child', home) : null;
  var playHome = function () {
    if (!home) return;
    home.classList.add('is-armed');
    replayCss(home, 'is-live');
    if (heroNum) tween(0, 760, 400, function (v) { heroNum.textContent = Math.round(v).toLocaleString('en-US'); });
  };
  if (home && !reduce && 'IntersectionObserver' in window) {
    var homeIo = new IntersectionObserver(function (es) {
      es.forEach(function (en) {
        if (!en.isIntersecting) return;
        if (en.intersectionRatio >= 0.4) { playHome(); homeIo.disconnect(); }
        else if (!home.classList.contains('is-live')) home.classList.add('is-armed');
      });
    }, { threshold: [0, 0.4] });
    homeIo.observe(home);
  }
  $$('[data-replay="home"]').forEach(function (b) { b.addEventListener('click', playHome); });

  /* ---------- 2 · the decisions desk ---------- */
  var FIVE = '<span class="money"><span class="cur">₪</span><span>5</span></span>';
  var PRICE_RULE = 'מעל הסף של 2% מהמחיר או ' + FIVE + ' ליחידה';
  var PRICE_WHY = ['המחיר עודכן בהסכמה', 'מבצע שלא נכלל בהזמנה', 'סכום זניח', 'הכלל או הסף שגויים', 'אחר'];
  /* the four gaps of the demo restaurant, in the order and with the due dates the live queue shows */
  var ITEMS = [
    { id: 'sh', sev: 'block', type: 'חיוב על יותר ממה שהתקבל', product: 'עגבניות שרי', supplier: 'ירקות השרון', inv: 'SH-24121', date: '15.10.2026', amt: 38.70, due: 'לתשלום עד 14.11', wait: 'ממתין 10 ימים',
      unit: 'ק״ג', po: 'הזמנה מ־14.10', gr: 'נספר פריט־פריט, 15.10', grAt: '15.10.2026 · 07:50', q: ['9.5', '6.5', '9.5'], p: ['12.90', null, '12.90'], off: 'q', at: 1, delta: '3 ק״ג פחות',
      calc: ['3 ק״ג שלא התקבלו', '12.90'], rule: 'חויב יותר ממה שנספר בקבלה',
      paper: [['בצל יבש', '25', '3.92', '98.00'], ['עגבניות שרי', '9.5', '12.90', '122.55', 1], ['תפוחי אדמה', '28.5', '4.20', '119.70']],
      cost: 'תשלמו לירקות השרון {amt} על 3 ק״ג שלא התקבלו.', reasons: ['הגיע בפועל, הקבלה שגויה', 'יגיע במשלוח הבא', 'הספק כבר זיכה', 'סכום זניח', 'אחר'] },
    { id: 'st', sev: 'block', type: 'מחיר גבוה מהמצופה', product: 'בירה מהחבית, חבית 30 ל׳', supplier: 'משקאות שטיינברג', inv: 'ST-24108', date: '21.10.2026', amt: 104.80, due: 'לתשלום עד 20.11', wait: 'ממתין 4 ימים',
      unit: 'חביות', po: 'הזמנה מ־20.10', gr: 'נספר פריט־פריט, 21.10', grAt: '21.10.2026 · 11:50', q: ['2', '2', '2'], p: ['522.60', null, '575.00'], off: 'p', delta: '10.0% יותר',
      calc: ['2 חביות', '52.40', 'יותר לחבית'], rule: PRICE_RULE,
      paper: [['בירה מהחבית 30 ל׳', '2', '575.00', '1,150.00', 1], ['קולה זירו 330 מ״ל, ארגז', '5', '62.00', '310.00'], ['מיץ תפוזים סחוט', '9', '14.00', '126.00']],
      cost: 'תשלמו למשקאות שטיינברג {amt} מעל המחיר שבהזמנה.', reasons: PRICE_WHY },
    { id: 'hk', sev: 'warn', type: 'מחיר גבוה מהמצופה', product: 'אנטריקוט', supplier: 'קצביית הכרם', inv: 'HK-24108', date: '19.10.2026', amt: 100.00, due: 'לתשלום עד 18.11', wait: 'ממתין 6 ימים',
      unit: 'ק״ג', po: 'הזמנה מ־18.10', gr: 'נספר פריט־פריט, 19.10', grAt: '19.10.2026 · 09:50', q: ['10', '10', '10'], p: ['139.00', null, '149.00'], off: 'p', delta: '7.2% יותר',
      calc: ['10 ק״ג', '10.00', 'יותר לק״ג'], rule: PRICE_RULE,
      paper: [['אנטריקוט', '10', '149.00', '1,490.00', 1], ['חזה עוף', '12', '38.90', '466.80'], ['נקניקיות מרגז', '4', '64.00', '256.00']],
      cost: 'תשלמו לקצביית הכרם {amt} מעל המחיר שבהזמנה.', reasons: PRICE_WHY },
    { id: 'mf', sev: 'warn', type: 'מחיר גבוה מהמצופה', product: 'פילה סלמון', supplier: 'דגי הים התיכון', inv: 'MF-24108', date: '20.10.2026', amt: 52.50, due: 'לתשלום עד 19.11', wait: 'ממתין 5 ימים',
      unit: 'ק״ג', po: 'הזמנה מ־19.10', gr: 'נספר פריט־פריט, 20.10', grAt: '20.10.2026 · 11:20', q: ['7.5', '7.5', '7.5'], p: ['89.00', null, '96.00'], off: 'p', delta: '7.9% יותר',
      calc: ['7.5 ק״ג', '7.00', 'יותר לק״ג'], rule: PRICE_RULE,
      paper: [['קלמרי', '6', '48.76', '292.56'], ['פילה סלמון', '7.5', '96.00', '720.00', 1], ['דניס שלם', '6.5', '62.00', '403.00']],
      cost: 'תשלמו לדגי הים התיכון {amt} מעל המחיר שבהזמנה.', reasons: PRICE_WHY }
  ];
  var desk = document.getElementById('desk');
  if (desk) {
    /* motion: true after a pointer action, false after a key. A decision by key is instant: it happens a hundred times a day. */
    var st = { sel: 0, done: {}, asking: false, last: null, timer: null, peek: false, motion: false, dir: 0, just: null, shown: null, left: 0, t0: 0 };
    var T_UNDO = 10000;
    var rowsEl = $('#desk-rows'), evEl = $('#desk-ev'), toastEl = $('#desk-toast'), sumEl = $('#desk-sum'), tabC = $('#tab-c'), liveEl = $('#desk-live');
    /* the menu beside the desk shows what is still open here */
    BUS.desk = function () {
      var o = ITEMS.filter(function (x) { return !st.done[x.id]; });
      return { n: o.length, sum: o.reduce(function (a, x) { return a + x.amt; }, 0), block: o.filter(function (x) { return x.sev === 'block'; }).length,
        claimed: ITEMS.reduce(function (a, x) { return a + (st.done[x.id] === 'claim' ? x.amt : 0); }, 0) };
    };
    /* one-key shortcuts can be switched off (WCAG 2.1.4): the hints go with them, the arrows stay */
    var syncKeys = function () {
      desk.classList.toggle('no-keys', !PREF.keys);
      rowsEl.setAttribute('aria-label', PREF.keys ? 'רשימת הפערים. מקשי J ו־K למעבר, 1 לבקשת זיכוי, 2 לתשלום כפי שחויב, Z לביטול' : 'רשימת הפערים. החצים עוברים בין הפערים');
      if (!PREF.keys) $$('[aria-keyshortcuts]', desk).forEach(function (b) { if (b.getAttribute('aria-keyshortcuts') !== 'Escape') b.removeAttribute('aria-keyshortcuts'); });
    };
    document.addEventListener('rm:keys', function () { render(); });
    var open = function () { return ITEMS.filter(function (x) { return !st.done[x.id]; }); };
    /* after a decision the queue goes on to the next open gap and wraps; J and K stop at the ends */
    var nextOpen = function (from) {
      for (var i = 1; i <= ITEMS.length; i++) { var j = (from + i) % ITEMS.length; if (!st.done[ITEMS[j].id]) return j; }
      return -1;
    };
    var stepOpen = function (from, dir) {
      for (var j = from + dir; j >= 0 && j < ITEMS.length; j += dir) if (!st.done[ITEMS[j].id]) return j;
      return -1;
    };
    var doneLabel = function (how) { return how === 'claim' ? 'נוסף לבקשת הזיכוי' : 'שולם כפי שחויב'; };
    var say = function (t) { if (liveEl) liveEl.textContent = t; };
    var renderList = function () {
      var html = '', lastSev = '';
      ITEMS.forEach(function (it, i) {
        if (it.sev !== lastSev) {
          var n = ITEMS.filter(function (x) { return x.sev === it.sev && !st.done[x.id]; }).length;
          html += (lastSev ? '</div>' : '') + '<div role="group" aria-label="' + (it.sev === 'block' ? 'חוסמים תשלום' : 'אזהרות') + '"><div class="grp" role="presentation"><b>' + (it.sev === 'block' ? 'חוסמים תשלום' : 'אזהרות') + '</b><span class="num">' + n + '</span></div>';
          lastSev = it.sev;
        }
        var d = st.done[it.id];
        html += '<div class="row' + (d ? ' done' + (d === 'pay' ? ' is-pay' : '') : '') + (st.motion && st.just === it.id ? ' just' : '') + '" role="option" id="desk-row-' + i + '" aria-selected="' + (i === st.sel) + '" data-i="' + i + '">' +
          '<span class="dot ' + (d ? '' : it.sev === 'block' ? 'dot-leak' : 'dot-warn') + '" aria-hidden="true"></span>' +
          '<span class="m"><span class="t">' + it.product + '</span><span class="s">' + it.supplier + ', ' + it.type + '</span></span>' +
          '<span class="e"><span class="amt">' + money(it.amt, false, true) + '</span>' +
          (d ? '<span class="res">' + doneLabel(d) + '</span>' : '<span class="due">' + it.due + '</span>') +
          '</span></div>';
      });
      rowsEl.innerHTML = html + '</div>';
      rowsEl.setAttribute('aria-activedescendant', 'desk-row-' + st.sel);
      var o = open(), sum = o.reduce(function (a, x) { return a + x.amt; }, 0), blk = o.filter(function (x) { return x.sev === 'block'; }).length;
      tabC.textContent = String(o.length);
      tell(); setTimeout(syncKeys, 0);
      sumEl.innerHTML = o.length
        ? (o.length === 1 ? 'פער אחד' : '<b class="num">' + o.length + '</b> פערים') + ' על <b id="desk-total"></b> לפני מע״מ' +
          (!blk ? '' : o.length === 1 ? ', והוא חוסם תשלום' : blk === o.length ? (blk === 2 ? ', שניהם חוסמים תשלום' : ', כולם חוסמים תשלום') : blk === 1 ? ', אחד מהם חוסם תשלום' : ', <b class="num">' + blk + '</b> מהם חוסמים תשלום')
        : 'אין פערים פתוחים';
      var totEl = $('#desk-total');
      if (totEl) tween(st.shown == null ? sum : st.shown, sum, st.motion ? 240 : 0, function (v) { totEl.innerHTML = money(v, true); });
      st.shown = sum;
    };
    var cell = function (v, unit, flagged, delta, isMoney) {
      if (v == null) return '<td class="na">אין מחיר בקבלה</td>';
      return '<td' + (flagged ? ' class="off"' : '') + '><div class="v">' + (isMoney ? '<span class="money"><span class="cur">₪</span><span>' + v + '</span></span>' : '<span>' + v + '</span><small>' + unit + '</small>') +
        (flagged ? '<span class="delta">' + delta + '</span>' : '') + '</div></td>';
    };
    var renderEv = function () {
      var o = open();
      desk.classList.toggle('is-asking', st.asking && o.length > 0);
      if (!o.length && !st.peek) {
        evEl.innerHTML = '<div class="ev-empty' + (st.motion ? ' is-in' : '') + '"><span class="ic">' + icon('check') + '</span><b>הכול מטופל</b><span>פערים חדשים יופיעו כאן</span>' +
          '<button class="btn btn-secondary" data-act="reset">התחילו את ההדגמה מחדש</button></div>';
        placeToast();
        return;
      }
      var it = ITEMS[st.sel], was = st.done[it.id], pos = o.indexOf(it) + 1;
      var paper = it.paper.map(function (r) { return '<div class="pl' + (r[4] ? ' hit' : '') + '"><span>' + r[0] + '</span><span>' + r[1] + '</span><span>' + r[2] + '</span><span>' + r[3] + '</span></div>'; }).join('');
      var bar = was
        ? '<span class="was">' + icon('check') + doneLabel(was) + '</span><span class="sp"></span><button class="btn btn-secondary btn-lg" data-act="reopen">ביטול ההחלטה</button>'
        : st.asking
        ? '<div class="reasons" role="group" aria-label="למה לשלם כפי שחויב"><span class="cost">' + it.cost.replace('{amt}', '<b>' + money(it.amt, true) + '</b>') + '</span><span class="q">למה לשלם כפי שחויב?</span><button class="btn btn-quiet btn-sm" data-act="cancel" aria-keyshortcuts="Escape">חזרה <kbd aria-hidden="true">Esc</kbd></button><span class="chips">' + it.reasons.map(function (r, i) { return '<button class="chip" data-reason="' + i + '">' + r + '</button>'; }).join('') + '</span></div>'
        : '<button class="btn btn-primary btn-lg" data-act="claim" aria-keyshortcuts="1">בקשת זיכוי ' + money(it.amt, true) + '<kbd aria-hidden="true">1</kbd></button>' +
          '<button class="btn btn-secondary btn-lg" data-act="pay" aria-keyshortcuts="2">שלמו כפי שחויב<kbd aria-hidden="true">2</kbd></button><span class="sp"></span>' +
          '<span class="hint">' + (o.length > 2 ? 'אחרי ההחלטה עוברים לבא בתור, נשארו עוד ' + (o.length - 1) : o.length === 2 ? 'אחרי ההחלטה עוברים לבא בתור, נשאר עוד פער אחד' : 'זה הפער האחרון') + '</span>';
      /* the next gap arrives from the end side, the previous one from the start side (right-to-left) */
      var slide = st.motion && st.dir ? ' is-in" style="--dx:' + (st.dir > 0 ? '-12px' : '12px') : '';
      var atQ = it.off === 'q' ? (it.at === 1 ? 1 : 2) : -1;
      evEl.innerHTML =
        '<div class="ev-scroll' + slide + '"><div class="ev-top">' +
        '<span class="st ' + (it.sev === 'block' ? 'st-solid">חוסם תשלום' : 'st-warn">אזהרה') + '</span><span class="st">' + it.wait + '</span><span class="sp"></span>' +
        '<span class="ev-pos">' + (was ? 'הוחלט' : pos + ' מתוך ' + o.length) + '</span><span class="ev-nav">' +
        '<button class="rm-ico" data-act="prev" aria-label="הפער הקודם"' + (stepOpen(st.sel, -1) < 0 ? ' disabled' : '') + '>' + icon('down', 'turn') + '</button>' +
        '<button class="rm-ico" data-act="next" aria-label="הפער הבא"' + (stepOpen(st.sel, 1) < 0 ? ' disabled' : '') + '>' + icon('down') + '</button></span></div>' +
        '<h2 class="ev-h" aria-level="5">' + it.type + '</h2><p class="ev-meta">' + it.product + ', ' + it.supplier + ', חשבונית <bdi>' + it.inv + '</bdi> מיום <bdi>' + it.date + '</bdi></p>' +
        '<div class="match' + (it.sev === 'warn' ? ' is-warn' : '') + '"><table><caption class="sr">השוואה בין מה שהוזמן, מה שהתקבל ומה שחויב</caption>' +
        '<thead><tr><td></td><th scope="col"><b>הוזמן</b><span>' + it.po + '</span></th><th scope="col"><b>התקבל</b><span>' + it.gr + '</span></th><th scope="col"><b>חויב</b><span>חשבונית <bdi>' + it.inv + '</bdi></span></th></tr></thead>' +
        '<tbody><tr><th scope="row">כמות</th>' + cell(it.q[0], it.unit) + cell(it.q[1], it.unit, atQ === 1, it.delta) + cell(it.q[2], it.unit, atQ === 2, it.delta) + '</tr>' +
        '<tr><th scope="row">מחיר ליחידה</th>' + cell(it.p[0], '', false, '', true) + cell(it.p[1]) + cell(it.p[2], '', it.off === 'p', it.delta, true) + '</tr></tbody></table></div>' +
        '<div class="calc"><span>' + it.calc[0] + '</span><span class="op">×</span><span class="money"><span class="cur">₪</span><span>' + it.calc[1] + '</span></span>' + (it.calc[2] ? '<span>' + it.calc[2] + '</span>' : '') + '<span class="op">=</span><span class="res">' + money(it.amt, true) + '</span><span class="sp"></span><span class="why">הכלל: ' + it.rule + '</span></div>' +
        '<div class="docs"><div class="doc"><div class="doc-h"><h3 aria-level="6">' + icon('receipt') + 'השורה בחשבונית</h3><a href="#ex2">לצילום החשבונית</a></div><div class="paper' + (it.sev === 'warn' ? ' is-warn' : '') + '"><div class="pl ph"><span>פריט</span><span>כמות</span><span>מחיר</span><span>סה״כ</span></div>' + paper + '</div></div>' +
        '<div class="doc"><div class="doc-h"><h3 aria-level="6">' + icon('box') + 'קבלת הסחורה</h3></div><div class="rec"><div><span class="k">נספר</span><span>' + it.q[1] + ' ' + it.unit + ', פריט־פריט</span></div><div><span class="k">מתי</span><span><bdi dir="ltr">' + it.grAt + '</bdi></span></div><div><span class="k">מסמך</span><span>צולם בקבלה</span></div></div></div></div>' +
        '<p class="facts"><span><b>החשבונית לא סומנה כשולמה</b>, ובקשת זיכוי תיכנס למכתב לספק לקיזוז לפני התשלום.</span></p></div>' +
        '<div class="ev-bar">' + bar + '</div>';
      placeToast();
    };
    var placeToast = function () {
      var narrow = desk.closest('.rm-app').classList.contains('is-narrow');
      var spot = narrow ? (evEl.querySelector('.ev-bar') || evEl) : desk.querySelector('.desk-list');
      if (toastEl.parentNode !== spot) spot.insertBefore(toastEl, narrow ? spot.firstChild : rowsEl.nextSibling);
    };
    document.addEventListener('rm:fit', placeToast);
    /* the undo window: ten seconds, shown as a line that runs out; it waits while the pointer or focus is on it, and Z stops working when it closes */
    var hideToast = function () { var had = toastEl.contains(document.activeElement); toastEl.hidden = true; st.last = null; if (st.timer) { clearTimeout(st.timer); st.timer = null; } if (had) focusList(); };
    var armToast = function (ms) { if (st.timer) clearTimeout(st.timer); st.left = ms; st.t0 = Date.now(); st.timer = setTimeout(hideToast, ms); };
    var showToast = function (it, how) {
      toastEl.innerHTML = '<span>' + doneLabel(how) + ', ' + it.supplier + '</span><button data-act="undo" aria-keyshortcuts="Z">ביטול<kbd aria-hidden="true">Z</kbd></button><i class="tm" aria-hidden="true"></i>';
      toastEl.classList.remove('is-paused');
      toastEl.classList.toggle('is-instant', !st.motion);
      toastEl.hidden = true; void toastEl.offsetWidth; toastEl.hidden = false;
      armToast(T_UNDO);
    };
    var pauseToast = function () { if (!st.timer) return; clearTimeout(st.timer); st.timer = null; st.left = Math.max(0, st.left - (Date.now() - st.t0)); toastEl.classList.add('is-paused'); };
    var resumeToast = function () { if (toastEl.hidden || st.timer) return; toastEl.classList.remove('is-paused'); armToast(Math.max(800, st.left)); };
    toastEl.addEventListener('mouseenter', pauseToast); toastEl.addEventListener('mouseleave', resumeToast);
    toastEl.addEventListener('focusin', pauseToast); toastEl.addEventListener('focusout', resumeToast);

    var render = function () { renderList(); renderEv(); st.dir = 0; st.just = null; };
    var focusBar = function () {
      var t = evEl.querySelector('.ev-bar .chip') || evEl.querySelector('.ev-bar .btn, .ev-empty .btn');
      if (t) t.focus({ preventScroll: true });
    };
    var focusList = function () { rowsEl.focus({ preventScroll: true }); };
    var isNarrow = function () { return desk.closest('.rm-app').classList.contains('is-narrow'); };
    /* the reasons bar opens and closes in one place, and says what paying costs */
    var ask = function (on) {
      st.asking = on; if (on) st.at = Date.now(); renderEv();
      if (on) { var it = ITEMS[st.sel]; say(it.cost.replace('{amt}', '₪' + it.amt.toFixed(2)) + ' למה לשלם כפי שחויב? בחרו סיבה, או Esc לחזרה.'); }
    };
    var decide = function (how) {
      var it = ITEMS[st.sel], now = Date.now();
      /* one slip is one decision: a second activation inside 350 ms is ignored */
      if (!it || st.done[it.id] || now - (st.at || 0) < 350) return;
      st.at = now;
      var at = st.sel;
      st.done[it.id] = how; st.asking = false; st.peek = false; st.just = it.id; st.dir = 1;
      var n = nextOpen(st.sel);
      if (n >= 0) st.sel = n;
      render(); showToast(it, how); st.last = at;
      /* on a phone the next gap is drawn in place: bring its title back into view */
      if (isNarrow() && evEl.getBoundingClientRect().top < 0) (n >= 0 ? evEl : desk).scrollIntoView({ block: 'start' });
      say(doneLabel(how) + ', ' + it.supplier + '. ' + (n >= 0 ? 'הבא: ' + ITEMS[n].type + ', ' + ITEMS[n].product : 'אין עוד פערים'));
    };
    var undo = function () {
      if (st.last == null) return;
      var at = st.last;
      delete st.done[ITEMS[at].id]; st.sel = at; st.asking = false; st.peek = false; st.dir = -1; hideToast(); render();
      say('ההחלטה בוטלה: ' + ITEMS[at].type + ', ' + ITEMS[at].product);
    };
    var move = function (dir) { var n = stepOpen(st.sel, dir); if (n >= 0) { st.sel = n; st.asking = false; st.peek = false; st.dir = dir; render(); } };
    desk.addEventListener('click', function (e) {
      st.motion = true;
      /* a click made from the keyboard keeps focus on the action; a pointer click hands focus to the queue, so J, K, 1, 2 and Z stay alive */
      var kb = e.detail === 0, after = function () { if (kb) focusBar(); else focusList(); };
      var row = e.target.closest('.row');
      if (row) { st.sel = Number(row.getAttribute('data-i')); st.peek = !!st.done[ITEMS[st.sel].id]; st.asking = false; render(); focusList(); return; }
      var r = e.target.closest('[data-reason]'); if (r) { decide('pay'); after(); return; }
      var a = e.target.closest('[data-act]');
      if (!a || a.disabled) { if (!e.target.closest('a[href], button') || (!kb && e.target.closest('.desk-tabs'))) focusList(); return; }
      var act = a.getAttribute('data-act');
      if (act === 'claim') { decide('claim'); after(); }
      else if (act === 'pay') { ask(true); after(); }
      else if (act === 'cancel') { ask(false); after(); }
      else if (act === 'undo') { if (Date.now() - (st.at || 0) >= 350) { undo(); after(); } }
      else if (act === 'reopen') { delete st.done[ITEMS[st.sel].id]; st.asking = false; st.peek = false; hideToast(); render(); after(); }
      else if (act === 'next') { move(1); focusList(); }
      else if (act === 'prev') { move(-1); focusList(); }
      else if (act === 'reset') { st.done = {}; st.sel = 0; st.asking = false; st.peek = false; st.dir = -1; hideToast(); render(); after(); }
    });
    desk.addEventListener('keydown', function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      var t = e.target, c = e.code;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable) return;
      /* while the reason is asked only Escape is a shortcut, from anywhere in the desk: a stray 1 must not turn into a payment */
      if (st.asking) { if (c === 'Escape' && !e.repeat) { e.preventDefault(); st.motion = false; ask(false); focusList(); } return; }
      /* single keys act only while the queue itself has focus, and a held key decides once */
      if (t !== rowsEl) return;
      if (!PREF.keys && c !== 'ArrowDown' && c !== 'ArrowUp') return;
      var nav = c === 'KeyJ' || c === 'ArrowDown' ? 1 : c === 'KeyK' || c === 'ArrowUp' ? -1 : 0;
      if (e.repeat && !nav) return;
      st.motion = false;
      if (nav) move(nav);
      else if (c === 'Digit1' || c === 'Numpad1') decide('claim');
      else if (c === 'Digit2' || c === 'Numpad2') { if (open().length && !st.done[ITEMS[st.sel].id]) { e.preventDefault(); ask(true); focusBar(); } return; }
      else if (c === 'KeyZ') undo();
      else return;
      e.preventDefault(); focusList();
    });
    render();
  }

  /* ---------- 3 · the delivery check on a phone ---------- */
  var ph = document.getElementById('ph-live');
  var LINES = [
    { n: 'עגבניות שרי', q: 6.5, u: 'ק״ג', step: 0.5 }, { n: 'מלפפונים', q: 15, u: 'ק״ג', step: 0.5 }, { n: 'לימונים', q: 8, u: 'ק״ג', step: 0.5 },
    { n: 'תפוחי אדמה', q: 28.5, u: 'ק״ג', step: 0.5 }, { n: 'בצל יבש', q: 25, u: 'ק״ג', step: 0.5 }, { n: 'פלפל אדום', q: 7, u: 'ק״ג', step: 0.5 },
    { n: 'חסה ערבית', q: 23, u: 'יח׳', step: 1 }, { n: 'פטרוזיליה', q: 14, u: 'צרור', step: 1 }, { n: 'כוסברה', q: 10, u: 'צרור', step: 1 },
    { n: 'חצילים', q: 10, u: 'ק״ג', step: 0.5 }, { n: 'שום קלוף', q: 1.5, u: 'ק״ג', step: 0.5 }
  ];
  var KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'];
  var SCRIM = '<div class="ph-scrim" data-p="close-sheet"></div>';
  var keysHtml = function (whole) {
    return '<div class="keys">' + KEYS.map(function (d) {
      return '<button data-p="key" data-d="' + d + '"' + (d === '.' && whole ? ' disabled' : '') + ' aria-label="' + (d === 'del' ? 'מחיקה' : d === '.' ? 'נקודה עשרונית' : d) + '">' + (d === 'del' ? icon('bksp') : d) + '</button>';
    }).join('') + '</div>';
  };
  /* one typing rule for every quantity: Latin digits, a dot, three decimals; the first key replaces a value that is already there */
  var typeKey = function (t, first, d, whole) {
    if (d === 'del') return first ? '' : t.slice(0, -1);
    if (first) t = '';
    var dot = t.indexOf('.');
    /* an item counted in whole units takes no decimal point */
    if (d === '.') return whole || dot >= 0 ? t : (t || '0') + '.';
    if (t === '0') return d;
    /* four digits before the point, three after it */
    if (dot < 0 ? t.length >= 4 : t.length - dot > 3) return t;
    return t + d;
  };
  /* the quantity tolerance, as the live count applies it: inside the band and at most 3% */
  var within = function (v, q) { var d = Math.abs(v - q); return d <= 1e-9 || (q > 0 && d <= Math.max(1, q * 0.03) && d / q <= 0.03); };
  var qtySheet = function (l, t, first, dmg) {
    var v = (t === '' || t === '.') ? null : Number(t);
    var far = v != null && v !== 0 && !within(v, l.q);
    var pct = far ? Math.round(Math.abs(v - l.q) / l.q * 100) : 0;
    var hurt = dmg && v !== 0;
    return SCRIM + '<div class="ph-sheet" role="dialog" aria-modal="true" aria-label="כמה הגיע, ' + l.n + '">' +
      '<button class="ph-x" data-p="close-sheet" aria-label="סגירה בלי שמירה">' + icon('x') + '</button>' +
      '<h2 aria-level="5">כמה הגיע?</h2><p class="sub">' + l.n + ', הוזמן ' + qty(l.q) + NB + l.u + '</p>' +
      /* the note sits above the keys: the sheet grows upward and no key moves under the thumb */
      (far ? '<div class="ph-note"><span class="dot dot-warn"></span><span>' + (pct > 100 ? 'יותר מפי 2 מההזמנה (' : 'שונה ב־' + pct + '% מההזמנה (') + qty(l.q) + ')</span></div>' : '') +
      '<div class="stepper"><button data-p="dec" aria-label="הפחתת כמות">' + icon('minus') + '</button>' +
      '<div class="val' + (t === '' ? ' is-empty' : first ? ' is-sel' : '') + (t.length > 5 ? ' is-long' : '') + '"><span>' + (t === '' ? '—' : t) + '</span><small>' + l.u + '</small></div>' +
      '<button data-p="inc" aria-label="הוספת כמות">' + icon('plus') + '</button></div>' +
      '<div class="quick"><button data-p="zero">חסר</button><button data-p="dmg" aria-pressed="' + (hurt ? 'true' : 'false') + '">' + (hurt ? icon('check') : '') + 'פגום</button><button data-p="asordered">כמו בהזמנה</button></div>' +
      keysHtml(l.step >= 1) +
      '<button class="ph-cta" data-p="save"' + (v == null ? ' disabled' : '') + '>' + (v == null ? 'אישור הכמות' : v === 0 ? 'אישור: חסר' : 'אישור: ' + qty(v) + NB + l.u) + '</button></div>';
  };
  /* offline is what the live phone shows (it carries the "no connection" line); the phone at rest is online */
  var doneHtml = function (gaps, photo, live, offline, bulked) {
    return '<span class="ic">' + icon('check') + '</span><h2 aria-level="5">' + (offline ? 'קבלת הסחורה נסגרה בטלפון' : 'קבלת הסחורה נסגרה') + '</h2>' +
      '<p class="sum">11 פריטים, ' + (gaps.length ? (gaps.length === 1 ? 'פער אחד' : gaps.length + ' פערים') : 'הכול כמו בהזמנה') + '</p><dl>' +
      '<div><dt>ספק</dt><dd>ירקות השרון</dd></div>' +
      (gaps.length ? '<div><dt>' + (gaps.length === 1 ? 'פער' : 'פערים') + '</dt><dd>' + gaps.join('<br>') + '</dd></div>' : '') +
      (bulked ? '<div><dt>לא נספרו</dt><dd>' + (bulked === 1 ? 'פריט אחד סומן כמו בהזמנה' : bulked + ' פריטים סומנו כמו בהזמנה') + '</dd></div>' : '') +
      '<div><dt>המסמך</dt><dd>' + (photo ? (offline ? 'צולם, ייקרא כשהחיבור יחזור' : 'צולם, נקרא ברקע') : 'לא צולם, אפשר לצלם אחר כך') + '</dd></div>' +
      (offline ? '<div><dt>שליחה</dt><dd>אוטומטית, כשהחיבור יחזור</dd></div>' : '<div><dt>שמירה</dt><dd>נשמר במערכת</dd></div>') +
      '<div><dt>הבא בתור</dt><dd>קצביית הכרם, <bdi>12:30</bdi></dd></div></dl><span class="sp"></span>' +
      '<button class="ph-cta" data-p="reset">למשלוח הבא</button>' +
      (gaps.length ? '<button class="ph-cta is-2nd" data-p="slip">תעודת פערים</button>' : '<button class="ph-cta is-2nd" data-p="reset">חזרה לרשימת המשלוחים</button>') +
      (live ? '<button class="ph-link" data-p="reset">התחילו את ההדגמה מחדש</button>' : '');
  };
  var slipHtml = function (gaps) {
    return SCRIM + '<div class="ph-sheet ph-ask" role="dialog" aria-modal="true" aria-label="תעודת פערים"><h2 aria-level="5">תעודת פערים</h2><p class="sub">להציג לנהג לפני שהוא יוצא</p><dl>' +
      gaps.map(function (g) { var k = g.split(': '); return '<div><dt>' + k[0] + '</dt><dd>' + k[1] + '</dd></div>'; }).join('') +
      '</dl><button class="ph-cta is-2nd" data-p="close-sheet">סגירה</button></div>';
  };
  /* the two phones at rest are drawn by the same functions as the live one */
  var s2 = document.getElementById('ph-static-sheet'); if (s2) s2.innerHTML = qtySheet(LINES[3], '24', false, false);
  var s3 = document.getElementById('ph-static-done'); if (s3) s3.innerHTML = doneHtml(['תפוחי אדמה: הגיע 24 מתוך 28.5' + NB + 'ק״ג'], true, false, false, 0);

  if (ph) {
    var fresh = function () { return { got: { 0: 6.5, 1: 15, 2: 8, 3: 24 }, bulk: {}, dmg: {}, photo: false, edit: null, t: '', first: true, dmgEdit: false, spot: null, spotAt: 0, spotMsg: '', ask: false, slip: false, flash: '', closed: false, just: null, many: null, shot: false, noBulk: false, undo: null }; };
    var ps = fresh(), shownOver = '', shownDone = false, busy = false, opener = null, undoTimer = null, swapAt = 0, lastKind = '';
    /* round 5: the second tap of a double tap lands on the same spot right after the screen changed under it; only that tap is dropped */
    var lastXY = null, swapXY = null;
    var echo = function (e) {
      var same = swapXY && Math.abs(e.clientX - swapXY[0]) < 30 && Math.abs(e.clientY - swapXY[1]) < 30;
      lastXY = [e.clientX, e.clientY];
      return !!same && Date.now() - swapAt < 350;
    };
    var listEl = $('#ph-list'), cntEl = $('#ph-count'), mainEl = $('#ph-main'), camEl = $('#ph-cam'), overEl = $('#ph-over'), statusEl = $('#ph-status'), undoEl = $('#ph-undo');
    var under = [ph.querySelector('.ph-top'), ph.querySelector('.ph-prog'), listEl, ph.querySelector('.ph-barwrap')];
    var isDone = function (i) { return ps.got[i] != null; };
    var isGap = function (i) { return isDone(i) && (!within(ps.got[i], LINES[i].q) || !!ps.dmg[i]); };
    var left = function () { return LINES.filter(function (_, i) { return !isDone(i); }).length; };
    var gapList = function () { return LINES.map(function (_, i) { return i; }).filter(isGap); };
    var gapText = function (i) {
      var l = LINES[i], got = ps.got[i];
      if (got === 0) return 'חסר';
      if (within(got, l.q)) return 'הגיע פגום';
      return (got > l.q ? 'הגיע ' + qty(got) + ', הוזמן ' + qty(l.q) : 'הגיע ' + qty(got) + ' מתוך ' + qty(l.q)) + NB + l.u + (ps.dmg[i] ? ', פגום' : '');
    };
    var gapLines = function () { return gapList().map(function (i) { return LINES[i].n + ': ' + gapText(i); }); };
    var sheetOpen = function () { return ps.edit != null || !!ps.spot || ps.ask || ps.slip; };
    var closeAll = function () { ps.edit = null; ps.spot = null; ps.spotMsg = ''; ps.ask = false; ps.slip = false; };
    var dropUndo = function () { ps.undo = null; if (undoTimer) { clearTimeout(undoTimer); undoTimer = null; } };
    var askHtml = function () {
      var g = gapLines();
      return SCRIM + '<div class="ph-sheet ph-ask" role="dialog" aria-modal="true" aria-label="לפני הסגירה"><h2 aria-level="5">לפני הסגירה</h2><dl>' +
        (g.length ? '<div><dt>' + (g.length === 1 ? 'פער אחד' : g.length + ' פערים') + '</dt><dd>' + g.join('<br>') + '</dd></div>' : '') +
        '<div><dt>המסמך</dt><dd>' + (ps.photo ? 'צולם' : 'עוד לא צולם') + '</dd></div></dl>' +
        (g.length ? '<p class="ph-hint">' + icon('edit') + '<span>רשמו את הפער גם על תעודת המשלוח</span></p>' : '') +
        (ps.photo
          ? '<button class="ph-cta" data-p="close-now">סגירת קבלת הסחורה</button><button class="ph-cta is-2nd" data-p="close-sheet">חזרה לספירה</button>'
          : '<button class="ph-cta" data-p="shoot-close">צילום המסמך וסגירה</button><button class="ph-cta is-2nd" data-p="close-nodoc">סגירה בלי מסמך</button><button class="ph-link" data-p="close-sheet">חזרה לספירה</button>') + '</div>';
    };
    var spotHtml = function () {
      var cur = LINES[ps.spot[ps.spotAt].i];
      return SCRIM + '<div class="ph-sheet" role="dialog" aria-modal="true" aria-label="בדיקה מדגמית">' +
        '<button class="ph-x" data-p="close-sheet" aria-label="חזרה לספירה">' + icon('x') + '</button>' +
        '<h2 aria-level="5">בדיקה מדגמית לפני האישור</h2><p class="sub">ספרו ורשמו כמה הגיע בפועל</p>' +
        (ps.spotMsg ? '<div class="ph-note"><span class="dot dot-warn"></span><span>' + ps.spotMsg + '</span></div>' : '') +
        '<div class="spot">' +
        ps.spot.map(function (sp, k) { var l = LINES[sp.i]; return '<button class="sl' + (k === ps.spotAt ? ' on' : '') + '" data-p="spot-pick" data-k="' + k + '" aria-pressed="' + (k === ps.spotAt) + '"><span class="nm">' + l.n + '</span><span class="fld' + (sp.t ? '' : ' empty') + '">' + (sp.t ? '<span>' + sp.t + '</span><small>' + l.u + '</small>' : 'כמה נספר?') + '</span></button>'; }).join('') +
        '</div>' + keysHtml(cur.step >= 1) +
        '<button class="ph-cta" data-p="spot-ok">אישור הבדיקה</button></div>';
    };
    var rowHtml = function (l, i) {
      var got = ps.got[i], gap = isGap(i), ok = got != null && !gap;
      var ordered = 'הוזמן <b>' + qty(l.q) + NB + l.u + '</b>';
      var sub = gap ? (got === 0 ? 'חסר' : within(got, l.q) ? 'הגיע פגום' : ordered + (ps.dmg[i] ? ', פגום' : ''))
        : ok ? (ps.bulk[i] ? 'לא נספר פריט־פריט' : '') : ordered;
      /* the row that was just marked answers the finger; rows marked together follow one another */
      var wave = ps.many ? ps.many.indexOf(i) : -1;
      var just = i === ps.just || wave >= 0;
      var ckLabel = gap ? 'פער, ' + l.n + '. שינוי הכמות' : ok ? 'סומן, ' + l.n + '. ביטול הסימון' : 'הגיע כמו בהזמנה: ' + l.n + ', ' + qty(l.q) + ' ' + l.u;
      return '<div class="ln' + (ok ? ' is-ok' : gap ? ' is-gap' : '') + (just ? ' just' : '') + '"' + (wave > 0 ? ' style="--wave:' + (wave * 40) + 'ms"' : '') + '>' +
        '<button class="ln-ck" data-p="ok" data-i="' + i + '" aria-label="' + ckLabel + '"' + (gap ? '' : ' aria-pressed="' + ok + '"') + '>' + icon(gap ? 'minus' : 'check') + '</button>' +
        '<div><div class="nm">' + l.n + '</div>' + (sub ? '<div class="od">' + sub + '</div>' : '') + '</div>' +
        (got != null
          ? '<button class="ln-q" data-p="edit" data-i="' + i + '" aria-label="שינוי כמות, ' + l.n + ', ' + qty(got) + ' ' + l.u + '"><b>' + qty(got) + '</b><small>' + l.u + '</small></button>'
          : '<button class="ln-q is-edit" data-p="edit" data-i="' + i + '" aria-label="כמות אחרת, ' + l.n + '">' + icon('edit') + '</button>') + '</div>';
    };
    var renderPhone = function () {
      /* keyboard focus stays on the same control across a re-render */
      var act = document.activeElement, keep = null, onSheet = !!(act && act.classList && act.classList.contains('ph-sheet'));
      if (act && act !== mainEl && act !== camEl && act !== undoEl && ph.contains(act) && act.getAttribute && act.getAttribute('data-p')) {
        keep = '[data-p="' + act.getAttribute('data-p') + '"]' + ['data-i', 'data-d', 'data-k'].map(function (a) { return act.hasAttribute(a) ? '[' + a + '="' + act.getAttribute(a) + '"]' : ''; }).join('');
      }
      under.forEach(function (el) { el.hidden = ps.closed; });
      var kind = ps.closed ? (ps.slip ? 'slip' : 'done') : ps.edit != null ? 'edit' : ps.spot ? 'spot' : ps.ask ? 'ask' : '';
      if (kind !== lastKind) { lastKind = kind; swapAt = Date.now(); swapXY = lastXY; }
      var key, html;
      if (ps.closed) {
        key = ps.slip ? 'slip' : '';
        html = '<div class="ph-done' + (shownDone ? '' : ' is-in') + '"' + (ps.slip ? ' inert' : '') + '>' + doneHtml(gapLines(), ps.photo, true, true, Object.keys(ps.bulk).length) + '</div>' + (ps.slip ? slipHtml(gapLines()) : '');
        shownDone = true;
      } else {
        shownDone = false;
        var done = LINES.length - left(), n = left();
        $('#ph-bar').style.width = (done / LINES.length * 100) + '%';
        cntEl.textContent = done + ' מתוך ' + LINES.length + ' סומנו';
        listEl.innerHTML = LINES.map(rowHtml).join('');
        mainEl.className = 'ph-main' + (n ? ' is-2nd' : '');
        mainEl.disabled = n > 0 && ps.noBulk;
        mainEl.textContent = !n || ps.noBulk ? 'סגירת קבלת הסחורה' : n === LINES.length ? 'הכל הגיע כמו בהזמנה (' + n + ')' : 'סמנו את השאר (' + n + ')';
        var msg = ps.flash || (ps.undo ? (ps.undo.n === 1 ? 'סומן פריט אחד' : 'סומנו ' + ps.undo.n + ' פריטים')
          : !n ? (ps.photo ? 'הכול סומן, המסמך צולם' : 'הכול סומן, נשאר לצלם את המסמך')
          : ps.noBulk ? 'נמצא פער בבדיקה, ' + (n === 1 ? 'נותר פריט אחד לספור' : 'נותרו ' + n + ' פריטים לספור') : '');
        if (statusEl.textContent !== msg) statusEl.textContent = msg;
        undoEl.hidden = !ps.undo;
        camEl.className = 'ph-cam' + (ps.photo ? ' is-done' : '') + (ps.shot ? ' just' : '');
        camEl.innerHTML = icon(ps.photo ? 'check' : 'camera') + '<span>' + (ps.photo ? 'המסמך צולם' : 'צילום המסמך') + '</span>';
        key = ps.edit != null ? 'edit' : ps.spot ? 'spot' : ps.ask ? 'ask' : '';
        html = (key === 'edit' ? qtySheet(LINES[ps.edit], ps.t, ps.first, ps.dmgEdit) : key === 'spot' ? spotHtml() : key === 'ask' ? askHtml() : '') +
          (ps.shot ? '<i class="ph-flash" aria-hidden="true"></i>' : '');
      }
      /* a sheet rises once, when it opens; typing inside it never replays the entrance */
      var opened = key && key !== shownOver;
      if (opened) html = html.replace('class="ph-scrim"', 'class="ph-scrim is-in"').replace('class="ph-sheet', 'class="ph-sheet is-in');
      shownOver = key;
      overEl.innerHTML = html;
      under.forEach(function (el) { if (key && !ps.closed) el.setAttribute('inert', ''); else el.removeAttribute('inert'); });
      ps.just = null; ps.many = null; ps.shot = false;
      var sheet = overEl.querySelector('.ph-sheet'), el;
      if (sheet) sheet.setAttribute('tabindex', '-1');
      /* focus stays inside an open sheet across re-renders, so a real keyboard keeps typing */
      if (sheet && (opened || onSheet)) sheet.focus({ preventScroll: true });
      else if (keep && (el = ph.querySelector(keep))) el.focus({ preventScroll: true });
    };
    var backToOpener = function () {
      if (!opener) return;
      var el = ph.querySelector(opener);
      opener = null;
      if (el) el.focus({ preventScroll: true });
    };
    /* a sheet leaves before the list behind it changes, so the change is seen */
    var leave = function (after) {
      var sh = overEl.querySelector('.ph-sheet'), sc = overEl.querySelector('.ph-scrim');
      if (reduce || !sh) { after(); renderPhone(); backToOpener(); return; }
      busy = true; sh.classList.add('is-out'); if (sc) sc.classList.add('is-out');
      setTimeout(function () { busy = false; after(); renderPhone(); backToOpener(); }, 150);
    };
    var typeInto = function (d) {
      if (ps.edit != null) { ps.t = typeKey(ps.t, ps.first, d, LINES[ps.edit].step >= 1); ps.first = false; }
      else if (ps.spot) { ps.spot[ps.spotAt].t = typeKey(ps.spot[ps.spotAt].t, false, d, LINES[ps.spot[ps.spotAt].i].step >= 1); ps.spotMsg = ''; }
    };
    ph.addEventListener('click', function (e) {
      var b = e.target.closest('[data-p]'); if (!b || busy || b.disabled || echo(e)) return;
      var a = b.getAttribute('data-p'), i = Number(b.getAttribute('data-i')), l;
      ps.flash = '';
      /* one tap never replaces a count that was typed: on a gap line the circle opens the quantity */
      if (a === 'ok' && isGap(i)) a = 'edit';
      if (a === 'ok') {
        dropUndo();
        if (isDone(i)) delete ps.got[i]; else { ps.got[i] = LINES[i].q; ps.just = i; }
        delete ps.bulk[i]; delete ps.dmg[i];
      }
      else if (a === 'edit') { dropUndo(); ps.edit = i; ps.t = ps.got[i] != null ? qty(ps.got[i]) : ''; ps.first = ps.got[i] != null; ps.dmgEdit = !!ps.dmg[i]; opener = '[data-p="edit"][data-i="' + i + '"]'; }
      else if (a === 'dec' || a === 'inc') { l = LINES[ps.edit]; if (a === 'dec' && (ps.t === '' || ps.t === '.')) return; ps.t = qty(Math.max(0, (Number(ps.t) || 0) + (a === 'inc' ? l.step : -l.step))); ps.first = true; }
      else if (a === 'zero') { ps.t = '0'; ps.first = true; ps.dmgEdit = false; }
      else if (a === 'asordered') { ps.t = qty(LINES[ps.edit].q); ps.first = true; }
      else if (a === 'dmg') ps.dmgEdit = !ps.dmgEdit;
      else if (a === 'key') typeInto(b.getAttribute('data-d'));
      else if (a === 'save') {
        if (ps.t === '' || ps.t === '.') return;
        leave(function () {
          var v = Number(ps.t), at = ps.edit;
          ps.got[at] = v; delete ps.bulk[at];
          if (ps.dmgEdit && v > 0) ps.dmg[at] = true; else delete ps.dmg[at];
          ps.edit = null; ps.just = at;
        });
        return;
      }
      else if (a === 'close-sheet') { leave(closeAll); return; }
      else if (a === 'spot-pick') ps.spotAt = Number(b.getAttribute('data-k'));
      else if (a === 'spot-ok') {
        if (ps.spot.some(function (sp) { return sp.t === '' || sp.t === '.'; })) {
          ps.spotMsg = 'רשמו כמות לכל פריט';
          ps.spot.some(function (sp, k) { if (sp.t === '' || sp.t === '.') { ps.spotAt = k; return true; } return false; });
        }
        else {
          leave(function () {
            var bad = ps.spot.filter(function (sp) { return !within(Number(sp.t), LINES[sp.i].q); });
            var marked = ps.spot.map(function (sp) { return sp.i; });
            var before = {}, nBulk = 0, k;
            for (k in ps.got) before[k] = ps.got[k];
            ps.spot.forEach(function (sp) { ps.got[sp.i] = Number(sp.t); });
            if (bad.length) ps.noBulk = true;
            else {
              /* the bulk mark can be taken back for ten seconds */
              LINES.forEach(function (_, j) { if (ps.got[j] == null) { ps.got[j] = LINES[j].q; ps.bulk[j] = true; marked.push(j); nBulk++; } });
              dropUndo();
              if (nBulk) { ps.undo = { got: before, n: nBulk + ps.spot.length }; undoTimer = setTimeout(function () { undoTimer = null; ps.undo = null; if (!ps.closed) renderPhone(); }, 10000); }
            }
            ps.many = marked.sort(function (x, y) { return x - y; });
            ps.spot = null; ps.spotMsg = '';
          });
          return;
        }
      }
      else if (a === 'undo-bulk') {
        if (ps.undo) { ps.got = ps.undo.got; ps.bulk = {}; dropUndo(); }
      }
      else if (a === 'slip') { ps.slip = true; opener = '[data-p="slip"]'; }
      else if (a === 'close-now' || a === 'close-nodoc') { opener = '[data-p="reset"]'; leave(function () { closeAll(); dropUndo(); ps.closed = true; }); return; }
      else if (a === 'shoot-close') { opener = '[data-p="reset"]'; leave(function () { closeAll(); dropUndo(); ps.photo = true; ps.closed = true; }); return; }
      else if (a === 'reset') { dropUndo(); ps = fresh(); }
      renderPhone();
    });
    /* Escape closes a sheet; a hardware keyboard types into the keypad */
    ph.addEventListener('keydown', function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey || busy || !sheetOpen()) return;
      if (e.key === 'Escape') { e.preventDefault(); leave(closeAll); return; }
      if (ps.edit == null && !ps.spot) return;
      var d = /^[0-9]$/.test(e.key) ? e.key : (e.key === '.' || e.key === ',') ? '.' : e.key === 'Backspace' ? 'del' : null;
      if (!d) return;
      e.preventDefault(); typeInto(d); renderPhone();
    });
    mainEl.addEventListener('click', function (e) {
      if (busy || mainEl.disabled || echo(e)) return;
      var n = left();
      ps.flash = ''; dropUndo();
      opener = '#ph-main';
      if (n) {
        /* a blind count of two lines, picked at random, comes before any bulk "as ordered" */
        var rest = LINES.map(function (_, i) { return i; }).filter(function (i) { return ps.got[i] == null; });
        for (var k = rest.length - 1; k > 0; k--) { var r = Math.floor(Math.random() * (k + 1)), tmp = rest[k]; rest[k] = rest[r]; rest[r] = tmp; }
        ps.spot = rest.slice(0, 2).sort(function (x, y) { return x - y; }).map(function (i) { return { i: i, t: '' }; }); ps.spotAt = 0; ps.spotMsg = '';
      }
      else if (!ps.photo || gapList().length) ps.ask = true;
      else { ps.closed = true; opener = '[data-p="reset"]'; }
      renderPhone();
      if (ps.closed) backToOpener();
    });
    camEl.addEventListener('click', function (e) { if (busy || echo(e)) return; ps.photo = !ps.photo; ps.shot = ps.photo; ps.flash = ''; renderPhone(); });
    renderPhone();
  }

  (function () {
  /* ---------- the side menu: one component for the three desk mock-ups ----------
     Structure, sizes and behaviour follow the spec the owner approved on 31.10 (docs/ux/sidebar/SPEC.md):
     248 open, 64 collapsed; one tile per group in the collapsed menu, with the group's list beside it; a dot,
     never an amount, on a folded group that holds money; favourites after a star; Ctrl B and [. */
  var NAV = [
    { id: 'top', items: [{ k: 'home', i: 'home', t: 'בית', href: '#ex1' }, { k: 'queue', i: 'queue', t: 'לטיפולי' }] },
    { id: 'money', t: 'כסף', i: 'wallet', items: [
      { k: 'approvals', i: 'inbox', t: 'אישורים', href: '#ex2' }, { k: 'inbox', i: 'receipt', t: 'חשבוניות נכנסות' }, { k: 'payrun', i: 'cash', t: 'ריצת תשלומים' },
      { k: 'claims', i: 'credit', flip: 1, t: 'בקשות זיכוי' }, { k: 'ledger', i: 'book', t: 'כרטסת ספקים' }, { k: 'close', i: 'calendar', t: 'סגירת חודש וייצוא' }] },
    { id: 'analysis', t: 'ניתוח', i: 'spline', items: [{ k: 'leaks', i: 'leak', t: 'דליפה' }, { k: 'reports', i: 'file', t: 'דוחות' }, { k: 'ask', i: 'spark', t: 'שאלו את <span lang="en" dir="ltr">RestoMatch</span>' }] },
    { id: 'procure', t: 'רכש', i: 'basket', items: [
      { k: 'orders', i: 'cart', t: 'הזמנות' }, { k: 'receiving', i: 'box', t: 'קבלת סחורה', href: '#ex3' }, { k: 'suppliers', i: 'truck', flip: 1, t: 'ספקים' },
      { k: 'catalog', i: 'layers', t: 'קטלוג' }, { k: 'contracts', i: 'tag', t: 'חוזים ומחירים' }] },
    { id: 'kitchen', t: 'מטבח', i: 'utensils', items: [{ k: 'recipes', i: 'dish', t: 'עלות מנה' }, { k: 'count', i: 'scale', t: 'ספירת מלאי' }] },
    { id: 'chain', t: 'רשת', i: 'building', items: [{ k: 'chain', i: 'network', t: 'סקירת רשת' }, { k: 'branches', i: 'store', t: 'סניפים' }] },
    { id: 'admin', t: 'ניהול', i: 'sliders', foot: 1, items: [{ k: 'team', i: 'users', t: 'צוות' }, { k: 'integrations', i: 'plug', t: 'חיבורים' }, { k: 'settings', i: 'settings', t: 'הגדרות', href: '#ex4' }] }
  ];
  var MENUS = {};
  var navItem = function (k) { var r = null; NAV.forEach(function (g) { g.items.forEach(function (x) { if (x.k === k) r = x; }); }); return r; };
  var navGroup = function (k) { var r = null; NAV.forEach(function (g) { g.items.forEach(function (x) { if (x.k === k) r = g; }); }); return r; };
  var groupById = function (id) { return NAV.filter(function (g) { return g.id === id; })[0]; };
  /* the text of a marked-up label: the characters outside the tags, read one by one (no pattern on tags) */
  var plain = function (t) {
    var s = String(t), out = '', inTag = false;
    for (var i = 0; i < s.length; i++) { var c = s.charAt(i); if (c === '<') inTag = true; else if (c === '>') inTag = false; else if (!inTag) out += c; }
    return out;
  };
  var ils0 = function (v) { return '<span class="money"><span class="cur">₪</span><span>' + Math.round(v).toLocaleString('en-US') + '</span></span>'; };
  var mi = function (n, flip) { return '<span class="mn-i">' + icon(n, flip ? 'flip' : '') + '</span>'; };
  var joinHe = function (a) { return a.length > 1 ? a.slice(0, -1).join(', ') + ' ו' + a[a.length - 1] : a[0] || ''; };

  /* what waits behind an entry. Money that waits is the only colour in the menu, and at most one label is solid. */
  var badgeOf = function (m, k) {
    var d = m.id === 'desk' && BUS.desk ? BUS.desk() : { n: 4, sum: 296, block: 2, claimed: 0 };
    if (k === 'approvals') {
      return !d.n ? null : { kind: 'ils', v: d.sum, tone: d.block ? 'solid' : 'warn',
        sr: (d.n === 1 ? 'פער אחד' : d.n + ' פערים') + ', ₪' + Math.round(d.sum) + ' בסיכון' + (!d.block ? '' : d.block === 1 ? ', אחד חוסם תשלום' : ', ' + d.block + ' חוסמים תשלום') };
    }
    if (k === 'claims') return { kind: 'ils', v: 450.88 + d.claimed, tone: 'warn', sr: '₪' + Math.round(450.88 + d.claimed) + ' בבקשות שמוכנות לשליחה' };
    if (k === 'queue') return { kind: 'count', n: d.n + 10, dot: d.block > 0, sr: (d.n + 10) + ' פריטים' + (d.block ? ', יש פער שחוסם תשלום' : '') };
    if (k === 'receiving') return { kind: 'count', n: 3, sr: '3 משלוחים צפויים היום' };
    if (k === 'contracts') return { kind: 'count', n: 1, sr: 'מחיר אחד שעלה מעל החוזה' };
    return null;
  };
  /* a folded group and a group tile show a dot only for money that waits; a count never rises to the group */
  var t2Of = function (m, g) {
    var tone = '';
    g.items.forEach(function (x) { var b = badgeOf(m, x.k); if (b && b.kind === 'ils') tone = b.tone === 'solid' || tone === 'danger' ? 'danger' : 'warn'; });
    return tone;
  };
  var t2Text = function (tone) { return tone === 'danger' ? 'יש בפנים תשלום שמחכה להחלטה' : 'יש בפנים כסף שמחכה לך'; };
  var pillHtml = function (b) {
    if (!b) return '';
    if (b.kind === 'ils') return '<span class="mn-b is-' + b.tone + '" aria-hidden="true">' + ils0(b.v) + '</span>';
    return '<span class="mn-b" aria-hidden="true">' + (b.dot ? '<span class="mn-d is-danger"></span>' : '') + (b.n > 99 ? '<bdi dir="ltr">99+</bdi>' : b.n) + '</span>';
  };
  var rowHtml = function (m, it, where) {
    var b = badgeOf(m, it.k), on = it.k === m.cur && where !== 'fav';
    return '<li><a class="mn-row' + (on ? ' is-on' : '') + '"' + (it.href ? ' href="' + it.href + '"' : '') + (on ? ' aria-current="page"' : '') + ' data-k="' + it.k + '">' +
      mi(it.i, it.flip) + '<span class="mn-l">' + it.t + '</span>' + (b ? '<span class="sr">, ' + b.sr + '</span>' : '') + pillHtml(b) + '</a></li>';
  };
  var groupExtra = function (m, g) {
    var open = !!m.open[g.id], here = !!m.cur && navGroup(m.cur) === g, tone = t2Of(m, g);
    return (!open && tone ? '<span class="mn-d is-' + tone + '" aria-hidden="true"></span><span class="sr">, ' + t2Text(tone) + '</span>' : '') + (!open && here ? '<span class="sr">, המסך הנוכחי כאן</span>' : '');
  };
  var groupHtml = function (m, g) {
    var open = !!m.open[g.id], here = !!m.cur && navGroup(m.cur) === g, hid = m.uid + '-h-' + g.id, lid = m.uid + '-l-' + g.id;
    return '<div class="mn-grp' + (open ? ' is-open' : '') + '" role="group" aria-labelledby="' + hid + '" data-grp="' + g.id + '">' +
      '<button class="mn-g' + (here && !open ? ' is-here' : '') + '" id="' + hid + '" data-m="fold" data-g="' + g.id + '" aria-expanded="' + open + '" aria-controls="' + lid + '"' + (here && !open ? ' aria-current="true"' : '') + '>' +
      mi(g.i) + '<span class="mn-gl"><span>' + g.t + '</span>' + icon('down', 'mn-chev') + '</span><span class="mn-gx">' + groupExtra(m, g) + '</span></button>' +
      '<ul class="mn-list" id="' + lid + '"' + (open ? '' : ' hidden') + '>' + g.items.map(function (x) { return rowHtml(m, x, 'list'); }).join('') + '</ul></div>';
  };
  var headHtml = function (rail) {
    return '<div class="mn-head"><div class="mn-sw"><span class="mn-mono" aria-hidden="true">כ</span>' +
      (rail ? '<span class="sr">כפר הזיתים, בעלים, 3 סניפים</span>' : '<span class="mn-bn"><b>כפר הזיתים</b><small>בעלים, 3 סניפים</small></span>' + icon('updown')) + '</div></div>';
  };
  var toggleHtml = function (m) {
    var l = m.rail ? 'הרחבת התפריט' : 'כיווץ התפריט';
    return '<button class="mn-ib mn-toggle" data-m="toggle" aria-label="' + l + '" aria-keyshortcuts="Control+B Meta+B" data-tip="' + l + '|Ctrl B|' + (m.keep ? 'הבחירה נשמרת בדפדפן הזה' : 'בהדמיה הזאת הבחירה לא נשמרת') + '">' + icon(m.rail ? 'panel-open' : 'panel') + '</button>';
  };
  var openHtml = function (m) {
    var k = '<span class="mn-i">' + icon('search') + '</span><span class="mn-kl">חיפוש או פקודה</span><kbd dir="ltr">Ctrl K</kbd>';
    var h = headHtml(false) + '<div class="mn-k">' + (m.cmd ? '<button class="mn-kb" data-m="cmd" aria-keyshortcuts="Control+K Meta+K">' + k + '</button>' : '<div class="mn-kb is-static">' + k + '</div>') + '</div>';
    h += '<nav class="mn-nav" aria-label="ניווט ראשי"><div class="mn-scroll"><ul class="mn-list">' + NAV[0].items.map(function (x) { return rowHtml(m, x, 'list'); }).join('') + '</ul>';
    if (m.fav.length) {
      h += '<div class="mn-grp is-open is-fav" role="group" aria-labelledby="' + m.uid + '-h-fav"><div class="mn-g mn-gh" id="' + m.uid + '-h-fav">' + mi('star') + '<span class="mn-gl"><span>מועדפים</span></span></div>' +
        '<ul class="mn-list">' + m.fav.map(function (fk) { return rowHtml(m, navItem(fk), 'fav'); }).join('') + '</ul></div>';
    }
    h += '<div class="mn-gap" aria-hidden="true"></div>' + NAV.filter(function (g) { return g.t && !g.foot; }).map(function (g) { return groupHtml(m, g); }).join('') + '</div>';
    h += '<div class="mn-foot">' + NAV.filter(function (g) { return g.foot; }).map(function (g) { return groupHtml(m, g); }).join('') +
      '<div class="mn-help"><span>' + icon('help') + 'עזרה</span><span>' + icon('a11y') + 'נגישות</span><span>' + icon('chat') + 'צור קשר</span></div></div></nav>';
    h += '<div class="mn-user"><div class="mn-acc"><span class="mn-ava" aria-hidden="true">ד</span><span class="mn-un"><b>דנה כהן</b><small>בעלים</small></span></div>' + toggleHtml(m) + '</div>';
    return h;
  };
  var dotOf = function (b) { return !b ? '' : b.kind === 'ils' ? (b.tone === 'solid' ? 'danger' : 'warn') : b.dot ? 'danger' : 'neutral'; };
  var tileItem = function (m, it) {
    var b = badgeOf(m, it.k), on = it.k === m.cur, d = dotOf(b);
    return '<li><a class="mn-tile' + (on ? ' is-on' : '') + '"' + (it.href ? ' href="' + it.href + '"' : '') + (on ? ' aria-current="page"' : '') + ' data-k="' + it.k + '">' +
      '<span class="mn-i">' + icon(it.i) + (d ? '<span class="mn-d is-' + d + '" aria-hidden="true"></span>' : '') + '</span><span class="mn-tl" aria-hidden="true">' + plain(it.t) + '</span>' +
      '<span class="sr">' + plain(it.t) + (b ? ', ' + b.sr : '') + '</span></a></li>';
  };
  var tileGroup = function (m, g, fav) {
    var here = !fav && !!m.cur && navGroup(m.cur) === g, tone = fav ? '' : t2Of(m, g), open = m.fly === g.id;
    return '<li><button class="mn-tile' + (here ? ' is-on' : '') + '" data-m="fly" data-g="' + g.id + '" aria-haspopup="true" aria-expanded="' + open + '"' + (here ? ' aria-current="true"' : '') +
      ' data-tip="' + g.t + '||Enter או חץ שמאלה פותחים את הרשימה" data-tipk>' +
      '<span class="mn-i">' + icon(g.i) + (tone ? '<span class="mn-d is-' + tone + '" aria-hidden="true"></span>' : '') + '</span><span class="mn-tl" aria-hidden="true">' + g.t + '</span>' +
      '<span class="sr">' + g.t + (tone ? ', ' + t2Text(tone) : '') + (here ? ', המסך הנוכחי כאן' : '') + '</span></button></li>';
  };
  var FAVG = { id: 'fav', t: 'מועדפים', i: 'star' };
  var railHtml = function (m) {
    var s = '<span class="mn-i">' + icon('search') + '</span><span class="mn-tl">חיפוש</span>';
    var h = headHtml(true) + '<nav class="mn-nav" aria-label="ניווט ראשי"><div class="mn-scroll"><ul class="mn-tiles">' +
      '<li>' + (m.cmd ? '<button class="mn-tile" data-m="cmd" aria-keyshortcuts="Control+K Meta+K" data-tip="חיפוש או פקודה|Ctrl K|" data-tipk>' + s + '</button>' : '<span class="mn-tile is-static">' + s + '</span>') + '</li>' +
      NAV[0].items.map(function (x) { return tileItem(m, x); }).join('') + (m.fav.length ? tileGroup(m, FAVG, true) : '') +
      '<li class="mn-sep" aria-hidden="true"></li>' + NAV.filter(function (g) { return g.t && !g.foot; }).map(function (g) { return tileGroup(m, g); }).join('') + '</ul></div>';
    h += '<div class="mn-foot"><ul class="mn-tiles">' + NAV.filter(function (g) { return g.foot; }).map(function (g) { return tileGroup(m, g); }).join('') +
      '<li><span class="mn-tile is-static"><span class="mn-i">' + icon('help') + '</span><span class="mn-tl">עזרה</span></span></li></ul></div></nav>';
    h += '<div class="mn-user"><span class="mn-ava" role="img" aria-label="דנה כהן, בעלים">ד</span>' + toggleHtml(m) + '</div>';
    return h;
  };
  var saySide = function (m, t) { if (m.live) m.live.textContent = t; };
  var MKEY = 'rm-proposal-menu-3';
  var keepMenu = function (m) { if (m.keep) { try { window.localStorage.setItem(MKEY, JSON.stringify({ rail: m.rail, open: m.open, fav: m.fav })); } catch (e) {} } };
  var narrowM = function (m) { return m.app.classList.contains('is-narrow'); };
  var stillM = function (m) { return reduce || m.app.classList.contains('no-motion'); };
  /* where a point of the mock-up sits in its own pixels: the stage may be scaled */
  var place = function (m, r) {
    var R = m.app.getBoundingClientRect(), kx = R.width ? m.app.offsetWidth / R.width : 1, ky = R.height ? m.app.offsetHeight / R.height : 1;
    return { top: (r.top - R.top) * ky, bottom: (r.bottom - R.top) * ky, left: (r.left - R.left) * kx, right: (R.right - r.right) * kx, h: r.height * ky, w: r.width * kx };
  };
  /* the list fades at an edge it is clipped at */
  var clipM = function (m) {
    var sc = m.el.querySelector('.mn-scroll'); if (!sc) return;
    sc.classList.toggle('is-clip-b', sc.scrollHeight - sc.clientHeight - sc.scrollTop > 2);
    sc.classList.toggle('is-clip-t', sc.scrollTop > 2);
  };
  var syncGroup = function (m, gid) {
    var grp = m.el.querySelector('[data-grp="' + gid + '"]'), g = groupById(gid); if (!grp || !g) return;
    var open = !!m.open[gid], here = !!m.cur && navGroup(m.cur) === g, btn = grp.querySelector('.mn-g'), list = grp.querySelector('.mn-list');
    grp.classList.toggle('is-open', open); btn.setAttribute('aria-expanded', String(open)); list.hidden = !open;
    btn.classList.toggle('is-here', here && !open);
    if (here && !open) btn.setAttribute('aria-current', 'true'); else btn.removeAttribute('aria-current');
    grp.querySelector('.mn-gx').innerHTML = groupExtra(m, g);
  };
  /* the fit rule: while the list overflows, fold the group opened longest ago; never the one just opened,
     never the one that holds this page, never one that holds money that waits */
  var fitMenu = function (m, just) {
    if (m.rail || narrowM(m)) return;
    var sc = m.el.querySelector('.mn-scroll'), folded = [], guard = 8, lastFold = ''; if (!sc) return;
    var here = m.cur ? navGroup(m.cur) : null;
    while (sc.scrollHeight - sc.clientHeight > 1 && guard--) {
      var cand = NAV.filter(function (g) { return g.t && !g.foot && m.open[g.id] && g.id !== just && g !== here && !t2Of(m, g); })
        .sort(function (a, b) { return (m.at[a.id] || 0) - (m.at[b.id] || 0); })[0];
      if (!cand) break;
      m.open[cand.id] = false; syncGroup(m, cand.id); folded.push(cand.t); lastFold = cand.id;
    }
    if (folded.length) {
      var words = 'קיפלנו את ' + joinHe(folded) + ' כדי שהתפריט ייכנס במסך', hd = m.el.querySelector('[data-grp="' + lastFold + '"] .mn-g');
      saySide(m, words); keepMenu(m); if (hd) noteTip(m, hd, words);
    }
    clipM(m);
  };
  var hideTip = function (m) { clearTimeout(m.tipT); clearTimeout(m.noteT); if (m.tip && !m.tip.hidden) { m.tip.hidden = true; m.tipAt = Date.now(); } m.tipFor = null; };
  var placeTip = function (m, el, html) {
    clearTimeout(m.noteT);
    m.tip.innerHTML = html; m.tip.hidden = false; m.tip.style.top = '0px'; m.tip.style.insetInlineStart = '0px'; m.tipFor = el;
    var p = place(m, el.getBoundingClientRect()), tw = m.tip.offsetWidth, th = m.tip.offsetHeight, W = m.app.offsetWidth, H = m.app.offsetHeight, top, start;
    if (m.el.contains(el)) { start = m.el.offsetWidth + 8; top = p.top + p.h / 2 - th / 2; }
    else { start = p.right + p.w / 2 - tw / 2; top = p.bottom + 8; }
    m.tip.style.top = Math.round(Math.max(8, Math.min(H - th - 8, top))) + 'px';
    m.tip.style.insetInlineStart = Math.round(Math.max(8, Math.min(W - tw - 8, start))) + 'px';
  };
  var showTip = function (m, el) {
    var d = (el.getAttribute('data-tip') || '').split('|'); if (!d[0]) return;
    placeTip(m, el, '<b>' + d[0] + (d[1] ? '<kbd dir="ltr">' + d[1] + '</kbd>' : '') + '</b>' + (d[2] ? '<small>' + d[2] + '</small>' : ''));
  };
  /* when the menu folds a group by itself it says so beside that group, for a moment; a screen reader hears the same words */
  var noteTip = function (m, el, text) {
    placeTip(m, el, '<b>' + text + '</b>');
    m.noteT = setTimeout(function () { if (m.tipFor === el) hideTip(m); }, 3200);
  };
  var paintMenu = function (m, focusSel) {
    hideTip(m);
    m.inner.innerHTML = m.rail ? railHtml(m) : openHtml(m);
    m.sig = JSON.stringify(['approvals', 'claims', 'queue'].map(function (k) { return badgeOf(m, k); }));
    var sc = m.el.querySelector('.mn-scroll'); if (sc) sc.addEventListener('scroll', function () { clipM(m); hideTip(m); }, { passive: true });
    if (focusSel) { var f = m.el.querySelector(focusSel); if (f) f.focus({ preventScroll: true }); }
    clipM(m);
  };
  var closeFly = function (m, refocus) {
    clearTimeout(m.flyT);
    if (!m.fly) return;
    var gid = m.fly; m.fly = null; m.flyEl.hidden = true; m.flyEl.innerHTML = '';
    var t = m.el.querySelector('.mn-tile[data-g="' + gid + '"]');
    if (t) { t.setAttribute('aria-expanded', 'false'); if (refocus) t.focus({ preventScroll: true }); }
  };
  var openFly = function (m, gid, focusIn) {
    var g = gid === 'fav' ? FAVG : groupById(gid), t = m.el.querySelector('.mn-tile[data-g="' + gid + '"]');
    if (!g || !t || !m.rail) return;
    if (m.fly && m.fly !== gid) closeFly(m);
    clearTimeout(m.flyT); hideTip(m);
    var items = gid === 'fav' ? m.fav.map(navItem) : g.items;
    m.flyEl.innerHTML = '<div class="mn-fly-h"><b id="' + m.uid + '-fly-t">' + g.t + '</b>' +
      (gid === 'fav' ? '' : '<button class="mn-ib" data-m="pin" data-g="' + gid + '" aria-label="הצמדת התפריט הפתוח עם ' + g.t + '" data-tip="הצמדת התפריט||פותח את התפריט המלא עם ' + g.t + '">' + icon('pin') + '</button>') + '</div>' +
      '<ul class="mn-list">' + items.map(function (x) { return rowHtml(m, x, gid === 'fav' ? 'fav' : 'fly'); }).join('') + '</ul>';
    m.flyEl.setAttribute('aria-labelledby', m.uid + '-fly-t');
    m.flyEl.hidden = false; m.fly = gid; t.setAttribute('aria-expanded', 'true');
    var p = place(m, t.getBoundingClientRect()), H = m.app.offsetHeight, fh = m.flyEl.offsetHeight;
    m.flyEl.style.top = Math.round(Math.max(8, Math.min(H - fh - 8, p.top - 4))) + 'px';
    m.flyEl.style.insetInlineStart = (m.el.offsetWidth + 8) + 'px';
    if (!stillM(m)) replayCss(m.flyEl, 'is-in');
    if (focusIn) { var f = m.flyEl.querySelector('a[href]') || m.flyEl.querySelector('button'); if (f) f.focus({ preventScroll: true }); }
  };
  /* collapse: the words fade, then the width closes. Expand: the width opens, then the words arrive. */
  var setRail = function (m, on, focusToggle, just) {
    if (m.rail === on || m.busy || narrowM(m)) return;
    closeFly(m); hideTip(m);
    var go = function () {
      m.rail = on; m.app.classList.toggle('is-rail', on); paintMenu(m, focusToggle ? '.mn-toggle' : null); keepMenu(m);
      if (!on) fitMenu(m, just);
      if (m.onChange) m.onChange();
    };
    if (stillM(m)) { go(); return; }
    m.busy = true; m.el.classList.add('is-out');
    setTimeout(function () {
      m.el.classList.remove('is-out'); m.app.classList.toggle('is-growing', !on); go(); m.el.classList.add('is-in');
      setTimeout(function () { m.el.classList.remove('is-in'); m.busy = false; }, on ? 220 : 300);
    }, 80);
  };
  var setGroup = function (m, gid, on) {
    m.open[gid] = on; if (on) m.at[gid] = ++m.seq;
    syncGroup(m, gid); keepMenu(m);
    if (on) fitMenu(m, gid); else clipM(m);
  };
  var setFav = function (m, k, on) {
    var at = m.fav.indexOf(k);
    if (on && at < 0 && m.fav.length < 5) m.fav.push(k);
    if (!on && at >= 0) m.fav.splice(at, 1);
    keepMenu(m); closeFly(m); paintMenu(m); fitMenu(m);
    saySide(m, plain(navItem(k).t) + (on ? ' נוסף למועדפים, בראש התפריט' : ' הוסר מהמועדפים'));
    syncStar(m);
  };
  var syncStar = function (m) {
    var s = m.app.querySelector('[data-m="star"]'); if (!s) return;
    var on = m.fav.indexOf(m.cur) >= 0, l = on ? 'הסרה מהמועדפים' : 'הוספה למועדפים';
    s.setAttribute('aria-pressed', String(on)); s.setAttribute('aria-label', l + ', עד 5 מסכים בראש התפריט'); s.setAttribute('data-tip', l + '||עד 5 מסכים בראש התפריט');
  };
  var focusables = function (root) { return $$('a[href], button:not([disabled])', root).filter(function (x) { return !x.closest('[hidden]'); }); };
  var mkMenu = function (el, n) {
    var app = el.closest('.rm-app'), sec = el.closest('section.sec');
    var m = { el: el, app: app, uid: 'mn' + n, id: el.getAttribute('data-menu'), cur: el.getAttribute('data-current'), keep: el.hasAttribute('data-keep'), cmd: el.hasAttribute('data-cmd'),
      rail: el.getAttribute('data-start') === 'rail', open: { money: true, analysis: true }, at: { money: 1, analysis: 2 }, seq: 2, fav: [], fly: null, busy: false, sec: sec ? sec.id : '' };
    /* the owner's default is money and analysis open; the group that holds this page is always open */
    var hg = m.cur ? navGroup(m.cur) : null; if (hg && hg.t) { m.open[hg.id] = true; m.at[hg.id] = ++m.seq; }
    if (m.keep) {
      try {
        var raw = window.localStorage.getItem(MKEY), p = raw ? JSON.parse(raw) : null;
        if (p && typeof p.rail === 'boolean') m.rail = p.rail;
        if (p && p.open && typeof p.open === 'object') NAV.forEach(function (g) { if (g.t && typeof p.open[g.id] === 'boolean' && g !== hg) m.open[g.id] = p.open[g.id]; });
        if (p && Array.isArray(p.fav)) m.fav = p.fav.filter(function (k) { return !!navItem(k); }).slice(0, 5);
      } catch (e) {}
    }
    el.innerHTML = '<div class="mn-in"></div><span class="mn-edge" data-m="toggle" aria-hidden="true"></span><p class="sr" role="status"></p>';
    m.inner = el.firstChild; m.live = el.lastChild;
    m.flyEl = document.createElement('div'); m.flyEl.className = 'mn-fly'; m.flyEl.id = m.uid + '-fly'; m.flyEl.setAttribute('role', 'group'); m.flyEl.hidden = true;
    m.tip = document.createElement('div'); m.tip.className = 'mn-tip'; m.tip.setAttribute('aria-hidden', 'true'); m.tip.hidden = true;
    app.appendChild(m.flyEl); app.appendChild(m.tip);
    app.classList.toggle('is-rail', m.rail);
    paintMenu(m); syncStar(m);

    app.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-m]') : null; if (!t) return;
      var act = t.getAttribute('data-m'), kb = e.detail === 0, gid = t.getAttribute('data-g');
      if (act === 'toggle') setRail(m, !m.rail, kb);
      else if (act === 'fold') setGroup(m, gid, !m.open[gid]);
      else if (act === 'fly') { if (m.fly === gid) closeFly(m); else openFly(m, gid, kb); }
      else if (act === 'pin') {
        m.open[gid] = true; m.at[gid] = ++m.seq; setRail(m, false, false, gid);
        setTimeout(function () { var h = m.el.querySelector('.mn-g[data-g="' + gid + '"]'); if (h && kb) h.focus({ preventScroll: true }); }, stillM(m) ? 0 : 120);
      }
      else if (act === 'star') { setFav(m, m.cur, m.fav.indexOf(m.cur) < 0); if (!kb) hideTip(m); else showTip(m, t); }
    });
    /* the list of a group opens beside its tile after a short rest of the pointer, and closes a moment after the pointer leaves both */
    var overTile = function (e) { return e.pointerType === 'mouse' && m.rail ? (e.target.closest ? e.target.closest('.mn-tile[data-g]') : null) : null; };
    el.addEventListener('pointerover', function (e) {
      var t = overTile(e); if (!t) return;
      var gid = t.getAttribute('data-g'); clearTimeout(m.flyT);
      if (m.fly !== gid) m.flyT = setTimeout(function () { openFly(m, gid, false); }, 220);
    });
    var leaveSoon = function (e) { if (e.pointerType !== 'mouse') return; clearTimeout(m.flyT); if (m.fly) m.flyT = setTimeout(function () { if (!m.flyEl.contains(document.activeElement)) closeFly(m); }, 300); };
    el.addEventListener('pointerout', function (e) { if (overTile(e) && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.mn-tile[data-g="' + m.fly + '"]'))) leaveSoon(e); });
    m.flyEl.addEventListener('pointerenter', function () { clearTimeout(m.flyT); });
    m.flyEl.addEventListener('pointerleave', leaveSoon);
    /* a dark label beside an icon-only control: after a rest of the pointer, at once on keyboard focus */
    var tipOf = function (e) { var t = e.target.closest ? e.target.closest('[data-tip]') : null; return t && app.contains(t) ? t : null; };
    app.addEventListener('pointerover', function (e) {
      var t = tipOf(e); if (!t || e.pointerType !== 'mouse' || t.hasAttribute('data-tipk') || m.tipFor === t) return;
      clearTimeout(m.tipT); m.tipT = setTimeout(function () { showTip(m, t); }, Date.now() - (m.tipAt || 0) < 300 ? 0 : 450);
    });
    app.addEventListener('pointerout', function (e) { var t = tipOf(e); if (t && !(e.relatedTarget && t.contains(e.relatedTarget))) hideTip(m); });
    app.addEventListener('focusin', function (e) { var t = tipOf(e); if (t && t.matches(':focus-visible')) showTip(m, t); });
    app.addEventListener('focusout', function (e) { if (tipOf(e)) hideTip(m); if (m.fly && m.flyEl.contains(e.target) && !m.flyEl.contains(e.relatedTarget)) closeFly(m); });
    /* arrows: up and down through the entries, left opens or enters a group, right goes back to it or closes it */
    el.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var t = e.target, c = e.key, list = focusables(m.inner), at = list.indexOf(t);
      if (at < 0) return;
      var move = c === 'ArrowDown' ? at + 1 : c === 'ArrowUp' ? at - 1 : c === 'Home' ? 0 : c === 'End' ? list.length - 1 : -2;
      if (move > -2) { e.preventDefault(); var n = list[Math.max(0, Math.min(list.length - 1, move))]; if (n) n.focus(); return; }
      var gid = t.getAttribute('data-g');
      if (m.rail) { if (gid && (c === 'ArrowLeft')) { e.preventDefault(); openFly(m, gid, true); } return; }
      if (c === 'ArrowLeft' && gid) {
        e.preventDefault();
        if (!m.open[gid]) setGroup(m, gid, true); else { var f = t.parentNode.querySelector('.mn-list a[href]'); if (f) f.focus(); }
      } else if (c === 'ArrowRight') {
        var grp = t.closest('.mn-grp'), hd = grp ? grp.querySelector('button.mn-g') : null;
        if (gid && m.open[gid]) { e.preventDefault(); setGroup(m, gid, false); }
        else if (!gid && hd) { e.preventDefault(); hd.focus(); }
      }
    });
    m.flyEl.addEventListener('keydown', function (e) {
      var list = focusables(m.flyEl), at = list.indexOf(e.target), c = e.key;
      if (c === 'Escape' || c === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); closeFly(m, true); return; }
      var move = c === 'ArrowDown' ? at + 1 : c === 'ArrowUp' ? at - 1 : c === 'Home' ? 0 : c === 'End' ? list.length - 1 : -2;
      if (move > -2 && list.length) { e.preventDefault(); list[(move + list.length) % list.length].focus(); }
    });
    return m;
  };
  $$('aside[data-menu]').forEach(function (el, i) { var m = mkMenu(el, i + 1); MENUS[m.id] = m; });
  var menuList = function () { return Object.keys(MENUS).map(function (k) { return MENUS[k]; }); };
  /* the desk decides a gap: the labels of its own menu follow */
  BUS.subs.push(function () {
    menuList().forEach(function (m) {
      var sig = JSON.stringify(['approvals', 'claims', 'queue'].map(function (k) { return badgeOf(m, k); }));
      if (sig === m.sig) return;
      var had = m.el.contains(document.activeElement);
      closeFly(m); paintMenu(m); if (!had) fitMenu(m);
    });
  });
  var typing = function (t) { return !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable); };
  var menuAt = function () { var ok = menuList().filter(function (m) { return !narrowM(m); }); return ok.filter(function (m) { return m.app.matches(':hover'); })[0] || ok.filter(function (m) { return m.app.contains(document.activeElement); })[0]; };
  document.addEventListener('keydown', function (e) {
    var m;
    if (e.key === 'Escape') { menuList().forEach(function (x) { if (x.tipFor) hideTip(x); else if (x.fly && !x.flyEl.contains(e.target)) closeFly(x, x.flyEl.contains(document.activeElement)); }); return; }
    if (e.repeat || e.shiftKey || e.altKey) return;
    /* Ctrl B folds the menu as it does in the live product, here in the mock-up that holds the pointer or the focus */
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyB') { if (typing(e.target) || !(m = menuAt())) return; e.preventDefault(); setRail(m, !m.rail, m.el.contains(document.activeElement)); return; }
    /* [ does the same with one key; one-key shortcuts can be switched off */
    if (!e.ctrlKey && !e.metaKey && e.code === 'BracketLeft' && PREF.keys) { if (typing(e.target) || !(m = menuAt())) return; e.preventDefault(); setRail(m, !m.rail, m.el.contains(document.activeElement)); }
  });
  document.addEventListener('pointerdown', function (e) {
    menuList().forEach(function (m) { if (m.fly && !m.flyEl.contains(e.target) && !(e.target.closest && e.target.closest('.mn-tile[data-g]') && m.el.contains(e.target))) closeFly(m); });
  });
  document.addEventListener('rm:fit', function () { menuList().forEach(function (m) { closeFly(m); hideTip(m); fitMenu(m); }); });
  menuList().forEach(function (m) { fitMenu(m); });

  /* ---------- 4 · settings: a list of sections, the section that is open, and a field that finds any setting ---------- */
  var shell = document.getElementById('shell');
  if (shell && MENUS.shell) {
    var SM = MENUS.shell;
    var SKEY = 'rm-proposal-prefs-3';
    var fresh0 = function () { return { dens: 'regular', text: 'regular', motion: 'on', keys: true }; };
    /* what a person chose is kept in this browser; a browser that refuses storage simply starts from the defaults */
    var ss = fresh0();
    try { var rawS = window.localStorage.getItem(SKEY); if (rawS) { var pS = JSON.parse(rawS), kS; for (kS in ss) if (pS && pS[kS] !== undefined && typeof pS[kS] === typeof ss[kS]) ss[kS] = pS[kS]; } } catch (e) {}
    var keep = function () { try { window.localStorage.setItem(SKEY, JSON.stringify(ss)); } catch (e) {} };
    var DEF = { pp: 2, pa: 5, qp: 3, qa: 1, bp: 10 };
    var LIM = { pp: [0, 15], pa: [0, 20], qp: [0, 15], qa: [0, 5], bp: [5, 20] };
    var copyR = function (r) { return { pp: r.pp, pa: r.pa, qp: r.qp, qa: r.qa, bp: r.bp }; };
    var sameR = function (a, b) { return a.pp === b.pp && a.pa === b.pa && a.qp === b.qp && a.qa === b.qa && a.bp === b.bp; };
    var sv = { sect: 'display', q: '', hit: '', rules: copyR(DEF), saved: copyR(DEF), before: null, undoT: null, log: [], logOpen: false };
    var sectsEl = $('#sh-sects'), bodyEl = $('#sh-body'), qEl = $('#sh-q'), liveS = $('#sh-live'), mainS = shell.querySelector('.rm-main');
    var sayS = function (t) { if (liveS) liveS.textContent = t; };
    var narrowS = function () { return shell.classList.contains('is-narrow'); };
    var applyPrefs = function () {
      shell.setAttribute('data-text', ss.text);
      shell.classList.toggle('no-motion', ss.motion === 'off');
      PREF.keys = ss.keys; document.dispatchEvent(new Event('rm:keys'));
      if (PREF.dens !== ss.dens) applyDensity(ss.dens);
    };

    /* each section says how far a change in it reaches */
    var SECTS = [
      { g: 'אני', items: [['display', 'תצוגה', 'במכשיר הזה'], ['account', 'חשבון', 'אצלך, בכל מכשיר'], ['security', 'אבטחה', 'אצלך, בכל מכשיר'], ['privacy', 'פרטיות ונתונים', 'אצלך, בכל מכשיר']] },
      { g: 'המסעדה', items: [['biz', 'פרטי המסעדה', 'לכל המסעדה'], ['letter', 'מכתבי בקשת זיכוי', 'לכל המסעדה'], ['rules', 'כללי התאמה ואישור', 'לכל המסעדה']] }
    ];
    var IDX = [
      ['display', 'dens', 'צפיפות', 'שורות טבלה'], ['display', 'text', 'גודל טקסט', 'אותיות פונט'], ['display', 'rail', 'תפריט הצד', 'כיווץ הרחבה', 1], ['display', 'keys', 'קיצורים בתו אחד', 'מקלדת מקשים', 1],
      ['account', 'lang', 'שפת האפליקציה', 'עברית אנגלית'], ['account', 'pass', 'סיסמה', ''], ['account', 'dev', 'מכשירים מחוברים', 'ניתוק'],
      ['security', 'twofa', 'אימות דו־שלבי', 'קוד 2FA'],
      ['privacy', 'export', 'ייצוא הנתונים שלי', ''], ['privacy', 'del', 'מחיקת החשבון שלי', ''],
      ['biz', 'name', 'שם המסעדה', ''], ['biz', 'vatid', 'ח״פ או עוסק מורשה', ''], ['biz', 'vat', 'שיעור מע״מ', 'מעמ'], ['biz', 'tz', 'אזור זמן', ''],
      ['letter', 'legal', 'שם משפטי', ''], ['letter', 'addr', 'כתובת', ''], ['letter', 'phone', 'טלפון', ''], ['letter', 'mail', 'דוא״ל', 'מייל אימייל'],
      ['rules', 'pp', 'סבילות מחיר (%)', 'סף ספים'], ['rules', 'pa', 'סבילות מחיר (₪)', 'סף ספים שקלים'], ['rules', 'qp', 'סבילות כמות (%)', 'סף ספים'], ['rules', 'qa', 'סבילות כמות (יחידות)', 'סף ספים'],
      ['rules', 'bp', 'סף חסימת מחיר (%)', 'חוסם תשלום'], ['rules', 'appr', 'ספי אישור', 'בעלים מנהל'], ['rules', 'ocr', 'סף בדיקת OCR', 'סריקה זיהוי']
    ];
    var sectOf = function (id) { var r = null; SECTS.forEach(function (s) { s.items.forEach(function (x) { if (x[0] === id) r = x; }); }); return r; };
    var norm = function (t) { return String(t).toLowerCase().replace(/[״׳"'()־\-]/g, '').replace(/\s+/g, ' ').trim(); };
    /* a setting that does nothing on a phone (the side menu, row density, keyboard keys) is not offered there */
    var findSet = function (q) { var n = norm(q), nar = narrowS(); return IDX.filter(function (x) { return !(nar && x[4]) && norm(x[2] + ' ' + sectOf(x[0])[1] + ' ' + x[3]).indexOf(n) >= 0; }); };
    var renderSects = function () {
      var q = sv.q.trim(), h = '';
      if (q) {
        var hits = findSet(q);
        h = hits.length ? hits.map(function (x) { return '<button class="it" data-go="' + x[0] + '" data-hit="' + x[1] + '">' + x[2] + '<small>' + sectOf(x[0])[1] + '</small></button>'; }).join('')
          : '<p class="set-none">לא נמצאה הגדרה כזאת. אפשר לנסות: מע״מ, סיסמה, צפיפות</p>';
      } else {
        SECTS.forEach(function (s) {
          h += '<div class="set-g">' + s.g + '</div>' + s.items.map(function (x) {
            var dirty = x[0] === 'rules' && !sameR(sv.rules, sv.saved);
            return '<button class="it" data-sect="' + x[0] + '" aria-current="' + (sv.sect === x[0]) + '">' + x[1] + (dirty ? '<span class="dot dot-warn it-dot" aria-hidden="true"></span><span class="sr">, יש שינויים שלא נשמרו</span>' : '') + '</button>';
          }).join('');
        });
      }
      sectsEl.classList.toggle('is-results', !!q);
      sectsEl.innerHTML = h;
    };
    var segS = function (name, val, opts) { return '<div class="kit-seg" role="group" aria-label="' + name + '">' + opts.map(function (o) { return '<button data-set="' + name + '" data-v="' + o[0] + '" aria-pressed="' + (val === o[0]) + '">' + o[1] + '</button>'; }).join('') + '</div>'; };
    var row = function (id, l, d, c, cls) { return '<div class="set-row' + (sv.hit === id ? ' is-hit' : '') + (cls ? ' ' + cls : '') + '" data-row="' + id + '"><div class="l">' + l + '</div>' + (d ? '<div class="d">' + d + '</div>' : '') + '<div class="c">' + c + '</div></div>'; };
    var valS = function (t, off) { return '<span class="set-val' + (off ? ' is-off' : '') + '">' + t + '</span>'; };
    var head = function (id, sub) { var s = sectOf(id); return '<div class="set-h"><h2 aria-level="5">' + s[1] + '</h2><span class="st">' + s[2] + '</span></div><p class="set-sub">' + sub + '</p>'; };

    /* ----- the rules: what a threshold would do to the gaps that are open today -----
       The four open gaps of example 2, as the matching engine reads them. A price gap is opened unless the unit
       price is within both the percentage and the shekel tolerance; it holds the payment from the hold percentage
       up. A gap between ordered and received is opened above the percentage alone; a bill for more than was
       received holds the payment above the larger of the unit tolerance and the percentage of what was received.
       (packages/matching/src/engine.ts: evaluateQty and the billed-over-received block, read only.) */
    var GAPS = [
      { n: 'עגבניות שרי', kind: 'qty', ord: 9.5, over: 3, got: 6.5, amt: 38.70 },
      { n: 'בירה מהחבית', kind: 'price', pct: 10.03, abs: 52.40, amt: 104.80 },
      { n: 'אנטריקוט', kind: 'price', pct: 7.19, abs: 10.00, amt: 100.00 },
      { n: 'פילה סלמון', kind: 'price', pct: 7.87, abs: 7.00, amt: 52.50 }
    ];
    var judge = function (r) {
      return GAPS.map(function (g) {
        if (g.kind === 'qty') {
          var over = g.over > Math.max(r.qa, g.got * r.qp / 100), short = (g.ord - g.got) / g.ord * 100 > r.qp;
          return { g: g, opens: over || short, holds: over };
        }
        var opens = !(g.pct <= r.pp && g.abs <= r.pa);
        return { g: g, opens: opens, holds: opens && g.pct >= r.bp };
      });
    };
    var holdsTxt = function (n, k) { return !n ? '' : n === 1 ? (k ? ', והוא חוסם תשלום' : ', והוא לא חוסם תשלום') : !k ? ', ואף אחד מהם לא חוסם תשלום' : k === n ? (n === 2 ? ', ושניהם חוסמים תשלום' : ', וכולם חוסמים תשלום') : k === 1 ? ', ואחד מהם חוסם תשלום' : ', ו־<b class="num">' + k + '</b> מהם חוסמים תשלום'; };
    /* A saved threshold is read when an invoice is matched (packages/api/src/match/buildMatchInput.ts): it acts on
       invoices checked from then on, and gaps that are already open stay open. So the box always speaks of what
       the thresholds WOULD do to today's four gaps, and says when a new threshold starts to act. */
    var effectParts = function () {
      var j = judge(sv.rules), open = j.filter(function (x) { return x.opens; }), out = j.filter(function (x) { return !x.opens; }), hold = open.filter(function (x) { return x.holds; }).length;
      var n = open.length;
      var first = sameR(sv.rules, DEF) ? 'בספים האלה נפתחו <b class="num">4</b> הפערים הפתוחים היום' + holdsTxt(4, hold)
        : (n === 0 ? 'בספים האלה אף אחד מ־<b class="num">4</b> הפערים הפתוחים היום לא היה נפתח' : n === 4 ? 'בספים האלה כל <b class="num">4</b> הפערים הפתוחים היום היו נפתחים' : 'בספים האלה ' + (n === 1 ? 'פער אחד' : '<b class="num">' + n + '</b> פערים') + ' מתוך <b class="num">4</b> ' + (n === 1 ? 'היה נפתח' : 'היו נפתחים')) + holdsTxt(n, hold);
      var sum = out.reduce(function (a, x) { return a + x.g.amt; }, 0);
      return { first: first, second: out.length ? (out.length === 1 ? 'לא היה נפתח' : 'לא היו נפתחים') + ': ' + joinHe(out.map(function (x) { return x.g.n; })) + ', ' + money(sum, true) + ' לפני מע״מ' : '' };
    };
    var effect = function () {
      var e = effectParts();
      return '<div class="set-effect"><h3 aria-level="6">' + (sameR(sv.rules, sv.saved) ? 'הספים שבתוקף' : 'לפני ששומרים') + '</h3><p>' + e.first + '</p>' + (e.second ? '<p>' + e.second + '</p>' : '') +
        '<p class="set-when">סף חדש חל על חשבוניות שייבדקו מעכשיו, כולל חשבונית פתוחה שנבדקת מחדש.</p></div>';
    };
    /* what a change of a threshold would do is said once, in the one region that stays on the page */
    var sayEffect = function (lead) { var e = effectParts(); sayS((lead ? lead + '. ' : '') + plain(e.first) + (e.second ? '. ' + plain(e.second) : '')); };
    var RULES = [
      ['pp', 'סבילות מחיר (%)', 'הפרש מחיר נפתח כפער מעל האחוז הזה', '%'],
      ['pa', 'סבילות מחיר (₪)', 'או מעל הסכום הזה ליחידה', '₪'],
      ['qp', 'סבילות כמות (%)', 'הפרש בין מה שהוזמן למה שהתקבל נפתח כפער מעל האחוז הזה', '%'],
      ['qa', 'סבילות כמות (יחידות)', 'חיוב על יותר ממה שהתקבל חוסם תשלום מעל היחידות האלה והאחוז', ''],
      ['bp', 'סף חסימת מחיר (%)', 'עליית מחיר מהאחוז הזה ומעלה חוסמת את התשלום', '%']
    ];
    var fmtR = function (k, v) { var u = RULES.filter(function (x) { return x[0] === k; })[0][3]; return u === '₪' ? '<span class="money"><span class="cur">₪</span><span>' + v + '</span></span>' : v + u; };
    var numS = function (k) {
      var v = sv.rules[k], lo = LIM[k][0], hi = LIM[k][1], label = RULES.filter(function (x) { return x[0] === k; })[0][1];
      return '<div class="numf" role="group" aria-label="' + label + '"><button data-num="' + k + '" data-d="-1" aria-label="פחות"' + (v <= lo ? ' disabled' : '') + '>' + icon('minus') + '</button><output>' + fmtR(k, v) + '</output><button data-num="' + k + '" data-d="1" aria-label="יותר"' + (v >= hi ? ' disabled' : '') + '>' + icon('plus') + '</button></div>';
    };
    var chipR = function (k) { return sv.rules[k] !== sv.saved[k] ? '<span class="st st-warn">לא נשמר</span>' : sv.saved[k] === DEF[k] ? '<span class="st">ברירת מחדל</span>' : '<span class="st st-info">הותאם</span>'; };
    var saveBar = function () {
      if (sv.before) return '<div class="set-save is-done"><span>נשמר לכל המסעדה, ונרשם בהיסטוריה</span><span class="sp"></span><button class="btn btn-sm" data-do="undo">ביטול</button><i class="tm" aria-hidden="true"></i></div>';
      if (sameR(sv.rules, sv.saved)) return '';
      return '<div class="set-save"><b>יש שינויים שלא נשמרו</b><span class="sp"></span><button class="btn btn-quiet" data-do="discard">בטלו</button><button class="btn btn-primary" data-do="save">שמרו</button></div>';
    };
    var stamp = function () { var d = new Date(), p = function (n) { return ('0' + n).slice(-2); }; return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear() + ' · ' + p(d.getHours()) + ':' + p(d.getMinutes()); };
    /* who changed the rules last, the list of changes, and the previous values one click away: an undo must not
       live only inside a message that disappears */
    var logHtml = function () {
      if (!sv.log.length) return '';
      var last = sv.log[sv.log.length - 1], back = last.before && sameR(last.after, sv.saved) && sameR(sv.rules, sv.saved) && !sv.before;
      return '<div class="set-log"><p class="set-last">שונה לאחרונה: דנה כהן, <bdi>' + last.at + '</bdi></p>' +
        '<button class="disc" data-do="log" aria-expanded="' + sv.logOpen + '" aria-controls="sh-log">היסטוריית שינויים (' + sv.log.length + ')' + icon('down') + '</button>' +
        '<ul id="sh-log"' + (sv.logOpen ? '' : ' hidden') + '>' + sv.log.slice().reverse().map(function (x, i) {
          return '<li><bdi>' + x.at + '</bdi><span>דנה כהן</span><span>' + x.what + (i === 0 && back ? ' <button class="kit-link" data-do="restore">החזירו ערכים קודמים</button>' : '') + '</span></li>';
        }).join('') + '</ul></div>';
    };
    var diffTxt = function (a, b) {
      return RULES.filter(function (x) { return a[x[0]] !== b[x[0]]; }).map(function (x) { return x[1] + ': מ־' + fmtR(x[0], a[x[0]]) + ' ל־' + fmtR(x[0], b[x[0]]); }).join(', ');
    };
    var BODY = {
      display: function () {
        return head('display', 'כל שינוי כאן חל מיד ונשמר בדפדפן הזה, בלי כפתור שמירה') + '<div class="set-rows">' +
          (narrowS() ? row('dens', 'צפיפות', 'במסך מגע השורות נשארות גבוהות, כדי שיהיה קל לגעת בהן', valS('קבועה במסך מגע'))
            : row('dens', 'צפיפות', 'כמה שורות נכנסות במסך, בכל הטבלאות והתורים', segS('dens', ss.dens, [['regular', 'רגיל'], ['compact', 'צפוף']]))) +
          row('text', 'גודל טקסט', 'מגדיל את הכתוב בכל המסכים', segS('text', ss.text, [['regular', 'רגיל'], ['large', 'גדול']])) +
          row('rail', 'תפריט הצד', 'מכווץ משאיר לכל קבוצה אייקון ושם קצר', segS('rail', SM.rail ? 'rail' : 'full', [['full', 'מורחב'], ['rail', 'מכווץ']]) + '<kbd dir="ltr" aria-hidden="true">Ctrl B</kbd>', 'desk-only') +
          row('keys', 'קיצורים בתו אחד', '<kbd dir="ltr">J</kbd> <kbd dir="ltr">K</kbd> <kbd dir="ltr">1</kbd> <kbd dir="ltr">2</kbd> <kbd dir="ltr">Z</kbd> בתור האישורים, <kbd dir="ltr">[</kbd> לתפריט', '<button class="sw" role="switch" data-sw="keys" aria-checked="' + ss.keys + '" aria-label="קיצורים בתו אחד"></button><span class="sw-t" aria-hidden="true">' + (ss.keys ? 'פעיל' : 'כבוי') + '</span>', 'desk-only') +
          '</div><p class="set-foot"><span>צירופים עם Ctrl נשארים פעילים תמיד</span><span class="sp"></span><button class="kit-link" data-do="reset">חזרה לברירת המחדל</button></p>';
      },
      account: function () {
        return head('account', 'פרטי הכניסה שלך, בכל מכשיר שבו נכנסים לחשבון') + '<div class="set-rows">' +
          row('lang', 'שפת האפליקציה', 'נשמרת בחשבון שלך במסעדה הזאת, גם במכשירים חדשים', valS('עברית')) +
          row('pass', 'סיסמה', 'נכנסים איתה או עם קישור שנשלח במייל', valS('מוגדרת')) +
          row('dev', 'מכשירים מחוברים', 'ניתוק מכל המכשירים מבטל מיד כל כניסה פעילה', valS('המכשיר הזה')) + '</div>';
      },
      security: function () {
        return head('security', 'שכבת הגנה נוספת בכניסה לחשבון') + '<div class="set-rows">' +
          row('twofa', 'אימות דו־שלבי', 'קוד חד־פעמי מאפליקציית אימות, בנוסף לסיסמה', valS('כבוי', true)) + '</div>';
      },
      privacy: function () {
        return head('privacy', 'הנתונים האישיים שלך, לא נתוני המסעדה') + '<div class="set-rows">' +
          row('export', 'ייצוא הנתונים שלי', 'קובץ עם פרטי החשבון, החברויות והפעילות שלך', valS('קובץ JSON')) +
          row('del', 'מחיקת החשבון שלי', 'בעלים יחידים מעבירים קודם את הבעלות', valS('דורש אישור')) + '</div>';
      },
      biz: function () {
        return head('biz', 'שיעור המע״מ משפיע על סכומי הדליפה ועל קובצי הייצוא') + '<div class="set-rows">' +
          row('name', 'שם המסעדה', '', valS('כפר הזיתים')) +
          row('vatid', 'ח״פ או עוסק מורשה', '', valS('<bdi dir="ltr">514778123</bdi>')) +
          row('vat', 'שיעור מע״מ', '', valS('<bdi dir="ltr">18%</bdi>')) +
          row('tz', 'אזור זמן', '', valS('ישראל')) + '</div>';
      },
      letter: function () {
        return head('letter', 'מופיעים בראש כל מכתב בקשת זיכוי שנשלח לספק') + '<div class="set-rows">' +
          row('legal', 'שם משפטי', '', valS('כפר הזיתים')) +
          row('addr', 'כתובת', '', valS('לא הוזנה', true)) +
          row('phone', 'טלפון', '', valS('לא הוזן', true)) +
          row('mail', 'דוא״ל', '', valS('לא הוזן', true)) + '</div>';
      },
      rules: function () {
        return head('rules', 'שינוי נכנס לתוקף רק אחרי שמירה, ונרשם בהיסטוריה') +
          '<h3 class="set-t" aria-level="6">ספי סבילות</h3><div class="set-rows">' +
          RULES.map(function (x) { return row(x[0], x[1] + chipR(x[0]) + (sv.rules[x[0]] !== DEF[x[0]] ? '<button class="kit-link" data-def="' + x[0] + '">חזרה לברירת המחדל</button>' : ''), x[2], numS(x[0])); }).join('') + '</div>' + effect() +
          '<h3 class="set-t" aria-level="6">ספי אישור וסריקה</h3><div class="set-rows">' +
          row('appr', 'חשבונית בלי הזמנה', 'עוברת לאישור הבעלים מעל הסכום הזה', valS(fmtMoney0(5000)) + '<span class="st">ברירת מחדל</span>') +
          row('appr2', 'פריט שלא הוזמן', 'עובר לאישור הבעלים מעל פער בסכום הזה', valS(fmtMoney0(100)) + '<span class="st">ברירת מחדל</span>') +
          row('appr3', 'פערים מצטברים בחשבונית', 'עוברים לאישור הבעלים מעל הסכום או האחוז', valS(fmtMoney0(300) + ' או <bdi dir="ltr">5%</bdi>') + '<span class="st">ברירת מחדל</span>') +
          row('ocr', 'סף בדיקת OCR', 'חשבונית שזוהתה בביטחון נמוך מזה עוברת לבדיקה ידנית', valS('<bdi dir="ltr">85%</bdi>') + '<span class="st">ברירת מחדל</span>') + '</div>' +
          '<p class="set-foot"><span>הכללים עצמם קבועים, משנים רק את המספרים</span></p>' + logHtml() + saveBar();
      }
    };
    var fmtMoney0 = function (v) { return '<span class="money"><span class="cur">₪</span><span>' + v.toLocaleString('en-US') + '</span></span>'; };
    var renderBody = function (refocus) {
      bodyEl.innerHTML = (BODY[sv.sect] || BODY.display)();
      /* the list of sections keeps the mark of unsaved changes in step, without losing the focus */
      var rb = sectsEl.querySelector('[data-sect="rules"]');
      if (rb && !!rb.querySelector('.it-dot') === sameR(sv.rules, sv.saved)) { var hadF = sectsEl.contains(document.activeElement); renderSects(); if (hadF) { var again0 = sectsEl.querySelector('[data-sect="' + sv.sect + '"]'); if (again0) again0.focus({ preventScroll: true }); } }
      if (refocus) { var el = bodyEl.querySelector(refocus); if (el) el.focus({ preventScroll: true }); }
      if (sv.hit) { var r = bodyEl.querySelector('[data-row="' + sv.hit + '"]'); if (r && r.scrollIntoView && !narrowS()) r.scrollIntoView({ block: 'nearest' }); }
    };
    var go = function (id, hit) {
      sv.sect = id; sv.hit = hit || ''; sv.q = ''; if (qEl.value) qEl.value = ''; renderSects(); renderBody();
      if (hit) setTimeout(function () { if (sv.hit === hit) { sv.hit = ''; var r = bodyEl.querySelector('.is-hit'); if (r) r.classList.remove('is-hit'); } }, 1600);
    };
    var endUndo = function () { if (sv.undoT) { clearTimeout(sv.undoT); sv.undoT = null; } sv.before = null; };
    var setPref = function (name, v, announce) {
      if (name === 'rail') setRail(SM, v === 'rail', false);
      else { ss[name] = v; keep(); applyPrefs(); }
      if (announce) sayS('נשמר: ' + announce);
    };

    shell.addEventListener('click', function (e) {
      var t = e.target, b;
      if ((b = t.closest('[data-sect]'))) { go(b.getAttribute('data-sect')); var again = sectsEl.querySelector('[data-sect="' + sv.sect + '"]'); if (again) again.focus({ preventScroll: true }); return; }
      if ((b = t.closest('[data-go]'))) { go(b.getAttribute('data-go'), b.getAttribute('data-hit')); bodyEl.focus({ preventScroll: true }); return; }
      if ((b = t.closest('[data-set]'))) {
        var name = b.getAttribute('data-set'), v = b.getAttribute('data-v'), said = b.closest('.set-row').querySelector('.l').textContent + ', ' + b.textContent;
        setPref(name, v, said);
        if (name !== 'rail' || reduce || ss.motion === 'off') renderBody('[data-set="' + name + '"][data-v="' + v + '"]');
        else {
          b.parentNode.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
          /* the menu may refuse a second change while it is still moving: show what it really is once it rests */
          setTimeout(function () { if (sv.sect === 'display' && !cmd.open) renderBody(bodyEl.contains(document.activeElement) ? '[data-set="rail"][aria-pressed="true"]' : null); }, 420);
        }
        return;
      }
      /* the whole row of a switch is its target */
      if (t.closest('[data-sw]') || ((b = t.closest('[data-row="keys"]')) && !t.closest('kbd'))) { ss.keys = !ss.keys; keep(); applyPrefs(); renderBody('[data-sw="keys"]'); sayS('קיצורים בתו אחד: ' + (ss.keys ? 'פעיל' : 'כבוי')); return; }
      if ((b = t.closest('[data-def]'))) {
        var dk = b.getAttribute('data-def'); endUndo(); sv.rules[dk] = DEF[dk];
        renderBody('[data-num="' + dk + '"][data-d="1"]'); sayEffect('חזרה לברירת המחדל, עוד לא נשמר'); return;
      }
      if ((b = t.closest('[data-num]')) && !b.disabled) {
        var nm = b.getAttribute('data-num'), d = Number(b.getAttribute('data-d'));
        endUndo(); sv.rules[nm] = Math.max(LIM[nm][0], Math.min(LIM[nm][1], sv.rules[nm] + d));
        renderBody('[data-num="' + nm + '"][data-d="' + d + '"]');
        if (!bodyEl.contains(document.activeElement)) { var alt = bodyEl.querySelector('[data-num="' + nm + '"]:not([disabled])'); if (alt) alt.focus({ preventScroll: true }); }
        sayEffect(RULES.filter(function (x) { return x[0] === nm; })[0][1] + ': ' + plain(fmtR(nm, sv.rules[nm])));
        return;
      }
      if ((b = t.closest('[data-do]'))) {
        var what = b.getAttribute('data-do'), nowA = Date.now();
        if (/^(save|undo|restore|discard)$/.test(what)) { if (nowA - (sv.actAt || 0) < 350) return; sv.actAt = nowA; }
        if (what === 'reset') {
          var f0 = fresh0(), k0; for (k0 in f0) ss[k0] = f0[k0]; keep(); applyPrefs();
          SM.open = { money: true, analysis: true, admin: true }; SM.fav = []; syncStar(SM);
          if (SM.rail) setRail(SM, false, false); else { paintMenu(SM); keepMenu(SM); fitMenu(SM); }
          renderBody('[data-do="reset"]'); sayS('התצוגה חזרה לברירת המחדל');
        }
        else if (what === 'discard') { sv.rules = copyR(sv.saved); renderBody('[data-num="pp"][data-d="1"]'); sayS('השינויים בוטלו'); }
        else if (what === 'restore') {
          var lastE = sv.log[sv.log.length - 1];
          if (lastE && lastE.before) { sv.rules = copyR(lastE.before); renderBody('[data-do="save"]'); sayEffect('הערכים הקודמים חזרו לשדות, ועוד לא נשמרו'); }
        }
        else if (what === 'log') { sv.logOpen = !sv.logOpen; renderBody('[data-do="log"]'); }
        else if (what === 'save') {
          sv.before = copyR(sv.saved); sv.log.push({ at: stamp(), what: diffTxt(sv.saved, sv.rules), before: copyR(sv.saved), after: copyR(sv.rules) }); sv.saved = copyR(sv.rules);
          if (sv.undoT) clearTimeout(sv.undoT);
          sv.undoT = setTimeout(function () { sv.undoT = null; sv.before = null; if (sv.sect === 'rules') renderBody(bodyEl.contains(document.activeElement) && document.activeElement.getAttribute('data-do') === 'undo' ? '[data-num="pp"][data-d="1"]' : null); }, 10000);
          renderBody('[data-do="undo"]'); sayS('נשמר לכל המסעדה, ונרשם בהיסטוריה. אפשר לבטל בעשר השניות הקרובות');
        }
        else if (what === 'undo' && sv.before) {
          sv.log.push({ at: stamp(), what: 'השמירה האחרונה בוטלה', after: copyR(sv.before) }); sv.saved = sv.before; sv.rules = copyR(sv.before); endUndo();
          renderBody('[data-num="pp"][data-d="1"]'); sayS('השמירה בוטלה, הספים חזרו לקדמותם');
        }
      }
    });
    qEl.addEventListener('input', function () { sv.q = qEl.value; renderSects(); });
    qEl.addEventListener('keydown', function (e) { if (e.key === 'Escape' && qEl.value) { e.preventDefault(); qEl.value = ''; sv.q = ''; renderSects(); } });
    /* the menu and the density switch can change from outside this screen: keep the open section in step */
    SM.onChange = function () { if (sv.sect === 'display' && !cmd.open) renderBody(bodyEl.contains(document.activeElement) ? '[data-set="rail"][aria-pressed="true"]' : null); };
    document.addEventListener('rm:dens', function () { if (ss.dens !== PREF.dens) { ss.dens = PREF.dens; keep(); if (sv.sect === 'display') renderBody(); } });

    /* ----- Ctrl K in this mock-up: any setting and any display command, from the keyboard ----- */
    var cmd = { open: false, at: 0, list: [], from: null, el: null, scrim: null };
    var CMDS = [
      { t: function () { return SM.rail ? 'הרחבת התפריט' : 'כיווץ התפריט'; }, i: 'panel', k: 'Ctrl B', a: 'תפריט צד כיווץ הרחבה', run: function () { setRail(SM, !SM.rail, false); } },
      { t: function () { return ss.dens === 'compact' ? 'מעבר למצב רגיל' : 'מעבר למצב צפוף'; }, i: 'layers', k: '', a: 'צפיפות שורות רגיל צפוף', run: function () { setPref('dens', ss.dens === 'compact' ? 'regular' : 'compact'); } },
      { t: function () { return ss.text === 'large' ? 'מעבר לטקסט רגיל' : 'מעבר לטקסט גדול'; }, i: 'edit', k: '', a: 'גודל טקסט אותיות', run: function () { setPref('text', ss.text === 'large' ? 'regular' : 'large'); } },
      { t: function () { return ss.keys ? 'כיבוי קיצורים בתו אחד' : 'הפעלת קיצורים בתו אחד'; }, i: 'settings', k: '', a: 'מקלדת מקשים קיצורים', run: function () { setPref('keys', !ss.keys); } }
    ];
    var cmdItems = function (q) {
      var n = norm(q), out = [];
      CMDS.forEach(function (c) { if (!n || norm(c.t() + ' ' + c.a).indexOf(n) >= 0) out.push({ g: 'פקודות', t: c.t(), i: c.i, k: c.k, run: c.run }); });
      (n ? findSet(q) : IDX).forEach(function (x) { out.push({ g: 'הגדרות', t: x[2], i: 'settings', m: sectOf(x[0])[1], run: function () { go(x[0], x[1]); } }); });
      return out;
    };
    var cmdPaint = function () {
      var q = cmd.el.querySelector('input'), listEl = cmd.el.querySelector('.cp-list'), g = '', h = '';
      cmd.list = cmdItems(q.value); if (cmd.at >= cmd.list.length) cmd.at = 0;
      cmd.list.forEach(function (it, k) {
        if (it.g !== g) { g = it.g; h += '<div class="cp-g" role="presentation">' + g + '</div>'; }
        h += '<div class="cp-o" role="option" id="sh-cmd-o' + k + '" aria-selected="' + (k === cmd.at) + '" data-k="' + k + '">' + icon(it.i) + '<span class="cp-t">' + it.t + '</span><span class="cp-m">' + (it.m || '') + '</span>' + (it.k ? '<kbd dir="ltr">' + it.k + '</kbd>' : '<span></span>') + '</div>';
      });
      listEl.innerHTML = h || '<div class="cp-none">לא נמצאה הגדרה או פקודה כזאת. אפשר לנסות: צפיפות, מע״מ, תפריט</div>';
      if (cmd.list.length) q.setAttribute('aria-activedescendant', 'sh-cmd-o' + cmd.at); else q.removeAttribute('aria-activedescendant');
      var sel = listEl.querySelector('[aria-selected="true"]'); if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest' });
    };
    var cmdClose = function (refocus) {
      if (!cmd.open) return;
      cmd.open = false; cmd.el.hidden = true; cmd.scrim.hidden = true; mainS.removeAttribute('inert'); SM.el.removeAttribute('inert');
      if (refocus) { var f = (cmd.from && shell.contains(cmd.from) ? cmd.from : null) || SM.el.querySelector('[data-m="cmd"]'); if (f) f.focus({ preventScroll: true }); }
    };
    var cmdOpen = function () {
      if (cmd.open || narrowS()) return;
      if (!cmd.el) {
        cmd.scrim = document.createElement('div'); cmd.scrim.className = 'cmd-scrim';
        cmd.el = document.createElement('div'); cmd.el.className = 'cp cmd'; cmd.el.setAttribute('role', 'dialog'); cmd.el.setAttribute('aria-modal', 'true'); cmd.el.setAttribute('aria-label', 'חיפוש הגדרה או פקודה');
        cmd.el.innerHTML = '<div class="cp-in">' + icon('search') + '<input type="text" role="combobox" aria-expanded="true" aria-controls="sh-cmd-list" aria-autocomplete="list" aria-label="חיפוש הגדרה או פקודה" placeholder="חיפוש הגדרה או פקודה" autocomplete="off" spellcheck="false"><kbd dir="ltr">Esc</kbd></div>' +
          '<div class="cp-list" id="sh-cmd-list" role="listbox" aria-label="תוצאות"></div><div class="cp-foot"><span><kbd>↑</kbd><kbd>↓</kbd>מעבר</span><span><kbd>Enter</kbd>בחירה</span></div>';
        shell.appendChild(cmd.scrim); shell.appendChild(cmd.el);
        cmd.scrim.addEventListener('click', function () { cmdClose(true); });
        var q = cmd.el.querySelector('input');
        q.addEventListener('input', function () { cmd.at = 0; cmdPaint(); });
        cmd.el.addEventListener('keydown', function (e) {
          var n = cmd.list.length;
          if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); cmdClose(true); }
          else if (e.key === 'ArrowDown' && n) { e.preventDefault(); cmd.at = (cmd.at + 1) % n; cmdPaint(); }
          else if (e.key === 'ArrowUp' && n) { e.preventDefault(); cmd.at = (cmd.at - 1 + n) % n; cmdPaint(); }
          else if (e.key === 'Enter' && n) { e.preventDefault(); cmdRun(cmd.at); }
        });
        cmd.el.addEventListener('click', function (e) { var o = e.target.closest('.cp-o'); if (o) cmdRun(Number(o.getAttribute('data-k'))); else cmd.el.querySelector('input').focus(); });
        cmd.el.addEventListener('pointermove', function (e) { var o = e.target.closest ? e.target.closest('.cp-o') : null, k = o ? Number(o.getAttribute('data-k')) : -1; if (k >= 0 && k !== cmd.at) { cmd.at = k; $$('.cp-o', cmd.el).forEach(function (x) { x.setAttribute('aria-selected', String(x === o)); }); cmd.el.querySelector('input').setAttribute('aria-activedescendant', o.id); } });
      }
      cmd.from = document.activeElement; cmd.open = true; cmd.at = 0;
      closeFly(SM); hideTip(SM);
      cmd.el.hidden = false; cmd.scrim.hidden = false; mainS.setAttribute('inert', ''); SM.el.setAttribute('inert', '');
      var inp = cmd.el.querySelector('input'); inp.value = ''; cmdPaint(); inp.focus({ preventScroll: true });
      if (!(reduce || ss.motion === 'off')) replayCss(cmd.el, 'is-in');
    };
    var cmdRun = function (k) {
      var it = cmd.list[k]; if (!it) return;
      cmdClose(false); it.run();
      /* after a command the focus lands where its result is: on the open section */
      bodyEl.focus({ preventScroll: true });
      sayS('בוצע: ' + it.t);
    };
    shell.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('[data-m="cmd"]')) cmdOpen(); });
    document.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.code !== 'KeyK' || e.repeat) return;
      if (narrowS() || !(shell.contains(document.activeElement) || shell.matches(':hover'))) return;
      e.preventDefault(); if (cmd.open) cmdClose(true); else cmdOpen();
    });
    var wasNarrow = narrowS();
    document.addEventListener('rm:fit', function () { if (narrowS()) cmdClose(false); if (narrowS() !== wasNarrow) { wasNarrow = narrowS(); renderBody(); } });

    renderSects(); applyPrefs(); renderBody();
  }

  })();

  /* ---------- the component kit ---------- */
  /* command palette: an empty query shows what waits; a query typed on the wrong keyboard layout still finds it */
  var cpQ = $('#cp-q'), cpList = $('#cp-list'), cpNote = $('#cp-note');
  if (cpQ && cpList) {
    var CP = [
      { g: 'מחכה לך', t: '4 פערים להחלטה', m: '2 חוסמים תשלום', a: 296, i: 'inbox' },
      { g: 'מחכה לך', t: '15 בקשות זיכוי בלי תשובה', m: 'מעל 7 ימים', a: 859.15, i: 'send' },
      { g: 'חשבוניות', t: 'SH-24121', m: 'ירקות השרון, 15.10.2026, פער פתוח', a: 38.7, i: 'receipt', ltr: 1 },
      { g: 'חשבוניות', t: 'ST-24108', m: 'משקאות שטיינברג, 21.10.2026, פער פתוח', a: 104.8, i: 'receipt', ltr: 1 },
      { g: 'חשבוניות', t: 'MF-24108', m: 'דגי הים התיכון, 20.10.2026, פער פתוח', a: 52.5, i: 'receipt', ltr: 1 },
      { g: 'חשבוניות', t: 'HK-24108', m: 'קצביית הכרם, 19.10.2026, פער פתוח', a: 100, i: 'receipt', ltr: 1 },
      { g: 'ספקים', t: 'ירקות השרון', m: 'ספק', i: 'truck' },
      { g: 'ספקים', t: 'משקאות שטיינברג', m: 'ספק', i: 'truck' },
      { g: 'ספקים', t: 'דגי הים התיכון', m: 'ספק', i: 'truck' },
      { g: 'ספקים', t: 'קצביית הכרם', m: 'ספק', i: 'truck' },
      { g: 'פעולות', t: 'הזמנה חדשה', m: 'פותח טופס הזמנה', i: 'cart' },
      { g: 'פעולות', t: 'קבלת סחורה', m: 'המשלוחים של היום', i: 'box' },
      { g: 'פעולות', t: 'שליחת תזכורות לספקים', m: 'פותח את מסך בקשות הזיכוי', i: 'send' }
    ];
    var EN2HE = { q: '/', w: "'", e: 'ק', r: 'ר', t: 'א', y: 'ט', u: 'ו', i: 'ן', o: 'ם', p: 'פ', a: 'ש', s: 'ד', d: 'ג', f: 'כ', g: 'ע', h: 'י', j: 'ח', k: 'ל', l: 'ך', ';': 'ף', z: 'ז', x: 'ס', c: 'ב', v: 'ה', b: 'נ', n: 'מ', m: 'צ', ',': 'ת', '.': 'ץ' };
    var swapLayout = function (s) { return s.split('').map(function (ch) { return EN2HE[ch] || ch; }).join(''); };
    var cpAt = 0, cpShown = [];
    var cpHit = function (it, q) { return (it.t + ' ' + it.m).toLowerCase().indexOf(q) >= 0; };
    var cpRender = function (msg) {
      var q = cpQ.value.trim().toLowerCase(), alt = '';
      var list = !q ? CP.filter(function (x) { return x.g === 'מחכה לך' || x.g === 'פעולות'; }) : CP.filter(function (x) { return cpHit(x, q); });
      if (q && !list.length && /[a-z;,.']/.test(q)) { alt = swapLayout(q); list = CP.filter(function (x) { return cpHit(x, alt); }); }
      cpShown = list;
      if (cpAt >= list.length) cpAt = 0;
      var html = '', g = '';
      list.forEach(function (it, k) {
        if (it.g !== g) { g = it.g; html += '<div class="cp-g" role="presentation">' + g + '</div>'; }
        html += '<div class="cp-o" role="option" id="cp-o' + k + '" aria-selected="' + (k === cpAt) + '" data-k="' + k + '">' + icon(it.i) +
          '<span class="cp-t"' + (it.ltr ? ' dir="ltr"' : '') + '>' + it.t + '</span><span class="cp-m">' + it.m + '</span>' + (it.a != null ? '<span class="cp-a">' + money(it.a, false) + '</span>' : '<span></span>') + '</div>';
      });
      cpList.innerHTML = html || '<div class="cp-none">לא נמצא. נסו שם של ספק, מוצר או מספר חשבונית.</div>';
      if (list.length) cpQ.setAttribute('aria-activedescendant', 'cp-o' + cpAt); else cpQ.removeAttribute('aria-activedescendant');
      if (cpNote) cpNote.textContent = msg || (alt && list.length ? 'המקלדת הייתה באנגלית. חיפשנו "' + alt + '".' : !q ? 'נסו: ירקות, 24108, או hre במקלדת אנגלית' : '');
      var on = cpList.querySelector('[aria-selected="true"]');
      if (on && on.scrollIntoView && cpList.scrollHeight > cpList.clientHeight) cpList.scrollTop = Math.max(0, on.offsetTop - cpList.clientHeight / 2);
    };
    var cpOpen = function () { if (cpShown[cpAt]) cpRender('בהדגמה זה נעצר כאן. במערכת נפתח: ' + cpShown[cpAt].t); };
    cpQ.addEventListener('input', function () { cpAt = 0; cpRender(); });
    cpQ.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { cpAt = cpShown.length ? (cpAt + 1) % cpShown.length : 0; cpRender(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { cpAt = cpShown.length ? (cpAt - 1 + cpShown.length) % cpShown.length : 0; cpRender(); e.preventDefault(); }
      else if (e.key === 'Enter') { cpOpen(); e.preventDefault(); }
      else if (e.key === 'Escape' && cpQ.value) { cpQ.value = ''; cpAt = 0; cpRender(); e.preventDefault(); }
    });
    cpList.addEventListener('click', function (e) {
      var o = e.target.closest('.cp-o'); if (!o) return;
      cpAt = Number(o.getAttribute('data-k')); cpRender(); cpOpen(); cpQ.focus({ preventScroll: true });
    });
    cpRender();
  }
  /* toast specimen: the timer line is the timer; it pauses under the pointer by itself */
  var kitToast = $('#kit-toast');
  if (kitToast) {
    var kitTimer = null;
    var kitHide = function () { kitToast.hidden = true; if (kitTimer) { clearTimeout(kitTimer); kitTimer = null; } };
    var kitTm = $('.tm', kitToast);
    if (kitTm) kitTm.addEventListener('animationend', kitHide);
    $$('[data-kit="toast"]').forEach(function (b) {
      b.addEventListener('click', function () {
        kitToast.hidden = true; void kitToast.offsetWidth; kitToast.hidden = false;
        if (kitTimer) clearTimeout(kitTimer);
        if (reduce) kitTimer = setTimeout(kitHide, 10000);
      });
    });
    $$('[data-kit="toast-undo"]').forEach(function (b) { b.addEventListener('click', kitHide); });
  }
  /* where each component was learned from: filled from the research notes, never typed by hand in the markup */
  var KIT_SRC = /*KIT_SRC*/{}/*END*/;
  $$('.kit-n .src[data-src]').forEach(function (el) {
    var list = KIT_SRC[el.getAttribute('data-src')];
    if (!list || !list.length) { el.remove(); return; }
    el.innerHTML = 'למדנו מ: ' + list.map(function (s) {
      var name = s.url ? '<a href="' + s.url + '" target="_blank" rel="noopener">' + s.name + '</a>' : s.name;
      return name + (s.prov ? ' <span class="prov">' + s.prov + '</span>' : '');
    }).join(', ');
  });

  /* ---------- the motion table: play one role at a time ---------- */
  $$('[data-play]').forEach(function (b) {
    b.addEventListener('click', function () {
      var row = b.closest('.mo-row');
      if (row) row.classList.toggle('is-on');
    });
  });

  /* links that point at their own section are placeholders: keep the reader where they are */
  document.addEventListener('click', function (e) {
    var l = e.target.closest ? e.target.closest('.rm a[href^="#"]') : null, sec = l && l.closest('section.sec');
    if (sec && l.getAttribute('href') === '#' + sec.id) e.preventDefault();
  });
  /* a source link opens a new tab: say so to a screen reader */
  $$('.pg a[target="_blank"]').forEach(function (l) { var x = document.createElement('span'); x.className = 'sr'; x.textContent = ' (נפתח בכרטיסייה חדשה)'; l.appendChild(x); });
  if (!document.documentElement.lang) document.documentElement.lang = 'he';

  fitStages();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitStages);
})();
