import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { OWNER_STATE } from './env';

/**
 * G-12b · Ask facts carry their period (owner, offline mode — no API key in e2e).
 *
 *   - "מה השתנה בדליפה החודש?" answers like for like and NAMES the span it
 *     compared ("לעומת 1–25 בספט׳"), never "בחודש שעבר" / "last month";
 *   - the neutral chip text (no presupposed rise);
 *   - axe (WCAG 2.2 AA + best practice): 0 critical/serious, he + en;
 *   - DoD-1 screenshots: he 390 / he 1440 / en 1440.
 *
 * The e2e server runs on the real clock, so the expected span is derived from
 * today in the demo restaurant's zone (Asia/Jerusalem) — the same rule as
 * `alignedWindows` (the same days of last month, clamped to its length).
 */
test.use({ storageState: OWNER_STATE });

const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '__screenshots__', 'G-12');
const HE = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];
const EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function prevSpan(locale: 'he' | 'en'): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const pm = m === 1 ? 12 : m - 1;
  const py = m === 1 ? y - 1 : y;
  const through = Math.min(d, new Date(Date.UTC(py, pm, 0)).getUTCDate());
  const days = through === 1 ? '1' : `1–${through}`;
  return locale === 'he' ? `${days} ב${HE[pm - 1]}` : `${EN[pm - 1]} ${days}`;
}

async function setLocale(page: Page, locale: 'he' | 'en') {
  const url = test.info().project.use.baseURL ?? 'http://localhost:3100';
  await page.context().addCookies([
    { name: 'rm_locale', value: locale, url },
    { name: 'rm_cookie_consent', value: 'necessary', url },
  ]);
}

async function axeSerious(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(async () => {
    const w = window as unknown as {
      axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; impact: string; nodes: { target: string[] }[] }[] }> };
    };
    const res = await w.axe.run(
      { exclude: [['nextjs-portal'], ['[data-testid="worker-status"]']] },
      { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } },
    );
    return res.violations
      .filter((v) => v.impact === 'critical' || v.impact === 'serious')
      .map((v) => `${v.id} @ ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  });
}

async function askLeakChange(page: Page): Promise<string> {
  await page.goto('/dashboard/ask', { waitUntil: 'load' });
  await page.getByTestId('ask-suggestion-leakChange').click();
  const answer = page.getByTestId('ask-answer').last();
  await expect(answer).toBeVisible({ timeout: 30_000 });
  // The card first shows the "checking…" placeholder; wait for the real answer.
  await expect(answer).not.toContainText(/בודק בנתונים|Checking your data/, { timeout: 60_000 });
  // Strip the word joiners that keep a span's digits on one line.
  return (await answer.innerText()).replace(/\u2060/g, '').replace(/\s+/g, ' ');
}

for (const [locale, width] of [
  ['he', 390],
  ['he', 1440],
  ['en', 1440],
] as const) {
  test(`${locale} ${width}: the leak change names the span it compared, axe clean`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await setLocale(page, locale);
    const text = await askLeakChange(page);
    if (locale === 'he') {
      await expect(page.getByTestId('ask-suggestion-leakChange')).toHaveText('מה השתנה בדליפה החודש?');
      expect(text).toContain(`לעומת ${prevSpan('he')}`);
      expect(text).not.toMatch(/חודש (ש)?קודם|בחודש שעבר/);
    } else {
      await expect(page.getByTestId('ask-suggestion-leakChange')).toHaveText('What changed in the leak this month?');
      expect(text).toContain(`vs ${prevSpan('en')}`);
      expect(text).not.toMatch(/last month/i);
    }
    expect(text).not.toMatch(/1\.5\s*%|יעד|target/i);
    expect(await axeSerious(page)).toEqual([]);
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, `ask-${locale}-${width}.png`), fullPage: true });
  });
}
