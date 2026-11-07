# 21 · Owner and chef value, and new automations AU-20..AU-26

*Synthesis note, written 2026-11-07 on branch `claude/research-in-app-automation` (PR #235). Docs only; no code changed. It builds on and does not repeat: `20-competitive-matrix-and-win-plan.md` (matrix rows 1–71, gaps, moats), `ext-09-chef-owner-value.md` (CV1–CV10), `int-08-procurement-sync-and-inventory.md` (C1–C8, feature inventory), `int-06` §7 (recipes router), `10-catalogue-and-impact.md` (A1–A26, §0 money rules, §G dispositions), `docs/ux/automation/README.md` (AU-01..AU-19, §7 decisions AD1–AD14, §10a/§10b), `docs/ux/IMPLEMENTATION-PLAN.md` §4–§5 (W3/W4) and `docs/ICP.md` §5 (scope veto). No new web research. Competitor facts keep the labels of their source notes: **[V]** vendor claim, **[3P]** third party, **[U]** user review, **UNVERIFIED**.*

**Citation shorthand** (as in note 20): `06 §n` = ext-06 MarketMan, `07 §n` = ext-07 Zestt, `09 §n` = ext-09, `i08 §n` = int-08, `i06 §n` = int-06, `cat` = 10-catalogue, `M#n` = matrix row n in note 20. PR status is from the session's open-PR read (2026-11-07 ~07:45Z) and README §10b.

**Money rules applied throughout.**
- One leak definition: Σ|deltaAmount|. MISSING_ON_INVOICE is out of the leak and not claimable (#211, owner-approved 31.10).
- Three ₪ kinds, never summed: **leak ₪**, **avoided-cost ₪** (price creep, pack size, menu), **hours-₪** (labour value, not cash).
- Chef sees ₪ only on orders and recipes. Receiver sees no ₪ anywhere, including notifications.
- Every money action is human-confirmed unless an owner rule says otherwise. Nothing is sent to a supplier automatically.
- The typical restaurant is `cat` §0: ₪200,000/month food spend before VAT, 1 branch, ~12 suppliers, ~14 deliveries/week, leak at 1.5% = ₪3,000/month. Loaded rates: receiver ₪63, bookkeeper ₪89, manager ₪103, chef ₪127, owner ₪103 (₪150 in brackets). **time-₪/month = h/week × 4.33 × rate.** Every input is an **ASSUMPTION** until AU-07 measures it.
- Vendor numbers are context only and never enter the arithmetic.

---

## 0. Summary

1. **The chef's value is real but secondary.** It must never sit in the first-value path. The leak works with no recipes (09 §2.1, 06 §6). The chef area is empty in the pilot today (`recipes`, `dishPriceAlert`, `inventoryCount` all OFF, i08 §3.10, §3.14), while both competitors show live dish cost (M#26). The fix is mostly switching on what exists (OD-C3) plus W3-02 and AU-13. This note adds one chef automation (AU-23 recipe quick-start), one chef-on-orders hint (AU-26) and three riders.
2. **The owner's value beyond the leak is negotiation leverage.** That is the most on-mission owner item the market does not ship for a single restaurant (09 §1 item 7). It becomes **AU-22, supplier negotiation pack**.
3. **Coexistence becomes two packages.** int-08 supports both. **AU-20** is the document path: zero credentials, works this quarter. **AU-21** is the API path: C1–C6 and C8, then C5 receipts. AU-21 never switches the scheduler on before C1–C3 + G-04 (+ #211) merge.
4. **New automations:** AU-20..AU-26 (7 packages) plus 3 riders on existing packages (R1–R3). None duplicates A1–A26. AU-25 is an **OWNER DECISION**: it comes near the "P&L / food cost" LOSE·D rows (M#12–13) without crossing into inventory or POS.
5. **The ICP veto holds** for par/prep/forecast, recurring auto-send, cross-supplier compare, waste logging, menu engineering and peer benchmarks. This note recommends crossing **none** of them. Two items sit near the line and are marked OD: AU-25 (food-cost % lite) and AU-26 (same-supplier pack size, which is **not** `product_group_id`).
6. **New owner decisions:** OD-C1..OD-C10 (§3).

---

## 1. Value for chefs and owners

Status words: **live**, **flag (P)** = on in the pilot, **flag (–)** = built but OFF in the pilot, **PR** = open, **planned** = W2/W3/AU id, **none**.

### 1.1 Chef (שף)

| # | Value | RestoMatch today | MarketMan | Zestt | Worth building for our ICP? |
|---|---|---|---|---|---|
| C-a | **Recipes + per-dish food cost, auto-updated** | Recipes, sub-recipes, plate cost, target %, history, CSV import; priced from the last **paid** price. **flag:recipes (–)** (i06 §7, i08 §3.10) | Core; recipe cost recomputed from scanned invoices (06 §2). Setup "tedious", 6–12 weeks [U/3P] (06 §6) | Product tree with live cost (07 §2.6) | **Yes, as secondary.** Switch on for a willing chef (OD-C3). W3-02 is the workbench. **AU-23** removes the setup tax. One invoice-line → product mapping feeds both the leak and the dish cost (09 §2.1) |
| C-b | **Dish crossed target because of a purchase** (push) | `dishPriceAlert` query, pull only, **flag (–)** (i06 §7) | Low-margin items highlighted (06 §2) | Not found | **Yes.** A18/AU-13 is the push. **R1** adds the purchase link and four standard responses as copy. This is the chef's highest-value item (09 §1 item 2) |
| C-c | Menu engineering (stars…dogs) | none; `posVsTheory` needs POS file + `integrations` (–) | Low-margin highlight (06 §2) | Not found | **Later.** Needs per-dish sales (A26, ICP veto risk). Evidence is weak: one Cornell replication, profit-or-sales UNVERIFIED (09 §2.3) |
| C-d | Par / prep / forecast | not built | Par suggestions; AI Ordering is an Enterprise or paid add-on (06 §2) | Not found as forecast | **No: ICP veto** (`docs/ICP.md` §5). Only allowed shape: expected quantity as fuel for the goods receipt (G-10, `daily-expectations`), ₪-free |
| C-e | Ordering speed | 4-step wizard, human send by e-mail/WhatsApp, live (i08 §3.1); order guide + cut-off board in W2-06 (#184, built) | Electronic send (06 §2) | Fixed lists, drafts, **auto-send on set dates** (07 §2.1) | **Drafts only.** A16/AU-11 already covers this. Auto-send is LOSE·D by owner rule (M#21). **AU-24** adds the agreed price to the PO text the chef sends |
| C-f | Ingredient price alert with dish impact | `recipes.impact` what-if, `changes` names the ingredient that drove the move (i06 §7), flags OFF | Per-item price alerts by e-mail/SMS, no ₪/month (06 §2) | Plants Council used to *update* prices (07 §2.2) | **Yes, via A18/AU-13 + R1.** Chef sees ₪ per plate and food-cost %. Owner sees ₪/month creep. Never added to the leak |
| C-g | Waste logging | none | Growth+ tier (sources conflict, 06 §2) | Not found | **No.** Best independent ROI in the area (Champions 12.3, 26% cut, ≈7:1 [I, 2019]), but off-mission and a tablet habit (09 §2.6). Damaged-on-arrival claims already cover "waste you did not pay for" (W2-05/W2-10) |
| C-h | Substitutions / yield | Yield is a recipe-editor field (W3-02) | Not found | Not found | **Same-supplier pack size only** (**AU-26**, Phase C+, icp-keeper gate). Cross-supplier "cheaper equivalent" needs `product_group_id`: ICP "later, locked". Kosher certification also limits substitution (09 §2.11) |
| C-i | Ingredient find-and-replace across recipes | none | Not documented | Not documented | **Yes, as a W3-02 rider (R2).** Craftable users name its absence [U] (09 §2.7) |
| C-j | Kitchen sees what did not arrive | Partial-delivery alert goes to manager + owner (W2-05) | Receiving vs PO (06 §2) | Shortage flags (07 §4.2) | **Yes, ₪-free (R3).** Same event, chef added as a recipient for kitchen lines |

### 1.2 Owner (בעלים)

| # | Value | RestoMatch today | MarketMan | Zestt | Worth building for our ICP? |
|---|---|---|---|---|---|
| O-a | **Leak ₪, one number he believes** | Leak hero live; `leakProof` (P); #211 removes MISSING_ON_INVOICE (i08 §3.4) | Flags differences, no ₪ total (06 §8) | "6% average reduction" [V], no method (07 §4.1) | **Core.** Planned: W2-09 drill, AU-07. For MarketMan/Zestt tenants the leak needs their POs: **AU-20/AU-21** |
| O-b | Cash: what leaves this week, what is held | Approvals `block` live; pay run **flag (–)**, no `markPaid` (i08 §3.7) | US vendor payments (06 §2) | PayMe auto-pay [press] (07 §2.8) | **Yes, already planned:** W2-03, A19/AU-14, A24/AU-19. 13-week cash forecast declined (`cat` §G.3) |
| O-c | Food-cost % | `inventory.period` (counts, flag –); `posVsTheory` (POS file, flag –) | COGS and AvT dashboards (06 §3) | Budget, P&L, revenue vs raw material with POS (07 §2.5, §2.7) | **Lite only, OWNER DECISION (AU-25, OD-C7).** One typed monthly sales figure; purchases-based %; the leak shown in food-cost points. No POS, no counts |
| O-d | **Supplier negotiation leverage** | Supplier leak card (P), ledger (P), contracts + over-contract (P), price baselines live; price alerts OFF (i08 §3.4, §3.8) | Price history per item (06 §2) | Price lists + tracking (07 §2.2) | **Yes: AU-22.** Neither competitor has a supplier scorecard (M#11). The single-restaurant pack is not the vetoed network feature (09 §2.8) |
| O-e | Price-rise alert in ₪/month | `priceAlerts` (–); sweep no-ops in the pilot (i08 §3.8) | Best-known feature, per item, no ₪/month (06 §2) | Tracking (07 §2.2) | **Yes, already planned:** A1 (switch on, AD1), W2-12, A18/AU-13 |
| O-f | Agreed price as the yardstick | `contracts` (P), contract price in matching | Prices updated *from* invoices (06 §2) | No invoice-vs-agreed audit (07 §2.4) | **Moat.** AU-24 carries it onto the outgoing PO |
| O-g | Benchmarks | none | MarketMan network not found | none | **Own history: yes** (AU-07, W3-08). **Peer benchmark: later** (ICP §5, network value). Israeli food-cost norm ~30% (28–35%) is consultant and vendor data [V/3P] (09 §2.10). Use it only as a labelled reference line in AU-25 |
| O-h | Produce price reference | none | none | Plants Council feed (07 §2.2) | **Backlog A25** (two public references and a band, T4; 09 §2.11) |

### 1.3 What not to build (and the honest cost)

| Item | Why not | Cost of saying no |
|---|---|---|
| Par, prep, forecast, AI ordering | ICP §5 veto: procurement/inventory is MarketMan's ground | LOSE·D M#23–24. Answer: "keep ordering where you order" |
| Scheduled auto-send of orders | Owner rule: nothing sent automatically | LOSE·D M#21 vs Zestt. Answer: a prepared draft with a one-tap send (A16) |
| Waste logging | Off-mission; needs scales or a tablet routine | LOSE·D M#31. Mention claims for damaged goods instead |
| Menu engineering | Needs POS sales (A26); weak evidence | LOSE·D M#32. Revisit only if A26 passes the gate |
| Cross-supplier price compare, peer benchmark | ICP "later, locked" (`product_group_id`); network value | None today; no competitor ships it in Israel |
| Inventory as core / AvT | ICP §5 | LOSE·D M#13, M#30 |

---

## 2. New automations and product moves

**Numbering.** AU-05 stays reserved. New packages start at **AU-20**. **R1–R3** are riders on existing packages and get no new id. Each item checked against A1–A26 and `cat` §C/§G: no duplicates. AU-20/AU-21 implement the "A27 candidate" int-08 §2 suggested. They are new AU ids for that candidate, not a second copy of it.

**PR status used for dependencies:**
- Built (draft, not merged): W2-02 #217, W2-04 #209, W2-05 #189/#202, W2-06 #184, W2-10 #193/#194/#197, G-04 #188, G-08 #200, G-09 #190.
- Open pilot PRs: #211, #219, #224/#232.
- Not started: W2-03, W2-07, W2-08, W2-11, W2-12, W2-14, G-10, G-17, H-03.
- Not in the PR read: H-04, H-05 core, H-07, H-11.
- Wave 3 is gated on W2-08 + H-03 (README §10a).

### 2.1 At a glance

> **Corrected by the briefs and `docs/ux/automation/README.md` §13 (2026-11-07).** Phases in the plan are B1/B2/C/D, not the ones below: AU-20 = B1 (PR a; PR b and the MarketMan layout after AU-02 → G-17); AU-21 = PR a in **B2**, PR b in C, PRs c and d in **D**; AU-23 and AU-25 = C (slip to D with wave 3); AU-26 = **D** (not "C+"). Where this note and the briefs/README §13.8 disagree, the briefs win.

| Id | One line | Roles | Effort | Phase | HUMAN-PR? |
|---|---|---|---|---|---|
| **AU-20** | Coexistence by documents: forward MarketMan/Zestt POs (and Zestt delivery notes) to the ingest address; we match without retyping | owner, manager (receiver ₪-free) | M | B1 | no |
| **AU-21** | Coexistence by API: pair-ready synced lines, safe status, price list as expected price, health line, then imported receipts | owner, manager, receiver (₪-free) | L | C (PR a in B) | **yes**: `cron.ts` (H-05a), `schema.ts` (H-04) |
| **AU-22** | Supplier negotiation pack: price history, ₪/month creep, contract breaches and our claim record per supplier | owner only | M | B2 | no |
| **AU-23** | Recipe quick-start: ingredient shortlist from purchases + draft dish skeletons from the menu; chef confirms | chef, owner | M | C (with W3-02) | no |
| **AU-24** | Agreed price on every PO the chef or manager sends (opt-in per supplier) | chef, manager, owner | S | B1 | no |
| **AU-25** | Food-cost % lite: one typed sales figure per month → purchases-based %, leak shown in food-cost points | owner (bookkeeper fills) | S | C | no (**OWNER DECISION**) |
| **AU-26** | Same-supplier pack-size hint on order drafts and price alerts | chef (₪ on orders), owner | M | C+ | no (**icp-keeper gate**) |
| R1 | AU-13 rider: dish alert names the purchase + four standard responses as copy | chef, owner | S | B1 | no |
| R2 | W3-02 rider: ingredient find-and-replace across recipes | chef | S | W3 | no |
| R3 | W2-05 / G-06 rider: chef gets the ₪-free "arrived short" summary for kitchen lines | chef | S | after W2-05 | no |

### 2.2 Package cards

#### AU-20 · Coexistence by documents (zero credentials)
- **One line.** A MarketMan or Zestt restaurant forwards its POs to the RestoMatch ingest address, and the engine matches invoices against them line by line with no retyping.
- **Roles.** Owner, manager (forward and review). Receiver: ₪-free expected lines only.
- **Trigger → action → human confirms.**
  - A PO PDF or e-mail lands at the ingest address.
  - Zestt documents already go through `importPo` (live, needs the OCR key; i08 §1.3, §3.1). PR a extends the PO parser to **MarketMan PO PDFs** (C7). **[Corrected by AU-20.md / README §13.8:** the import is Zestt-only end to end (`importPo.ts:177, 241`; `orders.ts:697` `z.literal('zestt')`) and the intake pipeline turns every document into an invoice (`pipeline.ts:117-125`), so PR a makes the import **platform-aware** rather than "extending" a live path, and a routing step is needed.**]** The layout is UNVERIFIED: 3 real samples are needed first.
  - The import resolves the supplier and per-line SKU, checks printed totals, upserts lines in place, and refuses re-import once a receipt exists (`importPo.ts:186-198`).
  - A checksum failure → a `draft` PO, which is not eligible for matching.
  - The manager confirms a **new** supplier link (fixes the silent name adoption, 20 §B.5).
  - PR b: Zestt digital delivery notes forwarded the same way become **expected quantities** for the dock: ₪-free, never pre-filled counts. The format is UNVERIFIED. **[Corrected by AU-20.md / README §13.1:** in the brief PR b = **sender routing** ("order source" senders go to the PO import). Delivery notes are **split out of AU-20** into a later Phase-D brief, after H-04 and ordered against AU-21 PR d.**]**
- **Value (ASSUMPTIONS).**
  - *Hours-₪.* For a MarketMan/Zestt tenant the alternative is retyping orders. 14 orders/week × 2–4 min (ASSUMPTION), less ~0.25 min to forward ≈ **0.4–0.9 h/week manager**. 0.4–0.9 × 4.33 × ₪103 = **₪180–400/month**.
  - *Leak ₪, surfaced, not new.* Without POs only DUPLICATE, VAT, TOTAL and contract checks fire (i08 §2). Assume PO-dependent types (PRICE_HIGHER vs PO, QTY_SHORT/OVER, UNORDERED) are 40–70% of the leak and the tenant forwards 50–80% of POs (both ASSUMPTIONS).
  - ₪3,000 × 0.4–0.7 × 0.5–0.8 = **₪600–1,680/month of leak made visible**. It is the existing engine's figure on a larger base. It is an upper bound, because contract checks overlap. "Recovered" follows the A12 assumptions and is not recomputed here.
- **Effort.** M (parser extension + forward route + labels + supplier confirm step).
- **Dependencies.**
  - `importPo` (live, Zestt-only; see the correction above).
  - AU-02 (Phase A) for the ingest path. **[Corrected:** AU-02 cannot merge before G-17 (not started); it gates only PR b and the MarketMan layout, not PR a.**]**
  - G-09 #190 (built) for multi-page PDFs.
  - **#211 (open)**: MISSING_ON_INVOICE out of the leak.
  - **G-04 #188 (built, not merged)**: closed POs still discovered.
  - W2-06 AC4 `redactPrices` (#184, built) + **#219 (open)** before imported PO totals reach the receiver.
  - Owner: ocr-procurement-engineer (parser, `packages/procurement`); growth-pmm-engineer (pilot ops copy).
- **Gap.** Closes **M#45** (orders read from MarketMan/Zestt) for the zero-credential case. Narrows **M#55** (supplier digital delivery notes, a structural LOSE) by integrating Zestt's network rather than building one (20 §A.6).
  - MarketMan has no Israeli supplier link (06 §4).
  - Zestt has **no restaurant-side API found** (07 §2.8, i08 §0.2), so documents are the only route.
- **Risk → guardrail.** A misparsed PO makes a false leak. Guardrails:
  - A checksum fail → draft.
  - Lines without a SKU or product keep the PO **not eligible** (the same rule as AU-21 C1).
  - Label "יובא מ-MarketMan / Zestt".
  - Golden fixtures per platform in `packages/procurement` tests.
  - The leak-canary is untouched (the engine does not change).
- **Immutable files.** None.
- **Owner rules.** Nothing is written back to MarketMan or Zestt. Receiver: no ₪. One leak definition.

#### AU-21 · Coexistence by API (procurement sync made real)
- **One line.** The stub sync becomes safe and live, so orders, the supplier price list and, where available, receipts arrive by themselves.
- **Roles.** Owner, manager. Receiver: imported receipts are labelled and carry no ₪.
- **Trigger → action → human confirms.** Four PRs, in this order:
  - **PR a, C1–C3:**
    - Map the platform product to `po_lines.supplier_sku` and run G-08 `decideLink` (auto only on SKU or alias).
    - Never delete or rewrite lines of a PO that has a receipt.
    - Our status wins after the dock; platform "closed" is metadata only.
  - **PR b, C4:** `listProducts` → `supplier_catalog_items` through W3-10's "מה ישתנה" review. The owner confirms the diff. A list price is **expected price only**, never a contract unless the owner locks it (W2-12).
  - **PR c, C6 + C8:**
    - A health line in the W3-07a hub: "N orders skipped: supplier not linked", with one fix CTA.
    - `sync_cursor` written.
    - Real contracts replace the VERIFY shapes.
    - The scheduler is **H-05a (human PR)**. Credentials are **Phase-6, human only**.
  - **PR d, C5:** platform receipts → `goods_receipts` labelled "נקלט ב-MarketMan". A receipt made in our app is never overwritten.
- **Value (ASSUMPTIONS).**
  - *Hours-₪.* Removes forwarding (14 × 0.5 min) and quarterly price-list uploads (12 suppliers × 10 min): ≈0.15–0.3 h/week × 4.33 × ₪103 = **₪65–135/month** over AU-20.
  - With C5, where the receiver would otherwise receive twice: 14 deliveries × 2–3 min ≈ 0.47–0.7 h/week × 4.33 × ₪63 = **₪130–190/month**.
  - *Leak ₪, surfaced, not new.* Coverage rises from 50–80% (forwarded) to near 100% of POs: ₪3,000 × 0.4–0.7 × 0.2–0.5 = **₪240–1,050/month**, incremental to AU-20, upper bound.
  - C4 adds PRICE_HIGHER against the list where no contract exists. It is labelled "מחירון ≠ חוזה", and leak-economist signs the label.
- **Effort.** L.
- **Dependencies.**
  - **G-04 #188** (built, not merged; hard).
  - **#211** (open; hard).
  - G-08 #200 (built).
  - W3-10 for PR b and W3-07a for PR c (wave 3, gated on W2-08 + H-03, **not started**).
  - **H-04** schema batch: a `po_lines` external id (durable C2) and a `goods_receipts.source` column (C5). Not in the PR read.
  - **H-05a**: `cron.ts`.
  - Phase-6 credentials: MarketMan Open API add-on $25–$99/month [3P], Israeli availability UNVERIFIED (06 §4/§5); Zestt buyer export not found (07 §8).
  - Owner: ocr-procurement-engineer; matching-engine-guardian consulted on C3.
- **Gap.** **M#45, M#46** (self-serve procurement integration), **M#58** (use their receipts). This is LOSE gap 1 in note 20 §A.7.
- **Risk → guardrail.** Switching the sync on today **inflates the leak**: every invoice line becomes UNORDERED_ITEM, and a re-sync wipes `gr_lines.po_line_id` (i08 §1.3–§1.4). Guardrails:
  - **No scheduler PR until PR a + G-04 + #211 are merged.**
  - A test asserts that a synced PO line with no SKU and no product is never eligible.
  - Delete + re-insert is replaced by upsert.
  - The supplier name-match needs a human confirm.
  - Nothing is written back to the platform.
- **Immutable files.** `apps/worker/src/cron.ts` → **HUMAN-PR (H-05a)**. `packages/db/src/schema.ts` + a new migration → **HUMAN-PR (H-04)**. The engine is unchanged.
- **Owner rules.** No write-back. No par, inventory or recipe import. Receiver: no ₪ on synced POs (`totalEstimated` redacted, W2-06 AC4/#219/H-11).

#### AU-22 · Supplier negotiation pack
- **One line.** One owner-only page and printable PDF per supplier for the last 3/6/12 months. Sections: spend; item price history (paid price); ₪/month creep (A18 method); contract breaches (`contracts` on); our record with this supplier (discrepancies found, claims sent, credited, days to credit); fill rate (₪-free %).
- **Roles.** Owner only. The chef and receiver never see it.
- **Trigger → action → human confirms.**
  - Three triggers: the owner opens a supplier, A18 fires "contract `valid_to` within 14 days", or a price-list diff shows a rise ≥3%.
  - The system prepares the pack. It can also prepare a **reply draft** to a price-rise notice ("our agreed price is ₪X until DD.MM; please explain the change").
  - The owner chooses the sections, then prints or shares it **himself**. Nothing goes to the supplier from the system.
- **Value (ASSUMPTIONS).**
  - *Hours-₪.* Preparing for a supplier meeting today means opening ledger, contracts, recovery and alerts: 45–90 min per meeting, 1–2 meetings/month (ASSUMPTION). The pack saves ≈0.1–0.5 h/week × 4.33 × ₪103 = **₪45–225/month** (₪65–325 at ₪150).
  - *Avoided-cost ₪.* **None additive.** The pack is the "act" step of A18's avoided cost (₪100–600/month, share reversed 10–30% ASSUMED). It makes that range more reachable and is measured as alerts → negotiations → price change (AU-07).
  - The claim figures shown are A12's leak ₪, in a separate column, never summed with creep.
- **Effort.** M (read-only queries + page + PDF + reply draft).
- **Dependencies.**
  - **AU-13** (B1, start gated on **W2-12, not started**) for creep ₪/month.
  - **W2-11** Supplier 360 (not started) as the host page. Interim: mount under the supplier leak card (`supplierLeakCard` (P), live).
  - W2-10 #193/#194/#197 (built) for the claim record; days to credit from W2-10 timestamps until AU-19's bank evidence.
  - `contracts` (P).
  - money-format-marshal signs the ₪ text.
- **Gap.** **M#11**: no supplier scorecard at either competitor. It sharpens **M#9** (price history: MarketMan has it, 06 §2, but not tied to claims) and the agreed-price moat (**M#10**). Cross-customer benchmarks (MarginEdge 11,500 restaurants [V]) stay out: ICP "later".
- **Risk → guardrail.**
  - Creep presented as leak → separate columns and copy ("מחירים שעלו" vs "דליפה"), T3/T4 tone.
  - An internal note leaks to the supplier → sections are opt-in, and the default excludes internal comments and staff names.
- **Immutable files.** None. A new `packages/charts` view, if needed, is a new file owned by matching-engine-guardian.
- **Owner rules.** Owner-only. A human sends. Two ₪ kinds, never summed.

#### AU-23 · Recipe quick-start from purchases
- **One line.** The chef starts from the restaurant's own priced ingredients, not a blank page.
- **Roles.** Chef (₪ on recipes allowed), owner.
- **Trigger → action → human confirms.**
  - Trigger: the owner switches `recipes` on for the chef, or the chef opens an empty recipes page.
  - The system builds an **ingredient shortlist**: mapped products bought in the last 90 days, ranked by ₪, each with its last paid price and unit.
  - Optional: the chef pastes the menu text or a photo. W3-04's draft-only AI tool proposes **dish skeletons**: dish name plus likely ingredients from the shortlist, with quantities blank or flagged "הערכה".
  - The chef fills in the quantities and confirms each recipe.
  - Unmapped high-₪ lines are offered to the W3-10 "לקשר" queue (the owner or manager links them). This also helps the leak's product pairing.
- **Value (ASSUMPTIONS).**
  - *Hours-₪, one-off.* 30 dishes × 6–12 min saved (product search and typing) = 3–6 h × ₪127 = **₪380–760 one-off**. No monthly hours are claimed.
  - *Avoided-cost ₪.* **Not counted.** It enables the recipe layer, whose 1–3% vendor range (₪2,000–6,000/month) applies only where recipes are maintained [V-derived, 09 §2.1]. Context only.
- **Effort.** M.
- **Dependencies.**
  - **W3-02** (wave 3; gated on W2-08 + H-03, not started). AU-23 lands as a W3-02 addendum, because `recipes/**` is W3-02's.
  - W3-04 AI drafts.
  - W3-10 mapping triage.
  - OD-C3 (pilot flags).
- **Gap.** **M#26, M#28**, LOSE gap 2. It turns MarketMan's setup pain ("tedious", 6–12 weeks [U/3P], 06 §6) into our advantage. Zestt has a live product tree (07 §2.6).
- **Risk → guardrail.**
  - The LLM invents quantities or prices → ₪ only ever comes from `price_history`. AI quantities are blank or flagged; each recipe needs a chef confirm. The W3-04 kill-switch fires below 60% acceptance.
  - Recipes drift into the first-value path → icp-keeper gate: never in onboarding before the first leak figure.
- **Immutable files.** None.
- **Owner rules.** The chef sees ₪ on recipes only. No ₪ in any chef notification outside recipes.

#### AU-24 · Agreed price on every PO
- **One line.** When the chef or manager sends an order, each line carries the agreed price, so the supplier sees it before invoicing.
- **Roles.** Chef and manager (₪ on orders allowed); owner (opt-in).
- **Trigger → action → human confirms.**
  - The PO send text (wa.me / e-mail, W2-06) adds "מחיר מוסכם ₪X" per line.
  - The price comes from `resolveExpectedPrice` restricted to **contract or owner-explicit** prices; never a list or invoice price. **[Corrected by AU-24.md §8 / README §13.6:** "owner-explicit" prices have no source on `main`, so the built option is **contract only**; and `orderPricesOut` is built but OFF in the pilot (`pilot-config.ts:26-37`), so it must be switched on for the opted-in tenant (AU-01 toggle or owner) as part of OD-C6.**]**
  - Lines without an agreed price show no price.
  - The sender still taps send. It is an opt-in per supplier by the owner, using the existing `orderPricesOut` flag (i08 §3.1).
- **Value (ASSUMPTIONS).**
  - *Leak ₪.* **None additive.** It works on the A12 pool in two ways: fewer PRICE_HIGHER at source, and stronger claim evidence ("the order you received said ₪X"), which raises the collection share. Both sit inside the A12 bundle (₪270–720/month recovered, `cat` §F row 1). AU-07 measures PRICE_HIGHER per supplier before and after opt-in.
  - *Hours-₪.* ≈0–0.1 h/week of disputes avoided (manager) = **₪0–45/month**.
- **Effort.** S (flag + send-text builder + owner toggle).
- **Dependencies.**
  - W2-06 #184 (built).
  - **W2-12** (not started) for contract entry. Interim: existing `contracts` (P).
  - AU-01 to add `orderPricesOut` to the owner-toggle allow-list.
  - #230 (`sendStatus` dedupe).
- **Gap.** The agreed-price moat (**M#10**) carried to **M#20**. MarketMan updates prices *from* invoices (06 §2). Zestt price lists are not audited against invoices (07 §2.4).
- **Risk → guardrail.**
  - A wrong price commits the restaurant → only contract or explicit prices, a per-supplier opt-in, and a preview before send.
  - The receiver sees the PO → `redactPrices` (W2-06 AC4) and #219.
- **Immutable files.** None.
- **Owner rules.** A human sends every order. Receiver: no ₪.

#### AU-25 · Food-cost % lite (OWNER DECISION, OD-C7)
- **One line.** Once a month the owner or bookkeeper types one number (food sales before VAT). The monthly report shows purchases-based food-cost % and the leak in food-cost points: "הדליפה החודש = 0.5 נקודות עלות מזון".
- **Roles.** Owner (reads), bookkeeper (fills). Not chef, not receiver.
- **Trigger → action → human confirms.** Month close (W3-05 checklist) asks for the sales figure. The report computes (matched purchases − credits) ÷ sales. It always carries the label "לפי רכש, לא לפי ספירה" and a neutral reference band of 28–35% (Israeli consultants [3P/V], 09 §2.10). There is no money action.
- **Value (ASSUMPTIONS).**
  - *Hours-₪.* Replaces the owner's own spreadsheet: 0.1–0.25 h/week × 4.33 × ₪103 = **₪45–110/month** (₪65–160 at ₪150).
  - *Money-₪.* None. It **dramatises** the North Star number in the owner's language. Example: ₪3,000 leak ÷ ₪600,000 sales = **0.5 food-cost points** (sales ASSUMED at 30% food cost).
- **Effort.** S.
- **Dependencies.** W3-08 monthly report (wave 3); H-07 closed months; W3-05 checklist; `posSales` reused as one monthly row, so no schema change.
- **Gap.** Takes the edge off **M#12–13** (MarketMan COGS/AvT 06 §3, Zestt budget/P&L 07 §2.7) **without** POS, counts or inventory.
- **Risk → guardrail.**
  - Purchases-based ≠ actual food cost → a permanent label, never a hero, never a dashboard tile.
  - Scope drift toward P&L → icp-keeper gate; one line in the report only.
- **Immutable files.** None.
- **Owner rules.** Owner/bookkeeper only. The leak definition is unchanged; the % is a translation, not a second leak.

#### AU-26 · Same-supplier pack-size hint (Phase C+, icp-keeper gate) [plan: Phase **D**, README §13.4]
- **One line.** On an order draft (A16) or a price alert (A18): "אותו ספק: 5 ק״ג זול ב-9% לק״ג מ-2.5 ק״ג".
- **Roles.** Chef (₪ on orders), owner.
- **Trigger → action → human confirms.** The draft builder compares unit prices within **one supplier's** own price list, using unit conversion. The chef decides; the system never changes a quantity or pack.
- **Value (ASSUMPTIONS).**
  - *Avoided-cost ₪, outside the leak.* Items sold in ≥2 pack sizes ≈10% of spend (₪20,000, ASSUMPTION) × 0–1.5% realised = **₪0–300/month**.
  - *Hours-₪.* 0.
- **Effort.** M.
- **Dependencies.** W3-10 item master (units); AU-11 (B2; after W2-06 + AU-04); C4 price lists (AU-21 PR b) or uploaded lists. Reads `packages/matching/src/units.ts` (read only).
- **Gap.** No competitor documents it (substitution AI is global vendor claims only: Lavu, Kostly [V], 09 §2.7). A small WIN on **M#20**.
- **Risk → guardrail.**
  - A bigger pack spoils → copy "רק אם נגמר בזמן"; hints only above ₪50/month projected.
  - Drift to cross-supplier compare → same supplier only; **no `product_group_id`** (ICP lock respected).
- **Immutable files.** None (read-only use of `units.ts`).
- **Owner rules.** The chef sees ₪ on orders (allowed). Receiver: none.

### 2.3 Riders on existing packages (no new id)

| Rider | Host package | What | Value | Owner rules |
|---|---|---|---|---|
| **R1** | AU-13 (A18), B1, gated on W2-12 | The dish-crossed-target alert names the purchase (supplier, invoice number, date). It offers the four standard responses as **copy**: raise the menu price (owner only, a money action), reduce the portion, de-emphasise, switch ingredient (09 §2.2) | Inside A18 (₪0–110 time-₪; ₪100–600 avoided cost). Not additive | Chef: ₪ per plate and food-cost % only. The owner digest carries ₪/month |
| **R2** | W3-02 | Ingredient find-and-replace across recipes, offered when W3-10 merges two products or a supplier product changes. One preview listing affected dishes and the plate ₪ before → after; the chef confirms | Chef 0–0.25 h/week ≈ ₪0–135/month | ₪ on recipes only |
| **R3** | W2-05 exception event via G-06 `notify()` | At receipt close with exceptions, the chef (as well as manager and owner) gets a ₪-free list of short or rejected kitchen lines. It is the same event as the W2-05 alert, not a second job (`cat` §G.1 A6) | Chef 0–0.1 h/week ≈ ₪0–55/month; fewer service surprises (not counted) | No ₪ in the chef notification |

### 2.4 Impact roll-up (not summed)

| Id | Hours-₪/month | Money-₪/month and kind | Counted where |
|---|---|---|---|
| AU-20 | ₪180–400 (manager) | ₪600–1,680 leak **surfaced** (not new, upper bound) | Engine figure; recovery under A12 |
| AU-21 | ₪65–135 (+₪130–190 with C5) | ₪240–1,050 leak surfaced, incremental to AU-20 | As above |
| AU-22 | ₪45–225 (owner; ₪65–325 at ₪150) | none additive (realises A18's avoided cost) | A18 |
| AU-23 | ₪380–760 **one-off** | not counted | — |
| AU-24 | ₪0–45 | none additive (A12 pool) | A12 |
| AU-25 | ₪45–110 (owner) | none | — |
| AU-26 | 0 | ₪0–300 avoided cost | own |
| R1–R3 | ₪0–190 | inside A18 | A18 |

Time-₪ and money-₪ are never added. No grand total is given. "Surfaced" leak is the existing engine's figure on a larger PO base: it is not recovered money and not a new leak type.

---

## 3. New owner decisions (OD-C1..OD-C10)

Labelled **OD-C** so they never collide with AD1–AD14 (README §7.2) or IMPLEMENTATION-PLAN's D-x.

| # | Question | Recommendation | Why | Affects |
|---|---|---|---|---|
| **OD-C1** | Coexistence order | **Documents first (AU-20), API later (AU-21).** Do not register the sync scheduler until AU-21 PR a + G-04 + #211 are merged | Zero credentials, works this quarter. The API sync inflates the leak today (i08 §1.3) | AU-20, AU-21, H-05a |
| **OD-C2** | Schema for coexistence: `po_lines` external line id + `goods_receipts.source` | **Approve into the H-04 proposal** (human-authored) | Durable C2 (keeps dock evidence) and C5 (labelled imported receipts) | AU-21, H-04 |
| **OD-C3** | Switch the chef's area on in the pilot before W3-02 | **Yes for `recipes` + `dishPriceAlert`**, for one pilot tenant whose chef asks for it, after #219 merges. `inventoryCount` stays OFF | Closes LOSE gap 2 with built code. Recipes are already priced from the paid price | AU-01 (allow-list), W3-02 |
| **OD-C4** | Chef and inventory ₪ (same question as i08 §4 Q5, 20 §B.6 #4) | **No ₪ to the chef on counts.** The chef sees quantities; valuation and "actual food cost" stay owner/manager | Keeps the rule "chef ₪ only on orders and recipes" literal | W2-07, W3-02 |
| **OD-C5** | Recipe price basis | **Keep the last paid price** as the dish cost. Show the agreed price as a second, owner-visible column. Any switch to contract price is a ₪-semantics change (leak-economist + owner) | The paid price is the real cost; `cat` §G.2 #10 | W3-02 |
| **OD-C6** | Agreed price on outgoing POs | **Opt-in per supplier, default OFF.** Contract or owner-explicit prices only. **[Corrected: the owner answers against the built option = contract prices only** (no owner-explicit price source on `main`, AU-24 §8), and a yes also switches `orderPricesOut` on for that tenant (OFF in the pilot).**]** | Evidence for claims, and no surprise commitments | AU-24 |
| **OD-C7** | Food-cost % lite: crosses toward the LOSE·D "P&L / food cost" rows (M#12–13) | **Allow, narrowly:** one line in the monthly report, one typed sales number, purchases-based label, never a hero or tile, icp-keeper gate. **OWNER DECISION** | Argument for: it dramatises the leak in the owner's language (food-cost points) without POS, counts or inventory. Argument against: P&L drift. The narrow form keeps the GR wedge central | AU-25 |
| **OD-C8** | What the negotiation pack may show a supplier | **Owner picks the sections. Default:** price history, agreed vs billed, claims and credits record. **Exclude** internal notes and staff names. Never system-sent | The record is the leverage; sharing stays a human act | AU-22 |
| **OD-C9** | Same-supplier pack-size hints | **Allow in Phase C+** behind icp-keeper. Explicitly **not** `product_group_id` / cross-supplier | Within one supplier's own list it is unit arithmetic, not the locked network feature | AU-26 |
| **OD-C10** | AI dish skeletons from the menu | **Yes, draft-only:** names and ingredients from our shortlist; quantities blank or flagged "הערכה"; ₪ never from the model; each recipe chef-confirmed | Removes the setup tax without inventing numbers | AU-23, W3-04 |

**Kept as is (no new decision proposed):** the ICP vetoes in §1.3; AD7 (earned autonomy as a claim, never a waive); AD10 (one owner tap per supplier send). Routed elsewhere: the Pro-covers-one-branch question and the invoice caps (note 20 §B.6 #1–#2).

---

## 4. What remains UNVERIFIED

- MarketMan PO PDF layout (AU-20 needs 3 real samples).
- Zestt delivery-note export format.
- MarketMan Open API availability for Israeli accounts, and Zestt buyer export (Phase-6, human).
- The share of the leak that needs a PO (AU-20/21; AU-07 measures it).
- Pack-size spread in ICP price lists (AU-26).
- How many ICP chefs would maintain recipes at all (no source; 09 §3 pattern: "both hate maintenance").

## Sources

Internal only; every external source is cited inside the notes listed here.
- `notes/20-competitive-matrix-and-win-plan.md` §A–§B
- `notes/ext-09-chef-owner-value.md` §1–§5
- `notes/int-08-procurement-sync-and-inventory.md` §0–§4
- `notes/int-06-catalog-inventory-recipes.md` §7
- `notes/ext-06-marketman.md`, `notes/ext-07-zester.md` (via note 20's citations)
- `notes/10-catalogue-and-impact.md` §0, §A, §C, §F, §G
- `docs/ux/automation/README.md` §7, §9–§11
- `docs/ux/IMPLEMENTATION-PLAN.md` §3 (W2-12), §4 (W3-01..W3-11)
- `docs/ICP.md` §2, §5
- Session open-PR status file (read 2026-11-07)
