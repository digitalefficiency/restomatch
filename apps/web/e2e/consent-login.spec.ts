import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * /login on a fresh phone (cookie banner not answered). The page is short and
 * centred, so the banner used to sit on the sign-in buttons. Now:
 *  - the page reserves the banner's height (app/consent-clearance.tsx), and
 *  - the magic-link button is `data-keep-clear`, so where the card does not fit
 *    above the banner the banner waits until the button is scrolled clear
 *    (lib/components/CookieConsent).
 * 390×664 is the visible area of a 390×844 phone in mobile Safari (toolbars).
 */
const BANNER = '[role="dialog"][aria-label="הסכמה לשימוש בעוגיות"], [role="dialog"][aria-label="Cookie consent"]';
const LABELS = {
  he: { magic: 'שלחו לי קישור התחברות', password: 'כניסה', necessary: 'רק חיוניות' },
  en: { magic: 'Email me a sign-in link', password: 'Sign in', necessary: 'Essential only' },
} as const;

/** True when the element's centre is the top-most hit target (nothing over it). */
async function onTop(page: Page, loc: Locator): Promise<boolean> {
  const box = await loc.boundingBox();
  if (!box) return false;
  const handle = await loc.elementHandle();
  return page.evaluate(
    ({ x, y, el }) => {
      const hit = document.elementFromPoint(x, y);
      return Boolean(hit && el && (hit === el || el.contains(hit)));
    },
    { x: box.x + box.width / 2, y: box.y + box.height / 2, el: handle },
  );
}

for (const height of [844, 664]) {
  for (const lang of ['he', 'en'] as const) {
    test.describe(`390×${height} · ${lang}`, () => {
      test.use({ viewport: { width: 390, height }, isMobile: true, hasTouch: true });

      test('sign-in buttons are never under the unanswered cookie banner', async ({ page }) => {
        const l = LABELS[lang];
        await page.context().clearCookies();
        await page.context().addCookies([{ name: 'rm_locale', value: lang, url: test.info().project.use.baseURL! }]);
        await page.goto('/login');
        const magic = page.getByRole('button', { name: l.magic });
        const password = page.getByRole('button', { name: l.password, exact: true });
        await expect(magic).toBeVisible();
        await page.waitForTimeout(500); // the banner decides after mount

        // First paint, nothing scrolled: both submit buttons are clickable.
        expect(await onTop(page, password), 'password submit not covered').toBe(true);
        expect(await onTop(page, magic), 'magic-link submit not covered').toBe(true);

        // Scrolled to the end (the banner may appear now): still clickable.
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(300);
        await magic.scrollIntoViewIfNeeded();
        expect(await onTop(page, magic), 'magic-link submit not covered after scrolling').toBe(true);

        // When the banner is up it still works, and answering releases the space.
        const banner = page.locator(BANNER);
        if (await banner.isVisible()) {
          await page.getByRole('button', { name: l.necessary }).click();
          await expect(banner).toHaveCount(0);
        }
        await expect
          .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--consent-h').trim() || '0px'))
          .toBe('0px');
      });
    });
  }
}
