# Milestone 4 — OCR Pipeline

**Status:** ✅ Complete
**Duration:** ~45 minutes
**Tests added:** 27 (24 OCR + 3 catalog top-N)
**Coverage:** providers, reconciler, pipeline, catalog integration

## Summary

Pipeline OCR דו-מנועי מומש כ-pure async function. שני providers רצים במקביל, reconciler מאחד את הפלטים שלהם עם tolerance לטעויות עיגול ועם line matching ע"י Dice coefficient על bigrams. Catalog matcher אופציונלי מצרף top-N product candidates לכל שורה. ה-pipeline מחזיר reconciled invoice, רשימת conflicts, confidence score, ו-needsHumanReview flag.

ה-worker `ocr-invoice` מחובר end-to-end — יכול לקבל job עם mock providers, להריץ pipeline, להפעיל catalog matcher עם pgvector אמיתי + pg_trgm fallback, ולכתוב חזרה ל-DB את invoice ו-invoice_lines המעודכנים.

## What was built

### Types (`packages/ocr/src/types.ts`)
- `OcrProvider` interface — `id`, `extract(image): Promise<InvoiceOcrResult>`
- `OcrPipelineResult` — primary, reconciled, providers (both raw results), confidence, needsHumanReview, conflicts
- `OcrConflict` — field path, both values, resolved value, resolvedBy enum
- `ResolvedInvoiceLine` — extends InvoiceOcrLine with `productId` + `productCandidates[]`
- `CatalogMatcherFn` type — async function from line to candidates
- `DEFAULT_REVIEW_THRESHOLD` = 0.85

### Providers (`packages/ocr/src/providers/stub.ts`)
- `StubOcrProvider` — returns a fixed fixture, used in tests
- `FixtureRoutingOcrProvider` — routes by image URL/buffer to different fixtures (for table-driven tests)
- Real Google Document AI + Claude Vision providers — deferred until credentials are provisioned. Pipeline contract is fully testable today.

### Reconciler (`packages/ocr/src/reconciler.ts`)
Field-by-field reconciliation with the following strategy:

| Scenario | Outcome |
|---|---|
| Only one provider has value | Use it, no conflict |
| Both agree (string equal, or numeric within ±₪0.10) | Use it, no conflict |
| Both have values that differ | Use Claude's (Hebrew strength), flag conflict |

Line matching uses **Dice coefficient on character bigrams** of `raw_description` — handles reordered lines and minor OCR differences. Threshold 0.4. Unmatched lines from either provider are kept and flagged as conflicts.

Confidence = `1 - (conflicts / fields_compared)`, bounded [0, 1].

### Pipeline (`packages/ocr/src/pipeline.ts`)
- Runs `documentAi.extract` + `claude.extract` in parallel via `Promise.all`
- Calls reconciler
- If `catalogMatcher` provided: enriches each line with top-N product candidates. Auto-links if best candidate confidence ≥ 0.95; otherwise leaves productId null and surfaces all candidates for human review.
- Sets `needsHumanReview = confidence < threshold || (matcherUsed && unresolvedLines)`

### Catalog top-N (M3 enhancement)
Added `matchProductTopN(db, input, limit, thresholds)` to `@restomatch/catalog`. Returns up to N candidates ordered by confidence, deduplicated. Short-circuits to alias/barcode if found (confidence 1 — no need for multiple suggestions). Used by the OCR pipeline to surface ambiguous matches.

### Worker integration (`apps/worker/src/jobs/ocrInvoice.ts`)
End-to-end functional job:
1. Receives `OcrInvoiceJob` with `restaurantId`, `invoiceId`, `imageUrl`, optional `mockProviders`
2. Builds stub providers (or throws if real providers not configured)
3. Constructs `CatalogMatcherFn` that uses `matchProductTopN` with `MockEmbeddingProvider`
4. Runs `runOcrPipeline` with full enrichment
5. Updates `invoices` row with reconciled header + `ocr_payload`, `ocr_confidence`, `status`
6. Replaces `invoice_lines` with reconciled lines, attaches `productId` when auto-linked

## Tests added

| Suite | Tests | What |
|---|---|---|
| `reconciler.test.ts` | 10 | agreement, single disagreement, Hebrew noise, missing line, reordered, rounding, empty, confidence drop, partial null, conflict structure |
| `pipeline.test.ts` — basics | 4 | reconciled output, agreement→clean, disagreement→drop, Hebrew override |
| `pipeline.test.ts` — catalog | 5 | auto-link high confidence, leave null low confidence, no matcher, force review, called-per-line |
| `pipeline.test.ts` — threshold | 2 | default, custom override |
| `pipeline.test.ts` — failures | 2 | docAi error, claude error |
| `pipeline.test.ts` — missing | 1 | docAi-only line preserved |
| **OCR total** | **24** | |
| Catalog top-N tests | 3 | ranking, alias short-circuit, dedup |
| **M4 total new** | **27** | |
| **Monorepo total** | **120** | (matching 48 + catalog 29 + ocr 24 + api 15 + db 2 + 2 E2E) |

## Decisions made autonomously

1. **Claude wins all string conflicts; Document AI wins all numeric agreements ≤ tolerance** — per BUILD-PROMPT spec ("LLM טוב יותר בעברית"). Numeric tolerance ₪0.10 absorbs rounding.
2. **Line matching by Dice coefficient (bigrams)**, threshold 0.4 — robust to reordering and minor OCR errors. Lighter than full pg_trgm setup.
3. **Auto-link product when top candidate confidence ≥ 0.95** — high enough that we're confident, low enough that alias matches (which are 1.0) and high-similarity embeddings make it through.
4. **Human review threshold = 0.85** by default — anything below this needs eyes on it. Configurable per call.
5. **`StubOcrProvider` exposed publicly** — useful for dev tooling and for testing downstream consumers of `@restomatch/ocr`.
6. **Real Google Document AI / Claude Vision clients deferred** — pipeline contract is fully testable today. Adding real providers is a 2-hour task when credentials arrive.
7. **`matchProductTopN` deduplicates by productId** — if both embedding and fuzzy match the same product, keep the highest-confidence variant.

## Open questions

1. **Should pipeline persist `productCandidates` (top-N) to DB** even when not auto-linked? Currently the worker only stores `productId` (single). For a "human review" UI, we'd want the candidates list too. Could add a `product_candidates` jsonb column in M9 polish or extend `invoice_lines`.
2. **Confidence vs review threshold semantics** — should be threshold be configurable per restaurant? Probably yes for M9; for now it's a constant.

## Demo

```bash
cd ~/Desktop/restomatch
DATABASE_URL_TEST="postgres://romkoren@localhost:5432/restomatch_test" pnpm --filter @restomatch/ocr test
# 24 OCR tests in ~300ms

DATABASE_URL_TEST="postgres://romkoren@localhost:5432/restomatch_test" pnpm --filter @restomatch/catalog test
# 29 catalog tests (incl. top-N) in ~700ms
```

Pipeline programmatic demo (after `pnpm db:seed`):
```ts
import { runOcrPipeline, StubOcrProvider } from '@restomatch/ocr';
import { AGREEMENT_PERFECT } from '@restomatch/ocr/dist/__tests__/fixtures'; // or inline

const result = await runOcrPipeline('mock-image-url', {
  documentAi: new StubOcrProvider('document_ai', AGREEMENT_PERFECT.docAi),
  claude: new StubOcrProvider('claude_vision', AGREEMENT_PERFECT.claude),
});
console.log(result.confidence);   // 1
console.log(result.conflicts);    // []
console.log(result.reconciled.lines);
```

## Up next — Milestone 5: MarketMan Adapter

מימוש adapter ראשון מול MarketMan API. כעת יש לנו matcher + OCR — נשאר להזין POs מהפלטפורמה. דרישות:
- HTTP client עם retry/backoff
- 5+ endpoints (listOrders, listSuppliers, listProducts, getOrder, listDeliveriesScheduled)
- 12+ tests עם nock/msw
- sync worker שמפעיל את ה-adapter בקצב מתוזמן

זמן צפוי בתוכנית: שבוע. בקצב הנוכחי: ~1-2 שעות.
