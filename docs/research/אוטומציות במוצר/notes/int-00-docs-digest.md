# int-00 · Docs digest: what is already planned or decided (input for the automation plan)

Read-only digest, written 2026-11-07. Purpose: a new automation plan (wave 3+) must not duplicate what wave 2 (and the already-sketched wave 3/4) deliver, and must obey the binding owner decisions. Every claim cites its file.

Sources read: `STATE.md` (top), `docs/ICP.md`, `docs/research/ניהול חשבוניות ספקים במסעדות/report.md` (+ notes takeaways), `docs/ux/wave2/README.md` (§0-§12), all 28 briefs `docs/ux/wave2/{W2-01..W2-15,G-04..G-13,H-01..H-03}.md`, `docs/ux/wave2/CRITIQUE.md`, the in-flight kit diff (`kit-terms-flags.diff` in the session scratchpad: new `G-17.md`, `G-04 §9`, `W2-03 §10`, `W2-11 §10`, `README §13`), `docs/ux/research/{functional-gaps,ainative,ia-map,restaurant}.md` (skim), `docs/ux/IMPLEMENTATION-PLAN.md` §4-§5 (wave 3/4), `docs/ux/wave2/ref/{GAP-PACKAGES,MASTER-PLAN.he}.md` (wave-3 G/H rows), `docs/ux/README.md`, `docs/REMAINING-SESSIONS.md`.

**Status context (README §0, §12, §13; git log):** wave 1 shipped as one merge (#167, `759fb554` is HEAD of the checkout). Pilot freeze 06.11-10.11 (ציקטי live 8.11): nothing merges to `main`. Wave-2 packages build on branches / draft PRs; first integration on `release/wave-2` after 10.11. No wave-2 package is merged yet. Human-PR packages (ʰ) are proposals a human authors and merges. Wave 3 opens ~06.12 (G-14 first), wave 4 ends ~30.01 (`ref/MASTER-PLAN.he.md` timeline rows 61-68).

**Existing worker jobs (code, `apps/worker/src/jobs/`):** baselines, dailyExpectations, endOfDayReport, findJobInvoice, healthDigest, importCatalog, matchInvoice, monthlyReport, ocrInvoice, ocrSweep, orderReminders, outboxDispatch, priceAlerts, recoveryReminders, retention, supplierDelays, syncPlatforms. Jobs run inside Vercel at `/api/cron/jobs` (README §0; G-06 §8). `sync-platforms` has no producer and is not scheduled (STATE.md arch notes). `cron.ts` and `outbox.ts` are immutable (human-PR).

---

## 1. Wave-2 packages: what each delivers, and which automations

Legend: ʰ = human-PR proposal. "Step" = merge step in README §10. Status = "brief ready; build on branch, not merged" for all unless noted. Abbreviations as README §9 (`dash/` = `apps/web/app/dashboard/`, `api/` = `packages/api/src/`, `wkr/` = `apps/worker/`, `cmp/` = `apps/web/lib/components/`).

| ID | One line | Owner agent | Write boundary (short) | Depends on (hard / soft) | Status / step | Automations it already delivers |
|---|---|---|---|---|---|---|
| W2-01ʰ | Split the cross-tenant COVERAGE manifest into per-package fragments | test-sentinel (tenant-security-warden reviews) | `api/__tests__/cross-tenant.attack.test.ts` (COVERAGE only), `coverage/{index,README}`, `coverage-manifest.test.ts` | none | proposal; human review 8-10.11; step 1 (merges first) | Dev automation only: CI fails when a new tRPC procedure has no coverage fragment |
| W2-02 | Invoice register, invoice cockpit and intake inbox | web-feature-engineer | `dash/{invoices,inbox}/**`, `web/app/scans/**`, `cmp/{invoice,documents}/**`, `api/routers/{invoices,ingest,match}.ts`, msgs | G-05 (state adapter), G-07, G-09 (attach/split), W2-05 (`invoice.correct`) | step 5 | Register auto-bucketed by canonical state incl. tab "ללא מספר הקצאה"; saving an OCR edit **re-matches automatically** and shows ₪ before→after; bulk "פענחו N" OCR; OCR outcome inline; consolidated panel single action "לדרישת הזיכוי" |
| W2-03 | Pay run that ends: due dates, mark paid, holds, short-pay, remittance | web-feature-engineer (leak-economist + matching-engine-guardian sign claims rule) | `dash/approvals/pay-run/**`, `api/routers/payRun.ts`, `api/lib/{claims,dueDate}.ts`, `msg/payRun/**` | W2-01, G-05, **H-03 deployed** (`paid_at`), W2-09a / G-03 `payment_deductions`, W2-04, W2-10 | step 6; `markPaid` behind `PAY_RUN_MARK_PAID` (off) | `computeDueDate` from שוטף+N (EOM+N), מזומן, explicit date; law-limit warn chip (`PAYMENT_LAW_MAX_DAYS_AFTER_EOM`, proposed 45); auto-bucketing באיחור/השבוע/שבוע הבא/מאוחר; **auto holds** (duplicate copy, dispute with "₪X במחלוקת מתוך ₪Y", missing allocation number via `vatAtRisk()`, open leak until G-14, G-04 `note_billed_twice`); short-pay writes `payment_deductions` per claim (VAT grossed up); click-only "שלחו תזכורת" to the decider via `notify()`; remittance print per supplier; §10 addendum renders G-17 "תנאים קצרים מהמוסכם" chip; sorts by agreed due date |
| W2-04 | Approvals desk: invoice-level 3-pane, bulk, keys, history, notification landing | web-feature-engineer (tenant-security-warden mandatory) | `dash/approvals/**` (not pay-run), `api/routers/approvals.ts`, new `api/approvals/bulkPolicy.ts`, `wkr/src/jobs/{matchInvoice,endOfDayReport}.ts`, msgs | G-05, G-07, **G-12a**, **W2-10a**, W2-13a, G-06 | step 5 | **Server-enforced** bulk cap ₪200/invoice, never bulk a `block`; `channel:'quick'` one-tap guard ₪500 (H-05 wires the button); **claim materialized inside the decision** (`materializeClaims`); escalation = `emit('discrepancy.escalated')` + `notify` owners; every notification deep-links `/dashboard/go?r=&to=…?invoice=`; `endOfDayReport` + approval e-mail read G-12 `awaitingDecision` / `claimableLines`; re-match releases/rebinds claims; DeadlineChip ageing |
| W2-05 | Receiving 2: walk-in, multi-page capture, exceptions with evidence, offline outbox, desk view | ocr-procurement-engineer (tenant-security-warden mandatory) | `dash/receiving/**`, `web/lib/pwa/**` (outbox, `DocumentCapture`), `receiver-sw.js`, `api/routers/{receiving,scans}.ts`, `api/receiving/**`, msgs | G-05, G-07, W2-06 (`resolveExpectedPrice`), G-06, G-10, G-03/H-03 (interims) | step 4; 3 PRs, slice A first | IndexedDB **outbox with replay** (`grLine`, `submitReceipt`, `photo`, `slipShared`); offline shell + precache of today's POs; `resumeState` (no second OCR job); walk-in → GR + retro draft PO (`walk_in:<grId>`); doc-type chip defaulted from supplier history; delivery note stored on GR not as invoice; exception Sheet → `emit('receipt.closed_with_exceptions')` → managers + owner notified via dispatcher; "הכל הגיע" 2-line spot check, rest "לא נספר"; `todayExpectations` board by `deliveryState` |
| W2-06 | Orders 2: order guide, cut-off board, send from my WhatsApp, chef orders, supplier changes | web-feature-engineer (tenant-security-warden mandatory; leak-economist signs `resolveExpectedPrice`) | `dash/orders/**`, `api/routers/orders.ts`, `api/orders/**`, msgs | G-07 (chef path), G-08 (`matchLine` exact-only), G-06 | step 4 | **Order guide built from last 8 POs**; `supplierBoard` sorted by next cut-off with countdown chips (warn ≤3 h, danger ≤30 min); server draft autosave per line; `markSentManually` (wa.me hand-off, no outbox row); `resolveExpectedPrice` = contract > own last explicit price > list, never invoice; `placeOrder` via typed address; supplier answer diff "הספק שינה 2 שורות" (accepting into expectation = H-04/H-08) |
| W2-07 | Inventory count as a field instrument, audited food-sales denominator | web-feature-engineer | `dash/inventory/**`, `api/routers/inventory.ts`, `api/inventory/**`, msgs | W2-05 slice A (outbox kind), G-04 `receiptTruth`, W2-15 drafts, G-07 | step 4 | Fat-finger guard (e.g. "999 תבניות"); previous count shown; offline count via outbox; manager hand-off ("ספירה מוכנה לסגירה"); `setSales` audited |
| W2-08 | Task spine and homes v2: one "מחכה לך" queue, nav badges, bell | web-feature-engineer (tenant-security-warden; leak-economist signs ₪ labels) | `dash/{page,layout,nav,…}`, `dash/home/**`, `web/lib/nav/**` core, `cmp/{hero,notifications}/**`, `api/routers/{tasks,nav}.ts`, `api/tasks/**` | G-12a, G-07 | step 7 | **Computed per-viewer task spine `tasks.mine`** (type, ₪, tier, due, age, verb, deepLink); `nav.badges` one batched query refetched every 60 s; in-app bell; `nav.whereIs` explains cross-branch links. No OS notification/sound (H-05); server seen-state is H-04 |
| W2-09 | Leak evidence and drill: every ₪ explains itself | web-feature-engineer (matching-engine-guardian owns `packages/charts` changes) | `dash/leaks/**` (not claims), `packages/charts/**`, `api/routers/owner.ts`, `api/leaks/{evidence,reportExport}.ts`, `cmp/{views,drill,flags}/**` | none (09a by ~12.11, 09b ~15.11, 09c) | steps 2/7 | Evidence fields recomputed per line; one why-formatter `whySegments` (adopted by letters + approvals); `DrillLink` parity; period resolver `resolveWindow`; **`leakDrivers` auto top-3 contributors to Δ**; 3-sheet XLSX + CSV export; month-start rule "החודש עוד ריק · חודש שעבר ₪X" (README §13) |
| W2-10 | Claims composer (phase 1) and recovery desk | web-feature-engineer (leak-economist signs letter wording) | `dash/leaks/claims/**`, `dash/recovery/**`, `api/routers/recovery.ts`, `api/recovery/**` (incl. `reminders.ts`) | G-05, G-03 `claim_letters`, W2-09b, W2-03 (`markPaid`) | step 5; 10a `materializeClaims` ~18.11 | Claims created at decision (idempotent); **one saved letter per supplier auto-built** from `recovery_claims`, two sections (לקיזוז / לזיכוי), evidence auto-attached (dock photo, invoice crop, contract price); preview + wa.me/mailto hand-off with 10 s undo (no server send = H-06); desk ranked by owed ₪ × days overdue; server VAT conversion of credit notes; **auto-advance credited → recovered** on the G-05 paid event; overdue reminders = per-supplier **draft, click-only**; managers' daily digest kept; `reminders.ts` stops calling `syncClaims`; CSV/XLSX export with history |
| W2-11 | Supplier 360, vendor table and bookkeeper's ledger | web-feature-engineer | `dash/suppliers/**` (not leak-card), `api/routers/suppliers.ts`, `api/ledger/**`, msgs | G-05, G-04 `receiptTruth`, G-06 (`E164Phone`) | step 5 | One 90-day leak def; ח״פ check-digit validation; WhatsApp number E.164 normaliser; **canonical payment-terms picker** ("מזומן"/"שוטף"/"שוטף+N"), the source of agreed terms for G-17 (§10 addendum); ledger coverage via `closedReceiptSql`/`INVOICE_CHECKED`/note helper. Bank details + change alert = H-03 |
| W2-12 | Contracts and price intelligence: one ₪ queue | web-feature-engineer (leak-economist signs labels) | `dash/contracts/**`, `api/routers/{contracts,priceAlerts}.ts`, `api/{contracts,priceAlerts}/**`, msgs | G-05 (PR a), H-01, W2-04 deep link | step 5 | One ₪-ranked "לטיפול" queue merging over-contract lines + price alerts; **≈₪/month estimate** per alert; T2 only at ≥3% and ≥₪50/month; cheaper-offer action deep-links to a new order; threshold live preview "4 התראות ב-90 יום"; "נעלו מחירים נוכחיים כחוזה" (`lockCurrentPrices`); import diff step with ₪/month before commit. PDF/photo price lists out of scope |
| W2-13 | Copy system: glossary-as-code, bidi isolation, server copy into i18n | rtl-design-steward | `web/lib/i18n/{translate,glossary,…}`, `msg/{emails,components,common}/**`, `api/notifications/{templates.ts,copy/**}`, `api/match/persist.ts`, `cmp/ActivityFeed.tsx` | G-05, G-13 | step 5; 13a templates by 18.11 | Glossary enforced by a test; e-mail / WhatsApp / activity copy from reviewed i18n (`EMAIL_COPY`) |
| W2-14 | Admin trust: visible rules, guarded roles, honest exports | web-feature-engineer | `dash/{settings,team,exports,integrations}/**`, `api/routers/{settings,team,integrations,exports}.ts`, `api/exports/**`, `api/integrations/accounting/**` | G-07, G-05 actions | step 5 | `settings.effective` shows effective approval rules/tolerances; every settings change audited + history drawer; staged role change, ownership transfer; export says what it contains (disputed ₪ counted, skipped listed, no invented card codes); bookkeeper edits account cards with audit; profile phone + WhatsApp-ready verification (OTP; `phoneVerify` off) |
| W2-15 | DS adoption and primitive maintenance | rtl-design-steward | `cmp/**` (unowned folders), new `web/lib/drafts/**`, `packages/ui-tokens/**`, `globals.css`, tailwind, eslint, `ds-check.sh`, `web/package.json` + lockfile | none (15a by 14.11) | steps 2/8 | Lint + `ds-check.sh` guards; shared draft/leave-guard kit (field drafts never lost); print rule |
| G-04 | Match-input truth: only counted lines, no draft POs, closed POs still match | matching-engine-guardian | `api/match/{buildMatchInput,consolidated}.ts`, new `api/match/receiptTruth.ts` | G-03 `counted_at` (interim), G-05 | step 2 | Engine reads only counted lines, closed receipts, real POs; closed synced POs still discovered. **§9 addendum (1.11):** three consolidated flags auto-raised as review items (not new DiscrepancyType): `note_other_month`, `note_not_in_system` (blocks "תואמת"), `note_billed_twice` (T2 "אפשר שחויב פעמיים · ₪X", pay-run hold, never in hero) |
| G-05 | Write-path kernel: guarded transitions, safe replay, domain events | web-feature-engineer | new `api/{lifecycle,invoices,discrepancies,events}/**`, `api/lib/idempotency.ts`, `api/activity.ts`, `api/audit.ts` | G-03 objects (detected) | step 2 (≤21.11) | **The event backbone**: guarded `UPDATE … WHERE status = ANY(from)`, CONFLICT with who/when, replay-safe `clientMutationId`, one audit row + **one domain event (`emit`) per move**, effects in savepoints (e.g. `claim` effect, `paid` event). Every event-driven automation hangs on this |
| G-06 | Real recipients and honest delivery; OCR-failure hand-off | ocr-procurement-engineer (+ web-feature-engineer) | `api/notifications/{address,recipients,notify}.ts`, `api/reports/send.ts`, `wkr/src/jobs/ocrInvoice.ts` | G-05, W2-13a, G-07 | step 4 | **`notify()`** resolves audience (people / role / PO sender / deciders) to verified addresses at enqueue; never `role:` targets; mocks report `skipped_no_provider` not `sent`; **quiet hours 23:00-06:00 + Shabbat** and **≤6/person/day** enforced via `scheduled_at` + `payload.digest=true`; failed OCR read → uploader + managers notified |
| G-07 | Capability model: who sees vs who decides | web-feature-engineer (tenant-security-warden mandatory) | `api/lib/{roles,capabilities}.ts`, `api/trpc.ts`, `api/routers/activity.ts` | none | step 2 | `CAP` table + `can()`, `VISIBLE_TO` / `ACT_ON` (routing basis for "who to notify / who may act"); activity feed redacted for no-`money.view` roles |
| G-08 | Product links with provenance: a guess never becomes certainty | ocr-procurement-engineer (leak-economist signs policy) | `packages/catalog/**`, `packages/ocr/src/pipeline.ts`, `api/catalog/**`, new `wkr/scripts/catalog-alias-remediation.ts` | G-03 `source` (interim) | step 4 | `decideLink` → `auto | review | new` shared by import, OCR, order capture; OCR auto-links only sku/barcode/alias ≥0.999; fuzzy link learns no alias; **read-only remediation report** of past guessed links (decision 24). "לקשר" UI = W3-10 |
| G-09 | Multi-page documents on every intake path | ocr-procurement-engineer | `api/ingest/**`, new `api/documents/**` | G-05 | step 4 | `composeDocument`/`attachAsPage`/`splitDocument`: dock camera, e-mail and **WhatsApp** photos of one invoice become one invoice with all pages in OCR |
| G-10 | Supplier answer contract on `/s/<token>` | web-feature-engineer | `api/supplierConfirm/**`, `web/app/s/[token]/**`, `web/app/api/supplier-confirm/**`, msgs | W1-09 | step 4 | Explicit, complete, intent-checked supplier answer (422 / 409 replay); `expectedQtyForLine` for W2-05 / H-08 (supplier-reported shortage expected at the dock) |
| G-11 | Legal surface inventory and one set of legal links | growth-pmm-engineer | `web/lib/legal/{registry,LegalLinks}`, marketing shells, `robots/sitemap`, `publicPaths` | none | step 4 | Test fails if a mandatory legal doc is missing/unlinked (dev automation) |
| G-12 | "Awaiting decision" as one function; Ask facts with period; frozen mobile | web-feature-engineer (leak-economist) | new `api/approvals/awaiting.ts`, `api/ask/**`, `apps/mobile/app/{owner,manager}/**`, `msg/ask/**` | W2-09a, G-07 | 12a step 2, 12b step 7 | `awaitingDecision()` = one figure for queue tiles, home, badge, **digest e-mail**; Ask facts carry their period and refuse unfair month comparisons |
| G-13ʰ | `parseDecimalInput` + isomorphic `moneyText` | money-format-marshal | `packages/types/src/{number-input,money/**}`, `api/reports/{bidi,money}.ts`, `wkr/src/lib/notifyHelpers.ts`, POS/recipes CSV | none | proposal; step 3 | One number parser for typed/imported numbers; `moneyText` for e-mails, WhatsApp, PDF (bidi-correct ₪ outside JSX). Prerequisite for any outbound message with ₪ |
| G-17 *(in-flight, kit diff)* | Payment terms from the paper; "תנאים קצרים מהמוסכם" | ocr-procurement-engineer | `packages/ocr/**` (fields, prompt, fixtures), header persistence in `ocrInvoice.ts`, new `api/lib/termsCheck.ts` | W2-03 `dueDate.ts`; train B consolidated OCR; soft W2-11 picker | starts after train B on `main` | OCR extracts printed terms + due date into `ocr_payload.raw.printedTerms/printedDueDate`; `termsCheck` → `ok|shorter|unknown`; warn chip in pay run; carries no ₪ |
| H-01ʰ | `formatIls` `signDisplay` option | money-format-marshal | `web/lib/money.ts` + tests | none | proposal; step 3 | none (display) |
| H-02ʰ | Legal and consent | growth-pmm-engineer drafts; counsel + owner author | marketing legal pages, consent, `web/lib/legal/{operator,subprocessors,docs}.ts` | G-11 | proposal; step 8 (when counsel signs) | Legal-readiness tests; sub-processor list (matters before any new provider such as WhatsApp/Meta) |
| H-03ʰ | Schema batch A: money pipeline and notification plumbing | web-feature-engineer drafts; tenant-security-warden + matching-engine-guardian review | `schema.ts` (additive), one migration, `rls/0002` list, shape tests | G-03 merged | proposal; step 6; gate to wave 3 | Enabling data only: `invoices.paid_at/paid_amount/payment_method/payment_ref`, `export_runs`, `leak_month_*` snapshots, claim `seq_no` + address, **supplier bank details with change audit (BEC fraud)**, min order/fee, `po_lines.line_no`, price-list dates, push/WhatsApp consent (`users.whatsapp_opt_in*`), **`notification_prefs`** (per user/channel/event_kind, quiet defaults) |

**Already planned after wave 2 (do not re-propose; extend instead)** — `docs/ux/IMPLEMENTATION-PLAN.md` §4-§5, `ref/GAP-PACKAGES.md` 199-258 / 417-436, `ref/MASTER-PLAN.he.md` 137-165:
- **H-05ʰ Delivery and scheduling** (`outbox.ts`, `cron.ts`): real Web Push (VAPID) + WhatsApp utility templates `rm_decision_needed`, `rm_delivery_late`, `rm_claim_reply`; role → member phone at enqueue; quiet hours + holidays; ≤6/day; **late-truck check every 15 min**; **claim-chase drafts on days 3/7/14 awaiting a tap**; monthly report and digest send; saved-view subscriptions; registers H-07 close job; dispatcher single sender; supplier-order template.
- **H-06ʰ Supplier claim portal + server send**: 72 h token per letter, supplier accepts/disputes per line and uploads a credit note, status moves automatically.
- **H-07ʰ ₪ definitions and closed months**: hero partition, funnel נמצא → נדרש → זוכה → הוחזר, `leakMonthClose` monthly snapshot on the 5th.
- **H-04ʰ Schema batch B**: `saved_views`/`view_subscriptions`, `notification_seen`, revised expected qty/price on `po_lines`, `purchase_orders.opened_at`, `suppliers.billing_mode`, count shelf order, `waste_entries`, device/PIN (FG-18), outbox `CHECK (target NOT LIKE 'role:%')`.
- **G-14ʰ** leak ledger + money states + decision→effect table + metric registry; **G-15ʰ** typed `basis` per discrepancy, info-row routing, **pay-approval rule** (over ₪N or new supplier → owner); **G-16** cross-surface invariant suite.
- **W3-03** installable PWA, push UI, `share_target` (file → invoice capture, text → order capture), **06:00 receiver brief "3 משלוחים היום"** (`dailyExpectations`, `supplierDelays` jobs), app badge. **W3-04** ⌘K, Ask everywhere, **AI drafts (draft-only, "טיוטה של RestoMatch")**. **W3-05** month close with **6-step auto-ticking checklist**, export preview, "רק מה שחדש מאז", accountant zip. **W3-08** one monthly report (tabs mail / WhatsApp / PDF; send via H-05). **W3-09** PO lifecycle fired by events, late = expected + 60 min, notify sender on each transition, supplier portal 2.0, coverage line "בדקנו 78% מהרכש". **W3-10** price-list inbox (PDF/photo/paste, "מה ישתנה"), "לקשר" queue ranked by unmapped ₪. **W3-11** OCR document-type classifier, **credit-note intake with suggested claim allocation**, **supplier statement (כרטסת) reconciliation with flags → tasks**.
- **Wave 4:** W4-01 gates to error; **H-08ʰ** engine accepts revised supplier expectation (known shortage → T4) + consolidated accept; H-09ʰ CI gates; **H-11ʰ** server-side money visibility.

---

## 2. Wave-2 brief format (template to mirror for wave-3 briefs)

Every brief is one file `docs/ux/wave2/<ID>.md`, ~80-225 lines, same 8 numbered sections (CRITIQUE.md check 1: "All 28 briefs exist and have §1-§8"). Addenda append as §9/§10 "Addendum <date> (owner decision, binding)". Exact skeleton:

```
# <ID> · <Title: outcome-phrased, ≤ ~12 words>
**One line:** <what changes for the user, in ₪ terms, with a concrete lab number ("today: …")>.
  (optional bullets: per-surface outcomes, "**Today:**" evidence)
**Owner agent:** <agent> (<reviewer agents and what they sign>). **Device:** phone|desktop|both|server.
**Effort:** S|M|L (and slicing, e.g. "Ship as 3 PRs"). **humanPR:** yes|no (<why / which immutable stays untouched / which H-package covers it>).

## 1. Start here (first 20 minutes, in this order)
  Checked-on commit line ("All paths checked on release/wave-1 @ <sha>; re-grep after rebase").
  Numbered list of exact files with line ranges and what each range is.
  "Commands" block: lab.sh <ID> [flags]; every DB/test cmd prefixed `. ~/.rm-lab/<slug>/env &&`;
  targeted vitest files; consumer tests that must stay green; COVERAGE check; e2e spec.

## 2. Write boundary
  - **Own (may edit):** paths (+ coverage/<ID>.ts, e2e/<ID>.spec.ts, __screenshots__/<ID>/**)
  - **Read-only (consume, don't edit):** other packages' paths, with owner IDs
  - **Never touch:** immutable list items relevant here + nearby wave paths with their owners
  - (optional) **Ledger correction / path additions** needing orchestrator OK

## 3. Depends on / order
  - **Hard:** IDs + what is needed from each
  - **Soft:** IDs
  - **Not dependencies (later waves; never wait):**
  - **Until they land:** the interims (flags default off, adapters, stubs) and what to build first
  - MASTER-PLAN step, window, **Base** and **Branch** name (`claude/ux-<id>-<slug>`)

## 4. What to fix and build
  - **Findings:** review IDs (area-NN, P0/P1) with one-line problem each
  - **Deep-fix classes carried:** class number · name · how this package applies it
  - **GAP Part B amendments (<ID>):** bullets
  - (owner decisions applied)

## 5. Acceptance criteria
  Numbered, each **bold label** + testable bullets; exact procedure names/signatures,
  exact Hebrew copy strings, lab numbers, server-side enforcement, roles.
  Ends with "Where the docs conflict:" resolution bullets when needed.

## 6. Tests (write them failing first)
  Per test file: cases (unit / db / attack add-only / COVERAGE fragment / e2e incl. ₪-left-of-digit bbox, axe he+en, Tab-walk).

## 7. Done =
  DoD-1..9 subset with routes/viewports; CI green; no immutable path;
  any intended ₪ change → signed before/after (leak-economist, matching-engine-guardian); canary unmoved;
  orchestrator check layer; then ONE message to the orchestrator session (PR link, what changed, what's left).

## 8. Token-efficient working notes for this package
  What to read by range only, what to reuse (named primitives/functions), and **Trap:** bullets.
```

PR body sections (README §5): Acceptance checklist · Evidence · Owner decisions applied · Placeholders · Path additions / requested exceptions · API for dependents · Human-PR proposals. Messages: `[<ID>] GREEN|BLOCKED|QUESTION · PR #<n> · ≤3 lines` (README §6). Smaller packages (G-06, G-11, G-13, H-02, W2-13, W2-15) use the same headings with compressed bodies; G-17 (new) uses a reduced 1/2/3/4/5 = Start here / Write boundary / Depends / Acceptance / Done.

---

## 3. Owner decisions and binding rules

**Governance (AGENTS.md, README §5, §8):** PR-only autonomy; agents never merge, deploy, write prod DB, send e-mail/WhatsApp or spend money. Self-repair cap 2. Immutable (human-PR only): `packages/matching/**` (engine, 12-type `DiscrepancyType` union, tolerances, units, canary + fixtures), `apps/web/lib/money.ts` (`formatIls`), RLS SQL + `rls.ts`, applied migrations/`meta/`/`schema.ts`/`drizzle.config.ts`, `cross-tenant`/`rls` attack tests (add-only), `plans.ts` + `packages/billing/*`, **`approvals/engine.ts`, `notifications/outbox.ts`, `apps/worker/src/cron.ts`**, `leads.ts` + trpc route + `rateLimit.ts`, `.github/workflows/*`, `.claude/agents/*`, `AGENTS.md`, `OPERATING.md`. After G-13: `packages/types/src/{number-input.ts,money/**}` and `api/reports/{bidi,money}.ts`. Credentials (Meta/WhatsApp, VAPID, ITA, bank, accounting APIs) = Phase 6, human-only; build behind a provider interface with a stub (`functional-gaps.md` §3). Only W2-15 adds dependencies; only W2-13 adds i18n namespaces; `api/index.ts` takes serialised one-line exports.
**Implication for automation:** any new schedule, delivery channel or routing rule lands in `cron.ts`/`outbox.ts`/`approvals/engine.ts` → human-PR (already H-05 / G-15). New event types should use G-05 `emit()` and G-06 `notify()`; new columns/tables → an H-schema batch.

**Owner decisions (README §7, §12, §13):**
- Terms: חשבונית מרכזת, פער, דרישת זיכוי, קבלת סחורה; "דליפה" only for the monthly leak; price creep = "מחירים שעלו"; **never show a "1.5% target"**.
- Roles: receiver and chef see no purchase/leak ₪ (server strip = H-11); chef orders directly, no approval, sees ₪ on orders screens and in recipes (plate cost, menu price, margin); bookkeeper reads everything and edits account cards with audit; one login per person (own e-mail + password), no PIN.
- **Money limits (server-enforced):** bulk approve ≤₪200 per invoice; one-tap WhatsApp approve ≤₪500; a blocking item is never bulk-approved.
- Payment: a paid invoice keeps its claims; "נתפס" measured at decision time; שוטף+N = end of month + N, warn at the Payment-Delays law limit; **undecided gaps are never sent to suppliers (decision 18)**; **one channel per state (19)**: offset before payment, credit claim after, never both.
- Product: 30-day Pro trial; old mobile app FROZEN.
- **Alerts: none 23:00-06:00 or on Shabbat; at most 6 per person per day; an overdue-claim reminder is a draft that sends only on a click (decision 16).** Nothing goes to a supplier automatically (W2-10 AC 12).
- Receiving/orders: "הכל הגיע" → 2-line spot check, rest "לא נספר" (20); walk-in supplier approved by the manager, expected price contract → own last price → list, never the invoice (21); colleague photos upload with attribution (22).
- Process: AGENTS.md number-input amendment is a human PR (23); fixing existing bad data = read-only reports + human approval, after the pilot (24).
- Design: LIGHT command center; RTL, he-IL, ₪ only via `formatIls()`/`<Money>`; WCAG AA; tiers T1 hero leak, T2 act-now (solid badge + ₪ + one CTA), T3 calm good news, T4 neutral pending/consolidated (never a false alarm); tokens only.
- 31.10 evening: MISSING_ON_INVOICE is not claimable and is out of the leak figure; **a credit demand is overdue after 7 days** (one shared constant); side menu approved; a design-elevation track runs separately.
- 1.11 (kit diff, README §13): real consolidated detection in train B before the pilot; **payment terms all in wave 2** (W2-11 picker, W2-03 due date, G-17 OCR, "תנאים קצרים מהמוסכם" flag, no ₪); three consolidated flags (G-04 §9); **no new `DiscrepancyType`** — new findings are review items/flags, entering the leak only via a human engine PR; month-start honesty rule ("החודש עוד ריק · חודש שעבר ₪X").
- ICP scope veto (`docs/ICP.md` §5): par-levels / forecast / inventory management as core = anti-ICP drift; recurring orders "later"; cross-supplier `product_group_id` "later" (not building now). Weekly leak report and per-supplier catalog = fast-follow.
- Research report strategic leanings (not decided, `report.md` "שאלות אסטרטגיות"): subscription not contingency; show found / stopped / credited separately and "מע״מ בסיכון" in a different colour, outside the leak; agent freedom = send on click, reminders only with approval; WhatsApp ordering before direct Zester/MarketMan; smart pay run now, payments partner later; free leak check on last month; 10-15 field interviews before building door-evidence and the recovery agent.

---

## 4. Earlier research (`docs/research/ניהול חשבוניות ספקים במסעדות/report.md`) — top recommendations vs plan

| # | Recommendation (report roadmap) | Planned where | Gap |
|---|---|---|---|
| 1 | Allocation-number guard: flag >₪5,000 pre-VAT invoices without מספר הקצאה, ₪ at risk (18%), **draft request to supplier**, **6-month offset countdown** | Flag exists (`owner.vatAtRisk`, `vat-at-risk.tsx`); W2-02 register tab; W2-03 hold "בקשו מהספק"; W2-08 surfaces ₪ VAT at risk; W3-05 checklist step | **Not planned:** drafted request to supplier + tracking until a corrected invoice arrives (FG-28); 6-month countdown; ITA verification of number ↔ invoice |
| 2 | VAT per line and per supplier (0% fresh produce / 18% processed) | — | **Not planned** (engine = human PR; G-15 basis only adds `vat_rate` source) |
| 3 | Consolidated invoice ↔ delivery notes + monthly supplier ledger | Train B detection; G-04 + §9 flags; W2-02 panel; W2-11 ledger; H-03 brings ₪3,603 into leak; H-08 consolidated accept | Mostly covered |
| 4 | Evidence at the door: signed delivery-note photo, quick count, **voice note**, even without a PO | W2-05 (photos, note, driver, signature, walk-in) | Voice note / scale-display photo not planned |
| 5 | Three numbers: found / stopped before pay / actually credited, against checked spend | G-14 money states, H-07 funnel, W3-09 coverage line | Covered in wave 3 |
| 6 | Recovery agent: draft → owner sends → reminders → credit note captured and linked → close/escalate; KPI "₪ returned / ₪ found" | W2-10 (composer, click send, auto-advance), H-05 (chase drafts 3/7/14), H-06 (portal), W3-11 (credit-note intake + allocation) | Credit-note **auto-match from e-mail/WhatsApp intake** to claims, and the ₪ returned / ₪ found KPI as an explicit metric, not named |
| 7 | Supplier statement vs ledger reconciliation | W3-11 | Wave 3 (not wave 2) |
| 8 | WhatsApp/e-mail invoice intake + **WhatsApp order → system PO** | Intake channels exist; G-09 multi-page WhatsApp; W3-03 share_target text → order capture | Parsing a supplier/WhatsApp order message into a PO automatically: not planned beyond share_target |
| 9 | Public Hebrew OCR accuracy benchmark; per-field confidence; **fixed arithmetic checks** (qty×price, Σ+18%, allocation no. when >₪5,000); per-supplier layout memory; review only the doubtful field | W2-02 shows OCR line confidence; G-08 provenance | Arithmetic self-checks, per-supplier template learning (FG-25), labelled corpus: **not planned** |
| 10 | Smart pay run: pay only undisputed, due-date calendar, **bank-detail change alert** | W2-03 (due dates, holds, short-pay); H-03 bank details + change audit | The alert/hold itself on bank change (FG-30) not assigned to a package; cash forecast + Masav/bank batch file (FG-26) not planned |
| 11 | Accountant pack: PCN874 pre-check, full uniform structure (C100/D110), Hashavshevet/Priority/Rivhit export, branded leak report | W2-14 honest exports; W3-05 close + accountant zip | PCN874 pre-check, D110 lines: not planned |
| 12 | Dish cost with POS data (Beecomm then Tabit) | W3-02 recipes/food-cost room | POS-driven "₪/month off margin per dish" alert not planned |
| 13 | Catch-weight tolerance per product/supplier | — (FG-14, needs `units.ts`/`tolerances.ts` human PR) | Not planned |
| 14 | Supplier portal: price list with validity dates; ITA allocation check | G-10/W3-09 portal (order answers); H-03 price-list dates; W3-10 price-list inbox | Supplier-maintained price list via portal; ITA check: not planned |
| 15 | In-app supplier payment via licensed initiator | — | 2027+, not planned |
| 16 | Legal digital archive ("מסמך סרוק", e-signature) | — | Not planned |

---

## 5. ICP facts for impact estimates

- **North Star:** ≥1.5% of a restaurant's food spend surfaced as leak, in ₪, that one owner believes (`AGENTS.md`, `docs/ICP.md`).
- **Who:** independent owner-operator ("איתן"), **1-3 branches** (4-8 = secondary ICP), **food purchasing ₪80k-₪400k/month** (sweet spot ₪150k-₪400k), **5-20 deliveries/week** (best 10-20), receiving checked by hand or not at all; the buyer is the owner, distribution via the external bookkeeper/accountant ("מיכל", handles 10-30 restaurants, samples after payment), daily user the receiver ("רמי", target receiving <3 min). Hard gates: one human decision-maker (no procurement dept/ERP) and a human receiver at the door (no dark kitchens). MarketMan/Zester connected = warm input (`docs/ICP.md` §1, §4).
- **Price:** Pro ₪590/month (ICP §1); report also cites ₪349 vs Rivhit DOCS ₪30 (pricing source of truth is `packages/db/src/plans.ts`).
- **Leak size:** 1.5% of ₪80k-₪400k = **₪1,200-₪6,000/month**; Pro pays back at ~₪39k/month spend if leak is 1.5%, ~₪59k at 1% (report "שליש מהחשבוניות"). Only measured restaurant study: 35% of invoices overcharged, ~1% of invoice value (US 2015); Ottimate 2026: 26% of grocery invoices with a discrepancy, 51% of restaurant customers had ≥1 duplicate; cross-industry 0.8-2%+ of payments; recovery audits get back only ~0.1-0.15%; ~80% of audit recoveries come from statement/ledger reconciliation (missing credits), duplicate-detection software catches ~20%.
- **Profit context:** US full-service <$2M: 1.1% pre-tax margin, food 33.7% of sales → 1.5% food leak ≈ 46% of profit; Israeli food cost ≈30% of revenue; single-digit margins; Tel Aviv closures +22% in 2025.
- **Market:** ~12,000 active food-service businesses in Israel (42% no employees); ~2,000 full-service restaurants (Ontopo); our estimated target 5,000-7,000.
- **Process facts:** orders by phone/WhatsApp/app; signed delivery note is the only real-time evidence; big suppliers bill a monthly consolidated invoice that must list delivery notes; payment שוטף+30..+90 (1.5-4 months after delivery) — errors caught before payment can be offset instead of claimed; law default שוטף+45 when unspecified; VAT 18% since 1.1.2025; fresh produce 0% VAT; **allocation number required >₪5,000 pre-VAT since 1.6.2026** (else 18% VAT not deductible; e.g. ₪1,080 on a ₪6,000 invoice); input VAT must be offset within 6 months; PCN874 detailed reporting for turnover >₪500k; credit-note follow-through is unmeasured anywhere.
- **Messaging cost:** WhatsApp service replies within 24 h of a customer message are free since 1.7.2025; restaurant-initiated supplier messages are paid template messages needing Meta approval and supplier opt-in.
- **Pains (owner / bookkeeper / receiver):** "is someone cheating me" in one ₪ number; month-end ledger matching by hand ("dozens of alcohol and meat invoices never reached the system", UNIT4); slow receiving; one wrong leak number destroys trust (competitor reviews: stale prices, failed scans, hard credit tracking); PO-less spend invisible (₪675-1,125/month at ₪150k, W2-05 one-liner).
- **Lab anchors (demo tenant, 25.10):** hero leak ₪759.54; ₪296.00 awaiting decision (4 items, 2 blocking); ₪463.54 to claim; ₪1,123.20 VAT at risk; 33 paid invoices with ₪1,758.58 open claims; ₪3,603 consolidated spend outside the leak (W2-03, W2-08, W2-09, G-05, H-03 one-liners).

---

## 6. Gaps: automation ideas in the docs not scheduled in any wave-2 package

(Each item: source → current coverage. "Wave 3" = sketched in IMPLEMENTATION-PLAN/GAP-PACKAGES but not briefed.)

1. **Allocation-number chase workflow**: one-tap request to supplier (WhatsApp/e-mail template), track until a corrected invoice arrives, pay-run block until then, 6-month VAT-offset deadline countdown (`functional-gaps.md` FG-28; report #1). Wave 2 only flags/holds.
2. **ITA verification** that an allocation number belongs to this invoice (amount, ח.פ, date) (report #1, #14). Unscheduled; credential + legal question.
3. **Per-line VAT (0%/18%) classification** per supplier/product, killing false VAT alerts (report #2). Unscheduled; engine human PR.
4. **OCR self-checks**: qty×price = line, Σ lines + VAT = total, allocation number present when >₪5,000, routed to field-level review; per-supplier learned corrections/templates; Hebrew accuracy benchmark (report #9; FG-25). Unscheduled.
5. **Approval recommendation** (claim / accept / waive) with evidence: last 5 prices, contract, dock note, past decisions on the SKU (FG-23). Unscheduled (W3-04 drafts are adjacent, not this).
6. **Approval ageing reminders + delegation** ("האצל למנהל עד…", day-2/day-3 nudges) (FG-24; ainative). Wave 2 has click-only remind (W2-03) and escalation (W2-04); automatic nudges belong to H-05 territory but are not listed in H-05's contents.
7. **Bank-detail change alert / payment hold** (report #10; FG-30). H-03 stores bank details + change audit; no package raises the alert or holds the pay run.
8. **Cash forecast (13-week) and bank batch file (Masav/bank CSV)** from the pay run (FG-26). Unscheduled.
9. **Supplier statement reconciliation** (FG-27; report #7) and **credit-note intake → claim allocation** — wave 3 W3-11 only; nothing in wave 2.
10. **Daily brief / "never tell twice" digest** (07:30, drops items already seen in-app) (`ainative.md` P21-P22). H-05 sends digests; `notification_seen` in H-04; the seen-aware daily brief design is not specified anywhere.
11. **Weekly leak report "every Sunday: ₪X caught, ₪Y blocked before payment"** (`docs/ICP.md` §5-§6, fast-follow). Only monthly report (W3-08) + generic digest (H-05); no weekly cadence scheduled.
12. **Cut-off reminders / timed order nudges** (FG-05). W2-06 shows countdown chips only; `orderReminders` job exists; a cut-off-driven reminder is not in any brief.
13. **Supplier-reported change → expectation** auto-accept (FG-08; W2-06 shows diff only) — H-04/H-08 in waves 3-4.
14. **WhatsApp/voice/photo order → PO** (report #8; FG-07). Only W3-03 share_target text → order capture; voice/handwritten sheet not planned.
15. **Catch-weight tolerance** per product/supplier (FG-14; report #13). Unscheduled (human PR).
16. **POS-driven margin impact alerts** ("tomatoes +18% at supplier X ≈ ₪1,140/month off 6 dishes") (report #12, `ainative`/`restaurant` P22). W3-02 covers recipes; the POS link and push alert are not planned.
17. **Supplier scorecard with delivery KPIs** (late %, short %, credit response time) (FG-32). Unscheduled.
18. **Supplier-maintained price list with effective dates via portal** (FG-33; report #14). H-03 adds price-list dates; W3-10 price-list inbox is restaurant-side; portal side unscheduled.
19. **PCN874 pre-check + full uniform structure (C100+D110) export** (report #11). Unscheduled (W3-05 does export/close only).
20. **Duplicate-billing across invoices beyond consolidated notes** (e.g. same items re-billed next month) — engine has DUPLICATE_INVOICE; cross-month duplicate detection via statements is W3-11 only.
21. **Dock evidence → auto-drafted claim at the door** (`restaurant.md` §9 P1, pattern 11). W2-05 records evidence; claim still born at the owner's decision (W2-04/W2-10); a door-time draft is not planned (and decision 18 forbids sending undecided gaps).
22. **₪ returned / ₪ found as a tracked KPI and pilot measurement design** (report conclusion, Q1, Q8). H-07 funnel exists in wave 3; making the pilot a measurement (Israeli leak rate, PO-less share — `functional-gaps.md` §5) is not scheduled.
23. **Legal digital archive** (scanned-document marking, e-signature) (report #16) and **in-app supplier payment** (report #15). Unscheduled (legal/regulatory).
24. **Free last-month leak check as acquisition automation** (report Q7) — W3-06 "mobile leak check" covers the marketing side.

Out of scope by ICP veto (do not propose as core): par-levels / forecast / inventory management (FG-06), standing/recurring orders (FG-03, "later"), cross-supplier price compare / mini-RFQ (FG-10), waste/transfer (FG-34), shared tablet PIN (FG-18, contradicted by the per-person login decision).
