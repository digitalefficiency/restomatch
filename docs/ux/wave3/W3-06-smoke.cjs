#!/usr/bin/env node
/**
 * W3-06 · staging smoke for the lead form's JS-off Server Action (PR #282).
 *
 * Run by a HUMAN against STAGING (or a preview deployment) after the deploy,
 * never against production. It writes exactly ONE lead row, named
 * "SMOKE W3-06 · <ISO time> · למחיקה", so it is easy to find and delete.
 *
 *   node docs/ux/wave3/W3-06-smoke.cjs https://<staging-host>
 *   # optional: SMOKE_BYPASS=<vercel protection-bypass token> for a protected preview
 *
 * Needs Playwright with Chromium (preinstalled in the agent containers; on a
 * laptop: `pnpm --filter @restomatch/web exec playwright install chromium`).
 *
 * Checks, in order (exit 1 on the first failure):
 *   1. GET /#lead with JavaScript DISABLED → the form is server-rendered,
 *      visible, and carries the Server Action's hidden $ACTION_ fields.
 *   2. Fill name + phone, submit natively (Enter) → the POST to "/" answers 200.
 *   3. The response page shows the success card (data-testid="lead-success").
 *   4. With JS off, a name-only submit is refused server-side: no success card,
 *      the contact error is shown (the action re-validates; it doesn't trust the client).
 * It does NOT probe the rate limit (that would burn the 10/h `leads` bucket of
 * the runner's IP for an hour) — the parity unit test covers it.
 */
const { chromium } = require('playwright');

const base = (process.argv[2] || process.env.SMOKE_BASE_URL || '').replace(/\/$/, '');
if (!/^https:\/\//.test(base) && !(process.env.SMOKE_ALLOW_HTTP === '1' && /^http:\/\/localhost[:/]/.test(base))) {
  console.error('usage: node docs/ux/wave3/W3-06-smoke.cjs https://<staging-host>');
  process.exit(2);
}
if (/restomatchrrr\.vercel\.app/.test(base) && process.env.SMOKE_ALLOW_PROD !== '1') {
  console.error('refusing to write a lead to PRODUCTION; use staging or a preview URL');
  process.exit(2);
}

function fail(step, msg) {
  console.error(`✗ ${step}: ${msg}`);
  process.exit(1);
}

(async () => {
  const browser = await chromium.launch();
  const headers = process.env.SMOKE_BYPASS ? { 'x-vercel-protection-bypass': process.env.SMOKE_BYPASS } : {};
  const ctx = await browser.newContext({ javaScriptEnabled: false, locale: 'he-IL', extraHTTPHeaders: headers });
  const host = new URL(base).host;
  await ctx.addCookies([
    { name: 'rm_locale', value: 'he', domain: host, path: '/' },
    { name: 'rm_cookie_consent', value: 'necessary', domain: host, path: '/' },
  ]);
  const page = await ctx.newPage();
  try {
    // 1 — server-rendered form with the action wiring
    const res = await page.goto(`${base}/#lead`, { waitUntil: 'load' });
    if (!res || res.status() !== 200) fail('1 GET /', `status ${res && res.status()}`);
    const form = page.getByTestId('lead-form');
    if (!(await form.isVisible())) fail('1 form', 'lead form not visible with JS off');
    const actionFields = await form.locator('input[type="hidden"][name^="$ACTION_"]').count();
    if (actionFields === 0) fail('1 form', 'no $ACTION_ hidden fields (not a Server Action form)');
    console.log(`✓ 1 form server-rendered (${actionFields} action fields)`);

    // 2 + 3 — a real lead, posted natively
    const name = `SMOKE W3-06 · ${new Date().toISOString()} · למחיקה`;
    await page.locator('#lead-name').fill(name);
    await page.locator('#lead-phone').fill('050-0000000');
    const [post] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST', { timeout: 30_000 }),
      page.locator('#lead-phone').press('Enter'),
    ]);
    if (post.status() !== 200) fail('2 POST', `status ${post.status()}`);
    console.log('✓ 2 POST answered 200');
    await page.waitForLoadState('load');
    if ((await page.getByTestId('lead-success').count()) === 0) fail('3 success', 'no success card after the POST');
    console.log(`✓ 3 success card shown — delete the lead named "${name}"`);

    // 4 — server-side re-validation (name only). A fresh URL: a hash-only goto would not reload.
    await page.goto(`${base}/?smoke=validate#lead`, { waitUntil: 'load' });
    await page.locator('#lead-name').fill('SMOKE W3-06 · name only (must be refused)');
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST', { timeout: 30_000 }),
      page.locator('#lead-name').press('Enter'),
    ]);
    await page.waitForLoadState('load');
    if ((await page.getByTestId('lead-success').count()) > 0) fail('4 validate', 'a name-only lead was accepted');
    if ((await page.locator('#lead-phone-error').count()) === 0) fail('4 validate', 'no contact error shown');
    console.log('✓ 4 name-only lead refused server-side');
    console.log('SMOKE OK');
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error('✗ smoke crashed:', err && err.message ? err.message : err);
  process.exit(1);
});
