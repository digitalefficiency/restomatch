// Rewrites the generated token block of apps/web/app/globals.css (between the
// @tokens:start / @tokens:end markers) from the token source. Run after editing src/.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { withTokenBlock } from '../src/build';

const file = fileURLToPath(new URL('../../../apps/web/app/globals.css', import.meta.url));
writeFileSync(file, withTokenBlock(readFileSync(file, 'utf8')));
console.log(`[ui-tokens] updated the token block in ${file}`);
