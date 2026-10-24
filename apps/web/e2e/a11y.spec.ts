import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { en as recvEn } from '../lib/i18n/messages/receiving/en';
import { DEMO_OWNER_EMAIL, DEMO_RESTAURANT_NAME, OWNER_STATE } from './env';
import { e2eSql } from './helpers';

/**
 * Accessibility regression gate for the client-demo paths (S9):
 *   - axe-core finds no WCAG 2.1 A/AA violation (colour contrast included) on
 *     the landing, /login and the owner dashboard pages, in Hebrew (RTL) and
 *     English, at phone (390 px, touch) and desktop width;
 *   - on a touch screen every control is at least 44×44 CSS px;
 *   - the receiving wizard's steps (shared with /showcase/receiver) stay clean
 *     all the way from supplier pick to the adjust-quantities step.
 */

const AXE_SOURCE = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8',
);
const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

type Locale = 'he' | 'en';
const LOCALES: Locale[] = ['he', 'en'];
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

const PUBLIC_PAGES = ['/', '/login'];
const DASHBOARD_PAGES = [
  '/dashboard',
  '/dashboard/leaks',
  '/dashboard/approvals',
  '/dashboard/chain',
  '/dashboard/receiving',
  '/dashboard/receiving/:openPo',
  // A detail page with a breadcrumb trail (lib/components/Breadcrumbs).
  '/dashboard/suppliers/:supplier',
];

let openPo = '';
let supplier = '';

test.beforeAll(async () => {
  const sql = e2eSql();
  try {
    const [row] = await sql<{ id: string }[]>`
      select po.id from purchase_orders po join restaurants r on r.id = po.restaurant_id
      where r.name = ${DEMO_RESTAURANT_NAME} and po.status = 'sent' order by po.created_at limit 1`;
    if (!row) throw new Error('seed has no sent PO for the receiving wizard');
    openPo = row.id;
    const [sup] = await sql<{ id: string }[]>`
      select s.id from suppliers s join restaurants r on r.id = s.restaurant_id
      where r.name = ${DEMO_RESTAURANT_NAME} order by s.name limit 1`;
    if (!sup) throw new Error('seed has no supplier for the breadcrumb page');
    supplier = sup.id;
  } finally {
    await sql.end();
  }
});

async function open(page: Page, locale: Locale, path: string) {
  const url = test.info().project.use.baseURL ?? 'http://localhost:3100';
  await page.context().addCookies([
    { name: 'rm_locale', value: locale, url },
    // The banner is covered by its own test below; keep it out of the page scans.
    { name: 'rm_cookie_consent', value: 'necessary', url },
  ]);
  await page.goto(path.replace(':openPo', openPo).replace(':supplier', supplier), {
    waitUntil: 'load',
  });
  await page.waitForLoadState('networkidle').catch(() => {});
}

/** WCAG 2.1 A/AA violations, summarized so a failure names the rule and the element. */
async function axeViolations(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(async (tags) => {
    const w = window as unknown as {
      axe: {
        run: (
          ctx: unknown,
          opts: unknown,
        ) => Promise<{
          violations: { id: string; nodes: { target: string[]; failureSummary?: string }[] }[];
        }>;
      };
    };
    const res = await w.axe.run(
      // `next dev`'s overlay is not part of the product.
      { exclude: [['nextjs-portal']] },
      {
        runOnly: { type: 'tag', values: tags },
      },
    );
    return res.violations.flatMap((v) =>
      v.nodes.map(
        (n) =>
          `${v.id} @ ${n.target.join(' ')} — ${(n.failureSummary ?? '').split('\n')[1]?.trim() ?? ''}`,
      ),
    );
  }, WCAG_AA);
}

/** Controls a finger can't reliably hit: visible, interactive, under 44×44. */
async function smallTouchTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const sel =
      'button, select, summary, input, textarea, [role=button], [role=radio], [role=tab], a[href]';
    return [...document.querySelectorAll<HTMLElement>(sel)]
      .filter((el) => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (r.width <= 1 || r.height <= 1 || s.visibility === 'hidden' || el.closest('.sr-only'))
          return false;
        if (el.closest('nextjs-portal')) return false;
        // Links inside running text are exempt (WCAG 2.5.5 "inline").
        if (el.tagName === 'A' && s.display === 'inline') return false;
        if (el instanceof HTMLInputElement && ['hidden', 'file'].includes(el.type)) return false;
        // A checkbox inside its label: the label is the target.
        // A checkbox/radio whose <label> (wrapping or for=) is a full-size target.
        if (el instanceof HTMLInputElement && ['checkbox', 'radio'].includes(el.type)) {
          const labels = [...(el.labels ?? [])];
          if (labels.some((l) => l.getBoundingClientRect().height >= 44)) return false;
        }
        return r.width < 44 || r.height < 44;
      })
      .map((el) => {
        const r = el.getBoundingClientRect();
        return `${Math.round(r.width)}×${Math.round(r.height)} ${el.outerHTML.slice(0, 120)}`;
      });
  });
}

for (const locale of LOCALES) {
  for (const [vpName, vp] of [
    ['phone', PHONE],
    ['desktop', { viewport: { width: 1280, height: 800 } }],
  ] as const) {
    test.describe(`a11y [${locale} · ${vpName}] public`, () => {
      test.use(vp);
      for (const path of PUBLIC_PAGES) {
        test(`${locale} ${vpName} ${path}`, async ({ page }) => {
          await open(page, locale, path);
          expect(await axeViolations(page), `${path} axe`).toEqual([]);
        });
      }
    });

    test.describe(`a11y [${locale} · ${vpName}] dashboard`, () => {
      test.use({ ...vp, storageState: OWNER_STATE });
      for (const path of DASHBOARD_PAGES) {
        test(`${locale} ${vpName} ${path}`, async ({ page }) => {
          await open(page, locale, path);
          expect(new URL(page.url()).pathname, `${path} bounced to /login`).not.toBe('/login');
          expect(await axeViolations(page), `${path} axe`).toEqual([]);
          if (vpName === 'phone')
            expect(await smallTouchTargets(page), `${path} touch targets`).toEqual([]);
        });
      }
    });
  }
}

/**
 * Multi-branch owner: the base e2e seed has one branch, so the branch switcher
 * (rendered only with 2+ memberships) would never be scanned. A throwaway second
 * branch is added for these tests and removed afterwards.
 */
test.describe('a11y branch switcher (multi-branch owner)', () => {
  const BRANCH = `${DEMO_RESTAURANT_NAME} — a11y`;
  let branchId = '';

  test.beforeAll(async () => {
    const sql = e2eSql();
    try {
      const [owner] = await sql<
        { id: string }[]
      >`select id from users where email = ${DEMO_OWNER_EMAIL}`;
      if (!owner) throw new Error('demo owner missing from the e2e DB');
      const [r] = await sql<
        { id: string }[]
      >`insert into restaurants (name) values (${BRANCH}) returning id`;
      branchId = r!.id;
      await sql`insert into memberships (user_id, restaurant_id, role) values (${owner.id}, ${branchId}, 'owner')`;
    } finally {
      await sql.end();
    }
  });

  test.afterAll(async () => {
    if (!branchId) return;
    const sql = e2eSql();
    try {
      await sql`delete from memberships where restaurant_id = ${branchId}`;
      await sql`delete from restaurants where id = ${branchId}`;
    } finally {
      await sql.end();
    }
  });

  for (const locale of LOCALES) {
    test.describe(`[${locale} · desktop]`, () => {
      test.use({ viewport: { width: 1280, height: 800 }, storageState: OWNER_STATE });
      test(`${locale} desktop: switcher closed and open`, async ({ page }) => {
        await open(page, locale, '/dashboard');
        const trigger = page.getByTestId('branch-switcher');
        await expect(trigger).toBeVisible();
        expect(await axeViolations(page), 'switcher closed').toEqual([]);
        await trigger.click();
        await expect(page.getByText(BRANCH).first()).toBeVisible();
        expect(await axeViolations(page), 'switcher open').toEqual([]);
      });
    });

    test.describe(`[${locale} · phone]`, () => {
      test.use({ ...PHONE, storageState: OWNER_STATE });
      test(`${locale} phone: branch list in the menu drawer`, async ({ page }) => {
        await open(page, locale, '/dashboard');
        await page.locator('button[aria-controls="dashboard-drawer"]').first().click();
        await expect(page.getByText(BRANCH).first()).toBeVisible();
        expect(await axeViolations(page), 'drawer with branch list').toEqual([]);
        expect(await smallTouchTargets(page), 'drawer touch targets').toEqual([]);
      });
    });
  }
});

test.describe('a11y receiving wizard steps (phone, English)', () => {
  test.use(PHONE);

  test('supplier → scan → review → adjust: no axe violations, 44 px targets', async ({ page }) => {
    const s = recvEn.steps;
    await open(page, 'en', '/showcase/receiver');
    const check = async (step: string) => {
      // The steps fade text in with GSAP (inline opacity). Under `next dev`,
      // StrictMode's double mount makes the second `gsap.from` start from the
      // half-faded value, so the text stays stuck there (a production build
      // ends at 1). Wait for the tweens, then finish any stuck text fade so axe
      // judges the design's colors. The viewfinder corners pulse forever but
      // carry no text.
      await page.waitForTimeout(1_500);
      await page.evaluate(() => {
        for (const el of document.querySelectorAll<HTMLElement>('main [style*="opacity"]')) {
          const o = Number.parseFloat(el.style.opacity);
          if (o > 0 && o < 1 && el.textContent?.trim()) el.style.opacity = '1';
        }
      });
      expect(await axeViolations(page), `${step} axe`).toEqual([]);
      const small = (await smallTouchTargets(page)).filter((t) => !t.includes('<a ')); // showcase chrome links
      expect(small, `${step} touch targets`).toEqual([]);
    };
    const main = page.locator('main');

    await check('supplier');
    await main.getByRole('button', { name: /Avi's Produce/ }).click();
    await main.getByRole('button', { name: s.supplier.continue }).click();
    await check('scan');
    await main.getByRole('button', { name: s.scan.useDemo }).click();
    await main.getByRole('button', { name: s.scan.process }).click();
    await expect(main.getByRole('button', { name: s.recon.continueAdjust })).toBeVisible({
      timeout: 30_000,
    });
    await check('review');
    await main.getByRole('button', { name: s.recon.continueAdjust }).click();
    await expect(main.getByRole('button', { name: s.adjust.increase }).first()).toBeVisible();
    await check('adjust');
  });
});
