# 20 · Competitive matrix and win plan: MarketMan, Zestt (Zester) and RestoMatch

*Synthesis note, written 2026-11-07 on branch `claude/research-in-app-automation` (PR #235). Docs only. It builds on and does not repeat: `ext-06-marketman.md`, `ext-07-zester.md`, `ext-08-israel-others.md`, `ext-09-chef-owner-value.md`, `int-08-procurement-sync-and-inventory.md`, `10-catalogue-and-impact.md`, `docs/ux/automation/README.md` (AU-01..AU-19), `docs/ux/IMPLEMENTATION-PLAN.md` §4–§5 (W3/W4), `docs/ICP.md` §5 (scope veto) and `docs/GTM.md` §5 (tiers). No new web research was done. Every competitor fact below is inherited from those notes with their labels: **[V]** vendor claim, **[3P]** third party, **[U]** user review, **UNVERIFIED** where the note could not source it. No vendor claim is presented as fact.*

**Money rules applied throughout.** One leak definition (Σ|deltaAmount|, MISSING_ON_INVOICE out of the leak and not claimable, pilot PR #211). Software prices, hours-₪ and leak-₪ are never summed. VAT ₪ and price-creep ₪ are shown apart from the leak. Every money action is human-confirmed unless an owner rule says otherwise. Nothing is sent to a supplier automatically. Assumptions are marked **ASSUMPTION**.

---

## 0. How to read the matrix

**Columns.** MarketMan | Zestt (Zester) | RestoMatch today | RestoMatch planned | verdict today | verdict planned.

**Citation shorthand.**
- `06 §n` = `notes/ext-06-marketman.md` section n. `07 §n` = `notes/ext-07-zester.md`. `08 §n` = `notes/ext-08-israel-others.md`. `09 §n` = `notes/ext-09-chef-owner-value.md`.
- `i08 §n` = `notes/int-08-procurement-sync-and-inventory.md` (the code inventory of RestoMatch today; flags from `packages/api/src/lib/features.ts`, pilot set from `packages/db/scripts/pilot-config.ts`).
- Plan ids: **W2-xx / W3-xx / W4-xx** (`docs/ux/IMPLEMENTATION-PLAN.md`), **AU-xx** (`docs/ux/automation/README.md`), **A-xx** (`10-catalogue-and-impact.md`), **G-xx / H-xx** (gap and human-PR items), **C1–C8** (coexistence steps, `i08 §2`), **#nnn** = open PR (from the session PR-status file).

**"RestoMatch today"** = `origin/main` with train A merged, **plus train B** (#224/#232, OCR recognises real consolidated invoices). Status words: **live** (every tenant), **flag:x (P)** (in the pilot set), **flag:x (–)** (built but OFF in the pilot), **stub**, **PR** (open, not merged), **none**.

**Verdict rule.** Judged from the ICP owner's seat, against the **stronger** of the two competitors on that row:
- **WIN**: we do it and neither competitor does, or we do it materially closer to the North Star (₪ the owner believes).
- **PARITY**: comparable, or nobody does it yet.
- **LOSE**: at least one competitor does it and we do not (or ours is OFF in the pilot, so a prospect cannot see it).
- **LOSE·D** ("lose by design"): a competitor does it and `docs/ICP.md` §5 or an owner rule says we should not. It is counted apart and is **not** a gap to close. This note does **not** argue to reopen any ICP veto (§A.7 explains why).

---

## A. The matrix

### A.1 Owner (בעלים, איתן)

| # | Capability | MarketMan | Zestt | RestoMatch today | RestoMatch planned | Today | Planned |
|---|---|---|---|---|---|---|---|
| 1 | **Leak ₪ hero number, one definition** | None. Invoice-vs-PO "flag for review" only; no aggregated ₪ (06 §8) | None. "6% average monthly spend reduction" [V], no method (07 §4.1) | **live** leak hero + breakdown + printable report; MISSING_ON_INVOICE still inside `LEAK_FILTER` until **PR** #211 (i08 §3.4) | #211; W2-09 leak drill (#183/#191/#196); AU-07 measure first | **WIN** | **WIN** |
| 2 | "How did we get to ₪X" proof per line | None found (06 §2) | None found (07 §3) | **flag:leakProof (P)** (i08 §3.4) | W2-09 drill; G-08 provenance (#200) | **WIN** | **WIN** |
| 3 | Caught / claimed / recovered shown apart | Not found (06 §2 "what is not there") | Not found (07 §3 owner row) | **flag:recovery (P)** recovery desk (i08 §3.6) | AU-03; A12/A22/A24 | **WIN** | **WIN** |
| 4 | Approval by ₪ threshold or supplier, with a log | **Yes**, timestamped [V] (06 §2 Approvals) | Not found; no roles or thresholds (07 §4.4) | **live** approval rules auto/queue/block, immutable engine (i08 §3.5) | W2-04 invoice-level desk (#209) | **PARITY** | **WIN** |
| 5 | Hold payment while a discrepancy is open | Not found as a hold; manager approves flagged invoices (06 §2) | None; PayMe can pay suppliers automatically [press] (07 §2.8, §4.4) | **live** `block` decisions in the approvals engine (i08 §3.5); no pay run in pilot | AU-14 pay-run pre-flight ("hold ₪X: open discrepancy") | **PARITY** | **WIN** |
| 6 | Pay suppliers from the app | **Yes**, US ACH/card only; no Masav (06 §2 Vendor payments) | **Yes** via PayMe partnership; current availability UNVERIFIED (07 §2.8) | **flag:payRun (–)** read-only month report, no `markPaid` (i08 §3.7) | W2-03 due buckets + mark paid; AU-14; AU-19 Masav file | **LOSE** | **PARITY** |
| 7 | Earned autonomy (owner grants rules that auto-approve) | None found | None found | none | AU-16 + H-12/H-13 | **PARITY** | **WIN** |
| 8 | Price-rise alert | **Yes**, per item by email/SMS, no ₪/month (06 §2 Price alerts) | Price-change tracking; Plants Council used to *update* prices (07 §2.2) | **flag:priceAlerts (–)**; sweep no-ops for pilot tenants; baselines live (i08 §3.8) | W2-12; AU-13 / A18 creep as ₪/month, labelled avoided cost, outside the leak | **LOSE** | **WIN** |
| 9 | Price history per item | **Yes** (06 §2) | Price lists + tracking (07 §2.2) | **live** price baselines (02:00) (i08 §3.8) | W3-10 item master | **PARITY** | **PARITY** |
| 10 | Agreed (contract) price as the yardstick | Not found; prices updated *from* invoices (06 §2 Supplier catalog) | Price lists, no audit of invoice vs agreed price (07 §2.4) | **flag:contracts (P)** over-contract tab, contract price in matching (i08 §3.8) | W2-12 `lockCurrentPrices` | **WIN** | **WIN** |
| 11 | Supplier leak card / supplier scorecard | None found | None found | **flag:supplierLeakCard (P)** (i08 §3.4) | AU-15 suggestions; negotiation pack candidate (09 §1 item 7, no id yet) | **WIN** | **WIN** |
| 12 | P&L, COGS, budget, debts reports | **Yes**, COGS and AvT dashboards (06 §3) | **Yes**, budget, P&L, debts, monthly expenses [store] (07 §2.7) | **flag:monthlyReport (P)** "one number" monthly report (i08 §3.11) | W3-08 one report with tabs (leak-centred, not a P&L) | **LOSE·D** | **LOSE·D** |
| 13 | Actual vs theoretical food cost (AvT) | **Yes**, core (06 §2) | Revenue vs raw-material use with POS (07 §2.5) | **flag:recipes + integrations (–)** POS vs theory (i08 §3.10) | Not planned as core (ICP §5; A26 later) | **LOSE·D** | **LOSE·D** |
| 14 | Multi-branch roll-up | Per-location tiers (06 §5) | Sells to chains (Japanika ~45 branches) [press] (07 §2.10) | **live** branch switcher; **flag:chain/dashViews/chainAlerts (–)** (i08 §3.13) | W3-01 roll-up matrix | **LOSE** | **PARITY** |
| 15 | Ask in plain language | None found | None found | **flag:aiAssistant (–)** (i08 §3.11) | AU-06; W3-04 | **PARITY** | **WIN** |
| 16 | Daily / weekly brief that dramatises ₪ | Alerts only (06 §2) | Reports "any time" (07 §2.7) | **live** end-of-day report (i08 §3.11) | AU-04, AU-12 weekly digest | **PARITY** | **WIN** |
| 17 | First value before any setup | 6–12 weeks setup [3P, low]; "tedious" [U] (06 §6) | Supplier records before first order (07 §2.11) | Leak from uploaded invoices, but **without POs only DUPLICATE/VAT/TOTAL + contract checks fire** (i08 §2 "Value") | W3-06 mobile leak check; AU-02; C7 document path | **PARITY** | **WIN** |
| 18 | Roles and what each sees | Full ₪ for every role (permission hiding UNVERIFIED) (06 §3) | Users added by email from desktop; no roles found (07 §2.11, §4.4) | **live** 5 roles with route gating; open ₪ exposures to receiver (i08 §3.14) | #219; W2-06 AC4 `redactPrices` | **WIN** | **WIN** |
| 19 | Public price in ₪ | Public USD per location; no ₪ list (06 §5) | Not public; demo call only (07 §2.9) | Public ₪ tiers (`docs/GTM.md` §5.1, `packages/db/src/plans.ts`) | W3-06 "pricing that sells ROI" | **WIN** | **WIN** |

### A.2 Chef (שף)

| # | Capability | MarketMan | Zestt | RestoMatch today | RestoMatch planned | Today | Planned |
|---|---|---|---|---|---|---|---|
| 20 | Order wizard, send by email / WhatsApp | **Yes**, electronic send (06 §2 Purchasing) | **Yes**, one app to every supplier (07 §2.1) | **live** 4-step wizard, PO detail, human send by email/WhatsApp (i08 §3.1) | W2-06 Orders 2 (#184) | **PARITY** | **PARITY** |
| 21 | Fixed order lists, drafts, scheduled auto-send | Par-based PO suggestions (06 §2) | **Yes**: fixed lists, drafts, orders sent on set dates (07 §2.1) | Orders list only; no scheduled send (i08 §3.1) | AU-11 prepared drafts, **owner-tap send only** (rule: nothing auto-sent) | **LOSE** | **LOSE·D** |
| 22 | Cut-off / order reminders | Not found | **Yes**, automatic reminders (07 §2.1) | **live** order-reminders job, email (i08 §3.1) | AU-11 cut-off drafts; AU-04 | **PARITY** | **PARITY** |
| 23 | Par levels, AI ordering, forecast | **Yes**; AI Ordering Enterprise or paid add-on (06 §2) | Not found as forecast (07 §2.1) | not built (i08 §3.9) | Not planned; ICP §5 "later, anti-ICP border" | **LOSE·D** | **LOSE·D** |
| 24 | Order by recipe / prep plan | Add-on [3P, low] (06 §2) | Not found | none | Not planned (ICP §5) | **LOSE·D** | **LOSE·D** |
| 25 | Supplier network with live supplier catalogue | US distributors; no Israeli supplier link found (06 §4) | **Yes**, 2,000 vendors claimed [V] (07 §1, §2.1) | none; supplier confirm link **flag:supplierConfirm (–)** (i08 §3.1) | W3-09 supplier portal 2.0 (answers only, not a network) | **LOSE** | **LOSE** |
| 26 | Recipe / product tree with live dish cost | **Yes**, core (06 §2) | **Yes**, product tree with live cost (07 §2.6) | **flag:recipes (–)**, priced from last *paid* price (i08 §3.10) | W3-02 recipe workbench | **LOSE** | **PARITY** |
| 27 | Dish crossed target because of a purchase (push) | Recipe cost recomputed, low-margin items highlighted (06 §2) | Not found | **flag:dishPriceAlert (–)**, pull only (i08 §3.10) | AU-13 push; A18 | **LOSE** | **PARITY** |
| 28 | Dish cost from the **checked** invoice price | From scanned invoice price (06 §2) | From price lists / Plants Council (07 §2.2) | Paid price in the recipes code (i08 §3.10), flag OFF | W3-02 + one mapping feeding leak and dish cost (09 §2.1) | **LOSE** | **WIN** |
| 29 | Chef sees ₪ only on orders and recipes | Chef sees ₪ on invoices too (hiding UNVERIFIED) (06 §3) | Chef sees costing (07 §3) | Chef route: orders (₪ allowed) + settings; inventory ₪ is an open owner question (i08 §3.14, §4 Q5) | Owner decision on inventory ₪ before `inventoryCount` reaches chef | **WIN** | **WIN** |
| 30 | Inventory counts | **Yes**, core (06 §2) | **Yes**, counts, warehouses, year-end (07 §2.5) | **flag:inventoryCount (–)** (i08 §3.9) | W2-07 count as a field instrument (not core) | **LOSE·D** | **LOSE·D** |
| 31 | Waste log | Growth+ (sources conflict) (06 §2) | Not found | none | Not planned (09 §1 item 6: "do not build") | **LOSE·D** | **LOSE·D** |
| 32 | Menu engineering | Low-margin items highlighted (06 §2) | Not found | none | Later; needs POS (09 §1 item 3, A26) | **LOSE·D** | **LOSE·D** |
| 33 | Produce market reference | None | Plants Council feed, used to update prices (07 §2.2) | none | AU-13 + A25 "paid X% above market" as T4 info, two references and a band (09 §1 item 8) | **LOSE** | **WIN** |

### A.3 Manager (מנהל)

| # | Capability | MarketMan | Zestt | RestoMatch today | RestoMatch planned | Today | Planned |
|---|---|---|---|---|---|---|---|
| 34 | Line-level invoice-vs-PO discrepancies | Flags differences "for review" (06 §2 Invoice scanning) | No line audit; invoices are documents Zestt records (07 §2.4) | **live** 12-type engine, auto re-match (i08 §3.4) | Unchanged (immutable `packages/matching`) | **WIN** | **WIN** |
| 35 | 3-way match PO + goods receipt + invoice | PO match; receiving vs PO; no door-evidence chain (06 §8) | Receiving "verifies data" [V] (07 §2.3) | **live** receiving + engine (QTY_SHORT/QTY_OVER) (i08 §3.2, §3.4) | W2-05 (#189/#202) | **WIN** | **WIN** |
| 36 | Exception queue ranked by ₪ | Review flags (06 §2) | None (07 §3 manager row) | **live** per-discrepancy decisions (i08 §3.5) | W2-04 desk (#209); W2-08 task spine "מחכה לך" | **PARITY** | **WIN** |
| 37 | Bulk approve with a safety cap | Not documented | None | none | W2-04 bulk cap ₪200, never bulk `block` (i08 §3.5) | **PARITY** | **WIN** |
| 38 | Duplicate invoice detection | Not documented (06 §2) | Not found | **live** DUPLICATE check in the engine (i08 §2 "Value") | AU-10 cross-channel duplicate hold | **WIN** | **WIN** |
| 39 | Same invoice arriving by email + WhatsApp + photo | Not found | Not found | none (ingest channels OFF in pilot) | AU-10 | **PARITY** | **WIN** |
| 40 | Credit request (דרישת זיכוי) drafted | **Not found**; one low-authority mention of "credit memo" (06 §0) | **Yes**: credit requests in app, "automatic credits" [V] (07 §4.2) | **live** letters per supplier (copy / wa.me / mailto); letterhead **PR** #213 (i08 §3.6) | W2-10 claim drafted at the decision (#193/#194/#197) | **PARITY** | **WIN** |
| 41 | Claim status, ageing, overdue after 7 days | Not found | Not found (07 §4.2) | **flag:recovery (P)** overdue at 7 days, daily chase 08:30 (i08 §3.6) | AU-03 (also fixes web vs email count mismatch) | **WIN** | **WIN** |
| 42 | Credit note matched to the claim | Not found | Not found (07 §4.2) | **flag:recovery (P)** manual credit-note entry (i08 §3.6) | W3-11 credit-note OCR routing; AU-17 | **WIN** | **WIN** |
| 43 | Supplier reply tracked and classified | Not found | Not found | none | AU-17 read-only classifier + owner-tap send (needs H-06) | **PARITY** | **WIN** |
| 44 | Nothing goes to a supplier without a human tap | Manager sends orders (06 §2) | Scheduled auto-send orders; credits "automatic" (07 §2.1, §4.2) | **live**: system sends nothing; human sends letters (i08 §3.6) | AU-17 owner-tap send | **WIN** | **WIN** |
| 45 | Read orders from MarketMan / Zestt (coexistence) | n/a | n/a | Zestt PO **document** import **live** (needs OCR key); API sync **stub**, never runs; enabling it today would inflate the leak (i08 §0, §1.3) | C1–C8; G-04; W3-07a hub | **PARITY** | **WIN** |
| 46 | Self-serve integrations (POS / accounting / procurement) | **Yes**: Tabit, Hashavshevet H-ERP partner (scope UNVERIFIED), Xero, QuickBooks (06 §4) | **Yes**: Tabit, Beecomm, H-ERP partner page (07 §2.8) | **flag:integrations (–)**; procurement preview is sample data only (i08 §1.1, §3.12) | W3-07a hub; C6/C7 (Phase-6 credentials, human) | **LOSE** | **PARITY** |
| 47 | Staff notifications (email / SMS / WhatsApp / push) | Email/SMS price alerts (06 §2) | App reminders (07 §2.1) | Email outbox **live**; WhatsApp `role:` targets undeliverable; push mock (i08 §3.11); **PR** #173, #230, #231 | G-06 (#199); H-05 | **LOSE** | **PARITY** |
| 48 | Native mobile app | **Yes**, rated ≈3.1–3.3/5 [U] (06 §7) | **Yes**, iOS/Android (07 §1) | **flag:receiverPwa (P)** for the receiver only (i08 §3.2) | W3-03 installable app + push | **LOSE** | **PARITY** |

### A.4 Receiver (מקבל סחורה, רמי)

| # | Capability | MarketMan | Zestt | RestoMatch today | RestoMatch planned | Today | Planned |
|---|---|---|---|---|---|---|---|
| 49 | Receive against the order on a phone | **Yes**, tick quantities vs PO (06 §2 Mobile receiving) | **Yes**, receive against the order (07 §2.3) | **live** today board + wizard + per-line count (i08 §3.2) | W2-05 slices A/B | **PARITY** | **PARITY** |
| 50 | Receiver sees **no ₪** | Sees PO prices (UNVERIFIED) (06 §3) | ZesttScan fills prices at the door (07 §2.3) | Receiving UI has no ₪, but `orders.list/get` totals and the supplier ledger still reach the receiver; **PR** #219 partial (i08 §3.14) | #219 + W2-06 AC4 `redactPrices` | **PARITY** | **WIN** |
| 51 | Scan the delivery note to fill quantities | Barcode receiving mentioned once, UNVERIFIED (06 §2) | **ZesttScan**, ~30 h/month saved [V] (07 §2.3) | **flag:dockSlip (P)** delivery-note photo first; quantities still typed (i08 §3.2) | W2-05; G-09 multi-page (#190) | **LOSE** | **PARITY** |
| 52 | Photo evidence and signature at the door | Not found (06 §8) | Not found (07 §3 receiver row) | **live** photos + signature (i08 §3.2) | W2-05 | **WIN** | **WIN** |
| 53 | Reject reasons per line feeding a claim | Ticks quantities (06 §3) | Flags shortages (07 §4.2) | **live** reject reasons → engine → claimable lines (i08 §3.2, §3.6) | W2-05 walk-in / exceptions desk | **PARITY** | **WIN** |
| 54 | Works offline at the dock | Users: fine "with good connectivity"; uploads fail [U] (06 §7) | UNVERIFIED | **flag:receiverPwa (P)** offline photo queue (i08 §3.2) | W2-05 full outbox | **WIN** | **WIN** |
| 55 | Digital delivery note from the supplier before the truck | None in Israel (06 §4) | **Yes**, for integrated suppliers (07 §2.3) | Supplier confirm answer never reaches the dock (i08 §3.1) | W3-09 order-to-door loop; G-10 | **LOSE** | **LOSE** |
| 56 | Expected deliveries for today | Scheduled-deliveries endpoint assumed in our adapter, contract UNVERIFIED (i08 §1.1) | Orders page (07 §2.3) | **live** today board; daily-expectations job (i08 §3.1, §3.2) | ICP §5 "pilot": accurate `expectedDeliveryAt` | **PARITY** | **PARITY** |
| 57 | Receiver UI in other languages | Hebrew UI exists (06 §1) | Hebrew (07 §1) | **flag:receiverLanguages (–)** (i08 §3.2) | Flag on when piloted | **PARITY** | **WIN** |
| 58 | Use receipts already typed in the other tool | n/a | n/a | No adapter method exists (i08 §1.2) | C5 import receipts labelled "נקלט ב-MarketMan" (schema human-PR, H-04) | **PARITY** | **WIN** |

### A.5 Bookkeeper (מנהלת חשבונות, מיכל)

| # | Capability | MarketMan | Zestt | RestoMatch today | RestoMatch planned | Today | Planned |
|---|---|---|---|---|---|---|---|
| 59 | Invoice OCR on Israeli Hebrew invoices | OCR exists; Hebrew OCR quality UNVERIFIED; "did not work half the time" [U] (06 §7) | No invoice OCR beyond ZesttScan (07 §2.4) | **live** pipeline; real OCR only for allow-listed tenants (i08 §3.3) | AU-02; AU-07 measures accuracy before any claim | **PARITY** | **PARITY** |
| 60 | No scan cap per month | Starter 50 AI scans/month, +$50 per 50 (06 §5) | UNVERIFIED | Plan limits: basic 150, pro 400 invoices/month (`plans.ts`) | Owner decision (see §B.6) | **PARITY** | **PARITY** |
| 61 | Email / WhatsApp invoice intake | **Yes**, email upload (06 §2) | n/a | **flag:ingestEmail / ingestWhatsapp (–)** (i08 §3.3) | AU-02; AU-10 | **LOSE** | **PARITY** |
| 62 | "Invoices waiting for lines" + manual lines when OCR fails | Re-upload [U] (06 §7) | Not found | **PR** #216, #222, #223 (i08 §3.3) | AU-02 | **PARITY** | **WIN** |
| 63 | Consolidated invoice (חשבונית מרכזת) ↔ delivery-note set | Not found; one invoice per PO (06 §8) | **Manual**: type the original total, hunt the gap by hand (07 §2.4) | OCR recognition (train B #224/#232); matching **flag:consolidatedMatch (–)** (i08 §3.3) | AU-09 / A14 proposes the set and explains the ₪ residual | **LOSE** | **WIN** |
| 64 | Allocation-number (מספר הקצאה) guard | Not found (06 §8) | Not found (07 §4.3) | none | AU-08 / A13 allocation field in the cockpit | **PARITY** | **WIN** |
| 65 | VAT at risk, shown apart from the leak | Tax only as a mapped account on Xero export (06 §8) | Not found (07 §4.3) | **flag:vatAtRisk (–)** (i08 §3.4) | AU-08 | **PARITY** | **WIN** |
| 66 | Missing-documents report before the 15th | Not found; export only (06 §3) | Not found | none | AU-18 / A23 under W3-05 close desk | **PARITY** | **WIN** |
| 67 | Israeli accounting export | Hashavshevet H-ERP partner (data scope UNVERIFIED); Xero/QBO, 17 QBO export incidents in 2 years [3P] (06 §4) | H-ERP partner page, content not retrieved (07 §2.8) | **flag:integrations (–)** + plan `accounting_export`: Hashavshevet / Priority / Rivhit (i08 §3.12) | W2-14 honest exports; W3-05 month close | **LOSE** | **PARITY** |
| 68 | Supplier ledger (כרטסת) reconciliation | Not found (06 §2) | "Debts" report; reconciliation UNVERIFIED (07 §2.7) | **flag (P)** supplier ledger (i08 §0 item 6) | W3-11 supplier statements | **WIN** | **WIN** |
| 69 | Invoice register, due dates, printed terms | Approvals + vendor payments (06 §2) | Payments report (07 §2.7) | none in main | W2-02 register/cockpit (#217); W2-03; G-17 | **LOSE** | **PARITY** |
| 70 | Month close desk | Not found | Not found | none | W3-05 | **PARITY** | **WIN** |
| 71 | Invoice image next to the reconciled record | **Yes**, praised by users [U] (06 §7) | Photo of the original "recommended" (07 §2.4) | **live** photo pipeline (i08 §3.3) | G-08 link provenance (#200) | **PARITY** | **PARITY** |

### A.6 Headline counts

71 rows. Counted from the tables above.

| Verdict | Today | Planned (W2–W4 + AU) |
|---|---|---|
| **WIN** | **17** | **42** |
| **PARITY** | **29** | **19** |
| **LOSE** (a gap to close) | **18** | **2** |
| **LOSE·D** (lose by design, ICP veto) | **7** | **8** |
| Rows where the verdict improves when the plan ships | — | **36** |

How to read it:
- **Today we win only on the leak loop itself** (rows 1–3, 10–11, 34–35, 38, 41–42, 44, 52, 54, 68), plus role discipline and a public ₪ price (rows 18–19, 29). Those are the money and trust rows. We lose on **breadth and on what the pilot switches off** (recipes, price alerts, consolidated match, integrations, intake channels, pay run).
- **Planned, the two LOSE rows left are structural**: the supplier network (row 25) and digital delivery notes from suppliers (row 55). Both belong to Zestt's two-sided network. The answer is to **integrate** with that network (C7 document path, §B.2), not to build one.
- Row 21 moves from LOSE to LOSE·D because the owner rule (nothing sent automatically) caps AU-11 at drafts plus a human tap. That is a deliberate trade, not a gap.

### A.7 The 5 biggest LOSE gaps (today) and the 5 biggest WIN moats

**Biggest LOSE gaps (ranked by how often they will kill a deal with a MarketMan / Zestt user):**

1. **No live connection to MarketMan or Zestt** (rows 45–46). The sync is a stub that never runs, both API contracts are invented, and enabling it today would **inflate the leak**: synced PO lines have no `productId` or `supplierSku`, so every invoice line becomes UNORDERED_ITEM (inside `LEAK_FILTER`) and a re-sync wipes `gr_lines.po_line_id` (i08 §0 items 3–4). Fix: C1–C3 + G-04 first, then C6/C7. **Do not switch the scheduler on before C1–C3** (H-05 addendum is a human PR).
2. **The chef's area is empty in the pilot** (rows 26–28). Recipes, dish price alerts and inventory are all flagged OFF, while both competitors show live dish cost. Fix: W3-02 and AU-13 push, with one mapping feeding both the leak and the dish cost (09 §2.1).
3. **Price-rise alerts are OFF in the pilot** (row 8). MarketMan's best-known feature is exactly this. Fix: W2-12 + AU-13 as ₪/month creep against the **agreed** price, labelled avoided cost, outside the leak.
4. **Consolidated invoice matching is OFF** (row 63). Zestt has a working (manual) flow, and חשבוניות ריכוז are the norm for ICP suppliers. Fix: AU-09 on top of train B.
5. **Israeli accounting export and intake channels are OFF in the pilot** (rows 61, 67). Both competitors list a Hashavshevet partnership. Fix: W2-14 honest exports, W3-05, AU-02; a bookkeeper must see her export work in week 1.

(Honourable mention: pay suppliers in-app, row 6, which closes with W2-03/AU-14/AU-19.)

**Biggest WIN moats (the deal is won here):**

1. **One leak ₪ figure the owner believes** (rows 1–2): Σ|deltaAmount| with MISSING_ON_INVOICE excluded (#211), drillable to the line. MarketMan flags; Zestt claims "6%" with no method.
2. **Found → claimed → overdue at 7 days → credited** (rows 3, 40–42). Neither competitor shows claim ageing or credit-note matching (06 §8, 07 §4.2).
3. **The dock as evidence**: a 3-way match with photos, signature and reject reasons, and a receiver who sees no ₪ (rows 35, 50, 52–54). Both competitors put prices on the receiver's screen.
4. **Agreed price as the yardstick, with a hold before payment** (rows 5, 10). MarketMan updates its prices *from* the invoice; Zestt can auto-pay through PayMe.
5. **Trust by design**: nothing is sent to a supplier without the owner's tap (row 44), and the bookkeeper desk is planned (allocation number, VAT at risk, missing documents, consolidated: rows 63–66). Neither competitor has any of those four (06 §8, 07 §4.3).

**Why this note does not argue with the ICP veto.** The LOSE·D rows (12–13, 21, 23–24, 30–32) are MarketMan's and Zestt's home ground: pars, forecasts, AI ordering, counts, AvT, waste and menu engineering. ext-06 §9 and ext-07 §7 both found that competing there means fighting a $100M-backed incumbent (MarketMan) or a two-sided network (Zestt) on their turf, with weeks of setup the ICP owner does not want. Nothing in ext-06..09 or int-08 argues for reversing `docs/ICP.md` §5. The one in-scope use stays as it is: **expected quantity from order history as fuel for the goods-receipt check** (AU-11), with copy and placement subordinate to receiving (07 §7).

---

## B. How we win deals

### B.1 Positioning, one sentence each

Draft lines. Hebrew-first copy belongs to `growth-pmm-engineer`, and the lines should be tested in the 10–15 field interviews before use (07 §7).

- **Against MarketMan:** "MarketMan tells you what the dish should cost. RestoMatch tells you what the supplier owes you back, and gets it." (06 §9)
- **Against Zestt:** "Zestt helps you order. RestoMatch tells you how many ₪ you lost after the order, and gets them back." (07 §7)
- **For both (the coexistence line):** "Keep ordering where you order. We check what arrived and what was billed, and show you the ₪."

### B.2 Switch or coexist: coexist, win on leak ₪ first, then expand

**Decision: coexist.** A restaurant on MarketMan or Zestt is a **warm** ICP lead (ICP §5: S5 weight 1.0 for "MarketMan/Zester connected"). Its orders already exist. We never ask it to stop ordering in its tool.

**Sequence (each step needs the one before it):**

| Stage | What the prospect gets | What must exist | Status / owner |
|---|---|---|---|
| **0. Land with zero credentials** | Leak ₪ on last month's invoices plus their PO documents | C7 document path: forward the PO PDF or email to the ingest address. Works today for Zestt (`importPo`, i08 §1.3); **MarketMan PO PDFs need a parser extension** | Parser: ocr-procurement-engineer. Pilot ops: growth-pmm-engineer |
| **1. Prove the number** | One leak figure, drillable, MISSING_ON_INVOICE excluded | #211 merged; W2-09 drill; AU-07 coverage line | #211 open (owner-approved 31.10) |
| **2. Close the loop** | Claims drafted at decision, overdue at 7 days, credit matched | W2-10 (#193/#194/#197), AU-03, letterhead #213 | Built / open PRs |
| **3. Pair lines safely** | Synced orders match line by line, no false UNORDERED_ITEM | **C1** SKU/product key on synced lines; **C2** upsert lines in place, never rewrite a received PO (durable form needs a `po_lines` external id: schema **human PR**, H-04); **C3** our status wins after the dock; **G-04** merged | Agent work (C1, C2 interim, C3); schema human PR |
| **4. Expected price without a sheet** | PRICE_HIGHER against the supplier list | **C4** `listProducts` → `supplier_catalog_items` with "מה ישתנה" review (W3-10); list ≠ contract unless the owner locks it (W2-12) | ocr-procurement-engineer; leak-economist signs the label |
| **5. Go live on the API** | No forwarding; orders arrive by themselves | **C8** real API contracts replace the VERIFY shapes; **C7** credentials (MarketMan Open API add-on, $25–$99/month [3P], Israeli availability UNVERIFIED; Zestt has **no restaurant-side API found**); **C6** scheduler + `sync_cursor` + "N orders skipped" health line in the W3-07a hub | **Phase-6, human only** for credentials; `cron.ts` is a **human PR** |
| **6. Use their receipts** | 3-way match for restaurants that receive in the other tool | **C5** import receipts labelled "נקלט ב-MarketMan"; GR `source` column (schema human PR, H-04) | After stage 5 |
| **7. Expand** | Receiver flow without ₪ (#219, W2-05), bookkeeper desk (AU-08, AU-09, AU-18), approvals and pay-run hold (W2-04, AU-14) | As planned | Wave 2 → C |

**Never built for coexistence:** write-back of any kind (no "approved" pushed to MarketMan, no claim pushed through Zestt), par and inventory import, recipe import as core, cross-supplier price compare (ICP "later, locked") (i08 §2).

**When a full switch makes sense:** only when the prospect uses MarketMan or Zestt *just* for invoice scanning and price alerts, not for ordering. Then RestoMatch replaces that slice. **ASSUMPTION:** this is a minority of their users; no source measures it.

### B.3 Price comparison (per location, per month)

| | RestoMatch | MarketMan | Zestt |
|---|---|---|---|
| **List price** | Trial ₪0 (100 invoices) · Basic **₪349** (150) · **Pro ₪590** (400 invoices, 1 branch, 10 seats) · Chain **₪1,490** (5 branches) | Starter **$249** (was $199) · Growth **$299** (was $249) · Enterprise **from $449**. Sources conflict: a later snapshot shows $199/$249 again [3P] | **Not public.** Demo call only. "From ₪45,000" on its site is sample dashboard data, **not a price** |
| **Source** | `docs/GTM.md` §5.1; `packages/db/src/plans.ts` (`priceAgorotMonthly` 34,900 / 59,000 / 149,000); `docs/ICP.md` line 16 (ROI vs ₪590) | 06 §5 (PricingSaaS 2026W34/W36, vendor page via search) | 07 §2.9 |
| **In ₪ (ASSUMPTION $1 ≈ ₪3.7, not sourced)** | — | Starter ≈ ₪920 · Growth ≈ ₪1,100 · Enterprise ≈ ₪1,660+ | — |
| **Basis** | Per restaurant (Pro = 1 branch) | Per location | UNVERIFIED |
| **Setup** | None listed | ≈$500–$1,500, often waived in promotions (06 §5) | UNVERIFIED |
| **Caps / add-ons** | Invoices per month by tier | Starter 50 AI scans, +$50 per 50; AI Ordering Enterprise or paid add-on; API add-on $25–$199; commissary $499–$749 | UNVERIFIED whether ZesttScan is a paid add-on |
| **Who pays** | The restaurant | The restaurant | **UNVERIFIED** (restaurant, supplier or both) |
| **Contract** | Owner decision; founders price ₪354 in year 1 (`docs/GTM.md` line 89) | Annual, 60-day notice, billing after cancel reported [U] (06 §6) | UNVERIFIED |
| **Reference: Israeli low end** | — | — | Restomate (not Zestt) "from ₪299/month" [V] (08 §2) |

**How to use the table in a sale.** Do not lead with "we are cheaper". Lead with the GTM frame: the price is **15–25% of the leak found** ("pay ₪590 to stop ₪2,250", `docs/GTM.md` §5.2). For a MarketMan user, RestoMatch Pro is **added** spend, not a replacement, so the ROI has to come from the leak alone. Software spend, hours saved and leak ₪ are **never summed** into one "savings" figure.

### B.4 Top 3 objections per competitor, with answers

**MarketMan user**

| Objection | Answer | Proof we can show |
|---|---|---|
| "MarketMan already flags invoice differences." | It flags and stops. We total them into one ₪ figure, draft the claim at your decision, mark it overdue after 7 days and match the credit note. | Last month's invoices → leak figure → open claims list (rows 1, 3, 41–42) |
| "I won't type my orders twice." | You don't. Keep ordering in MarketMan. Forward the PO (document path) now; the API sync comes once credentials exist. | C7 document import; C1–C8 plan (§B.2). **Honest limit:** MarketMan PO PDF parsing is not built yet |
| "I already pay about ₪1,100 a branch for software." | RestoMatch is priced off the leak it finds. Run the trial on last month; if the leak is smaller than the price, don't buy. | GTM §5.2 table. Never add software ₪ to leak ₪ |

**Zestt user**

| Objection | Answer | Proof we can show |
|---|---|---|
| "Zestt already does automatic credits." | Ask where the list is of credits requested but not yet received, older than 7 days. We show that list, and we send nothing to your supplier without your tap. | Recovery desk (row 41); rule "nothing sent automatically" (row 44). Zestt's credit follow-through is UNVERIFIED, not proven absent (07 §4.2): say "show me", don't say "they can't" |
| "My suppliers send digital notes through Zestt. Why photograph paper?" | Keep them. Forward Zestt documents to us; we import them. We add what Zestt doesn't: the check against the agreed price and the delivery. | Zestt document import **live** (i08 §3.1); rows 10, 34–35 |
| "Zestt already handles consolidated invoices." | In Zestt you type the original total and hunt the gap by hand. We propose the delivery-note set and explain the ₪ residual. | **Honest limit:** AU-09 is planned and `consolidatedMatch` is OFF in the pilot. Promise it only when AU-09 is merged |

Extra line for both: their headline numbers ("6% less spend", "30 hours a month") are vendor claims with no method (07 §4.1). Ours is one leak definition, line by line, with the evidence one tap away.

### B.5 Switching costs we must remove

| Switching cost | Why it blocks the deal | Concrete product move | Plan id / status |
|---|---|---|---|
| **Catalog setup** | MarketMan's 6–12 weeks of item master work is the pain owners remember (06 §6) | First leak with **no item master**: invoices + delivery notes only. Supplier price list as expected price, pulled or uploaded, reviewed in "מה ישתנה". Mapping triage with suggestions, auto only on SKU or alias | C4, W3-10, AU-15, G-08 |
| **Supplier onboarding** | Zestt needs supplier records before the first order (07 §2.11); suppliers resist portals | Suppliers do nothing. The supplier is created from the first invoice or synced list. **Fix first:** the sync's silent name-match adoption (a platform "תנובה" adopts our manual "תנובה" with no human confirm, i08 §1.2) needs a confirm step. Claims go out by the owner's own WhatsApp or email | C1 + confirm step; W2-10; AU-17 |
| **Historical data** | An owner judges us on *his* last month, not a demo | Bulk upload of last month's invoices and their POs; consolidated invoices recognised (train B); "waiting for lines" list so no invoice silently drops out of the leak | W3-06 mobile leak check; AU-02; #216/#222/#223 |
| **Staff habits** | Chef orders in MarketMan/Zestt; receiver already ticks quantities there | Chef keeps ordering where he orders. Receiver gets a no-₪ flow under 3 minutes, offline, or we read his receipts from the other tool. Owner gets one weekly brief instead of a new app to open | #219, W2-05, C5, AU-12, W2-08 |
| **POS integration** | Competitors connect to Tabit and Beecomm | The leak needs **no POS**. Do not sell POS-dependent features (A26 later) | Messaging only |
| **Accounting integration** | The bookkeeper is the channel (ICP); both competitors list a Hashavshevet partnership | Hashavshevet / Priority / Rivhit export on in the pilot, plus the bookkeeper's own reasons to log in: missing documents, allocation number, VAT at risk | W2-14, W3-05, AU-08, AU-18 |

### B.6 Decisions for the owner (routed, not decided here)

1. **Pro covers one branch.** The ICP is 1–3 branches. A 2-branch owner pays 2 × ₪590 = ₪1,180 or Chain ₪1,490 (5 branches). Against MarketMan Growth at ≈₪2,200 for two branches (06 §5, ASSUMED rate) that is still lower, but the packaging should be deliberate. Owner + leak-economist (`plans.ts` is immutable: human PR).
2. **Invoice caps per tier vs the "no scan cap" lesson.** ext-06 §9 says a capped plan means "leak not seen". Basic caps at 150 and Pro at 400 invoices a month. **ASSUMPTION:** a 1-branch ICP restaurant stays under 400; this needs checking against pilot volumes before it becomes a sales line.
3. **Name collision with Restomate** (08 §0 item 3): a GTM and SEO risk for growth-pmm-engineer and icp-keeper.
4. **Chef and inventory ₪** (i08 §4 Q5): needs a yes or no before `inventoryCount` reaches a chef.
5. **Phase-6 credentials**: MarketMan Open API for Israeli accounts, and a Zestt buyer-side export. A human asks both vendors (06 §10, 07 §8).

---

## Sources

Internal only; every external source is cited inside the notes listed here.

- `docs/research/אוטומציות במוצר/notes/ext-06-marketman.md` §0–§10
- `docs/research/אוטומציות במוצר/notes/ext-07-zester.md` §0–§8
- `docs/research/אוטומציות במוצר/notes/ext-08-israel-others.md` §0–§3
- `docs/research/אוטומציות במוצר/notes/ext-09-chef-owner-value.md` §1–§2
- `docs/research/אוטומציות במוצר/notes/int-08-procurement-sync-and-inventory.md` §0–§4
- `docs/research/אוטומציות במוצר/notes/10-catalogue-and-impact.md` (A-items)
- `docs/ux/automation/README.md` (AU-01..AU-19, phases A/B/C)
- `docs/ux/IMPLEMENTATION-PLAN.md` §4–§5 (W3-01..W3-11, W4-01)
- `docs/ICP.md` line 16 and §5 (scope veto); `docs/GTM.md` §5.1–§5.2; `packages/db/src/plans.ts` (`PLAN_SEED`)
- Open-PR status file for this session (read 2026-11-07)
