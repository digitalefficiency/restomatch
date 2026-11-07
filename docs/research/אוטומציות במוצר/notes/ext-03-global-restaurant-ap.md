# ext-03 · Global restaurant back-office and AP automation (2024–2026): what each player automates, what humans still confirm, and the lessons for RestoMatch

Researched on 2026-11-07. Every "seen" date below is 2026-11-07 unless a different date is given.

**Method and limits.** Direct page fetches to vendor domains (ottimate.com, help.marginedge.com) were blocked by this session's network policy. Every finding comes from WebSearch result extracts of the cited pages. Unblocking those hosts would allow a full-page verification pass. Labels:

- **[V]**: vendor-claimed (own site, help centre or press release)
- **[3P]**: third-party aggregator or review site
- **[C]**: a competitor's site writing about another vendor
- **UNVERIFIED**: not confirmed by any source found

**What this note adds to earlier work.** It extends `docs/research/ניהול חשבוניות ספקים במסעדות/notes/global_restaurant_ap_vendors.md` and `ap_ai_frontier.md`, which already cover feature maps, pricing bands, the copilot/MCP wave and customer complaints. This note does not repeat them. It looks at automation design instead: the **trigger → action** of each automation, the **human checkpoint**, and the **claimed outcome**.

**It corrects one earlier inference.** The earlier note said no shipped tool "acts outward on suppliers". MarginEdge's Vendor Statement Reconciliation does exactly that: it emails vendors to request missing invoices or credits and to dispute discrepancies (§2.4).

---

## 0. Executive summary (for the automation plan)

1. **Nobody publishes an honest touchless rate.** Vendors report **capture accuracy**, not straight-through processing:
   - Ottimate: 99.5% at header level, 95% at line level [V]
   - Choco: up to 97–99% order accuracy, supplier side [V]
   - Factura (a competitor): "90%+ coded without human intervention" [C]

   Time-saved figures are also reported, for example "−80% processing time" and "60s→5s per invoice" [V].

   R365 publishes no accuracy number for Capture AI at all. Every product still routes invoices through a **human review screen**: R365's Draft Transaction screen, MarginEdge's 24–48h human-verified pipeline, meez's ~48h service, Toast Retail's "verify extracted data" step.

   **Lesson:** RestoMatch should measure and publish its *own* metric. A good candidate is "% of invoices that reached `approved` with zero owner edits" plus "₪ caught per minute of owner time". That beats copying a capture-accuracy claim nobody can audit.

2. **The dominant automation pattern is a rules engine with a tolerance band**, sitting in front of an approval queue. Examples:
   - R365 contract-price verification: a variance % applied within the contract dates [V]
   - Ottimate Item Validation: line-level price-variance flagging, then "routing based on variance" [V]
   - MarginEdge price alerts per vendor item [V]
   - MarginEdge payment approval above a threshold, with AutoPay vendors skipping approval [V]

   This is table stakes. RestoMatch's 12-type engine already exceeds it on discrepancy taxonomy.

3. **Outward-facing supplier automation is rare and shallow.**
   - MarginEdge sends statement-reconciliation emails (Bill Pay vendors only, scheduled weekly, bi-weekly or monthly) [V].
   - Edify and Culistock offer one-click credit requests with "remind supplier" and overdue flags [V].

   No player found tracks a claim to **₪ actually recovered** and reports it as the hero number. This remains the clearest leapfrog.

4. **Ordering automation splits two ways.** Restaurant-side tools suggest orders: par levels, usage velocity and forecasts, in MarketMan, R365, BlueCart and Supy [V/3P]. Supplier-side tools ingest orders (Choco AI and OrderAgent, Rekki OrderAI) [V]. Every restaurant-side suggestion still needs a human to press "send". No auto-send was found.

5. **Recipe cost auto-update from invoices is universal.** xtraCHEF, meez, Galley, MarketMan and MarginEdge all re-cost recipes once an invoice line is linked to an ingredient [V/3P]. The value lies in the **link**, meaning item mapping. That is also where every vendor demands setup work: R365 Capture AI "does not create new vendors, items, vendor items… or GL accounts" [V].

6. **Pricing anchors are unchanged since the earlier note.** US AP and back-office tools cost about **$180–$540 per location per month**. Ordering networks are free to restaurants. New data points: xtraCHEF Essentials at $179 per location [3P]; Craftable quote-only, priced per location with unlimited users [3P]; MarketMan has AI Ordering only on its custom-priced Enterprise tier [3P].

---

## 1. Player-by-player: trigger → action, human checkpoint, outcome, lesson

### 1.1 Restaurant365 (R365): accounting-first ERP, US multi-unit

| Automation | Trigger → action | Human still confirms | Source |
|---|---|---|---|
| **AP Capture AI** | Invoice uploaded or scanned → OCR fills Vendor, Location, Invoice #, Total, Payment Terms "based on existing records" | Every invoice lands on the **Draft Transaction screen** for review before entry | [V] [AP Capture AI Overview](https://docs.restaurant365.com/docs/ap-capture-ai) |
| **Credit-memo detection** | Negative invoice total → transaction type switched to credit memo automatically | Reviewer confirms on the draft screen | [V] same |
| **No master-data creation** | Unknown vendor, item or GL account → *not* auto-created; capture quality depends on the setup | Human creates the master data | [V] same |
| **Contract price verification** | Invoice dated inside a contract period, with each-price deviating more than the allowed variance % → violation flag | Human resolves the flag | [V] [Vendor contract price verification](https://docs.restaurant365.com/docs/vendor-contract-price-verification); [Item Price Verification](https://docs.restaurant365.com/docs/item-price-verification) |
| **Price-change analysis** | Report: an item's price at a start date against its average over a range | Manual review | [V] [R365 Daily Operator Guide](https://restaurant365.freshdesk.com/support/solutions/articles/12000068709-daily-operator-guide) |
| **Suggested POs / par alerts** | Item hits par → suggested PO plus alert; par "dynamically" updated from actual usage | Manager sends the PO | [V, marketing blog] [R365 par levels & reorder alerts](https://www.restaurant365.com/blog/how-to-set-up-par-levels-and-reorder-alerts-with-suppliers/) |
| **AI-driven POs from demand** | Listed as a capability; no dated release note found | UNVERIFIED | [V] [R365 AI Info](https://www.restaurant365.com/ai-info/) |

**2026 release cadence on capture.**
- Q1 2026: the vendor item number became editable on draft invoice lines.
- Q2 2026: a "Require location selection on upload" preference for AP Capture AI.
- About 10 Sep 2026: a unified AP Invoice form across Accounting and Inventory.
- 23 Apr 2026: the Food Variance report now uses only the selected beginning and ending counts.

Sources: [V] [R365 Release Notes Q2 2026](https://docs.restaurant365.com/docs/release-notes-quarter-2-2026), [Q3 2026](https://docs.restaurant365.com/docs/release-notes-q3-2026).

**Outcome claims.** R365 publishes no Capture AI accuracy number. The "650 hours/year" figure comes from a single customer testimonial [V] ([R365 webinar page](https://www.restaurant365.com/webinars/recorded-webinars/introducing-capture-ai-the-end-of-restaurant-invoice-ap-inefficiency/)). Factura claims ">90% coded without human intervention" for its own add-on to R365 [C] ([Factura: AP tools for R365 users](https://factura.ai/ap-automation-tools-restaurant365-users/)). That a third-party capture layer sells into the R365 base suggests capture there is not considered "solved" (inference).

**Lesson for RestoMatch**
- **Copy:** an explicit *contract price with validity window* as a matching reference. A price is "wrong" against a dated agreement, not just against last week. Also copy the auto-reclassification of negative totals as credit notes. In Israel, *חשבונית זיכוי* arrive mixed into the same inbox.
- **Avoid:** silently refusing to create master data. For a 1–3 branch owner, the first-invoice experience must *propose* a new supplier and new items with one-tap accept, or the funnel dies at setup.
- **Leapfrog:** R365 flags a violation and stops there. RestoMatch can turn the same flag into a ₪ claim line automatically.

### 1.2 Ottimate (formerly Plate IQ): AI AP platform, multi-unit hospitality

| Automation | Trigger → action | Human still confirms | Source |
|---|---|---|---|
| **AI capture engine** (launched 26 Jun 2025) | Any invoice → header and line items extracted and coded "in seconds"; claimed **99.5% header / 95% line-item** accuracy | Exceptions and approvals | [V] [EIN Presswire via Kalkine, 26 Jun 2025](https://kalkinemedia.com/news/world-news/ottimate-launches-industry-first-ai-engine-built-to-drive-profitability-through-smart-accounts-payable); [Ottimate invoice automation](https://ottimate.com/feature/invoice-automation/) |
| **Line-item GL auto-coding** | Line → GL by learned mapping; "95%+ accuracy at the line-item level" for restaurants | Coding exceptions | [V] [Ottimate restaurants](https://ottimate.com/industry/restaurants/) |
| **Item Validation** | Each line compared with the uploaded item catalog (pack size, SKU, name, UoM, split case) → **price-variance flagging (line-level)** → **routing based on variance** | Variance-routed approver; enabled by Customer Success or support, on the Growth tier | [V] [What is Item Validation?](https://support.ottimate.com/support/solutions/articles/14000157696-what-is-item-validation-) |
| **Rule-based approval routing** | "Any piece of line item data" can drive an approval rule | Approver | [V] [go.ottimate.com AP automation](https://go.ottimate.com/ap-automation/) |
| **Copilot / MCP** (2025–26) | Conversational queries, statement reconciliation, risk-based approvals | Covered in the earlier note | see earlier note |

**Outcome claims (all [V] case studies, none audited).**
- B&G (150 restaurants): 60s → 5s per invoice (−92%). [10minhotel, 14 Apr 2025](https://en.10minhotel.com/2025/04/14/how-bg-food-manages-invoices-for-150-restaurants-with-ottimate)
- Haberdish: −80% processing time. [casestudies.com](https://www.casestudies.com/company/ottimate/case-study/haberdish-customer-case-study)
- An accounting firm: 530+ hours/year saved by line-item GL coding. [plateiq.com J. Ely](https://plateiq.com/customer/j-ely-business-services/)
- A blog headline: "slashing invoice work by 90%". [Ottimate blog](https://ottimate.com/blog/how-growing-restaurant-brands-are-turning-ap-into-a-profit-driver-while-slashing-invoice-work-by-90/)

**No touchless % published.** An Ottimate-commissioned survey of 225 US mid-market finance leaders (Sep 2025) was headlined "only 4% of finance teams fully automate AP" [V/press] ([Chain Store Age](https://chainstoreage.com/survey-only-4-finance-teams-fully-automate-accounts-payable)).

**Pricing:** quote-only. No public figure was found in this pass (see the earlier note for third-party estimates).

**Lesson for RestoMatch**
- **Copy:** split accuracy reporting into **header vs line**. It is honest and it signals where human review is still needed. Also copy routing on variance, so that only the flagged *line*, not the whole invoice, goes to the owner.
- **Avoid:** making the variance feature a hidden, CSM-enabled tier toggle. For RestoMatch the price check *is* the product. It must be on by default.
- **Leapfrog:** Ottimate's ROI language is minutes saved. RestoMatch's North Star is ₪ surfaced. Report both on every invoice: "₪X caught, 0 edits".

### 1.3 MarginEdge: invoice-to-P&L back office, independents to mid-chains

| Automation | Trigger → action | Human still confirms | Source |
|---|---|---|---|
| **Invoice processing** | Photo, email or EDI → ML plus human verification, 24–48h SLA (earlier note); unlimited invoices | MarginEdge staff verify; operator reviews | earlier note |
| **Handwritten-credit capture, "Two Modes"** | *Image-first*: credits come **only from the receiver's handwritten cross-outs on the invoice photo**; vendor EDI credit memos are ignored to avoid duplicates, and digital invoices wait for an image or manual approval. *EDI-first*: vendor digital credits are auto-applied without reconciliation, and handwriting is ignored | Operator chooses the mode once. Only explicit **crossing-out** counts as an adjustment; circles and checkmarks do not | [V] [Two Modes – You Choose](https://help.marginedge.com/hc/en-us/articles/360049355874) |
| **Handwritten vendor-credit process** | Setting: Combined (default; one invoice net of the handwritten adjustments), Separate, or Skipped (forced to Skipped in EDI-first) | Configured once | [V] same cluster of help articles |
| **Price alerts** | Price on a *vendor item* (not a product) crosses the alert rule → email. Configured under Performance > Price Alerts. Notification setting "Cost Monitoring Alerts" also covers **recipe plate-cost alerts**. Multi-unit users need access to all units to create one | Owner reads the email and acts | [V] [MarginEdge help: price alerts](https://help.marginedge.com/hc/en-us/articles/360055115673) |
| **Vendor Statement Reconciliation** | Scheduled weekly, bi-weekly or monthly per vendor → statement compared with invoices in MarginEdge → **owner emailed about issues** → MarginEdge **emails the vendor's reconciliation contact to request statements, missing invoices or credits, or to dispute discrepancies** | Prerequisites: Bill Pay vendor and ≥2 months of invoice history. The owner sets the contact and cadence | [V] [Vendor Statement Reconciliation Tool](https://help.marginedge.com/hc/en-us/articles/23635825774611-Vendor-Statement-Reconciliation-Tool); [Settings](https://help.marginedge.com/hc/en-us/articles/23636630497811-Vendor-Statement-Reconciliation-Settings); [landing page](https://www.marginedge.com/lp/statement-reconciliation) |
| **Bill Pay: Payment Approval** | Opt-in (the controller or CFO asks support). Approval required on all payments or above a minimum threshold | Approver | [V] [Bill Pay Payment Approval Feature](https://help.marginedge.com/hc/en-us/articles/360038782534-Bill-Pay-Payment-Approval-Feature) |
| **Bill Pay: AutoPay** | Vendor flagged AutoPay → invoices paid automatically and **skip Payment Approval**. So only approvers may set AutoPay. Not available with Company Bill Pay; Pay by Card cannot use approval or AutoPay (FAQ updated 19 May 2026) | Approver sets it once per vendor | [V] [AutoPay](https://help.marginedge.com/hc/en-us/articles/6379391342227-AutoPay-with-me-Bill-Pay); [Pay by Card FAQ](https://help.marginedge.com/hc/en-us/articles/30587524726803-Pay-by-Card-for-me-Bill-Pay-FAQs) |
| **H1 2026 release** (blog dated 7 Jul 2026) | SmartPrep (forecast → daily prep plan); QR labels scannable in Take Inventory; **Tom 2.0** with live invoice, vendor, sales, spend and product data; [me] Card corporate purchasing card with spending limits and approvals; invoice-workflow changes; new public APIs | — | [V] [H1 2026 release notes](https://www.marginedge.com/blog/h1-2026-product-release-notes?hs_amp=true); [What's new in 2026](https://www.marginedge.com/blog/smarter-operations-stronger-margins-a-look-at-whats-new-at-marginedge-in-2026) |
| **Forecasting** | Sales forecast from POS, ordering, labour and seasonality; "within 4% of actual" on average | — | [press] [Verdict Foodservice](https://www.verdictfoodservice.com/newsletters/marginedge-series-d-round) |

**Scale and price.**
- More than 13,000 restaurants; $80M Series D (Aug 2026). [Verdict](https://www.verdictfoodservice.com/newsletters/marginedge-series-d-round); [SaaSRise](https://www.saasrise.com/deals/marginedge-raises-80-million-as-competition-for-the-ai-powered-restaurant-back-office-intensifies-d944cdaa-088f-47e4-9969-f4713bf8f1d6)
- $350 per location per month; Freepour bundle $500. [3P] [PricingSaaS](https://pricingsaas.com/companies/marginedge)
- Statement reconciliation is listed as free in the base subscription. [3P] [GetApp](https://www.getapp.com/restaurant-management-software/a/marginedge)

**Lesson for RestoMatch**
- **Copy, highest value: the "handwriting on the delivery note is the credit" model.** In Israel the driver's *תעודת משלוח* is signed at the back door, and short or damaged items are crossed out by hand. MarginEdge has turned that physical gesture into a machine-readable credit rule ("only crossing-out counts"). RestoMatch's signed-GR photo fallback in `packages/ocr` should adopt the same explicit, teachable rule and show it to receivers.
- **Copy: one-time mode choice to prevent double credits** (receiver's handwriting vs supplier's credit note). RestoMatch's `credit_notes` uniqueness rule is the data-layer form of the same idea. The UX should make the source of truth explicit per supplier.
- **Copy: AutoPay *bypasses* approval, so only approvers can grant it.** This is a clean permission rule that matches RestoMatch's PR-only, human-gated ethos for payments.
- **Leapfrog: statement reconciliation as an outward agent.** MarginEdge emails the vendor, but only for Bill Pay vendors and only on a schedule. RestoMatch can run it event-driven (on claim, on overdue at 7 days) over WhatsApp or email to the supplier contacts it already stores. Its stored `contact_email` / `contact_whatsapp` are unused by the claims flow today (`int-04`).

### 1.4 xtraCHEF by Toast (and Toast IQ Inventory / Toast Retail AI invoice scanning)

| Automation | Trigger → action | Human still confirms | Source |
|---|---|---|---|
| **Multi-channel capture** | Scan, email, EDI, or mobile photo → line-item split | Review | [V] [Toast: restaurant invoice processing](https://pos.toasttab.com/products/restaurant-invoice-processing); [Toast–xtraCHEF integration](https://pos.toasttab.com/integrations/xtrachef) |
| **Learned GL coding** | GL code assigned once to an item → future occurrences auto-coded | First assignment is manual | [V] same |
| **Price alerts** | Configurable alerts for "outsized fluctuations, vendor errors, or contract pricing variances" | Owner acts | [V] [Toast partner directory: xtraCHEF](https://pos.toasttab.com/zh-us/partners/directory/xtrachef) |
| **Recipe re-costing** | Each processed invoice refreshes price → recipe costs update automatically; Toast menu items and modifiers map to recipes for theoretical usage and **par order quantities** | Mapping is manual | [V] same |
| **Toast Retail AI invoice scanning** (8 Jan 2026, early release, later beta) | Upload via web or mobile → AI extraction → "verify extracted data, match items, update inventory". **Cannot apply scanned invoices to POs** at this time. Claims to "catch cost changes before products reach the shelf" | Verify plus match | [V] [Business Wire, 8 Jan 2026](https://www.businesswire.com/news/home/20260108083521/en/Toast-Delivers-Precision-Insights-Action-and-Efficiency-for-Retailers/); [Toast support: Get Started With AI Invoice Scanning](https://support.toasttab.com/en/article/Get-Started-With-AI-Invoice-Scanning) |

**Scope limits.**
- xtraCHEF is US-only. [V] [Toast support](https://support.toasttab.com/es-US/article/xtraCHEF-by-Toast)
- Third-party reviews note limited multi-level recipe support. [3P] [fitgap](https://us.fitgap.com/products/xtrachef)
- No credit-request or short-delivery workflow was found in Toast's xtraCHEF help content. **UNVERIFIED** whether one exists.
- Toast IQ Inventory roadmap (Jul–Sep 2026 phases, beta limited to 100 customers) comes from a site whose official status is **UNVERIFIED**. [toast-inventory.com](https://toast-inventory.com/)

**Price:** xtraCHEF Essentials at $179 per location [3P] ([Toolradar guide](https://toolradar.com/guides/best-accounts-payable-software-for-restaurants)). The earlier note has estimates of $149–$349.

**Lesson for RestoMatch**
- **Copy:** "assign once, auto-code forever" for item → category or GL mapping, with the first assignment proposed rather than blank.
- **Avoid:** shipping capture without PO or delivery-note matching. That is Toast Retail's gap, and RestoMatch already has the 3-way.
- **Leapfrog:** Toast's AI effort in 2026 went to marketing and labour agents (earlier note). Invoice control in the POS-bundled world stays a "verify extracted data" chore.

### 1.5 MarketMan: inventory and purchasing for independents

| Automation | Trigger → action | Human still confirms | Source |
|---|---|---|---|
| **Par-based POs** | Inventory below par → automated PO suggestion | Manager sends | [3P] [fitgap](https://us.fitgap.com/products/marketman); [GetApp](https://www.getapp.com/restaurant-software/a/marketman) |
| **AI Ordering** | Historical usage plus vendor data → recommended quantities. **Listed only on the custom-priced Enterprise tier**, alongside Order by Recipe and Open API | Manager sends | [3P] [GetApp](https://www.getapp.com/restaurant-software/a/marketman) |
| **Price tracking and alerts / vendor price comparison** | Invoice price change → alert; price trends across suppliers | Owner acts | [3P] [Softabase: MarketMan vs BlueCart](https://softabase.com/compare/marketman-vs-bluecart) |
| **Invoice OCR (mobile)** | Photo → automated price update. Plans cap scans (20/month on one tier, 300/month on another, per one listing) | Review | [3P] [Techraisal](https://www.techraisal.com/software/marketman); [SaaSworthy](https://www.saasworthy.com/product/marketman) |

**Contradictions.** One comparison says MarketMan has "no POS integration for automated ordering… all ordering decisions are manual" [3P, Softabase], which conflicts with the AI Ordering listing. A 2026 pricing-change tracker reports Starter and Growth price hikes plus tiered API and kitchen add-on fees (week 34 of 2026); the details are **UNVERIFIED** [3P] ([PricingSaaS diff](https://pricingsaas.com/companies/marketman/diffs/2026W34)). No MarketMan credit-request workflow was found.

**Lesson for RestoMatch**
- **Avoid:** scan caps per tier. The North Star needs *every* invoice in. A capped plan guarantees missing leak data, and the earlier note's review quote ("scanning did not work 50% of the time") shows the trust damage this causes.
- **Avoid:** gating smart ordering behind Enterprise. If RestoMatch ever ships suggested orders, it should be in-plan and secondary to the leak.

### 1.6 Craftable: hospitality procure-to-pay

| Automation | Trigger → action | Human still confirms | Source |
|---|---|---|---|
| **Invoice AI** (showcased at HITEC, Jun 2026) | Invoice → "hospitality-specific recognition" extraction | Review | [V] [Craftable newsroom, HITEC 2026](https://craftable.com/news-room/craftable-to-showcase-ai-powered-back-office-and-procure-to-pay-platform-at-hitec-2026) |
| **Line-level 3-way match** | Invoice vs PO vs delivery receipt, line by line → mismatch "flagged before payment, not after"; rules customisable by department or location | Approver clears flags before payment | [V] [Craftable AP automation](https://craftable.com/ap-automation) |
| **Approval routing** | AI scan → PO match → automated approval routing | Approver | [3P] [Supergood: Craftable API](https://supergood.ai/docs/craftable-api) |

**Price:** custom quote per location with unlimited users; modules (ordering, inventory, AP, analytics) can be licensed separately [3P] ([Gappsy](https://gappsy.com/tools/craftable/); [Capterra UK](https://www.capterra.co.uk/software/200434/craftable)). The aggregators' "$99" figures conflict and are **UNVERIFIED**.

**Comparable launch:** BirchStreet Smart AP (Feb 2026) does line-level PO/receiving/invoice matching with header- and line-level exceptions, for hotels [V] ([BirchStreet](https://birchstreetsystems.com/news/birchstreet-unveils-ai-powered-smart-ap-solution)).

**Lesson for RestoMatch**
- **Copy:** the *positioning line* "flagged before payment, not after". It is the cleanest articulation of the approval gate, and RestoMatch's `approvals/engine.ts` (rules that block before payment) does the same.
- **Leapfrog:** Craftable stops at "flag". There is no credit-memo or claims workflow in any source found.

### 1.7 Apicbase: EU (Benelux-heavy) back-of-house

| Automation | Trigger → action | Human | Source |
|---|---|---|---|
| **Invoice matching** | Each supplier invoice vs PO and delivery record → **only exceptions routed for review** | Exception reviewer | [V] [Apicbase invoice-matching page](https://get.apicbase.com/invoice-matching-software/) |
| **Automatic food-cost / margin / allergen calculation** per recipe, menu and location | Recipe change → recompute | — | [V] [Hospitality Net product page](https://www.hospitalitynet.org/product/5000185.html) |
| **Supplier integrations** (e.g. Bidfood NL); paid API add-on | — | — | [3P] [elioplus](https://elioplus.com/markdown/profiles/vendors/51160/apicbase) |

**Gaps:** no 2025–26 release notes found. Whether invoice prices auto-flow into recipe costs is **UNVERIFIED** in this pass. Monthly billing carries a +15% surcharge over annual [3P].

**Lesson for RestoMatch:** "exceptions-only review" is the right default UX. The owner sees only what deviates, and that matches RestoMatch's T2 "act-now" tier.

### 1.8 Choco: free ordering network; AI sold to distributors

| Automation | Trigger → action | Human | Source |
|---|---|---|---|
| **Restaurant app** (free) | Order once in the app → converted into each supplier's preferred format: email, WhatsApp, SMS, fax or ERP | Restaurant composes the order | [V] [choco.com/restaurants](https://choco.com/uk/restaurants) |
| **Choco AI / OrderAgent** (supplier side; launched Jan 2024) | Voicemail, email, WhatsApp, text, photo or call orders → parsed into the supplier's ERP 24/7. Claims "up to 97%" (one page) and "up to 99%" (another) order accuracy. Case: 96% within 3 weeks, manual work 40h → 4h | Supplier's order desk confirms | [V] [Choco AI launch](https://choco.com/uk/stories/suppliers/choco-ai); [OrderAgent](https://choco.com/uk/orderagent); [SDCExec](https://www.sdcexec.com/home/news/22879816/choco-ai-solution-to-streamline-order-management-in-foodservice) |
| **Scale** | 1M+ orders a month processed; onboarding in about 2 weeks for suppliers and under 24h for restaurants | — | [V] same |

No restaurant-side invoice-control feature was found for Choco (**UNVERIFIED**; the App Store text only frames "endless sheets of invoices" as the problem).

**Lesson for RestoMatch.** Israeli suppliers take orders over WhatsApp and phone, the same unstructured channels Choco monetises on the supplier side.
- **Copy:** "order once → fan out in each supplier's channel" for RestoMatch's order module.
- **Leapfrog:** close the loop Choco leaves open. The *order* RestoMatch sends becomes the PO side of the 3-way match automatically, so a free-ordering habit feeds the leak engine.

### 1.9 BlueCart: ordering marketplace plus restaurant tools

| Automation | Trigger → action | Human | Source |
|---|---|---|---|
| **Invoice OCR** | Image or PDF → item, qty, pack size, unit price, totals; BlueCart says the extraction is **powered by Claude** | Review | [V] [BlueCart: Claude AI invoice processing](https://bluecart.com/blog/restaurant-invoice-processing); [Invoice OCR](https://www.bluecart.com/blog/invoice-ocr) |
| **PO ↔ invoice match** | Invoice matched to its PO, one record from order to payment; "no manual reconciliation" claimed, with no discrepancy-handling detail | UNVERIFIED | [V] [BlueCart PO management](https://www.bluecart.com/purchase-order-management-software) |
| **Predictive ordering / par reorders / recurring orders** | Depletion rate, inventory, seasonality, events and vendor lead times → suggested order; par hit → reorder | Buyer confirms | [V] [Predictive ordering](https://www.bluecart.com/blog/predictive-ordering-for-restaurants) |
| **Menu benchmarking** (15 Apr 2025) | Item profitability compared with "125,000 peers" | — | [V] [AI Journal press release](https://aijourn.com/bluecart-unveils-predictive-inventory-menu-profitability-benchmarking-and-vendor-payment-tools-to-drive-the-future-of-restaurant-profitability/) |
| **Vendor fee pass-through / BlueCart Pay** | Vendor passes processing fees on to the buyer | — | [V] same |

**Price:** free to restaurants (earlier note).

**Lesson for RestoMatch.** A general-purpose LLM (Claude) is already the extraction engine for a US competitor. Raw extraction is therefore not a moat. The moat is Hebrew-specific normalisation (units, catch-weight, VAT) plus the discrepancy taxonomy and the recovery loop. **Avoid** "vendor fee pass-through": it puts the tool on the supplier's side of the table and breaks the "owner believes the number" trust.

### 1.10 Galley and meez: recipe-first platforms

- **Galley Assist** (GA 10 Jun 2025) is the "first domain-specific LLM for foodservice". PDF, photo or file → costed, allergen-tagged recipe; claims "75%+" less recipe data entry. Vendor items map to ingredients, and recipes **re-cost on live vendor pricing**. Galley says 6,000+ kitchens use it. [V] [NatLawReview press release](https://natlawreview.com/press-releases/galley-solutions-unveils-galley-assist-first-domain-specific-llm-built); [Galley recipes & costing](https://www.galleysolutions.com/recipe-food-costing-software-for-foodservice)
- **meez invoice processing** is a *service*, not self-serve. It is available on the Scale plan by emailing support. Invoices are submitted by dashboard or email, take **about 48h** to process, and once a line is linked to an ingredient its cost **automatically updates** the recipe and food-cost %. The purchase dashboard shows item price changes over time. [V] [meez help: Invoice processing service](https://intercom.help/getmeez/en/articles/5725098-invoice-processing-service); [meez costing FAQ](https://intercom.help/getmeez/en/articles/6270593-costing-faq). GetApp says price changes are "flagged immediately" on processing [3P].

**Lesson for RestoMatch.** **Copy** the LLM recipe importer (photo of a handwritten recipe → costed recipe). It cuts the biggest setup cost for the food-cost layer. **Avoid** a 48h human turnaround for the leak alert. The leak must be in front of the owner while the driver is still at the door, or at least the same day.

---

## 2. Cross-cutting automation patterns (design view)

### 2.1 Capture → review: the universal human checkpoint
Every product keeps a review step:
- R365: Draft Transaction screen
- Toast Retail: "verify extracted data, match items"
- MarginEdge and meez: human-verified service, 24–48h
- Ottimate: exceptions routed

No product claims zero-review straight-through processing for restaurants with public numbers.

**Design implication.** RestoMatch should earn auto-approval *per supplier*. After N consecutive invoices with zero edits and zero discrepancies from supplier S, offer "auto-approve S below ₪X with no discrepancy". This is the AutoPay pattern from §1.3, applied to approval rather than payment. It always requires an owner opt-in, and it stays revocable.

### 2.2 The reference price is the product
Reference prices observed:
- R365: contract price plus validity window plus variance %
- Ottimate: uploaded item catalog plus line-level variance
- MarginEdge: per-vendor-item alert rule
- xtraCHEF: "contract pricing variances"
- Compeat (comparable): variance % against the *previous purchase price*, with an optional price lock [V] ([Compeat Set Cost Variance](https://cloud.compeat.com/CompeatBackOffice/Help/Inventory/Set_Cost_Variance.htm))

Third-party AP vendors suggest restaurant tolerance bands of about ±1–5% generally and up to ±20% for produce [3P/V-blog] ([Peakflo](https://peakflo.co/blog/po-invoice-matching-fresh-produce-fnb)).

**Implication.** Support three reference sources in priority order: agreed price (with dates) → last accepted price → category band. Show the owner *which* reference fired. Tolerances must be category-aware: fresh produce in Israel moves weekly.

### 2.3 Credits: two physical origins
- **At the door:** the receiver's handwritten cross-out or short count. Examples: MarginEdge image-first mode, Supy's "edit the goods-received record", Culistock's photo-evidenced one-click credit request. [V] [Supy credit-note vs GRN guide](https://supy.io/blog/learn-credit-note-vs-grn-supplier-discrepancy-guide); [Culistock supplier management](https://culistock.com/use-cases/restaurant-supplier-management)
- **After invoice:** an overcharge found in matching, which needs a credit note from the supplier. Edify lets the user raise a credit request per PO line, then "Remind supplier", or cancel it if replacements arrive. [V] [Edify: raising credit requests](https://intercom.help/edify-systems/en/articles/15516766-raising-credit-requests)

Jelly (UK) recommends **holding the invoice** until the corrected invoice or credit note arrives [V] ([Jelly](https://blog.getjelly.co.uk/automate-invoice-approval-restaurants/)). Vellum shows an LLM assistant drafting a credit-memo email to the sales rep for price creep [V-blog] ([Vellum](https://www.vellum.ai/blog/how-to-catch-restaurant-vendor-price-creep)).

**Implication.** RestoMatch's lifecycle (`claimed → letter_sent → acknowledged → credited → recovered`) is already richer than anything shipped by the big US players. The missing pieces are the outward channel (send and remind over WhatsApp or email) and "hold payment until credited". Both are human-confirmed sends, consistent with the no-auto-send rule.

### 2.4 Outward agents (correction to the earlier note)
MarginEdge's statement reconciliation is an operating example of software that emails suppliers on the restaurant's behalf: it requests statements and missing invoices or credits, and disputes discrepancies. The limits are Bill Pay vendors only, a schedule, and email only [V]. Choco and Rekki automate the *supplier's* inbound side.

**Still unfilled:** a claim → send → remind → credit-note match → ₪ recovered loop, measured in money. This is RestoMatch's leapfrog lane.

### 2.5 Ordering: suggest, never send
Par-based or forecast-based suggestions appear in R365, MarketMan (Enterprise), BlueCart, xtraCHEF (par order quantities) and MarginEdge (SmartPrep is prep, not ordering). Every case found leaves the send to a human. The supplier-side Choco and Rekki agents prove that unstructured WhatsApp or voice orders can be parsed at 96–99% claimed accuracy [V].

### 2.6 Payments: approval thresholds, AutoPay bypass, cards
- MarginEdge: threshold approval, AutoPay bypass and [me] Card spending limits [V]
- R365: check, ACH or virtual card (earlier note)

These are US rails. For Israel, payment stays human per AGENTS.md. Only the pattern ("AutoPay is an approver-only privilege") transfers.

---

## 3. Comparison table: touchless and accuracy claims, and price

| Player | Published automation metric | Type of metric | Human step | Price (public or estimated) |
|---|---|---|---|---|
| Ottimate | 99.5% header / 95% line-item accuracy; −80% to −92% processing time | Capture accuracy, time [V] | Exceptions, approvals | Quote only |
| R365 | None for Capture AI; "650 h/yr" single testimonial | Anecdote [V] | Draft Transaction review on every invoice | about $469–$539/loc/mo (earlier note, [C]) |
| MarginEdge | 24–48h SLA; forecast within 4% | Turnaround [V] | Human-verified service | $350/loc/mo [3P] |
| xtraCHEF | None found | — | Review, mapping | $179/loc Essentials [3P]; $149–$349 (earlier) |
| MarketMan | None; scan caps by tier | — | Review | $199–$249+ [3P]; AI Ordering Enterprise-only |
| Craftable | None found | — | Pre-payment flags | Custom quote per location |
| Apicbase | None found | — | Exceptions | €/$249 from (earlier) |
| Choco (supplier) | Up to 97–99% order accuracy; 40h→4h | Order-parse accuracy [V] | Supplier desk | Free for restaurants |
| BlueCart | "No manual reconciliation" | Marketing [V] | Unclear | Free for restaurants |
| meez | about 48h processing | Turnaround [V] | Service team | $179 Premium (earlier) / Scale plan |
| Galley | 75%+ less recipe entry | Setup time [V] | Review | about $300 from (earlier, [3P]) |
| Factura (R365 add-on) | ">90% coded without human intervention" | Touchless-ish [C] | Exceptions | — |

**No independent audit of any figure was found.** An industry-wide survey commissioned by Ottimate found only 4% of mid-market finance teams "fully automate" AP [V/press].

---

## 4. Lessons for RestoMatch: copy / avoid / leapfrog (consolidated)

**Copy**
1. MarginEdge's **handwriting-is-the-credit** rule (only cross-outs count) for the signed delivery-note photo, plus a per-supplier "source of truth" toggle to prevent double credits.
2. R365's **contract price with validity window** as a matching reference; auto-classify negative totals as credit notes.
3. Ottimate's **line-level variance routing** and **header vs line accuracy** reporting.
4. xtraCHEF's **assign once, auto-code forever** item mapping, with the first assignment *proposed*.
5. Apicbase and Craftable's **exceptions-only review** and the "flagged before payment, not after" message.
6. Choco's **order once → fan out per supplier channel**, so the order becomes the PO side of the match.
7. MarginEdge's **AutoPay-bypasses-approval, so approver-only** permission rule, reused for per-supplier auto-approve.

**Avoid**
1. Scan caps and tier-gated core checks (MarketMan, Ottimate Item Validation via CSM).
2. Refusing to create master data on first sight (R365 Capture AI).
3. A 24–48h human turnaround for the leak alert (MarginEdge, meez).
4. Supplier-favouring monetisation (BlueCart fee pass-through).
5. Unauditable "99% accuracy" claims as the headline metric.

**Leapfrog**
1. **The recovery agent.** Discrepancy → claim → human-approved WhatsApp or email letter to the stored supplier contact → automatic reminder at day 7 (overdue) → credit-note matched to the claim → ₪ recovered shown as T3 good news. Nobody ships this end to end. MarginEdge's statement emails are the closest, and they are Bill Pay-only and schedule-driven.
2. **₪-first metrics.** "₪ caught / ₪ recovered / owner minutes" per invoice and per month, instead of touchless % or accuracy.
3. **Earned per-supplier auto-approve,** based on a clean-history streak, opt-in and revocable.
4. **Same-day leak at the door.** Mobile receiving plus signed-note photo → discrepancy before the driver leaves, against a 24–48h service SLA.
5. **Hebrew and Israel specifics** (RTL, catch-weight, 17% VAT, חשבונית ריכוז) that no global player supports (earlier note).

---

## 5. Gaps and UNVERIFIED items
- Ottimate's actual touchless %: not published.
- R365 Capture AI accuracy, and whether "AI-driven POs" has shipped: not found.
- xtraCHEF credit or short-delivery workflow; whether Toast IQ Inventory succeeds xtraCHEF: **UNVERIFIED**.
- MarketMan's 2026 price changes and the existence of a credit-request feature: **UNVERIFIED**.
- Craftable and Ottimate per-location prices: quote-only.
- Apicbase auto-flow of invoice prices into recipes: **UNVERIFIED** in this pass.
- Choco restaurant-side invoice features: none found.
- Full-page reads of ottimate.com and help.marginedge.com were blocked by the session network policy. The claims above rely on search extracts.

---

## Sources (all seen 2026-11-07)

**Restaurant365**
- https://docs.restaurant365.com/docs/ap-capture-ai
- https://docs.restaurant365.com/docs/vendor-contract-price-verification
- https://docs.restaurant365.com/docs/item-price-verification
- https://docs.restaurant365.com/docs/release-notes-quarter-2-2026
- https://docs.restaurant365.com/docs/release-notes-q3-2026
- https://restaurant365.freshdesk.com/support/solutions/articles/12000068709-daily-operator-guide
- https://www.restaurant365.com/blog/how-to-set-up-par-levels-and-reorder-alerts-with-suppliers/
- https://www.restaurant365.com/ai-info/
- https://www.restaurant365.com/webinars/recorded-webinars/introducing-capture-ai-the-end-of-restaurant-invoice-ap-inefficiency/
- https://factura.ai/ap-automation-tools-restaurant365-users/

**Ottimate**
- https://kalkinemedia.com/news/world-news/ottimate-launches-industry-first-ai-engine-built-to-drive-profitability-through-smart-accounts-payable
- https://ottimate.com/feature/invoice-automation/
- https://ottimate.com/industry/restaurants/
- https://support.ottimate.com/support/solutions/articles/14000157696-what-is-item-validation-
- https://go.ottimate.com/ap-automation/
- https://en.10minhotel.com/2025/04/14/how-bg-food-manages-invoices-for-150-restaurants-with-ottimate
- https://www.casestudies.com/company/ottimate/case-study/haberdish-customer-case-study
- https://plateiq.com/customer/j-ely-business-services/
- https://ottimate.com/blog/how-growing-restaurant-brands-are-turning-ap-into-a-profit-driver-while-slashing-invoice-work-by-90/
- https://chainstoreage.com/survey-only-4-finance-teams-fully-automate-accounts-payable

**MarginEdge**
- https://help.marginedge.com/hc/en-us/articles/360049355874
- https://help.marginedge.com/hc/en-us/articles/360055115673
- https://help.marginedge.com/hc/en-us/articles/23635825774611-Vendor-Statement-Reconciliation-Tool
- https://help.marginedge.com/hc/en-us/articles/23636630497811-Vendor-Statement-Reconciliation-Settings
- https://www.marginedge.com/lp/statement-reconciliation
- https://help.marginedge.com/hc/en-us/articles/360038782534-Bill-Pay-Payment-Approval-Feature
- https://help.marginedge.com/hc/en-us/articles/6379391342227-AutoPay-with-me-Bill-Pay
- https://help.marginedge.com/hc/en-us/articles/30587524726803-Pay-by-Card-for-me-Bill-Pay-FAQs
- https://www.marginedge.com/blog/h1-2026-product-release-notes?hs_amp=true
- https://www.marginedge.com/blog/smarter-operations-stronger-margins-a-look-at-whats-new-at-marginedge-in-2026
- https://www.verdictfoodservice.com/newsletters/marginedge-series-d-round
- https://www.saasrise.com/deals/marginedge-raises-80-million-as-competition-for-the-ai-powered-restaurant-back-office-intensifies-d944cdaa-088f-47e4-9969-f4713bf8f1d6
- https://pricingsaas.com/companies/marginedge
- https://www.getapp.com/restaurant-management-software/a/marginedge

**Toast / xtraCHEF**
- https://pos.toasttab.com/products/restaurant-invoice-processing
- https://pos.toasttab.com/integrations/xtrachef
- https://pos.toasttab.com/zh-us/partners/directory/xtrachef
- https://www.businesswire.com/news/home/20260108083521/en/Toast-Delivers-Precision-Insights-Action-and-Efficiency-for-Retailers/
- https://support.toasttab.com/en/article/Get-Started-With-AI-Invoice-Scanning
- https://support.toasttab.com/es-US/article/xtraCHEF-by-Toast
- https://us.fitgap.com/products/xtrachef
- https://toast-inventory.com/
- https://toolradar.com/guides/best-accounts-payable-software-for-restaurants

**MarketMan**
- https://www.getapp.com/restaurant-software/a/marketman
- https://us.fitgap.com/products/marketman
- https://softabase.com/compare/marketman-vs-bluecart
- https://www.techraisal.com/software/marketman
- https://www.saasworthy.com/product/marketman
- https://pricingsaas.com/companies/marketman/diffs/2026W34

**Craftable and BirchStreet**
- https://craftable.com/news-room/craftable-to-showcase-ai-powered-back-office-and-procure-to-pay-platform-at-hitec-2026
- https://craftable.com/ap-automation
- https://supergood.ai/docs/craftable-api
- https://gappsy.com/tools/craftable/
- https://www.capterra.co.uk/software/200434/craftable
- https://birchstreetsystems.com/news/birchstreet-unveils-ai-powered-smart-ap-solution

**Apicbase**
- https://get.apicbase.com/invoice-matching-software/
- https://www.hospitalitynet.org/product/5000185.html
- https://elioplus.com/markdown/profiles/vendors/51160/apicbase

**Choco**
- https://choco.com/uk/restaurants
- https://choco.com/uk/stories/suppliers/choco-ai
- https://choco.com/uk/orderagent
- https://www.sdcexec.com/home/news/22879816/choco-ai-solution-to-streamline-order-management-in-foodservice

**BlueCart**
- https://bluecart.com/blog/restaurant-invoice-processing
- https://www.bluecart.com/blog/invoice-ocr
- https://www.bluecart.com/purchase-order-management-software
- https://www.bluecart.com/blog/predictive-ordering-for-restaurants
- https://aijourn.com/bluecart-unveils-predictive-inventory-menu-profitability-benchmarking-and-vendor-payment-tools-to-drive-the-future-of-restaurant-profitability/

**Galley and meez**
- https://natlawreview.com/press-releases/galley-solutions-unveils-galley-assist-first-domain-specific-llm-built
- https://www.galleysolutions.com/recipe-food-costing-software-for-foodservice
- https://intercom.help/getmeez/en/articles/5725098-invoice-processing-service
- https://intercom.help/getmeez/en/articles/6270593-costing-faq

**Patterns and comparables**
- https://cloud.compeat.com/CompeatBackOffice/Help/Inventory/Set_Cost_Variance.htm
- https://peakflo.co/blog/po-invoice-matching-fresh-produce-fnb
- https://supy.io/blog/learn-credit-note-vs-grn-supplier-discrepancy-guide
- https://culistock.com/use-cases/restaurant-supplier-management
- https://intercom.help/edify-systems/en/articles/15516766-raising-credit-requests
- https://blog.getjelly.co.uk/automate-invoice-approval-restaurants/
- https://www.vellum.ai/blog/how-to-catch-restaurant-vendor-price-creep
