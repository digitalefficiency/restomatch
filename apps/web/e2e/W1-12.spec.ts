import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { he as mHe } from '../lib/i18n/messages/marketing/he';
import { en as mEn } from '../lib/i18n/messages/marketing/en';
import { he as sHe } from '../lib/i18n/messages/showcase/he';
import { en as sEn } from '../lib/i18n/messages/showcase/en';
import { en as recvEn } from '../lib/i18n/messages/receiving/en';

/**
 * W1-12 · Public site: accessibility statement, conversion basics, honest 404s.
 *
 *   - /accessibility is reachable from the marketing and showcase footers, in
 *     he and en, states the real (partial) conformance and has no overlay widget;
 *   - phone: the sticky CTA appears after the hero, hides over #lead and the
 *     footer and sits above the cookie banner; the menu sheet closes on a link,
 *     a hash link, an outside tap and Esc (focus back on the trigger);
 *   - the lead form refuses a name-only lead with an inline, described error;
 *   - an anonymous 404 is the marketing 404 (no "/dashboard" way out, no
 *     nested interactive); the flag-off /leak-check lands on the lead form;
 *   - showcase: one ≤64 px header row, the active demo marked aria-current,
 *     an end card on every demo; the landing morph is pausable and finite.
 */

const AXE_SOURCE = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8',
);
type Locale = 'he' | 'en';
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } as const;

async function open(page: Page, path: string, { locale = 'he' as Locale, consent = true } = {}) {
  const url = test.info().project.use.baseURL ?? 'http://localhost:3100';
  const cookies = [{ name: 'rm_locale', value: locale, url }];
  if (consent) cookies.push({ name: 'rm_cookie_consent', value: 'necessary', url });
  await page.context().addCookies(cookies);
  const res = await page.goto(path, { waitUntil: 'load' });
  await page.waitForLoadState('networkidle').catch(() => {});
  return res;
}

async function axeSerious(page: Page, rules?: string[]): Promise<string[]> {
  await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(async (only) => {
    const w = window as unknown as {
      axe: {
        run: (
          ctx: Document,
          opts: object,
        ) => Promise<{ violations: Array<{ id: string; impact: string | null }> }>;
      };
    };
    const r = await w.axe.run(
      document,
      only
        ? { runOnly: { type: 'rule', values: only } }
        : {
            runOnly: {
              type: 'tag',
              values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
            },
          },
    );
    return r.violations
      .filter((v) => v.impact === 'critical' || v.impact === 'serious')
      .map((v) => v.id);
  }, rules ?? null);
}

test.describe('accessibility statement', () => {
  for (const locale of ['he', 'en'] as const) {
    const m = locale === 'he' ? mHe : mEn;
    test(`${locale}: reachable from the marketing footer, honest, axe-clean`, async ({ page }) => {
      await open(page, '/', { locale });
      const footer = page.locator('[data-site-footer]');
      await footer.getByRole('link', { name: m.shell.accessibility }).click();
      await expect(page).toHaveURL(/\/accessibility$/);
      await expect(page.getByRole('heading', { level: 1, name: m.a11y.title })).toBeVisible();
      await expect(page.getByTestId('a11y-conformance')).toHaveText(m.a11y.levelStatus);
      await expect(page.getByText(m.a11y.levelBody)).toBeVisible();
      await expect(page.getByRole('heading', { name: m.a11y.gapsTitle })).toBeVisible();
      const coordinator = page.getByTestId('a11y-coordinator');
      await expect(coordinator).toContainText(m.a11y.sla);
      // Operator: the legal name alone — no company number (owner decision) and no placeholder.
      const operator = page.getByTestId('a11y-operator');
      await expect(operator).toHaveText(
        locale === 'he' ? 'דיגיטל אפישנסי בע״מ' : 'Digital Efficiency Ltd.',
      );
      await expect(page.locator('[data-placeholder]')).toHaveCount(0);
      expect(await page.locator('main').innerText()).not.toMatch(/\d{9}/);
      // Owner decision: the coordinator is Rom Koren, with phone and e-mail.
      await expect(coordinator).toContainText(locale === 'he' ? 'רום קורן' : 'Rom Koren');
      // Name / phone / e-mail are present — either the owner's values or marked placeholders.
      await expect(coordinator.locator('dd')).toHaveCount(3);
      // No overlay widget.
      const overlay = await page
        .locator(
          'script[src*="userway"], script[src*="equalweb"], script[src*="accessibe"], script[src*="nagich"]',
        )
        .count();
      expect(overlay).toBe(0);
      expect(await axeSerious(page)).toEqual([]);
    });
  }

  test('reachable from the showcase footer and listed in the sitemap', async ({
    page,
    request,
  }) => {
    await open(page, '/showcase');
    await page.locator('footer').getByRole('link', { name: mHe.shell.accessibility }).click();
    await expect(page).toHaveURL(/\/accessibility$/);
    const sitemap = await (await request.get('/sitemap.xml')).text();
    expect(sitemap).toContain('/accessibility</loc>');
  });
});

test('pricing states the 30-day Pro trial', async ({ page }) => {
  await open(page, '/pricing');
  await expect(page.getByTestId('trial-terms')).toHaveText(mHe.pricing.trialTerms);
});

test.describe('phone conversion basics', () => {
  test.use(PHONE);

  test('sticky CTA: after the hero, hidden over #lead and the footer', async ({ page }) => {
    await open(page, '/');
    const sticky = page.getByTestId('sticky-cta');
    await expect(sticky).toBeHidden();
    await page.mouse.wheel(0, 1400);
    await expect(sticky).toBeVisible();
    await expect(sticky.getByRole('link', { name: mHe.shell.cta })).toBeVisible();
    const box = await sticky.getByRole('link', { name: mHe.shell.cta }).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
    await page.locator('#lead').scrollIntoViewIfNeeded();
    await expect(sticky).toBeHidden();
    await page.locator('[data-site-footer]').scrollIntoViewIfNeeded();
    await expect(sticky).toBeHidden();
  });

  test('sticky CTA sits above the cookie banner', async ({ page }) => {
    await open(page, '/', { consent: false });
    const banner = page.getByRole('dialog', { name: mHe.cookie.label });
    await expect(banner).toBeVisible();
    await page.mouse.wheel(0, 1400);
    const sticky = page.getByTestId('sticky-cta');
    await expect(sticky).toBeVisible();
    const s = await sticky.boundingBox();
    const b = await banner.boundingBox();
    expect(s && b && s.y + s.height <= b.y + 1).toBeTruthy();
  });

  test('menu sheet closes on link, hash link, outside tap and Esc', async ({ page }) => {
    await open(page, '/');
    const trigger = page.getByTestId('mobile-menu-trigger');
    const sheet = page.getByTestId('mobile-menu');

    await trigger.click();
    await expect(sheet).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await trigger.click();
    // The sheet comes from the start edge (right in Hebrew): tap the scrim on the left.
    await page.getByTestId('mobile-menu-scrim').click({ position: { x: 20, y: 400 } });
    await expect(sheet).toHaveCount(0);

    await trigger.click();
    await sheet.getByRole('link', { name: mHe.shell.nav.how }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page).toHaveURL(/#how$/);

    await trigger.click();
    await sheet.getByRole('link', { name: mHe.shell.nav.pricing }).click();
    await expect(page).toHaveURL(/\/pricing$/);
    await expect(sheet).toHaveCount(0);
  });

  test('lead form: name only is refused with an inline, described error', async ({ page }) => {
    await open(page, '/#lead');
    const name = page.locator('#lead-name');
    await name.waitFor();
    await name.fill('דנה');
    await page.getByRole('button', { name: mHe.lead.submit }).click();
    const phone = page.locator('#lead-phone');
    await expect(phone).toBeFocused();
    await expect(phone).toHaveAttribute('aria-invalid', 'true');
    await expect(phone).toHaveAttribute('aria-describedby', 'lead-phone-error');
    await expect(page.locator('#lead-phone-error')).toHaveText(mHe.lead.errorContact);
    await expect(phone).toHaveAttribute('type', 'tel');
    await expect(phone).toHaveAttribute('dir', 'ltr');
    // Scrolled clear of the sticky header (the page scrolls smoothly, so poll).
    await expect.poll(async () => (await phone.boundingBox())?.y ?? 0).toBeGreaterThan(64);

    await phone.fill('123');
    await page.getByRole('button', { name: mHe.lead.submit }).click();
    await expect(page.locator('#lead-phone-error')).toHaveText(mHe.lead.errorPhone);
    await expect(page.getByTestId('lead-success')).toHaveCount(0);
  });

  test('lead form: a phone number is enough, and the success state says what happens next', async ({
    page,
  }) => {
    await open(page, '/?utm_source=e2e#lead');
    await page.locator('#lead-name').fill('בדיקת W1-12');
    await page.locator('#lead-phone').fill('+972 50 123 4567');
    await page.getByRole('button', { name: mHe.lead.submit }).click();
    const success = page.getByTestId('lead-success');
    await expect(success).toBeVisible();
    await expect(success).toContainText('050-1234567');
    await expect(success.getByRole('link', { name: mHe.lead.successDemo })).toHaveAttribute(
      'href',
      '/showcase',
    );
  });
});

test.describe('honest 404s', () => {
  for (const path of ['/showcase/no-such-demo', '/leak-check/no-such-page']) {
    test(`anonymous ${path} → marketing 404`, async ({ page }) => {
      const res = await open(page, path);
      expect(res?.status()).toBe(404);
      await expect(page.getByRole('heading', { level: 1, name: mHe.notFound.title })).toBeVisible();
      await expect(page.locator('[data-site-footer]')).toBeVisible();
      await expect(
        page.getByTestId('not-found').getByRole('link', { name: mHe.notFound.home }),
      ).toHaveAttribute('href', '/');
      await expect(page.locator('main a[href="/dashboard"]')).toHaveCount(0);
      expect(await axeSerious(page, ['nested-interactive'])).toEqual([]);
    });
  }

  test('flag-off /leak-check lands on the lead form, not a 404', async ({ page }) => {
    const res = await open(page, '/leak-check');
    expect(res?.status()).toBe(200);
    await expect(page).toHaveURL(/\/#lead$/);
  });
});

test.describe('showcase chrome', () => {
  test.use(PHONE);

  test('one header row ≤64 px, active demo marked, end card at the end', async ({ page }) => {
    await open(page, '/showcase/dashboard/invoices');
    const header = page.locator('header').first();
    expect((await header.boundingBox())?.height ?? 99).toBeLessThanOrEqual(64);
    await page.getByTestId('demo-picker').click();
    const sheet = page.getByTestId('demo-sheet');
    await expect(sheet.locator('[aria-current="page"]')).toHaveText(sHe.layout.nav.invoices);
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(
      page.getByTestId('showcase-end-card').getByRole('link', { name: sHe.endCard.ctaPilot }),
    ).toBeVisible();
    // The invoice rows no longer nest links inside a button.
    expect(await axeSerious(page, ['nested-interactive'])).toEqual([]);
  });

  test('receiver demo: the confirmed receipt ends in the end card (en)', async ({ page }) => {
    const s = recvEn.steps;
    await open(page, '/showcase/receiver', { locale: 'en' });
    const main = page.locator('main');
    await main.getByRole('button', { name: /Avi's Produce/ }).click();
    await main.getByRole('button', { name: s.supplier.continue }).click();
    await main.getByRole('button', { name: s.scan.useDemo }).click();
    await main.getByRole('button', { name: s.scan.process }).click();
    await main.getByRole('button', { name: s.recon.continueAdjust }).click({ timeout: 30_000 });
    // Settle every line that needs a check (one "= order / = invoice" choice per line), then save.
    const missing = main.getByRole('button', { name: s.adjust.missing });
    const lines = await missing.count();
    for (let i = 0; i < lines; i++) {
      await missing.nth(i).locator('xpath=..').getByRole('button', { name: /^= / }).first().click();
    }
    await main.getByRole('button', { name: s.adjust.closeAndSave }).click();
    const card = page.getByTestId('showcase-end-card');
    await expect(card).toBeVisible();
    await expect(card.getByRole('link', { name: sEn.endCard.ctaPilot })).toHaveAttribute(
      'href',
      '/#lead',
    );
  });

  for (const path of ['/showcase/dashboard', '/showcase/deliveries', '/showcase/approvals']) {
    test(`${path} ends in an end card`, async ({ page }) => {
      await open(page, path);
      await expect(page.getByTestId('showcase-end-card')).toBeVisible();
    });
  }
});

test.describe('landing motion', () => {
  test('the receiver morph is finite and has a 44 px pause', async ({ page }) => {
    await open(page, '/');
    const toggle = page.getByTestId('morph-toggle');
    await toggle.scrollIntoViewIfNeeded();
    const box = await toggle.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    const iterations = await page
      .locator('.rm-morph-en')
      .first()
      .evaluate((el) => getComputedStyle(el).animationIterationCount);
    expect(iterations).toBe('3');
    await toggle.click();
    await expect(toggle).toHaveAttribute('data-state', 'paused');
    const state = await page
      .locator('.rm-morph-en')
      .first()
      .evaluate((el) => getComputedStyle(el).animationPlayState);
    expect(state).toBe('paused');
  });

  test.describe('reduced motion', () => {
    test.use({ contextOptions: { reducedMotion: 'reduce' } });
    test('no pause button when nothing moves', async ({ page }) => {
      await open(page, '/');
      await expect(page.getByTestId('morph-toggle')).toBeHidden();
    });
  });
});
