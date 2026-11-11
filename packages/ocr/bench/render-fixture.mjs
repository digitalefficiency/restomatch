// Renders every bench/invoice-*.html → invoice-*.png (deterministic viewport, 1x).
// Run from the repo root: node packages/ocr/bench/render-fixture.mjs [invoice-2 ...]
// (resolves Playwright from apps/web; set PW_CHROMIUM_PATH to use a local Chromium).
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '../../../apps/web/package.json'));
const { chromium } = require('@playwright/test');
const only = process.argv.slice(2);
const names = readdirSync(here)
  .filter((f) => /^invoice-\d+\.html$/.test(f))
  .map((f) => f.replace(/\.html$/, ''))
  .filter((n) => only.length === 0 || only.includes(n))
  .sort();
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 794, height: 760 }, deviceScaleFactor: 1 });
for (const name of names) {
  await page.goto(`file://${join(here, `${name}.html`)}`);
  await page.screenshot({ path: join(here, `${name}.png`), fullPage: true });
  console.log('wrote', join(here, `${name}.png`));
}
await browser.close();
