# S2 — "Receiver in English" (english-receiving)

Branch `claude/client-ready-english-receiving` → draft PR into `claude/client-ready`.

**Headline:** a Hebrew invoice is photographed, OCR'd and reconciled. In English, the receiver sees every
line as **English item name + Hebrew original underneath** (to match the paper invoice), units in English
("4 kg"), quantities and prices left-to-right, a **"Show Hebrew original"** toggle, and big touch targets.
It works offline (glossary), gets better with a key (Claude), and runs end to end on `localhost` with no
credentials.

Proof: `apps/web/scripts/e2e-english-receiving.ts` passes against the seeded tenant (see *Gate*). Phone
screenshots: `docs/client-ready/screenshots/receiving-*.png`.

## Works (verified)

- **Translation engine, `packages/translate`** (new, 63 tests, no network):
  - `GlossaryTranslator`: works offline and gives the same output every time. **2,190 entries** in 9 categories (produce, dairy,
    meat/poultry/fish, pantry/spices/oils, bakery, beverages, disposables/cleaning, modifiers with
    gender/number forms, packaging). It normalizes ״/"/”/'' and ׳/'/’, niqqud and maqaf, matches whole phrases
    before single words, moves Hebrew post-noun adjectives in front of the noun ("חזה עוף טרי" → "Fresh chicken breast"),
    reverses construct state ("מיץ תפוזים" → "Orange juice") and renders "ארגז עגבניות" as "Case of tomatoes".
    It handles the ו‑prefix ("מלח ופלפל" → "Salt and pepper") and keeps numbers, %, sizes and Latin brand text
    (`%3` → `3%`, `2.5ק״ג` → `2.5 kg`). **If any Hebrew word is unknown it returns null**, so a name is never half-translated.
  - Unit map (`@restomatch/translate/units`, safe to import client-side): ק״ג/קג/ק.ג→kg, גר׳→g, ל׳/ליטר→L,
    מ״ל→ml, יח׳→unit, ארגז→case, קרטון→carton, מארז→pack, שק→sack, בקבוק→bottle, פחית→can, צנצנת→jar,
    דלי→bucket, תבנית→tray, and more.
  - `ClaudeTranslator`: sends one batched request (≤80 names), returns strict JSON via `output_config.format`
    (json_schema), validates the response with zod, has a 20 s timeout and 1 retry, and treats a refusal as an error.
    The model is `claude-haiku-5-5` (fast, cheap, as the brief asked); `TRANSLATE_CLAUDE_MODEL` overrides it.
  - `CompositeTranslator`: tries the glossary first and sends only the misses to Claude in one call. Results are
    cached per instance. It **never throws**: if Claude fails, the name stays in Hebrew.
  - Coverage check: **all 50 distinct names** in the seeded demo DB translate from the glossary alone (100%).
- **OCR**: Claude Vision now returns `rawDescriptionEn` per line in the **same call** (zero extra spend). The
  reconciler carries it through, and the worker saves it to `invoice_lines.raw_description_en`. After OCR the
  worker fills any missing English plus the linked `products.name_en`; this is best-effort and never fails the job.
- **`receiving.ensureEnglish({ poId?, invoiceId? })`**: a `memberProcedure` that is idempotent (only NULL
  columns, and every UPDATE re-checks `IS NULL`) and tenant-guarded (PO, invoice and products are re-verified
  against the session restaurant; foreign ids get NOT_FOUND). It fills `po_lines` / `invoice_lines` /
  `products` English. It is called server-side when the PO page / invoice page renders in English
  (glossary is instant; capped at 4 s), and client-side after OCR. It has a COVERAGE entry plus 2 real attack tests.
- **Read APIs** return English: `getPo` (line `rawDescriptionEn`, `productNameEn`, `supplierNameEn`),
  `getReceipt` (`productNameEn`), `getInvoice` (line `rawDescriptionEn`/`productNameEn`, `supplierName(En)`),
  and `todayExpectations` (`supplierNameEn`).
- **Catalog backfill**: `apps/worker/scripts/translate-catalog.ts <restaurantId> | --all [--dry-run]`. Run on the
  dev DB: 50/50 products translatable.
- **UI**, translated in he + en through the `receiving` / `invoices` / `scans` namespaces:
  - receiving inbox
  - wizard
  - all shared steps (supplier, scan, processing, reconciliation, adjust, confirmed)
  - invoice correction
  - `/scans/[id]`
  - showcase receiver: has a locale switcher, and its mock data includes English names
  - loading state

  On phones, reconciliation is a **card list**; the table shows only on md+. Touch targets are ≥44–48 px. The
  Hebrew UI is unchanged and still RTL (checked by the e2e and the `receiving-inbox-he.png` screenshot).
- **Local demo upload**: with no Supabase env and `NODE_ENV !== 'production'`, `scans.upload` stores files on
  local disk (`LOCAL_SCAN_DIR`, default `$TMPDIR/restomatch-scans/<restaurantId>/`). The file is served by an auth-
  and tenant-checked route, `/scans/<id>/file`. `registerInvoice` attaches a **deterministic dev OCR stub**
  built from the receipt's PO (line 1 billed ≈8% over the agreed price; line 2 billed +1 unit), passed through
  the worker's existing `mockProviders` path. Scan → OCR → reconcile → confirm works on localhost.
  It is never active in production (tested), never when a key is set, and can be turned off with `OCR_DEV_STUB=0` /
  `LOCAL_SCAN_STORAGE=0`.

## Fixed

| Issue | Problem → fix | Test |
|---|---|---|
| **M11** | Both provider slots held the same `ClaudeVision` → 2 Opus calls per scan. `runOcrPipeline` now calls a shared instance **once**. | `packages/ocr/src/__tests__/pipeline.test.ts` "M11 single provider…" |
| **M8** (race) | `registerInvoice`'s check-then-insert could double-insert under concurrency, and a re-signed URL (new token) counted as a new scan. Now it runs check + insert under a per-(restaurant, object) `pg_advisory_xact_lock`, keyed by the URL **without query string**. | `receiving-english.test.ts` "two CONCURRENT registrations…", "re-signed URL…"; e2e double-tap → 1 invoice |
| **M8** (upload) | A double-submitted upload created a 2nd object. `scans.upload` accepts `clientUploadId` and derives a deterministic scan id; an existing object is reused. The wizard also has a re-entry guard on "Process". | `local-scan-storage.test.ts` "M8: the same clientUploadId…" |
| **R5** | Inbox hid POs without a delivery date (and returned `now()` as a fake time). Now it also lists open undated POs from the last 14 days, flagged `hasDeliveryDate:false` ("No delivery date"), sorted after the dated ones. | `receiving-english.test.ts` "R5 …" |
| English pages rendered RTL | `globals.css` had `html { direction: rtl }`, which overrides `<html dir="ltr">` on **every** English page. Fixed by appending `html[dir='ltr'] { direction: ltr }`. | e2e "page is English / LTR" + screenshots |
| Showcase demo hung at 0% in dev | `Processing` had a run-once ref, so React StrictMode's cleanup cancelled the timers and the re-mount did nothing. Now `onComplete` is kept in a ref. | e2e showcase leg |
| `/scans/<invoice uuid>` 404 | The correction page linked `/scans/${invoice.id}`, but the viewer only knew `scan-…` ids. The viewer now resolves an invoice UUID (tenant-scoped `getInvoice`) and re-signs its own storage path (`<restaurantId>/…` prefix enforced), or serves the local file. | manual + type-checked |
| Stale English after a correction | Editing an invoice line's description kept the old English. Now `updateInvoiceLine` clears it. | `receiving-english.test.ts` "correcting a line description…" |
| Raw server errors shown to receivers | The wizard now maps tRPC codes to translated messages, plus an "OCR is taking longer" note on timeout. | — |
| Showcase VAT | Mock total used 17% → now 18% (M4). | — |


## Round 3 (release candidate) — fixes

| Issue | Problem → fix | Test |
|---|---|---|
| **EN-2** | Phone photos (8–12 MB) went up raw; base64 broke Vercel's 4.5 MB body limit. `scanPrep.ts` downscales in the browser (long edge 2000 px, JPEG 0.8 → ladder down to 1280/0.6) with EXIF orientation applied; JPEGs get a white background (transparent PNGs no longer turn black); older Safari falls back to `createImageBitmap(file)`. PDFs pass through; > 3 MB gets a clear "too large — photograph it or split the PDF" message, never a raw error. | `scanPrep.test.ts` (7); QA A, E |
| **EN-3** | OCR prompt allows `null`, schema did not → job threw, invoice stuck in `ocr_pending` forever. `normalizeExtraction` strips nulls and derives an absent qty/price/total from the other two; an underivable one is 0 **at confidence 0.2**, and the pipeline now sends any line < 0.5 to **human review** (never straight to matching, where a 0 would be counted as ₪ leak). A present but malformed part (`lines:"garbage"`, string totals) is left for the schema to reject — never a silently empty invoice. The worker's final failed attempt marks the invoice terminal-failed (`ocrFailed`, reason quota/extraction), shown in the wizard and on the invoice page. | `claudeVision.test.ts`, `pipeline.test.ts` "unreadable lines", `ocrFailure.test.ts`; QA H |
| **EN-4** | Wizard polled ~30 s then fell back silently. Now ~120 s with back-off (1/2/4 s), a "still reading…" state after 30 s with **Continue with the order**, a 10-min background re-poll that offers **Show results**, a **Refresh** button. A dropped request no longer ends the wait; "Show results" keeps the quantities the receiver already counted; a late refresh can't reopen a closed receipt. | `poll-errors.test.ts` (9), `adapters.test.ts` keepAdjusted; QA G |
| **EN-5** | False ₪ alarms. With no invoice / unlinked OCR lines, unpaired lines are **"Check by hand"** (neutral, ₪0) — never "missing on invoice" / "not ordered". Split invoice lines for one ordered item are folded (no qty gap + phantom "not ordered"); zero-filled lines are "check by hand". | `adapters.test.ts` (9); QA G, H, K |
| **WIZ-ERR-1** | Raw server text ("Internal server error", "Failed to fetch") reached receivers. `receivingErrorText`: coded / mapped errors are localized, offline → network message, everything else → generic. Also applied to the scan-upload error (QA F found the raw "Failed to fetch" there). | `poll-errors.test.ts`; QA F, I |
| **EN-BUDGET-1** | The Claude translation budget was charged even when the glossary covered everything. `beforeClaude` gate runs only when names really go to Claude. | `receiving-english.test.ts` budget |
| **EN-8** | Haiku: `thinking: {type:'disabled'}`; a `max_tokens` stop splits the chunk and retries (single item → explicit error). | translate (74) |
| **SB-3** | Anon browser uploads to `invoice-scans/walk-ins/`. Now `POST /api/showcase/upload` (same-origin, 20/IP/h, 4 MB, magic-byte type check) uploads with the **service role** to a server-generated `walk-ins/<date>/walk-<rand>.<ext>` and returns a **10-min signed URL**; 503 `not_configured` → showcase demo mode. `/api/showcase/ocr` only accepts walk-in signed URLs (traversal, encoded separators and tab/newline smuggling refused). **Depends on S1's migration dropping `invoice_scans_walkins_select/insert` (`…_restomatch_rls_<hash>.sql`, version 20260620072003, branch `claude/client-ready-sb3`) — until that lands, anon can still list/read walk-ins. Merge both together.** | `showcase-upload.test.ts` (8); QA J; curl: cross-origin → 403, no storage → 503 |
| **77a9ec3** | Verified, no change: direct signing only for `scan-<base36>-<hex>` ids under the caller's `<restaurantId>/`; missing objects fail; retries skip insert. | read-through |
| **S7 trip-wires** | (1) order-only review said "OCR confidence 100%" → now "Receiving against the order — no invoice read yet"; 11 false "missing" → "check by hand". (2) summary "0 matched" → counts hand-checked lines ("0 matched, 11 checked by hand"). (3) "Step 2 of 5" with 4 bars → 5 bars matching the eyebrow. (4) cookie banner over the CTA: the wizard's sticky "Close receipt" is unobstructed, but **before consent the banner covers "Use a demo invoice" at 390 px** — S6's global fix. | `adapters.test.ts`; QA K |
| Wizard (S7 ask) | No `startReceipt` on page view (a receipt opens on the first real action). | PR #30 |

## Verification (2 layers)

**Layer 1 — full gate** (head before the S7 trip-wire commit; web re-run after it):

```
pnpm test (turbo, serial, Postgres 16 + pgvector, migrated)  → 13/13 tasks, 1126 passed, 1 skipped
  translate 74 · crypto 12 · billing 5 · db 59 · procurement 17 · ocr 50 · matching 86
  charts 33 · catalog 50 · api 504 · worker 14 (+1 skipped) · web 222
apps/web vitest (after 44ceaef)                               → 222 passed
apps/web tsc --noEmit                                         → 0 errors
eslint app/dashboard/receiving app/showcase/receiver app/api/showcase lib/supabase → clean
```

**Layer 2 — production build + click-through + independent refuter**

- `pnpm build` (production) → success (only the known bullmq "critical dependency" warning).
- `next start` (NODE_ENV=production; placeholder RESEND/EMAIL_FROM/service-role values only to satisfy the
  prod env guard locally — no Supabase URL, so no storage, nothing sent). Playwright, 390 px, English:
  **J** public showcase (real 11 MB photo → endpoint answers `not_configured` → demo mode → English review) PASS;
  **K** receiver, no cookie consent, demo invoice → order-only review → adjust → close: all 4 S7 items checked
  (11 checks) PASS. `docs/client-ready/qa/receiving-qa-prod.json`, screenshots `qa-J-*`, `qa-K-*`.
  curl: `/api/showcase/upload` cross-origin → 403 `origin_not_allowed`; no storage → 503 `not_configured`.
- The upload → OCR → English path needs the worker + dev OCR stub, which production disables **by design**
  (never a stub or local storage in prod), so it is verified on the dev server (QA below).
- **Refuter** (one independent subagent, read + targeted vitest only). It refuted 3 claims and raised 4
  should-fixes; all fixed in `324442e` with tests:
  1. *blocker* zero-filled OCR line went straight to matching (₪ invented) → line-confidence review gate.
  2. malformed OCR JSON became an empty "matched" invoice → now rejected.
  3. *blocker* split invoice lines / zero-filled lines → false ₪ on review → folded / "check by hand".
  4. one dropped poll request ended the wait; background watch had no catch → poll tolerates blips.
  5. "Show results" discarded counted quantities; refresh could reopen a closed receipt → kept / guarded.
  6. *SB-3 exposure* stays open until S1's policy-drop migration merges (documented above; human-authored).
  7. `isShowcaseScanUrl` accepted `.\t./` (URL parser strips tabs) → whitespace/control refused + parsed-path check.
  Held: EN-2 (nits fixed: white fill, Safari fallback), EN-BUDGET-1, EN-8, WIZ-ERR-1, i18n parity.
  Not fixed (noted): rate limit is per-instance in memory without Redis (fails open); origin check trusts
  `Host` (stops browsers only); a stalled/hung OCR job with no catch path still stays `ocr_pending`
  (the wizard's 120 s + background re-poll + Refresh cover the UI side).

## QA

Script: `apps/web/scripts/qa-receiving.ts` (Playwright, real login per role, fixtures generated with sharp:
12 MP EXIF-rotated 11 MB JPEG, small PNG, small PDF, 4.2 MB PDF). Results: `docs/client-ready/qa/*.json`,
screenshots `docs/client-ready/screenshots/qa-*.png`.

| # | Scenario | Result |
|---|---|---|
| A | receiver · en · 390 px — 11 MB photo (downscaled ≤ 3 MB), double-tap Process, English review, double-tap Close | ran on dev; failed only on a fixture assumption (seed now has 1 of the 4 hard-coded products → 1-line PO); fixture fixed (tops up to 4 lines) |
| B | manager · he · desktop — PDF upload, Hebrew RTL review, adjust, confirm | **PASS** (dev) |
| C | owner · en + he — invoice page after receiving | depends on A; dev first-compile timeout |
| D | receiver · en — retake after review + two photos before processing | **PASS** (dev) |
| E | receiver · en — 4.2 MB PDF refused with a clear message, no upload | **PASS** (dev) |
| F | receiver · en — offline upload | **found a bug**: React Query paused the upload while offline → "Uploading…" spun forever. Fixed (`networkMode: 'always'` → network message + Retake), `346eb1d`. Earlier run also found raw "Failed to fetch" → fixed `c8b5a62` |
| G | receiver · en — slow OCR: still-reading → continue with order → background result → Show results | **PASS** (dev) |
| H | receiver · en — OCR failure notice, receiving continues against the order, no false alarms | **PASS** (dev) |
| I | chef · en — no receiving rights | chef is redirected away from the wizard (no raw error); scenario updated to assert that |
| J | public showcase · en · 390 px — real photo without storage → demo mode → English review | **PASS** (prod build) |
| K | receiver · en · 390 px · no consent — demo invoice → order-only review → adjust → close (S7's 4 items) | **PASS** (prod build, 11 checks) |

Re-running A/C/F/I after the fixes and the merge of `claude/client-ready@5450844` was **not done** — the
account hit its usage limit and the orchestrator asked for the minimum (tsc + tests + build + one prod check).
Dev-server note: on this 4-core box `next dev` compiles a dashboard route in 1–6 min, which caused the
remaining timeouts; production (`next start`) pages respond in < 1 s.


## Still broken / not done

- **Supplier names in English**: `suppliers.name_en` is displayed when present but is never auto-filled.
  Supplier names are proper nouns; transliteration needs Claude or a human. Proposal: a settings field (S4/S5).
- Without `ANTHROPIC_API_KEY`, names outside the glossary stay Hebrew (by design; the UI shows Hebrew only).
  A one-line "No translation" hint is in the namespace but not rendered.
- The worker only produces English for the *invoice* lines it OCRs. PO lines get English the first time
  someone opens the PO in English, or via `translate-catalog`/`ensureEnglish`.
- The e2e lives in `apps/web/scripts/` (the `e2e/` suite is S7's) and runs against a running dev server +
  worker, not in CI. Proposal for S7: adopt it into `e2e/`.
- The real Claude path (translation + Vision English) is unit-tested with mocks only (no key in the sandbox).

## Feature & improvement proposals (value / effort)

1. **Per-member language default** (`memberships.preferred_locale`, migration 0028) → auto-English for a
   receiver's login. High / S (S4 owns team settings).
2. **Speak the item name** (Web Speech API, English/Thai/Arabic voices) next to each line. High for low-literacy
   receivers / S.
3. More target languages (Russian, Arabic, Tigrinya, Thai are common in Israeli kitchens): the glossary is
   per-language data, and Claude takes a `targetLang`. Med / M.
4. Restaurant-specific glossary overrides, editable in the catalog (feeds `GlossaryTranslator({ extra })`). Med / S.
5. Photo of the product next to each line in the wizard (catalog image). Med / M.

## Immutable files touched

- `packages/api/src/__tests__/cross-tenant.attack.test.ts`: **added** a COVERAGE entry
  `receiving.ensureEnglish: 'attack'` and 2 attack tests. Nothing removed or weakened (additions are allowed by AGENTS.md).
- No changes to engine.ts, schema.ts, rls.ts, approvals, cron.ts, outbox.ts, leads.ts, plans.ts or workflows.
  No migration was needed (0028 columns used as-is). The leak-canary is unaffected.

## Shared / out-of-boundary files touched (minimal, please review)

- `apps/web/app/globals.css` (S6): appended the 4-line `html[dir='ltr']` fix above. It blocks all English UI.
- `apps/web/next.config.ts` (S7): added `@restomatch/translate` to `transpilePackages`.
- `apps/web/package.json`, `apps/worker/package.json`, `packages/api/package.json`, `pnpm-lock.yaml`:
  dependency on the new `@restomatch/translate`.
- `packages/api/src/index.ts`: exports (`fillEnglishNames`, `fillCatalogEnglish`, dev-stub + local-scan helpers).
- New files in `packages/api/src/receiving/` (english.ts, devOcrStub.ts) and `packages/api/src/lib/localScanStorage.ts`.

## Needs another area

- **S1**: SB-3 is only closed once S1's walk-ins policy-drop migration (`claude/client-ready-sb3`) merges with this branch.
- **S6**: before cookie consent, the banner covers "Use a demo invoice" on a 390 px phone (QA K screenshot `qa-K-scan-cookie-banner-en-mobile.png`).

- **S5 (ops-ui / dashboard chrome)**: the dashboard header/nav ("קליטת סחורה", "סקירה", search placeholder,
  "התנתק") is still Hebrew in English. Visible in every English screenshot.
- **S4 (auth)**: `apps/web/lib/__tests__/totp.test.ts` "rejects a tampered ciphertext" is **flaky** (~1 in 10).
  Flipping the last base64 char can land on padding/unused bits, so the decoded ciphertext is unchanged and
  nothing throws. Flip a middle byte of the decoded buffer instead.
- **S3 / S5**: a receiver loading `/dashboard` hits `TRPCError: Required role: owner, got: receiver` (seen in
  the dev log). Some owner-only query runs for every role.
- **S7**: adopt `apps/web/scripts/e2e-english-receiving.ts` into the Playwright suite. The pinned Playwright expects
  `chromium_headless_shell-1223`, but the image has 1194 (the script takes `PW_CHROMIUM_PATH`).
- **S1**: optionally run `translate-catalog --all` in the demo seed so English is warm before the first click.

## Gate

```
packages/translate   npx vitest run                       → 63 passed
packages/ocr         npx vitest run                       → 44 passed
packages/api         vitest receiving-english, local-scan-storage, receiving, cross-tenant.attack
                                                          → 14 + 8 + 17 + 82 passed
tsc --noEmit: packages/{ocr,translate,api}, apps/worker, apps/web → 0 errors
apps/web             npx vitest run                       → all green except the flaky S4 totp test (passes on re-run)
e2e (dev server + worker, seeded DB):
  PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm exec tsx scripts/e2e-english-receiving.ts → PASS (14 checks)
DATABASE_URL_TEST=… pnpm test (full)                   → 13/13 turbo tasks green, 853 tests passed
                     (packages/api alone: 35 files / 410 tests)
cd apps/web && set -a && . ./.env.local && set +a && pnpm build → success
Note: an earlier full run hit "too many clients" because my local dev server + worker held 75 idle
connections to restomatch_dev; after stopping them the suite is green. Stop dev processes before `pnpm test`.
```
