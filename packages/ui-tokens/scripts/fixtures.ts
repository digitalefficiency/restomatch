// Re-records the DS2 α baseline fixtures (src/__tests__/fixtures) from the token source: the v1 part
// of the generated block, and the v1 Tailwind keys (the key set the fixture already has, never a new
// one) with their current values. The same procedure rebuilds main's fixtures byte for byte from
// main's code. Run it only for a deliberate value change: the fixture diff is what the owner signs.
// `--check` writes nothing and exits 1 when the fixtures differ from the source.
// usage: pnpm --filter @restomatch/ui-tokens fixtures:record   (or fixtures:check)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ACTIVE_FACE, cssVariables, fontFaceCss, tailwindPreset, TOKENS_END, v2Css } from '../src/index';

const fixture = (name: string) => fileURLToPath(new URL(`../src/__tests__/fixtures/${name}`, import.meta.url));

const full = cssVariables();
const cut = ACTIVE_FACE !== 'heebo' ? full.indexOf(fontFaceCss()) : full.indexOf(v2Css());
if (cut < 0) throw new Error('cannot find the end of the v1 part of the generated block');
const block = `${full.slice(0, cut)}${TOKENS_END}\n`;

/** The values of `from` at exactly the keys of `shape` (the recorded v1 key set). */
function pick(shape: unknown, from: unknown, path: string): unknown {
  if (shape && typeof shape === 'object' && !Array.isArray(shape)) {
    const src = from as Record<string, unknown> | undefined;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(shape)) {
      if (!src || typeof src !== 'object' || !(k in src)) throw new Error(`a v1 key is missing from the preset: ${path}.${k}`);
      out[k] = pick((shape as Record<string, unknown>)[k], src[k], `${path}.${k}`);
    }
    return out;
  }
  return from;
}

const oldBlock = readFileSync(fixture('v1-token-block.css'), 'utf8');
const oldPreset = readFileSync(fixture('v1-preset.json'), 'utf8');
const preset = `${JSON.stringify(pick(JSON.parse(oldPreset), JSON.parse(JSON.stringify(tailwindPreset)), ''), null, 2)}\n`;

if (process.argv.includes('--check')) {
  const sameBlock = block === oldBlock;
  const samePreset = preset === oldPreset;
  console.log(`[ui-tokens] fixtures vs token source: block ${sameBlock ? 'identical' : 'DIFFERS'}, preset ${samePreset ? 'identical' : 'DIFFERS'}`);
  process.exit(sameBlock && samePreset ? 0 : 1);
}
writeFileSync(fixture('v1-token-block.css'), block);
writeFileSync(fixture('v1-preset.json'), preset);
console.log('[ui-tokens] re-recorded the DS2 α fixtures (src/__tests__/fixtures)');
