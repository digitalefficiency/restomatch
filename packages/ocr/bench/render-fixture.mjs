// Renders invoice-1.html → invoice-1.png (deterministic viewport, 1x).
// Run from the repo root: node packages/ocr/bench/render-fixture.mjs
// (resolves Playwright from apps/web; set PW_CHROMIUM_PATH to use a local Chromium).
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '../../../apps/web/package.json'));
const { chromium } = require('@playwright/test');
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 794, height: 760 }, deviceScaleFactor: 1 });
await page.goto(`file://${join(here, 'invoice-1.html')}`);
await page.screenshot({ path: join(here, 'invoice-1.png'), fullPage: true });
await browser.close();
console.log('wrote', join(here, 'invoice-1.png'));
