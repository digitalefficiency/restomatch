// Checkpoint helper: registered procedures vs BASE_COVERAGE + coverage/<ID>.ts fragments.
// Source-text approximation only; the authoritative check is mergeCoverage() in the
// cross-tenant suite (see src/__tests__/coverage/README.md).
import { appRouter } from './src/index.ts';
import { readFileSync, readdirSync } from 'node:fs';
const KEY = /^\s*['"]([a-zA-Z]+\.[a-zA-Z0-9]+)['"]\s*:/gm;
const reg = Object.keys(appRouter._def.procedures).sort();
const src = readFileSync('./src/__tests__/cross-tenant.attack.test.ts','utf8');
const start = src.indexOf('const BASE_COVERAGE');
const end = src.indexOf('\n};', start);
const declared = [...src.slice(start, end).matchAll(KEY)].map(m=>m[1]);
const dir = './src/__tests__/coverage';
for (const f of readdirSync(dir).filter(f=>f.endsWith('.ts') && f!=='index.ts')) {
  declared.push(...[...readFileSync(`${dir}/${f}`,'utf8').matchAll(KEY)].map(m=>m[1]));
}
declared.sort();
const missing = reg.filter(p=>!declared.includes(p));
const stale = declared.filter(p=>!reg.includes(p));
console.log('registered:', reg.length, 'declared:', declared.length);
console.log('MISSING (registered not declared):', JSON.stringify(missing));
console.log('STALE (declared not registered):', JSON.stringify(stale));
