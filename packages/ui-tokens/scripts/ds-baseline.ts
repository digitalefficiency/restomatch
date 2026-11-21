// Rewrites packages/ui-tokens/ds-baseline.json from the current apps/web source.
// Run when phase 1 merges (DS2-SPEC §5.6) and whenever a codemod lowers a count.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { countMetrics } from '../src/ratchet/metrics';

const web = fileURLToPath(new URL('../../../apps/web', import.meta.url));
const out = fileURLToPath(new URL('../ds-baseline.json', import.meta.url));
writeFileSync(out, JSON.stringify(countMetrics(web), null, 2) + '\n');
console.log(`[ui-tokens] wrote ${out}`);
