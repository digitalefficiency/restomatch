# 10 · Automation catalogue A1–A26 and impact (authoritative)

Written 2026-11-07. This note expands the design spec §2 catalogue into one entry per automation. It is the single source for each automation's trigger, human checkpoint, data, impact, effort, money-truth guardrail, roles, reuse, package and phase. The wave-3 automation briefs (`docs/ux/wave3/AU-xx.md`) and the report cite this file. They do not restate the numbers.

**Sources.** Code facts come from `int-01..07` and were re-checked on `release/train-a` @ `c6132c0e` (scratchpad `trainA`). Every `file:line` in the reuse lines and in §C was grepped there on 2026-11-07. Plan facts come from `int-00`, `docs/ux/wave2/README.md` and `docs/ux/IMPLEMENTATION-PLAN.md` §4. External facts come from `ext-01..05`, and their labels are kept: **[V]** means vendor claim, **[I]** independent, **[S]** secondary. Owner rules and AGENTS.md bind every entry.

**Correction to the spec, found while verifying.** On train-A the pilot flag set already includes `recovery`, `supplierLedger` and `monthlyReport` (`apps/web/app/admin/restaurants/[id]/FeaturesPanel.tsx:20-31`, `packages/db/scripts/pilot-config.ts:26-37`). What is still missing is `priceAlerts` and `vatAtRisk`, then `payRun` and `consolidatedMatch` once W2-03 and G-04 have merged. A1 and D1 should read that way.

---

## 0. How the impact numbers are built (read before any number)

**The typical ICP restaurant** (spec §1; every input is an ASSUMPTION the owner can edit):

| Input | Value | Note |
|---|---|---|
| Food spend | ₪200,000/month | ICP sweet spot ₪150k–400k |
| Branches / suppliers | 1 / ~12 active | |
| Deliveries | ~14/week, ~60/month | average delivery ≈ ₪200,000 / 60 ≈ **₪3,333** |
| Supplier documents | ~80/month (invoices, delivery notes, consolidated, credit notes) | average document ≈ ₪2,500; **~60 invoices/month** that go to payment |
| Leak detected at 1.5% | **₪3,000/month** | owner North Star, a target and not a benchmark (ext-05 §2.2) |
| Claimable share | 60% → **₪1,800/month** | excludes MISSING_ON_INVOICE, PRICE_LOWER, UNORDERED_ARRIVAL (`packages/api/src/lib/claims.ts:22`). ASSUMPTION |
| Collection share today | ~35% of claimable | ASSUMPTION. No source publishes a credit recovery rate (ext-05 §2.1, ext-04 §5) |
| Consolidated invoices | 3–5/month | ASSUMPTION (3–5 of 12 suppliers bill monthly) |

**Loaded hourly rates.** These are gross × 1.25 (ext-05 §4.3): receiver/shift ₪63, bookkeeper ₪89, manager ₪103, chef ₪127, owner ₪150 (the owner rate is an opportunity-cost ASSUMPTION the owner can edit).

**Formulas.**
- **time-₪/month = hours/week × 4.33 × loaded rate.** This is labour value, not cash. An external bookkeeper is usually paid a flat ₪300–3,000/month or per document (ext-05 §4.1), so the restaurant's cash only falls if the fee falls. Every bookkeeper line below carries that caveat.
- **money-₪/month** is leak recovered, VAT kept deductible, a duplicate or wrong payment stopped, or an avoided cost. Each line says which. Lumpy items show an expected value and the per-event ₪.
- **Time-₪ and money-₪ are never added together**, not per item and not in any total. No grand total is given: the items overlap (§D says where).
- Ranges are conservative. Vendor numbers are context only and never enter the arithmetic. After 30 days of pilot, AU-07 telemetry replaces every ASSUMPTION (P5).

**Status keys.** Effort S/M/L follows the wave-2 convention. Phase A runs 16–30.11, B in December, C in Jan–Mar 2027. "HUMAN-PR" means an immutable file per AGENTS.md.

---

## A. Catalogue at a glance

Hours are per week. Both ₪ columns are per month, and the two columns are never added.

| ID | Automation | Main roles | Hours/week | time-₪/month | money-₪/month (kind) | Effort | Package | Phase |
|---|---|---|---|---|---|---|---|---|
| A1 | Pilot switch-on + owner toggles | owner, admin | 0–0.1 | ₪0–65 | enabler (₪ counted in A13/A18) | S–M | AU-01 | A |
| A2 | Time ledger + automation KPIs | admin, owner | 0 | — | enabler (measures everything else) | M | AU-07 | A |
| A3 | Receiver morning truck brief (no ₪) | receiver | 0.1–0.5 | ₪25–140 | not counted (≈₪15–35 shortage made visible, illustrative) | S | AU-04 | A |
| A4 | Evening decision digest, fixed | manager, owner | 0.5–1 | ₪220–450 | not counted (protects offset channel, see A12) | M | AU-04 | A |
| A5 | Order reminder truth | chef, manager | 0–0.5 | ₪0–275 | ₪0–200 avoided emergency buys (not leak) | S | AU-04 | A |
| A6 | Late-truck chase draft | manager | 0.02–0.12 | ₪10–55 | none | S | AU-04 | A |
| A7 | Honest match alerts | owner, manager | 0–0.25 | ₪0–160 | none (trust) | S | AU-04 | A |
| A8 | Supplier from ח״פ + dead check revived | manager | 0.04–0.15 | ₪20–70 | protective (counted in A19) | S–M | AU-02 | A |
| A9 | Consolidated recognition from real OCR | bookkeeper | 0.1–0.3 | ₪40–115 | removes false leak (trust) | S (verify first) | AU-02 | A |
| A10 | Stuck-OCR re-sign + review nudge | manager | 0.02–0.1 | ₪10–45 | keeps ≈₪35–110 of leak in coverage (not additive) | M | AU-02 | A |
| A11 | Ask: waiting / stuck / owed / to pay | owner, manager, bookkeeper | 0.25–0.5 | ₪110–225 | none | M | AU-06 | A |
| A12 | Recovery chase loop v1 | manager, bookkeeper | 0.6–1.25 | ₪260–545 | **₪150–450 recovered** (bundle with W2-10: ₪300–900) | M | AU-03 | A |
| A13 | Allocation-number guard + chase | bookkeeper, owner | 0.02–0.1 | ₪10–40 | **₪0–1,100 VAT kept** (₪1,080 per miss on ₪6,000) | M | AU-08 | B |
| A14 | Consolidated autopilot (propose) | bookkeeper | 0.2–0.75 | ₪75–290 | ₪0–1,100 billed-twice stopped (lumpy, outside leak) | L | AU-09 (+H-08) | B/C |
| A15 | Intake autopilot 2 | manager, bookkeeper | 0.18–0.55 | ₪75–230 | duplicate caught earlier (counted in A19) | M | AU-10 | B |
| A16 | Order autopilot | chef, manager | 0.25–0.7 | ₪135–385 | none counted | M | AU-11 | B |
| A17 | Decision SLA nudge + weekly bookkeeper digest | bookkeeper, owner | 0.5–1 | ₪195–385 | not counted (overlaps A12; ≈₪100–250 illustrative) | M | AU-12 (+H-05) | B |
| A18 | Price creep in ₪/month | owner, manager, chef | 0–0.25 | ₪0–110 | ₪100–600 avoided cost (outside leak) | M | AU-13 | B |
| A19 | Pay-run pre-flight | owner, bookkeeper | 0.25–0.5 | ₪95–195 | **₪150–1,200 wrong payment stopped** (≈₪3,333 per event) | M | AU-14 | B |
| A20 | Learn from decisions | owner, manager | 0.04–0.12 | ₪20–55 | none (fewer false alarms) | M | AU-15 | B |
| A21 | Earned autonomy (per-supplier auto-approve) | owner | 0.05–0.2 | ₪30–130 | none; a capped risk budget (≤₪300/invoice) | L | AU-16 + H-12 | C |
| A22 | Supplier communication loop | owner, manager | 0.1–0.3 | ₪45–135 | ₪90–180 recovered (inside the A12 bundle range) | L | AU-17 | C |
| A23 | Missing-documents report + ITA diff | bookkeeper | 0.17–0.63 | ₪65–245 | ₪0–450 VAT reclaimed (ITA part, later) | M + L | AU-18 | C |
| A24 | Payment file + bank-evidenced recovery | owner, bookkeeper | 0.06–0.2 | ₪25–80 | none new (measures "recovered") | L | AU-19 | C |
| A25 | Produce market benchmark (opt) | owner | 0 | — | ₪0–800 avoided cost (speculative, T4 info) | M | backlog, icp-keeper gate | C+ |
| A26 | POS Z-report feed (opt) | manager | 0–0.1 | ₪0–45 | none to the North Star | M | backlog, ICP veto risk | later |

---

## B. The catalogue, item by item

### Phase A: wire before build (16–30.11)

#### A1 · Automations switch-on: pilot defaults + owner self-serve toggles
- **Trigger → action.** An owner or platform admin turns on allow-listed flags from a new "אוטומציות" settings page. The page lists each automation with plain-Hebrew what / when / who, on/off, last run and count this week. The pilot set grows by `priceAlerts` and `vatAtRisk` now, and by `payRun` and `consolidatedMatch` once W2-03 and G-04 have merged. (`recovery`, `supplierLedger` and `monthlyReport` are already in the train-A pilot set; see the correction above.)
- **Human confirms.** The owner confirms each flag, and every toggle writes an audit row. The admin keeps the `FEATURES_OFF` kill-switch, which always wins.
- **Data.** `restaurants.settings.features` jsonb, which exists. No schema change. A new `OWNER_TOGGLEABLE` allow-list constant in `features.ts`.
- **Impact.** Owner 0–0.1 h/week, because no admin round-trip is needed per toggle: 0.1 × 4.33 × ₪150 = **₪0–65/month time-₪**. Money-₪: none directly. It switches on the 07:00 price sweep and the VAT-at-risk card that A13 and A18 build on, and their ₪ is counted there. Today the 07:00 `priceAlerts` job loops all tenants and no-ops on every pilot tenant (`packages/api/src/priceAlerts/sweep.ts:63-75`).
- **Effort.** S–M.
- **Money-truth risk → guardrail.** An owner switching on a half-built flow (for example `payRun` before W2-03, which would show "ניתן לשלם" on a row with no allocation number) could cause harm. Guardrail: the allow-list excludes flags whose prerequisite package has not merged, `FEATURES_OFF` wins, every change is audited, and the page shows what each flag sends and to whom.
- **Roles.** Owner (toggles); admin (kill-switch); everyone else sees the effect only.
- **Reuse.** `admin.setFeatures` (`packages/api/src/routers/admin.ts:364-404`); `FeaturesPanel.tsx:20-31` (`PILOT_DEFAULTS`); `packages/api/src/lib/features.ts:11-48` (keys), `:56-71` (default off, kill-switch); `packages/db/scripts/pilot-config.ts:26-37`.
- **Package / phase.** AU-01 · A (decision D1, D2).

#### A2 · Instrumentation: time ledger and automation KPIs
- **Trigger → action.** Every invoice, receipt, claim and notification event feeds per-restaurant, per-week KPIs: docs in; % zero-touch (no header or line edit, no mapping); median minutes from arrival to matched; % exceptions; median approval age; alerts sent / opened (where known) / acted; ₪ funnel found → decided → claimed → sent → credited → recovered (MISSING_ON_INVOICE excluded, definitions as in H-07); and a time-ledger estimate using the editable rate table, shown apart from leak ₪.
- **Human confirms.** Nothing. It is read-only.
- **Data.** Derived from `audit_log`, `activity_events`, `notifications_outbox`, `recovery_claims` / `recovery_events`, `match_runs`, `invoices`. No schema change. If a timestamp is missing (for example the moment a human first opened a document), AU-07 proposes it to H-13 rather than adding it.
- **Impact.** No hours saved and no ₪ directly. It is the item that turns every ASSUMPTION in this file into a measured number within 30 days of the pilot (P5). External context: no competitor publishes measured per-customer time or a recovery rate (ext-05 §1.3, §2.2; ext-03 §0.1). Ardent's 2026 best-in-class exception rate is 11.8% **[S]**, and it is used here as an internal target only.
- **Effort.** M.
- **Money-truth risk → guardrail.** A second ₪ definition could drift from the hero. Guardrail: the charts SQL in `packages/charts/src/automation.ts` is owned by matching-engine-guardian and reuses the single leak definition. Its funnel definitions must equal H-07's. A parity test runs against the canary fixtures.
- **Roles.** Admin page first; owner view later.
- **Reuse.** `matchActivitySummary` (`packages/api/src/match/persist.ts:245`); the `recovery_claims` stamps (`schema.ts:2142-2177`); outbox rows (`packages/api/src/notifications/outbox.ts:18-65`, read-only).
- **Package / phase.** AU-07 · A.

#### A3 · Receiver morning truck brief (no ₪)
- **Trigger → action.** The existing 06:00 `daily-expectations` run enqueues one message per receiver-role member: today's suppliers, expected time, line count, late trucks, and a deep link to the board. It goes through the in-app bell and e-mail now, and WhatsApp/push after H-05 (D3).
- **Human confirms.** Nothing. It is information only.
- **Data.** `DailyExpectationsEntry`, which already carries no ₪ (`apps/worker/src/jobs/dailyExpectations.ts:27`); `memberships` for receivers. No schema change.
- **Impact.** Receiver 0.1–0.5 h/week (fewer "is X coming?" calls, the board opened less often): 0.1–0.5 × 4.33 × ₪63 = **₪25–140/month time-₪**. Money-₪ is not counted. Illustration only: if the brief prevents one uncounted delivery a month, then ₪3,333 × a 0.5–1% short rate (ASSUMPTION; chain fill-rate floors are 99.5–99.7%, ext-05 §2.1 **[I]**) ≈ ₪15–35 of QTY_SHORT becomes visible. A delivery with no goods receipt has no QTY_SHORT at all.
- **Effort.** S (inside AU-04).
- **Money-truth risk → guardrail.** ₪ could leak to the receiver, because `todayExpectations`, `getPo`, `getInvoice` and `dockSlip` serve ₪ to the receiver role server-side (§C bug 5). Guardrail: the brief is built from a ₪-free projection in `packages/api/src/briefs/**`, never from those procedures. A test asserts that the payload has no ₪ glyph or amount. The dedupe key is per receiver per day, and quiet hours apply through `scheduled_at`.
- **Roles.** Receiver (recipient); manager (receives the late-truck part through A6).
- **Reuse.** `processDailyExpectations` output (`dailyExpectations.ts:54-142`; today it only writes the audit row at `:123-132`); `recipientsForRestaurant(db, rid, ['receiver'])` (`packages/api/src/notifications/recipients.ts:35-60`, default `MANAGER_ROLES` at `:28`); `enqueueNotification` (`outbox.ts:18`, called, not edited).
- **Package / phase.** AU-04 · A. It pulls forward the W3-03 receiver brief, and the ledger hands `dailyExpectations.ts` back to W3-03 afterwards.

#### A4 · Evening decision digest, fixed and extended
- **Trigger → action.** The 19:00 end-of-day run sends one digest per role: decisions waiting (count, ₪, oldest age), invoices due within 2 days still held, open receipts, and claims overdue ≥7 days. It removes never-claimable types from "open credits" and renders ₪ through `moneyText`. A quiet day sends nothing.
- **Human confirms.** Every decision stays human. The digest only links to it.
- **Data.** `discrepancies`, `invoices.due_date` (written once W2-03 lands), `goods_receipts`, `recovery_claims`. G-12 `awaitingDecision()`, G-13 `moneyText`, W2-04 go-links.
- **Impact.** Manager 0.5–1 h/week (one digest instead of opening approvals, pay run, receiving and recovery): 0.5–1 × 4.33 × ₪103 = **₪220–450/month time-₪**. Money-₪ is not counted separately. The "due ≤2 days still held" line keeps decisions on the cheaper channel (offset before payment rather than claim after), but that ₪ is the same claimable ₪1,800 that A12 counts.
- **Effort.** M.
- **Money-truth risk → guardrail.** Today's figure is wrong: it sums every open discrepancy, including MISSING_ON_INVOICE and PRICE_LOWER (§C bug 4). Guardrail: the figure comes from `claimableLines` / G-12 only, uses the same constant as recovery, and passes a parity test against the approvals queue total.
- **Roles.** Owner, manager; bookkeeper opt-in (D6). The receiver gets no ₪. The chef gets none.
- **Reuse.** `apps/worker/src/jobs/endOfDayReport.ts:55-65` (the query to fix), `:110-111` (payload); `NEVER_CLAIMABLE_TYPES` (`lib/claims.ts:22`); `queueSummary` (`packages/api/src/routers/approvals.ts:311`).
- **Package / phase.** AU-04 · A. W2-04 owns `endOfDayReport.ts` in wave 2 (it reads G-12), so AU-04 builds on it and does not duplicate it.

#### A5 · Order reminder truth
- **Trigger → action.** At 09:00 `order-reminders`, an unsent draft no longer counts as "ordered". The chef becomes a recipient. The message deep-links to the prefilled draft or the W2-06 order guide.
- **Human confirms.** The chef or manager edits and sends the order.
- **Data.** `purchase_orders.status`, `suppliers.order_schedule`, memberships (chef).
- **Impact.** Chef 0–0.5 h/week: 0.5 × 4.33 × ₪127 = **₪0–275/month time-₪**. Money-₪ is an avoided cost, not leak: 0–1 missed order a month × a ₪1,000 emergency buy × a 10–20% cash-and-carry premium ≈ **₪0–200/month**. Both inputs are ASSUMPTIONS.
- **Effort.** S.
- **Money-truth risk → guardrail.** Low. The chef may see ₪ on orders (owner rule). The reminder carries no leak ₪.
- **Roles.** Chef, manager, owner.
- **Reuse.** `apps/worker/src/jobs/orderReminders.ts:81-89` (the non-cancelled filter that silences reminders on drafts); `recipientsForRestaurant` roles argument.
- **Package / phase.** AU-04 · A. AU-11 takes over the job file after AU-04 merges.

#### A6 · Late-truck chase draft
- **Trigger → action.** On `supplier-delays` days 1, 3 and 7, the manager mail carries a pre-addressed `wa.me` / `mailto` chase text to the supplier contact ("ההזמנה #X מ-dd.MM לא הגיעה"). The receiver is told the truck is late, with no ₪.
- **Human confirms.** The manager taps send from their own phone. Nothing goes to a supplier automatically.
- **Data.** `suppliers.contact_whatsapp` / `contact_email` (`schema.ts:433-434`), PO ref.
- **Impact.** Manager 0.02–0.12 h/week (2–6 late POs a month × 3–5 min of lookup and typing saved): **₪10–55/month time-₪**. Money-₪: none. A late truck is not leak.
- **Effort.** S.
- **Money-truth risk → guardrail.** Negligible. The text names the PO and date, not ₪. The 15-minute intraday check stays in H-05.
- **Roles.** Manager (sends); receiver (informed, no ₪).
- **Reuse.** `CHASE_DAYS = [1, 3, 7]` (`apps/worker/src/jobs/supplierDelays.ts:54`); `waLink` (`apps/web/app/dashboard/orders/[poId]/detail-client.tsx:40,177`).
- **Package / phase.** AU-04 · A. H-05 later adds the 15-minute late check and the WhatsApp template.

#### A7 · Honest match alerts
- **Trigger → action.** The match-invoice notification shows ₪ = the leak-filtered claimable amount (excluding MISSING_ON_INVOICE, PRICE_LOWER and UNORDERED_ARRIVAL) through `moneyText`. With no claimable ₪, it shows a "to review" count. It notifies again when a re-match grows or re-opens a finding.
- **Human confirms.** Nothing. It is an alert.
- **Data.** `PersistMatchResult.rolesNeedingNotification`, which is already computed for new or changed findings (`persist.ts:397`).
- **Impact.** Owner 0–0.25 h/week of false escalations avoided: 0.25 × 4.33 × ₪150 = **₪0–160/month time-₪**. Money-₪: none. It protects trust: today an alert can quote the full ordered value of a missing line as "הפסד פוטנציאלי".
- **Effort.** S.
- **Money-truth risk → guardrail.** The alert ₪ differing from the hero ₪ is today's bug (§C bugs 3 and 11). Guardrail: one figure from `matchActivitySummary` / `claimableLines`, `moneyText` only (no `toFixed`), and a test that a MISSING_ON_INVOICE-only run shows ₪0.
- **Roles.** Whoever the routing engine selects (owner, manager, bookkeeper).
- **Reuse.** `apps/worker/src/jobs/matchInvoice.ts:191` (`!replaced` gate), `:194`, `:240` (₪ string); `matchActivitySummary` (`persist.ts:245-287`).
- **Package / phase.** AU-04 · A. Routing itself stays with H-12 (§D).

#### A8 · Supplier auto-detect from ח״פ, and the dead check revived
- **Trigger → action.** OCR finishes with `supplier_id NULL` and a valid `reconciled.supplier.businessId`. The system looks up `suppliers.business_id` (normalised) and sets a *suggested* supplier. When the supplier is known, it passes `expectedSupplierBusinessId` to the checks gate, so a mismatch routes the document to review.
- **Human confirms.** The manager confirms the supplier with one tap. A mismatch always goes to review.
- **Data.** `suppliers.business_id` (`schema.ts:432`), `invoices.ocr_payload.raw.reconciled`. No schema change.
- **Impact.** Manager 0.04–0.15 h/week (20–40 inbox documents a month × 0.5–1 min of dropdown search saved): **₪20–70/month time-₪**. Money-₪ is protective. A supplierless invoice bypasses the invoice-number + supplier duplicate layer (int-01 §6), and a wrong supplier corrupts price comparison. The ₪ effect is counted once, under A19.
- **Effort.** S–M.
- **Money-truth risk → guardrail.** A wrong auto-assignment would compare an invoice against the wrong supplier's prices. Guardrail: a suggestion only, never a silent write. The mismatch check fails closed into review. G-08 provenance applies: a guess never becomes certainty.
- **Roles.** Manager, owner.
- **Reuse.** `packages/ocr/src/checks.ts:87,217` (option exists, never passed); `ingest.approveDocument` (`packages/api/src/routers/ingest.ts:318`); the ח״פ normaliser in `routers/suppliers.ts` (`assertNoDuplicate`).
- **Package / phase.** AU-02 · A.

#### A9 · Consolidated recognition from real OCR
- **Trigger → action.** `reconciled.documentKind === 'consolidated'` stamps `raw.kind`, lifts the period and delivery-note list to `raw.*`, skips the auto-match, shows the invoice as T4 neutral, and tells finance that the proposal is ready.
- **Human confirms.** The bookkeeper reviews the read-only proposal. No ₪ is written.
- **Data.** `invoices.ocr_payload.raw.reconciled.{documentKind, deliveryNotes, periodStart, periodEnd}`, which are already extracted.
- **Impact.** Bookkeeper 0.1–0.3 h/week (3–5 consolidated invoices a month × 10–15 min of false-alarm triage avoided): 0.1–0.3 × 4.33 × ₪89 = **₪40–115/month time-₪** (labour value; see the bookkeeper caveat in §0). Money-₪ removes a false leak rather than adding ₪. Today a scanned מרכזת is PO-matched like a normal invoice and can raise large false MISSING/UNORDERED findings. The lab carries ₪3,603 of consolidated spend outside the leak.
- **Effort.** S, because recognition must be verified first. Owner decision: consolidated detection lands before the pilot in train B. If main already has it, AU-02 only adds tests.
- **Money-truth risk → guardrail.** A false "consolidated" stamp would hide a real leak. Guardrail: only `documentKind` from the reconciled read sets it, and the findings stay T4 review items (G-04 §9 flags), never a new DiscrepancyType (P6).
- **Roles.** Bookkeeper, owner, manager (finance roles only see the proposal).
- **Reuse.** `packages/api/src/match/consolidated.ts:727` (recognition key `raw.kind`); `consolidatedProposal` (`consolidated.ts:1027`); `apps/worker/src/jobs/ocrInvoice.ts:266-287` (where `reconciled` is written).
- **Package / phase.** AU-02 · A (verify-first).

#### A10 · Stuck-OCR re-sign and needs-review nudge
- **Trigger → action.** An invoice `ocr_pending` for more than 25 minutes gets its storage path re-signed and is re-enqueued once. This runs on the web cron tick, which holds the storage credentials, not in `cron.ts`. A `needs_review` document older than N hours gets one manager nudge, riding the existing 19:00 or 06:45 slot.
- **Human confirms.** Nothing for the retry. The manager acts on the nudged document.
- **Data.** `invoices.status/created_at`, `ingest_documents.status`, the storage path.
- **Impact.** Manager 0.02–0.1 h/week of re-uploads and hunting avoided: **₪10–45/month time-₪**. Money-₪ is coverage, not additive. An invoice stuck unread is unchecked spend: 1–3 stuck documents a month (ASSUMPTION) × ₪2,500 × 1.5% ≈ ₪35–110 of the leak target stays inside coverage.
- **Effort.** M.
- **Money-truth risk → guardrail.** A double OCR could create two invoice rows or double meter usage. Guardrail: re-enqueue at most once (the dedupe-key pattern of `ocrSweep`), the advisory lock in `registerInvoice`, and metering unchanged (billing is immutable).
- **Roles.** Manager; ops.
- **Reuse.** `signedUrlForStoragePath` (`packages/api/src/ingest/store.ts:48`); `apps/worker/src/jobs/ocrSweep.ts:50-54` (10–25 min window, batch 50).
- **Package / phase.** AU-02 · A.

#### A11 · Ask: "what's waiting / stuck / owed / to pay"
- **Trigger → action.** A question in Ask calls new read-only tools: `waiting_for_me` (queueSummary / myQueue), `intake_stuck`, `who_owes_me` (recovery), `to_pay_this_week` (payRun due buckets, once W2-03 lands) and `vat_at_risk`. Each answer cites tool output and deep-links.
- **Human confirms.** Nothing. It is read-only and has no write tool.
- **Data.** Existing read models only.
- **Impact.** Manager 0.25–0.5 h/week of navigation: 0.25–0.5 × 4.33 × ₪103 = **₪110–225/month time-₪**. Money-₪: none.
- **Effort.** M.
- **Money-truth risk → guardrail.** An invented ₪ figure (ext-04 §4, Air Canada liability). Guardrail: every ₪/% is checked against tool output (`ask/grounding.ts`); role redaction (receiver and chef get no ₪, except the chef on orders and recipes); a Hebrew golden-question regression set of at least 20 questions. Text-to-SQL is never used (ext-04 §3.6).
- **Roles.** Owner, manager; bookkeeper read-only per the W3-04 decision.
- **Reuse.** The tool registry (`packages/api/src/ask/tools.ts:180-204`, four leak tools today); `queueSummary` (`approvals.ts:311`), `myQueue` (`:185`); `findOverdue` (`packages/api/src/recovery/reminders.ts:35`).
- **Package / phase.** AU-06 · A. It hands `ask/**` to W3-04 afterwards.

#### A12 · Recovery chase loop v1 (on top of W2-10)
- **Trigger → action.** The 08:30 `recovery-reminders` run uses one overdue rule shared with the UI (the single 7-day constant). The bookkeeper becomes an opt-in recipient. It builds one pre-addressed supplier reminder draft per supplier. A credit line on a matched invoice raises a T2 row "אשרו זיכוי ₪X", with the supplier's oldest open claims pre-selected.
- **Human confirms.** The manager taps send for every supplier reminder (decision 16; nothing goes automatically). A user confirms every credit allocation through `recordCreditNote`.
- **Data.** `recovery_claims` (incl. `last_reminder_at`), `credit_notes`, `suppliers.contact_*`. No schema change.
- **Impact.**
  - Hours: manager 0.5–1 h/week (contact lookup, re-chasing, reading credit notes) → ₪220–450; bookkeeper 0.1–0.25 h/week (allocation pre-selected instead of 6–10 typed inputs, int-04 §5) → ₪40–95. **Time-₪ ₪260–545/month.**
  - Money-₪ (recovered). The recovery bundle (W2-10 letters at decision + A12 chasing + later A22) moves the collection share of the ₪1,800 claimable from ~35% to ~65% (both ASSUMED): ₪1,800 × 0.30 = **₪540/month central, range ₪300–900**. The low end is 35%→50%; the high end is 25%→75%. The share attributed to A12 alone is ASSUMED to be about half: **₪150–450/month**. AU-07 measures the real split.
- **Effort.** M.
- **Money-truth risk → guardrail.** Two risks: chasing a never-claimable line, and a wrong allocation marking a claim credited. Guardrails: `findOverdue` excludes `NEVER_CLAIMABLE_TYPES`; one shared `OVERDUE_DAYS`; allocation stays oldest-first in integer agorot and needs a confirm; a claim enters `credited` only through `recordCreditNote`. The stale "14+ days" comment is fixed (§C).
- **Roles.** Manager, owner (send); bookkeeper (opt-in, allocation, D6).
- **Reuse.** `enqueueRecoveryReminders` (`packages/api/src/recovery/reminders.ts:128`), `findOverdue` (`:35`); `OVERDUE_DAYS` / `REMIND_EVERY_DAYS` (`packages/api/src/recovery/service.ts:322-324`); `CLAIM_ANSWER_DAYS` (`lib/claims.ts:34`); `followUps` (`apps/web/app/dashboard/recovery/logic.ts:186`); `creditLineSuggestions` (`service.ts:654`); `allocateCredit` (`packages/api/src/recovery/lifecycle.ts:68`).
- **Package / phase.** AU-03 · A, after W2-10 and W2-04 merge. `recovery/**` goes to W3-11 afterwards (decision D5: acknowledged claims are still chased, with softer wording).

### Phase B: proposals with ₪ (December)

#### A13 · Allocation-number guard and chase
- **Trigger → action.** An invoice above the dated threshold without a valid 9-digit מספר הקצאה is held (₪10k for 1 Jan–31 May 2026; ₪5k from 1 Jun 2026, using the effective-date table, never a blog's ladder; ext-02 §0.1). The hold itself is W2-03; A13 adds the rest. It builds a pre-addressed request draft to the supplier, an editable allocation field, and an ITA "אימות פרטי חשבונית" deep link with the fields ready to copy. A countdown to the 6-month deduction deadline appears in the digest.
- **Human confirms.** The owner or bookkeeper sends the request and types the number. The ITA check is manual (R1). An API check (R2) only arrives if the buyer-side service is confirmed (ext-02 §0.2, UNVERIFIED).
- **Data.** `invoices.allocation_number` (`schema.ts:817`, exists). `updateInvoiceHeader` gains the field (no schema change). `suppliers.contact_*`.
- **Impact.** Bookkeeper/owner 0.02–0.1 h/week (0–1 case a month: 15–20 min of copy, look-up and follow-up falls to ~5 min): **₪10–40/month time-₪**. Money-₪ is VAT kept deductible and shown **outside the leak**: 18% input VAT on an invoice above ₪5,000 pre-VAT. One miss on a ₪6,000 invoice = ₪1,080. At 0–1 missing a month (ASSUMPTION), expect **₪0–1,100/month**. It is lumpy: most months ₪0, sometimes ₪1,000+.
- **Effort.** M.
- **Money-truth risk → guardrail.** Mixing VAT ₪ into the leak, or a false hold on a 0%-VAT produce invoice. Guardrail: "מע״מ בסיכון" is its own figure in its own colour (leak-economist signs it). The threshold uses pre-VAT amounts from the date table (`vatAtRisk.ts:22-35`). A format check alone never claims the number is valid.
- **Roles.** Owner, bookkeeper; manager sees it.
- **Reuse.** `vatAtRisk()` (`packages/api/src/vat/vatAtRisk.ts:96`), `ALLOCATION_THRESHOLDS` (`:22-27`); `supplierRequestText` (`apps/web/lib/vat/requestText.ts:18`); `receiving.updateInvoiceHeader` (`packages/api/src/routers/receiving.ts:610`).
- **Package / phase.** AU-08 · B (after W2-02 and W2-03).

#### A14 · Consolidated autopilot (propose)
- **Trigger → action.** When a recognised מרכזת arrives (A9), the system proposes the delivery-note set: same supplier, open notes, subset-sum to the total ± tolerance. It explains the residual ₪ by cause: discount, price, quantity, note in another month, note billed twice. The accept link is H-08.
- **Human confirms.** The bookkeeper accepts the set. The write path is human-PR H-08.
- **Data.** `invoices`, delivery-note coverage, G-04 §9 flags (`note_other_month`, `note_not_in_system`, `note_billed_twice`). The accept needs H-03/H-04 columns through H-08.
- **Impact.** Bookkeeper 0.2–0.75 h/week. The manual line-up of 20–45 min per invoice falls to ~5 min, at 3–5 invoices a month (ASSUMPTION; Zestt's documented flow is fully manual, ext-01 §0.4 **[V help doc]**). That is 0.2–0.75 × 4.33 × ₪89 = **₪75–290/month time-₪** (labour value). Money-₪ is a double billing stopped before payment and kept **outside the leak hero** (G-04 §9: T2 "אפשר שחויב פעמיים · ₪X", pay-run hold). One duplicated delivery note ≈ ₪3,333. At 0–1 per quarter (ASSUMPTION), expect **₪0–1,100/month**, lumpy.
- **Effort.** L.
- **Money-truth risk → guardrail.** A wrong subset that happens to sum to the total would hide a real gap. Guardrail: the proposal only, never auto-accepted. Ambiguous sets (more than one subset fits) are shown as ambiguous. The residual is explained, never zeroed. No new DiscrepancyType. Consolidated stays T4 neutral until accepted.
- **Roles.** Bookkeeper, owner.
- **Reuse.** `consolidatedProposal` (`packages/api/src/match/consolidated.ts:1027`), `deliveryNoteCoverage` (`consolidated.ts:1193`; `packages/api/src/ledger/coverage.ts:77`).
- **Package / phase.** AU-09 · B (propose). Accept is C, via H-08.

#### A15 · Intake autopilot 2
- **Trigger → action.** Several proposals:
  - A supplier saved with a phone/e-mail, or the same unknown sender approved twice → propose an allow-list row.
  - Bulk approve N documents from one sender.
  - A cross-channel possible duplicate (same supplier and total, date ±2 days, different channel) → T4 hold on auto-match.
  - The bookkeeper can upload a loose invoice with no goods receipt (impossible today).
  - An e-mail receipt goes to the sender. WhatsApp acknowledgment comes only after the H-05 templates.
- **Human confirms.** The manager confirms each allow-list row, bulk approve and duplicate verdict. The bookkeeper confirms the supplier on a loose upload.
- **Data.** `ingest_senders`, `ingest_documents`, `invoices` (supplier, total, date, `raw.duplicateOf`).
- **Impact.**
  - Hours: manager 0.08–0.3 h/week (20–40 inbox documents × 1–2 min of triage saved) → ₪35–135; bookkeeper 0.1–0.25 h/week (no typing of PO-less invoices in another system) → ₪40–95. **Time-₪ ₪75–230/month.**
  - Money-₪: the cross-channel duplicate is caught at intake instead of at payment. The ₪ is counted once, under A19.
- **Effort.** M.
- **Money-truth risk → guardrail.** Allow-listing the wrong sender would let a forged invoice reach OCR spend and the queue. Guardrails: the allow-list is always a manager tap; DMARC still gates e-mail auto-register; the duplicate hold is a UI-level T4 hold, never a DiscrepancyType.
- **Roles.** Manager, bookkeeper.
- **Reuse.** `ingest.addSender` (`routers/ingest.ts:196`), `approveDocument` (`:318`); the `writeOcrHeader` `duplicateOf` pattern (`ocrInvoice.ts:270,294`); `scans.upload`.
- **Package / phase.** AU-10 · B. WhatsApp/e-mail credentials are Phase-6, human-only.

#### A16 · Order autopilot
- **Trigger → action.** On an order day, N hours before the cut-off (the 09:00 slot until the H-05 addendum adds the intraday check), the system prepares a DRAFT PO from the W2-06 order guide and says "טיוטה מוכנה". Quantities are the median of the last POs. Prices come from `resolveExpectedPrice`, never from an invoice. A partial close produces a backorder draft with the missing quantities. A failed PO send pushes the prepared text with a one-tap `markSentManually`.
- **Human confirms.** The chef or manager edits and sends every order. Nothing is sent automatically (ext-03 §2.5: everyone suggests, nobody auto-sends).
- **Data.** `purchase_orders`, `po_lines`, `gr_lines`, `suppliers.order_schedule`, contracts. No schema change. The backorder link is in the PO metadata, or proposed to H-13 if a column is needed.
- **Impact.** Chef 0.25–0.7 h/week (about 14 orders a week × 1–3 min each). This is the increment on top of the W2-06 guide, which already removes most of the ~40 taps. Time-₪: 0.25–0.7 × 4.33 × ₪127 = **₪135–385/month**. Money-₪: none counted. A backorder draft gets short goods re-ordered. The shortage ₪ is already counted by the engine as QTY_SHORT.
- **Effort.** M.
- **Money-truth risk → guardrail.** A draft priced from an inflated invoice would bake the leak into the PO. Guardrail: `resolveExpectedPrice` (contract > own last explicit price > list, never invoice; owner decision 21). The draft is never auto-sent. The original PO keeps its status (`deliveryState.ts:9-13`).
- **Roles.** Chef (₪ allowed on orders), manager, owner.
- **Reuse.** W2-06 `orderGuide` + `createDraft`; the `captureOrderDraft` idempotency; `apps/worker/src/jobs/orderReminders.ts` (the supplier-due loop); `receiving.submitReceipt` (`receiving.ts:933-1006`).
- **Package / phase.** AU-11 · B2 (after AU-04; coordinates with W3-09 on the receiving router).

#### A17 · Decision SLA nudge and weekly bookkeeper digest
- **Trigger → action.**
  - A routed item undecided for more than 24 h gets one nudge to the assignee. At 48 h the owner is told (D4).
  - Every Sunday the bookkeeper gets a digest: pay-run due list, held reasons and ₪ disputed, VAT at risk, overdue claims, exports pending.
- **Human confirms.** Every decision and every payment.
- **Data.** `discrepancies` (age, `requires_role`), W2-03 due dates, `recovery_claims`, `vatAtRisk`. H-04 `notification_seen` makes "never tell twice" seen-aware later. Until then, dedupe keys apply.
- **Impact.** Bookkeeper 0.5–1 h/week (no weekly assembly of four screens into one list): 0.5–1 × 4.33 × ₪89 = **₪195–385/month time-₪** (labour value; cash only if the fee falls). Money-₪ is not counted, because it overlaps A12. Illustration: if 10–20% of claimable ₪ (₪180–360) is decided only after payment today, and offset recovers ~100% versus ~35% for a claim, the nudges would protect ≈₪100–250/month. That is the same ₪1,800 pool as A12.
- **Effort.** M.
- **Money-truth risk → guardrail.** An escalation could change who approves money. Guardrail: the nudge only informs and never re-routes. Routing stays in `approvals/engine.ts` (immutable; H-12). The ≤6/day cap and quiet hours apply (G-06).
- **Roles.** Owner, manager, bookkeeper.
- **Reuse.** `queueSummary` (`approvals.ts:311`); `payRun.month`; `findOverdue`; `vatAtRisk`. The nudge rides the 08:30/19:00 bodies.
- **Package / phase.** AU-12 · B2. The Sunday 08:00 slot is the H-05 addendum (D9).

#### A18 · Price creep in ₪/month
- **Trigger → action.** The 07:00 price-alerts chain projects ₪/month for each alert: Δ unit price × trailing 90-day quantity. Three more alerts ride the same chain:
  - an e-mail of the price-list import diff (top rises), with no write to `price_history` (D11);
  - a contract with `valid_to` within 14 days;
  - a dish crossing its food-cost target, which the chef sees with ₪ on recipes.
- **Human confirms.** The owner decides whether to dispute, switch supplier or renew.
- **Data.** `price_history`, `price_baselines`, `price_alerts`, `supplier_contract_prices.valid_to`, `recipes`. No schema change.
- **Impact.** Manager 0–0.25 h/week (one ₪-ranked mail instead of opening tabs): **₪0–110/month time-₪**. Money-₪ is an avoided cost, **outside the leak** ("מחירים שעלו", not "דליפה"). ASSUMPTION: alerts cover items with ₪1,000–2,000/month of creep exposure, and the owner acts on 10–30%: **₪100–600/month**. Context: Supy reports 22.7% of invoices carry at least one line off the agreed price, concentrated in produce, seafood and meat (ext-05 §2.1 **[V]**).
- **Effort.** M.
- **Money-truth risk → guardrail.** Creep counted as leak, or list prices silently moving baselines. Guardrail: separate naming and tone (owner decision on terms). T2 only at ≥3% and ≥₪50/month (W2-12 rule). Price-list import writes no `price_history` without matching-engine-guardian review (D11). The receiver gets no ₪.
- **Roles.** Owner, manager; chef (₪ on recipes only).
- **Reuse.** `runPriceAlertSweep` (`packages/api/src/priceAlerts/sweep.ts:63`); `dishPriceAlerts` (`packages/api/src/recipes/alerts.ts:61`); `overContract.ts:127` (`validTo`); `currentPrices` in `routers/catalog.ts`.
- **Package / phase.** AU-13 · B1 (needs AU-01 to switch `priceAlerts` on, and W2-12's shared ₪/month helper).

#### A19 · Pay-run pre-flight
- **Trigger → action.** Opening the pay run flags each case below. Each flag carries its reason and ₪.
  - a possible duplicate: same supplier, amount ±, date ±3 days, across months and channels;
  - a new supplier's first payment;
  - bank details changed since the last payment (H-03 data). This is a **hard hold** that only the owner can release (D12);
  - an unusual amount (more than 2× the supplier median).

  It also writes a dispute-aware remittance text per supplier that names the withheld claims.
- **Human confirms.** The owner confirms each release. The pay run never pays (there is no rail).
- **Data.** `invoices`, H-03 `paid_at` and the supplier bank details with change audit, `payment_deductions` (G-03/H-03), W2-03 holds.
- **Impact.**
  - Hours: bookkeeper 0.25–0.5 h/week (pre-flight list and remittance text per supplier) → **₪95–195/month time-₪**.
  - Money-₪ (a wrong payment stopped). APQC puts erroneous or duplicate disbursements at 0.8–2% of payments by count (ext-05 §2.1 **[I]** cross-industry). At ~60 invoices a month that is 0.5–1.2 at risk. The engine's DUPLICATE_INVOICE and the W2-03 holds already catch most of them. A19's increment (cross-month and cross-channel duplicates, bank change, unusual amount) is ASSUMED to be 10–30% → 0.05–0.36 events × ≈₪3,333 = **₪150–1,200/month expected, ≈₪3,333 per event**.
  - A bank-detail fraud event costs a whole payment. It is rare and kept out of the expectation.
- **Effort.** M.
- **Money-truth risk → guardrail.** Over-holding good invoices (ext-04 §4) and prompt injection steering bank details (ext-04 §4). Guardrails: every flag is a coarse verdict with a reason, and only the bank change is hard. OCR/LLM output can never write supplier master data. Bank changes are verified out of band.
- **Roles.** Owner (release), bookkeeper (prepare); manager reads.
- **Reuse.** `payRunStatusOf` (`packages/api/src/routers/payRun.ts:117`); W2-03 holds and short-pay; H-03 bank-change audit.
- **Package / phase.** AU-14 · B2 (needs H-03 deployed). Tenant-security-warden and leak-economist review.

#### A20 · Learn from decisions (rule suggestions)
- **Trigger → action.** Two suggestions:
  - The same supplier and product waived with `price_agreed` K = 3 times → suggest a contract price, showing "this would have cleared N items".
  - A repeated OCR correction for one supplier → suggest an alias or unit rule.
- **Human confirms.** The owner accepts each rule. Nothing changes the engine.
- **Data.** `audit_log` (`after.reasonCode`), `supplier_contract_prices`, `product_aliases`.
- **Impact.** Manager 0.04–0.12 h/week (10–30 repeat waives a month at ~1 min each): **₪20–55/month time-₪**. Money-₪: none. Fewer false alarms protect trust.
- **Effort.** M.
- **Money-truth risk → guardrail.** A rule that silences a real overcharge. Guardrails: the suggestion records a contract price, which the engine still checks against. It is never a tolerance widening. The owner signs every rule. The canary stays unmoved.
- **Roles.** Owner, manager.
- **Reuse.** `WAIVE_REASON_CODES` (`packages/api/src/routers/approvals.ts:69`, input at `:427`); `contracts.create`; `mapping.confirm`.
- **Package / phase.** AU-15 · B1.

### Phase C: earned autonomy and outbound (Jan–Mar 2027)

#### A21 · Earned autonomy (per-supplier auto-approve)
- **Trigger → action.** A supplier with N = 10 clean invoices gets an offer: "אשר אוטומטית חשבוניות של X עד ₪Y". The owner can grant and revoke it, and the error rate is disclosed. It never applies to blocking, duplicate, new-supplier or bank-change cases.
- **Human confirms.** The owner grants the rule. This is the "owner rule" exception to human-confirms-every-money-action (D7; recommended cap ₪300 per invoice).
- **Data.** H-13 `autonomy_grants` (restaurant, supplier, max agorot, types, granted_by, revoked_at).
- **Impact.** Owner 0.05–0.2 h/week (12–24 clean invoices a month × 1–2 min): **₪30–130/month time-₪**. Money-₪: none. It is a **risk budget**, at most ₪300 per auto-approved invoice. Ext-04 §1.2 shows "touchless" trades directly against error rate.
- **Effort.** L.
- **Money-truth risk → guardrail.** Auto-approving a real leak. Guardrails: a grant only covers runs with no blocking, duplicate, new-supplier or bank-change finding (H-12 rule priority below those). Revocable. Every auto-approval is audited with rule and confidence. AU-07 discloses "% auto-approved, reversals".
- **Roles.** Owner only.
- **Reuse.** `approvals/engine.ts` new rule `supplier-autonomy` → **HUMAN-PR H-12**.
- **Package / phase.** AU-16 + H-12 + H-13 · C.

#### A22 · Supplier communication loop
- **Trigger → action.** An owner tap sends the letter or reminder from the server (e-mail PDF, or a WhatsApp utility template) and marks `letter_sent`. Supplier replies are classified read-only (accepted / credit promised / disputed), and the classification proposes a state change.
- **Human confirms.** The owner confirms every send (D10). A human confirms every state change.
- **Data.** H-05 templates and server send; H-06 claim portal; H-13 `claim_replies`.
- **Impact.** Manager 0.1–0.3 h/week (4–8 supplier letters a month, 2–5 min each plus reply reading): **₪45–135/month time-₪**. Money-₪: ASSUMED +5–10 points of collection share on ₪1,800 = **₪90–180/month recovered**. This sits inside the A12 bundle range, so it is not added to A12. WhatsApp cost is trivial per message but no longer free inside 24 h since 1 Oct 2026 (ext-02 §0.5 **[S]**).
- **Effort.** L.
- **Money-truth risk → guardrail.** A message sent on an undecided gap (decision 18), or a misread reply closing a claim. Guardrails: only decided claims are ever letter content. The classifier never writes state; it proposes. The restaurant is liable for what it sends (ext-04 §4, Air Canada), so a human sends, with evidence attached.
- **Roles.** Owner, manager.
- **Reuse.** W2-10 letters; `enqueueNotification` with attachments (called, not edited); H-06 portal.
- **Package / phase.** AU-17 · C (after H-05 and H-06).

#### A23 · Month-end missing-documents report and Tax Authority diff
- **Trigger → action.** On the 8th of the month (before the VAT deadline on the 15th), the bookkeeper gets a report per supplier: delivery notes with no invoice, invoices with no note, invoices above ₪5k with no allocation number, credit notes owed. Later, the ITA buyer-side pull of received invoices is diffed against what was captured.
- **Human confirms.** The bookkeeper acts on each line. ITA credentials are Phase-6, human-only (D14).
- **Data.** Delivery-note coverage, `invoices`, `credit_notes`, `vatAtRisk`; W3-05 close checklist; ITA OAuth credential.
- **Impact.** Bookkeeper 0.17–0.63 h/week (a manual דוח חוסרים of 1–3 h a month falls to ~15 min; ASSUMPTION): **₪65–245/month time-₪** (labour value). Money-₪ is VAT reclaimed on supplier invoices the restaurant never captured, and only after the ITA diff: 0–1 a month × ₪2,500 × 18% = **₪0–450/month**, lumpy, and ₪0 for 0%-VAT produce.
- **Effort.** M (report) + L (ITA).
- **Money-truth risk → guardrail.** Treating a missing invoice as a loss: it is usually timing, not leak. Guardrail: the report shows counts and VAT separately and never touches the leak figure.
- **Roles.** Bookkeeper, owner.
- **Reuse.** `deliveryNoteCoverage` (`packages/api/src/ledger/coverage.ts:77`); `vatAtRisk.ts:96`; W3-05 `close` router (today empty, `routers/close.ts:10`).
- **Package / phase.** AU-18 · C. The 8th-of-month slot is in the H-05 addendum.

#### A24 · Payment file and bank-evidenced recovery
- **Trigger → action.** An approved pay run produces a Masav-format file of the undisputed amounts and a Hebrew remittance. A human uploads and signs it at the bank. A bank-statement upload is matched to open claims (credits and short-pays), and the match proposes "recovered".
- **Human confirms.** The owner uploads and signs at the bank, and confirms each "recovered".
- **Data.** H-03 `paid_at` and bank details, `payment_deductions`, `recovery_claims`.
- **Impact.** Owner/bookkeeper 0.06–0.2 h/week (12–20 supplier payments typed into the bank fall to one file): **₪25–80/month time-₪**. Money-₪: none new. It turns "recovered" from a click into bank evidence, so the recovery rate AU-07 reports is evidenced. The ₪ is already counted in A12. Masav is file-based and credential-free today, while open-banking payment initiation is 2027+ (ext-02 §0.3–0.4).
- **Effort.** L.
- **Money-truth risk → guardrail.** Paying a disputed amount, or marking recovered on a coincidental credit. Guardrails: the file excludes held and disputed ₪, and remittance names the withheld claims. A statement match only proposes recovered. Payment initiation stays a human action under AGENTS.md.
- **Roles.** Owner, bookkeeper.
- **Reuse.** W2-03 short-pay, `recordCreditNote` (`recovery/service.ts:723-885`), `transitionClaim`.
- **Package / phase.** AU-19 · C (decision D13).

#### A25 · Produce market benchmark (optional)
- **Trigger → action.** Fruit and vegetable lines are compared with public wholesale prices (the Plants Council list, which Zestt already links, ext-01 §0.5 **[V]**). Lines above market show "X% מעל השוק" as T4 information.
- **Human confirms.** Nothing. It is information.
- **Data.** A public price feed; product category.
- **Impact.** 0 h. Money-₪ is a speculative avoided cost, outside the leak: produce at 20% of spend (₪40k, ASSUMPTION) × 0–2% acted on = **₪0–800/month**.
- **Effort.** M.
- **Money-truth risk → guardrail.** A market price is not the restaurant's agreed price, so this must never become leak. Guardrail: T4 neutral only, behind an icp-keeper gate.
- **Package / phase.** Backlog · C+.

#### A26 · POS Z-report feed for food cost (optional)
- **Trigger → action.** Inbound daily Z-report totals produce a food cost %.
- **Impact.** Manager 0–0.1 h/week of upload: **₪0–45/month time-₪**. Money-₪: none to the North Star. POS depletion "missing product ₪" must not mix into the supplier leak (ext-02 §7).
- **Risk.** ICP veto: inventory-as-core is anti-ICP (`docs/ICP.md` §5). No Israeli POS has an open API; Restigo-style Z-report intake is the only route (ext-02 §0.6).
- **Reuse.** `posSales` day-replace.
- **Package / phase.** Backlog · later.

---

## C. Already planned elsewhere (credit, do not duplicate)

These wave-2 and wave-3 packages already deliver automation. AU packages build on them and must not rebuild them (`int-00` §1; `IMPLEMENTATION-PLAN.md` §4; `docs/ux/wave2/README.md` §9–§10).

| Automation already planned | Package | How the catalogue uses it |
|---|---|---|
| Claims materialised at decision; one auto-built letter per supplier; 10 s undo; overdue reminder drafts (click-only); auto-advance credited → recovered on the paid event | W2-10 (+ W2-04 `materializeClaims`) | A12 chases on top, and A22 sends on top |
| Server-enforced bulk cap ₪200, one-tap guard ₪500, notification deep links (`/dashboard/go`) | W2-04 | A4, A7 and A17 link through go-links |
| Auto re-match on OCR edit with ₪ before→after; register tab "ללא מספר הקצאה" | W2-02 | A8 and A13 build on the cockpit |
| Due dates from terms, mark paid, auto holds (duplicate, dispute, missing allocation number, `note_billed_twice`), short-pay, remittance; "תנאים קצרים מהמוסכם" flag | W2-03, G-17, W2-11 (terms picker) | A13 adds the chase; A19 adds pre-flight; A17 digests due lists. G-17 never carries ₪ |
| Order guide (last 8 POs), cut-off board, wa.me send, `markSentManually`, supplier-change diff | W2-06 | A16 prepares the draft from the guide |
| Task spine `tasks.mine`, nav badges, in-app bell | W2-08 | A3 and A4 land in the bell before H-05 |
| Real recipients, never `role:` targets, quiet hours 23:00–06:00 + Shabbat, ≤6/person/day, OCR-failure hand-off | G-06 | every brief enqueues through `notify()` |
| `awaitingDecision()` one figure; Ask facts with period | G-12 | A4, A11, A17 |
| `moneyText` + `parseDecimalInput` | G-13ʰ | A4, A7 and every outbound ₪ |
| Three consolidated flags as review items | G-04 §9 | A14 explains residuals with them |
| One ₪-ranked "לטיפול" queue, ≈₪/month per alert, T2 threshold, import diff before commit | W2-12 | A18 reuses the ₪/month helper |
| PO lifecycle by events, notify the sender on each transition (fixes "supplier answers notify nobody") | W3-09 | A16 coordinates the receiving submit hook |
| Credit-note OCR with suggested allocation; supplier statement reconciliation | W3-11 | A12's credit row is the manual precursor |
| Price-list inbox ("מה ישתנה"), "לקשר" queue | W3-10 | A18 mails the diff only |
| Ask everywhere, AI drafts (draft-only) | W3-04 | A11 is the read-only first step |
| Month close with auto-ticking checklist, exports, accountant zip | W3-05 | A23 feeds the checklist |
| 06:00 receiver brief, push UI, share target | W3-03 | A3 pulls it forward, then hands the job back |
| One monthly report with tabs | W3-08 | fixes the mock-WhatsApp report together with H-05 |
| Real push, WhatsApp templates, role → phone, late-truck check every 15 min, claim-chase drafts days 3/7/14 | H-05ʰ | A6, A17 and A22 depend on it; the AU addendum adds 4 slots |
| Supplier claim portal and server send | H-06ʰ | A22 |
| Hero partition, funnel נמצא → נדרש → זוכה → הוחזר, closed months | H-07ʰ | A2 must use the same definitions |
| Revised supplier expectation, consolidated accept | H-08ʰ | A14 accept |
| Least-privilege ₪ server-side | H-11ʰ | prerequisite for receiver/chef automations |
| Paid columns, bank details + change audit, `notification_prefs` | H-03ʰ | A19, A24 |
| `notification_seen`, outbox `CHECK (target NOT LIKE 'role:%')` | H-04ʰ | A17 "never tell twice" |

---

## D. Bugs found that block automation

Each bug was verified on `release/train-a` @ `c6132c0e`. "Owning package" is where the fix belongs. AU packages must not paper over these bugs.

| # | Bug | Evidence (file:line) | Why it blocks automation | Owning package |
|---|---|---|---|---|
| 1 | **WhatsApp `role:` targets.** Approval WhatsApp and push go to `role:<role>`. With Cloud keys set, the Graph API is called with `to: "role:manager"` | `apps/worker/src/jobs/matchInvoice.ts:200,213`; `packages/api/src/notifications/whatsappCloud.ts:33,47-56` | No WhatsApp brief can be switched on until targets resolve to verified phones | G-06 (resolve at enqueue, never `role:`), H-05 (role → phone, templates), H-04 (`CHECK target NOT LIKE 'role:%'`). AU-04 must not add `role:` targets |
| 2 | **Monthly report WhatsApp hard-wired to the mock**, even when keys exist, and targeted at `role:owner` | `packages/api/src/reports/send.ts:34,91` | The report "sends" WhatsApp that never leaves, and the outbox row says sent | G-06 (owns `reports/send.ts` in wave 2) + H-05 (send); W3-08 report |
| 3 | **Charts `LEAK_FILTER` counts MISSING_ON_INVOICE**, against the owner rule of 31.10 | `packages/charts/src/leak-views.ts:134-136` | Every ₪ an automation quotes from the hero, feed or report is inflated; A2's funnel would inherit it | matching-engine-guardian / **H-07ʰ** (₪ math is a human PR). Flag now as a pre-pilot bug |
| 4 | **EOD "open credits" counts every open discrepancy**, incl. MISSING_ON_INVOICE and PRICE_LOWER | `apps/worker/src/jobs/endOfDayReport.ts:55-65` (Σ abs delta over `open/escalated`), `:110-111` | A4's digest would mail a number the hero and recovery disagree with | W2-04 (moves EOD to G-12 `claimableLines`); AU-04 verifies and extends |
| 5 | **Receiver (and chef) ₪ server exposure.** UI hides ₪, but procedures serve it | `packages/api/src/routers/owner.ts:115,121,150` (`kpis`, `leakHero`, `leakSummary` = member); `routers/receiving.ts:224` (`getPo`); `routers/orders.ts:337,390` (`list`/`get` `totalEstimated`); `routers/catalog.ts:181,237`; `routers/suppliers.ts:165,174` (ledger via `invoiceReaderProcedure`, which includes receiver, `trpc.ts:158`) | Any receiver-facing automation built on these procedures would leak ₪ | **H-11ʰ** (least privilege); W2-06 AC4 `redactPrices` for orders. AU-04 builds a ₪-free projection regardless |
| 6 | **daily-expectations is dead output.** It runs at 06:00 and writes only an audit row that nothing reads (a test is the only other reader) | `apps/worker/src/jobs/dailyExpectations.ts:123-132` | The receiver brief A3 already has its data computed and thrown away | AU-04 (Phase A), then W3-03 |
| 7 | **sync-platforms is unscheduled.** The cron header claims "every 30 minutes", but `registerCronSchedules` never registers it and nothing produces it | `apps/worker/src/cron.ts:9` vs `:54-150`; `apps/worker/src/handlers.ts:33` | MarketMan/Zester POs and catalog never sync, so ordering automation can't use them | **H-05 addendum** (schedule, or delete the header claim) + Phase-6 credentials; not an AU item |
| 8 | **No code path marks an invoice paid.** Only the demo seed writes `status: 'paid'` | `packages/api/src/routers/payRun.ts:25-26,232`; `apps/worker/scripts/seed-demo.ts:762` | A19 and A24 and the "recovered on paid" event have no trigger | W2-03 `markPaid` (behind `PAY_RUN_MARK_PAID`) + H-03 `paid_at` |
| 9 | **`invoices.due_date` is never written** outside seeds. The approvals sort key is dead | `packages/db/src/schema.ts:813`; `seed-demo.ts:378,571,851`; `routers/approvals.ts:155,162` | A4's "due ≤2 days" and A17's due list are empty | W2-03 `computeDueDate` + G-17 printed terms |
| 10 | **Supplier answers notify nobody.** The confirm service stores the answer and never touches the PO. No outbox call exists in `supplierConfirm/**` or the public route | `packages/api/src/supplierConfirm/service.ts:301` | "Supplier said only 8" never reaches the manager or the dock | W3-09 (notify sender, lifecycle); G-10 contract; accept-into-expectation = H-08 |
| 11 | **Inline `Intl` ₪ outside `formatIls`/`moneyText`** | `apps/worker/src/lib/notifyHelpers.ts:64-65` (`formatIlsAmount`); `apps/worker/src/jobs/matchInvoice.ts:194,240` (`₪${…toFixed(0)}` on the engine total) | AGENTS.md money-display violation; bidi-unsafe ₪ in every outbound brief | G-13ʰ (owns `notifyHelpers.ts`) + AU-04 adopts `moneyText` |
| 12 | Order reminder treats an unsent **draft** as ordered (minor) | `apps/worker/src/jobs/orderReminders.ts:81-89` | A5 cannot be truthful without it | AU-04 |
| 13 | Stale comment: worker says "14+ days", code uses 7 (minor) | `apps/worker/src/jobs/recoveryReminders.ts:3` vs `packages/api/src/lib/claims.ts:34` | Misleads the next agent on the overdue rule | AU-03 |
| 14 | ח״פ mismatch check is dead: the option exists, but the worker never passes it | `packages/ocr/src/checks.ts:87,217` | A8 | AU-02 |
| 15 | Real consolidated documents are not recognised: only the seed sets `raw.kind` | `packages/api/src/match/consolidated.ts:727` | A9 and A14; T4 rule broken for real scans | train B (owner decision) / AU-02 verify |

---

## E. Competitive leapfrog

Each line says what competitors do (cited from the ext notes, labels kept) and where RestoMatch goes past them.

1. **Found → claimed → credited → recovered, as a measured ₪ number (A2, A12, A22, A24).** No AP or restaurant vendor publishes a recovered-money metric (ext-04 §5; ext-05 §2.1 "credit-claim recovery rate: UNVERIFIED"). The closest outbound tools are MarginEdge statement-reconciliation e-mails, which are Bill Pay-only and schedule-driven **[V]**, and Edify/Culistock one-click credit requests **[V]** (ext-03 §0.3). RestoMatch would be first to show a restaurant its own measured recovery rate.
2. **Consolidated invoice → proposed delivery-note set with an explained residual (A14).** Zestt's documented flow has the user filter notes, type the original total and investigate differences by hand (ext-01 §0.4 **[V help doc]**). Global players don't support חשבונית ריכוז at all (ext-03 §4).
3. **Allocation-number chase, not just a flag (A13, A23).** Priority 24.1 already obtains or verifies allocation numbers from the ITA (ext-01 §0.6 **[V]**), so for Priority shops this is parity. The leapfrog is the supplier request plus the deadline countdown plus pay-run hold for the owner-operator who doesn't run Priority. Later the buyer-side received-invoices pull diffs against what was captured (ext-01 §0.1; the API is UNVERIFIED in ext-02 §0.2). Thresholds use the effective-date table (cpa.co.il, horizon.org.il via ext-02 §0.1).
4. **Measured time ledger instead of "hours saved" headlines (A2).** Israeli vendor claims of 72.8 h or 100+ h are unverifiable (ext-01 §9 Avoid), and no independent time-use study exists (ext-05 §1.1). Telemetry minutes × the editable Israeli rate table, kept apart from leak ₪, is novel (ext-05 §5.7).
5. **Recommend first, then earned and revocable autonomy (A20, A21).** Ramp Policy Agent recommends until an admin enables auto-approval, escalating 10–15% to humans **[V]**. Vic.ai's Autopilot is a ≥95%-confidence dial, with 70–85% after 6 months **[V]** (ext-04 §1, §5). RestoMatch adds ₪ caps per supplier and a disclosed error rate.
6. **Dispute-aware pay run and Masav file (A19, A24).** Israeli accounting tools export Masav files (SUMIT, Abra, Odcanit; ext-02 §7). None found names withheld claims in the remittance or holds on bank-detail change. Xero JAX flags unusual amounts, changed bank details or new suppliers **[V]** (ext-04 §6), so A19 copies that and ties it to claims.
7. **Supplier-reply classifier that proposes, never acts (A22).** Medius Supplier Conversations answers supplier mail but "does not perform any actions" **[V]**. Microsoft's supplier agent can auto-send or draft **[V]** (ext-04 §2.6–2.7). RestoMatch classifies claim replies into a proposed state with a human confirm.
8. **Price creep in ₪/month without recipes (A18).** MarginEdge alerts per vendor item need tedious threshold setup **[V]** (users on GetApp, ext-05 §3.1). No Israeli tool documents an automatic "supplier raised price → ₪ impact" alert; Restigo claims food-cost savings without one **[V]** (ext-05 §3.1). Default thresholds come from contract or last price; the owner configures nothing.
9. **Restaurant-side counter-agent (A8, A15, A16).** Foodservice AI (Choco, Pepper, Ordermentum) sits on the distributor side and turns restaurant messages into supplier orders. None audits the supplier invoice for the restaurant (ext-04 §1.7). RestoMatch checks what the distributor's agent produced.
10. **Same-day, not 24–48 h.** MarginEdge and meez run human-verified pipelines with 24–48 h turnaround **[V]** (ext-03 §0.1, §4 Avoid 3). RestoMatch's event-driven match (OCR → match job) plus the 19:00 digest puts decisions on the same day.

What stays parity, not leapfrog: WhatsApp/e-mail/photo intake (table stakes in Israel at ₪15–30/month, ext-01 §0.2) and OCR accuracy claims (nobody publishes an audited touchless rate, ext-03 §0.1).

---

## F. Top 5 (executive summary table)

Hours and both ₪ columns use the formulas in §0. The two ₪ columns are separate and never added. Every row is an ASSUMPTION until AU-07 measures it (30 days into the pilot).

| # | Automation bundle | Hours/week (by role) | time-₪/month | money-₪/month (kind) | Key assumption |
|---|---|---|---|---|---|
| 1 | **Recovery autopilot**: A12 + W2-10 (+ A22 in Phase C) | manager 1–1.5 | **₪450–670** (1–1.5 × 4.33 × ₪103) | **₪300–900 recovered** (central ₪540 = ₪1,800 × 30 pts) | claimable ₪1,800 (60% of ₪3,000); collection 35% → 65%, both ASSUMED |
| 2 | **Role briefs + SLA nudges**: A3–A7, A17 | receiver 0.25–0.5 · manager 0.75–1.25 · bookkeeper 0.5–0.75 (1.5–2.5 total) | **₪600–980** (₪68–136 + ₪334–557 + ₪193–289) | **not counted separately**: protects the offset channel for #1's ₪ | bookkeeper time is labour value; cash only if a per-document fee falls |
| 3 | **Intake autopilot**: A8–A10, A14, A15 | manager + bookkeeper 0.7–1.15 (3–5 h/month) | **₪270–520** (3–5 h × ₪89–103) | **₪0–1,100** consolidated billed-twice stopped (lumpy, outside leak); duplicates counted in #5 | 80 docs × 2–4 min saved per document; 3–5 consolidated/month; 0–1 duplicated note/quarter |
| 4 | **Allocation-number guard**: A13 (+ A23 later) | bookkeeper/owner 0.02–0.1 | **₪10–40** | **₪0–1,100 VAT kept** (₪1,080 per miss on a ₪6,000 invoice; shown outside the leak) | 0–1 invoice above ₪5,000 pre-VAT missing a valid number per month |
| 5 | **Pay-run pre-flight**: A19 + W2-03 | bookkeeper 0.25–0.5 | **₪95–195** | **₪150–1,200 wrong payment stopped** (≈₪3,333 per event, lumpy) | APQC 0.8–2% erroneous payments by count [I, cross-industry]; A19 adds 10–30% beyond engine + W2-03 holds |

Also strong: **A2 measurement**. It saves no hours and no ₪ itself, but it makes every number above measured within 30 days of the pilot, and the recovery rate it reports has no published competitor equivalent.

**What to tell the owner.** The ₪ that comes back (row 1) is the leak story. Rows 4 and 5 protect against rare but large single events, so most months they show ₪0. Hours (column 3) are context, split across people, and never added to the leak ₪.
