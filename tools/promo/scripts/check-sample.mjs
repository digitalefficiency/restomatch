// Pins copy.ts SAMPLE to the site's ONE sample month (apps/web/app/(marketing)/_components/sampleMonth.ts).
// Uses the file in this checkout when it exists, else the copy on W3-06's branch (git show), else skips.
//   node --experimental-strip-types scripts/check-sample.mjs
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const rel = 'apps/web/app/(marketing)/_components/sampleMonth.ts';
let file = resolve(here, '../../..', rel);
if (!existsSync(file)) {
  try {
    const src = execFileSync('git', ['show', `origin/claude/ux-w3-06-marketing:${rel}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    file = join(mkdtempSync(join(tmpdir(), 'sample-')), 'sampleMonth.ts');
    writeFileSync(file, src);
  } catch {
    console.log('SKIP  sampleMonth.ts not in this checkout or on origin/claude/ux-w3-06-marketing');
    process.exit(0);
  }
}
const m = await import(pathToFileURL(file).href);
const { SAMPLE, FILM, kegGap, risePct } = await import(pathToFileURL(resolve(here, '../src/sample.ts')).href);
const decide = m.SAMPLE_NEEDS.find((n) => n.key === 'decide');
const credit = m.SAMPLE_NEEDS.find((n) => n.key === 'credit');
const pairs = [
  ['purchasing', SAMPLE.purchasing, m.SAMPLE_PURCHASING_ILS],
  ['leakPct', SAMPLE.leakPct, m.SAMPLE_LEAK_PCT],
  ['leak', SAMPLE.leak, m.SAMPLE_LEAK_ILS],
  ['unpaid', SAMPLE.unpaid, m.SAMPLE_UNPAID_ILS],
  ['paid', SAMPLE.paid, m.SAMPLE_PAID_ILS],
  ['checked', SAMPLE.checked, m.SAMPLE_INVOICES_CHECKED],
  ['withGap', SAMPLE.withGap, m.SAMPLE_INVOICES_WITH_GAP],
  ['decide.amount', SAMPLE.decide.amount, decide.amountIls],
  ['decide.count', SAMPLE.decide.count, decide.count],
  ['credit.amount', SAMPLE.credit.amount, credit.amountIls],
  ['credit.count', SAMPLE.credit.count, credit.count],
  ['goodNews', SAMPLE.goodNews, m.SAMPLE_GOOD_NEWS_ILS],
];
// the example is pinned, never skipped: a missing example on the site is a FAIL
pairs.push(['decide.example.amount', SAMPLE.decide.example.amount, decide.example?.amountIls]);
pairs.push(['decide.example.he', SAMPLE.decide.example.he, decide.example?.label?.he]);
pairs.push(['decide.example.en', SAMPLE.decide.example.en, decide.example?.label?.en]);
// the film's own breakdown reconciles to the sample month (integer agorot)
const ag = (n) => Math.round(n * 100);
pairs.push(['FILM keg (latest − usual) × qty', ag(kegGap()), ag(SAMPLE.decide.example.amount)]);
pairs.push(['FILM keg < decide.amount', kegGap() < SAMPLE.decide.amount, true]);
pairs.push(['FILM Σ credits', FILM.credits.reduce((a, b) => a + ag(b), 0), ag(SAMPLE.credit.amount)]);
pairs.push(['FILM credits.length', FILM.credits.length, SAMPLE.credit.count]);
pairs.push(['FILM rises all > 0', FILM.rises.every((r) => r.latest > r.usual), true]);
pairs.push(['FILM keg rise %', risePct(FILM.keg.usual, FILM.keg.latest), '+10.1%']);
pairs.push(['FILM delivery short > 0', FILM.delivery.received < FILM.delivery.ordered, true]);
pairs.push(['leak = purchasing × pct', ag(SAMPLE.purchasing * SAMPLE.leakPct / 100), ag(SAMPLE.leak)]);
pairs.push(['unpaid + paid = leak', ag(SAMPLE.unpaid + SAMPLE.paid), ag(SAMPLE.leak)]);
pairs.push(['unpaid − decide = goodNews', ag(SAMPLE.unpaid - SAMPLE.decide.amount), ag(SAMPLE.goodNews)]);
let bad = 0;
for (const [k, a, b] of pairs) {
  const ok = a === b;
  if (!ok) bad++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  SAMPLE.${k} ${JSON.stringify(a)} ${ok ? '==' : '!='} sampleMonth ${JSON.stringify(b)}`);
}
console.log(bad ? `sample month: ${bad} mismatch(es)` : `sample month: copy.ts SAMPLE == ${rel}`);
process.exit(bad ? 1 : 0);
