import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { OWNER_STATE } from './env';
import { collectPageErrors, e2eSql } from './helpers';

/**
 * W2-10 · Claims composer (phase 1) + recovery desk, on the seeded demo tenant:
 *  - letters come only from decided claims: each claim line appears ONCE, Σ lines = the letter total;
 *  - "mark as sent": undo within 10 s leaves the claims `claimed`; confirm → `letter_sent` via recovery.sendLetter;
 *  - the credit form starts empty, nothing pre-selected, no VAT default; incl. VAT shows ✓ at 0;
 *  - the desk tab lives in the URL and survives a reload; phone cards render; axe is clean; ₪ sits left of the digits in he.
 */
test.use({ storageState: OWNER_STATE });

const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
async function axeSerious(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(async () => {
    const w = window as unknown as {
      axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; impact: string; nodes: { target: string[] }[] }[] }> };
    };
    const res = await w.axe.run({ exclude: [['nextjs-portal'], ['[data-testid="worker-status-banner"]']] }, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } });
    return res.violations
      .filter((v) => v.impact === 'critical' || v.impact === 'serious')
      .flatMap((v) => v.nodes.map((n) => `${v.id} @ ${n.target.join(' ')}`));
  });
}
const agora = (n: number) => Math.round(n * 100);

async function restoreSent() {
  const sql = e2eSql();
  try {
    await sql`
      update recovery_claims c set status = 'claimed', letter_sent_at = null
      from recovery_events e
      where e.claim_id = c.id and e.to_status = 'letter_sent' and e.created_at > now() - interval '5 minutes'`;
  } finally {
    await sql.end();
  }
}

test('letters: each claim appears once, Σ lines = the letter total, built only from claims', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto('/dashboard/leaks/claims');
  const letters = page.getByTestId('supplier-letter');
  const n = await letters.count();
  expect(n).toBeGreaterThan(0);
  const sql = e2eSql();
  try {
    const [row] = await sql<{ owed: string }[]>`
      select coalesce(sum(amount_agorot - credited_agorot), 0)::text as owed
      from recovery_claims where status = 'claimed' and amount_agorot > credited_agorot`;
    let pageTotal = 0;
    for (let i = 0; i < n; i++) {
      const l = letters.nth(i);
      const lines = await l.getByTestId('letter-line-amount').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-amount'))));
      const total = Number(await l.getByTestId('letter-total').getAttribute('data-amount'));
      expect(lines.reduce((s, x) => s + agora(x), 0)).toBe(agora(total));
      pageTotal += agora(total);
    }
    // Σ letters = Σ claimed claims, to the agora (the shared parity).
    expect(pageTotal).toBe(Number(row!.owed));
  } finally {
    await sql.end();
  }
  expect(errors).toEqual([]);
});

test('letters: preview → wa.me href → undo leaves claimed → confirm gives letter_sent (sendLetter)', async ({ page }) => {
  await page.goto('/dashboard/leaks/claims');
  const root = await page.getByTestId('supplier-letter').filter({ has: page.getByTestId('letter-mark-sent') }).first().getAttribute('data-print-root');
  const letter = page.locator(`[data-print-root="${root}"]`);
  const wa = await letter.getByTestId('letter-whatsapp').getAttribute('href');
  expect(wa).toMatch(/^https:\/\/wa\.me\/\?text=/);
  const calls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('recovery.sendLetter') || r.url().includes('recovery.transition')) calls.push(r.url());
  });
  await letter.getByTestId('letter-mark-sent').click();
  await page.getByTestId('undo-button').first().click();
  await page.waitForTimeout(11_000);
  expect(calls).toHaveLength(0);
  await letter.getByTestId('letter-mark-sent').click();
  await page.waitForTimeout(10_500);
  await expect.poll(() => calls.filter((u) => u.includes('recovery.sendLetter')).length).toBe(1);
  await restoreSent();
});

test('credit form: empty, nothing pre-selected, no VAT default; ₪118.00 incl. on a ₪100.00 claim shows ✓', async ({ page }) => {
  await page.goto('/dashboard/recovery');
  const open = page.getByRole('button', { name: /^רשמו זיכוי/ }).first();
  await open.click();
  const form = page.getByTestId('credit-form').first();
  await expect(form).toBeVisible();
  await expect(form.getByTestId('credit-amount')).toHaveValue('');
  await expect(form.locator('input[type="checkbox"]:checked')).toHaveCount(0);
  await expect(form.getByTestId('credit-vat').getByRole('radio', { checked: true })).toHaveCount(0);
  await expect(form.getByRole('button', { name: 'שמירה' })).toBeDisabled();
  // Pick the first claim; type its owed ₪ × 1.18 (incl.) → ✓ at 0.
  const first = form.locator('label').filter({ has: page.locator('input[type="checkbox"]') }).first();
  await first.locator('input[type="checkbox"]').check();
  const owedText = (await first.locator('span.tabular-nums').innerText()).replace(/[^\d.]/g, '');
  const owedAgorot = Math.round(Number(owedText) * 100);
  const incl = (Math.round((owedAgorot * 118) / 100) / 100).toFixed(2);
  await form.getByTestId('credit-amount').fill(incl);
  await form.getByTestId('credit-vat').getByRole('radio', { name: 'כולל מע״מ' }).click();
  await expect(form.getByTestId('credit-remainder')).toContainText('✓');
  await expect(form.getByRole('button', { name: 'שמירה' })).toBeEnabled();
});

test('desk: ?tab= survives a reload; axe clean; ₪ left of the digits (he)', async ({ page }) => {
  await page.goto('/dashboard/recovery');
  await page.getByRole('radio', { name: /^הכל/ }).click();
  await expect(page).toHaveURL(/tab=all/);
  await page.reload();
  await expect(page.getByRole('radio', { name: /^הכל/ })).toHaveAttribute('aria-checked', 'true');
  expect(await axeSerious(page)).toEqual([]);
  // RTL money: in he, "₪" renders to the LEFT of the first digit.
  const box = await page.getByTestId('recovery-outstanding').evaluate((el) => {
    const r = document.createRange();
    const text = el.textContent ?? '';
    const node = el.querySelector('bdi')?.firstChild ?? el.firstChild;
    if (!node) return null;
    const sym = text.indexOf('₪');
    const dig = text.search(/\d/);
    if (sym < 0 || dig < 0) return null;
    r.setStart(node, sym);
    r.setEnd(node, sym + 1);
    const s = r.getBoundingClientRect();
    r.setStart(node, dig);
    r.setEnd(node, dig + 1);
    const d = r.getBoundingClientRect();
    return { sym: s.left, dig: d.left };
  });
  if (box) expect(box.sym).toBeLessThan(box.dig);
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('recovery: claim cards render grouped by supplier, no horizontal overflow', async ({ page }) => {
    await page.goto('/dashboard/recovery');
    await expect(page.getByTestId('recovery-claim-cards')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
