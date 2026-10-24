// Captures REAL product screenshots from the locally running app (seeded demo
// tenant "כפר הזיתים") for the promo. Needs `./scripts/dev-setup.sh` +
// `pnpm --filter @restomatch/web dev` running. Uses the preinstalled Chromium.
//   node scripts/capture.mjs            → public/shots/*.png
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'RestoMatch-Demo-2026!';
const EXE = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/shots');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EXE });

// ── Focus rects, measured from the live DOM (so a re-theme / layout change needs no hand-measuring).
// Written to src/rects.generated.json in units of page width (x0, y0, x1, y1), full-page coordinates.
const RECTS_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '../src/rects.generated.json');
const RECTS = existsSync(RECTS_FILE) ? JSON.parse(readFileSync(RECTS_FILE, 'utf8')) : {};

/** In-page: resolve a finder spec to a DOMRect-like box (page coords) or null. */
function resolveSpec(spec) {
  const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
  const leaves = () => [...document.querySelectorAll('body *')].filter((e) => e.children.length === 0 && e.offsetParent !== null);
  const box = (e) => {
    const r = e.getBoundingClientRect();
    return { x0: r.left + scrollX, y0: r.top + scrollY, x1: r.right + scrollX, y1: r.bottom + scrollY };
  };
  const union = (bs) => bs.filter(Boolean).reduce((a, b) => (a ? { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) } : b), null);
  const up = (e, n) => { for (let i = 0; i < n && e?.parentElement; i++) e = e.parentElement; return e; };
  const leaf = (texts, mode = 'exact') =>
    leaves().find((e) => texts.some((t) => (mode === 'exact' ? norm(e.textContent) === t : mode === 'starts' ? norm(e.textContent).startsWith(t) : norm(e.textContent).includes(t))));
  if (spec.type === 'ancestor') {
    let e = leaf(spec.label);
    while (e && !spec.contains.some((c) => e.innerText.includes(c))) e = e.parentElement;
    return e ? box(e) : null;
  }
  if (spec.type === 'leaf') {
    const e = leaf(spec.text, spec.mode);
    return e ? box(up(e, spec.up ?? 0)) : null;
  }
  if (spec.type === 'rowCells') {
    const rows = spec.testid ? [...document.querySelectorAll(`[data-testid="${spec.testid}"]`)] : [...document.querySelectorAll('tr')];
    const row = spec.testid ? rows[spec.index ?? 0] : rows.find((r) => spec.rowText.some((t) => r.innerText.includes(t)));
    if (!row) return null;
    const cells = [...row.children];
    return union(cells.slice(spec.cells[0], spec.cells[1] + 1).map(box));
  }
  if (spec.type === 'union') return union(spec.parts.map(resolveSpec));
  if (spec.type === 'inCard') {
    // the card (cardSel, or the first anchor-text ancestor) holding every cardHas text; union of the listed text lines inside it
    const ownT = (e) => norm([...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' '));
    let card = spec.cardSel
      ? [...document.querySelectorAll(spec.cardSel)].find((c) => c.offsetParent !== null && spec.cardHas.every((t) => c.innerText.includes(t)))
      : [...document.querySelectorAll('body *')].find((e) => e.offsetParent !== null && spec.anchor.some((t) => ownT(e).includes(t)));
    while (card && !spec.cardHas.every((t) => card.innerText.includes(t))) card = card.parentElement;
    if (!card) return null;
    // match on an element's OWN text (a label element may hold the value in a child span)
    const own = (e) => norm([...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' '));
    const inside = [...card.querySelectorAll('*')].filter((e) => e.offsetParent !== null && own(e));
    const pick = (texts, mode) => inside.find((e) => texts.some((t) => (mode === 'starts' ? own(e).startsWith(t) : mode === 'includes' ? own(e).includes(t) : own(e) === t)));
    return union(spec.lines.map(([texts, mode, n]) => { const e = pick(texts, mode); return e ? box(up(e, n ?? 0)) : null; }));
  }
  return null;
}

async function measure(page, name, specs) {
  const out = {};
  for (const [key, spec] of Object.entries(specs)) {
    const b = await page.evaluate(`(${resolveSpec.toString()})(${JSON.stringify(spec)})`);
    const w = await page.evaluate('document.documentElement.clientWidth');
    if (!b) { console.log('✗ rect', name, key, 'not found'); continue; }
    out[key] = [b.x0 / w, b.y0 / w, b.x1 / w, b.y1 / w].map((v) => Math.round(v * 10000) / 10000);
  }
  RECTS[name] = { ...(RECTS[name] ?? {}), ...out };
  writeFileSync(RECTS_FILE, JSON.stringify(RECTS, null, 2) + '\n');
  console.log('  rects', name, JSON.stringify(out));
}

const L = (he, en) => (locale) => (locale === 'he' ? he : en);
const EMAIL = { email: { type: 'leaf', text: ['@kfar-hazeitim.test'], mode: 'includes' } };
const withEmail = (f) => (locale) => ({ ...f(locale), ...EMAIL });
const SPECS_BASE = {
  dashboard: L(
    { hero: { type: 'ancestor', label: ['דלף החודש'], contains: ['יעד'] } },
    { hero: { type: 'ancestor', label: ['Leaked this month'], contains: ['Target'] } },
  ),
  leaks: L(
    { beer: { type: 'rowCells', rowText: ['בירה מהחבית'], cells: [0, 4] } },
    { beer: { type: 'rowCells', rowText: ['Draft beer keg'], cells: [0, 4] } },
  ),
  approvals: L(
    { appr: { type: 'inCard', cardSel: 'article', cardHas: ['ST-24108', 'מחיר גבוה מהמצופה'], lines: [[['מחיר גבוה מהמצופה']], [['ההפסד המוערך'], 'starts', 0]] } },
    { appr: { type: 'inCard', cardSel: 'article', cardHas: ['ST-24108', 'Price above expected'], lines: [[['Price above expected']], [['Estimated loss'], 'starts', 0]] } },
  ),
  claims: L(
    { claim: { type: 'union', parts: [{ type: 'rowCells', rowText: ['ST-24108'], cells: [2, 3] }, { type: 'leaf', text: ['סה״כ לזיכוי'], mode: 'starts', up: 1 }] } },
    { claim: { type: 'union', parts: [{ type: 'rowCells', rowText: ['ST-24108'], cells: [2, 3] }, { type: 'leaf', text: ['Total credit requested'], mode: 'starts', up: 1 }] } },
  ),
  chain: L(
    { worst: { type: 'rowCells', testid: 'chain-branch-row', index: 0, cells: [0, 3] } },
    { worst: { type: 'rowCells', testid: 'chain-branch-row', index: 0, cells: [0, 3] } },
  ),
  receiving: L({}, {}),
  reconcile: L({}, {
    card: { type: 'ancestor', label: ['Price differs'], contains: ['Invoiced'] },
    stub: { type: 'leaf', text: ['OCR confidence'], mode: 'includes' },
  }),
};
const SPECS = Object.fromEntries(Object.entries(SPECS_BASE).map(([k, f]) => [k, withEmail(f)]));

const states = new Map(); // email → storageState (one login per user; the login limiter is strict)
async function session(email, viewport, locale) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    storageState: states.get(email),
  });
  await ctx.addCookies([{ name: 'rm_locale', value: locale, url: BASE }, { name: 'rm_cookie_consent', value: 'necessary', url: BASE }]);
  const page = await ctx.newPage();
  if (!states.has(email)) {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.fill('#email', email);
    await page.fill('#password', PASSWORD);
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 }), page.click('form button[type=submit] >> nth=0')]);
    states.set(email, await ctx.storageState());
  }
  return { ctx, page };
}

async function shot(page, path, name, { full = false, wait = 1500, rects } = {}) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForTimeout(wait);
  // hide Next dev indicator + cookie banners
  await page.addStyleTag({ content: 'nextjs-portal,[data-nextjs-toast],#__next-build-watcher{display:none!important}' });
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  console.log('✓', name, path);
  if (rects) await measure(page, name, rects);
}

const ONLY = process.env.ONLY; // 'desktop' | 'receiver' | undefined (= all)
if (!ONLY || ONLY === 'desktop') for (const locale of ['he', 'en']) {
  const { ctx, page } = await session('owner@kfar-hazeitim.test', { width: 1440, height: 900 }, locale);
  await shot(page, '/dashboard', `dashboard-${locale}`, { wait: 2500 });
  await shot(page, '/dashboard', `dashboard-${locale}-full`, { full: true, rects: SPECS.dashboard(locale) });
  await shot(page, '/dashboard/leaks', `leaks-${locale}`, { full: true, rects: SPECS.leaks(locale) });
  await shot(page, '/dashboard/approvals', `approvals-${locale}`, { full: true, rects: SPECS.approvals(locale) });
  await shot(page, '/dashboard/leaks/claims', `claims-${locale}`, { full: true, rects: SPECS.claims(locale) });
  await ctx.close();
}

if (!ONLY || ONLY === 'receiver') for (const locale of ['en', 'he']) {
  const { ctx, page } = await session('receiver@kfar-hazeitim.test', { width: 390, height: 844 }, locale);
  await shot(page, '/dashboard/receiving', `receiving-${locale}`, { full: true });
  // Open the first expected delivery → the receiving wizard for that PO.
  const hrefs = await page.locator('a[href^="/dashboard/receiving/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  // RECEIVER_PO=<uuid> pins the PO (the inbox is empty when the demo's 'today' isn't the real date)
  const href = process.env.RECEIVER_PO ? `/dashboard/receiving/${process.env.RECEIVER_PO}` : hrefs[locale === 'en' ? 0 : 1];
  await shot(page, href, `receiving-po-${locale}`, { full: true, wait: 3000, rects: SPECS.receiving(locale) });
  // Demo invoice (no upload) → stub OCR → reconciliation with English lines.
  if (locale === 'en') try {
    await page.setViewportSize({ width: 390, height: 1500 });
    // a 1×1 PNG: locally the dev OCR stub builds the invoice from the PO (one line +8% price, one +1 unit)
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
    await page.locator('input[type=file]').first().setInputFiles({ name: 'invoice.png', mimeType: 'image/png', buffer: png });
    await page.waitForTimeout(1500);
    await page.locator('button', { hasText: locale === 'en' ? /Process invoice/i : /עיבוד|לעבד/ }).first().click();
    // wait for the real reconciliation (OCR stub + match), not the 'Processing…' step
    await page.waitForSelector('text=/Check result/i', { timeout: 180000 });
    await page.waitForTimeout(2000);
    await page.waitForTimeout(1500);
    await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
    await page.screenshot({ path: `${OUT}/reconcile-${locale}.png` });
    console.log('✓', `reconcile-${locale}`);
    await measure(page, `reconcile-${locale}`, SPECS.reconcile(locale));
    // the first reconciliation lines (EN name, Hebrew original, invoiced qty × price, flag) → the morph panel
    const lines = await page.evaluate(() => {
      const heb = /[\u0590-\u05FF]/;
      const ordered = [...document.querySelectorAll('body *')].filter((e) => e.children.length === 0 && e.textContent.trim() === 'Ordered');
      const cards = [];
      for (const o of ordered) {
        let c = o;
        while (c && !(c.innerText.includes('Invoiced') && heb.test(c.innerText))) c = c.parentElement;
        if (c && !cards.includes(c)) cards.push(c);
      }
      return cards.slice(0, 4).map((c) => {
        const t = c.innerText.split('\n').map((x) => x.trim()).filter(Boolean);
        const inv = t[t.indexOf('Invoiced') + 1] || '';
        const m = inv.match(/([\d.]+)\s*([^\s×]+)\s*×\s*₪?\s*([\d.,]+)/);
        return {
          en: t[0],
          he: t.find((x) => heb.test(x)) || '',
          qty: m ? m[1] : '',
          unit: m ? m[2] : '',
          price: m ? m[3] : '',
          flag: /Price differs/.test(c.innerText) ? 'price' : /Quantity differs/.test(c.innerText) ? 'qty' : undefined,
        };
      });
    });
    writeFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../src/receiver.generated.json'), JSON.stringify(lines, null, 2) + '\n');
    console.log('  lines', JSON.stringify(lines));
  } catch (e) { console.log('✗ reconcile', locale, e.message.split('\n')[0]); }
  await ctx.close();
}
if (!ONLY || ONLY === 'desktop') {
const { ctx, page } = await session('owner@kfar-hazeitim.test', { width: 390, height: 844 }, 'he');
await shot(page, '/dashboard', 'dashboard-he-phone', { full: true, wait: 2500, rects: SPECS.dashboard('he') });
await ctx.close();
}
if (ONLY === 'approvals') for (const locale of (process.env.LOCALES ?? 'he,en').split(',')) {
  const { ctx, page } = await session('owner@kfar-hazeitim.test', { width: 1440, height: 900 }, locale);
  await shot(page, '/dashboard/approvals', `approvals-${locale}`, { full: true, wait: 2500, rects: SPECS.approvals(locale) });
  await ctx.close();
}
if (!ONLY || ONLY === 'chain') for (const locale of ['he', 'en']) {
  // Chain view (S8): needs `pnpm --filter @restomatch/worker seed:chain-demo` on top of the base demo.
  const { ctx, page } = await session('owner@kfar-hazeitim.test', { width: 1440, height: 900 }, locale);
  await shot(page, '/dashboard/chain', `chain-${locale}`, { full: true, wait: 3000, rects: SPECS.chain(locale) });
  await ctx.close();
}
await browser.close();
