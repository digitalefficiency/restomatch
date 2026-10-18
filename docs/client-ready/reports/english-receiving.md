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
