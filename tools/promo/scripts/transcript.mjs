// Writes the film's text alternative (src/transcript.ts, built from COPY + SAMPLE) for the site's dialog.
//   node scripts/transcript.mjs          → writes the JSON
//   node scripts/transcript.mjs --check  → exit 1 if the JSON is stale
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild'; // ships with Remotion's bundler
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../../../apps/web/app/(marketing)/_components/promoTranscript.json');
const bundled = join(mkdtempSync(join(tmpdir(), 'transcript-')), 'transcript.mjs');
await build({ entryPoints: [resolve(here, '../src/transcript.ts')], bundle: true, format: 'esm', platform: 'node', outfile: bundled, logLevel: 'error' });
const { transcript } = await import(pathToFileURL(bundled).href);
const json = JSON.stringify({ he: transcript('he'), en: transcript('en') }, null, 2) + '\n';
if (process.argv.includes('--check')) {
  let cur = '';
  try { cur = readFileSync(out, 'utf8'); } catch {}
  if (cur !== json) { console.log('FAIL  promoTranscript.json is stale — run scripts/transcript.mjs'); process.exit(1); }
  console.log('PASS  promoTranscript.json == transcript(COPY, SAMPLE)');
} else {
  writeFileSync(out, json);
  console.log('✓', out);
}
