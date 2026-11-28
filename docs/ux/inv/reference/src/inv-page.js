/* ---------- the page: who is looking ---------- */
var sync = function () {
  var r = INV.role().k;
  $$('[data-role]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-role') === r)); });
  /* the bookkeeper gets the dense rows by default (owner decision D4); on a phone the density is fixed */
  $$('.rm-app.iv').forEach(function (a) { a.classList.toggle('is-compact', r === 'bookkeeper' && !INV.narrow(a)); });
  /* every frame says who is looking */
  $$('.iv-me').forEach(function (el) {
    var n = document.createElement('span'); n.className = 'me-n'; n.textContent = INV.role().name + ' · ';
    el.textContent = ''; el.appendChild(n); el.appendChild(document.createTextNode(INV.role().t));
  });
};
/* the mock-ups change height with the role; the switch that was pressed stays where it was on the screen
   (a browser without scroll anchoring would move it) */
document.addEventListener('click', function (e) {
  var b = e.target.closest ? e.target.closest('[data-role]') : null; if (!b) return;
  var y = b.getBoundingClientRect().top;
  INV.setRole(b.getAttribute('data-role'));
  var d = b.getBoundingClientRect().top - y;
  if (Math.abs(d) > 1) window.scrollBy({ top: d, behavior: 'instant' });
});
/* crossing between the wide and the phone layout draws the screens again (the dense rows are a desk matter) */
var wasNarrow = null;
document.addEventListener('rm:fit', function () {
  var now = $$('.rm-app.iv').map(function (a) { return INV.narrow(a) ? '1' : '0'; }).join('');
  if (now === wasNarrow) return;
  var first = wasNarrow === null; wasNarrow = now; sync(); if (!first || now.indexOf('1') >= 0) INV.repaint();
});
var MENU_TO = { '#approvals': ['inv-desk', '#dk-rows', '.ev-bar'], '#register': ['inv-reg', '#reg-root h1'], '#payrun': ['inv-pay', '#pr-root h1'] };
document.addEventListener('click', function (e) {
  /* the menu's links (in the open menu and in the list beside a folded tile); the screens' own links say where they go */
  var a = e.target.closest ? e.target.closest('.rm-app.iv a[href]') : null, to = a ? MENU_TO[a.getAttribute('href')] : null;
  if (!to || a.hasAttribute('data-reg') || a.hasAttribute('data-ivp') || a.hasAttribute('data-dk') || a.hasAttribute('data-pr')) return;
  e.preventDefault(); INV.show(to[0], to[2]);
  var f = document.querySelector(to[1]); if (f && !f.offsetParent) f = document.querySelector('#' + to[0] + ' h1');
  if (f) { if (!f.hasAttribute('tabindex')) f.setAttribute('tabindex', '-1'); f.focus({ preventScroll: true }); }
});
INV.on(function (why) { if (why === 'role') sync(); });
sync();
