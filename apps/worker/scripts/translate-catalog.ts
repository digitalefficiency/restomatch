/**
 * Backfill English product names ("Receiver in English") for one restaurant's
 * catalog — every product with products.name_en IS NULL. Glossary first
 * (offline, free); Claude for the rest when ANTHROPIC_API_KEY is set (one
 * batched call per 100 names). Idempotent: re-running only touches rows that
 * are still NULL. Display-only — matching and the ₪ math never read name_en.
 *
 * Run:
 *   DATABASE_URL=... pnpm --filter @restomatch/worker exec tsx scripts/translate-catalog.ts <restaurantId>
 *   DATABASE_URL=... pnpm --filter @restomatch/worker exec tsx scripts/translate-catalog.ts --all
 *   …add --dry-run to print what would be written without writing.
 */
import { fillCatalogEnglish, receivingTranslator } from '@restomatch/api';
import { and, createDb, eq, isNull, products, restaurants } from '@restomatch/db';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const all = args.includes('--all');
  const restaurantArg = args.find((a) => !a.startsWith('--'));
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if (!all && !restaurantArg) {
    throw new Error('usage: translate-catalog.ts <restaurantId> | --all [--dry-run]');
  }

  const db = createDb(url);
  const translator = receivingTranslator();
  console.log(`[translate-catalog] translator: glossary${translator.hasClaude ? ' + Claude' : ' only (no ANTHROPIC_API_KEY)'}`);

  const targets = all
    ? await db.select({ id: restaurants.id, name: restaurants.name }).from(restaurants)
    : await db
        .select({ id: restaurants.id, name: restaurants.name })
        .from(restaurants)
        .where(eq(restaurants.id, restaurantArg!));
  if (targets.length === 0) throw new Error(`restaurant not found: ${restaurantArg}`);

  for (const r of targets) {
    if (dryRun) {
      const rows = await db
        .select({ name: products.canonicalName })
        .from(products)
        .where(and(eq(products.restaurantId, r.id), isNull(products.nameEn)));
      const translated = await translator.translateMany(rows.map((p) => p.name));
      for (const p of rows) {
        const t = translated.get(p.name.trim());
        console.log(`  ${p.name} → ${t ? `${t.en} (${t.source})` : '— (untranslated)'}`);
      }
      console.log(`[translate-catalog] ${r.name}: ${translated.size}/${rows.length} translatable (dry run)`);
      continue;
    }
    const res = await fillCatalogEnglish(db, r.id, translator);
    console.log(
      `[translate-catalog] ${r.name}: filled ${res.filled}/${res.total} products` +
        (res.untranslated ? `, ${res.untranslated} left in Hebrew` : ''),
    );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('[translate-catalog] failed:', err);
  process.exit(1);
});
