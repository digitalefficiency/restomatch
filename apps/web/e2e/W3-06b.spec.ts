import { expect, test, type Page } from '@playwright/test';
import { he as lHe } from '../lib/i18n/messages/landing/he';

/**
 * W3-06b · /product (split from /about) and the hero media gate.
 *
 *   - /product carries the #problem #features #roi #trust anchors; the header
 *     nav, the footer and the home page's proof/trust links land on them;
 *   - an old /about#roi deep link forwards to /product#roi (Q5);
 *   - the old-figure promo film is off (M1): no "Watch 60 seconds" button;
 *   - the Hebrew-only 9:16 cut never reaches an English phone (Q1);
 *   - the hero loop is captioned as a sample (M12).
 */

type Locale = 'he' | 'en';
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } as const;

async function open(page: Page, path: string, locale: Locale = 'he') {
  const url = test.info().project.use.baseURL ?? 'http://localhost:3100';
  await page.context().addCookies([
    { name: 'rm_locale', value: locale, url },
    { name: 'rm_cookie_consent', value: 'necessary', url },
  ]);
  await page.goto(path, { waitUntil: 'load' });
}

test.describe('W3-06b · /product anchors and links', () => {
  test('/product renders every moved section', async ({ page }) => {
    await open(page, '/product');
    for (const id of ['problem', 'features', 'roi', 'trust']) {
      await expect(page.locator(`section#${id}`), `#${id}`).toHaveCount(1);
    }
  });

  test('header nav "features" lands on /product#features (desktop)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page, '/');
    await page.locator('header nav a[href="/product#features"]').click();
    await expect(page).toHaveURL(/\/product#features$/);
    await expect(page.locator('section#features')).toBeInViewport();
  });

  test('footer "features" link points at /product#features', async ({ page }) => {
    await open(page, '/');
    await expect(page.locator('footer a[href="/product#features"]')).toHaveCount(1);
  });

  test('the home page links its ROI and trust lines to /product', async ({ page }) => {
    await open(page, '/');
    await expect(page.locator('main a[href="/product#roi"]').first()).toBeAttached();
    await expect(page.locator('main a[href="/product#trust"]').first()).toBeAttached();
  });

  test('an old /about#roi deep link forwards to /product#roi', async ({ page }) => {
    await open(page, '/about#roi');
    await expect(page).toHaveURL(/\/product#roi$/);
    await expect(page.locator('section#roi')).toBeAttached();
  });
});

test.describe('W3-06b · hero media gate', () => {
  test('M1: no "Watch 60 seconds" promo button (old-figure films are off)', async ({ page }) => {
    await open(page, '/');
    await expect(page.getByRole('button', { name: lHe.hero.ctaWatch })).toHaveCount(0);
    await expect(page.locator('main a[href="/showcase"]').first()).toBeVisible();
  });

  test('M12: the hero loop is captioned as a sample (desktop)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page, '/');
    await expect(page.getByTestId('hero-video-caption')).toHaveText(lHe.v2.video.caption);
  });

  test.describe('phones', () => {
    test.use(PHONE);

    test('Q1: an English phone gets HeroMatch and never fetches the Hebrew 9:16 cut', async ({ page }) => {
      const nineBySixteen: string[] = [];
      page.on('request', (r) => {
        if (r.url().includes('9x16')) nineBySixteen.push(r.url());
      });
      await open(page, '/?lang=en', 'en');
      await page.waitForLoadState('networkidle').catch(() => {});
      await expect(page.getByTestId('hero-phone-mock')).toBeVisible();
      expect(nineBySixteen).toEqual([]);
    });

    test('a Hebrew phone gets the 9:16 cut, not the phone mock', async ({ page }) => {
      const media: string[] = [];
      page.on('request', (r) => {
        if (r.url().includes('/media/')) media.push(new URL(r.url()).pathname);
      });
      await open(page, '/');
      await page.waitForLoadState('networkidle').catch(() => {});
      await expect(page.getByTestId('hero-phone-mock')).toHaveCount(0);
      await expect(page.getByTestId('hero-video-caption')).toBeVisible();
      // R8: assert the wire, not the config — ≥1 9:16 fetch, and none of the 16:9 loops/posters.
      expect(media.some((u) => u.includes('9x16')), media.join(', ')).toBe(true);
      const sixteenByNine = media.filter(
        (u) => /\/media\/hero-loop(-en)?\.(webm|mp4)$/.test(u) || /\/media\/hero-poster(-en)?(-\d+)?\.(jpg|webp)$/.test(u),
      );
      expect(sixteenByNine).toEqual([]);
    });
  });
});
