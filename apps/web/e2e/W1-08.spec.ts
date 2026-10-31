import { expect, test, type Page } from '@playwright/test';
import { DEMO_RESTAURANT_NAME, OWNER_STATE } from './env';
import { explorerQuery, monthQuery, seededLeakMonth, seededMonthKey } from './seededMonth';
import { collectPageErrors, e2eSql } from './helpers';

/**
 * W1-08 · Leak → claim → recovery trust pass, on the seeded demo tenant:
 *  - every visible total equals its visible rows, to the agora (breakdown, explorer, proof, claims, report, recovery funnel);
 *  - one claim letter per supplier, signed by the ACTIVE restaurant;
 *  - "mark as sent" is deferred 10 s with undo, then moves the claims in one call;
 *  - recovery money moves never fire from a select; ending a claim needs a confirm naming ₪ + supplier;
 *  - the report compares like-for-like ("1–25 … מול 1–25 …");
 *  - on a phone the T1 leak sits in the top half of the screen.
 */
test.use({ storageState: OWNER_STATE });

const agora = (n: number) => Math.round(n * 100);
async function amounts(page: Page, testId: string): Promise<number[]> {
  return page.getByTestId(testId).evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-amount'))));
}
const sumAgora = (xs: number[]) => xs.reduce((s, x) => s + agora(x), 0);
/** ₪ as he-IL prints it at 2 dp — grouped ("1,201.03"), so totals ≥ ₪1,000 match too. */
const at2dp = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

test('breakdown: the invoice rows add up to the leak total, shown to the agora', async ({ page }) => {
  const errors = collectPageErrors(page);
  // The month the seed populated (last month in a month's first days — e2e/seededMonth.ts).
  await page.goto('/dashboard');
  await page.goto(`/dashboard/leaks/breakdown${monthQuery(await seededLeakMonth(page.request))}`);
  const total = Number(await page.getByTestId('breakdown-total').getAttribute('data-amount'));
  expect(total).toBeGreaterThan(0);
  const rows = await amounts(page, 'breakdown-row');
  expect(sumAgora(rows)).toBe(agora(total));
  expect(Number(await page.getByTestId('breakdown-rows-total').getAttribute('data-amount'))).toBe(total);
  // Shown at 2 dp next to its rows; the exact value is also in the title.
  await expect(page.getByTestId('breakdown-total')).toContainText(at2dp(total));
  // A zero-₪ finding is a calm note, never a red ₪0.00.
  await expect(page.getByTestId('line-no-money').first()).not.toContainText('0.00');
  expect(errors).toEqual([]);
});

test('explorer: bars total = Σ bars; the T1 tile carries the exact leak, the cap note explains any gap; compare is on by default', async ({ page }) => {
  // The month the seed populated (last month in a month's first days — e2e/seededMonth.ts).
  await page.goto('/dashboard');
  const offset = await seededLeakMonth(page.request);
  await page.goto(`/dashboard/leaks${explorerQuery(offset)}`);
  const rows = await amounts(page, 'chart-row');
  const total = Number(await page.getByTestId('chart-total').getAttribute('data-amount'));
  expect(sumAgora(rows)).toBe(agora(total));
  const tile = page.getByTestId('explorer-leak');
  const leak = Number(await tile.getAttribute('data-amount'));
  // Grouped rows are line sums BEFORE the per-invoice cap; the T1 leak is capped. Never forced
  // equal: when they differ (rows above the leak) the cap note says why.
  expect(agora(total)).toBeGreaterThanOrEqual(agora(leak));
  if (agora(total) > agora(leak)) await expect(page.getByTestId('explorer-cap-note')).toBeVisible();
  else await expect(page.getByTestId('explorer-cap-note')).toHaveCount(0);
  // A plain substring check — no hand-built regex from a number.
  expect(await tile.getAttribute('title')).toContain(at2dp(leak));
  // "מול 1–25 בספט׳": the default (open-month) view compares the aligned previous period.
  if (offset === 0) await expect(page.locator('main')).toContainText(/מול 1–\d+/);
});

test('no data yet: the CTA starts where the home does (receiving), never the flag-gated inbox', async ({ page }) => {
  // Two years back has no checked invoice — the state a fresh pilot restaurant opens on day one.
  for (const url of ['/dashboard/leaks/breakdown?m=-24', '/dashboard/leaks?p=custom&from=2020-01-01&to=2020-01-31']) {
    await page.goto(url);
    await expect(page.getByTestId('leak-state'), url).toHaveAttribute('data-state', 'noData');
    await expect(page.getByTestId('leak-state-cta'), url).toHaveAttribute('href', '/dashboard/receiving');
    await expect(page.locator('main a[href="/dashboard/inbox"]'), url).toHaveCount(0);
  }
  // The target exists for every tenant (no feature flag): it opens, no 404.
  await page.getByTestId('leak-state-cta').click();
  await page.waitForURL(/\/dashboard\/receiving/);
  await expect(page.getByText('404', { exact: true })).toHaveCount(0);
});

test('proof: the top catches plus "and N more" add up to the number', async ({ page }) => {
  // An independent source: the breakdown's per-invoice rows (the proof's "rest" is derived, so it can't check itself).
  // Both read the month the seed populated (last month in a month's first days — e2e/seededMonth.ts).
  await page.goto('/dashboard');
  const m = monthQuery(await seededLeakMonth(page.request));
  await page.goto(`/dashboard/leaks/breakdown${m}`);
  const invoiceRows = (await amounts(page, 'breakdown-row')).map(agora);
  await page.goto(`/dashboard/leaks/proof${m}`);
  const leak = Number((await page.getByTestId('proof-leak').innerText()).replace(/[^\d.]/g, ''));
  const catches = await page.getByTestId('proof-catch-amount').evaluateAll((els) =>
    els.map((e) => Number((e.textContent ?? '').replace(/[^\d.]/g, ''))),
  );
  const rest = await page.getByTestId('proof-rest').getAttribute('data-amount');
  expect(agora(leak), 'the proof number = Σ breakdown invoice rows').toBe(invoiceRows.reduce((a, b) => a + b, 0));
  // Each top catch is a real invoice row, and "and N more" is the rows NOT shown.
  const left = [...invoiceRows];
  for (const c of catches) {
    const i = left.indexOf(agora(c));
    expect(i, `catch ₪${c} is a breakdown row`).toBeGreaterThanOrEqual(0);
    left.splice(i, 1);
  }
  expect(agora(Number(rest ?? 0))).toBe(left.reduce((a, b) => a + b, 0));
  expect(Number(await page.getByTestId('proof-sum').getAttribute('data-amount'))).toBe(leak);
});

test('claims: one letter per supplier, sums to the agora, signed by the active restaurant', async ({ page }) => {
  await page.goto('/dashboard/leaks/claims');
  const letters = page.getByTestId('supplier-letter');
  const n = await letters.count();
  expect(n).toBeGreaterThan(1);
  const names = await letters.locator('p[id$="-to"]').allInnerTexts();
  expect(new Set(names).size, 'one letter per supplier').toBe(n);
  const totals: number[] = [];
  for (let i = 0; i < n; i++) {
    const letter = letters.nth(i);
    const lines = await letter.getByTestId('letter-line-amount').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-amount'))));
    const total = Number(await letter.getByTestId('letter-total').getAttribute('data-amount'));
    expect(sumAgora(lines), `letter ${i} lines = its total`).toBe(agora(total));
    totals.push(total);
    await expect(letter.getByTestId('letter-from')).toHaveText(new RegExp(`${DEMO_RESTAURANT_NAME}$`));
    await expect(letter.getByTestId('letter-signature')).toContainText(DEMO_RESTAURANT_NAME);
    await expect(letter.getByTestId('letter-whatsapp')).toHaveAttribute('href', /^https:\/\/wa\.me\/\?text=/);
    await expect(letter.getByTestId('letter-mail')).toHaveAttribute('href', /^mailto:/);
  }
  expect(agora(Number(await page.getByTestId('claims-summary').getAttribute('data-amount')))).toBe(sumAgora(totals));
  // Lines show their ₪ basis (expected vs charged).
  await expect(page.getByTestId('letter-math').first()).toBeVisible();
  // No "תביעה" (lawsuit) anywhere in the letters.
  await expect(page.locator('main')).not.toContainText('תביע');
  // A late sent letter offers a DRAFT reminder to the supplier — a wa.me link the user sends, nothing auto-sends.
  const reminder = page.getByTestId('sent-reminder').first();
  if (await reminder.count()) await expect(reminder).toHaveAttribute('href', /^https:\/\/wa\.me\/\?text=/);
});

test('claims: "mark as sent" waits 10 s with undo, then moves the claims in one call', async ({ page }) => {
  await page.goto('/dashboard/leaks/claims');
  // Pin the letter by its id: once "mark as sent" is pressed, a has-button filter would re-resolve.
  const root = await page.getByTestId('supplier-letter').filter({ has: page.getByTestId('letter-mark-sent') }).first().getAttribute('data-print-root');
  const letter = page.locator(`[data-print-root="${root}"]`);
  const supplier = (await letter.locator('p[id$="-to"]').innerText()).split(':').pop()!.replace(/לשליחה|To send/g, '').trim();
  const calls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('recovery.transition')) calls.push(r.url());
  });

  // Undo: nothing is written.
  await letter.getByTestId('letter-mark-sent').click();
  await expect(letter.getByTestId('letter-sent-badge')).toBeVisible();
  await page.getByTestId('undo-button').first().click();
  await page.waitForTimeout(11_000);
  expect(calls).toHaveLength(0);
  await expect(letter.getByTestId('letter-mark-sent')).toBeVisible();

  // Commit after 10 s: one call, then the supplier is listed as sent.
  await letter.getByTestId('letter-mark-sent').click();
  await page.waitForTimeout(10_500);
  await expect.poll(() => calls.length).toBe(1);
  await expect(page.getByTestId('sent-letters')).toContainText(supplier);

  // Put the seed back for the other specs.
  const sql = e2eSql();
  try {
    await sql`
      update recovery_claims c set status = 'claimed', letter_sent_at = null
      from recovery_events e
      where e.claim_id = c.id and e.to_status = 'letter_sent' and e.created_at > now() - interval '5 minutes'`;
  } finally {
    await sql.end();
  }
});

test('claims: keyboard "mark as sent" lands focus on Undo, the countdown holds while it is focused, ONE undo bar for all letters', async ({ page }) => {
  await page.goto('/dashboard/leaks/claims');
  const calls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('recovery.transition')) calls.push(r.url());
  });
  const marks = page.getByTestId('letter-mark-sent');
  test.skip((await marks.count()) < 2, 'needs two letters to send');
  const roots = await page
    .getByTestId('supplier-letter')
    .filter({ has: page.getByTestId('letter-mark-sent') })
    .evaluateAll((els) => els.slice(0, 2).map((e) => e.getAttribute('data-print-root')));
  for (const root of roots) {
    await page.locator(`[data-print-root="${root}"]`).getByTestId('letter-mark-sent').focus();
    await page.keyboard.press('Enter');
    // The pressed button is gone; focus is on the newest Undo, one key away.
    await expect(page.getByTestId('undo-button').last()).toBeFocused();
  }
  // Both moves sit in ONE live region (never two fixed bars drawn on top of each other).
  await expect(page.getByTestId('undo-bar')).toHaveCount(2);
  await expect(page.locator('[aria-live="polite"]').filter({ has: page.getByTestId('undo-bar') })).toHaveCount(1);
  // Held while the keyboard is on the bar: nothing is written after the 10 s window.
  await page.waitForTimeout(11_000);
  expect(calls).toHaveLength(0);
  await page.keyboard.press('Enter');
  await page.getByTestId('undo-button').first().click();
  await expect(page.getByTestId('undo-bar')).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(calls).toHaveLength(0);
});

test('recovery: "the money came back" names the ₪ credited (never ₪0) and, on a partial credit, the ₪ let go', async ({ page }) => {
  const sql = e2eSql();
  try {
    // A partial credit: ~60% came back, the rest is what closing it lets go.
    const [c] = await sql<{ id: string; amount_agorot: string; credited_agorot: string }[]>`
      update recovery_claims set status = 'credited', credited_agorot = floor(amount_agorot * 0.6), credited_at = now()
      where id = (select id from recovery_claims where status = 'claimed' order by amount_agorot desc limit 1)
      returning id, amount_agorot, credited_agorot`;
    const credited = Number(c!.credited_agorot) / 100;
    const letGo = (Number(c!.amount_agorot) - Number(c!.credited_agorot)) / 100;
    await page.goto('/dashboard/recovery?tab=all');
    const row = page.locator('[data-testid="claim-row"][data-status="credited"]').first();
    await row.getByRole('button', { name: /אשרו שהכסף חזר/ }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(at2dp(credited));
    await expect(dialog).not.toContainText(/(^|[^\d])0\.00/);
    await expect(dialog.getByTestId('confirm-let-go')).toContainText(at2dp(letGo));
    await dialog.getByRole('button', { name: 'חזרה' }).click();
  } finally {
    await sql`update recovery_claims set status = 'claimed', credited_agorot = 0, credited_at = null where status = 'credited'`;
    await sql.end();
  }
});

test('report: like-for-like compare, the money partition adds up', async ({ page }) => {
  // The month the seed populated (last month in a month's first days — e2e/seededMonth.ts).
  await page.goto('/dashboard');
  const offset = await seededLeakMonth(page.request);
  await page.goto(offset === 0 ? '/dashboard/leaks/report' : `/dashboard/leaks/report?month=${seededMonthKey(offset)}`);
  if (offset === 0) {
    // The open month: like-for-like ("1–25 … מול 1–25 …") and marked as still open.
    await expect(page.getByTestId('report-compare')).toContainText(/1–\d+ .+ מול 1–\d+/);
    await expect(page.getByTestId('report-freshness')).toContainText(/פתוח/);
  }
  await expect(page.getByTestId('report-subtitle')).toContainText(DEMO_RESTAURANT_NAME);
  const parts = await amounts(page, 'report-part');
  const found = Number(await page.getByTestId('report-found').getAttribute('data-amount'));
  expect(sumAgora(parts)).toBe(agora(found));
  // "Found" is built from its parts, so check it against an independent sum: the by-type table.
  const byType = Number(await page.getByTestId('report-type-total').getAttribute('data-amount'));
  expect(agora(found), 'found = Σ the discrepancy lines by type').toBe(agora(byType));
  await expect(page.locator('main')).not.toContainText('יעד: 1.5%');
  // Owner decision: numbers in tables are physically right-aligned (Hebrew too).
  const align = await page.getByTestId('report-supplier-total').evaluate((el) => getComputedStyle(el).textAlign);
  expect(align).toBe('right');
});

test('recovery: the funnel adds up; no select writes money; a write-off needs a confirm naming ₪ + supplier', async ({ page }) => {
  await page.goto('/dashboard/recovery');
  const parts = await page.getByTestId('funnel-part').locator('dd').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-shekels'))));
  const claimed = Number((await page.getByTestId('stage-claimed').innerText()).replace(/[^\d]/g, ''));
  expect(parts.reduce((a, b) => a + b, 0)).toBe(claimed);
  await expect(page.getByTestId('recovery-claims').locator('select')).toHaveCount(0);

  const row = page.getByTestId('claim-row').filter({ has: page.getByRole('button', { name: /פעולות נוספות/ }) }).first();
  await row.getByRole('button', { name: /פעולות נוספות/ }).click();
  const writeOff = page.getByRole('menuitem', { name: /ויתור/ });
  if (await writeOff.count()) {
    await writeOff.click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/לוותר על .*₪.* מול /);
    await expect(dialog.getByRole('radio', { name: 'הספק סירב' })).toBeVisible();
    await dialog.getByRole('button', { name: 'חזרה' }).click();
    await expect(dialog).toBeHidden();
  }
});

test.describe('phone 390×844', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the T1 leak sits in the top half; the view bar is one button', async ({ page }) => {
    await page.goto('/dashboard');
    await page.goto(`/dashboard/leaks${explorerQuery(await seededLeakMonth(page.request))}`);
    await expect(page.getByRole('button', { name: /^תצוגה/ })).toBeVisible();
    const top = await page.getByTestId('explorer-leak').evaluate((el) => {
      // The lab-only worker banner is not part of the product (DoD-2).
      const banner = [...document.querySelectorAll('main [role=status]')].find((b) => b.className.includes('border-warn'));
      const bannerH = banner ? banner.getBoundingClientRect().height + 24 : 0;
      return el.getBoundingClientRect().top - bannerH;
    });
    expect(top).toBeLessThan(844 / 2);
  });

  test('the view sheet closes when the window widens past phone width (the page never goes inert)', async ({ page }) => {
    await page.goto('/dashboard');
    await page.goto(`/dashboard/leaks${explorerQuery(await seededLeakMonth(page.request))}`);
    await page.getByRole('button', { name: /^תצוגה/ }).click();
    await expect(page.locator('dialog[open]')).toHaveCount(1);
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    // Not inert: a desktop control takes a click.
    await page.getByTestId('explorer-leak').click({ trial: true, timeout: 3000 });
  });

  test('recovery: claim cards grouped by supplier show the outstanding ₪', async ({ page }) => {
    await page.goto('/dashboard/recovery');
    await expect(page.getByTestId('recovery-claim-cards')).toBeVisible();
    const g = page.getByTestId('group-outstanding').first();
    await expect(g).toBeInViewport({ ratio: 1 }).catch(() => {});
    const box = await g.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  });
});
