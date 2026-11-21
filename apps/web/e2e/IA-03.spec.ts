import { expect, test } from '@playwright/test';
import { e2eSql, loginViaMagicLink } from './helpers';
import { forbiddenModelFor } from '../lib/roleLens';

/**
 * IA-03 — visible role lenses, the DOM half (the JSON half waits for H-11ʰ):
 *  1. receiver and chef see no ₪ on their home and the receiving board (IA-SPEC §8);
 *  2. the 403 page follows the lens: no access request for a screen the role can never
 *     get, and the role's own next step;
 *  3. the bookkeeper: the one gate (route registry) decides; the lens only reads it.
 */

const SHEKEL = /₪/;

test.describe('IA-03 role lenses', () => {
  test.beforeAll(async () => {
    const sql = e2eSql();
    try {
      await sql`delete from rate_limit_counters`.catch(() => {});
    } finally {
      await sql.end();
    }
  });
  test.beforeEach(async ({ context, baseURL }) => {
    await context.addCookies([{ name: 'rm_cookie_consent', value: 'necessary', url: baseURL! }]);
  });

  test('bookkeeper: the gate admits the suppliers hub (read lens); the not-yet-opened I3 screens answer 403', async ({ page }) => {
    await loginViaMagicLink(page, 'bookkeeper@kfar-hazeitim.test');
    // Train C: the route registry is the one gate (W2-08 #251). It opens the suppliers hub to her.
    for (const path of ['/dashboard/suppliers', '/dashboard/suppliers/ledger']) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(200);
      await expect(page.getByTestId('forbidden-page'), path).toHaveCount(0);
    }
    // Screens whose route file does not list her yet: 403, and the page offers a request
    // (she can be given them under I3) plus her own next step.
    for (const path of ['/dashboard/orders', '/dashboard/catalog', '/dashboard/receiving']) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(403);
      await expect(page.getByTestId('forbidden-next-step'), path).toHaveAttribute('href', forbiddenModelFor('bookkeeper', path).nextStep.href);
    }
  });

  for (const role of ['receiver', 'chef'] as const) {
    test(`${role}: no ₪ in the DOM on the no-₪ screens; 403 follows the lens`, async ({ page }) => {
      await loginViaMagicLink(page, `${role}@kfar-hazeitim.test`);
      const noMoney = role === 'receiver' ? ['/dashboard', '/dashboard/receiving'] : ['/dashboard'];
      for (const path of noMoney) {
        await page.goto(path, { waitUntil: 'networkidle' });
        const text = await page.locator('main').innerText();
        expect(text, `${role} sees ₪ on ${path}`).not.toMatch(SHEKEL);
      }

      const from = '/dashboard/leaks';
      const res = await page.goto(from, { waitUntil: 'networkidle' });
      const model = forbiddenModelFor(role, from);
      console.log(`[IA-03] ${role} on ${from} → ${res?.status()} · next step ${model.nextStep.href}`);
      expect(model.offerAccessRequest, 'lens: ₪ screens are never offered to R/C').toBe(false);
      await expect(page.getByTestId('forbidden-request')).toHaveCount(0);
      await expect(page.getByTestId('forbidden-next-step')).toHaveAttribute('href', model.nextStep.href);
      expect(res?.status(), 'a forbidden screen answers 403').toBe(403);
    });
  }
});
