# ext-07 — Competitor teardown: Zestt (formerly Zester / זסטר)

> **Scope.** One competitor, end to end: what Zestt does for each role, how its supplier network works, what it charges, who uses it, and where it is weak on the four things RestoMatch sells (leak ₪, claims and recovery, allocation numbers, approvals). This note **builds on** ext-01 §4 (Zestt flows already found there: consolidated invoice, Plants Council link, ZesttScan, supplier API, leak narrative). It does not repeat them in full; it adds company facts, the supplier side, reports, integrations, pricing, customers, reviews and a per-role view.
>
> **Method caveat (same as ext-01).** WebFetch to `www.zestt.io` failed DNS resolution in this sandbox (host not in the session's allowed network domains). Every finding below comes from **search-engine extracts** of the cited pages, not a full read. To re-read the pages in full, `www.zestt.io`, `support.zester.co.il`, `zestt.stonly.com` and `rest.zester.co.il` have to be allowed in the session's network settings. "Date seen" for every source is **2026-11-07**.
>
> **Labels.** **[vendor]** = the company's claim about itself. **[press]** = Israeli trade or business press, usually based on a company announcement. **[store]** = app-store listing. **UNVERIFIED** = I could not source it. No personal ID numbers appear in this note.

---

## 0. Bottom line (for the person who reads only this)

1. **Zestt is a procurement and ordering network, not an AP or leak product.** Its centre of gravity is the order: restaurant ↔ supplier ordering, digital delivery notes sent by the supplier, receiving against the order, inventory counts, product trees (recipes) and P&L-style reports. Invoices appear as a downstream step (consolidated invoice intake), and it is a manual one (ext-01 §4).
2. **Its moat is the two-sided supplier network**, not its analytics. It claims **2,000 vendors and 15,000 restaurants** on its homepage [vendor]. A March 2023 press item said **about 2,000 restaurants in Israel plus about 100 in New York and Berlin** [press]. The two figures differ by about 7×, and the larger one has no third-party support. Treat "15,000" as marketing.
3. **It never states a leak ₪ figure.** Its money headline is "an average **6% drop in procurement spend per month**" [vendor/store]. That is a spend-reduction claim with no stated method (price comparison, waste, or theft?) and no "₪ caught, ₪ recovered" split. RestoMatch's single leak definition (Σ|deltaAmount|, MISSING_ON_INVOICE excluded) has no counterpart.
4. **"Automatic credits" is the one marketing line that sounds like our product.** The copy says "compare prices, track supplier price changes and **automatically create credits** so you don't miss anything" [vendor]. The help centre lists "credit requests" next to goods receiving. I found **no** flow for credit follow-up, ageing, overdue status, or reconciling against the supplier ledger (UNVERIFIED either way). This is the gap to attack (§6).
5. **No approval routing, no allocation-number check, no VAT-at-risk** were found anywhere in the public material (UNVERIFIED either way; absence of evidence, not proof). Users are added from the desktop only, by email; I found no role or threshold rules.
6. **Strategy: integrate, don't fight, and stay off its turf.** Ordering, par levels, inventory and recipes-as-core are Zestt's (and MarketMan's) home ground, and `docs/ICP.md` marks them **later / near anti-ICP**. RestoMatch should read Zestt's structured orders and delivery notes as **input** and sell what Zestt doesn't: the leak ₪, the claim to recovery loop, consolidated-invoice auto-matching, and VAT/allocation protection.

---

## 1. Company facts

| Item | Finding | Label / source |
|---|---|---|
| Names | **Zester / זסטר** (old brand, `zester.co.il`, help centre on `support.zester.co.il`) → **Zestt / זסט** (current, `zestt.io`). App: "Zestt – עושים טוב למסעדות" / "Zestt – Better Restaurants" | [store] App Store; Facebook page @zester.il |
| Legal / developer | App published by **Weirdoz LTD**. Older Android app "Zester" published under a different developer id (`com.emalogic.zester`) | [store] |
| Founded | **2020** (PC.co.il, via search extract) or **January 2021** (Startupim profile). Conflicting by a few months; treat as 2020–21 | [press]; startupim |
| Founder / CEO | Kobi Sela, named as CEO in 2023 press and co-founder on the About page. The About page says the founding team comes from restaurant management, consulting and openings | [press] Funder; [vendor] About |
| Size | **11–50 employees** (Startupim); a January 2023 hiring drive in Be'er Sheva | startupim |
| Funding | **None disclosed.** Startup Nation Central: total funding undisclosed, no rounds or investors (profile last updated 2024). Startupim: "has not raised outside funding" / "pre-funding" | SNC Finder; startupim |
| Scale claims | Homepage: "the leading procurement & inventory system in Israel", **2,000 vendors, 15,000 restaurants** [vendor]. Funder (15 Mar 2023): **~2,000 restaurants in Israel + ~100 in NY/Berlin** [press] | conflict, see §0.2 |
| Support | support@zestt.io, phone on the contact page; help centre in Hebrew, built on Stonly (`zestt.stonly.com` mirror) | [vendor] |

**Reading.** Zestt is a bootstrapped, small Israeli company of 11–50 people with a real installed base, at least in the low thousands of restaurants. Its growth engine is the supplier network: a supplier that works with Zestt brings its restaurant customers. That is a distribution advantage RestoMatch lacks, and the reason to integrate rather than displace (§7).

---

## 2. Module-by-module teardown

### 2.1 Supplier network and ordering (the core)

- **Restaurant side** [vendor/store]: fixed order lists ("רשימות הזמנה קבועות"), saved drafts, orders sent to every supplier from one app. Ext-01 adds **orders sent automatically on set dates** and automatic reminders. A new order can go to a supplier only after the supplier record is complete, including an order contact (help centre, "ביצוע הזמנה חדשה").
- **Supplier management screen** (desktop and app): add or remove suppliers, **update price lists**, update supplier contacts, **add your customer number** at that supplier, supplier settings (help centre "ניהול ספקים").
- **Supplier side ("Zestt for Vendors")** [vendor]: a **real-time digital catalogue** that updates with stock status; **delivery notes sent automatically and digitally**; automatic price lists; customer management; reports; "**interfacing with all ERP & CRM systems**"; "**add buyers with a click**"; "send orders with a quick click, get automatic reminders and sync with all your restaurant customers."
- **How suppliers join and connect** (ext-01 + `rest.zester.co.il`): a supplier-side REST API with a bearer token; credentials requested by email; a test environment on a separate test-api host. The supplier polls `GET api/v1/supplierApi/orders` "on a frequent basis" and filters with `ordersByCriteria` (fromDate, toDate, status). **Status 17 = moved to the supplier's ERP.** Delivery documents run from status 0 (draft) to 6 (pending approval). The supplier can **create a delivery certificate or an invoice in Zester**. The docs say the API "differs for every account" as versions are tailored. Some pages also cover POS Z-totals and items, the buyer's supplier list and a **payments report**.
- **Order channels.** The app, desktop web and the supplier API. Whether a supplier without the API receives orders by email, SMS or WhatsApp is **UNVERIFIED**. The help centre requires an "order contact" on the supplier record, which suggests a message channel for non-integrated suppliers.
- **Who pays on the supplier side:** **UNVERIFIED.** No vendor-side price, free tier or fee was found. An old Aptoide listing of a "Zester" app says "no extra costs", but it appears to be an older or different product, so I did not rely on it.

### 2.2 Purchasing: price lists, price comparison, Plants Council

- "Compare product prices, keep up to date on supplier pricing and **create credits automatically** so you don't miss anything" (zestt.io). The older zester.co.il copy says "compare shopping baskets, follow supplier price changes, **redeem your credits automatically**" [vendor].
- **Plants Council (מועצת הצמחים) link:** a supplier's produce items can be connected to the Plants Council price list for **automatic price updates** (help guide "חיבור מוצרים למחירון של מועצת הצמחים"; ext-01 §4). This is a price-*update* mechanism, not a "you paid above market" alert. No such alert was found.
- **Cross-supplier basket comparison** is part of Zestt's pitch. For RestoMatch this is **locked "later"** (`docs/ICP.md`, `product_group_id`: network value, not a single-restaurant pilot). Zestt owning it is consistent with that decision.

### 2.3 Delivery notes and receiving (incl. ZesttScan, 2026)

- **Digital delivery notes** arrive from integrated suppliers before the truck, so the restaurant "learns about missing products in advance" (ext-01). Receiving is done against the order on the orders page ("קליטת סחורה"), and the system "**verifies data at goods receiving**" (zester.co.il copy, via search) [vendor].
- **ZesttScan** (blog, about Feb 2026) [vendor]: on the orders page, tap "receive goods" and scan; "all the data is entered automatically and accurately", with **no manual typing of quantities, prices and dates**; about **30 hours a month saved** on average and fewer order-vs-receipt gaps. The search extracts conflict on *what* is scanned. One says the supplier's document (invoice or delivery note) on a phone or tablet; ext-01 could not tell document from product barcode. **UNVERIFIED.** Accuracy, pricing and plan tier: not found.
- **Receiver sees prices.** If ZesttScan fills in "quantities, prices and dates" at the door, the receiver's screen carries ₪. That conflicts with RestoMatch's owner rule (**receiver sees no ₪**). It is a deliberate design difference worth stating in sales: our receiver checks quantity and condition, and the money is judged elsewhere. Whether Zestt can hide prices per role is **UNVERIFIED**.
- **Zestt's own leak story** (blog "למה חשוב לקלוט סחורה?"): even the most accurate supplier makes mistakes (missing, substituted, wrong quantity), and "if missing items aren't marked, documented and tracked, that money simply disappears" (ext-01). Zestt names the leak but does not price it.

### 2.4 Invoices and consolidated invoices

- Covered in ext-01 §4: "Delivery notes & invoices" tab → new document → consolidated invoice intake → filter by supplier and dates → add notes one by one or "add all" → **type in the total of the original tax invoice** → investigate any difference by hand (document-level discount? a gap on one note?) → issue. Attaching a photo of the original is recommended. An attached delivery note **becomes read-only**.
- The help centre index groups "**issuing certificates, invoices and consolidations**" under orders and receiving. Invoices are framed as a **document Zestt helps produce or record**, not as something it audits line by line against agreed prices.
- **No supplier-invoice OCR product** beyond ZesttScan was found (search for "Zestt invoice scanning AI" returned only the ZesttScan post).

### 2.5 Inventory

- Digital stock counts in the app, warehouses, stock updates, **year-end counts** and goods in/out tracking. "**Zestt Master**" is a help-centre section covering counts, warehouses and **product trees** (`zestt.stonly.com/kb/he/zestt-master-445144`) [vendor/store].
- With POS sync: "live stock update" and **revenue vs raw-material consumption** [vendor/store].

### 2.6 Recipes / food cost

- **Product tree (עץ מוצר)** builder: add every ingredient with an exact quantity; the top row shows the **calculated dish cost live**, so you can tune toward a target margin (help guide "בניית עץ מוצר") [vendor].
- Blog content on **food-cost variance**: (actual price × actual quantity) − (expected price × expected quantity), with expected costs drawn from Excel, the POS "or a restaurant management system such as Zestt" [vendor blog]. A named "theoretical consumption" report was **not found** (UNVERIFIED).

### 2.7 Reports

- Store listing: **budget management, profit & loss, debts (חובות) and monthly expenses**; "online reports available any time" [store/vendor]. The "6% average drop in monthly procurement spend" headline is attributed to "its reports" [vendor/store].
- **Payments report** on the API side (buyer-oriented) [vendor docs]. A **debts** report suggests a supplier balance view. Whether it reconciles to the supplier's כרטסת is **UNVERIFIED**.

### 2.8 Integrations

| Integration | Evidence | Label |
|---|---|---|
| **POS** | Help guide "סנכרון של הקופות עם מערכת זסטר": connect a POS to see profitability, income and expenses in one place; live P&L and stock; "easily connects to any existing POS". **Beecomm** names Zestt (with Restigo and MarketMan) as a partner on its site. Ext-01: Zestt lists **Tabit** and **Beecomm** as POS partners | [vendor]; Beecomm site |
| **Accounting** | A Hashavshevet H-ERP partner page titled "zester זסטר ניהול מסעדות – שותפים" exists (search title). Its content (export format, journal entries) was **not retrieved**. The specific export (e.g. MOVEIN/heshin) is **UNVERIFIED** | partner listing |
| **Payments** | PayMe ↔ Zester cooperation: restaurants **pay suppliers automatically** through PayMe, with shorter supplier credit periods (Funder article 148041; ice.co.il). The date is not shown in the extract; current availability is **UNVERIFIED** | [press] |
| **Supplier ERP** | Supplier REST API (§2.1); "interfacing with all ERP & CRM systems" | [vendor] |
| **Restaurant-side export API** | **Not found.** The public API is supplier-side. Our `ZesttAdapter` is a document-only stub (int-06) | — |

### 2.9 Pricing (restaurant side, supplier side, who pays)

- **No public price list** for restaurants or suppliers. The contact page offers a demo call [vendor].
- A "**From ₪45,000**" figure appears on the restaurants page inside a **sample dashboard**. It is almost certainly demo data (a spend number), **not a price**. Do not quote it as one.
- The app downloads are free (store metadata).
- **Who pays (restaurant vs supplier vs both): UNVERIFIED.** The two-sided pitch ("suppliers enjoy more", "add buyers with a click") is consistent with suppliers subsidising adoption, but no source says so. **Action:** one mystery-shop demo call (human, not an agent) to fill this in, and to ask whether ZesttScan is a paid add-on.

### 2.10 Customers named

| Customer | What is said | Label |
|---|---|---|
| **Japanika (ג'פניקה)**, ~45 branches | Joined Zester in March 2023 (inventory planning, price-change updates, restaurant ↔ supplier mediation) | [press] Funder 15.3.2023; ice.co.il |
| **Food Terminal** (restaurant group) | Case study: "full control of the group's procurement management" | [vendor] restaurants page |
| **Burger Saloon** (burger chain) | Case study: "a standard of quality between all branches"; a named person from the chain appears on the page, quote not retrieved | [vendor] |
| Logo wall | Other brands shown; names not extracted | [vendor] |
| Job ads | A Petah Tikva restaurant group seeks a part-time purchasing clerk to **update prices in Zester**. A branch-manager ad lists "MarketMan / Zester experience" as an advantage | AllJobs; HRSearch |

**Reading.** The named logos are **chains and groups with central purchasing** (Japanika 45 branches; job ads for a *purchasing clerk*). That is RestoMatch's **secondary ICP or anti-ICP** (a procurement department = anti-ICP hard gate, `docs/ICP.md` §4.1). The 15,000 claim implies a long tail of independents too, but no independent customer is named.

### 2.11 Onboarding

- Users are created **only from a computer**: Profile → Users → New User, with the email as the login name. The mobile app also supports login by **phone code** (help centre; App Store) [vendor/store].
- A help-centre video introduces the **new app** (2024–25), covering goods receiving, credit requests, updating products and price lists (ext-01).
- Supplier setup (contact, customer number, price list) comes before the first order. With an integrated supplier, the catalogue and price list arrive from the supplier.
- Time-to-value claims: not found.

### 2.12 Reviews and complaints

- **App Store:** **5.0 from 7 ratings** (Israel listing), too small to mean anything [store].
- **Google Play** (`com.weirdoz.zestt`, older `com.emalogic.zester`): ratings and reviews **not retrievable** through search.
- **G2 / Capterra / GetApp:** no Zestt listing found.
- **Reddit (r/restaurateur, r/KitchenConfidential), Tapuz, Israeli owner Facebook groups (e.g. "בעלי מסעדות"):** **no discussion of Zestt surfaced** in search. Closed Facebook groups are not indexed. **UNVERIFIED**; needs a human to search inside the groups.
- **ice.co.il Japanika item:** reader comments criticise *Japanika's* food and prices, not Zester. Not usable as product feedback.
- **Conclusion:** there is **no independent user sentiment** on Zestt in public sources. Every claim in §2 is vendor-side. This is itself a finding: the 10–15 field interviews planned in the report (`report.md` strategic questions) should include "do you use Zestt, and what does it *not* do for you?"

---

## 3. Per-role view

| Role | What Zestt gives them | What it does not give them (vs RestoMatch) |
|---|---|---|
| **Owner (איתן)** | Ordering across suppliers; budget, P&L, debts and monthly-expense reports; the "6% less spend" story; POS-linked revenue vs raw-material use | **No leak ₪ hero number.** No "caught / claimed / recovered" split. No approval desk before payment. No VAT-at-risk or allocation-number warning. No "what to pay this week and what to hold" (PayMe pays; it does not judge) |
| **Chef** | Product trees with live dish cost; fixed order lists; price updates (Plants Council) | Fine for Zestt's purposes. RestoMatch rule: **chef sees ₪ only on orders and recipes.** Zestt's chef sees costing, which is consistent; it is not a differentiator for us |
| **Manager** | Orders, drafts, reminders, receiving, stock counts, credit requests in the app | No **exception queue** ranked by ₪. No claim ageing. No supplier-reply tracking |
| **Receiver (רמי)** | Receive against the order; **ZesttScan** auto-fills "quantities, prices, dates" | **Sees prices** (by the ZesttScan description). RestoMatch: **receiver sees no ₪**, target <3 min, quantity and condition only. Photo evidence and signed-GR fallback: not found in Zestt |
| **Bookkeeper (מיכל)** | Consolidated-invoice intake; delivery notes locked once attached; possible Hashavshevet link (partner page) | **Manual line-up**: types the original invoice total and investigates the difference by hand. No auto-proposed delivery-note set and no explained ₪ residual. No allocation-number check. No duplicate-billing hold |

---

## 4. Where Zestt is weak on RestoMatch's four axes

### 4.1 Leak ₪ quantification — **weak / absent**
- The only money metric is "**6% average monthly procurement spend reduction**" [vendor], with no method, no baseline and no split between price, quantity, waste and theft. It mixes *savings from choosing a cheaper supplier* (price comparison) with *money lost to errors*. RestoMatch's rule is **one leak definition**, and hours-₪ and money-₪ are **never summed**. Zestt's "30 h/month" (ZesttScan) and "6%" sit side by side in the same marketing with no units discipline.
- Zestt names the leak (missing, substituted, overcharged goods) in its blog but **never totals it in ₪** for the owner. Our T1 hero number has no Zestt equivalent.

### 4.2 Claims and recovery tracking — **partial at best**
- "Credit requests" (בקשות לזיכוי) exist in the app, and marketing says credits are "created / redeemed automatically" [vendor]. **No evidence of:** a credit ledger with status (drafted → sent → acknowledged → credited), ageing or overdue rules, matching an arriving credit note to the request, or posting into the supplier's כרטסת. All **UNVERIFIED**.
- "Automatic credits" probably means a credit *request* generated from a receiving shortage or a price deviation. Whether it is **sent to the supplier automatically** is unknown. RestoMatch's rule (**nothing sent to suppliers automatically; every money action human-confirmed**) is a trust differentiator for owners who fear damaging supplier relationships. Phrase it as "you decide what goes out; we make sure nothing is forgotten" (claim overdue after **7 days**, AU-03).
- **MISSING_ON_INVOICE**: Zestt's receiving flags shortages, but no source shows it separating "missing and not billed" (no money lost) from "missing and billed" (leak). RestoMatch keeps MISSING_ON_INVOICE **out of the leak and not claimable**, which is the honest number.

### 4.3 Allocation numbers (מספר הקצאה) and VAT — **absent**
- No mention of allocation numbers, the invoice-reform thresholds or input-VAT risk in any Zestt source found (UNVERIFIED either way). A procurement tool whose invoice module is "type in the total" is unlikely to check the allocation field per invoice. **AU-08 (vat-at-risk)** is uncontested here, and its ₪ stays outside the leak hero per the money rules.

### 4.4 Approvals routing — **not found**
- User creation is email-plus-desktop; **no roles, thresholds or per-supplier sign-off** were found. MarketMan has ₪-threshold and per-supplier approvals with a timestamped log (ext-01). PayMe auto-pays suppliers through Zester, so **payment can happen without an invoice-vs-receiving check gating it**. That is exactly where RestoMatch's approval engine (blocks before payment) and pay-run pre-flight (AU-14) sit.

### 4.5 Other weaknesses observed
- **Consolidated invoices**: manual, and the residual is investigated by hand (ext-01). **AU-09 / A14** auto-proposes the set and explains the residual in ₪.
- **Supplier-API-first data**: the richest data exists only where the supplier integrates. For a non-integrated supplier (small produce or fish vendors, typical for our ICP) Zestt falls back to manual entry or ZesttScan.
- **No independent reviews** and **no published pricing**: buyers can't self-qualify. A transparent RestoMatch price and a free leak check on last month are both contrasts.

---

## 5. What Zestt does better (be honest)

1. **Supplier network effects.** Suppliers push catalogues, prices and digital delivery notes. RestoMatch has to OCR the paper.
2. **Ordering ergonomics.** Fixed lists, drafts, scheduled sends and reminders. A daily habit that keeps the app open.
3. **Breadth for chains.** Stock counts, warehouses, product trees and POS-linked P&L in one product.
4. **The "attached note is locked" invariant**, already adopted as a lesson in ext-01.
5. **Plants Council price feed**, a public produce benchmark we can reuse as a T4 "X% above market" signal (catalogue §A-row on produce benchmark).

---

## 6. Gaps we exploit (ranked by ₪ impact for the ICP)

| # | Gap in Zestt | RestoMatch answer | Plan item | Money rule check |
|---|---|---|---|---|
| 1 | No ₪ leak figure; only "6% less spend" | T1 hero: leak ₪ per month, one definition, drill to the line | W2-09 leak drill; AU-07 (measure first) | One leak definition; MISSING_ON_INVOICE excluded (#211) |
| 2 | Credits "automatic", but no visible follow-through | Claim drafted at the decision → owner taps send → **overdue at 7 days** → matched to the credit note | W2-10 / AU-03 / AU-17 | Human-confirmed; nothing auto-sent |
| 3 | Consolidated invoice is manual line-up | Auto-proposed delivery-note set + ₪ residual explained | AU-09 (A14) | Residual "billed twice" kept outside the leak hero |
| 4 | No approvals or pay-run gate; PayMe can auto-pay | Approvals desk + pay-run pre-flight ("hold ₪X: open discrepancy") | W2-04, W2-03, AU-14 | Every money action human-confirmed |
| 5 | No allocation-number or VAT-at-risk check | Allocation field per invoice + VAT-at-risk card | AU-08, AU-18 | VAT ₪ shown separately, never summed into the leak |
| 6 | Receiver sees prices (by the ZesttScan description) | Receiver: quantity and condition only, no ₪, <3 min | W2-05, #219 | Receiver sees no ₪ |
| 7 | Plants Council used only to *update* prices | "Paid X% above market today" on produce lines, as T4 info | AU-13 (+ catalogue produce-benchmark row) | Information only, not added to the leak unless above the agreed price |
| 8 | No independent reviews; no public price | Transparent price + free leak check on last month | GTM | Vendor claims labelled |

---

## 7. Integrate, don't fight — and the anti-ICP line

- **Do not build** ordering networks, par levels, forecasts, inventory-as-core or cross-supplier basket comparison to compete with Zestt. `docs/ICP.md` marks recurring orders, par/forecast and `product_group_id` as **later / near anti-ICP**. This teardown **supports** the owner's decision: Zestt (and MarketMan) already own that turf, and they compete on network size we cannot match.
- **One respectful challenge to the decision** (for the owner, not a change): AU-11 (prepared order drafts and cut-off reminders) brushes against Zestt's core. It is justified only as **feeding the receiving check** (expected quantities), not as an ordering product. Keep its copy and placement subordinate to receiving, or it reads as "a weaker Zestt".
- **Integrate:** the realistic routes are (a) the restaurant forwards Zestt documents (orders, delivery notes, consolidated invoices) by email or upload into the existing ingest path. The `ZesttAdapter` is document-only today (int-06), so this works now. (b) Ask Zestt for a **restaurant-side export or API** (not public; supplier API only). Credentials are Phase-6, human-only. (c) Restaurants whose suppliers are on Zestt get digital delivery notes. If those notes reach RestoMatch, receiving and matching get cleaner data with no OCR.
- **Positioning line (draft, Hebrew-first copy belongs to growth-pmm-engineer):** "Zestt helps you *order*. RestoMatch tells you how many ₪ you lost after the order, and gets them back." Use it only after the field interviews confirm Zestt users feel the gap.
- **Sales qualifier:** a prospect on Zestt is a **warm input** (`docs/ICP.md`: MarketMan/Zester connected = warm). It means structured habits exist. If the prospect is a chain with a purchasing clerk, apply the anti-ICP gate.

---

## 8. Open questions (human follow-up)

1. **Pricing and who pays** (restaurant / supplier / both); is ZesttScan a paid add-on? → one demo call by a human.
2. **What ZesttScan scans** (paper delivery note, invoice, or barcodes) and its accuracy.
3. **The credit flow**: is a credit request sent to the supplier automatically? Is there status or ageing? Is the credit note matched?
4. **Accounting export**: the Hashavshevet partner page content; which file format.
5. **Restaurant-side API or export** availability.
6. **Role permissions**: can prices be hidden from receivers? Are there approval thresholds?
7. **Real user sentiment**: search inside Israeli owner Facebook groups; add a Zestt question to the 10–15 field interviews.
8. **The 15,000 vs ~2,000 restaurants** discrepancy.

---

## Sources (all seen 2026-11-07, via search-engine extracts; direct fetch blocked)

- Zestt home — https://www.zestt.io/en (2,000 vendors / 15,000 restaurants; vendor perks) [vendor]
- Zestt restaurants page — https://www.zestt.io/en/restaurants ; mirror https://zester.power.casa/en/restaurants/ (Food Terminal, Burger Saloon; "From ₪45,000" in a sample dashboard) [vendor]
- Zestt suppliers — https://www.zestt.io/en/suppliers ; https://zester.power.casa/en/zestt-for-vendors/ [vendor]
- Zestt About — https://www.zestt.io/en/about [vendor]
- Zestt contact — https://www.zestt.io/contact [vendor]
- Zestt blog index — https://www.zestt.io/en/blog
- ZesttScan blog — https://www.zestt.io/blog/%D7%97%D7%96%D7%A8%D7%94-zesttscan-%E2%80%93-%D7%94%D7%A4%D7%99%D7%A6%E2%80%99%D7%A8-%D7%94%D7%97%D7%93%D7%A9-%D7%A9%D7%97%D7%95%D7%A1%D7%9A-%D7%9C%D7%9B%D7%9D-%D7%96%D7%9E%D7%9F-%D7%9B%D7%A1%D7%A3-%D7%95%D7%9B%D7%90%D7%91-%D7%A8%D7%90%D7%A9 [vendor]
- Why receive goods (blog) — https://www.zestt.io/blog/%D7%9C%D7%9E%D7%94-%D7%97%D7%A9%D7%95%D7%91-%D7%9C%D7%A7%D7%9C%D7%95%D7%98-%D7%A1%D7%97%D7%95%D7%A8%D7%94 [vendor]
- Food-cost variance (blog) — https://www.zestt.io/en/blog/%D7%9E%D7%94-%D7%96%D7%94-%D7%A9%D7%95%D7%A0%D7%95%D7%AA-%D7%A2%D7%9C%D7%95%D7%AA-%D7%94%D7%9E%D7%96%D7%95%D7%9F-%D7%95%D7%90%D7%99%D7%9A-%D7%A9%D7%95%D7%9C%D7%98%D7%99%D7%9D-%D7%91%D7%94 [vendor]
- Product trees (blog) — https://www.zestt.io/blog/%D7%9E%D7%A1%D7%AA%D7%91%D7%A8-%D7%A9%D7%9B%D7%A1%D7%A3-%D7%9B%D7%9F-%D7%92%D7%93%D7%9C-%D7%A2%D7%9C-%D7%A2%D7%A6%D7%99%D7%9D [vendor]
- Help centre index — https://support.zester.co.il/kb/he/
- Help: supplier management — https://support.zester.co.il/kb/guide/he/-lMD7qat0U7/Steps/4461187
- Help: new order — https://support.zester.co.il/kb/guide/he/-NvcB6MGGpZ/Steps/2018351
- Help: new user — https://support.zester.co.il/kb/guide/he/-Wuu7LeqwXZ/Steps/1957353
- Help: POS sync — https://support.zester.co.il/kb/guide/he/-axYoVYTxEf/Steps/2037783
- Help: product tree — https://support.zester.co.il/kb/guide/he/-zFn8hp8y4j/Steps/2183063
- Help: Plants Council link — https://support.zester.co.il/kb/guide/he/-AILh9dYaSs/Steps/2303500
- Help: new app (receiving, credit requests) — https://support.zester.co.il/kb/guide/he/zestt-MQ2mbBJqFc/Steps/4065972
- Help: consolidated tax invoice — https://support.zester.co.il/kb/guide/he/-a2zjDrRRxg/Steps/4590494 (from ext-01)
- Zestt Master (Stonly) — https://zestt.stonly.com/kb/he/zestt-master-445144
- Supplier API — https://rest.zester.co.il/ ; https://rest.zester.co.il/orders-receiving/ ; https://rest.zester.co.il/orders-reception-by-date/ ; https://rest.zester.co.il/order-data-supplier/ ; https://rest.zester.co.il/pos-api-introduction-copy/
- Legacy login — https://zester.co.il/Account/Login
- App Store (IL) — https://apps.apple.com/il/app/zestt-%D7%A2%D7%95%D7%A9%D7%99%D7%9D-%D7%98%D7%95%D7%91-%D7%9C%D7%9E%D7%A1%D7%A2%D7%93%D7%95%D7%AA/id6737556229?l=he ; US — https://apps.apple.com/us/app/zestt-better-restaurants/id6737556229 [store]
- Google Play — https://play.google.com/store/apps/details?id=com.weirdoz.zestt&hl=en_US ; legacy https://play.google.com/store/apps/details?id=com.emalogic.zester&hl=he [store]
- Facebook — https://www.facebook.com/zester.il/ ; Instagram — https://www.instagram.com/zestt.il/
- Funder (Japanika joins Zester, 15 Mar 2023) — https://www.funder.co.il/article/146103 [press]
- ice.co.il (Japanika item) — https://www.ice.co.il/digital-140/news/article/947469 [press]
- Funder (PayMe ↔ Zester) — https://www.funder.co.il/article/148041 [press, date not in extract]
- PC.co.il (Zester hiring; founded 2020) — https://www.pc.co.il/featured/380695/ [press]
- Startup Nation Central Finder — https://finder.startupnationcentral.org/company_page/zestt
- Startupim — https://slimpages.startupim.com/company_page/zestt ; https://startupim.com/company/zestt/raw
- Hashavshevet H-ERP partner page — https://www.h-erp.co.il/zester-%D7%A0%D7%99%D7%94%D7%95%D7%9C-%D7%9E%D7%A1%D7%A2%D7%93%D7%94-%D7%96%D7%A1%D7%98%D7%A8-%D7%97%D7%A9%D7%91%D7%A9%D7%91%D7%AA-erp/ (title only; "6%" claim via extract) [partner]
- Beecomm (partners incl. Zester) — https://www.beecomm.com/
- AllJobs (purchasing clerk updating prices in Zester) — https://www.alljobs.co.il/m/p/jobs/8704284
- HRSearch (branch manager; MarketMan/Zester an advantage) — https://www.hrsearch.co.il/jobs/9543
- Repo cross-refs: `notes/ext-01-israel-players.md` §4; `notes/int-06-catalog-inventory-recipes.md` (ZesttAdapter stub, sync-platforms); `notes/10-catalogue-and-impact.md` (A14, produce benchmark); `docs/ux/automation/README.md` (AU-03, AU-08, AU-09, AU-11, AU-13, AU-14); `docs/ICP.md` (later / anti-ICP list).
