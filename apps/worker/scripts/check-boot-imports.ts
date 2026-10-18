/**
 * Boot-import smoke (plan v2 T4): load the worker's whole static import graph
 * through Node's NATIVE ESM loader (tsx), exactly as `pnpm start` does — no
 * vitest/Vite transform in between. Catches CJS-interop breakage such as a named
 * import from a CommonJS-only package (exceljs, 2026-09-08), which vitest hides.
 *
 *   pnpm --filter @restomatch/worker exec tsx scripts/check-boot-imports.ts
 */
const mods = ['@restomatch/db', '@restomatch/api', '@restomatch/ocr', '@restomatch/procurement', '@restomatch/queue', '@restomatch/catalog', '@restomatch/matching', '@restomatch/charts'];
for (const m of mods) {
  await import(m);
}
console.log(`[check-boot-imports] ok: ${mods.length} packages import cleanly under the native ESM loader`);
