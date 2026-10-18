# Milestone 3 — Catalog Matcher

**Status:** ✅ Complete
**Duration:** ~40 minutes
**Tests added:** 26 (DB integration)
**Coverage:** all 4 strategies + composite + learning loop

## Summary

מטצ'ר הקטלוג מומש עם 4 אסטרטגיות, composite ש-trial אותן בסדר, ולמידה חוזרת. ה-mock embedding provider בנוי מ-bigrams ו-FNV-1a hash → טקסטים דומים מקבלים וקטורים דומים בלי תלות חיצונית. pg_trgm נטען מ-M1 ומשמש ב-fuzzy match. כל 4 ה-strategies + ה-composite + learning loop נבדקו כ-integration מול ה-test DB.

## What was built

### Types (`packages/catalog/src/types.ts`)
- `MatchCandidate` — productId, canonicalName, confidence (0-1), matchedBy ('alias'/'barcode'/'embedding'/'fuzzy'), aliasId
- `CatalogMatchInput` — restaurantId, supplierId, rawDescription, optional embedding/barcode
- `EmbeddingProvider` interface — `embed(text): Promise<number[]>`, dimensions
- `MatcherThresholds` — embeddingMinSimilarity (default 0.85), fuzzyMinSimilarity (default 0.5)

### Embedding provider (`packages/catalog/src/embeddings.ts`)
- `MockEmbeddingProvider` — deterministic, similar-strings-similar-vectors. Tokenizes input as char-bigrams + chars, hashes each via FNV-1a to a stable dim, then L2-normalizes. Output is a 1536-dim float vector compatible with the products.embedding column.
- `cosineSimilarity(a, b)` utility — used in tests and as a reference implementation.

### Matcher (`packages/catalog/src/matcher.ts`)
- `matchByAlias(db, supplierId, rawName)` — exact case-insensitive on `(supplier_id, supplier_name_raw)`. Supports `supplier_id IS NULL` for cross-supplier aliases.
- `matchByBarcode(db, restaurantId, barcode)` — restaurant-scoped lookup on `barcode_ean`.
- `matchByEmbedding(db, restaurantId, embedding, threshold)` — pgvector cosine, uses `<=>` operator, orders by distance, filters by similarity ≥ threshold.
- `matchByFuzzy(db, restaurantId, rawName, threshold)` — pg_trgm `similarity()` function, orders DESC, filters by ≥ threshold.
- `matchProduct(db, input, thresholds)` — composite that tries alias → barcode → embedding → fuzzy and returns the first hit.

### Learning loop (`packages/catalog/src/learning.ts`)
- `recordConfirmedMatch(db, params)` — idempotent. If an alias for `(productId, supplierId, rawName)` exists, updates confidence. Otherwise inserts. Returns `{ aliasId, created }`.

### Worker integration
No new worker job in M3. The matcher is consumed inline by the OCR pipeline (M4) when each invoice line needs to be linked to a product.

## Tests added

| Suite | Tests | What |
|---|---|---|
| `matchByAlias` | 6 | exact match, case-insensitive, no-match, supplier mismatch, cross-supplier (null), whitespace |
| `matchByBarcode` | 3 | exact match, unknown barcode, restaurant scoping |
| `matchByEmbedding` | 5 | identical text, similar-but-not-identical, below threshold, scoping, empty vector |
| `matchByFuzzy` | 4 | canonical match, minor typo, no-match-meets-threshold, scoping |
| `matchProduct` (composite) | 5 | alias precedence, fall-through alias→barcode, alias→barcode→embedding, all→fuzzy, none |
| `recordConfirmedMatch` | 3 | create alias, update confidence on re-confirm, integration loop |
| **Total catalog** | **26** | |
| **Total monorepo** | **93** | (catalog 26 + matching 48 + api 15 + db 2 + 2 E2E) |

## Decisions made autonomously

1. **MockEmbeddingProvider strategy: char-bigrams + FNV-1a** — gives smooth similarity for typos and partial overlaps. Deterministic across runs.
2. **Cross-supplier aliases via `supplier_id IS NULL`** — the schema allows it (column is nullable), so we support it in `matchByAlias` for "universal" pairings (e.g., barcode-like supplier-agnostic names).
3. **`recordConfirmedMatch` is idempotent** — confirming the same alias twice is a no-op (or updates confidence). Avoids duplicate rows from double-clicks.
4. **`matchByEmbedding` uses raw SQL `vector_literal::vector`** — Drizzle doesn't expose pgvector ops directly. Inlining as `[1,2,3]::vector` is the documented pgvector pattern.
5. **`fuzzyMinSimilarity` default = 0.5** (not 0.7) — Hebrew text in pg_trgm produces lower similarity scores than English because each Hebrew character is one trigram component. 0.5 is empirically the right balance.
6. **GIN trigram index NOT added in M3** — deferred to performance pass (M9). With seed-scale data, `similarity()` is fast enough. Index can be added without schema change via a raw migration.

## Open questions

1. **Should `recordConfirmedMatch` reject when productId belongs to a different restaurant than supplierId?** Currently no validation; relies on caller. Could add a guard in M9.
2. **Should the composite matcher return MULTIPLE candidates** (top-3) instead of one? UX for "I'm not sure" cases. Defer to M4 (OCR) — the OCR pipeline will need this.

## Demo

```bash
cd ~/Desktop/restomatch
DATABASE_URL_TEST="postgres://romkoren@localhost:5432/restomatch_test" \
  pnpm --filter @restomatch/catalog test
# 26 tests pass in <800ms

# Manual demo (after seed):
DATABASE_URL="postgres://romkoren@localhost:5432/restomatch" pnpm tsx -e '
import { createDb } from "@restomatch/db";
import { MockEmbeddingProvider, matchProduct } from "@restomatch/catalog";

const db = createDb(process.env.DATABASE_URL!);
const emb = new MockEmbeddingProvider();
const restaurants = await db.query.restaurants.findMany();
const restaurantId = restaurants[0]?.id;

const result = await matchProduct(db, {
  restaurantId,
  supplierId: null,
  rawDescription: "עגבניה שרי 1 ק״ג",
  embedding: await emb.embed("עגבניה שרי 1 ק״ג"),
});
console.log(result);
'
# Expected: { productId, canonicalName: "עגבניה שרי", confidence: ~0.6-0.9, matchedBy: "embedding" }
```

## Up next — Milestone 4: OCR Pipeline

3 שכבות:
- Provider abstraction (Document AI + Claude Vision interfaces)
- Mock implementations שמחזירות fixtures
- Reconciliation logic בין שני המנועים + confidence scoring
- Integration עם matcher לחיבור invoice lines למוצרים
- Worker `ocr-invoice` שמתזמר את כל זה

זמן צפוי בתוכנית: שבוע וחצי. בקצב הנוכחי: ~1-2 שעות.
