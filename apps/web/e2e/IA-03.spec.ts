import { expect, test } from '@playwright/test';
import { e2eSql, loginViaMagicLink } from './helpers';
import { forbiddenModelFor } from '../lib/roleLens';

/**
 * IA-03 — visible role lenses, the DOM half (the JSON half waits for H-11ʰ):
 *  1. receiver and chef see no ₪ on their home and the receiving board (IA-SPEC §8);
 *  2. the 403 page vs the lens model (REPORT ONLY until the forbidden page consumes
 *     `forbiddenModelFor`; the orchestrator assigns that file): logs whether today's
 *     page offers an access request the role can never get, and the role's next step.
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

  for (const role of ['receiver', 'chef'] as const) {
    test(`${role}: no ₪ in the DOM on the no-₪ screens; 403 report`, async ({ page }) => {
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
      const body = await page.locator('main').innerText();
      const offersRequest = /בקש|request/i.test(body);
      const showsNextStep = await page.locator(`main a[href="${model.nextStep.href}"]`).count();
      console.log(
        `[IA-03] ${role} on ${from} → ${res?.status()} · page offers access request: ${offersRequest} (lens: ${model.offerAccessRequest}) · next step ${model.nextStep.href} linked: ${showsNextStep > 0}`,
      );
      expect(res?.status(), 'a forbidden screen answers 403').toBe(403);
    });
  }
});
