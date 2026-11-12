# ext-01: Israeli players and practice for in-product automation (supplier invoices, restaurants)

*Researcher note, seen 2026-11-07. Scope: what Israeli tools automate (trigger, then action), what a human still confirms, claimed outcomes, public prices, and the lesson for RestoMatch. It extends `docs/research/ניהול חשבוניות ספקים במסעדות/` (report.md plus notes `israel_restaurant_operations.md`, `israel_regulation_tax.md`, `leak_economics_customer_voice.md`, `ap_ai_frontier.md`). It does not repeat their findings. It cites them only where a new fact changes an earlier conclusion.*

> **Method caveat.** This session could not fetch pages directly. Every WebFetch to Israeli and vendor hosts (kolzchut.org.il, zestt.io, sumit.co.il, efraty.com, virtuac-site.pages.dev, blogs.timesofisrael.com) failed DNS resolution in the sandbox. Every finding below therefore comes from **search-engine extracts** of the cited pages, not a full read. "Date seen" for every source is **2026-11-07**. **[vendor]** marks a vendor's own claim about itself. **UNVERIFIED** marks a claim I could not source. To re-read these pages in full, those hosts have to be allowed in the session's network settings.

---

## 0. What is new here (TL;DR for automation design)

1. **The Israel Tax Authority (ITA) now has a buyer-side "invoices received from suppliers for a period" API.** It was added in an Edition 2.0 supplement in 2025. The buyer passes its own VAT file number, a date range, an optional supplier VAT number and an include-line-items flag, and gets back the invoices its suppliers reported. Authentication is OAuth2 with user authorization. The earlier research left this open ("whether a buyer's software can pull invoice data was not established"). It now looks answered: **yes**. This is the biggest leapfrog lever in this note (§2).
2. **WhatsApp and email intake is table stakes in Israeli bookkeeping tools.** SUMIT, Rivhit DOCS, iCount, Morning and VirtuAc all advertise "photograph, send to WhatsApp or email, and the system reads, classifies and files it." OCR capture is not a differentiator in Israel. It is the price of entry (§3).
3. **Every Israeli tool stops at a human "approve the draft" step.** SUMIT saves the scan as a *draft*. H-DOKKA creates a *posting recommendation* that the bookkeeper approves. SUMIT bank matching shows a *preview* before full or partial approval. iCount leaves the user "only approving the expense". **Nobody advertises touchless posting.** None of the Israeli vendors publishes a touchless percentage (UNVERIFIED for all) (§3, §8).
4. **Zestt's consolidated-invoice flow is still manual line-up work** [vendor help doc]. The user filters delivery notes by supplier and dates, adds them to the document, **types in the total of the original tax invoice**, and investigates any difference by hand (a document-level discount? a gap on one delivery note?). This is exactly the step RestoMatch can automate end to end (§4).
5. **Zestt launched ZesttScan (around Feb 2026)**, a scanner for *receiving goods* from the order screen. It claims about **30 hours saved a month** [vendor]. Zestt also links produce price lists to the **Plants Council (מועצת הצמחים) price list** for automatic price updates. That gives a public produce price benchmark to copy (§4).
6. **Priority 24.1 automatically obtains or verifies allocation numbers and invoice details from the ITA** for supplier invoices. The ERP incumbents are wiring the ITA in. RestoMatch's planned "allocation-number guard" is becoming parity, not a moat, for anyone whose bookkeeper runs Priority (§3).
7. **Payment Ethics Law (2017): the sources conflict on whether it covers private B2B deals.** Most legal secondary sources say a business payer (עוסק מורשה or עוסק פטור) owes payment by **שוטף+45** *unless the contract explicitly sets another date*. One law-firm source says the law covers only public bodies. Treat שוטף+45 as a **default for silent contracts**, not a cap (§7).
8. **The bookkeeper's monthly rhythm is built around the VAT deadline (the 15th) and a "missing documents report" (דוח חוסרים).** A product that produces that report automatically, per supplier and per delivery note, fits the bookkeeper's existing ritual (§5).

---

## 1. Landscape map: who automates what (Israel)

| Layer | Player | Automates (trigger → action) | Human still confirms | Claimed outcome [all vendor] | Public price |
|---|---|---|---|---|---|
| Restaurant procurement | **Zestt / Zester** | Order date → auto-send order and reminders; receive goods → digital delivery note; price comparison → "automatic credits"; Plants Council price list → price update; ZesttScan at receiving → auto data entry | Receiving check, the consolidated-invoice total and its differences, credit requests | ~30 h/month saved (ZesttScan); 15,000 restaurants (earlier note) | Not public |
| Restaurant procurement | **MarketMan (IL-founded)** | Photo or email invoice → OCR lines → compare to PO → flag discrepancies; price increase → alert by email or SMS; invoice over a threshold or from certain suppliers → approval required, logged with timestamp | Discrepancy review before approval; manager sign-off | "100+ hours a month" (platform-wide); "4–8 h/week" of accounting entry; one customer said "100 hours a week across nine locations" | $249/$299/$449+ (US) |
| Restaurant ERP | **Restigo** | (Earlier note: AI+OCR scanning, delivery vs invoice) | n/a | n/a | "High" for SMB (earlier note) |
| POS | **Tabit**, **Beecomm** | No supplier-invoice automation found; inventory is via partners (Zestt lists Tabit and Beecomm as cash-register interfaces) | n/a | n/a | n/a |
| SMB accounting | **Caspit** | Delivery notes over a month → one consolidated invoice per customer (seller side); receiving into stock updates the item purchase price | Everything | n/a | n/a |
| Bookkeeper ERP | **Hashavshevet H-ERP + H-DOKKA / H-SCAN** | Supplier invoice (any format) → OCR/ML → classify → *posting recommendation* → entry in H-ERP | Bookkeeper approves each recommendation | "Thousands of documents an hour" | Not public |
| Bookkeeper ERP | **Priority / Priority Zoom** | Supplier invoice → automatic retrieval or verification of the allocation number and invoice details from the ITA (v24.1); consolidated invoice linked to a goods receipt only if quantities are identical (earlier note) | Linking, exceptions | n/a | Zoom: not public. A third-party OCR add-on costs ₪10–30K setup plus ₪1,500+/month |
| SMB/bookkeeper cloud | **SUMIT** | Photo, email or WhatsApp → OCR → fields filled → **draft** expense; supplier recognized → suggested supplier card (or a new one created); bank lines → "magic wand" suggested counter-entries → preview → approve | Draft save; match preview | "72.8 work hours a month saved", "+30% clients with same staff", "40% hours saved" | Free unlimited trial for up to 2 files; price list not captured |
| SMB/bookkeeper cloud | **Rivhit DOCS** | Scan, photo, WhatsApp or email → OCR → classify → auto journal entry; learns the classification code after a correction; per-client WhatsApp setup | Corrections | n/a | ₪15+VAT/mo (עוסק, ≤75 docs); ₪30+VAT/mo (company, ≤150 docs); also ₪1,200/yr and ₪690/yr for representatives (inconsistent pages) |
| Invoicing | **iCount** | Photo in app, WhatsApp or email → AI-OCR → fields filled → the user "only approves"; export to Hashavshevet for the bookkeeper | Approve each expense | n/a | From ₪32/mo (earlier note) |
| Invoicing | **Morning (Green Invoice)** | WhatsApp, email, Google Drive or upload → scan → auto-fill expense fields; email add-on collects invoices; fixed expense types with tax and VAT recognition %; report sent to the accountant | User is responsible that third-party invoices are correct (terms of service) | n/a | Expense scanning in the "Best" tier |
| Capture middleware | **VirtuAc** | Gmail, Outlook, WhatsApp Business number or Telegram → Azure OCR → map supplier tax ID to supplier code → DAT/CSV for Hashavshevet; auto-acknowledges the sender on WhatsApp; failed-records log | Fixing failed records | 98% OCR accuracy; ">80% less processing time"; 15-minute setup | Free ≤50 invoices/month; Pro has a 14-day trial |
| Approval layer | **DOKKA** (also integrated with H-ERP) | Invoice → approval chain with thresholds → email or in-app notification → automatic reminders | Approvers | "Up to 90%" less processing time; 7–10 s capture | Not public |

Sources for each row are in §2–§7 and in the source list.

---

## 2. The ITA buyer-side retrieval API (the biggest new lever)

**Finding.** The ITA's "Israel Invoices model" developer documentation now includes a **service that returns the invoices a customer received from its suppliers for a period** (שרות להחזרת חשבוניות שנתקבלו מספקים לתקופה). It was published as a supplement to Edition 2.0, dated 6.2025 (file `vat_software-houses-140725.pdf`). A separate 2.2025 supplement covers a multi-invoice service. Per the search extract of the spec:
- **Inputs:** the customer's VAT file number, start and end dates, the date basis (invoice date or document issuance date), an optional supplier VAT number, and a flag to include line items or not.
- **Outputs:** invoice details "as they appear on the suppliers' reporting screen". Line items come back according to the item parameter. If they are truncated for performance, the response says so, and the single-invoice details service returns the full lines of one invoice.
- **Limits:** if the range is too wide, error 470 asks the caller to narrow the dates or pass a supplier VAT number. The period is currently limited to **one or two months, per the business's VAT reporting cycle**.
- **Auth:** OAuth2 with user authorization or certification for viewing. Hosts are under `ita-api.taxes.gov.il`. Sandbox host names differ between supplement versions, so verify them against the current gov.il page.
- Easybooks (a commercial guide) lists the same buyer service alongside "request allocation number" and "retrieve details of an allocated invoice". A SAP Business One partner page shows production paths such as `invoice-information/v1`.

**Caveats.** Coverage is only what suppliers *reported* to the ITA. In practice that means allocation-numbered invoices, so above ₪5,000 pre-VAT since June 2026 per the earlier note, plus anything suppliers' software reports voluntarily. Whether small per-delivery invoices below the threshold appear is **UNVERIFIED**. Whether line items are reliable enough to drive line-level matching is **UNVERIFIED**. Access requires registering as a software house with the ITA. Per AGENTS.md, that credential intake is a human-only, Phase-6 task.

**Lesson (leapfrog).**
- **Use the ITA as a second, authoritative source of truth.** Pull "what the ITA says your suppliers billed you" monthly and diff it against what RestoMatch captured from WhatsApp, email and photos. Three automations come out of that diff for free:
  1. **Missing-invoice detection:** the ITA lists an invoice RestoMatch has never seen. Chase the document, or at least record the liability.
  2. **Allocation-number truth:** an invoice RestoMatch holds with no ITA counterpart puts its input VAT at risk. This turns the planned allocation-number guard from a heuristic into a fact.
  3. **OCR-free header data** at confidence 1.0 for every allocation-numbered invoice, which feeds the matching engine directly. This matches the "ingest abstraction" proposed in `ap_ai_frontier.md`.
- None of the Israeli competitors found here advertises buyer-side retrieval to restaurants. Priority 24.1 retrieves details *per invoice*. Hashavshevet documents only issuer-side allocation. Absence of evidence is not proof, so mark this **UNVERIFIED as a moat**.

---

## 3. Bookkeeping and capture layer: what is automated, and where a human stays in the loop

### SUMIT
- **Automates:** upload a photo from any device "in two clicks" → OCR → fields filled → **saved as a draft**. It recognizes existing suppliers from document details and suggests linking them, or opens a new supplier card while filing. Extracted fields: supplier, business number (מספר עוסק), date, amount, reference number. On an ambiguous value it **picks one option and shows the alternatives as one-click swaps**. Intake: mobile, desktop, email, WhatsApp. Bank and credit-card statements are pulled automatically. A "magic wand" suggests counter-entries learned from earlier entries. A **preview lists the auto-matches, which apply after full or partial approval**. Bookkeeping firms' clients send material by email or WhatsApp, and staff capture it with one click.
- **Claims [vendor]:** 72.8 work hours a month saved; a firm can take 30% more clients with the same staff; a separate page says 40% hours saved. An independent search for "72.8" found no corroboration, so treat it as unverified.
- **Lesson.** *Copy:* "pick the best guess and show the alternatives as one-tap chips". It is the right UI for ambiguous OCR fields such as supplier, unit and VAT. *Copy:* a preview of batch auto-matches with partial approval. *Avoid:* hour-saving claims to two decimal places that nobody can check. RestoMatch's claim should be ₪ recovered, which the owner can verify against their bank.

### Rivhit DOCS
- **Automates:** scan or photo in the app, or **WhatsApp or email** → OCR → classify → **automatic journal entry**. Supports double-entry and single-entry books. **Learns:** if the classification code of a document type is changed, it assigns similar documents to the new code next time. There is a knowledge-base article on setting up **WhatsApp per client**. Earlier note: duplicate alerts when a document already exists in the journal.
- **Price:** ₪15+VAT/month per עוסק (≤75 expense docs/month); ₪30+VAT/month per company (≤150 docs). Other pages show ₪1,200+VAT a year, a ₪998 bundle licence and ₪690+VAT a year for representatives (מייצגים). The pages are inconsistent.
- **Lesson.** Capture and classification cost **₪15–30 a month** in Israel. RestoMatch cannot charge for capture. *Copy:* learn-from-correction, scoped per supplier and per item. A correction to a unit or SKU mapping should become a rule, not a one-off fix.

### Hashavshevet H-ERP: H-DOKKA and H-SCAN
- **Automates:** H-DOKKA reads supplier invoices "in any format and language" with OCR and machine learning, classifies them, creates a **posting recommendation for the bookkeeping manager to approve**, then posts to H-ERP. It is a two-way interface with DOKKA. H-SCAN decodes scanned purchase documents into journal entries in H-WEB. H-ERP connects to the ITA for *issuing* allocation numbers (Israel Invoices "generation B"). The 2026 documentation says the business token is valid for three years and that Hashavshevet 2026 SP2.1 or later is required because of a token format change.
- **Claims [vendor]:** "thousands of documents an hour"; a compliant digital archive.
- **Lesson.** Hashavshevet's bookkeeper flow is **header-level capture → posting**. It never sees delivery notes, quantities or agreed prices. RestoMatch should **feed** Hashavshevet (DAT/CSV export, see VirtuAc), not compete with it. The bookkeeper keeps approving postings, and RestoMatch hands her a *pre-reconciled* batch.

### Priority and Priority Zoom
- **Automates:** release 24.1 adds automatic retrieval or verification of the allocation number **and invoice details from the ITA** for supplier invoices (in 23.1 the feature did not exist). It loads supplier withholding-tax data for up to 3,000 suppliers from the Income Tax "system 1000". Zoom is the small-business ERP on AWS. A third-party marketplace add-on (Task Automation "Easy Order Entry", ABBYY OCR, aimed mainly at sales orders) costs **₪10–30K setup plus ₪1,500+/month**.
- **Lesson.** The ITA check is becoming a built-in ERP feature. RestoMatch's allocation guard has to be *earlier* (at receipt, before the supplier's month closes, while a corrected invoice can still be requested) and *in ₪* (18% of the invoice at risk). An end-of-period validation alone is not enough.

### iCount and Morning
- **iCount:** AI-based OCR turns the image into text, identifies the required data and enters it, "leaving the user only to approve the expense". Intake: app photo, WhatsApp, email. Sort by classification code. Exports monthly data **directly to Hashavshevet** for the bookkeeper (support forum).
- **Morning:** upload by WhatsApp, email, Google Drive or desktop → scan → auto-fill. An email add-on collects invoices automatically. Fixed expense types carry income-tax and VAT recognition percentages. Expense report sent to the accountant. The accountant can get limited access. The terms of service make the **user responsible** for the correctness of invoices captured from third parties.
- **Lesson.** The restaurant owner may already photograph invoices into one of these tools for the accountant. RestoMatch must not require a *second* photo. *Leapfrog:* one capture, two outputs. Leak matching goes to the owner, and a clean expense export goes to the bookkeeper (Hashavshevet DAT, Priority, Morning, iCount). The ITA pull (§2) can close whatever gap is left.

### VirtuAc (capture middleware, Israel)
- **Automates:** Gmail, Outlook, **a dedicated WhatsApp Business number per organization**, Telegram, or web upload → Azure AI OCR → maps the supplier's Israeli business number to a supplier code → batches exported as **Hashavshevet DAT** or CSV. Also targets Priority, Green Invoice, Monday and Fireberry. It **sends an automatic WhatsApp reply** confirming the invoice is queued. A failed-records log handles corrections. Duplicates are detected on **supplier + invoice number**, because Israeli invoice numbers are not globally unique.
- **Claims [vendor]:** 98% OCR accuracy; ">80%" less processing time (testimonial); 15-minute setup. **Price:** free up to 50 invoices/month; Pro has a 14-day trial.
- **Lesson.** *Copy:* the **sender acknowledgment** on WhatsApp ("received, 3 lines, ₪4,210, supplier X"), which turns WhatsApp intake from a black hole into a receipt. *Copy:* the dedupe key `(supplier tax ID, invoice number)`, never invoice number alone. *Copy:* the failed-records queue as an explicit inbox.

### DOKKA (approval workflow)
- **Automates:** one or more people approve a document before it enters the books. Notifications go by email or in the platform, with automatic reminders and approval thresholds and limits. Israeli integrator CAV describes intake from PDF through approval cycles to viewing in the ERP.
- **Claims [vendor]:** "up to 90%" less processing time; 7–10 s capture.
- **Lesson.** For a 1–3 branch owner-operator, a multi-step approval chain is overkill. The Israeli pattern worth copying is a **₪ threshold → owner tap**, with reminders. It matches MarketMan's "invoices above a set value or from certain suppliers require sign-off".

---

## 4. Restaurant procurement layer

### Zestt / Zester (Israeli, restaurant-specific)
- **Automates [vendor]:**
  - Order forms; **orders sent automatically on set dates**; automatic reminders; sync with suppliers.
  - Receiving goods into **digital delivery notes and drafts** saved to the account. Suppliers send delivery notes through the system, so the restaurant learns about missing products *in advance*.
  - "Compare product prices, keep updated on supplier pricing and **create automatic credits**." The help center lists goods receiving and **credit requests** (בקשות לזיכוי) as separate features. The detailed credit flow was not retrieved (UNVERIFIED).
  - **ZesttScan** (blog, about Feb 2026): "the smart scanner of Zestt". When goods arrive, the user taps "receive goods" on the orders page and scans, and "all the data is entered automatically and accurately". It claims about **30 hours saved a month** on average and fewer gaps between order and receipt. The search extract does not make clear whether it scans the paper delivery note or the products (UNVERIFIED).
  - **Plants Council price-list linking:** a supplier's produce price list can be connected to the Plants Council (מועצת הצמחים) list for **automatic price updates**.
  - **Consolidated tax invoice (help guide):** "Delivery notes & invoices" tab → new document → "consolidated invoice intake" → filter by supplier and dates → add delivery notes one by one or "add all" → **enter the total of the original tax invoice** → if there is a difference, check for a document-level discount or gaps in one of the delivery notes → issue. The guide recommends attaching a photo of the original tax invoice. A delivery note attached to a consolidated invoice can no longer be edited.
  - **Supplier API** (`rest.zester.co.il`, bearer token, credentials requested by email): order reception, orders by date or criteria (status 17 = "moved to supplier ERP"), delivery documents by criteria (status 0 draft through 6 pending approval), create a delivery certificate or invoice, POS Z-totals and items. Some pages are dated about 130–1,500 days old.
- **Zestt's own leak narrative (blog):** ordered goods often differ from what arrives (missing, substituted, wrong quantity). "If missing items aren't marked, documented and tracked, that money simply disappears." An invoice can charge more than agreed, and only structured receiving catches this in time. Without records of what arrived, accounting can't tell what to pay, which leads to disputes or duplicate payments.
- **Lesson.**
  - *Avoid* Zestt's manual consolidated-invoice reconciliation. RestoMatch should **auto-propose the delivery-note set** for each consolidated invoice: same supplier, open delivery notes in the billing month, and a subset-sum match on the total. It should then **explain the residual in ₪**, split into document-level discount, a specific delivery note's price or quantity gap, and a missing credit. That is the leak, made visible.
  - *Copy* the "attached delivery note is locked" rule as an audit invariant (the evidence chain cannot change after billing).
  - *Copy and extend* the Plants Council link. Use public wholesale produce prices as a **benchmark price** for fruit and vegetable lines, flagging "paid X% above market today", not only "above last price".
  - *Integrate, don't fight:* restaurants on Zestt already hold structured orders and delivery notes. The Zester API is a supplier-side API, though. Whether a *restaurant*-side export exists is **UNVERIFIED**. `packages/procurement` already lists Zester sync per STATE/AGENTS, so check what it actually covers.

### MarketMan (Israel-founded; mostly US documentation)
- **Automates [vendor]:** invoice photographed in the app or forwarded by email → OCR extracts lines, quantities and prices → **compared to the original PO → discrepancies flagged for review before approval**. Price increase on an item → alert by **email and SMS**, with price history. **Invoices above a set value, or from certain suppliers, require manager sign-off**, and all approvals are **logged with timestamps**. PO approval is in the Growth plan. Starter includes 50 AI scans a month. Growth is unlimited.
- **Claims [vendor]:** "100+ hours a month" (platform-wide); "4–8 hours of accounting data entry a week"; one testimonial says "at least 100 hours a week across nine locations". The figures conflict.
- **No Israel-specific (Hebrew, allocation number, ILS) invoice features found** on marketman.co.il (UNVERIFIED either way).
- **Lesson.** *Copy:* the ₪-threshold and per-supplier approval rule with a timestamped log. *Avoid:* a "hours saved" headline with inconsistent figures. *Leapfrog:* MarketMan stops at "flagged for review". RestoMatch continues to *claim drafted → sent → credited*.

### Restigo, Tabit, Beecomm, Caspit
- **Restigo:** this round found nothing new beyond the earlier note. Its pages mention "managing credits correctly" only as a tip.
- **Tabit:** POS-first. The April 2026 release notes cover feedback dashboards, upsells, tags and kiosk nutrition, with **no supplier or inventory automation**. Its terms mention a stock-management interface. Zestt lists Tabit as a cash-register partner.
- **Beecomm:** POS, kiosks, delivery and KDS. "How to manage inventory" is a training topic. **No supplier-invoice module found.**
- **Caspit:** seller-side. Monthly delivery notes → one consolidated invoice per customer. Receiving stock records the supplier's delivery-note or invoice number and **updates the item's purchase price to the price entered**. Returns are a **delivery note with negative quantities** marked "החזרת סחורה". It supports "file 100" for retail chains, which "won't pay if they don't receive it".
- **Lesson.** POS vendors are **revenue-side partners**, not AP competitors. The "negative delivery note = return" convention (Caspit) is how Israeli suppliers document returns. RestoMatch's OCR and reconciler should treat a negative-quantity delivery note as a **credit-evidence** document, not an error. The "file 100" idea (chains refuse payment without a structured file of delivery notes) is the enterprise version of what RestoMatch offers independents: *no matched delivery note, no payment*.

---

## 5. How restaurant bookkeepers actually work monthly (Israeli practice)

- **The VAT deadline drives the month.** VAT is filed and paid **by the 15th of the month after the period**. The period is monthly or bi-monthly depending on business size. A dealer above ~₪2.5M turnover reports monthly (search extracts of efraty and yeshinvoice; threshold not re-verified). An ICP restaurant with ₪100–400K/month food spend almost certainly reports **monthly**. That is an inference from turnover, not sourced per restaurant.
- **A "missing documents report" (דוח חוסרים) every month-end.** One bookkeeping service describes producing it every month: expenses that couldn't be captured well enough, or that lack an invoice (ig-tax). Practice-management guidance names "end of month / VAT period close" as the trigger for routine work.
- **Supplier reconciliation cadence.** In high-volume businesses, a partial reconciliation weekly and a full check at month-end is common. Supplier reconciliation is *harder than bank reconciliation* because both sides keep books and both can err (mishlav). In job ads, AP tasks are intake and checking of supplier invoices, supplier card reconciliations, preparing מס"ב batches, cheques and transfers, and month-end payments.
- **Tools.** Hashavshevet and Priority dominate job ads (earlier note). Bookkeepers increasingly receive client documents via WhatsApp and email into SUMIT, Rivhit DOCS or Morning (§3). An old (~2017) forum thread shows some accountants refusing photos or WhatsApp copies as tax documents. Current acceptance rules for scanned or photographed documents are in the earlier `israel_regulation_tax.md` §3. Not re-researched here.
- **Price of the bookkeeper.** Indicative market price lists: עוסק מורשה ₪300–900/month, single-entry ₪300–550, double-entry ₪600–1,200, companies (בע"מ) ₪800–3,000/month. Pricing scales with **number of documents**, e.g. a base of up to 30 docs a month plus tiered extras (midrag, d.co.il, finexpert, bakertilly; not restaurant-specific).
- **Hours spent:** **UNVERIFIED.** I found no Israeli source measuring a restaurant bookkeeper's hours per supplier or per month. Vendor proxies only: SUMIT says 72.8 h/month saved [vendor]; ZesttScan says ~30 h/month [vendor]; MarketMan says 4–8 h/week of entry [vendor].
- **Lesson.**
  - *Copy the ritual:* ship an automated **"דוח חוסרים" for the bookkeeper**, timed for about the 8th–10th of the month (before the 15th VAT deadline). It should list, per supplier: delivery notes with no invoice, invoices with no delivery note, invoices over ₪5,000 with no allocation number, credits requested but not received, and ITA-listed invoices not in hand (§2). This is a trigger-to-action automation that fits a calendar she already keeps.
  - *Pricing angle:* bookkeepers price per document. A pre-reconciled, deduplicated export reduces *her* document handling, which makes the bookkeeper a channel (consistent with `leak_economics_customer_voice.md` §accountant channel).

---

## 6. Consolidated invoices (חשבונית מרכזת) and delivery notes in practice

- **Mechanics (secondary sources):** a seller who ships often issues delivery notes during the month and a **consolidated tax invoice at month-end** covering all of them. Caspit generates one per customer. General rule: a tax invoice is due **within 14 days of the tax event**. A seller who sends goods **with a delivery note** may issue the invoice within that 14-day window. Without a delivery note, the invoice must be issued at delivery (eddiecpa, protocol, ezbigboss). The tax invoice must show the delivery-note number and date when a delivery note was required (Kol Zchut, via search extract).
- **One invoice can bind several delivery notes.** Public-sector supplier rules allow linking more than one delivery note per invoice and recording delivery-note number and date at the **line level** (Ministry of Defense supplier guidelines). Priority links only when quantities are identical (earlier note). In Zestt the user does it manually (§4).
- **Lesson.**
  - The consolidated invoice is where a quantity or price gap on one delivery note **hides inside a monthly total**. RestoMatch's automation should run at two moments: (1) **delivery-note time** (receiving check, credit request drafted the same day, while the driver relationship is fresh) and (2) **consolidated-invoice time** (auto-link the delivery notes, explain the residual in ₪, and block "ready to pay" until the residual is zero or accepted).
  - Use the **14-day rule** as a timer. If a delivery note has no invoice 14+ days after the month closes, the supplier is late and input VAT is not yet deductible. Remind the owner or bookkeeper. (Applying this to month-end consolidated invoices is an inference. Confirm the exact regulation text.)

---

## 7. Payment terms and the Payment Ethics Law (חוק מוסר תשלומים לספקים, 2017)

- **What most legal secondary sources say:** "business" (עסק) covers **עוסק מורשה, עוסק פטור and financial institutions**. A payer that is a business must pay **no later than 45 days from the end of the month in which the invoice was delivered** (שוטף+45), **unless the parties explicitly set a different date in the contract** (Gatrimon, judgments.org.il, Kol Zchut via extract). Late amounts carry linkage differences and interest, and late-payment interest (ריבית פיגורים) after 30 days (earlier note). The law applies to contracts from 30 June 2017 (local authorities from 31 July 2017).
- **Conflicts:**
  - Momentor says a different date is allowed only if it is in the contract *and* the nature of the engagement requires it or it is "not exceptionally unfair" (section 3(ז)). Other sources attach that condition to **public bodies**, which also need director-general approval.
  - One law-firm page (drlawfirm) says the law governs **only public bodies** and does not apply to a restaurant's deals with a private supplier.
  - Neither conflict is resolved here. The enacted text (Wikisource, Knesset consolidated version `23_cs_bg_591217.pdf`) could not be fetched. **UNVERIFIED pending legal read.**
- **Market practice:** "שוטף+" is supplier credit, effectively an interest-free loan from the supplier (BDO). Credit terms above **שוטף+90** are rare between ordinary businesses (search extract). Commercial **postdated cheques** are the norm for many businesses and squeeze cash flow (Kipa). An earlier ynet anecdote covers bounced restaurant cheques. A Jan 2025 ynet case: one restaurant's debts included **~₪700K owed to suppliers** next to ~₪1.2M to banks (single case). **Typical terms for food suppliers to restaurants specifically: UNVERIFIED** (no Israeli source found; the earlier note has general שוטף+30/60/90).
- **Lesson.**
  - *Automate due dates:* compute each invoice's due date from the supplier's terms (default שוטף+45 when the contract is silent, *if* the law applies, and flagged "legal default, verify").
  - *Leapfrog with timing, not legal claims:* the ₪ leverage comes from the gap between receipt and payment. On שוטף+60 the owner hasn't paid when the gap is found, so **"withhold ₪X from next payment run until credit arrives"** is a stronger automation than "request credit". This sits within PR-only and human-approval rules: RestoMatch proposes the hold, and the owner taps to approve.
  - *Avoid:* presenting the Payment Ethics Law to restaurants as a weapon or obligation until a lawyer confirms private-sector applicability.

---

## 8. Cross-cutting pattern: what Israeli tools leave to humans

| Step | Israeli state of the art | Who confirms | RestoMatch move |
|---|---|---|---|
| Capture (photo, WhatsApp, email) | Commodity (₪15–30/month) | Nobody, or a draft review | Accept from any channel, acknowledge to the sender, dedupe on (supplier tax ID, invoice number) |
| Field extraction | OCR + "best guess plus alternatives" (SUMIT) | User on drafts | Same, plus **ITA pull** for header truth (§2) |
| Classification | Learns from corrections (Rivhit) | Bookkeeper | Learn **unit, SKU and price** mappings per supplier, not just GL codes |
| Delivery note ↔ invoice | Manual (Zestt) or identical-quantity linking (Priority) | Bookkeeper or owner | **Auto subset-match plus ₪ residual explanation** |
| Price check | Alert on price rise (MarketMan), automatic credit by price comparison (Zestt), Plants Council list (Zestt) | Owner | Agreed-price + last-price + **public produce benchmark** |
| Approval | ₪ threshold / supplier rule (MarketMan, DOKKA) | Manager or owner | One tap, ₪-sorted, logged |
| Posting | Recommendation, then approve (H-DOKKA) | Bookkeeper | Export a pre-reconciled batch (DAT/CSV/Priority) |
| Credits | "Credit requests" exist (Zestt); follow-through not shown | Owner | Draft, send, track until it posts in the כרטסת (earlier report) |
| Allocation number | Priority 24.1 verifies against the ITA | ERP | Earlier, in ₪ at risk, plus missing-invoice diff |

**Touchless %:** no Israeli vendor publishes one (**UNVERIFIED**). Israeli UX consistently ends in human approval. That matches AGENTS.md's PR-only, human-gated philosophy, so "everything is a draft until a tap" is culturally expected, not a weakness.

---

## 9. Lessons for RestoMatch (copy / avoid / leapfrog)

**Copy**
1. WhatsApp + email + photo intake with an **automatic sender acknowledgment** (VirtuAc), feeding a **failed-records inbox**.
2. "Best guess plus one-tap alternatives" for ambiguous fields (SUMIT).
3. Learn-from-correction rules (Rivhit), scoped to supplier × item × unit.
4. ₪-threshold and per-supplier sign-off with a timestamped approval log (MarketMan, DOKKA).
5. Lock evidence once billed: an attached delivery note is immutable (Zestt).
6. Treat a negative-quantity delivery note as return or credit evidence (Caspit).
7. Monthly **"דוח חוסרים"** for the bookkeeper before the 15th (practice).

**Avoid**
1. Selling capture or OCR. It costs ₪15–30 a month here.
2. Unverifiable "hours saved" headlines (72.8 h, 100+ h). Sell **₪ recovered**.
3. Making the owner double-capture alongside Morning or iCount. Offer one capture with two outputs.
4. Manual consolidated-invoice reconciliation (Zestt's flow).
5. Legal claims about the Payment Ethics Law before a lawyer's read.

**Leapfrog**
1. **ITA buyer-side pull** of received invoices, diffed against captured documents: missing invoices, allocation-number truth, OCR-free headers (§2).
2. **Auto delivery-note-set proposal for consolidated invoices** with a ₪ residual explanation (§4, §6).
3. **Public produce price benchmark** (Plants Council) on fruit and vegetable lines (§4).
4. **Payment-run hold**: on שוטף+N, propose withholding ₪X until a credit posts, approved by the owner with one tap (§7).
5. A **pre-reconciled export to Hashavshevet, Priority, Morning or iCount**, so the bookkeeper becomes a distribution channel (§3, §5).

---

## 10. Gaps / UNVERIFIED

- Whether the ITA "received invoices" service returns sub-₪5,000 invoices, and how reliable its line items are.
- Whether Zestt or MarketMan IL offer a *restaurant-side* export API. The Zester API found is supplier-side.
- What ZesttScan scans (paper delivery note vs product barcodes), and its pricing.
- Hours an Israeli restaurant bookkeeper spends per month on supplier invoices (no independent source).
- Typical payment terms between Israeli food suppliers and restaurants; whether the Payment Ethics Law applies to private B2B, and with what conditions.
- SUMIT, Morning and Tabit-inventory pricing; any Israeli touchless %.
- No owner or bookkeeper verbatims (closed Facebook and WhatsApp groups, same gap as the earlier research).

---

## Sources (all seen 2026-11-07; read via search extracts, see the method caveat)

**ITA / regulation / law**
- ITA, Israel Invoices model: service returning invoices received from suppliers for a period, supplement 6.2025 — https://www.gov.il/BlobFolder/generalpage/israel-invoice-160723/he/vat_software-houses-140725.pdf
- ITA, multi-invoice service supplement, Ed. 2.0 / 2.2025 — https://www.gov.il/BlobFolder/generalpage/hor-software-other/he/vat_software-houses-080425.pdf
- ITA, API description Ed. 2.0 / 7.2024 — https://www.gov.il/BlobFolder/generalpage/hor-software-other/he/vat_software-houses-180724.pdf
- Easybooks, ITA API guide — https://easybooks.co.il/knowledge-center/%D7%A9%D7%99%D7%A8%D7%95%D7%AA%D7%99-%D7%94-api-%D7%A9%D7%9C-%D7%A8%D7%A9%D7%95%D7%AA-%D7%94%D7%9E%D7%A1%D7%99%D7%9D-%D7%9E%D7%93%D7%A8%D7%99%D7%9A-%D7%9E%D7%A2%D7%A9%D7%99-%D7%9C%D7%94%D7%AA%D7%9E/
- SAP B1 partner, ITA allocation paths — https://menahel4u.com/%D7%A9%D7%93%D7%A8%D7%95%D7%92%D7%99%D7%9D/sap-business-one-10-%D7%9E%D7%95%D7%93%D7%95%D7%9C-%D7%97%D7%A9%D7%91%D7%95%D7%A0%D7%99%D7%95%D7%AA-%D7%99%D7%A9%D7%A8%D7%90%D7%9C/
- H-ERP, Israel Invoices in Hashavshevet 2025/2026 — https://downloads.h-erp.co.il/files/IsrInv/IsrInv2026.pdf ; https://www.h-erp.co.il/israel-invoice/
- Kol Zchut, supplier payment deadlines — https://www.kolzchut.org.il/he/%D7%94%D7%9E%D7%95%D7%A2%D7%93_%D7%94%D7%90%D7%97%D7%A8%D7%95%D7%9F_%D7%9C%D7%AA%D7%A9%D7%9C%D7%95%D7%9D_%D7%AA%D7%9E%D7%95%D7%A8%D7%94_%D7%9C%D7%A1%D7%A4%D7%A7%D7%99%D7%9D_%D7%A2%D7%91%D7%95%D7%A8_%D7%A1%D7%97%D7%95%D7%A8%D7%94_%D7%90%D7%95_%D7%A9%D7%99%D7%A8%D7%95%D7%AA
- Knesset consolidated text of the law — https://fs.knesset.gov.il/23/Committees/23_cs_bg_591217.pdf ; Wikisource — https://he.wikisource.org/wiki/%D7%97%D7%95%D7%A7_%D7%9E%D7%95%D7%A1%D7%A8_%D7%AA%D7%A9%D7%9C%D7%95%D7%9E%D7%99%D7%9D_%D7%9C%D7%A1%D7%A4%D7%A7%D7%99%D7%9D
- judgments.org.il, law text — https://judgments.org.il/laws/%D7%97%D7%95%D7%A7-%D7%9E%D7%95%D7%A1%D7%A8-%D7%AA%D7%A9%D7%9C%D7%95%D7%9E%D7%99%D7%9D-%D7%9C%D7%A1%D7%A4%D7%A7%D7%99%D7%9D-%D7%94%D7%AA%D7%A9%D7%A2%D7%96-2017/
- Gatrimon law guide — https://www.gatrimon-law.co.il/%D7%97%D7%95%D7%A7-%D7%9E%D7%95%D7%A1%D7%A8-%D7%AA%D7%A9%D7%9C%D7%95%D7%9E%D7%99%D7%9D-%D7%A1%D7%A7%D7%99%D7%A8%D7%94-%D7%9B%D7%9C%D7%9C%D7%99%D7%AA/
- Momentor, שוטף פלוס and section 3(ז) — https://momentor.co.il/%D7%A9%D7%95%D7%98%D7%A3-%D7%A4%D7%9C%D7%95%D7%A1/
- drlawfirm (conflicting: public bodies only) — https://www.drlawfirm.co.il/%D7%97%D7%95%D7%A7-%D7%9E%D7%95%D7%A1%D7%A8-%D7%AA%D7%A9%D7%9C%D7%95%D7%9E%D7%99%D7%9D-%D7%9C%D7%A1%D7%A4%D7%A7%D7%99%D7%9D-%D7%9C%D7%9E%D7%94-%D7%9B%D7%9C-%D7%9B%D7%9A-%D7%94%D7%A8%D7%91%D7%94/
- BDO, what is שוטף פלוס — https://www.bdo.co.il/he-il/blogs-he/%D7%91%D7%9C%D7%95%D7%92-%D7%A2%D7%A1%D7%A7%D7%99%D7%9D-%D7%A7%D7%98%D7%A0%D7%99%D7%9D/%D7%A9%D7%95%D7%98%D7%A3-%D7%A4%D7%9C%D7%95%D7%A1
- Kipa, commercial cheques — https://www.kipa.co.il/כדאי-לדעת/1115890-%D7%A2%D7%95%D7%91%D7%93%D7%99%D7%9D-%D7%A2%D7%9D-%D7%A6%D7%A7%D7%99%D7%9D-%D7%9E%D7%A1%D7%97%D7%A8%D7%99%D7%99%D7%9D-%D7%90%D7%AA%D7%9D-%D7%97%D7%99%D7%99%D7%91%D7%99%D7%9D-%D7%9C%D7%A9%D7%99%D7%9D-%D7%9C%D7%91-%D7%9C%D7%93%D7%91%D7%A8%D7%99%D7%9D-%D7%94%D7%91%D7%90%D7%99%D7%9D/
- ynet, restaurant industry collapse (Jan 2025) — https://www.ynet.co.il/economy/article/yokra14206911
- Consolidated invoice / 14-day rule: eddiecpa — https://www.eddiecpa.com/articles/%D7%9E%D7%95%D7%A2%D7%93-%D7%94%D7%95%D7%A6%D7%90%D7%AA-%D7%97%D7%A9%D7%91%D7%95%D7%A0%D7%99%D7%AA-%D7%9E%D7%A1-%D7%94%D7%98%D7%A2%D7%95%D7%AA-%D7%A9%D7%AA%D7%A2%D7%9C%D7%94-%D7%9C%D7%9B%D7%9D-%D7%91/ ; Protocol — https://protocol.co.il/tax-invoice/ ; ezbigboss — https://ezbigboss.com/%D7%94%D7%91%D7%93%D7%9C-%D7%91%D7%99%D7%9F-%D7%AA%D7%A2%D7%95%D7%93%D7%AA-%D7%9E%D7%A9%D7%9C%D7%95%D7%97-%D7%9C%D7%97%D7%A9%D7%91%D7%95%D7%A0%D7%99%D7%AA-%D7%9E%D7%A1/ ; Caspit FAQ — https://www.caspit.biz/FaqItem.aspx?id=58
- Ministry of Defense supplier guidelines (multiple delivery notes per invoice) — https://www.online.mod.gov.il/Online2016/Documents/Support/AttachmentC.doc

**Restaurant procurement / POS**
- Zestt restaurants page — https://www.zestt.io/en/restaurants ; home — https://www.zestt.io/en ; suppliers — https://www.zestt.io/en/suppliers
- Zestt blog: ZesttScan — https://www.zestt.io/blog/%D7%97%D7%96%D7%A8%D7%94-zesttscan-%E2%80%93-%D7%94%D7%A4%D7%99%D7%A6%E2%80%99%D7%A8-%D7%94%D7%97%D7%93%D7%A9-%D7%A9%D7%97%D7%95%D7%A1%D7%9A-%D7%9C%D7%9B%D7%9D-%D7%96%D7%9E%D7%9F-%D7%9B%D7%A1%D7%A3-%D7%95%D7%9B%D7%90%D7%91-%D7%A8%D7%90%D7%A9
- Zestt blog: why receiving matters — https://www.zestt.io/blog/%D7%9C%D7%9E%D7%94-%D7%97%D7%A9%D7%95%D7%91-%D7%9C%D7%A7%D7%9C%D7%95%D7%98-%D7%A1%D7%97%D7%95%D7%A8%D7%94
- Zestt help: consolidated tax invoice — https://support.zester.co.il/kb/guide/he/-a2zjDrRRxg/Steps/4590494
- Zestt help: Plants Council price list — https://support.zester.co.il/kb/guide/he/-AILh9dYaSs/Steps/2303500
- Zestt help: new app (receiving, credit requests) — https://support.zester.co.il/kb/guide/he/zestt-MQ2mbBJqFc/Steps/4065972
- Zester supplier API — https://rest.zester.co.il/ ; https://rest.zester.co.il/delivery-certificate-invoices-copy/ ; https://rest.zester.co.il/orders-receiving/
- MarketMan AP automation — https://www.marketman.com/platform/marketman-accounts-payable-automation ; invoice management — https://www.marketman.com/lp/restaurant-invoice-management ; pricing — https://www.marketman.com/pricing-for-restaurant-inventory-management-system ; Israel — https://marketman.co.il/
- Restigo — https://www.restigo.co.il/
- Tabit April 2026 release notes — https://support-il.tabit.cloud/hc/he-il/articles/33562455489938-%D7%97%D7%93%D7%A9-%D7%91-Tabit-%D7%90%D7%A4%D7%A8%D7%99%D7%9C-2026 ; terms — https://legal.tabit.cloud/il-documents/restaurant-documents/il-restaurant-terms-of-service/
- Beecomm — https://www.beecomm.com/ ; https://www.beecomm.com/copy-of-%D7%94%D7%93%D7%A8%D7%9B%D7%95%D7%AA
- Caspit receiving into stock — https://www.caspit.biz/HelpItem.aspx?id=870 ; returns — https://www.caspit.biz/FaqItem.aspx?id=73 ; file 100 — https://www.caspit.biz/%D7%9E%D7%9E%D7%A9%D7%A7-%D7%9C%D7%A1%D7%98%D7%95%D7%A8%D7%A0%D7%A7%D7%A1%D7%98-%D7%95%D7%9C%D7%A7%D7%95%D7%91%D7%A5-100/

**Bookkeeping / capture**
- SUMIT AI — https://www.sumit.co.il/ai ; auto-scan expenses — https://help.sumit.co.il/he/articles/5833251 ; AI matches — https://help.sumit.co.il/books/he/articles/11454256 ; price list — https://help.sumit.co.il/books/he/articles/6098833
- Rivhit DOCS — https://www.rivhit.co.il/%D7%9E%D7%95%D7%93%D7%95%D7%9C-%D7%94%D7%A0%D7%94%D7%9C%D7%AA-%D7%97%D7%A9%D7%91%D7%95%D7%A0%D7%95%D7%AA-%D7%9C%D7%9C%D7%90-%D7%A0%D7%99%D7%99%D7%A8%D7%AA/ ; https://land.rivhit.co.il/rivhit_docs/ ; https://land.rivhit.co.il/docs_cpa/ ; WhatsApp per client — https://www.rivhit.co.il/knowledgebase/%D7%9B%D7%99%D7%A6%D7%93-%D7%9E%D7%92%D7%93%D7%A8%D7%99%D7%9D-%D7%90%D7%AA-whatsapp-%D7%9C%D7%9C%D7%A7%D7%95%D7%97-%D7%91%D7%A8%D7%99%D7%95%D7%95%D7%97%D7%99%D7%AA-docs/
- H-ERP H-DOKKA — https://www.h-erp.co.il/h-dokka/ ; CPA — https://www.h-erp.co.il/cpa/
- Priority 24.1 release notes — https://cdn.priority-software.com/docs/Release_Notes_v24_1_H.pdf ; Priority Zoom — https://www.priority-software.com/il/erp/priority-zoom/ ; Task AI OCR add-on — https://market.priority-software.com/p/161-Task-AI-OCR/ ; withholding-tax load — https://support.priority-software.com/he/kb/FQ19000399_H/Hebrew
- iCount AI — https://www.icount.co.il/blog/icount-ai/ ; expenses — https://www.icount.co.il/features/expense/ ; forum — https://forum.icount.co.il/viewtopic.php?t=8156
- Morning expenses — https://www.greeninvoice.co.il/help-center/expenses/ ; https://www.greeninvoice.co.il/help-center/expenses-manage/ ; integrations — https://www.greeninvoice.co.il/integrations/ ; pricing — https://www.greeninvoice.co.il/pricing/ ; terms — https://www.greeninvoice.co.il/terms/
- VirtuAc — https://virtuac-site.pages.dev/ ; WhatsApp — https://virtuac-site.pages.dev/blog/whatsapp-invoice-automation ; Hashavshevet export — https://virtuac-site.pages.dev/blog/hashavshevet-export-guide
- invoicedataextraction, Hashavshevet scanning — https://invoicedataextraction.com/blog/hashavshevet-invoice-scanning
- DOKKA approvals — https://support.dokka.com/en/support/solutions/articles/62000235704-approving-invoices-in-dokka-a-guide-for-approvers ; https://dokka.com/invoice-approval-software/ ; CAV integrator — https://cav.co.il/en/integrations/dokka
- Achiya Cohen (ToI blog, 18 Mar 2026; author sells WhatsApp bots) — https://blogs.timesofisrael.com/israels-e-invoice-revolution-is-accidentally-creating-a-digital-business-sector/ ; https://blogs.timesofisrael.com/the-whatsapp-paradox-why-israeli-businesses-use-the-worlds-best-app-in-the-worst-way/

**Bookkeeper practice / pricing**
- mishlav, supplier vs bank reconciliation — https://mishlav.co.il/bank-supplier-reconciliation/
- ig-tax, monthly "missing documents report" — https://ig-tax.co.il/service/%D7%94%D7%A0%D7%94%D7%9C%D7%AA-%D7%97%D7%A9%D7%91%D7%95%D7%A0%D7%95%D7%AA-%D7%9C%D7%A2%D7%95%D7%A1%D7%A7-%D7%9E%D7%95%D7%A8%D7%A9%D7%94/
- alcyone14, practice management triggers — https://www.alcyone14.com/blog/accounting-practice-management-software
- yeshinvoice, VAT by the 15th — https://yeshinvoice.co.il/questions/%D7%97%D7%A9%D7%91%D7%95%D7%A0%D7%99%D7%AA-%D7%99%D7%A8%D7%95%D7%A7%D7%94/%D7%90%D7%99%D7%9A-%D7%9E%D7%97%D7%A9%D7%91%D7%99%D7%9D-%D7%9E%D7%A2%D7%9E-%D7%9C%D7%A6%D7%95%D7%A8%D7%9B%D7%99-%D7%94%D7%A0%D7%94%D7%9C%D7%AA-%D7%97%D7%A9%D7%91%D7%95%D7%A0%D7%95%D7%AA
- efraty, VAT reporting — https://www.efraty.com/?p=1245
- Bookkeeping price lists: midrag — https://www.midrag.co.il/Content/Price/22913 ; d.co.il — https://www.d.co.il/priceList-46140/ ; finexpert — https://finexpert.co.il/accounting-price-list.html ; bakertilly — https://bakertilly.co.il/cpa-price-2026
- Drushim AP job ads — https://www.drushim.co.il/jobs/search/%D7%9E%D7%A0%D7%94%D7%9C%20%D7%97%D7%A9%D7%91%D7%95%D7%A0%D7%95%D7%AA%20%D7%A1%D7%A4%D7%A7%D7%99%D7%9D/
- carsforum thread (photos not accepted, ~2017, anecdote) — https://carsforum.co.il/topic/624713-%D7%A9%D7%99%D7%9E%D7%95%D7%A9-%D7%91%D7%97%D7%A9%D7%91%D7%95%D7%A0%D7%99%D7%95%D7%AA-%D7%9E%D7%A1-%D7%91%D7%A6%D7%99%D7%9C%D7%95%D7%9D-%D7%90%D7%95-%D7%A1%D7%A8%D7%99%D7%A7%D7%94/
