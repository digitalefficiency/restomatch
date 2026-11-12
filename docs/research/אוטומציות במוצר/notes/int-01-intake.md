# INT-01 — Intake: how invoices get into RestoMatch today

Area: invoice arrival (WhatsApp, e-mail inbox, receiving-wizard camera scan / upload), the OCR pipeline, ingest and scans routers, review threshold, product auto-link, supplier detection, duplicate detection, consolidated invoices (חשבוניות ריכוז), allocation-number capture, and the inbox page.

Source: `release/train-a` checkout (merge `c6132c0e`, "Merge #208 into train A"). All paths are repo-relative. Where `main` differs it is called out: `packages/api/src/ingest/pipeline.ts`, `routers/ingest.ts`, `routers/scans.ts`, `match/consolidated.ts`, `routers/consolidated.ts`, the inbox client and `cron.ts` are byte-identical on both branches. **`apps/worker/src/jobs/ocrInvoice.ts`, `ocrSweep.ts` and `packages/ocr/src/pipeline.ts` exist only in their newer form on train-A.** That form adds the per-tenant OCR mode gate (`claude`/`stub`/`disabled`), the arithmetic/ח״פ "checks" gate, the single-provider confidence rule and the "held for the count" marker.

Read-only research. No code was changed.

---

## 1. One-screen summary

| Channel | Who does it | Entry point | Auto today | Flag / env gate | Default |
|---|---|---|---|---|---|
| WhatsApp (supplier sends a photo/PDF to the restaurant's WA Business number) | Supplier sends. Manager or owner triages | `apps/web/app/api/ingest/whatsapp/[token]/route.ts:25-40` → `handleWhatsAppWebhook` (`packages/api/src/ingest/http.ts:171`) → `processInboundMessage` (`packages/api/src/ingest/pipeline.ts:193`) | Stores the file, dedupes it and auto-registers it for OCR **only if the sender is allow-listed and authenticated** (`pipeline.ts:316`) | `ingestWhatsapp` feature + `WHATSAPP_APP_SECRET`/`WHATSAPP_VERIFY_TOKEN`/`WHATSAPP_ACCESS_TOKEN`, `INGEST_PROVIDER=live` (`packages/ingest/src/config.ts:44-56`) | **OFF**. Not in `PILOT_DEFAULTS` (`apps/web/app/admin/restaurants/[id]/FeaturesPanel.tsx:20-31`) |
| E-mail (supplier sends to `inv_<token>@<INGEST_EMAIL_DOMAIN>`) | Supplier or bookkeeper forwards. Manager triages | `apps/web/app/api/ingest/email/route.ts:19-33` → `handleEmailWebhook` (`http.ts:189`) → same pipeline | Same, and auto-register requires a DMARC `pass` (`packages/ingest/src/payloads.ts:72-95`) | `ingestEmail` + `INGEST_EMAIL_DOMAIN`, `INGEST_EMAIL_WEBHOOK_SECRET`, `INGEST_RESEND_API_KEY` (`config.ts:59-68`) | **OFF**. Not in pilot defaults |
| Camera scan at delivery (receiving wizard) | Receiver (מקבל סחורה) | `apps/web/app/dashboard/receiving/[poId]/wizard.tsx:320-427` → `scans.upload` (`packages/api/src/routers/scans.ts:36`) → `receiving.registerInvoice` (`packages/api/src/routers/receiving.ts:1013`) | Upload, register and enqueue OCR, then poll. Offline photos are queued in IndexedDB (`wizard.tsx:323-345`) | Real OCR only for tenants in `OCR_REAL_RESTAURANT_IDS` with `ANTHROPIC_API_KEY` (`apps/worker/src/jobs/ocrInvoice.ts:55-99`). Offline queue: `receiverPwa` | OCR is **`disabled` for everyone not listed**. `receiverPwa` is in pilot defaults |
| WhatsApp text order (not an invoice) | Supplier or manager forwards | same WA webhook (`pipeline.ts:391-425`) | Draft PO via `captureOrderDraft` | `orderCapture` + `ingestWhatsapp` | `orderCapture` is in pilot defaults, but `ingestWhatsapp` is not, so the path is dead in the pilot |
| Free upload of an invoice with no delivery | Bookkeeper or owner | **None.** `registerInvoice` requires a `grId` (`receiving.ts:1016`). The only `scans.upload` callers are the wizard and the showcase | — | — | Not built |

Takeaway: in the pilot configuration, the only live way an invoice enters is **the receiver photographing it at the dock**. That only gets real OCR when ops has hand-listed the tenant's UUID in an env var. Every other channel exists in code but is off by default.

---

## 2. Workflow A — WhatsApp / e-mail inbound (S13 ingestion)

### 2.1 One-time setup (manager or owner)

1. Admin turns on `ingestWhatsapp`/`ingestEmail` per tenant in `/admin/restaurants/[id]` (`FeaturesPanel.tsx:49-58` → `admin.setFeatures`, `packages/api/src/routers/admin.ts:370`). There is a confirm dialog, `FeaturesPanel.tsx:55`. The flag lives in `restaurants.settings.features` and is off unless set. `FEATURES_OFF` is the global kill-switch (`packages/api/src/lib/features.ts:56-71`).
2. The manager opens `/dashboard/inbox` (`apps/web/app/dashboard/inbox/page.tsx:17`). A tenant with the flag off gets a 404 (`page.tsx:28-31`).
3. The manager clicks "rotate" on the channel: `ingest.rotateChannel` (`packages/api/src/routers/ingest.ts:124-157`). The plaintext token or address is shown **once**. For WhatsApp the manager must also paste the Meta `phoneNumberId` (`ingest.ts:125`). In production an unbound channel rejects every message (`http.ts:132-133`).
4. **Manual, outside the product:** the manager tells each supplier the new address or number. For WhatsApp the manager also configures the webhook URL in Meta.
5. The manager adds allow-listed senders one by one with `ingest.addSender` (`ingest.ts:196-226`; form at `inbox-client.tsx:560-600`): kind, phone or e-mail, label, and supplier link. That is about 4 fields and 1 submit per supplier contact. **This re-types data the supplier record may already hold** (supplier phone/e-mail).

### 2.2 Per message (automatic)

`processInboundMessage` (`pipeline.ts:193-436`) runs under the tenant's RLS GUC (`withRestaurant`, `pipeline.ts:200`):

- Feature re-check (`pipeline.ts:206`). The sender is normalized and looked up in `ingest_senders`. The supplier link is re-verified as the tenant's own (`pipeline.ts:210-232`).
- Replay guard: unique (restaurant, kind, provider message id), so a redelivered message is a no-op (`pipeline.ts:234-252`).
- Per attachment:
  - cap of 10 attachments (`packages/ingest/src/limits.ts:13`; `pipeline.ts:261`)
  - 10 MB size cap (`limits.ts:11`; `pipeline.ts:163-176`)
  - MIME sniff (`pipeline.ts:282`)
  - **SHA-256 byte dedupe**: the same bytes already registered become a `duplicate` doc linked to the existing invoice, with no second OCR (`pipeline.ts:292-311`)
- **Auto-register gate:** `senderAllowed && authVerdict === 'pass'` (`pipeline.ts:316`).
  - WhatsApp senders are authenticated by Meta.
  - E-mail needs exactly one `dmarc=pass` from the trusted authserv-id (`payloads.ts:68-95`).
  - Otherwise the document is stored with `needs_review`, at no OCR cost.
  - Unknown senders also get a daily storage quota (`pipeline.ts:320-341`, `INGEST_REVIEW_BYTES_PER_DAY`). Over quota, only metadata is kept.
- Registration: `registerIngestedDocument` (`pipeline.ts:84-145`) signs a **30-minute** URL (`packages/api/src/ingest/store.ts:6,57`). It dedupes per (restaurant, object URL) under an advisory lock and inserts `invoices` with `status='ocr_pending'` and `source='whatsapp'|'email'`. The OCR job is enqueued **after commit** (`pipeline.ts:148-156, 434`). The web route also "kicks" the job inline if it fits within `maxDuration` (`email/route.ts:20-22`, `apps/web/lib/jobKick.ts:31`).

DB tables touched: `ingest_channels`, `ingest_senders`, `ingest_messages`, `ingest_documents`, `invoices`, `job_queue`, plus Supabase storage `invoice-scans`.

### 2.3 Inbox triage (manager; bookkeeper read-only)

- `/dashboard/inbox` lists messages and documents by filter: all / needs_review / errors (`ingest.ts:239-315`; `page.tsx:33-38`).
- Reads use `financeProcedure` (owner, manager, bookkeeper). Actions use `managerProcedure` (`packages/api/src/trpc.ts:148,162`). The UI hides the buttons from the bookkeeper (`page.tsx:46`).
- Per `needs_review` document the manager:
  1. picks a supplier from a dropdown, which **starts empty even when the allow-list suggested one** (`inbox-client.tsx:299-312`)
  2. clicks **Approve** or **Approve + allow sender**, or **Reject** (`inbox-client.tsx:314-366`)

  That is roughly **2-3 taps per document**. `approveDocument` re-signs, registers and enqueues OCR (`ingest.ts:318-353`). `rejectDocument` marks it rejected (`ingest.ts:355-366`).
- Not automated:
  - **No notification** tells anyone that a document is waiting. Nothing in `packages/api/src/ingest/*` or `routers/ingest.ts` calls the outbox. The only signal is the `needsReview` count on `ingest.overview` (`ingest.ts:109-120`).
  - There is no bulk approve.
  - There is no "approve all from this sender from now on" beyond the allow-sender button.

### 2.4 Gaps worth noting

- **Over-quota documents can't be recovered in product.** They have no stored blob, so approve throws "no stored file" (`ingest.ts:332-333`). Someone has to ask the supplier to resend.
- **A sender that is allowed but not linked to a supplier** auto-registers an invoice with `supplier_id = NULL` (`pipeline.ts:223-231, 359-366`). After registration, **no procedure can set the supplier**: `updateInvoiceHeader` covers number, date and totals only (`receiving.ts:610-630`).
  - Duplicate-by-number detection is then silent (NULLs never collide on `invoices_dedupe_idx`; `ocrInvoice.ts:433`).
  - `consolidatedProposal` returns null without a supplier (`packages/api/src/match/consolidated.ts:1043`).

---

## 3. Workflow B — Receiver camera scan at delivery

The full receiving flow belongs to the receiving note. Only the intake part is covered here.

1. The receiver opens the PO, taps scan, and the photo is captured (`wizard.tsx` step `SCAN_INVOICE`, `wizard.tsx:97-104, 871`).
2. `scans.upload` (`memberProcedure`): the server derives tenant and path. Base64 is capped at ~10 MB. The id is idempotent through `clientUploadId` (`scans.ts:36-62, 146-149`). It returns a **30-minute** signed URL (`scans.ts:9,130-132`). The `invoice_scans` mapping insert is best-effort and is known to fail on the migrated schema (`scans.ts:108-128`).
3. Offline, or if the network drops: the photo goes into IndexedDB and uploads later (`receiverPwa`; `wizard.tsx:323-345`; `apps/web/lib/pwa/offlineQueue.ts`).
4. `receiving.registerInvoice` (`receiverProcedure`; `receiving.ts:1013-1131`):
   - SSRF guard on the URL
   - the supplier must be the PO's supplier
   - (restaurant, object) advisory-lock dedupe
   - insert `invoices` with `source='photo'`
   - enqueue OCR with `grId`
   - if the queue is unreachable it returns `ocrQueued:false`, and the wizard falls back to counting against the PO (`wizard.tsx:407-411`)
5. The wizard polls `receiving.getInvoice` until the invoice is read or failed (`wizard.tsx:430-440`), then shows the review. **The receiver sees no ₪** (`showMoney` gating, `wizard.tsx:272`).

Manual taps: about 3 (open PO, scan, confirm photo) plus the count. Supplier detection is implicit: the PO's supplier is used, so nothing is re-typed. This is the best-automated path.

---

## 4. OCR pipeline (all channels)

### 4.1 Job `ocr-invoice` (`apps/worker/src/jobs/ocrInvoice.ts:150-381`)

- **Tenant guard:** `findJobInvoice` re-reads the row (id and restaurant) with a ~7.75 s backoff for the commit race (`apps/worker/src/jobs/findJobInvoice.ts:12, 31-52`). The URL is taken from the **row**, never from the payload (`ocrInvoice.ts:189`).
- **Idempotence:** only `ocr_pending` invoices are read (`ocrInvoice.ts:177-182`).
- **Mode gate (train-A only):** `ocrModeFor` (`ocrInvoice.ts:92-99`):
  - `claude` only if `ANTHROPIC_API_KEY` is set and the tenant is in `OCR_REAL_RESTAURANT_IDS` (`ocrInvoice.ts:55-74`)
  - `stub` only for demo tenants on receiving scans
  - `disabled` for everyone else: the invoice is marked failed with reason `ocr_disabled`, so the receiver continues by hand (`ocrInvoice.ts:190-195`)
  - **The default for a new real tenant is therefore `disabled`.**
- **Metering:** `meterOcrScan` enforces the plan's monthly OCR cap (`ocrInvoice.ts:220-228`). Over the cap the job fails with `quota_exceeded` (`ocrInvoice.ts:481-491`). Billing is immutable.
- **Provider:** Claude Vision with `fetchBytes:true`. The same instance fills both "Document AI" and "Claude" slots, so it is called once (`ocrInvoice.ts:104-123`; `packages/ocr/src/pipeline.ts:35-39`). **Google Document AI is a throwing scaffold** (`packages/ocr/src/providers/documentAi.ts:24-41`).
- **Catalog matcher:** `matchProductTopN` with supplier SKU (strategy-0), top 3 (`ocrInvoice.ts:230-250`). The embedding provider is **`MockEmbeddingProvider(1536)`** (`ocrInvoice.ts:28`), so the semantic part of matching runs on fake vectors. Exact SKU and alias hits still work.
- **Review decision** (`packages/ocr/src/pipeline.ts:80-86`): `needsHumanReview` is true if any of these holds:
  - the checks gate failed
  - confidence < `reviewThreshold` (default **0.85**, `packages/ocr/src/types.ts:92`; per-tenant `settings.ocrReviewThreshold`, read at `ocrInvoice.ts:252-264`, edited in `/dashboard/settings`, `apps/web/app/dashboard/settings/form.tsx:76,103`)
  - any line confidence < **0.5** (`types.ts:94`)
  - any line has no product candidates
- **Product auto-link:** the best candidate is linked only if its confidence is **≥ 0.95** (`pipeline.ts:105-115`). Otherwise `productId` stays null and the candidates are kept for the mapping screen.
- **Checks gate (train-A only)** (`packages/ocr/src/checks.ts:146-228`) flags:
  - missing invoice number, date or totals
  - per-line qty × price ≠ total
  - Σ lines ≠ subtotal
  - VAT mismatch (mixed rates and deposits are handled)
  - subtotal + VAT ≠ total
  - invalid supplier ח״פ
  - **expected ח״פ mismatch**
  - quote/other document kind
  - "continues on another page"
  - handwritten correction
- **Write-back:** `writeOcrHeader` (`ocrInvoice.ts:416-468`) stores number, date, totals, `allocationNumber` and `ocr_payload`, with `status = parsed` (review) or `matched`. Lines are replaced (`ocrInvoice.ts:296-314`), and English names are filled (`ocrInvoice.ts:319-323`).
- **Chain to match:** if no review is needed, `ocrAutoMatchHold` decides whether to wait for an open receipt count (`ocrInvoice.ts:548-623`). Otherwise `enqueueMatchInvoice` runs (`ocrInvoice.ts:342-357`). A held invoice gets `raw.heldForReceipts` (`ocrInvoice.ts:572-587`).
- **Terminal failure:** `markOcrFailed` sets status `parsed` with confidence 0 and `raw.ocrFailed` (`ocrInvoice.ts:483-516`). No lines are written, so no ₪ is ever computed from a failed read.

### 4.2 Sweep and monitoring

- `ocr-sweep` runs every 5 minutes (`apps/worker/src/cron.ts:127-132`; serverless: `vercel.json` cron `* * * * *` → `/api/cron/jobs`). It re-enqueues `ocr_pending` invoices that are **10–25 minutes old**, once each (`apps/worker/src/jobs/ocrSweep.ts:50-125`).
  - The upper bound exists because the signed URL dies at 30 minutes and **the worker cannot re-sign** (`ocrSweep.ts:9-14`).
  - Tenants that are not on real OCR are never swept (`ocrSweep.ts:133-134`).
- `health-digest` runs at 06:45 IL and e-mails ops a list of invoices `ocr_pending` for more than 30 minutes (`apps/worker/src/jobs/healthDigest.ts:8, 157`). It goes to ops, not to the restaurant.

### 4.3 Human correction after review

The owner or manager uses `/dashboard/invoices/[invoiceId]`, specifically `InvoiceCorrection` (`apps/web/app/dashboard/invoices/[invoiceId]/page.tsx:53,100`):

- `receiving.updateInvoiceHeader` and `updateInvoiceLine` (`receiving.ts:610, 693`)
- then **Re-match** → `match.runForInvoice` (`packages/api/src/routers/match.ts:31`) (`correction-client.tsx:87-112`)
- unlinked lines are resolved in `/dashboard/catalog/mapping` (`mapping.confirm`, `packages/api/src/routers/mapping.ts:235`; `mapper.tsx:216`)

This is the most click-heavy part of intake. Every field the OCR failed on, and every line under 0.95, is fixed by hand. `invoicesRouter` is still empty (`packages/api/src/routers/invoices.ts:10`, "W2-02 intake" placeholder).

---

## 5. Supplier detection

| Source of `invoices.supplier_id` | Where |
|---|---|
| Receiving: the PO's supplier, enforced | `receiving.ts:1029-1043` |
| Ingest: the allow-list row's `supplierId` | `pipeline.ts:211-231` |
| Inbox approve: manager dropdown | `ingest.ts:330-334`; `inbox-client.tsx:299-312` |
| **The OCR read itself** | **Never.** The reconciler extracts `supplier.name`/`businessId` (`packages/ocr/src/reconciler.ts:31, 97`), but nothing maps it to `suppliers`. |

The checks gate supports `expectedSupplierBusinessId` (`checks.ts:217-218`), but the worker never passes it (`ocrInvoice.ts:260-264`; no caller outside `packages/ocr`). **The ח״פ-mismatch check is dead in production.** A normalizer for ח״פ already exists in `suppliers.ts:104-113` (`assertNoDuplicate`).

## 6. Duplicate detection (layers)

1. **Provider message replay:** unique key (`pipeline.ts:234-252`).
2. **Same bytes:** SHA-256 per tenant (`pipeline.ts:292-311`).
3. **Same object:**
   - `clientUploadId` gives a deterministic scan id (`scans.ts:60-62`)
   - (restaurant, object URL) advisory lock in `registerInvoice` (`receiving.ts:1052-1080`) and `registerIngestedDocument` (`pipeline.ts:97-130`)
4. **Same invoice number + supplier:** unique `invoices_dedupe_idx`. `writeOcrHeader` keeps the read but stores `raw.duplicateOf` and forces `parsed` (`ocrInvoice.ts:396-468`). The engine still raises `DUPLICATE_INVOICE` from the held number (`packages/api/src/match/buildMatchInput.ts:136-150`).

**Gap:** the same paper arriving as a WhatsApp photo **and** an e-mailed PDF differs at layers 2 and 3. It is caught only at layer 4, and only if both rows carry a supplier.

## 7. Consolidated invoices (חשבוניות ריכוז / מרכזות)

- `consolidated.proposal` (`financeProcedure`) and `consolidated.coverage` (`invoiceReaderProcedure`) are behind the `consolidatedMatch` flag (`packages/api/src/routers/consolidated.ts:19-56`).
  - The flag is **off by default** and not in pilot defaults (`FeaturesPanel.tsx:20-31`).
  - Both are **READ-ONLY** proposals (`consolidated.ts:13-17`; `match/consolidated.ts:31-49`).
  - The proposal is rendered on the invoice page for finance roles only (`apps/web/app/dashboard/invoices/[invoiceId]/page.tsx:62-63`).
- Recognition is keyed on **`ocr_payload.raw.kind === 'consolidated'`** (`match/consolidated.ts:725-727`; `buildMatchInput.ts:128-135`; `match.ts` re-match refusal, `routers/match.ts:37-50`).
  - **No production writer sets `raw.kind`.** The OCR worker writes `raw = OcrPipelineResult`, with `documentKind`, `deliveryNotes`, `periodStart` and `periodEnd` nested under `raw.reconciled` (`ocrInvoice.ts:284-288`; `packages/ocr/src/pipeline.ts:44-58`).
  - The only writer of `raw.kind:'consolidated'` is `apps/worker/scripts/seed-demo.ts:579-590`.
- **Consequence (read from code, not run):**
  - A real scanned ריכוז is not recognized and is PO-matched like a normal invoice.
  - Its `documentKind 'consolidated'` is not in `NOT_AN_INVOICE` (`checks.ts:144`), so it can auto-chain to `match-invoice`.
  - The read-only cross-match never appears for it.
  - The Claude prompt already asks for `deliveryNotes`/`periodStart`/`periodEnd` (`packages/ocr/src/providers/claudeVision.ts:94-114`), so the data is there; only the mapping is missing.
  - This contradicts the T4 rule ("consolidated = neutral, never a false alarm") in AGENTS.md.
- `StagedMatch` does not exist in either tree (grep finds nothing). The ownership map names it, but it is not built.

## 8. Allocation number (מספר הקצאה)

- It is captured by OCR (`reconciler.ts:59-65, 102`) and written to `invoices.allocation_number` (`ocrInvoice.ts:283`; `packages/db/src/schema.ts:817`).
- It is surfaced by `owner.vatAtRisk` (flag `vatAtRisk`, `packages/api/src/routers/owner.ts:87-111`; thresholds `packages/api/src/vat/vatAtRisk.ts:22-35`).
- It is shown on the dashboard card and invoice page (`apps/web/app/dashboard/vat-at-risk.tsx:143`; `invoices/[invoiceId]/page.tsx:81`).
- **It cannot be edited in product.** It is not in the `updateInvoiceHeader` input (`receiving.ts:610-630`). Nothing requests the number from the supplier.

## 9. Stubs, mocks and dead paths in this area

| Item | Evidence |
|---|---|
| `StubOcrProvider`, `FixtureRoutingOcrProvider` (tests, demo stub mode, non-prod `mockProviders`) | `packages/ocr/src/providers/stub.ts:8-37`; `ocrInvoice.ts:126-143` |
| `GoogleDocumentAi` throws "not yet wired" | `documentAi.ts:24-41` |
| `MockEmbeddingProvider` in the production OCR matcher | `ocrInvoice.ts:28, 231` |
| `MockWhatsAppNotifier` (outbound, used when WA creds are missing) | `packages/api/src/notifications/factory.ts:14-22,63` |
| `expectedSupplierBusinessId` never passed | `checks.ts:87,217`; `ocrInvoice.ts:260-264` |
| `raw.kind:'consolidated'` written only by the seed | `seed-demo.ts:581` |
| `invoice_scans` mapping insert fails on the migrated schema (best-effort) | `scans.ts:108-128` |
| `invoicesRouter` is empty | `routers/invoices.ts:10` |
| `sync-platforms` has a handler but **no schedule**, despite the cron.ts header claiming "every 30 minutes" | `cron.ts:9-10` vs `cron.ts:54-150`; `handlers.ts:33` |
| `orderCapture` is on in pilot defaults, but its only producer needs `ingestWhatsapp`, which is off | `FeaturesPanel.tsx:23`; `pipeline.ts:394-400` |

---

## 10. Automation opportunities

The owner rules in force apply throughout:
- approval routing: manager handles ₪50–300 / 2–5%; owner handles anything above that and every blocking gap
- the receiver sees no ₪
- the chef sees ₪ only on orders and recipes
- MISSING_ON_INVOICE is out of the leak and is not claimable
- a claim is overdue after 7 days
- every money action is human-confirmed

"HUMAN-PR" means the opportunity touches an AGENTS.md immutable file.

| # | Trigger | Automatic action | Human still confirms | Data needed | Reuse | Immutable? |
|---|---|---|---|---|---|---|
| O1 **Supplier auto-detect from the OCR ח״פ** | OCR finishes with `supplier_id NULL` and a valid `reconciled.supplier.businessId` | Look up `suppliers.business_id` (normalized as in `suppliers.ts:104-113`) and set it as a *suggested* supplier on the inbox/invoice. When the supplier is known, pass `expectedSupplierBusinessId` to `runOcrPipeline` so the mismatch check finally runs | Manager taps "confirm supplier" (one tap instead of a dropdown). Mismatches go to review | `suppliers.business_id`, OCR payload | `checks.ts` option, `assertNoDuplicate` normalizer, `ingest.approveDocument`'s `supplierId` input; needs a new `setInvoiceSupplier` procedure plus a COVERAGE entry | Worker change is OK. A new procedure must add to `cross-tenant.attack.test.ts` (add-only allowed) |
| O2 **Recognize real consolidated invoices** | OCR `reconciled.documentKind === 'consolidated'` | Stamp `ocr_payload.raw.kind='consolidated'` and lift `periodStart/End/deliveryNotes` to `raw.*` in `ocrInvoice.ts`. Do not auto-chain `match-invoice`. Notify the bookkeeper that the cross-match is ready | Bookkeeper/manager reviews the read-only proposal. No ₪ is written (T4 neutral) | `raw.reconciled.*` (already extracted) | `consolidatedProposal`, `consolidatedMatch` flag, outbox | Worker edit is OK. Whether a consolidated proposal may ever *write* findings is engine-adjacent, so **HUMAN-PR** if it reaches `matching/*` or `engine.ts` |
| O3 **Inbox "waiting for you" nudge** | `ingest_documents.status='needs_review'` older than N hours, or an unknown sender's first message | Outbox e-mail/WhatsApp to the manager with a deep link `/dashboard/inbox?filter=needs_review`, deduped per day | Manager approves or rejects (unchanged) | count + sender + suggested supplier | `enqueueNotification` (`outbox.ts:18`), `MANAGER_ROLES` (`notifications/recipients.ts:28`), a new daily job in `cron.ts` | Producer code is fine, but **scheduling it means editing `cron.ts` = HUMAN-PR**. Alternative: piggy-back on the existing `end-of-day-report` (19:00) or `health-digest` producer |
| O4 **Pre-fill the suggested supplier in the inbox dropdown** | Message has `supplierId` from the allow-list | Default the `<Select>` to it (`inbox-client.tsx:301` currently `''`) | Manager still clicks Approve | `ingest_messages.supplier_id` (already returned) | UI only | No |
| O5 **Auto-allow-list from the supplier record** | Supplier saved with a phone/e-mail, or a manager approves the same sender a second time | Offer "trust this sender" in one tap, or create the `ingest_senders` row linked to the supplier | Manager confirms the allow-list entry (it controls OCR spend) | supplier contacts | `ingest.addSender` | No |
| O6 **Bulk approve** | Several `needs_review` docs from one sender | "Approve all N from this sender + allow" | One confirm | — | `approveDocument` in a loop / new batch proc (+COVERAGE) | Add-only attack entry |
| O7 **Re-sign and retry stale OCR** | `ocr_pending` > 25 minutes (the sweep window ends) | A web-side cron (it holds storage creds) re-signs `raw_image_url` from the storage path, then re-enqueues once | None (no money). Metering still applies | storage path | `signedUrlForStoragePath` (`store.ts:57`), `ocrSweep` dedupe-key pattern, `/api/cron/jobs` | Touching `cron.ts` = **HUMAN-PR**. A web route under the existing `/api/cron/jobs` tick may avoid it |
| O8 **Allocation-number request draft** | Tax invoice over the threshold (`vatAtRisk.ts:22-35`) with a missing or invalid `allocation_number` | Draft a WhatsApp/e-mail to the supplier asking for the number. Add `allocationNumber` to `updateInvoiceHeader` so the reply can be keyed in | Bookkeeper/owner sends (every outbound message is human-confirmed) and types the number | `vatAtRisk` rows, supplier contact | `vatAtRisk`, `supplierMessage.ts`, outbox | `updateInvoiceHeader` is not immutable. `schema.ts` already has the column |
| O9 **Bookkeeper upload without a receipt** | Bookkeeper has a PDF (forwarded mail, portal download) | "Upload invoice" on the inbox: `scans.upload`, then a new `registerLooseInvoice` (no `grId`). Supplier comes from O1 | Bookkeeper confirms the supplier | — | `scans.upload`, `registerIngestedDocument` pattern | New proc + COVERAGE entry |
| O10 **Cross-channel duplicate warning** | A new read whose (supplier, total, date ±2d) equals an existing invoice from a different channel | Mark as a "possible duplicate" in the inbox/invoice (calm T4 badge), and hold auto-match | Manager marks duplicate / not duplicate | totals, date, supplier | `writeOcrHeader`'s `duplicateOf` pattern | Raising a new *DiscrepancyType* would be **HUMAN-PR** (`matching/index.ts`). A UI-level hold is not |
| O11 **Turn on the dormant channels for the pilot** | Ops decision | Add `ingestEmail` (lowest risk: DMARC-gated) to `PILOT_DEFAULTS`. Set `OCR_REAL_RESTAURANT_IDS` | Admin confirm dialog (already exists) | creds per `docs/PRODUCTION-UNBLOCK.md` | `FeaturesPanel` | Env/credential intake is Phase-6, human-only |
| O12 **Real embeddings for line→product auto-link** | OCR line without an SKU/alias hit | Replace `MockEmbeddingProvider` so more lines clear 0.95 and fewer reach the mapping screen | Mapping confirm stays human below 0.95 | embedding key | `packages/catalog` | `packages/catalog` is not immutable, but it is a credential (Phase-6) |
| O13 **Ask: "what's stuck in intake?"** | Manager asks in the Ask panel | A read-only tool lists `needs_review` docs, `ocr_pending` > 30 minutes and OCR-failed invoices | — | existing queries | `packages/api/src/routers/ask.ts:23` (`managerProcedure`), `ask/tools.ts` | No |

---

## 11. Role view (intake only)

- **Receiver:** takes the photo at the dock. This is automated end to end. Once OCR is off (the default), the receiver counts against the PO by hand. Never sees ₪.
- **Manager/owner:** sets up channels and allow-lists by hand, triages the inbox with 2-3 taps per document and no reminder, and corrects headers and lines on reviewed invoices, then re-matches.
- **Bookkeeper:** read-only inbox. **No way to upload a loose invoice.** Sees the consolidated proposal only when the flag is on and only for seeded data (see §7). Allocation numbers are visible but not editable.
- **Chef:** no role in intake (`apps/web/lib/nav/routes/invoices.ts:6`: never the chef or the receiver for the invoice register).

## 12. Immutable files in this area

- `apps/worker/src/cron.ts` (any new schedule)
- `packages/api/src/notifications/outbox.ts` (call it, don't change it)
- `packages/db/src/schema.ts` and migrations (the `ingest_*` and `invoices` tables already have every needed column, including `allocation_number`)
- `packages/matching/*` (any new discrepancy type or consolidated finding semantics)
- `packages/billing/*` (`meterOcrScan` / OCR caps)
- `apps/web/app/api/trpc/[trpc]/route.ts`, `apps/web/lib/rateLimit.ts` (ingest rate limits use `guardPublicRequest`, not these, but they are adjacent)
- `cross-tenant.attack.test.ts`: add-only for new procedures

`packages/ocr`, `apps/worker/src/jobs/ocrInvoice.ts`, `packages/api/src/ingest/*`, `routers/ingest.ts`, `routers/scans.ts`, `routers/consolidated.ts` and `match/consolidated.ts` are **not** on the list.
