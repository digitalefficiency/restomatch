# ext-06: MarketMan competitor teardown (מרקטמן)

*Researcher note. All sources seen on **2026-11-07** unless marked otherwise. Scope: what MarketMan does, module by module and role by role; its Israeli presence, integrations, pricing, onboarding, contract terms and real user complaints; and where it is weak on the one thing RestoMatch sells: **supplier leak in ₪, claimed and recovered**. It builds on ext-01 §MarketMan, ext-03 §1.5, ext-02 (AvT row) and ext-05 (case-study hours). It does not repeat those rows; it extends and corrects them.*

> **Method caveat.** As in ext-01, this session could not fetch pages. WebFetch to `marketman.com`, `marketman.co.il`, `h-erp.co.il` and `pricingsaas.com` failed DNS resolution in the sandbox (those hosts are not on the session's allowed network list). Every finding is from **search-engine extracts** of the cited page. Rows marked **[V]** are vendor claims, **[3P]** third-party directory or press, **[U]** a real user review (paraphrased), **UNVERIFIED** where no source confirms. Review sites that are themselves AI-generated aggregators (checkthat.ai, toolradar, enterprisedna, restauranttools.ai, makerstack) are cited as low-authority [3P] only.

---

## 0. TL;DR

1. **MarketMan is an inventory-and-purchasing system with an AP tail, not a leak detector.** Its centre of gravity is counts, pars, recipes, Actual-vs-Theoretical (AvT) and ordering. Invoice OCR exists mainly to **update prices and close the PO** so the inventory and recipe numbers are right. It flags invoice-vs-PO differences "for review" and alerts on price rises. **We found no claim workflow; it flags the difference for review.** We also found no claim ledger, recovered-₪ figure or leak ₪ headline (searched three ways; one low-authority directory mentions "credit memo functionality"; UNVERIFIED). This is "not found", not "proven absent": never say "they don't do claims".
2. **Israeli by origin, US by product.** Founded in **Tel Aviv in 2012–13** (one registry gives a Ra'anana address, §1) by Noam Wolf, Igal (Yigal) Wolf and Or Mintz; **HQ New York**; merged in **2022** with **Meal Ticket (Boise)**, alongside a **PSG investment of more than $100M** [3P]. It is now sold "powered by Meal Ticket". The Israeli site and Facebook page claim **1,200+** (one partner page says **2,000+**) restaurants "in Israel and abroad". A Hebrew UI exists (Capterra lists Hebrew). **No Israeli invoice features (allocation number / מספר הקצאה, Israeli VAT 18%, חשבונית מרכזת, Hebrew OCR) were found**, and its documented accounting connectors are US/global (Xero, QuickBooks).
3. **Israeli integrations:** MarketMan is **listed as a partner by Tabit and Hashavshevet** (Tabit: MarketMan partner page + Tabit support article; Hashavshevet: partner page on h-erp.co.il). We make **no claim of a specific Hashavshevet export**: what data flows could not be read. **Beecomm, Caspit, Priority, Rivhit, iCount: no evidence found**.
4. **Pricing (US), dated range:** **Starter ~$199–249, Growth ~$249–299, Enterprise from $449 per location per month** (third-party trackers, Aug–Sep 2026; prices changed during 2026). Starter is capped at **50 AI invoice scans per month**; Growth is unlimited; **AI Ordering is Enterprise-only or a paid add-on**. **Setup: a one-time setup fee (one review says $500), often waived in promotions.** **Israeli ₪ pricing: not public, UNVERIFIED.** We quote USD only: no sourced, dated ₪ exchange rate is used in this note.
5. **User voice (2024–2026):** praise for cost control, recipe costing and "no more typing invoices". **G2 reviewers mention scan failures, slow support and hard cancellation**; Capterra reviewers mention tedious setup; Trustpilot reviewers mention billing after cancelling (60-day notice). Ratings seen **2026-11-07**: **G2 4.3/5 (52 reviews)**, **Capterra 4.7/5 (112 reviews)**. No app-store rating is cited (trackers disagree).
6. **Where RestoMatch wins.** MarketMan stops at "discrepancy flagged → manager approves the invoice". RestoMatch continues: **found → claimed → sent → credited**, one leak definition in ₪, consolidated-invoice reconciliation, allocation-number and VAT-at-risk, and a receiver who sees no ₪. MarketMan is also a **warm input** (ICP §1/§4): a restaurant already on MarketMan has POs that RestoMatch can match against.
7. **Where RestoMatch must not follow.** Par levels, forecasts, AI ordering, counts and AvT are MarketMan's home ground and sit on the ICP **anti-ICP / later** list (`docs/ICP.md` lines 119–124). This teardown supports that veto (§9).

---

## 1. Company and Israeli presence

| Fact | Detail | Source |
|---|---|---|
| Founders | Noam Wolf (CEO at the time), Igal/Yigal Wolf, Or Mintz (VP R&D). Background in mobile apps in Israel | [3P] [Startup Nation Central / IVC / Tracxn profiles](https://finder.startupnationcentral.org/company_page/marketman); [MarketMan blog: "Israeli technology concept founded to change the game"](https://www.marketman.com/blog/israeli-technology-concept-founded-to-change-the-game-for-restauranteurs) [V] |
| Founded | 2012 (IVC: Jun 2012, Ra'anana, 7 Hasadna St.) or 2013 (Tel Aviv); sources conflict | [3P] [IVC](https://www.ivc-online.com/Google-Card?id=7ece6f94-e7b6-e211-b59d-00155d32a40a); [Tracxn](https://tracxn.com/d/companies/marketman/__ZyvBQZ9_ObtpLi1C908HMingkZ9jZKu7oKXYWnj7kLk) |
| Early funding | NFX, Flashpoint (2015–2019) per Dealroom; totals conflict ($1.5M CB Insights vs "$18M+" elsewhere): **UNVERIFIED** | [3P] [Dealroom](https://app.dealroom.co/companies/marketman); [CB Insights](https://www.cbinsights.com/company/marketman) |
| US expansion | 2017 | [3P] [Restaurant Technology News, Jul 2017](https://restauranttechnologynews.com/2017/07/restaurant-inventory-management-solution-expands-u-s-market/) (pre-2024, context only) |
| Merger | Jan 12, 2022: Meal Ticket + MarketMan merge, **$100M+ PSG** growth investment; product lines continue | [3P] [BusinessWire](https://www.businesswire.com/news/home/20220112005313/en/Meal-Ticket-and-MarketMan-Announce-Merger-and-over-100-Million-Growth-Investment-from-PSG); Hebrew: [Bizportal](https://www.bizportal.co.il/BizTech/news/article/800007), [ice](https://www.ice.co.il/consumerism/news/article/841040) |
| Today | HQ New York (Meal Ticket, the merger partner, is Boise-based); MarketMan "powered by Meal Ticket"; customer invoices come from `@billing.mealticket.com` (a 2025 Trustpilot reviewer thought it was phishing) | [3P]/[U] [Trustpilot (ES mirror)](https://es.trustpilot.com/review/marketman.com) |
| Israeli footprint | Hebrew site [marketman.co.il](https://marketman.co.il/) and [Facebook "marketmanisrael"](https://www.facebook.com/marketmanisrael/): "1,200+ restaurants, cafés, bars"; Hashavshevet partner page: "2,000+ restaurants in Israel and abroad" | [V] |
| Hebrew | Capterra lists Hebrew among UI languages; Google Play title "MarketMan - מרקטמן למסעדות" | [3P] [Capterra IL](https://www.capterra.co.il/software/136439/marketman-restaurant-inventory); [Google Play](https://play.google.com/store/apps/details?id=com.app.marketman) |
| Israeli customers / chains named | **None found** in 2024–2026 sources. Israeli case studies: **UNVERIFIED** | — |
| Israeli R&D today | No source confirms an Israeli R&D centre after the merger: **UNVERIFIED** | — |

**Reading.** In Israel MarketMan is known and Hebrew-capable, but its product roadmap since 2022 follows the US (Square, QuickBooks, vendor payments via ACH, commissary kitchens). The Israeli page copy (seen only as a search extract) sells *stock and ordering*: "מעקב אחר עלות רכש, נתוני מלאי ודוחות", "ביצוע הזמנות אלקטרוניות מרוכזות", POS link with "עדכון מלאי אוטומטי עם כל פעולה בקופה", and "התראות על מלאי נמוך". No invoice-control promise appears in the extracts.

---

## 2. Module teardown

Legend: **Auto** = what the system does by itself; **Human** = what a person still does. Sources per row.

| Module | Auto | Human | Tier / notes | Sources |
|---|---|---|---|---|
| **Purchasing / ordering** | Par-based PO suggestion; supplier catalog ordering; orders sent electronically to suppliers (email) | Chef or manager reviews and **sends** the order | All tiers; PO approval workflow on higher tiers per ext-01 (vendor page) | ext-03 §1.5; [GetApp](https://www.getapp.com/all-software/a/marketman-restaurant-inventory/) [3P] |
| **AI Ordering** | Sales + inventory + vendor data → recommended quantities ("predictive analytics") | Manager confirms | **Enterprise-only, or paid add-on on Growth**; not on Starter. No launch date found | [MarketMan blog: AI demand forecasting](https://www.marketman.com/blog/ai-demand-forecasting-for-restaurants) [V]; [checkthat.ai pricing](https://checkthat.ai/brands/marketman/pricing) [3P, low] |
| **Order by Recipe** | Menu or prep plan → supplier order lines | Manager confirms | Add-on | [restauranttools.ai](https://restauranttools.ai/tools/marketman) [3P, low] |
| **Supplier catalog** | Prices updated from scanned invoices | Initial catalog build (item names, units, pack sizes) is manual onboarding work | Heavy setup (§6) | [MarketMan inventory page](https://MarketMan.com/platform/restaurant-inventory-management-software) [V] |
| **Inventory / counts** | Mobile counts; POS depletion; low-stock alerts | Staff counts shelves | Core | [marketman.co.il](https://marketman.co.il/) [V]; ext-05 (count time 1.5 h → 20 min) [V] |
| **Invoice scanning / AP** | Photo, scan, upload or email → OCR lines → match to PO → flag differences → price update; images stored with the reconciled invoice | Manager reviews flags and approves; scanning failures re-uploaded | **Starter: 50 AI scans/month; extra $50 per 50 scans; Growth: unlimited** | ext-01 (vendor AP page); [PricingSaaS 2026W34](https://pricingsaas.com/companies/marketman/diffs/2026W34) [3P]; [MarketMan AP automation](https://www.marketman.com/platform/marketman-accounts-payable-automation) [V] |
| **Approvals** | Invoices over a set value, or from certain suppliers, need sign-off; approvals timestamped | Manager/owner signs | Per ext-01 (vendor). Thresholds and roles not documented publicly | ext-01 |
| **Vendor payments ("Snap")** | Pay suppliers in-app via ACH, card or online banking (US rails) | Owner releases payment | US only; **no Israeli bank rail (Masav) found** | [MarketMan vendor payments](https://www.marketman.com/platform/restaurant-vendor-payments-and-management-solution) [V]; [Snap](https://MarketMan.com/platform/marketman-snap-expense-tracking) [V] |
| **Price alerts** | Item price goes up on an invoice → email/SMS alert; price history per item | Owner decides what to do | Alert only; **no ₪ impact per month, no claim** | [MarketMan vendor-payments page (price tracking section)](https://www.marketman.com/platform/restaurant-vendor-payments-seamlessly-pay-your-restaurant-vendor-bills-online) [V]; ext-01 |
| **Recipe & menu costing** | Recipe cost recomputed when invoice prices change; sub-recipes; low-margin items highlighted | Chef builds and maintains recipes | Core | [MarketMan recipe costing](https://www.marketman.com/platform/recipe-costing-software) [V] |
| **Waste** | Waste log feeds AvT | Staff records waste | Growth+ (sources conflict) | [Spendbase](https://www.spendbase.co/?p=37076) [3P] |
| **Analytics / AvT** | POS sales × recipes vs counts → variance by item; COGS reports | Investigating the variance | Core/Growth; users say reports are not customisable | ext-02, ext-05; [U] Capterra (below) |
| **Commissary / central kitchen** | Production and transfers | — | Add-on, $499–$749/month (Aug 2026) | [PricingSaaS 2026W34](https://pricingsaas.com/companies/marketman/diffs/2026W34) [3P] |
| **API** | Open API | — | Add-on: $25–$99/month by locations, $199/month for 31+ (Aug–Sep 2026) | [PricingSaaS 2026W36](https://pricingsaas.com/companies/marketman/diffs/2026W36) [3P] |
| **Mobile receiving** | Receive deliveries against a PO from the dock; barcode receiving mentioned once (UNVERIFIED) | Receiver ticks quantities | Mobile app exists (no app-store rating cited) | [Spendbase](https://www.spendbase.co/?p=37076) [3P]; [Google Play](https://play.google.com/store/apps/details?id=com.app.marketman) |
| **Square embed** | "Square Restaurant Inventory by MarketMan": AI ingredient and recipe management, automated POs, invoice scanning inside Square, one Square bill (Apr 2, 2026). Not offered in Israel (Square markets: US, CA, UK, IE, FR, ES, AU) | — | Distribution deal | [BusinessWire, 2 Apr 2026](https://www.businesswire.com/news/home/20260402238712/en/); [PYMNTS](https://www.pymnts.com/restaurant-technology/2026/square-and-marketman-debut-ai-powered-restaurant-inventory-tool/) |

**What is not there (searched, not found):** credit-request / דרישת זיכוי drafting; claim status tracking; "recovered ₪"; supplier statement (כרטסת) reconciliation; consolidated invoice ↔ delivery-note set matching; allocation-number check; VAT-at-risk; missing-documents report for the bookkeeper. Each is **UNVERIFIED-absent**, not proven absent; MarketMan's help centre could not be read.

---

## 3. What MarketMan does for each role

| Role (RestoMatch persona) | MarketMan gives them | ₪ exposure in MarketMan | RestoMatch rule for the same role |
|---|---|---|---|
| **Owner** (איתן) | COGS and AvT dashboards, price-rise alerts, approval of large invoices, vendor payments (US) | Full | Leak ₪ is the T1 hero number; every money action human-confirmed |
| **Chef** | Recipe costing, menu margins, par-based order suggestions, AI ordering (Enterprise), counts | **Full ₪ on recipes, orders and invoices** (UNVERIFIED whether role permissions can hide invoice ₪) | Chef sees ₪ **only on orders and recipes** |
| **Manager** | Places orders, receives, reviews scan flags, approves | Full | Manager decides discrepancies; one leak definition |
| **Receiver** (רמי) | Mobile receiving against the PO | **Sees PO prices in the receiving flow** (UNVERIFIED; no doc found on price hiding) | Receiver sees **no ₪** (pilot PR #219 closes residual exposure) |
| **Bookkeeper** (מיכל) | Export of invoices with supplier→contact and category→GL mapping to Xero/QuickBooks (manual push; Xero token valid 30 min per export); listed as a partner by Hashavshevet (no specific export confirmed; data scope UNVERIFIED) | Full | Bookkeeper gets missing-documents report, allocation-number guard, VAT at risk (AU-08, AU-18) |

The striking gap is the **receiver and the bookkeeper**. MarketMan's receiver flow is a PO tick-list, and its bookkeeper flow is an export. RestoMatch's ICP calls the receiver the daily user and the bookkeeper the distribution channel (int-00 / `docs/ICP.md`).

---

## 4. Integrations

| Category | Confirmed | Not found (UNVERIFIED) | Sources |
|---|---|---|---|
| Israeli POS | **Tabit** (MarketMan partner page; Tabit support lists MarketMan under accounting/inventory/reporting integrations). MarketMan says it charges no integration fee; the POS vendor may | **Beecomm, Caspit, Rest/others** | [MarketMan × Tabit](https://www.marketman.com/partner/tabit) [V]; [Tabit support](https://support-us.tabit.cloud/hc/en-us/articles/12570827573266-Overview-of-Tabit-s-Integrations) [V]; [Tabit integrations](https://www.tabit.cloud/integrations/) [V] |
| Israeli accounting | **Hashavshevet H-ERP** lists "Marketman מרקטמן ניהול מסעדות" on its partners page. What data flows (invoices, GL, suppliers) could not be read | **Priority, Rivhit, iCount, Morning, SUMIT** | [h-erp.co.il partner page](https://www.h-erp.co.il/marketman-%D7%9E%D7%A8%D7%A7%D7%98%D7%9E%D7%9F-%D7%A0%D7%99%D7%94%D7%95%D7%9C-%D7%9E%D7%A1%D7%A2%D7%93%D7%94-%D7%97%D7%A9%D7%91%D7%A9%D7%91%D7%AA-erp/) [V] |
| Global accounting | **Xero** (one-way invoice push, accounts and contacts pulled; tax mapped per supplier), **QuickBooks Online** (an outage tracker lists QBO export failures; 17 incidents in 2 years, all MarketMan) | Sage (listed by directories, unconfirmed) | [Xero App Store](https://apps.xero.com/us/app/marketman) [V]; [pingoru outage history](https://pingoru.io/providers/marketman/incidents/3802245) [3P] |
| Global POS | **Square** (deep, 2026), Toast, TouchBistro and "50+ mostly US POS" | — | ext-02; [Square press](https://squareup.com/us/en/press/square-restaurant-inventory-marketman) |
| Suppliers | US distributor networks (e.g. WebstaurantStore partnership) | Israeli supplier EDI or Zester link: **none found** | [jotup](https://jotup.co/node/2651556) [3P] |

**Implication for RestoMatch.** The adapter in `packages/procurement/src/adapters/marketman.ts` is the right integration posture: pull POs and the supplier catalog *from* MarketMan for a restaurant that already uses it, and do the leak work it does not do. Note int-06/int-07: `sync-platforms` is not scheduled and `listProducts` is never called (A13 in the int-07 list; the cron fix is human-PR because `apps/worker/src/cron.ts` is on the immutability list). Whether MarketMan's **Open API** (paid add-on) is reachable from Israeli accounts is **UNVERIFIED**. That is a Phase-6 credential question for a human.

---

## 5. Pricing

| Source (date) | Starter | Growth | Enterprise | Notes |
|---|---|---|---|---|
| ext-01 (vendor page via search, Nov 2026) | $249 | $299 | $449+ | Starter 50 AI scans, Growth unlimited |
| PricingSaaS 2026W34 (17 Aug 2026) | $199 → **$249** | $249 → **$299** | from $449 | Add-ons split: API $25–$99, commissary $499–$749 [3P] |
| PricingSaaS 2026W36 (≈31 Aug 2026) | $199 | $249 | — | Page reverted? API 31+ tier $199 [3P] |
| Enterprise DNA (checked 28 Sep 2026) | $249 | $299 | — | [3P, low] |
| Toolradar / Capterra (2026) | $199 | $249 | custom | Possibly stale [3P] |
| TrustRadius (older naming) | Operator $127 | Professional $169 | Ultimate $339 | Per location per month; legacy tiers [3P] |
| SaaSworthy | Professional $149/mo or $1,499/yr | Unlimited $299/mo or $2,999/yr | — | Per location [3P] |

- **Basis:** per location per month (most sources). Extra scans **$50 per 50** on capped tiers [U/3P, G2-adjacent summary].
- **Summary line to reuse:** Starter ~$199–249, Growth ~$249–299, Enterprise from $449 per location per month (third-party trackers, Aug–Sep 2026; prices changed during 2026).
- **Setup:** a one-time setup fee (one review says $500), often waived in promotions. MarketMan's own ads have offered "FREE setup" and a May 2026 promo of $0 setup + first month free [V/3P]. No other setup figure is used.
- **Israel:** **no public ₪ price**. Israeli pricing, VAT treatment and whether Israeli customers pay in USD: **UNVERIFIED**.
- **No ₪ conversion.** We found no sourced, dated exchange rate for this note, so MarketMan prices are quoted in **USD only**. If a ₪ figure is ever needed for a sale, take the Bank of Israel representative rate for a stated date and cite it. Whatever the currency, this is **purchasing-software** money, not leak money; never sum it with leak ₪.

Sources: [PricingSaaS company page](https://pricingsaas.com/companies/marketman); [2026W34](https://pricingsaas.com/companies/marketman/diffs/2026W34); [2026W36](https://pricingsaas.com/companies/marketman/diffs/2026W36); [Enterprise DNA](https://enterprisedna.co/omni/instead-of/marketman/pricing); [TrustRadius](https://www.trustradius.com/products/marketman/pricing); [SaaSworthy](https://www.saasworthy.com/product/marketman/pricing); [Capterra pricing](https://www.capterra.com/p/136439/Marketman-Restaurant-Inventory/pricing/); [MarketMan pricing](https://www.marketman.com/pricing) [V].

---

## 6. Onboarding and contract terms

- **Setup effort.** A Capterra reviewer: setup is "very tedious and takes a LOT of work" [U]. A low-authority aggregator estimates **6–12 weeks of heavy data entry** (catalog, units, recipes, pars) [3P, low]. A Trustpilot reviewer: training sessions took **about two weeks to schedule** [U]. No vendor-published onboarding timeline was found.
- **Why it is heavy.** Every useful MarketMan output (AvT, recipe cost, AI ordering) depends on a clean item master with unit conversions. Reviewers cite **unit conversion** trouble and sync issues [3P summary, Spendbase].
- **Contract.** Reviewers describe annual terms, a required **60-day notice**, refusal of refunds and **continued billing after cancellation** (one January 2026 review: three more months charged after cancelling; claims no record of the cancellation) [U, Trustpilot; supergood.ai API report card summarising the same pattern, 3P].
- **Lesson.** The ICP owner's prior pain with "systems" includes long setup and hard exits. RestoMatch's pilot promise (first leak figure from last month's invoices, no catalog build) is a direct counter-position. Contract and cancellation terms are an owner decision, not an agent one.

Sources: [Capterra reviews p.2](https://www.capterra.com/p/136439/Marketman-Restaurant-Inventory/reviews/?page=2); [Trustpilot](https://es.trustpilot.com/review/marketman.com); [supergood.ai](https://supergood.ai/api-report-card/marketman); [checkthat.ai reviews](https://checkthat.ai/brands/marketman/reviews).

---

## 7. Real user reviews

| Platform | Rating / count (seen 2026-11-07) | Recurring praise | Recurring complaints |
|---|---|---|---|
| **G2** | 4.3/5, 52 reviews | Inventory and ordering control | Scan accuracy; slow support; hard cancellation; glitches with Square and in the recipe builder leading to **wrong pricing data** |
| **Capterra (global; IL mirror)** | 4.7/5, 112 reviews; IL page shows 96% positive | "We don't have to manually input our invoices"; invoice scanning with line-item receiving "is huge"; invoice images stored with reconciled invoices; "very intuitive"; food-cost control | Cannot build custom reports; learning curve and setup time; "helped our business but disappointing in its failures" |
| **Trustpilot** (regional mirrors) | Small sample | Functionality is good | "Support is horrible"; complicated and buggy; billing after cancellation; training slow to schedule; March 2025 reviewer switched away and warns others |
| **Google Play** | No rating cited (trackers disagree) | Fine for quick counts with good connectivity | Invoices "constantly fail to upload" despite clean photos |
| **Reddit / Israeli Facebook groups / Tapuz** | **No MarketMan-specific threads found** in this round (UNVERIFIED) | — | — |

Paraphrased key quotes, with links:
- A G2 reviewer said invoice scanning **did not work half the time** and support took **days** to reply ([G2](https://g2.com/products/marketman/reviews)).
- Another G2 reviewer said Square and recipe-builder glitches produced **wrong pricing data** ([G2 page 3](https://g2.com/products/marketman/reviews?page=3)).
- A Capterra reviewer valued not typing invoices by hand and keeping the invoice images next to the reconciled invoice ([Capterra](https://www.capterra.com/p/136439/Marketman-Restaurant-Inventory/reviews/)).
- A Play Store reviewer said invoices keep failing to upload ([Google Play](https://play.google.com/store/apps/details?id=com.app.marketman)).
- A January 2026 Trustpilot reviewer was charged for months after cancelling ([Trustpilot](https://es.trustpilot.com/review/marketman.com)).

**Reading.** The scan-reliability complaint matters more to RestoMatch than to MarketMan. For MarketMan a failed scan means a stale price. For a leak product a failed scan means **leak not seen**. This confirms the ext-03 lesson: no scan caps, and a visible "invoices waiting for lines" list (pilot PRs #222, #216, #223).

---

## 8. Weakness map against RestoMatch's North Star

| Area | MarketMan (evidence) | RestoMatch position / plan item |
|---|---|---|
| **Leak ₪ detection** | Invoice vs PO "flag for review", price-rise alert. No aggregated **leak ₪** figure, no 12-type taxonomy, no severity in ₪ | Core engine (`packages/matching`, 12 types, one leak definition: Σ|deltaAmount|, MISSING_ON_INVOICE excluded per owner rule and PR #211) |
| **Short delivery at the door** | Receiving against a PO exists; whether the receiver can be hidden from prices is UNVERIFIED (§3); no "door evidence" chain found | Receiver flow without ₪; GR as the third leg (W2-05 / PR #189, #202; A3) |
| **Claims / credit requests** | **Not found** | Claim drafted at decision (W2-10 / #193–#197), letterhead (#213), overdue after **7 days** (AU-03, A12); nothing sent to suppliers automatically |
| **Recovery tracking** | Not found; "price alert" is the end of the line | Recovery desk: found / claimed / credited shown separately (AU-03; A12, A22, A24) |
| **Price creep in ₪** | Alert per item, no ₪/month impact | A18 / AU-13: price creep in ₪ per month, labelled avoided cost, **outside** the leak |
| **Consolidated invoice (חשבונית מרכזת)** | Not found; MarketMan's model is one invoice per PO/delivery | AU-09 / A14 propose the delivery-note set; PR #224/#232 recognise real consolidated invoices |
| **Allocation number / VAT** | Not found; tax only as a mapped account on Xero export | AU-08 / A13 allocation-number guard + VAT at risk (shown apart from leak, different colour) |
| **Bookkeeper missing-documents report** | Not found; export only | AU-18 / A23 |
| **Hebrew OCR on Israeli invoices** | Hebrew UI exists; **Hebrew OCR quality on Israeli supplier invoices: UNVERIFIED**; global complaints about scan failure | RestoMatch OCR is built on Israeli invoices; accuracy must be measured (AU-07, A2) rather than claimed |
| **Payments** | US ACH/card in-app | AU-14 pay-run pre-flight; AU-19 Masav file later; human releases every payment |
| **Pricing basis** | Per location, scan-capped tiers, add-ons | Subscription; avoid scan caps (ext-03 lesson) |

**Bottom line.** MarketMan answers "what *should* this cost me, and what did I use?" RestoMatch answers "what did the supplier **overcharge or short** me, in ₪, and did I get it back?" They overlap only at the invoice OCR and price-alert step.

---

## 9. Copy / avoid / leapfrog, mapped to the plan

**Copy (cheap, in scope)**
1. **Value threshold + per-supplier approval with a timestamped log.** Already the ext-01 lesson; it lands in W2-04 (approvals desk, #209) and the H-12/H-13 earned-autonomy rules (AU-16, A21). One owner tap, ₪-sorted.
2. **Invoice image kept next to the reconciled record.** Users praise this. RestoMatch's evidence chain (G-08 link provenance, #200) already does this; keep the photo one tap away from every claim line.
3. **Price history per item** as the base for A18, but expressed as **₪/month impact**, not a raw alert.

**Avoid**
1. **Scan caps per tier** (Starter 50/month). A capped plan means leak not seen.
2. **Long catalog and recipe setup before first value.** RestoMatch's first leak figure must come from invoices plus delivery notes only, with no item master required.
3. **Contract friction** (60-day notice, charges after cancel). Owner decision, but it is a positioning point.
4. **Gating "smart" features behind Enterprise.** If any ordering help ships (AU-11 order autopilot = *draft* from history), it stays in-plan and secondary.

**Leapfrog (where MarketMan stops)**
1. **found → claimed → sent → credited** with the 7-day overdue rule (AU-03).
2. **Consolidated invoice explained in ₪** (AU-09).
3. **Allocation-number guard + VAT at risk**, kept apart from the leak (AU-08).
4. **Bookkeeper ritual**: missing-documents report before the 15th (AU-18).
5. **Receiver without ₪**, under 3 minutes (ICP).

**Explicit ICP check.** MarketMan's strongest modules (pars, forecasts, AI ordering, counts, AvT, recipe-driven ordering, cross-supplier price compare) match the `docs/ICP.md` list: par/forecast = "later, anti-ICP border, veto if core"; recurring orders = "later"; cross-supplier compare (`product_group_id`) = "later, locked". **This teardown gives no reason to argue with that owner decision.** Competing there means competing with a $100M-backed incumbent on its home ground, with 6–12 weeks of setup that the ICP owner does not want. The one use of pars that stays in scope is ext-05's: **expected quantity from order history as fuel for the GR check**, never as a forecasting feature.

**Integrate, don't fight.** A MarketMan restaurant is a **warm** ICP lead (ICP §1/§4): its POs already exist. RestoMatch reads them (procurement adapter) and sells the leak layer on top. Positioning line for GTM (for `growth-pmm-engineer`, not decided here): "MarketMan tells you what the dish should cost. RestoMatch tells you what the supplier owes you back."

---

## 10. Open questions (for a human; not resolvable from this sandbox)

1. **Israeli price list in ₪**, and whether Israeli customers get the Starter scan cap. Ask a MarketMan IL rep or a pilot owner who uses it.
2. **What the Hashavshevet H-ERP integration actually transfers** (invoices with lines? allocation number? supplier tax ID?). Needs `h-erp.co.il` allowed in network settings, or a bookkeeper interview.
3. **Hebrew OCR accuracy on Israeli supplier invoices**, including consolidated invoices and delivery notes. Only testable with real documents; candidate for a pilot side-by-side.
4. **Whether MarketMan has any credit-request or credit-memo flow.** One low-authority directory says yes; no vendor page found. Needs `marketman.com` help centre access.
5. **Role permissions:** can a MarketMan receiver or chef be hidden from invoice ₪?
6. **Open API availability and price for Israeli accounts**, and whether it exposes POs and catalog. Needed for the `sync-platforms` work (Phase-6 credentials, human-only).
7. **Israeli customer names / chains** using MarketMan today (field interviews; Israeli Facebook groups such as בעלי מסעדות were not searchable here).

Network note: `marketman.com`, `marketman.co.il`, `h-erp.co.il` and `pricingsaas.com` must be allowed in the session's network settings before a follow-up can read them directly.

---

## Sources (all seen 2026-11-07)

**Vendor (MarketMan / partners)**
- https://www.marketman.com/ ; https://www.marketman.com/platform ; https://www.marketman.com/pricing ; https://www.marketman.com/pricing-for-restaurant-inventory-management-system
- https://www.marketman.com/platform/marketman-accounts-payable-automation
- https://www.marketman.com/platform/restaurant-vendor-payments-and-management-solution ; https://www.marketman.com/platform/restaurant-vendor-payments-seamlessly-pay-your-restaurant-vendor-bills-online ; https://marketman.com/blog/marketman-launches-vendor-payments-solution-for-restaurants
- https://MarketMan.com/platform/marketman-snap-expense-tracking
- https://MarketMan.com/platform/restaurant-inventory-management-software ; https://www.marketman.com/platform/recipe-costing-software
- https://www.marketman.com/blog/ai-demand-forecasting-for-restaurants ; https://www.marketman.com/blog/restaurant-forecasting-how-to-predict-demand
- https://www.marketman.com/blog/israeli-technology-concept-founded-to-change-the-game-for-restauranteurs
- https://www.marketman.com/partner/tabit ; https://www.marketman.com/partners
- https://marketman.co.il/ ; https://www.facebook.com/marketmanisrael/
- https://www.h-erp.co.il/marketman-%D7%9E%D7%A8%D7%A7%D7%98%D7%9E%D7%9F-%D7%A0%D7%99%D7%94%D7%95%D7%9C-%D7%9E%D7%A1%D7%A2%D7%93%D7%94-%D7%97%D7%A9%D7%91%D7%A9%D7%91%D7%AA-erp/
- https://support-us.tabit.cloud/hc/en-us/articles/12570827573266-Overview-of-Tabit-s-Integrations ; https://www.tabit.cloud/integrations/
- https://apps.xero.com/us/app/marketman
- https://squareup.com/us/en/press/square-restaurant-inventory-marketman ; https://www.businesswire.com/news/home/20260402238712/en/

**Press / company data**
- https://www.businesswire.com/news/home/20220112005313/en/Meal-Ticket-and-MarketMan-Announce-Merger-and-over-100-Million-Growth-Investment-from-PSG
- https://www.bizportal.co.il/BizTech/news/article/800007 ; https://www.ice.co.il/consumerism/news/article/841040 ; https://www.globes.co.il/news/article.aspx?did=1000994135
- https://www.pymnts.com/restaurant-technology/2026/square-and-marketman-debut-ai-powered-restaurant-inventory-tool/ ; https://restauranttechnologynews.com/2026/04/square-launches-advanced-inventory-management-integration-for-restaurants/
- https://finder.startupnationcentral.org/company_page/marketman ; https://www.ivc-online.com/Google-Card?id=7ece6f94-e7b6-e211-b59d-00155d32a40a ; https://tracxn.com/d/companies/marketman/__ZyvBQZ9_ObtpLi1C908HMingkZ9jZKu7oKXYWnj7kLk ; https://app.dealroom.co/companies/marketman ; https://www.cbinsights.com/company/marketman
- https://jotup.co/node/2651556

**Pricing trackers / directories**
- https://pricingsaas.com/companies/marketman ; https://pricingsaas.com/companies/marketman/diffs/2026W34 ; https://pricingsaas.com/companies/marketman/diffs/2026W36
- https://enterprisedna.co/omni/instead-of/marketman/pricing ; https://toolradar.com/tools/marketman/pricing ; https://www.capterra.com/p/136439/Marketman-Restaurant-Inventory/pricing/ ; https://www.trustradius.com/products/marketman/pricing ; https://www.saasworthy.com/product/marketman/pricing ; https://www.spendbase.co/?p=37076 ; https://checkthat.ai/brands/marketman/pricing ; https://restauranttools.ai/tools/marketman ; https://www.getapp.com/all-software/a/marketman-restaurant-inventory/

**User reviews**
- https://g2.com/products/marketman/reviews ; https://g2.com/products/marketman/reviews?page=3
- https://www.capterra.com/p/136439/Marketman-Restaurant-Inventory/reviews/ ; https://www.capterra.com/p/136439/Marketman-Restaurant-Inventory/reviews/?page=2 ; https://www.capterra.co.il/software/136439/marketman-restaurant-inventory
- https://es.trustpilot.com/review/marketman.com
- https://play.google.com/store/apps/details?id=com.app.marketman
- https://supergood.ai/api-report-card/marketman ; https://checkthat.ai/brands/marketman/reviews ; https://pingoru.io/providers/marketman/incidents/3802245

**Internal (built on, not repeated)**
- `notes/ext-01-israel-players.md` §MarketMan; `notes/ext-03-global-restaurant-ap.md` §1.5; `notes/ext-02-israel-infra-regulation.md` (AvT row); `notes/ext-05-ops-automation-benchmarks.md` (case-study hours); `notes/int-06-catalog-inventory-recipes.md` and `notes/int-07-platform-ai-notify-roles.md` (sync-platforms gap); `notes/10-catalogue-and-impact.md` (A-items); `docs/ux/automation/README.md` (AU-items); `docs/ICP.md` lines 119–124 (scope veto).
