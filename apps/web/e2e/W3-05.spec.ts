import { expect, test, type Page } from '@playwright/test';
import { collectPageErrors, loginViaMagicLink } from './helpers';

/**
 * W3-05a · Month close checklist (/dashboard/close).
 *
 *   - the bookkeeper (the page's default lens) sees the 7 steps in close order,
 *     each with a state, a figure and ONE link to the queue where its number lives;
 *   - at most one primary CTA; consolidated invoices and the not-yet-logged export
 *     are T4 neutral, never "to do";
 *   - the "gaps" figure IS approvals.queueSummary (one home per number);
 *   - the month stepper moves back a month; the receiver is refused (no purchase ₪).
 */

const MONTH = '2026-10';
const ORDER = ['unchecked', 'gaps', 'claims', 'consolidated', 'deliveryNotes', 'vat', 'exports'];
const HREF: Record<string, RegExp> = {
  unchecked: /^\/dashboard\/invoices\?month=-?\d+&view=awaiting$/,
  gaps: /^\/dashboard\/approvals$/,
  claims: /^\/dashboard\/recovery$/,
  consolidated: /^\/dashboard\/(invoices\/[0-9a-f-]{36}|suppliers\/ledger)$/,
  deliveryNotes: /^\/dashboard\/suppliers\/ledger$/,
  vat: /^#vat-at-risk$/,
  exports: /^\/dashboard\/exports$/,
};

async function trpc<T>(page: Page, path: string, input?: unknown): Promise<T> {
  const q = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  const res = await page.request.get(`/api/trpc/${path}${q}`);
  expect(res.status(), path).toBe(200);
  return ((await res.json()) as { result: { data: { json: T } } }).result.data.json;
}

test.describe('W3-05a month close', () => {
  test('bookkeeper: 7 ordered steps, one home per number, T4 never an alarm', async ({ page }) => {
    const errors = collectPageErrors(page);
    await loginViaMagicLink(page, 'bookkeeper@kfar-hazeitim.test', '/dashboard');
    const res = await page.goto(`/dashboard/close?month=${MONTH}`);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: 'סגירת חודש' })).toBeVisible();

    const steps = page.locator('[data-testid="close-steps"] > li');
    await expect(steps).toHaveCount(7);
    expect(await steps.evaluateAll((els) => els.map((e) => e.getAttribute('data-step')))).toEqual(ORDER);

    const states = Object.fromEntries(
      await steps.evaluateAll((els) => els.map((e) => [e.getAttribute('data-step'), e.getAttribute('data-state')])),
    ) as Record<string, string>;
    // A step that is off renders no button; every other step links to its queue (VAT → the card below the list).
    for (const key of ORDER) {
      const link = page.getByTestId(`close-link-${key}`);
      if (states[key] === 'off') {
        await expect(link, key).toHaveCount(0);
        continue;
      }
      expect(await link.getAttribute('href'), key).toMatch(HREF[key]!);
    }
    // The header counts every step shown (7), or says nothing is left to act on.
    await expect(page.getByTestId('close-progress')).toHaveText(/מתוך 7|אין שלבים פתוחים/);
    expect(['pending', 'done']).toContain(states.consolidated);
    expect(states.exports).toBe('pending');

    // ONE primary CTA at most, and only on a step with items.
    const primaries = await steps.evaluateAll((els) =>
      els.filter((e) => e.getAttribute('data-primary') === 'true').map((e) => e.getAttribute('data-state')),
    );
    expect(primaries.length).toBeLessThanOrEqual(1);
    for (const s of primaries) expect(s).toBe('todo');

    // One home per number: the gaps step shows approvals.queueSummary's count.
    // (the home's "ממתין להחלטה שלך" figure: queueSummary.count with toDecide ₪ — home/queue-summary.ts decideNeed)
    const summary = await trpc<{ count: number }>(page, 'approvals.queueSummary');
    if (states.gaps !== 'off') {
      await expect(page.getByTestId('close-figure-gaps')).toContainText(
        new Intl.NumberFormat('he-IL').format(summary.count),
      );
    }

    // Month stepper: back one month.
    await page.getByRole('link', { name: 'החודש הקודם' }).click();
    await expect(page).toHaveURL(/\/dashboard\/close\?month=2026-09$/);
    await expect(page.getByTestId('close-month')).toContainText('ספטמבר');
    expect(errors).toEqual([]);
  });

  test('W3-05b exports.preview agrees with the W2-14 summary for the demo month (same query as the file)', async ({ page }) => {
    await loginViaMagicLink(page, 'bookkeeper@kfar-hazeitim.test', '/dashboard');
    const period = { from: '2026-10-01', to: '2026-10-31' };
    const [p, s] = await Promise.all([
      trpc<{ invoiceCount: number; totalInclVatAgorot: number; disputedCount: number; excluded: Array<{ reason: string; count: number }> }>(
        page,
        'exports.preview',
        period,
      ),
      trpc<{ invoiceCount: number; totalInclVat: string; disputedCount: number; undatedCount: number }>(page, 'exports.summary', period),
    ]);
    expect(p.invoiceCount).toBe(s.invoiceCount);
    expect(p.totalInclVatAgorot).toBe(Math.round(Number(s.totalInclVat) * 100));
    expect(p.disputedCount).toBe(s.disputedCount);
    expect(p.excluded.find((g) => g.reason === 'undated')?.count ?? 0).toBe(s.undatedCount);
  });

  test('receiver: no close page (route roles refuse it)', async ({ page }) => {
    await loginViaMagicLink(page, 'receiver@kfar-hazeitim.test', '/dashboard');
    const res = await page.goto('/dashboard/close');
    expect([403, 404]).toContain(res?.status());
    await expect(page.getByTestId('close-steps')).toHaveCount(0);
  });
});
