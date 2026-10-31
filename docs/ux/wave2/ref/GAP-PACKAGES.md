# Gap packages and scope amendments (deep-fix coverage)

**Date:** 2026-10-25 · **Base:** `IMPLEMENTATION-PLAN.md` (51 packages) + 47 verified P0 deep-fix items (`deep/rootcause-1..8.md`, verifier corrections applied).
**Owner-facing summaries:** `MASTER-PLAN.he.md` (calendar, order, risks, owner actions) and `DEEP-FIX.he.md` (15 bug classes).

Only 3 of the 47 P0s have their deep fix fully inside a planned package (mobile-field-01 in W1-06, auth-32 in W1-12, orders-01 in W2-06). For the other 44 the fix is split, unowned, or blocked by path ownership. This file closes that gap in two ways:

- **Part A: 16 gap packages (G-01…G-16).** They hold the shared kernels and the files no package owns. Their paths are disjoint from every same-wave package in the plan (checked against each wave's ledger; see the ledger at the end).
- **Part B: scope amendments.** Acceptance items (and a few path additions) for existing packages. **The wave-1 amendments must go to the 12 running sessions now**, before their PRs are reviewed.

All §0 ground rules of the plan apply (PR-only, retry cap 2, DoD-1…9, COVERAGE fragments from wave 2). `humanPR: true` means the agent drafts a proposal branch and a human authors, reviews and merges it.

---

## Part A: gap packages

### Wave 1 (late lane; paths owned by no W1 package)

#### G-01 · Hotfix: no "late delivery" e-mails for delivered POs; one delivery-state function
- **Owner:** ocr-procurement-engineer · **Device:** server · **Effort:** S · **humanPR:** no
- **Paths:** `apps/worker/src/jobs/{supplierDelays,dailyExpectations}.ts`; new `packages/api/src/lib/deliveryState.ts`; new `packages/api/src/__tests__/deliveryState.test.ts`; new `apps/worker/src/__tests__/{supplierDelays,dailyExpectations}.db.test.ts`.
- **Findings:** functional-flows-01 (live bug), functional-flows-06 ("late" definition).
- **Acceptance:**
  1. `deliveryState({po, latestReceipt, now, tz})` is pure and returns `upcoming | due_today | late (expected + 60 min, no GR) | in_progress (pending GR) | received (completed or partial GR; partial is terminal for the board, a backorder is a new PO) | cancelled`. `poDeliveryStateSql(rid)` is built from the existing `latestReceiptStatus` derivation (`orders.ts:312-318`). Table test in Asia/Jerusalem, including a DST weekend.
  2. `supplierDelays.ts`: OPEN = `sent | confirmed` only, AND `NOT EXISTS goods_receipts` for the PO; lookback cap of 14 days; dedupe key per PO and step (`po:<id>:late:d1|d3|d7`), so a missing PO is chased on days 1, 3 and 7 only.
  3. `dailyExpectations.ts` uses the same state; a PO with a GR never appears.
  4. DB tests: a sent PO due yesterday WITH a completed GR → 0 outbox rows (2 today); with a partial GR → 0; a platform PO synced as `closed` → 0; a never-delivered PO → rows on days 1, 3 and 7, none on day 2 or 8.
  5. `cron.ts` and `outbox.ts` untouched. Recipient routing is unchanged here (G-06, H-05).
  6. No intra-wave import: W1-05 keeps its own GR-derived late group in wave 1; W2-05, W2-08, W3-09 and H-05 adopt `deliveryState` in their waves.

#### G-02 · Legal facts now ("H-02a"): named controller, accessibility coordinator, true sub-processor list
- **Owner:** growth-pmm-engineer drafts; counsel and the owner author · **Device:** both · **Effort:** S · **humanPR:** **yes** (legal text, owner facts)
- **Paths:** `apps/web/app/(marketing)/{privacy,terms,cookies}/**`; `apps/web/lib/i18n/messages/marketing/legal.*`; new `apps/web/lib/legal/{operator,subprocessors,docs}.ts`; new `apps/web/lib/legal/__tests__/{subprocessors,legal-readiness}.test.ts`; `apps/worker/fly.toml`, `render.yaml` (remove or move to `docs/archive/`).
- **Findings:** mkt-03, mkt-02 (coordinator), a11y-01 and admin-03 (coordinator data).
- **Acceptance:**
  1. `operator.ts` (typed): controller legal name, ח״פ, address, privacy contact, accessibility coordinator {name, phone, e-mail} and the statement audit date, from owner decisions 1–2. A test fails on any placeholder in a document whose status is `approved`.
  2. `subprocessors.ts` entries `{vendor, purpose, region, dpa{status, signedAt}, evidence}`. A parity test derives evidence from outbound hosts in non-test source, `process.env` reads and dependencies across the monorepo, plus the deploy target in `apps/web/vercel.json`. It fails on entries without evidence (Upstash, Fly.io, Render) and on wired vendors without an entry (Meta WhatsApp Cloud, MarketMan, Zester, PostHog, plus the existing Anthropic and Supabase entries). Grow billing goes on the billing-activation checklist, not into the list, until it is live.
  3. `docs.ts`: `LEGAL_DOCS {version, status: draft|approved, approvedBy, effectiveDate}`. The privacy, terms and cookies pages pass `status` and `lastUpdated` to `LegalShell` (W1-12 adds the `status` prop). The draft banner and the per-clause review tag render only while `draft`. "עודכן לאחרונה" is never "—".
  4. Copy: "דוא״ל" with gershayim, never ASCII quotes, including the review tag.
  5. The draft banner stays until counsel signs. Flipping to `approved` is a separate commit by the owner or counsel.

#### G-03 · Schema batch 0: the facts the money loop is missing
- **Owner:** matching-engine-guardian + tenant-security-warden draft · **Device:** server · **Effort:** M · **humanPR:** **yes** (`schema.ts`, migrations, RLS list)
- **Paths:** `packages/db/src/schema.ts`; one new migration (next free number after `0070`) + `packages/db/drizzle/meta/` journal; `packages/db/drizzle/rls/0002_core_tenant_rls.sql` (table list); new shape tests beside the existing ones.
- **Findings:** receiving-01, receiving-02, mobile-field-03 (count truth); mobile-field-02 (idempotency); receiving-04 (walk-in); approvals-01, functional-flows-08 (decision); leaks-02, SUP-02 (basis, refs); leaks-06, functional-flows-05 (letters); functional-flows-03 (event, escalation); functional-flows-02 (skipped, phone); catalog-01 (alias provenance); functional-flows-04 (deduction record).
- **Contents** (all additive, nullable or defaulted; no existing column changes meaning):
  - `gr_lines.counted_at`, `counted_by`, `count_method` (`line|bulk_as_ordered|legacy`), `updated_at`. Backfill for lines of completed or partial receipts: `counted_at` = the receipt's completion time, `count_method = 'legacy'`.
  - `idempotency_keys (restaurant_id, key, procedure, user_id, request_hash, response jsonb, created_at; unique(restaurant_id, key))` + RLS.
  - `purchase_orders.kind` (`standard|walk_in`, default `standard`), `purchase_orders.po_number`, `goods_receipts.delivery_note_number`.
  - `discrepancies.decision` (`claim|waive|acknowledge|hold_duplicate|release_duplicate|link_po|tolerate`, nullable), `discrepancies.basis jsonb`, `discrepancies.escalated_from_role`, `escalated_by`.
  - `claim_letters (restaurant_id, supplier_id, seq_no, status draft|sent|answered|closed, channel, sent_at, reply_by, content_snapshot jsonb, version)` + `recovery_claims.letter_id` + RLS.
  - `payment_deductions (restaurant_id, invoice_id, claim_id, amount_agorot, vat_basis, created_by, created_at)` + RLS. A short-pay record, never a credit note.
  - `activity_event_type` + `'event'` (kind in `metadata.kind`); `notification_status` + `'skipped'`.
  - `product_aliases.source` (`human|exact_key|new_product|import_guess|legacy`, default `legacy`).
  - `users.phone_verified_at`.
- **Acceptance:**
  1. `check-rls` passes for every new tenant table. A shape test per column and table. Re-runnable on the lab DB. Leak canary and both attack suites green.
  2. No outbox `CHECK` here. `CHECK (target NOT LIKE 'role:%') NOT VALID` ships in H-04, after H-05 has moved every producer to `notify()`.
  3. Merged after the wave-1 code PRs. Deployed behind the second human migration gate, after the pilot's first days (≥ 10.11) and before any wave-2 code that reads the columns. Every reader has an interim until then.
  4. H-03 rebases onto it (next migration number). The PR body lists which package first writes each column.

### Wave 2 (merge right after W2-01 unless noted; paths owned by no W2 package)

#### G-04 · Match-input truth: only counted lines, no draft POs, closed POs still match
- **Owner:** matching-engine-guardian (leak-economist sign-off) · **Device:** server · **Effort:** M · **humanPR:** no (not on the immutable list; changes which invoices are matched, so the ₪ diff is signed)
- **Paths:** `packages/api/src/match/{buildMatchInput,consolidated}.ts`; new `packages/api/src/match/receiptTruth.ts`; new `packages/api/src/__tests__/{match-input-truth,consolidated-counted}.test.ts`.
- **Findings:** receiving-01, mobile-field-03, receiving-02 (autosave exposure), receiving-04, functional-flows-01 (match decoupled from delivery), functional-flows-06.
- **Acceptance:**
  1. `receiptTruth.ts` exports `closedReceiptSql` (status `completed|partial`) and `countedLineSql` (durable: `counted_at IS NOT NULL` once G-03 is deployed; interim: `qty_received > 0 OR qty_rejected > 0 OR reject_reason IS NOT NULL OR notes IS NOT NULL`), plus `PO_MATCHABLE` and `PO_PINNABLE` (both `NOT IN (draft, cancelled)`).
  2. `buildMatchInput` feeds only counted lines of closed receipts. A pending receipt with 5 of 12 lines saved changes no match, so W2-05 autosave is safe.
  3. The pinned-PO branch drops `draft` POs only (closed and received stay pinnable). A matchInvoice job pinned to a draft PO is skipped with reason `po_draft`. A receiver walk-in + scan + submit still yields UNORDERED_ARRIVAL until a manager confirms.
  4. PO discovery uses `PO_MATCHABLE` inside the window, so a platform PO synced as `closed` before its invoice still matches (the Zester case).
  5. `consolidated.ts` reads only closed receipts (not `status <> 'rejected'`). A missing GR means "not received yet" (T4 pending), never "received 0". The three delivery-note regexes move to one helper. `claimSplit` dedupes by discrepancy id.
  6. A before/after ₪ diff on the lab seed, and on a seed with a Zester-closed PO, is attached and signed by leak-economist and matching-engine-guardian. Leak canary and match-money tests green.
  7. W2-05, W2-07 and W2-11 import `receiptTruth` (Part B).

#### G-05 · Write-path kernel: guarded transitions, safe replay, domain events
- **Owner:** web-feature-engineer (tenant-security-warden; matching-engine-guardian consulted) · **Device:** server · **Effort:** L · **humanPR:** no
- **Paths:** new `packages/api/src/{lifecycle,invoices,discrepancies,events}/**`; new `packages/api/src/lib/idempotency.ts`; `packages/api/src/activity.ts`; new `packages/api/src/__tests__/{lifecycle-kernel,invoice-lifecycle,invoice-state,discrepancy-transition,idempotency,events-emit,lifecycle-predicates}.test.ts`.
- **Findings:** approvals-21, functional-flows-01, functional-flows-04, exec-desktop-02, chain-01, functional-flows-08 (from-state guards), functional-flows-03, functional-flows-05 (accept effect), mobile-field-02, receiving-02 (replay), orders-07 (replay).
- **Acceptance:**
  1. `lifecycle/kernel.ts`: `transition(tx, machine, {id, restaurantId, event, expectedFrom?, actorId, payload})` runs one guarded `UPDATE … WHERE status = ANY(from) RETURNING`. Zero rows: success if the row already sits in the target state with the same payload (replay-safe); otherwise CONFLICT naming the current state, actor and time, with no audit row. One `audit_log` row per moved entity, then `emit()`.
  2. Machines:
     - recovery: today's `RECOVERY_TRANSITIONS` re-expressed with edge metadata `{kind: forward|side|terminal|reopen, requiresReason, undoable}`; `written_off` is reopenable, only `recovered` is terminal;
     - discrepancy: from `open|escalated` only; the decision is recorded;
     - invoice: `approve_for_payment`, `mark_paid`, `unmark`, `rematch_lock`, `external_sync`.
     Batch calls take `items: [{id, expectedStatus}]`, are all-or-nothing and return per-item CONFLICT detail.
  3. Named predicates replace literal sets: `INVOICE_REMATCH_LOCKED {approved, paid}` and `INVOICE_CHECKED` (EXISTS `match_runs`, never `invoices.status = 'matched'`). They are two predicates, not one merged "settled" set. `disputed` is covered.
  4. `invoices/state.ts` composes the per-invoice state CTE that W2-09a exports from charts with `match_runs` and claims into one canonical state (`in_ocr | awaiting_count | awaiting_link | clean | flagged_open | claim_open | held_duplicate | approved | paid`). Parity test: equals the hero's pending and awaiting counts and the pay-run buckets on the lab month.
  5. `lib/idempotency.ts`: `withIdempotency(ctx, {key, procedure}, fn)` returns the recorded response for the same key and user. It uses `idempotency_keys` (G-03) and, until that is deployed, the audit row's `after.clientMutationId`.
  6. `events/**`: a typed `DomainEvent` union (`discrepancy.escalated`, `supplier.answered`, `receipt.closed_with_exceptions`, `invoice.ocr_failed`, plus every transition) and `EVENT_EFFECTS`. `emit()` runs each effect inside a savepoint (`tx.transaction`), so a failed effect never silently rolls back the decision. Effects are inserts only.
  7. `activity.ts` writes the generic `event` kind (G-03) with `metadata.kind`; the existing 6 values keep working.
  8. Guard tests: no invoice or discrepancy status literal arrays outside `*/lifecycle.ts` in packages/api (allow-list for packages/charts until G-14); every `invoice_status` and `resolution_status` value is the target of some transition.
  9. Adopters (Part B): W2-02, W2-03, W2-04, W2-05, W2-06, W2-10, W2-13, G-06, G-09; W3-09 in wave 3.

#### G-06 · Real recipients and honest delivery; the OCR-failure hand-off
- **Owner:** ocr-procurement-engineer (web-feature-engineer) · **Device:** server · **Effort:** M · **humanPR:** no (`outbox.ts`, `cron.ts` and `templates.ts` untouched)
- **Paths:** `packages/api/src/notifications/{address,recipients,notify}.ts`; `packages/api/src/reports/send.ts`; `apps/worker/src/jobs/ocrInvoice.ts`; new `packages/api/src/__tests__/notify-recipients.db.test.ts`; new `apps/worker/src/__tests__/ocrInvoice-handoff.test.ts`.
- **Findings:** functional-flows-02, functional-flows-03 (OCR failure, no owner today).
- **Acceptance:**
  1. A branded `Address` = `EmailAddress | verified E164Phone | PushSubscriptionId`. `notify(tx, {event, audience, template, vars, deepLink})` takes `audience: {userIds} | {roles} | {poSenderOf} | {decidersOf}` and resolves it at enqueue to one outbox row per (user, channel) with a dedupe key. `role:x` no longer compiles as a target, and a runtime guard rejects it.
  2. `notify` only enqueues and never calls an in-process `Notifier.send`. Rows without a provider are left to the dispatcher's honest `failed + SKIPPED_NO_PROVIDER` (or `skipped` once G-03 deploys).
  3. `reports/send.ts`: the owner audience goes through `notify()`; `monthlyReports.sentAt` comes from the dispatcher's `sent`, not from enqueue.
  4. `ocrInvoice.ts`: status writes go through G-05 invoice transitions, and OCR never writes `matched` (readers that mean "checked" use `INVOICE_CHECKED`). An OCR failure emits `invoice.ocr_failed`, which creates a T2 task and notifies the uploader and the managers.
  5. Tests: a role audience gives one row per member with a concrete address. After matchInvoice, sendMonthlyReports and an OCR failure on a test DB, new rows with `target LIKE 'role:%'` = 0, and no row is `sent` without a provider id. A `@ts-expect-error` type test on `target: 'role:manager'`.
  6. Producers elsewhere switch in their own waves (Part B: W2-04, W2-05, W2-06; H-05 for the rest).

#### G-07 · Capability model: who sees, separate from who decides
- **Owner:** web-feature-engineer (tenant-security-warden **mandatory**) · **Device:** server · **Effort:** M · **humanPR:** no
- **Paths:** `packages/api/src/lib/{roles,capabilities}.ts`; `packages/api/src/trpc.ts`; `packages/api/src/routers/activity.ts`; new `packages/api/src/__tests__/{capabilities,role-matrix,activity-scope}.test.ts`, `coverage/G-07.ts`.
- **Findings:** functional-flows-07, exec-desktop-03, ia-nav-01 (data tier, interim before H-11).
- **Acceptance:**
  1. `lib/roles.ts` separates `VISIBLE_TO` (who may read an item) from an explicit `ACT_ON` table (who may decide). An exhaustive role × requiredRole table test. `canActOn` keeps its signature for `persist.ts` carry-over but reads `ACT_ON`.
  2. `lib/capabilities.ts`: a `CAP` table of write capabilities (`order.draft` own-only below manager, `order.send`, `intake.approve`, `invoice.correct`, `discrepancy.decide`, `receipt.count`, `receipt.confirm_walk_in`) and read/field capabilities (`money.view`, `price.view`, `contract.view`). A `can(cap)` middleware in `trpc.ts` and a `redactPrices(ctx, row)` helper.
  3. `activity.feed` drops ₪ detail and money metadata for roles without `money.view` (receiver and chef by default, decision 6). COVERAGE entry in `coverage/G-07.ts`.
  4. A test enumerates `appRouter` procedures and fails on any without a declared capability. It allow-lists the public procedures of the immutable `leads.ts` and billing, and only adds to COVERAGE.
  5. Matrix snapshot:
     - the chef drafts and edits their own draft, cannot touch a manager's draft and cannot place an order;
     - the bookkeeper may approve intake and correct invoice lines;
     - the receiver may not approve intake (`cross-tenant.attack.test.ts:2269` still passes);
     - receiver/chef access to `owner.*` is unchanged here; the flip is H-11.
  6. Adopters (Part B): W2-02, W2-04, W2-05, W2-06, W2-08, W2-14.

#### G-08 · Product links with provenance: a guess never becomes certainty
- **Owner:** ocr-procurement-engineer (leak-economist) · **Device:** server · **Effort:** M · **humanPR:** no
- **Paths:** `packages/catalog/**`; `packages/ocr/src/pipeline.ts`; `packages/api/src/catalog/**`; `packages/api/src/__tests__/catalog-*.test.ts`; new `apps/worker/scripts/catalog-alias-remediation.ts`.
- **Findings:** catalog-01.
- **Acceptance:**
  1. `packages/catalog/src/linkPolicy.ts`: `decideLink(candidates, row)` → `auto | review | new`. Auto only for exact keys (SKU, barcode, an alias with human or exact provenance) or ≥ 0.95 with matching unit and pack. `commitCatalogRows`, the OCR pipeline and the import job all call it; a parity test gives the same decision for the same candidates.
  2. `recordConfirmedMatch` requires `provenance: 'human'|'exactKey'|'newProduct'` at type level, with no `'1.000'` default. Review rows never reach it.
  3. `matchByAlias` / `matchBySku` return the stored confidence and auto-trust only human or exact provenance (`product_aliases.source` once G-03 deploys; interim: 1.000 reserved for human, 0.999 for exact key or new product, guesses ≤ 0.9).
  4. Review rows keep `product_id` NULL, with top-3 suggestions computed on read, and feed `mapping.unmapped`. Accept goes through `mapping.confirm` (confidence 1, re-match).
  5. `catalog-alias-remediation.ts` is a read-only report a human runs. It lists catalog items from an import whose product predates the import with name similarity < 0.9, the aliases created with them, and draft/open POs and price alerts priced from those items. No writes; a human confirms each unlink (decision 24).
  6. Tests: `פלפל אדום חריף` against `פלפל אדום` → `product_id` NULL, no alias, 1–3 candidates; a unit mismatch goes to review even at ≥ 0.9; a type test that `recordConfirmedMatch` without provenance fails tsc.

#### G-09 · Multi-page documents on every intake path
- **Owner:** ocr-procurement-engineer · **Device:** server · **Effort:** M · **humanPR:** no
- **Paths:** `packages/api/src/ingest/**`; new `packages/api/src/documents/**`; new `packages/api/src/__tests__/{ingest-grouping,document-compose}.test.ts`.
- **Findings:** receiving-03, mobile-field-04.
- **Acceptance:**
  1. `documents/compose.ts`: `composeDocument({restaurantId, clientDocumentId, pageObjects[]})` checks every object is under `<restaurantId>/`, merges JPEG/PNG pages into one PDF with pdf-lib (other types are rejected with a named reason; clients normalise webp to JPEG), writes it at `deterministicScanId(restaurant, clientDocumentId)`, is idempotent, returns `page_count` and expires the per-page objects.
  2. `ingest/pipeline.ts`: image attachments of one message, or from one sender within N minutes (setting, default 10), become ONE candidate document composed by the same helper. The identical-sha256 dedupe stays. The candidate's invoice insert goes through G-05 transitions.
  3. A service for W2-02's inbox: `attachAsPage({invoiceId, documentId, pageIndex})` and `splitDocument`, which merge an already-split invoice and re-run OCR once.
  4. Tests: a 2-photo WhatsApp invoice → one `invoices` row, one OCR job, page-2 lines in `invoice_lines`; 3 pages → one 3-page PDF; the same `clientDocumentId` → the same object; a foreign-tenant page → NOT_FOUND.

#### G-10 · Supplier answer contract: explicit, complete, intent-checked
- **Owner:** web-feature-engineer (tenant-security-warden: public surface) · **Device:** mobile · **Effort:** S · **humanPR:** no (`rateLimit.ts` and the trpc route untouched)
- **Paths:** `packages/api/src/supplierConfirm/**`; `apps/web/lib/supplierConfirm/**`; `apps/web/app/api/supplier-confirm/**`; `apps/web/app/s/[token]/**`; `apps/web/lib/i18n/messages/supplierConfirm/**`; `packages/api/src/__tests__/supplierConfirm*.test.ts`; `apps/worker/scripts/seed-wave1-contracts-demo.ts`; new `apps/web/e2e/G-10.spec.ts`.
- **Findings:** auth-02.
- **Acceptance:**
  1. `supplierPortalSubmit` requires `intent: 'as_ordered'|'with_changes'` and an explicit entry for every PO line. A missing line → 422 INCOMPLETE_ANSWER; an `as_ordered` answer whose lines differ → 422 INTENT_MISMATCH; in `with_changes` every line needs a non-null qty. The status is still derived from the diff.
  2. The note is always carried. A replay → 409 with the recorded answer in the body (through `supplierPortalView`).
  3. One pure `buildAnswer(state)` feeds every button. The already-answered card and the 409 path render the recorded answer and its diff.
  4. `supplierConfirm/expectation.ts` exports `expectedQtyForLine(poLine, answer)` (supplier-confirmed ?? ordered) for W2-05 and H-08.
  5. Callers that relied on partial answers are updated: the demo seed, `route.test.ts` (flipped: `{lines: []}` → 422) and `supplierConfirm.test.ts`.
  6. e2e: edit 10 → 6; the primary reads "שליחת התשובה · שינוי אחד"; "as is" opens the confirm dialog; the stored row has `qtyAvailable = 6`; after a reload the done card restates the diff.

#### G-11 · Legal surface inventory and one set of legal links
- **Owner:** growth-pmm-engineer (tenant-security-warden for `publicPaths`) · **Device:** both · **Effort:** S · **humanPR:** no
- **Paths:** `apps/web/lib/legal/{registry.ts,LegalLinks.tsx}` (extends W1-12a's files); new `apps/web/lib/legal/__tests__/{registry,required-set}.test.ts`; `apps/web/app/(marketing)/_components/{MarketingShell,LegalShell,detail-sections,LeadForm}.tsx`, `seo.ts`; `apps/web/app/(marketing)/leak-check/LeakCheckForm.tsx`; `apps/web/app/{robots,sitemap}.ts`; `apps/web/app/{error,global-error}.tsx`; `apps/web/app/admin/layout.tsx`; `apps/web/lib/publicPaths.ts` + `apps/web/lib/__tests__/publicPaths.test.ts`; new `apps/web/e2e/G-11.spec.ts`.
- **Findings:** auth-32 (inventory test), a11y-01, admin-03, mkt-02.
- **Acceptance:**
  1. `registry.ts` is the single ordered list of legal pages and help links. `MARKETING_ROUTES`, `sitemap.ts` and the robots allow list derive from it. `publicPaths.ts` stays the authoritative auth allow-list and is not derived; a test asserts every registry href is public, in the sitemap and allowed by robots.
  2. A required-set test, hard-coded and independent of the registry: accessibility, privacy, terms and cookies each exist as a page, are public and are linked.
  3. One `LegalLinks` component replaces the hand-written legal links in MarketingShell, LegalShell, detail-sections, LeadForm and LeakCheckForm. Variants change layout only, never membership or order.
  4. Shells without a footer get one: `admin/layout.tsx`, `app/error.tsx`, `app/global-error.tsx`. W2-08 (dashboard), W2-02 (`/scans`) and H-02 (consent, privacy body) consume `LegalLinks` (Part B).
  5. e2e, anonymous and per role: `/`, `/pricing`, `/showcase`, `/login`, `/login/check-email`, `/reset`, `/set-password`, `/invite/accept`, `/onboarding`, `/s/<valid|expired|unknown>`, the root 404, `/dashboard`, `/dashboard/settings`, `/admin` and `/scans/<id>` each show the links in the same order, and `/accessibility` answers 200 with no redirect (WCAG 3.2.6).
  6. The statement cites ת״י 5568 at its legal level (WCAG 2.0 AA), with 2.2 AA as the target. No overlay widget.

#### G-12 · Orphaned ₪ consumers: "awaiting decision" as one function, Ask facts with their period, the frozen mobile app
- **Owner:** web-feature-engineer (leak-economist) · **Device:** both · **Effort:** M · **humanPR:** no
- **Paths:** new `packages/api/src/approvals/awaiting.ts` (`approvals/engine.ts` untouched); `packages/api/src/ask/**`; `apps/mobile/app/{owner,manager}/**`; `packages/api/src/__tests__/ask.test.ts`; new `packages/api/src/__tests__/{awaiting-decision,ask-tools-contract,ask-period}.test.ts`.
- **Findings:** approvals-08, exec-desktop-01, functional-flows-09, exec-desktop-03 (byRole), command-03 (Ask online), leaks-05 (Ask period), copy-rtl-01 (mobile and Ask homonym), leaks-18 (mobile ₪0).
- **Acceptance:**
  1. `awaitingDecision(db, ctx, {scope: 'mine'|'all', filters})` reads ALL open/escalated rows (no cursor) and returns `{count, blockers, oldestAt, ils by basis (excl/incl/vat or mixedBasis), reviewOnly {count} (routed info rows, no ₪), pendingLink {count, inclVatIls}, byRole}`. The ₪ uses the letters' rule: `claimableLines` over the charts batch `computeInvoicesLeak(db, rid, ids)` (W2-09a, no ₪ change).
  2. Consumers in other packages switch (Part B): queueSummary and myQueue scope (W2-04); home Needs-you, `nav.badges` and `tasks.mine` (W2-08); endOfDayReport ₪ and count (W2-04); the per-invoice approval e-mail uses `claimableLines(computeInvoiceLeak(id))` (W2-04); `owner.kpis` money fields only for deciders (W2-09).
  3. Ask:
     - every period tool output carries `{from, through, complete}`;
     - a `leak_change` tool returns the aligned comparison (W2-09's `computeLeakComparison`) with its span label;
     - `leak_hero` no longer says "compare months", and `recoveredIls` is described as "accepted for claim" until G-14/H-07 rename it;
     - grounding refuses a delta between a complete and an incomplete period;
     - `monthKey` takes the restaurant time zone;
     - `claimableData` uses `awaitingDecision`; offline `leakChange` uses the same function;
     - the canned prompt does not presuppose a rise.
  4. Mobile (frozen per decision 12): the money tiles read the canonical server fields with the web labels, or are replaced by "פתחו באפליקציה". No local `formatIls`, no signed SUM, no ₪0 for unknown.
  5. Tests: 120 seeded findings (info QTY_SHORT, UNORDERED_ARRIVAL, PRICE_LOWER, a DUPLICATE incl. VAT, a binding cap) → the result is independent of limit/cursor and equals Σ `claimableLines` per basis; `leak_change` exists and no tool compares without a span; at now = 25.10 the previous window is 1–25 Sep with its label.

#### G-13 · The agorot boundary both ways: `parseDecimalInput` and `moneyText` outside JSX
- **Owner:** money-format-marshal · **Device:** both · **Effort:** M · **humanPR:** **yes** (creates the agorot↔display boundary, which AGENTS.md freezes once it exists; edits the AGENTS.md ownership map)
- **Paths:** `packages/types/src/{number-input.ts,money/**,index.ts}`; `packages/api/src/reports/{bidi,money}.ts`; `apps/worker/src/lib/notifyHelpers.ts`; `packages/api/src/integrations/pos/csv.ts`; `packages/api/src/recipes/csv.ts`; `packages/api/src/__tests__/{money-format-single-source,number-input,money-text,pos-csv}.test.ts`; `AGENTS.md` (human edit, decision 23).
- **Findings:** catalog-02, design-system-01, auth-14, leaks-04 (server renderers).
- **Acceptance:**
  1. `number-input.ts` (created by W1-10) completes `parseDecimalInput(raw, kind)` for `ils` (agorot), `unitPrice` (scale 4), `qty` (milli-units) and `percent`. It returns a discriminated union, never null for a non-empty cell. It is reconciled with `integrations/pos/csv.ts parseScaled`, which then re-exports it, and the name clash with `recipes/cost.ts parseScaled` is resolved. `recipes/csv.ts` and the POS CSV adopt it here; the other parsers adopt it in Part B.
  2. `money/moneyText.ts`: an isomorphic `moneyText(agorot|value, {locale, context})` with the same precision contract as `<Money>` and FSI/PDI isolation (it never strips marks). `money/visualOrder.ts`: one visual-order helper in which ₪ follows the he-IL ICU order. `reports/bidi.ts` uses it here, `orders/document/bidi.ts` in W2-06. In he, ₪ sits left of the first digit in both PDFs.
  3. Server ₪ channels converge: `reports/money.ts` (precision by context, not 0 dp by default) and `notifyHelpers.ts` (no private `Intl`). Baked `₪${…}` strings go in Part B (W2-04, W2-13).
  4. `money-format-single-source.test.ts` gains a visual-order assertion for order-document and report output, plus a ratchet grep for `₪\$\{`, `\} ?₪`, `currency: 'ILS'` and `toLocaleString` next to ₪ across apps/** and packages/** outside the util (down to 0 by W4-01).
  5. AGENTS.md (human): money-format-marshal owns the input direction; `number-input.ts` and `money/**` join the immutability list. `formatIls()` output stays byte-identical (H-01 snapshot).

### Wave 3 (G-14 merges first in the wave; paths owned by no W3 package)

#### G-14 · One ₪ to the agora: leak ledger, money states, decision→effect table, metric registry
- **Owner:** matching-engine-guardian (leak-economist sign-off on every label) · **Device:** server · **Effort:** L · **humanPR:** **yes** (₪ definitions in packages/charts, per the ownership map)
- **Paths:** new `packages/charts/src/{leak-ledger,decisions,metrics}.ts`; `packages/charts/src/{leak-views,owner-kpis,leaks,index}.ts`; `packages/api/src/lib/claims.ts`; `packages/api/src/match/persist.ts`; `packages/api/src/contracts/overContract.ts`; `packages/api/src/routers/owner.ts`; new `packages/charts/src/__tests__/{leak-ledger,decisions,metrics,price-creep}.test.ts`; new `packages/api/src/__tests__/{decision-consequence.parity,claims-ledger}.test.ts`, `coverage/G-14.ts`.
- **Findings:** leaks-03, leaks-04 (per-line cap allocation), leaks-06 and functional-flows-05 (structural dedupe), approvals-01, functional-flows-08, functional-flows-04, approvals-21 (caught before payment), exec-desktop-01, copy-rtl-01, functional-flows-09.
- **Acceptance:**
  1. `leak-ledger.ts`: one row per counting discrepancy with `capped_agorot`, `invoice_paid`, `claim_id`, `claim_status`, `credited_agorot` and one `money_state` (`undecided · to_offset · to_send · requested · disputed · credited · recovered · waived`). Decided and claimed rows read their persisted amount. One allocator (order: `created_at, id`, the same as `syncClaims` and `reports/monthly cappedIssues`) gives only the remaining cap to undecided rows, at decision time.
  2. `decisions.ts`: `DECISION_RULES[type] {allowed, primary, toStatus, effect}`, including the system decision `tolerate` for auto-approve and a defined meaning for `resolved`. `effectOf(type, status|decision)` is the only status→₪ mapping. LEAK_FILTER, owner-kpis savings, the `lib/claims` claimable sets, `persist.ts` (`matchActivitySummary`; auto-approve writes `tolerate`, also persisting the engine `basis` from G-15) and `contracts/overContract.ts` read it.
  3. "Caught before payment" = leak whose decision or detection precedes `paid_at` (H-03), not `status <> 'paid'`. `lib/claims` keeps the claims of paid invoices (decision 9) and puts undecided lines on letters only if decision 18 says so (default: never).
  4. `metrics.ts`: a `METRICS` registry (`leak.month`, `priceCreep.30d`, `supplierLeak.90d`, `atRisk.pending`, `claims.claimed|outstanding|returned`, `caught.open`), each with `{window, basis, procedure, scope, drill}`. Every ₪ procedure returns `{metric, agorot}` additively.
  5. `owner.priceCreep` with a server total over all qualifying rows plus a `supplierId` filter. `owner.leaks` stays as an alias (COVERAGE add-only, nothing deleted). `monthExcessIls` leaves the row or is registered as its own projection metric.
  6. owner-kpis: month start in the restaurant time zone, |Δ| semantics through the registry; its money fields are marked deprecated for the mobile app.
  7. Tests:
     - partition parity: Σ states = hero leak agorot on seeded months and on the canary fixtures (read-only use);
     - cross-surface parity: report claimed = proof = Σ letter lines = recovery funnel;
     - a discrepancy is on at most one letter line;
     - `recovery_claims.amount_agorot` equals the ledger for decided rows over time;
     - decision-consequence parity over every type × decision and every reader;
     - the price-creep total is independent of `limit`.
     The leak canary is untouched and green.
  8. Pre-exports `coverage.ts` from `charts/index.ts` so W3-09 can fill it. H-07, W3-01, W3-02, W3-04, W3-08 and W3-11 adopt it (Part B).

#### G-15 · Money engines: a typed basis per discrepancy, info-row routing, the pay-approval rule
- **Owner:** matching-engine-guardian · **Device:** server · **Effort:** M · **humanPR:** **yes** (`packages/matching/**`, `approvals/engine.ts`)
- **Paths:** `packages/matching/src/{engine,index}.ts`; new `packages/matching/src/__tests__/basis.test.ts` (canary and fixtures untouched); `packages/api/src/approvals/engine.ts`; new `packages/api/src/__tests__/approvals-engine-routing.test.ts`; `packages/api/src/match/consolidated.ts`.
- **Findings:** leaks-02, SUP-02, approvals-01, approvals-08, functional-flows-04.
- **Acceptance:**
  1. The engine emits a typed `basis` on every Discrepancy: `{source: po|baseline_p90|gr|invoice_total|vat_rate, qtyUsed, unitPriceUsed, referencePrice, unitFactor, overlapUnits, threshold{pct, abs, units}}`. `MatchOutput` is extended additively. `consolidated.ts` writes the same basis for its findings (pooled receipts, a note billed twice) instead of free-text `tolerance_used` templates. G-14's `persist.ts` stores it in `discrepancies.basis`.
  2. `basis.test.ts` runs the real engine on PO, baseline-p90, unit-converted (kg↔g) and QTY_SHORT-overlap fixtures and asserts that the basis arithmetic equals |Δ| in agorot. `tolerance_used` text is unchanged, so old readers keep working.
  3. `approvals/engine.ts`: rows excluded from the leak (LEAK_FILTER: info severity and the other non-leak rows) route to an acknowledge path with no ₪, before the cumulative rules. No "דרוש ₪95.23" for a row that is not claimable. Parity test with LEAK_FILTER.
  4. The pay-approval rule (decision 9): "over ₪N, or a new supplier → the owner approves for payment", with thresholds read-only from settings. W2-03's `approve_for_payment` uses it.
  5. A ₪ meaning diff on the lab seed, signed by leak-economist.

#### G-16 · Cross-surface invariant suite and guards
- **Owner:** test-sentinel · **Device:** both · **Effort:** M · **humanPR:** no
- **Paths:** new `apps/web/e2e/invariants/**`; `apps/web/e2e/helpers.ts`; new `packages/api/src/__tests__/invariants/**`; new `apps/web/scripts/guards/**`; `apps/web/eslint.config.mjs`.
- **Findings:** leaks-04, leaks-18, chain-01, auth-01, exec-desktop-01, approvals-08, design-system-01, auth-14, leaks-03, functional-flows-09.
- **Acceptance:**
  1. e2e crawl on the lab seed in he and en, at 390 and 1440:
     - every total marked `data-money-sum-of` equals its rows' `data-money-agorot` (cap notes honoured);
     - every `[data-drill]` lands on a list whose `[data-drill-total]` matches to the agora;
     - in he, the ₪ glyph sits left of the first digit;
     - no red ₪0, and no ₪0 where the state is unmeasured or unavailable;
     - the legal links are present and answer 200.
  2. API invariants:
     - one definition per ₪ metric across web data, e-mail/WhatsApp text, Ask facts and mobile fields (registry ids);
     - "late" is defined once (`deliveryState`);
     - a discrepancy is on at most one letter;
     - GET procedures write nothing (`recovery.list` and the monthly report: a statement-log assertion).
  3. Guards (`scripts/guards/**` + eslint rules in warn), each failing on:
     - an `onChange` on select/radio/checkbox that reaches a mutation, server action, `run()`/`startTransition` or `fetch` (allow-list for setting toggles);
     - `.catch(() => null|[])` on money procedures, and `?? 0` on `*Ils`/`*Agorot` in server components;
     - deletes on the receiver IndexedDB outside `outbox.ts`;
     - status literal arrays outside the lifecycle modules;
     - value imports of `@restomatch/api` in `'use client'` files.
  4. Every guard starts in warn with a per-area count in the PR. W4-01 flips them to error; H-09 makes them CI-blocking.
  5. Shared helpers in `e2e/helpers.ts`: `expectShekelLeftOfDigits`, `expectTotalsMatchRows`, `expectDrillParity`, `expectNoZeroForUnknown`.

---

## Part B: scope amendments to existing packages

### Wave 1 (in flight; relay now; the orchestrator checks each one in pre-merge review)
- **W1-01:**
  - Split **W1-01a** (merge by 28.10) with: `<Money>`, `.num`, Heebo placed before the generic mono fallbacks (the ₪ glyph in residual `font-mono` paints in Heebo), and a money ratchet test (baseline 39 `dir=ltr` / 121 mono). Rule 0.2.8 is amended for this one primitive: W1-06, W1-07 and W1-09 import it.
  - Add `useDeferredMutation` (10 s undo through the Toast v2 action, flushed on `pagehide`) for W1-06/07/08/11.
  - Add one generic print rule `html[data-print-scope] [data-printing]` in `globals.css`.
- **W1-03:** "דליפה" labels only the monthly leak (creep: "מחירים שעלו"). Footer links come from W1-12a's `LEGAL_LINKS` and render only once `/accessibility` is registered. Manager bar per decision 17.
- **W1-05:**
  - "באיחור" comes from the GR-derived state (`latestReceiptStatus`), never from the PO status.
  - The manager's ₪ awaiting comes from `approvals.queueSummary` (W1-07), not a sum over `myQueue` rows.
  - The staff-home check is server-side (a procedure recorder, plus a DOM check for no ₪), because `page.on('request')` cannot see server callers. Staff homes do not mount `activity.feed`.
  - The non-pending guard allows an explicit, logged reopen of a partial receipt for a follow-up delivery (one GR per PO).
  - Overview copy: no "דליפות" for creep.
- **W1-06:**
  1. A `_count.ts` model (`uncounted | counted{qtyReceived, qtyRejected, outcome, method}`) that imports nothing from showcase `_state`:
     - the initial count never comes from `invoiceQty`, on any line;
     - the "כמו בחשבונית" chip is removed or demoted;
     - `_dockSlip.ts` loses its invoice fallback;
     - a saved 0 with reason `missing` restores as "missing".
  2. Bulk "הכל הגיע כמו בהזמנה" writes the PO qty with method `bulk_as_ordered` (in `notes` until G-03) and shows T4 "לא נספר פריט-פריט"; spot check per decision 20.
  3. Outbox retention:
     - `outbox.ts` is the only module that touches the receiver IndexedDB;
     - errors are classified by HTTP status / TRPC code, not by regex, and 401/network failures consume no attempt;
     - `storage.persist()` runs on the first enqueue;
     - it exports `pendingCountOnDevice()` and keeps a deprecated `clearQueue` until W1-09 merges;
     - a colleague's items upload with attribution per decision 22.
  4. Paths added: `apps/web/lib/__tests__/offlineQueue.test.ts` (flip S4-I3) and `apps/web/scripts/e2e-ingest-pwa.ts:305-320` (flip both asserts).
  5. Storage paths, never signed URLs, also for `signature_url`.
- **W1-07:**
  - Verbs keyed by type AND claimability: an accepted DUPLICATE is "אל תשלמו את העותק" (hold), never "דרוש ₪X"; non-claimable rows read "סמנו כנבדק".
  - Fix the reason text in `approvals-router.test.ts:337`.
  - `queueSummary` splits "להחלטה (₪)" from "לבדיקה (ללא ₪)".
  - The WhyLine basis label is truthful (p90 is never "מחיר הזמנה").
  - The others lane reads `audit_log`; its re-match gap is a known limit until W2-13.
- **W1-08:**
  1. Claims page: a discrepancy with a non-written-off claim never appears in a month letter (dedupe by `discrepancyId`); undecided lines are not addressed to suppliers (decision 18) and show as T2 "החליטו".
  2. `isDefaultData()` ignores `compare`, so the breakdown doesn't flip and the home keeps its proof link.
  3. Grouped rows are pre-cap: show the cap note rather than force equality; no Hamilton rounding where the row also appears elsewhere at its own rounding.
  4. The claims `.catch(() => [])` becomes an error state.
  5. "הכסף חזר" on a partial credit shows the ₪ being let go.
  6. The leak card reuses W1-07's `flags/WhyLine`.
  7. Per-letter print uses W1-01's rule.
- **W1-09:**
  - The `route.ts` completeness check reads the PO lines through `supplierPortalView(token)`; the note is always carried; every line has an explicit qty.
  - The already-answered card restates the recorded answer; adds `s/[token]/not-found.tsx`.
  - Uses `<Money>`, not a local `Ils()`; consumes `pendingCountOnDevice()`.
  - Legal links come from the registry; portal qty is parsed with the W1-10 parser.
- **W1-10:**
  - The parser lives in `packages/types/src/number-input.ts` (paths added: that file and `packages/types/src/index.ts`; test in `packages/api/src/__tests__/number-input.test.ts`). It uses the grammar of `integrations/pos/csv.ts parseScaled`, not `parsePriceCell` (`'0,250'` → 250 trap). Typed XLSX numeric cells bypass the string parser.
  - Auto-link only at ≥ 0.95 with unit/pack match. Interim provenance in confidence: 1.000 is reserved for human links.
- **W1-11:** Acceptance 3 becomes an interim:
  - a per-supplier draft mirrored in `sessionStorage`, plus a leave guard and the supplier-change sheet with undo;
  - a persisted `draftId`, so a `placeOrder` retry after reload never creates a second draft;
  - the server `saveDraft` moves to W2-06.
  - `unitPriceExpected` is parsed with the W1-10 parser.
- **W1-12:**
  - Split **W1-12a** (merge by 03.11): the `/accessibility` route, `publicPaths`, sitemap, plus new `apps/web/lib/legal/{registry.ts,LegalLinks.tsx}` (a named new folder under rule 0.2.8).
  - `LegalShell` takes a `status` prop (banner only while `draft`) and `lastUpdated`.
  - Cite ת״י 5568 at WCAG 2.0 AA, with 2.2 AA as the target. A required-set test.
  - Landing/showcase "דליפה" only for the monthly leak.

### Wave 2
- **W2-02:** Tabs from G-05 `invoices/state.ts` (no own derivation; "matched" = EXISTS `match_runs`). `ingest.approveDocument` uses capability `intake.approve` (G-07). Inbox "attach as page / split" calls G-09. `/scans` footer via `LegalLinks`. The consolidated panel letter links to the supplier letter instead of a third template. `.catch(() => null)` on money queries becomes an error state.
- **W2-03:**
  - Transitions via G-05. `markPaid` ships after H-03 is deployed (`paid_at` is a prerequisite, not an audit-row stopgap). Until G-14 lands, `markPaid` refuses an invoice whose capped leak is > 0.
  - `lib/claims`: keep the claims of paid invoices; exclude discrepancies that already have a non-written-off claim.
  - A short-pay goes to `payment_deductions` (decision 19), with VAT grossed up per claim basis.
  - The all-unpaid list uses W2-09's batch per-invoice leak.
  - Shared parity test with W2-10: Σ letters = Σ ledger = pay-run credit.
- **W2-04:**
  - `decide()` runs on the G-05 discrepancy machine (from `open|escalated`, with `expectedStatus`). It records the decision (G-03 column, else `audit.after`), recomputes claimability and returns CONFLICT when the ₪ differs from what was shown.
  - The claim is created inside the approve transaction via W2-10's `materializeClaims`, with `created_by = resolved_by`. The worker re-match (`matchInvoice.ts`) releases or rebinds claims before deleting runs (FK).
  - Escalate goes through `emit` + `notify` (G-05/G-06). `queueSummary` and `endOfDayReport` use G-12. The approval e-mail uses per-invoice `claimableLines`.
  - Baked `₪${}` strings (`approvals.ts:176`, `matchInvoice.ts:194,240`) move to metadata. `myQueue` gains scope `all` with `canAct` / `waitingOn` (G-07).
- **W2-05:**
  - Server count truth:
    - lazy `gr_lines` (created on the first mark) or count markers;
    - `submitReceipt` refuses uncounted lines (`PRECONDITION_FAILED{uncounted_lines}`), or closes as partial naming "לא נספר";
    - a `markGrLine` outcome (`missing` = 0/0/`missing`);
    - CAS in the `UPDATE … WHERE`, with replay success when the current row equals the payload;
    - an atomic submit under `lockReceipt` with `clientMutationId` replay;
    - an explicit, logged reopen for follow-up deliveries;
    - `resumeState`;
    - receipt-keyed invoice dedupe ("עמוד נוסף / חשבונית אחרת").
  - Walk-in:
    - `startReceipt` refuses draft POs except through `startWalkIn`; the retro PO stays draft (`kind = walk_in` once G-03 is deployed; unique `source_ref = walk_in:<grId>`) until a manager-tier `confirmWalkIn`;
    - expected prices come from W2-06's `resolveExpectedPrice`, never from the invoice;
    - "לא הגיע" is recorded as a fact and the manager cancels or reschedules.
  - Capture:
    - `DocumentCapture` lives under `lib/pwa/**` or `receiving/**` (W3-03 moves it to `lib/components/field`);
    - per-page `clientPageId` plus `clientDocumentId`, composed via G-09;
    - webp → JPEG on the client and direct-to-storage upload;
    - storage paths everywhere (`raw_image_url`, `signature_url`, photos);
    - `invoice_scans` uses the invoice uuid.
  - Outbox:
    - a generic core with `registerOutboxKind` that merges before W2-07;
    - an offline app shell (cache-first `/_next/static`, a field shell route), with the drainer mounted via `PwaSessionGuard`;
    - the read snapshot is purged on sign-out.
  - Also:
    - `bulk_as_ordered` T4 plus a spot check (decision 20);
    - the board uses `deliveryState`;
    - `updateInvoiceHeader/Line` move in place to `invoice.correct`;
    - `receiverLangs` overlays carry the new activity verbs.
- **W2-06:**
  - `saveDraft` / `openDraft`: the version is `xmin` or a server-stamped ms `updatedAt`; natural-key idempotency (one open draft per restaurant, supplier and author, under `pg_advisory_xact_lock`); the PO is locked and `NOT EXISTS goods_receipts` is checked before lines are replaced.
  - `resolveExpectedPrice`:
    - precedence: contract > the last restaurant-authored, explicitly priced PO line (never imported, never walk-in; carries `asOf`; never outranks a newer list price) > list;
    - signed by leak-economist (decision 21);
    - adopted by `createDraft`, `captureOrderDraft`, reorder and walk-in.
  - Guide membership excludes drafts, cancelled POs and walk-ins.
  - `captureOrder.matchLine` goes through `decideLink`.
  - Prices are redacted by capability.
  - `placeOrder` refuses a PO that has a GR and enqueues through a typed address (supplier-order template).
  - `orders/document/bidi.ts` uses G-13 `visualOrder`; `parseDecimalInput` in `order-logic` and `detail-client`.
- **W2-07:** `inventory/data.ts` reads counted lines of closed receipts (`receiptTruth`). Received = net accepted, and `qty_rejected` is never subtracted again. The count is an outbox kind with per-user attribution. `parseDecimalInput`.
- **W2-08:**
  - Task ₪ comes from the canonical rules via G-12, and parity is against that definition, not each page.
  - Owns the cross-role parity invariant: the bookkeeper strip equals the owner's `queueSummary`.
  - Registry roles ⊆ procedure capabilities (test).
  - The dashboard footer renders `LegalLinks`; vatAtRisk `.catch` becomes an error state.
  - demo-path parity runs on a seed with routed info rows.
- **W2-09:**
  - **W2-09a first:** export the per-invoice state CTE (from `monthInvoicesCte` + `computeInvoiceLeak`) and a batch `computeInvoicesLeak`, with no ₪ change.
  - `evidence.ts` interim:
    - it imports `mulIls` / `unitConversionFactor` from `@restomatch/matching` and does not re-implement them;
    - the basis label is truthful;
    - it adds an "מוגבל לסכום החשבונית" part;
    - it absorbs ProposalFinding and the dock-slip text.
  - `period.ts` `resolveWindow` + `computeLeakComparison` on `boundsCte`, with explicit end-of-month capping and per-window coverage.
  - `leakState` includes `partial`.
  - Grouped rows/byType: sum capped amounts or show the cap note; an "אחר" remainder row past LIMIT.
  - `owner.kpis` money fields are served only to deciders.
- **W2-10:**
  - `recovery_claims` is the only letter source.
  - `materializeClaims(tx, {discrepancyIds, actorId})` serves W2-04. `syncClaims` leaves `routers/recovery.ts` read paths.
  - Letter entity on `claim_letters`: `sendLetter` / `unsendLetter` (guarded `letter_sent → claimed` within N minutes) with a version CONFLICT.
  - `transition` takes `items[{claimId, expectedStatus}]`, all-or-nothing.
  - Edge metadata: `requiresReason` on terminal edges or when the shortfall is > 0.
  - `recovery.list` returns `next[]` per claim (no client mirror, no value import of `@restomatch/api` in `'use client'`).
  - `returnedInMonth` via the period resolver; `parseIls` → `parseDecimalInput`; letter text from the single `whyLine`.
- **W2-11:** `ledger/coverage.ts` uses `receiptTruth` and `INVOICE_CHECKED`. `supplier.whatsapp` is normalised to E.164 on save. Delivery-note parsing uses the G-04 helper.
- **W2-12:** `parseDecimalInput` in the contracts import and the web contracts logic.
- **W2-13:**
  - The glossary gate also covers packages/api report and notification strings and the synonym "הפסד".
  - `persist.ts`:
    - writes metadata only (no baked ₪);
    - carries escalation provenance (`fromRole`, `escalatedBy`) on the finding key across re-match;
    - writes status via G-05.
- **W2-14:** The role select in `team-client.tsx` is staged too. Profile phone capture with OTP verification (`users.phone_verified_at`). `exports/range.ts` uses the period resolver.
- **W2-15:**
  - New `apps/web/lib/drafts/**` (`useFormDraft`, `useServerDraft`, `useLeaveGuard` hoisted from `products/names-grid.tsx`), merged by 14.11.
  - Lint warn rules include "no bare `formatIls` in JSX". String contexts are exempt and handled by W2-13 `interpolate()`.
  - One `[data-printing]` rule replaces the xmatch-only rule, the second proof PrintButton and the report's inline style.
- **H-02:** Owns `apps/web/lib/legal/{operator,subprocessors,docs}.ts` in wave 2 and flips the documents to `approved` after counsel signs. `CookieConsent` and the privacy body consume `LegalLinks`.
- **H-03:** Contents unchanged; takes the migration number after G-03.

### Wave 3
- **H-07:** The hero partition and funnel read G-14's ledger. Hero and report move to the period resolver, with a closed-month bounds-parity test. Closed months compare snapshots. `recoveredIls` is renamed.
- **H-04:** Adds `CHECK (target NOT LIKE 'role:%') NOT VALID` on the outbox, deployed only after H-05 has moved every producer.
- **H-05:** Every producer uses `notify()`. The dispatcher is the single sender (no in-process send, so no double send). `whatsapp_sends` is metered on the dispatcher's `sent`. A supplier-order template.
- **W3-01:** pay-run inline filters → ledger; chain `claimedIls` → registry.
- **W3-02:** inventory `to_receive` from `effectOf`; `recipe-ui` uses `parseDecimalInput`.
- **W3-03:** `lib/components/field` receives `DocumentCapture` from W2-05.
- **W3-04:** Ask tools use the registry ids and keep the period facts.
- **W3-08:**
  - `reports/monthly.ts`: no `syncClaims` on read; `money_state` from the ledger; labels from the registry.
  - Snapshot v2 with a state field. For v1 snapshots the renderer derives the state from `invoiceCount` / `pendingLinkCount`, so an unmeasured month never says `allClear`.
  - The period resolver and the restaurant time zone in the digest and monthly pages.
- **W3-09:**
  - The PO machine runs on the G-05 kernel, with `PO_MATCHABLE` from G-04.
  - An `external_sync` event for platform writes. `po_settled` uses note coverage for consolidated invoices.
  - The supplier answer emits `supplier.answered`. Paths added: `apps/worker/src/jobs/syncPlatforms.ts`, `packages/api/src/orders/importPo.ts` (already under `orders/**`).
- **W3-10:** the "לקשר" queue on `decideLink`.
- **W3-11:** recovery sync and cap from the ledger; ledger credits; a credit note is never confused with a `payment_deductions` row.

---

## Overlap ledger for the gap packages (same-wave disjointness)
| Wave | Gap package | Paths it owns | Nearest neighbours (disjoint) |
|---|---|---|---|
| 1 | G-01 | `jobs/{supplierDelays,dailyExpectations}.ts`, `api/lib/deliveryState.ts` | W1-11 owns `jobs/orderReminders.ts`; W1-05 owns `routers/receiving.ts` |
| 1 | G-02 (human) | `(marketing)/{privacy,terms,cookies}`, `legal.*`, `lib/legal/{operator,subprocessors,docs}.ts` | W1-12 excludes these; W1-12a owns `lib/legal/{registry,LegalLinks}`; W1-01 owns `CookieConsent` |
| 1 | G-03 (human) | `schema.ts`, new migration, RLS list | no W1 package touches the DB |
| 2 | G-04 | `match/{buildMatchInput,consolidated,receiptTruth}.ts` | W2-13 owns `match/persist.ts`; W2-05 owns `receiving/**` |
| 2 | G-05 | `api/src/{lifecycle,invoices,discrepancies,events}/**`, `lib/idempotency.ts`, `activity.ts` | W2-02 owns `routers/invoices.ts`; W2-03 owns `lib/{claims,dueDate}.ts`; W2-08 owns `tasks/**` |
| 2 | G-06 | `notifications/{address,recipients,notify}.ts`, `reports/send.ts`, `jobs/ocrInvoice.ts` | W2-13 owns `templates.ts`; W2-04 owns `jobs/{matchInvoice,endOfDayReport}.ts` |
| 2 | G-07 | `api/lib/{roles,capabilities}.ts`, `api/trpc.ts`, `routers/activity.ts` | W1-04's `lib/trpc/**` is the web client (wave 1) |
| 2 | G-08 | `packages/catalog/**`, `ocr/src/pipeline.ts`, `api/src/catalog/**` | W2-06 owns `orders/**` (adopts by amendment) |
| 2 | G-09 | `api/src/ingest/**`, `api/src/documents/**` | W2-02 owns `routers/ingest.ts`; W2-05 owns `routers/scans.ts` |
| 2 | G-10 | `supplierConfirm/**`, `app/s/[token]/**`, `api/supplier-confirm/**` | owned by W1-09 (wave 1) and W3-09 (wave 3) only |
| 2 | G-11 | `lib/legal/{registry,LegalLinks}`, `(marketing)/_components/*`, `robots/sitemap`, root `error/global-error`, `admin/layout.tsx`, `publicPaths.ts` | H-02 owns the legal pages and `lib/legal/{operator,subprocessors,docs}`; W2-08 owns the dashboard shell |
| 2 | G-12 | `approvals/awaiting.ts`, `ask/**`, `apps/mobile/app/{owner,manager}` | W2-04 owns `routers/approvals.ts` |
| 2 | G-13 (human) | `packages/types/src/{number-input,money/**,index}`, `reports/{bidi,money}.ts`, `notifyHelpers.ts`, POS and recipes CSV | G-06 owns `reports/send.ts` (different file) |
| 3 | G-14 (human) | `charts/src/{leak-ledger,decisions,metrics,leak-views,owner-kpis,leaks,index}.ts`, `api/lib/claims.ts`, `match/persist.ts`, `contracts/overContract.ts`, `routers/owner.ts` | H-07 owns `leak-hero`/`leak-report`; W3-01 `chain.ts`; W3-09 `coverage.ts` (export pre-created by G-14) |
| 3 | G-15 (human) | `packages/matching/src/{engine,index}.ts`, `approvals/engine.ts`, `match/consolidated.ts` | no W3 package touches the engines |
| 3 | G-16 | `e2e/invariants/**`, `e2e/helpers.ts`, `api/__tests__/invariants/**`, `scripts/guards/**`, `eslint.config.mjs` | each W3 package owns only its own spec file |
