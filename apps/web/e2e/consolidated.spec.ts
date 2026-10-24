import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { DEMO_RESTAURANT_NAME, OWNER_STATE } from './env';
import { collectPageErrors, e2eSql } from './helpers';

/**
 * Consolidated invoice ↔ delivery notes cross-match (flag consolidatedMatch; the
 * demo tenant has features.all). The seed's Galilee Dairies standing order is billed
 * monthly on a חשבונית מרכזת GD-M-<YYYYMM> that lists its delivery notes (ת.מ.);
 * last month's is pending and bills milk 24 L at ₪7.90 instead of ₪6.40 on one note
 * (₪36.00). Its page shows the read-only proposal: calm "awaiting approval", the
 * difference on that note, per product — in Hebrew on a phone, English on desktop.
 */

test.use({ storageState: OWNER_STATE });

const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

/** WCAG 2.1 A/AA violations inside the panel (colour contrast included). */
async function panelAxe(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(async () => {
    const w = window as unknown as {
      axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> };
    };
    const res = await w.axe.run(
      { include: [['[data-testid="consolidated-panel"]']] },
      { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } },
    );
    return res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  });
}

async function consolidatedInvoiceId(status: 'parsed' | 'paid'): Promise<string> {
  const sql = e2eSql();
  try {
    const [row] = await sql<{ id: string }[]>`
      select i.id from invoices i join restaurants r on r.id = i.restaurant_id
      where r.name = ${DEMO_RESTAURANT_NAME} and i.invoice_number like 'GD-M-%' and i.status = ${status}
        and i.ocr_payload -> 'raw' ->> 'kind' = 'consolidated'
      order by i.invoice_date desc limit 1`;
    if (!row) throw new Error(`no ${status} GD-M consolidated invoice in the e2e seed`);
    return row.id;
  } finally {
    await sql.end();
  }
}

for (const [lang, viewport] of [
  ['he', { width: 390, height: 844 }],
  ['en', { width: 1280, height: 900 }],
] as const) {
  test(`consolidated invoice page shows the cross-match proposal (${lang})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors = collectPageErrors(page);
    const id = await consolidatedInvoiceId('parsed');
    await page.goto(`/dashboard/invoices/${id}?lang=${lang}`);

    const panel = page.getByTestId('consolidated-panel');
    await expect(panel).toBeVisible();
    // T4: a proposal, not counted yet.
    await expect(panel).toContainText(lang === 'he' ? 'לעיון — טרם שויכה' : 'For review — not yet linked');
    // T2: the one overcharge — solid badge + ₪36 + one action.
    const diff = page.getByTestId('xmatch-differences');
    await expect(diff).toBeVisible();
    await expect(diff).toContainText('36');
    // The notes: stacked cards on a phone, a table on desktop; the difference sits
    // on its note (DN 61036), with the actual finding under it.
    if (viewport.width < 640) {
      const cards = page.getByTestId('xmatch-note-cards').locator('li');
      expect(await cards.count()).toBeGreaterThan(1);
      const flagged = cards.filter({ hasText: '61036' });
      await expect(flagged).toContainText('36');
      await expect(flagged).toContainText(lang === 'he' ? 'חויב' : 'billed');
    } else {
      const notes = page.getByTestId('xmatch-notes');
      expect(await notes.locator('tbody tr').count()).toBeGreaterThan(1);
      await expect(notes).toContainText(lang === 'he' ? 'כלולה' : 'Included');
      const flagged = notes.locator('tbody tr').filter({ has: page.locator('td.text-danger.font-mono') });
      await expect(flagged).toHaveCount(1);
      await expect(flagged).toContainText('36');
      await expect(page.getByTestId('xmatch-note-finding')).toContainText(lang === 'he' ? 'חויב' : 'billed');
      // Printed, the panel is a letter to the supplier: who, which invoice, the ask.
      await page.emulateMedia({ media: 'print' });
      const letter = page.getByTestId('xmatch-letter');
      await expect(letter).toBeVisible();
      await expect(letter).toContainText('61036');
      await expect(letter).toContainText(lang === 'he' ? 'נא לזכות' : 'Please credit');
      await page.emulateMedia({ media: 'screen' });
    }
    expect(await page.getByTestId('xmatch-products').locator('tbody tr').count()).toBeGreaterThan(0);
    // Units go through the shared translator: English reads "(litre)", never "(ליטר)".
    if (lang === 'en') await expect(page.getByTestId('xmatch-products')).not.toContainText('ליטר');

    // No sideways page scroll on a phone (the tables scroll inside their own region).
    const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollW).toBeLessThanOrEqual(viewport.width + 1);
    expect(await panelAxe(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('a paid ריכוז shows the same cross-match for reference — calm, matched', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto(`/dashboard/invoices/${await consolidatedInvoiceId('paid')}?lang=en`);
  const panel = page.getByTestId('consolidated-panel');
  await expect(panel).toContainText('Cross-match for reference');
  await expect(page.getByTestId('xmatch-matched')).toBeVisible();
  expect(errors).toEqual([]);
});
