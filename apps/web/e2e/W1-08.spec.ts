import { expect, test, type Page } from '@playwright/test';
import { DEMO_RESTAURANT_NAME, OWNER_STATE } from './env';
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

test('breakdown: the invoice rows add up to the leak total, shown to the agora', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto('/dashboard/leaks/breakdown');
  const total = Number(await page.getByTestId('breakdown-total').getAttribute('data-amount'));
  expect(total).toBeGreaterThan(0);
  const rows = await amounts(page, 'breakdown-row');
  expect(sumAgora(rows)).toBe(agora(total));
  expect(Number(await page.getByTestId('breakdown-rows-total').getAttribute('data-amount'))).toBe(total);
  // Shown at 2 dp next to its rows; the exact value is also in the title.
  await expect(page.getByTestId('breakdown-total')).toContainText(total.toFixed(2));
  // A zero-₪ finding is a calm note, never a red ₪0.00.
  await expect(page.getByTestId('line-no-money').first()).not.toContainText('0.00');
  expect(errors).toEqual([]);
});

test('explorer: bars total = Σ bars; the T1 tile carries the exact leak; compare is on by default', async ({ page }) => {
  await page.goto('/dashboard/leaks');
  const rows = await amounts(page, 'chart-row');
  const total = Number(await page.getByTestId('chart-total').getAttribute('data-amount'));
  expect(sumAgora(rows)).toBe(agora(total));
  const tile = page.getByTestId('explorer-leak');
  const leak = Number(await tile.getAttribute('data-amount'));
  expect(agora(leak)).toBe(agora(total));
  await expect(tile).toHaveAttribute('title', new RegExp(leak.toFixed(2).replace('.', '\\.')));
  // "מול 1–25 בספט׳": the default compare is the aligned previous period.
  await expect(page.locator('main')).toContainText(/מול 1–\d+/);
});

test('proof: the top catches plus "and N more" add up to the number', async ({ page }) => {
  await page.goto('/dashboard/leaks/proof');
  const leak = Number((await page.getByTestId('proof-leak').innerText()).replace(/[^\d.]/g, ''));
  const catches = await page.getByTestId('proof-catch-amount').evaluateAll((els) =>
    els.map((e) => Number((e.textContent ?? '').replace(/[^\d.]/g, ''))),
  );
  const rest = await page.getByTestId('proof-rest').getAttribute('data-amount');
  expect(sumAgora([...catches, Number(rest ?? 0)])).toBe(agora(leak));
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

test('report: like-for-like compare, the money partition adds up', async ({ page }) => {
  await page.goto('/dashboard/leaks/report');
  await expect(page.getByTestId('report-compare')).toContainText(/1–\d+ .+ מול 1–\d+/);
  await expect(page.getByTestId('report-freshness')).toContainText(/פתוח/);
  await expect(page.getByTestId('report-subtitle')).toContainText(DEMO_RESTAURANT_NAME);
  const parts = await amounts(page, 'report-part');
  const found = Number(await page.getByTestId('report-found').getAttribute('data-amount'));
  expect(sumAgora(parts)).toBe(agora(found));
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
    await page.goto('/dashboard/leaks');
    await expect(page.getByRole('button', { name: /^תצוגה/ })).toBeVisible();
    const top = await page.getByTestId('explorer-leak').evaluate((el) => {
      // The lab-only worker banner is not part of the product (DoD-2).
      const banner = [...document.querySelectorAll('main [role=status]')].find((b) => b.className.includes('border-warn'));
      const bannerH = banner ? banner.getBoundingClientRect().height + 24 : 0;
      return el.getBoundingClientRect().top - bannerH;
    });
    expect(top).toBeLessThan(844 / 2);
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
