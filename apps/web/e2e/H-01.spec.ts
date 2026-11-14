import { expect, test } from '@playwright/test';
import { formatIls } from '../lib/money';

/**
 * H-01 · formatIls signDisplay in real RTL layout (bbox, no screenshot baseline).
 *
 * The string is rendered inside one <bdi> in a dir="rtl" paragraph, in Heebo
 * (no font-mono). Left → right the order must be: ₪, the sign, the first digit.
 * The sign hugs the first digit (gap < 0.3 em) and is never right of the last
 * digit (the "12%+" / "+ 3.41₪" failures of hand-concatenated signs).
 */

const FONT_PX = 16;
const CASES = [3.41, -3.41, 1_234.5];

type Rect = { left: number; right: number };

test.describe('H-01 · he exceptZero sign placement', () => {
  for (const value of CASES) {
    test(`${value}`, async ({ page }) => {
      const text = formatIls(value, { locale: 'he', maximumFractionDigits: 2, signDisplay: 'exceptZero' });

      // Same origin as the app so the self-hosted Heebo resolves; no app route needed.
      await page.goto('/api/healthz');
      await page.setContent(`<!doctype html><html lang="he"><head><meta charset="utf-8"><style>
        @font-face { font-family: 'Heebo'; font-weight: 100 900;
          src: url('/fonts/heebo/heebo-hebrew-wght.woff2') format('woff2');
          unicode-range: U+0590-05FF, U+200C-2010, U+20AA; }
        @font-face { font-family: 'Heebo'; font-weight: 100 900;
          src: url('/fonts/heebo/heebo-latin-wght.woff2') format('woff2');
          unicode-range: U+0000-00FF; }
        body { font-family: 'Heebo', sans-serif; font-size: ${FONT_PX}px; margin: 40px; }
      </style></head><body><p dir="rtl" lang="he"><bdi id="m"></bdi></p></body></html>`);
      await page.locator('#m').evaluate((el, t) => {
        el.textContent = t;
      }, text);
      await page.evaluate(async () => {
        await document.fonts.load("16px 'Heebo'", '₪+0123456789');
        await document.fonts.ready;
      });
      expect(await page.evaluate(() => document.fonts.check("16px 'Heebo'", '₪+1'))).toBe(true);

      const rects = await page.locator('#m').evaluate((el) => {
        const node = el.firstChild as Text;
        const out: Record<number, { left: number; right: number }> = {};
        for (let i = 0; i < node.length; i++) {
          const r = document.createRange();
          r.setStart(node, i);
          r.setEnd(node, i + 1);
          const b = r.getClientRects()[0];
          if (b && b.width > 0) out[i] = { left: b.left, right: b.right };
        }
        return out;
      });

      const idx = (pred: (c: string) => boolean) => [...text].findIndex(pred);
      const lastIdx = (pred: (c: string) => boolean) =>
        [...text].length - 1 - [...text].reverse().findIndex(pred);
      const isDigit = (c: string) => /\d/.test(c);
      const at = (i: number): Rect => {
        const r = rects[i];
        if (!r) throw new Error(`no glyph rect for index ${i} in ${JSON.stringify(text)}`);
        return r;
      };

      const shekel = at(idx((c) => c === '₪'));
      const sign = at(idx((c) => c === '+' || c === '-'));
      const firstDigit = at(idx(isDigit));
      const lastDigit = at(lastIdx(isDigit));

      // Left → right: ₪, sign, first digit.
      expect(shekel.right).toBeLessThanOrEqual(sign.left + 0.5);
      expect(sign.right).toBeLessThanOrEqual(firstDigit.left + 0.5);
      // Sign attached to the first digit.
      expect(firstDigit.left - sign.right).toBeLessThan(0.3 * FONT_PX);
      // Never right of the last digit ("12%+").
      expect(sign.right).toBeLessThan(lastDigit.left);
    });
  }
});
