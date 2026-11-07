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
  unchecked: /^\/dashboard\/inbox\?filter=needs_review$/,
  gaps: /^\/dashboard\/approvals$/,
  claims: /^\/dashboard\/recovery$/,
  consolidated: /^\/dashboard\/(invoices\/[0-9a-f-]{36}|suppliers\/ledger)$/,
  deliveryNotes: /^\/dashboard\/suppliers\/ledger$/,
  vat: /^\/dashboard$/,
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

    for (const key of ORDER) {
      const href = await page.getByTestId(`close-link-${key}`).getAttribute('href');
      expect(href, key).toMatch(HREF[key]!);
    }
    const states = Object.fromEntries(
      await steps.evaluateAll((els) => els.map((e) => [e.getAttribute('data-step'), e.getAttribute('data-state')])),
    ) as Record<string, string>;
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

  test('receiver: no close page (route roles refuse it)', async ({ page }) => {
    await loginViaMagicLink(page, 'receiver@kfar-hazeitim.test', '/dashboard');
    const res = await page.goto('/dashboard/close');
    expect([403, 404]).toContain(res?.status());
    await expect(page.getByTestId('close-steps')).toHaveCount(0);
  });
});
