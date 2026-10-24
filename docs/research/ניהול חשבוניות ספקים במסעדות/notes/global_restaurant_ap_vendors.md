# Global restaurant back-office / AP software market (as of Oct 2026): what the leaders actually deliver

Method note: direct page fetches (WebFetch and curl) to the vendor domains were refused by this session's egress proxy. All findings below come from WebSearch result extracts of the cited pages, not full-page reads. Where a search extract grouped several URLs without saying which one a claim came from, both URLs are cited and the ambiguity is flagged. Labels: **[vendor]** = vendor-claimed (own site or press release); **[3P-review]** = third-party review or affiliate site (often a competitor, noted where so); **[user]** = end-user review (G2/Capterra/BBB); **[press]** = trade or financial press reporting the vendor's release. Nothing below was independently tested.

## 1. Feature-by-feature: what each product does across the procure-to-pay chain, and processing time / accuracy claims

### Takeaway
The market splits into four types. (a) AP-first finance platforms: Restaurant365, Ottimate, Craftable. (b) Invoice-to-food-cost back offices: MarginEdge, xtraCHEF, MarketMan, Supy, Apicbase, Orderly, meez. (c) Free ordering networks that make money from distributors: Choco, Rekki, BlueCart. (d) Recipe and culinary-ops platforms: Galley, meez. Only the AP-first group plus MarginEdge, Supy and Apicbase show line-item capture, PO/receiving matching and payment together. MarginEdge is the only one with a documented processing SLA, 24-48h, using machine learning plus human review.

### Cited Findings

**Restaurant365 (R365): US multi-unit, accounting-centric ERP**
- AP workflow covers invoice capture, approval, PO matching, payment by check, ACH or virtual card, and posting to the general ledger. **[vendor]** — [R365 AP comparison](https://www.restaurant365.com/blog/top-accounts-payable-automation-software-comparison/)
- Uses "AI-powered invoice capture and validation" to reduce manual entry. **[vendor]** — [R365 AP page](https://www.restaurant365.com/accounts-payable-for-restaurants/)
- Promotes "AI-driven approval workflows." **[vendor]** — [R365 blog, 2026 AP tools](https://www.restaurant365.com/blog/10-must-have-ap-automation-tools-for-restaurants-in-2026/)
- Restaurant-specific GL, bank reconciliation, financial reporting and multi-entity intercompany accounting. **[vendor]** — [R365 AI info](https://www.restaurant365.com/ai-info/)
- Has vendor-reconciliation reporting in its support docs. **[vendor]** — [R365 support: Vendor Reconciliation Detail](https://restaurant365.freshdesk.com/support/solutions/articles/12000060763-vendor-reconciliation-detail)
- R365 claims a 75% cut in close-cycle time and 90% fewer manual AP entries, as cited by a competitor. **[vendor, relayed by competitor]** — [Factura.ai R365 review](https://factura.ai/restaurant365-review/)
- R365 AI (May 2026) connects accounting, inventory, labor, scheduling and POS data. **[press]** — [Dealroom](https://app.dealroom.co/news/feed/restaurant365-launches-ai-engine-built-on-full-p-l-data-to-automate-decisions-and-cut-labour-costs-by-15)

**MarginEdge: US independents to mid-size groups, invoice-to-P&L back office**
- Invoices are digitized "within 24 to 48 hours using a unique combination of machine learning and humans." Another review lists "~24-hour line-item turnaround." **[3P-review]** — [FitSmallBusiness](https://fitsmallbusiness.com/marginedge-review/); [restaurantinventorymanagementsoftware.com](https://restaurantinventorymanagementsoftware.com/solutions/marginedge). The extract did not say which review gave which figure.
- MarginEdge says it is "the only invoice processing platform combining advanced technology with human review to ensure handwritten adjustments are captured." **[vendor]** — [MarginEdge](https://www.marginedge.com/)
- An independent review says humans review AI-extracted data before it reaches the books. Another says users "occasionally need to clean up OCR errors yourself." **[3P-review]** — [FitSmallBusiness](https://fitsmallbusiness.com/marginedge-review/); [backofhouse.io](https://backofhouse.io/vendors/marginedge). The extract did not say which source made which claim.
- AI captures line items from photo or emailed uploads. **[3P-review]** — [Tools for Humans](https://www.toolsforhumans.ai/ai-tools/marginedge)
- The vendor statement reconciliation tool compares uploaded statements with recorded invoices. It flags "credit found" (on the statement but not recorded), "credit missing from statement" (for example a handwritten adjustment), and total mismatches. **[vendor]** — [MarginEdge help: Vendor Statement Reconciliation Tool](https://help.marginedge.com/hc/en-us/articles/23635825774611-Vendor-Statement-Reconciliation-Tool); [MarginEdge vendor reconciliation](https://www.marginedge.com/vendor-reconciliation)
- 2026 work includes invoice approval, creation and adjustment improvements, plus new EDI integrations with Shamrock and Allen Brothers. The H1 2026 notes list only "behind-the-scenes" invoice-handling improvements. **[vendor]** — [MarginEdge: what's new in 2026](https://www.marginedge.com/blog/smarter-operations-stronger-margins-a-look-at-whats-new-at-marginedge-in-2026); [H1 2026 release notes](https://www.marginedge.com/blog/h1-2026-product-release-notes?hs_amp=true)
- Price includes unlimited invoice processing and unlimited US bill payments. **[3P-review]** — [restauranttools.ai](https://restauranttools.ai/tools/marginedge)
- Launched a restaurant-only commercial card on 24 Jun 2026. **[press]** — [GlobeNewswire](https://www.globenewswire.com/news-release/2026/06/24/3316764/0/en/marginedge-launches-commercial-card-designed-exclusively-for-restaurants.html)
- Freepour liquor-inventory bundle, about $500 per location. **[3P-review]** — [Cleo Pay](https://www.cleo-pay.com/blog/marginedge-pricing-2026-alternatives) (competitor)

**xtraCHEF by Toast: Toast-POS-only add-on**
- Toast lists xtraCHEF cost analytics and inventory in its supplier and accounting suite: "log stock, scan invoices, and track your inventory levels." **[vendor]** — [Toast xtraCHEF](https://pos.toasttab.com/products/xtrachef)
- Reviews describe AI/OCR invoice processing as its strongest feature and the inventory module as "lighter." **[3P-review]** — [restauranttools.ai xtraCHEF](https://restauranttools.ai/tools/xtrachef); [MarketMan vs xtraCHEF](https://restaurantinventorytools.com/marketman-vs-xtrachef-by-toast-2026/)
- Runs on Toast POS only. **[3P-review]** — [restaurantinventorymanagementsoftware.com xtraCHEF](https://restaurantinventorymanagementsoftware.com/solutions/xtrachef)
- Successor product Toast IQ Inventory is "not generally available": limited release, phased rollout. Existing xtraCHEF customers can migrate "at a later date," with "no firm timelines." Invoice ingestion updates inventory "with minimal intervention," but "mapping purchases to products is still necessary initially." **[vendor]** — [Toast IQ Inventory FAQ](https://support.toasttab.com/en/article/Toast-IQ-Inventory-FAQ)
- No source confirmed a processing-time SLA for xtraCHEF.

**Ottimate (formerly Plate IQ): AP-first, has expanded beyond restaurants**
- Automatically processes invoices and payments for regular vendors when they stay within user-set tolerances. **[vendor]** — [Ottimate blog](https://ottimate.com/blog/cash-flow-control-and-the-cost-of-convenience/)
- Customer quote: "five to 10 hours processing invoices for each restaurant." Thrive Restaurant Group runs AP centrally for 200+ locations across 5 brands. **[vendor]** — [Ottimate customers](https://ottimate.com/customers/)
- Now also serves hotels, grocery, country clubs, senior living and healthcare. **[vendor interview]** — [Pulse2 interview with Shawn Lane](https://pulse2.com/ottimate-profile-shawn-lane-interview/)
- Summer 2026 release added statement reconciliation, deeper spend analytics and "risk-based spend approvals" that use ML guardrails to fast-track low-risk transactions. **[vendor/press]** — [Ottimate MCP release](https://ottimate.com/news/ottimate-becomes-first-ap-platform-to-launch-mcp-integration-further-strengthens-conversational-ap-offerings/); [Hospitality Technology](https://hospitalitytech.com/ottimate-becomes-first-ap-automation-vendor-launch-native-model-context-protocol-integration)
- Named a Leader in two 2026 IDC MarketScape reports (small business and midmarket AP automation). **[vendor PR]** — [EIN Presswire](https://www.einpresswire.com/article-pdf/947588530/ottimate-named-leader-in-both-2026-idc-marketscape-reports-for-small-business-and-midmarket-accounts-payable-automation)
- Labor partnership with ForteSG. **[vendor]** — [Ottimate + ForteSG](https://ottimate.com/current-partners/fortesg/)
- Requires a separate email address for each location. Complex invoices "may also follow longer processing timelines." **[3P-review, competitor]** — [Factura.ai: Ottimate vs R365 vs Factura](https://factura.ai/ottimate-vs-restaurant365-vs-factura/)

**Craftable (formerly Bevager/Foodager): restaurants, bars, hotels and resorts**
- "Invoice AI" reads vendor names, line items and prices, auto-matches to POs, flags discrepancies and routes approvals. It learns each vendor's document layout, maps lines to the chart of accounts and checks them against what was actually received. **[vendor]** — [Craftable AP Automation](https://craftable.com/ap-automation)
- Pitched as an "AI-powered back office and procure-to-pay platform" at HITEC, June 2026. **[vendor PR]** — [PR Newswire](https://www.prnewswire.com/news-releases/craftable-to-showcase-ai-powered-back-office-and-procure-to-pay-platform-at-hitec-2026-302800735.html)
- January 2026 partnership with Finexio for fully managed AP payment delivery and supplier management. **[vendor PR]** — [Newswire](https://www.newswire.com/news/hospitality-saas-platform-craftable-announces-partnership-with-ap-payments-as-a)
- Testimonial: Pier Sixty-Six handles about 1,800 invoices a month with one supervisor. **[vendor]** — [Craftable](https://craftable.com/)
- Connects purchasing, inventory, recipes and AP with accounting and sales data. **[3P profile]** — [API Evangelist Craftable profile](https://github.com/api-evangelist/craftable)

**Supy: multi-site groups, strongest in the GCC/UAE per its own positioning**
- AI Invoice Receiving: suppliers email a per-restaurant inbox. The system extracts line items, prices, quantities and totals, matches to the PO and flags price or quantity conflicts. **[vendor]** — [Supy: invoice scanning AI](https://supy.io/blog/revolutionize-your-workflow-the-power-of-invoice-scanning-ai); [Supy: detecting pricing errors](https://supy.io/blog/how-restaurants-detect-pricing-errors-automatically-with-ai)
- AI modules: AI Invoice Receiving, "AI Invoices and Credit Notes," AI Predictive Ordering, AI Sales Forecasting. **Handwritten invoices are not supported.** **[vendor]** — [Supy: procurement software](https://supy.io/blog/learn-restaurant-procurement-software); [Supy: AI in restaurants](https://supy.io/blog/a-complete-guide-to-ai-in-restaurants-how-automation-improves-margins). The extract did not say which page made which claim.
- Branch-level approvals and budgets, with 200+ configurable permissions. **[vendor]** — [Supy: restaurant management system](https://supy.io/blog/learn-restaurant-management-system)

**Apicbase: Europe-centric, F&B management for multi-outlet groups**
- Invoice matching reads each invoice line for product, quantity, price and **VAT**. It matches against purchase orders **and deliveries** (a three-way match), handles PDFs, scans and e-invoices in one pipeline, and auto-approves fully matched lines. **[vendor]** — [Apicbase Invoice Matching](https://get.apicbase.com/invoice-matching-software/)
- Also sells a separate Food Traceability product. **[3P listing]** — [Capterra: Apicbase Food Traceability](https://www.capterra.com/p/10001384/Apicbase-Food-Traceability/)

**MarketMan: inventory and purchasing for independents and small groups**
- Invoice scanning is capped by plan (Starter 50 scans a month, Growth unlimited). **[3P-review]** — [restauranttools.ai MarketMan](https://restauranttools.ai/tools/marketman)
- Has a recipe builder and a Square POS integration (both named in user complaints). **[user]** — [G2 MarketMan reviews](https://www.g2.com/products/marketman/reviews)

**meez: recipe-first culinary platform**
- Invoice processing is a Premium-tier feature. Supplier price updates flow into recipe costs. **[3P-review]** — [restauranttools.ai meez](https://restauranttools.ai/tools/meez)

**Orderly ("Orderly by Back Office")**
- Food-cost tool built on automated invoice capture; tracks food spend and COGS. **[3P listing]** — [Capterra Orderly](https://www.capterra.com/p/145549/Orderly/); [restaurantinventorymanagementsoftware.com](https://restaurantinventorymanagementsoftware.com/)

**Galley Solutions**
- Cloud platform for recipes, menu planning, food costing and inventory, aimed at growing and enterprise food businesses. **[3P comparison]** — [Softwr: Apicbase vs Galley](https://www.softwr.com/compare/apicbase-vs-galley-solutions)

**Choco: free buyer app plus a paid AI product for distributors (Berlin; US, UK, EU, GCC)**
- Free restaurant app for ordering from several distributors, with order history, reminders, supplier chat and AI order capture. **[3P-review]** — [restaurantinventorymanagementsoftware.com Choco](https://restaurantinventorymanagementsoftware.com/solutions/choco)
- OrderAgent (2023, previously "Choco AI") uses LLMs to capture orders from voicemail, email, fax, SMS, WhatsApp and handwritten notes and push them into the distributor's ERP. **[vendor]** — [Choco: from restaurant app to AI partner for distributors](https://choco.com/us/stories/suppliers/from-restaurant-app-to-ai-partner-for-distributors-the-evolution-of-choco)
- ERP connections reportedly include Entree, NetSuite, QuickBooks, Sage and Odoo. No public developer API. "Tens of thousands of distributors and over one hundred thousand buyers." **[3P profile]** — [apis.io Choco](https://apis.io/providers/choco/); [Bitscale directory](https://bitscale.ai/directory/choco). The extract did not say which profile made which claim.
- Offers multi-language ordering for distributors. **[press, headline-level only]** — [Food Logistics](https://www.foodlogistics.com/software-technology/ai-ar/news/22931318/choco-choco-offers-multilanguage-ordering-for-food-distributors)

**Rekki: UK-born ordering and chat app for chefs**
- Ordering and supplier chat on any device; "digital invoices for all transactions are included." **[3P listing]** — [StartupHub Rekki](https://www.startuphub.ai/startups/rekki); [Google Play](https://play.google.com/store/apps/details?id=rekkiapp.com.rekki.release&hl=en&gl=US)
- REKKI Connect takes in orders from non-Rekki customers. A customer said half of their orders now flow straight into their invoicing system. **[vendor]** — [rekki.ai: REKKI Connect](https://www.rekki.ai/blog/rekki-connect-order-processing)
- Sends invoices to Xero with the invoice file attached. **[vendor]** — [Rekki LinkedIn](https://www.linkedin.com/company/rekkiapp)

**BlueCart: wholesale ordering marketplace**
- Free restaurant app with "no in-app purchases, transaction fees or hidden costs." Auto-matches incoming invoices to POs. Reviews say it lacks recipe costing and POS integration. **[3P-review / app store]** — [restauranttools.ai BlueCart](https://restauranttools.ai/tools/bluecart); [restaurantinventorymanagementsoftware.com BlueCart](https://restaurantinventorymanagementsoftware.com/solutions/bluecart)

### Inferences
Coverage matrix built only from the findings above. Y = cited above. nv = not verified in this pass (the feature may exist). N = a source says it is absent or weak.

| Vendor | Ordering | Receiving check | Capture model | Line items | 3-way (PO+receipt) | Approvals | Credits | AP payment | Statement recon | Inventory/recipe |
|---|---|---|---|---|---|---|---|---|---|---|
| R365 | nv | nv | AI capture + validation | nv | PO match Y | Y (AI-driven) | nv | Y (check/ACH/vcard) | Y (report) | Y / nv |
| MarginEdge | nv | nv | ML + human review, 24-48h | Y | nv | Y | Partial (flags on statements) | Y (bill pay, card) | Y | Y |
| xtraCHEF | nv | nv | AI/OCR | nv | nv | nv | nv | nv | nv | Y (light) |
| Ottimate | N/A (AP-only) | nv | AI, auto-process within tolerances | nv | nv | Y (risk-based) | nv | Y | Y (Summer 2026) | N (AP-focus) |
| Craftable | Y (P2P) | Y (checks receipt) | "Invoice AI" | Y | Y | Y | nv | Y (Finexio) | nv | Y |
| Supy | Y (predictive) | nv | AI email inbox; no handwriting | Y | PO match Y | Y | Y ("credit notes") | nv | nv | Y |
| Apicbase | nv | Y (delivery match) | AI on PDF/scan/e-invoice | Y (+VAT) | Y | Auto-approve matched | nv | nv | nv | nv |
| MarketMan | nv | nv | Scan (plan-capped) | nv | nv | nv | nv | nv | nv | Y |
| meez | nv | nv | Premium invoice processing | nv | nv | nv | nv | nv | nv | Y (recipe) |
| Choco / Rekki / BlueCart | Y (core) | nv | Supplier-side order AI | n/a | BlueCart PO match | nv | nv | nv | nv | N (BlueCart) |

- No vendor except MarginEdge publishes a turnaround SLA. MarginEdge is also the only one that openly admits to human review. The others market "AI" without giving accuracy rates. I found **no independently audited extraction accuracy figure for any vendor.**
- The ordering networks (Choco, Rekki, BlueCart) aim their AI at the distributor's order intake, not at the restaurant's AP or leak detection. They are not direct competitors on invoice-level leak detection, but they own the order record that a 3-way match needs.

### Gaps
- No vendor pages could be read in full (proxy block). Feature cells marked "nv" may exist but were not confirmed.
- No processing-time or accuracy figures were found for R365, xtraCHEF, Ottimate, Craftable, Supy, Apicbase or MarketMan.
- Little detail was found for Galley, Orderly or meez on invoice-capture mechanics.
- A search extract attributed this claim to xtraCHEF: applying a vendor credit automatically adjusts the invoice total. I could not tie it to a specific URL, so it is excluded from the findings.
- The task lists "meez/Apicbase" as one entity. **I found no evidence of a merger or acquisition between meez and Apicbase.** 2026 comparison sites treat them as separate competitors ([cucinovo: meez alternatives](https://cucinovo.com/blog/meez-alternatives)).

## 2. AI agents and copilots launched in 2025-2026, and what they actually do

### Takeaway
In 2025-2026 the leaders shipped mostly **conversational analytics and read-only data access** (copilots, MCP connectors) plus **forecasting** (labor, prep). The only truly autonomous "agents" with actions are Toast's, and they target marketing and labor, not AP. Choco's and Rekki's agents automate the **supplier's** order intake. **I found no shipped agent that autonomously emails suppliers to chase credits or disputes** on the restaurant's behalf.

### Cited Findings
- **Ottimate Copilot**, unveiled 5 Aug 2025 with broader availability in Q4 2025. Ottimate calls it the "industry's first conversational AP tool." It answers AP questions, "execute[s] on operational AP tasks" and proactively flags profitability variances. **[vendor]** — [Ottimate news](https://ottimate.com/news/ottimate-introduces-conversational-ap-first-ai-assistant-to-proactively-assess-optimize-ap-operations/)
- **Ottimate Summer 2026 release (10 Jun 2026):** an MCP server that lets finance leaders query AP data in Claude, ChatGPT or another LLM. Ottimate claims it is the "first MCP integration among AP platforms." Copilot gains statement reconciliation, spend analytics and risk-based approvals. Ottimate's rationale is that finance teams spend 11+ hours a week running reports. **[vendor/press]** — [Ottimate](https://ottimate.com/news/ottimate-becomes-first-ap-platform-to-launch-mcp-integration-further-strengthens-conversational-ap-offerings/); [The Shelby Report](https://theshelbyreport.com/2026/06/11/ottimate-launches-first-mcp-integration-among-ap-platforms/); [Hospitality Technology](https://hospitalitytech.com/ottimate-becomes-first-ap-automation-vendor-launch-native-model-context-protocol-integration)
- **MarginEdge "[me]" MCP connector (4 Aug 2026),** billed as "first-of-its-kind." It links MarginEdge data to ChatGPT, Claude and Gemini, is **read-only** ("will only read your data") and requires a MarginEdge Admin role. **[vendor]** — [GlobeNewswire](https://www.globenewswire.com/news-release/2026/08/04/3338368/0/en/marginedge-launches-first-of-its-kind-mcp-connector.html); [MarginEdge help: ChatGPT via MCP](https://help.marginedge.com/hc/en-us/articles/54049593206931-How-to-Connect-me-to-ChatGPT-via-MCP); [MarginEdge help: Claude via MCP](https://help.marginedge.com/hc/en-us/articles/54058711911571-How-to-Connect-me-to-Claude-Desktop-via-MCP)
- **MarginEdge Tom** is a built-in chat assistant that searches invoices, recipes and sales to find the cause of a problem and suggest next steps. It is included in the price with no usage fees. **[vendor]** — [MarginEdge help: AI for Restaurants](https://help.marginedge.com/hc/en-us/articles/54085680582419-AI-for-Restaurants); [MarginEdge](https://www.marginedge.com/)
- One extract said "Tom 2.0" now sees live invoices, vendors, daily sales, spending and products. A second search found **no source naming "Tom 2.0."** — [Restaurant Technology News, Jul 2026](https://restauranttechnologynews.com/2026/07/marginedge-improves-restaurant-profitability-with-real-time-cost-management-ai-forecasting-and-back-office-automation/) (attribution uncertain); conflicting with the absence in [MarginEdge help](https://help.marginedge.com/hc/en-us/articles/54085680582419-AI-for-Restaurants)
- **MarginEdge SmartPrep (28 Sep 2026)** turns sales forecasts into daily prep plans. **[press]** — [Manila Times / GlobeNewswire](https://www.manilatimes.net/2026/09/28/tmt-newswire/globenewswire/marginedge-launches-smartprep-bringing-ai-powered-forecasting-into-the-kitchen/2434211)
- MarginEdge raised an $80m Series D, which it says it will put toward AI products built on restaurant data. **[press]** — [Yahoo Finance](https://finance.yahoo.com/small-business/articles/marginedge-raises-80m-series-d-133835789.html)
- **R365 AI (12 May 2026, NRA Show)** is an "intelligence engine built on the full restaurant P&L." AI Dashboards and the Labor Management Suite are generally available. AI Advisor, AI Scheduling and Secure Data Share are in early access via "Chef's Table." Early testers reported a 15% drop in labor-forecast error, which R365 estimates at about $100k a year across 10 locations. **[press/vendor]** — [Yahoo Finance](https://finance.yahoo.com/sectors/technology/articles/restaurant365-introduces-r365-ai-only-130000067.html); [Orange County Business Journal](https://www.ocbj.com/technology/restaurant365-adds-ai-engine-to-r365-management-platform/)
- **Toast IQ** is a plain-language assistant over business data that "complete[s] tasks directly from chat." Toast says 179,000+ users across 125,000+ locations used it in Q1 2026. **[vendor]** — [Toast: AI for restaurants](https://pos.toasttab.com/blog/on-the-line/ai-for-restaurants)
- **Toast IQ Grow (May 2026)** launched with a Marketing Agent that runs campaigns with operator sign-off. **[press]** — [Nasdaq press release](https://www.nasdaq.com/press-release/toast-debuts-toast-iq-grow-take-marketing-and-drive-demand-operators-2026-05-05)
- **Toast IQ Team plus expanded Grow (6 Oct 2026):** a Scheduling Agent (beta users averaged 41% fewer overtime hours per employee), SEO, Reviews and Offers agents, a Menu Agent (beta), an Answering Agent (beta) for phones, and Configurable Agents built from templates. Grow pilots showed an average 8% sales lift. **All figures are Toast's own beta data.** — [Business Wire](https://www.businesswire.com/news/home/20261006538986/en/New-Toast-IQ-Team-and-Expanded-Toast-IQ-Grow-Help-Businesses-Drive-Profits-Attract-Guests-and-Manage-Labor); [Toast Fall Release 2026](https://pos.toasttab.com/news/toast-fall-release-2026); [The Pass Brief](https://thepassbrief.com/articles/toast-rolls-out-new-restaurant-ai-agents-led-by-labor-tool-tied-to-41-overtime-c-e9744bcb)
- **Choco** says (May 2026) it runs AI agents on OpenAI APIs that process millions of transactions, including a Choco Voice Agent built with OpenAI. **[press]** — [Food Digital](https://fooddigital.com/news/choco-openai-tech-for-global-food-distribution-systems)
- **Rekki** sells supplier-side agents: OrderAI, InboxAI and MenuAI. It claims OrderAI has saved suppliers 100,000+ hours with "99.99% order accuracy." **[vendor]** Launch dated 2024 by one source and 2022 by another; no 2026 launch found. — [StartupHub Rekki](https://www.startuphub.ai/startups/rekki); [Distill Intelligence: Rekki news](https://www.distillintelligence.com/news/rekki)
- **Craftable** markets Invoice AI under "AI-powered back office" (HITEC, June 2026). No conversational agent was found. — [PR Newswire](https://www.prnewswire.com/news-releases/craftable-to-showcase-ai-powered-back-office-and-procure-to-pay-platform-at-hitec-2026-302800735.html)
- **Supy** sells AI Predictive Ordering and AI Sales Forecasting as modules. **[vendor]** — [Supy: AI in restaurants](https://supy.io/blog/a-complete-guide-to-ai-in-restaurants-how-automation-improves-margins)

### Inferences
- **"First MCP" is contested.** Ottimate (June 2026) and MarginEdge (August 2026) each claim to be first. MCP plus a chat copilot is now table stakes among US leaders, so a "chat with your invoices" feature on its own does not set a product apart in 2026.
- Every AP-side AI found is either **read or advise** (answer, flag, forecast) or **approve faster** (risk-based routing, auto-approve within tolerance). None found **acts outward on suppliers** (drafts and sends credit requests, tracks them to recovery, escalates). That outward-facing "recovery agent" looks like the clearest open space, and it maps directly to a "leak in ₪ that the owner believes and recovers" proposition.
- Toast is putting its agent effort into revenue (marketing) and labor, and its AP/inventory successor (Toast IQ Inventory) is still in limited release. Toast-locked operators may stay underserved on invoice-level control through 2026.

### Gaps
- What Ottimate Copilot's "execute operational AP tasks" covers in practice (which tasks, under what permission model) was not specified in the extracts.
- No details were found on the R365 AI Advisor's AP-specific behavior.
- No independent evaluation of any copilot's answer quality was found.

## 3. Pricing (per location per month) and target segment: who serves independents vs chains

### Takeaway
US AP-heavy products cluster at **about $300-$540 per location per month**. MarginEdge publishes $350; R365 is reportedly $469-$539; Ottimate is quote-only, with estimates of $200-$500. Inventory and costing tools sit lower at **about $150-$250 per month**. Ordering networks are **free to restaurants** and charge distributors. Independents are best served by MarginEdge, MarketMan, xtraCHEF (if on Toast), meez and Orderly. Chains and multi-entity groups are served by R365, Ottimate, Craftable, Supy and Apicbase.

### Cited Findings
- **MarginEdge:** $350 per location per month, with unlimited invoices and US bill pay. Annual billing is about 10% off with a 12-month term. Older sources cite $330 monthly or $300 on annual billing. Toast POS users pay an extra $50 a month API fee to Toast. Tom and the AI connector are included with no usage fees. **[3P-review / vendor]** — [restauranttools.ai](https://restauranttools.ai/tools/marginedge); [DishCost](https://dishcost.com/blog/dishcost-vs-marginedge); [Cleo Pay](https://www.cleo-pay.com/blog/marginedge-pricing-2026-alternatives); [MarginEdge](https://www.marginedge.com/)
- **Restaurant365:** Essential is about $469-$499 per location per month; Accounting plus Operations is $539 per location per month on annual billing. **[3P-review, competitor]** — [Cleo Pay: MarginEdge vs R365 pricing 2026](https://www.cleo-pay.com/blog/marginedge-vs-restaurant365-pricing-2026)
- **Ottimate:** "Prices entirely by quote: no public tier list, no per-seat number, no per-location number." **[3P, competitor]** — [Cleo Pay Ottimate](https://www.cleo-pay.com/blog/ottimate-plate-iq-pricing-2026-alternatives). Third-party estimates of about $300-$500 per location for AP-only, or "from $200/mo." — [SaaSRat](https://saasrat.com/blog/best-accounting-software-for-restaurants/); [restauranttools.ai Ottimate](https://restauranttools.ai/tools/plate-iq) (which source gave which number is unclear). Capterra shows a $25 starting price, which contradicts the others. — [Capterra Ottimate](https://www.capterra.com/p/148741/Plate-IQ/)
- **xtraCHEF:** not published by Toast. Third-party estimates run $149-$349 a month; Capterra lists "$149 per feature, per month"; an onboarding fee of about $1,049 is unverified. Sold as a quote-based add-on to Toast. — [restaurantinventorymanagementsoftware.com](https://restaurantinventorymanagementsoftware.com/solutions/xtrachef); [Capterra xtraCHEF](https://capterra.com/p/165935/xtraCHEF/)
- **MarketMan:** Starter $199 a month (50 scans), Growth $249 (unlimited scans). Setup fee reported as $1,500 (waived) by one source and about $500 by another. Other listings show $249 (Software Advice), $239 "Operator" (G2), and 100 invoices for $125 (SaaSworthy). — [restauranttools.ai](https://restauranttools.ai/tools/marketman); [CheckThat](https://checkthat.ai/brands/marketman/pricing); [Software Advice](https://www.softwareadvice.com/scm/marketman-restaurant-management-profile/); [G2 pricing](https://www.g2.com/products/marketman/pricing); [SaaSworthy](https://www.saasworthy.com/product/marketman)
- **Supy:** "Start from $250/month" base, with AI invoice scanning and AI ordering as add-ons. The page is old and the currency is not stated. Another guide says "custom quote required." — [Supy pricing](https://supy.io/supy-pricing); [Operators Daily](https://www.operatorsdaily.com/blog/purchasing-procurement-software-restaurants)
- **Apicbase:** €249 or $249 a month starting price ("per feature," Capterra), or about $160 a month for a single-outlet bundle billed annually. Growth tier from 5 outlets; Professional and Enterprise are quote-only. The vendor site reportedly publishes no figures. — [Capterra Apicbase pricing](https://www.capterra.com/p/171584/Apicbase-Restaurant-Management/pricing/); [restauranttools.ai Apicbase](https://restauranttools.ai/tools/apicbase)
- **meez:** from $75 a month; invoice processing is on the Premium tier at $179 a month. — [restauranttools.ai meez](https://restauranttools.ai/tools/meez)
- **Galley:** "starts at $300/mo" per one comparison site, which also says Galley discloses no pricing. — [Softwr](https://www.softwr.com/compare/apicbase-vs-galley-solutions)
- **Orderly:** $195 a month per one listing, $99 a month per another. — [Capterra Orderly](https://www.capterra.com/p/145549/Orderly/); [restaurantinventorymanagementsoftware.com](https://restaurantinventorymanagementsoftware.com/)
- **Craftable:** quote-based, per location; "Verified: Not yet." — [Gappsy](https://www.gappsy.com/tools/craftable/)
- **BlueCart:** free for restaurants. Supplier plans are quote-based; one unverified figure is about $10 a month plus 5% commission on the marketplace. — [restauranttools.ai BlueCart](https://restauranttools.ai/tools/bluecart); [GetApp BlueCart](https://www.getapp.com/retail-consumer-services-software/a/bluecart/)
- **Choco:** free for restaurants; the paid product is for distributors. — [restaurantinventorymanagementsoftware.com Choco](https://restaurantinventorymanagementsoftware.com/solutions/choco). Funding about $318.5M (figures vary). — [ScalablePod](https://www.scalablepod.it/en/startup/choco/)
- **Rekki:** about $23M raised. — [StartupHub](https://www.startuphub.ai/startups/rekki)
- **Segment signals:** Ottimate's reference customer is a 200+ location, 5-brand group ([Ottimate customers](https://ottimate.com/customers/)). Factura says R365's native AP can bottleneck high-volume multi-location operators ([Factura](https://factura.ai/restaurant365-review/)). Supy targets multi-site groups with branch permissions ([Supy](https://supy.io/blog/learn-restaurant-management-system)). Craftable targets hotels and resorts as well as restaurants ([Craftable](https://craftable.com/)).

### Inferences
- A US independent pays about **$350 per location per month (about $4,200 a year)** for MarginEdge-class invoice-to-P&L with human-verified capture. That is the anchor price the market has accepted for "invoice digitization plus food cost." To justify that price on the North Star (1.5% of food spend), the leak surfaced must exceed about $4.2k a year, which means roughly $280k+ a year in food spend at 1.5%. That is plausible for full-service restaurants but marginal for small cafés. (Arithmetic inference, not sourced.)
- Pricing opacity is the norm. Ottimate, Craftable, Apicbase and xtraCHEF are quote-only, and third-party figures conflict widely. **Published, simple per-location pricing is itself a differentiator** for independents.

### Gaps
- No vendor-verified pricing for Ottimate, Craftable, Apicbase, Galley or xtraCHEF.
- No local-currency or GCC/Israel pricing for any vendor (Supy's GCC pricing was explicitly not found).

## 4. What customers praise and complain about

### Takeaway
Praise centers on **time saved on invoice entry and vendor EDI/auto-ingest**. Complaints cluster on **capture accuracy and stale prices** (MarketMan, R365, Ottimate), **slow support** (MarketMan, R365, xtraCHEF), **billing and cancellation practices** (R365 BBB, MarketMan), **payments and credit tracking** (MarginEdge) and **setup or mapping effort** (MarginEdge, Toast IQ Inventory). No Reddit threads surfaced.

### Cited Findings
- **MarketMan:** "invoice scanning did not work 50% of the time and support would take days to respond." Glitches "with square and in the recipe builder resulted in wrong pricing data." Called "the most greedy software service that I use"; "Extremely Frustrating Cancellation Process." On the positive side, "major vendors invoices can be sent straight to the software without lifting a finger." G2's AI summary praises ease of use and inventory but notes slow support. Ratings: G2 4.3 (52 reviews), Capterra 4.2 (2,081), TechRaisal 3.4 (61). **[user]** — [G2 MarketMan](https://www.g2.com/products/marketman/reviews); [Capterra MarketMan](https://www.capterra.com/p/136439/Marketman-Restaurant-Inventory/); [TechRaisal](https://www.techraisal.com/software/marketman/)
- **Restaurant365:** G2 users praise automatic vendor invoice uploads and EDI connections. A G2 reviewer says it "does not always pick up the latest invoice prices," which leads to inaccurate inventory counts. A Capterra reviewer says the invoice approval workflow "took a long time to release and still does not always work correctly," and that support is in a different time zone and slow. BBB complaints cover being charged for modules after closing locations, autopay continuing after cancellation, and unanswered complaints. About 324 G2 reviews, generally favorable. **[user]** — [G2 R365](https://www.g2.com/products/restaurant365/reviews); [Capterra R365](https://www.capterra.com/p/139768/Restaurant365/reviews/); [BBB R365](https://www.bbb.org/us/ca/irvine/profile/restaurant-management/restaurant365-1126-1000129633/complaints)
- **MarginEdge:** Capterra shows 47 reviews with 91% positive sentiment, and support is widely praised. A 2023 Capterra reviewer cites slow payments to vendors, says "tracking credits is not easy," and reports problems with some electronic payments. A 2020 Software Advice review lists invoice turnaround time as a con. A G2 reviewer had setup errors (flour and olive oil entries) that inflated recipe costs, later caught via "item review." Some teams report a learning curve on unit conversions. **[user]** — [Capterra MarginEdge](https://www.capterra.com/p/187718/MarginEdge/reviews/); [Software Advice MarginEdge](https://www.softwareadvice.com/retail/marginedge-profile/reviews/); [G2 MarginEdge](https://www.g2.com/products/marginedge/reviews?page=2)
- **Ottimate:** praised for approval routing and speed. A restaurant reviewer says automatic classification "does not consider some vendor codes, particularly for service code invoices." Capterra's summary of 42 reviews cites vendor-matching errors, coding corrections and a weak payment portal. **[user]** — [Capterra Ottimate](https://www.capterra.com/p/148741/Plate-IQ/); [Software Advice Ottimate](https://www.softwareadvice.com/accounting/plate-iq-profile/)
- **xtraCHEF:** G2 summary praises easy invoice processing and accounting integration, with "issues with customer support and data accuracy." One reviewer wrote: "since Toast delete the inventory function xtrachef never got it together." Capterra shows 4.3 on only 6 reviews, with a customer-service score of 3.0. **[user]** — [G2 xtraCHEF pros/cons](https://www.g2.com/products/xtrachef/reviews?qs=pros-and-cons); [Capterra xtraCHEF](https://capterra.com/p/165935/xtraCHEF/)
- **Toast IQ Inventory** still needs initial purchase-to-product mapping. **[vendor-admitted]** — [Toast IQ Inventory FAQ](https://support.toasttab.com/en/article/Toast-IQ-Inventory-FAQ)
- **Choco** has a thin restaurant-side review base (one Capterra review, per the extract). — [restaurantinventorymanagementsoftware.com Choco](https://restaurantinventorymanagementsoftware.com/solutions/choco)
- **BlueCart** lacks recipe costing and POS integration, so it is usually paired with a costing tool. **[3P-review]** — [restaurantinventorymanagementsoftware.com BlueCart](https://restaurantinventorymanagementsoftware.com/solutions/bluecart)

### Inferences
- The most damaging recurring complaint is **wrong or stale prices flowing into food cost and inventory** (R365, MarketMan, MarginEdge setup). For a leak-detection product this is existential: one false ₪ leak undermines owner trust. Showing provenance (which invoice line, which reference price) and abstaining when uncertain is a direct answer to the market's main pain.
- **Credit tracking** comes up as a user pain even at MarginEdge, which has a statement reconciliation tool. That suggests flagging is not the same as recovering.

### Gaps
- **No Reddit (r/restaurantowners, r/KitchenConfidential) threads surfaced** in any search, so practitioner sentiment from Reddit is missing.
- No App Store review data was retrieved beyond listing-level claims.
- No user reviews were found for Supy, Apicbase, Craftable, Galley, Orderly or Rekki.
- Many review dates are old (MarginEdge complaints from 2020 and 2023), so they may not reflect 2026 product state.

## 5. Gaps that none of the leaders fill well

### Takeaway
Of the hypothesized gaps, **supplier statement reconciliation is now partly covered** (MarginEdge tool, Ottimate Copilot as of Summer 2026, R365 reports). The gaps that remain open in the evidence are these: (1) **credit-note recovery as a tracked workflow through to money back**, not just a flag; (2) **catch-weight receiving variance** in restaurant tools; (3) **handwritten delivery-note adjustments** without human labor; (4) **consolidated invoices vs per-delivery notes**, where no vendor material was found; (5) **non-English, and specifically Hebrew/RTL, invoices**, where no leader documents support.

### Cited Findings
- **Statement reconciliation exists at several leaders:** MarginEdge flags unrecorded credits and total mismatches ([MarginEdge help](https://help.marginedge.com/hc/en-us/articles/23635825774611-Vendor-Statement-Reconciliation-Tool)); Ottimate added statement reconciliation to Copilot in June 2026 ([Ottimate](https://ottimate.com/news/ottimate-becomes-first-ap-platform-to-launch-mcp-integration-further-strengthens-conversational-ap-offerings/)); R365 has vendor reconciliation reporting ([R365 support](https://restaurant365.freshdesk.com/support/solutions/articles/12000060763-vendor-reconciliation-detail)).
- **Unrecorded credits are a common cause of statement-vs-ledger gaps:** a bookkeeping guide says a statement balance that differs from the AP ledger often traces back to a credit that was never recorded. — [Growthy: vendor credit memo](https://growthy.com/blog/vendor-credit-memo)
- A recommended monthly check covers invoices on only one side, supplier-billed invoices with no restaurant record, outstanding credit notes, and balance mismatches that don't trace to a line. — [InvoiceDataExtraction: restaurant invoice management](https://invoicedataextraction.com/blog/restaurant-invoice-management)
- Accounting-firm advice is to record vendor credits at receipt so they are "less likely to fall through the cracks." — [Insightful Accountant](https://insightfulaccountant.com/niche-markets/restaurants-accounting/vendor-management-best-practices-for-your-restaurant-account/)
- **Credit tracking pain at a leader:** "tracking credits is not easy" (MarginEdge user). — [Capterra MarginEdge](https://www.capterra.com/p/187718/MarginEdge/reviews/)
- **Catch weight:** coverage in restaurant tools is thin. HotSchedules' inventory bases catch-weight variance on the invoice unit of measure (article about 4 years old) ([HotSchedules help](https://help.hotschedules.com/hc/en-us/articles/360042714151-Inventory-Restaurants-Ordering-Receiving-and-Counting-Catch-Weight-Products-in-Inventory)). Distributor ERPs track case count and actual weight together ([AEB](https://www.aeb.com/en/magazine/articles/catch-weight-management.php); [Inecta](https://www.inecta.com/blog/calculate-food-catch-weight)). In three-way matching, buyers either accept weight variance as a systematic exception, use receiving scales, or reconcile manually, and accepting the variance is the most common approach ([Confinus](https://www.confinus.com/blog/catch-weight-pricing-technical-guide/)). Tolerance should depend on product volatility, estimated vs certified weight and supplier history. Variances classify as expected weight variance, pricing error, or substitution/short shipment ([InvoiceDataExtraction: catch-weight reconciliation](https://invoicedataextraction.com/blog/catch-weight-invoice-reconciliation)).
- **Handwritten adjustments:** Supy does not support handwritten invoices ([Supy](https://supy.io/blog/learn-restaurant-procurement-software)). MarginEdge captures handwritten adjustments by adding human review ([MarginEdge](https://www.marginedge.com/)). MarginEdge's statement tool flags "credit missing from statement" for cases like a handwritten adjustment ([MarginEdge help](https://help.marginedge.com/hc/en-us/articles/23635825774611-Vendor-Statement-Reconciliation-Tool)).
- **Delivery-level matching:** Apicbase is the only vendor found that explicitly matches invoices against both POs **and deliveries** ([Apicbase](https://get.apicbase.com/invoice-matching-software/)). Craftable verifies "against what was actually received" ([Craftable](https://craftable.com/ap-automation)).
- **Multi-language:** the only multi-language capability found is Choco's, on the distributor ordering side ([Food Logistics](https://www.foodlogistics.com/software-technology/ai-ar/news/22931318/choco-choco-offers-multilanguage-ordering-for-food-distributors)). Apicbase parses VAT per line, which suggests European e-invoice support ([Apicbase](https://get.apicbase.com/invoice-matching-software/)).

### Inferences
- **Credit recovery is the strongest open space.** Leaders detect missing credits (MarginEdge, Ottimate statement reconciliation) but none was found to run an outward loop: open a claim per discrepancy, notify the supplier, track status, confirm the credit lands on the next statement, and report recovered ₪. Combined with the finding that no 2026 agent acts outward on suppliers (section 2), this is the most defensible "more advanced than today" product. It also turns the leak number into money recovered.
- **Catch weight** fits a tolerance-band model (expected weight variance vs price error vs short shipment) rather than a binary flag. Restaurant tools seem to fall back on "accept the variance" by default, which hides real short-weight leakage in meat, fish and produce.
- **Handwritten driver notes and consolidated invoices** (one monthly invoice covering many delivery notes, common in Israel as "חשבונית ריכוז") are where US tools either add humans (MarginEdge) or do not support it (Supy). A product that natively links each delivery note to the consolidated invoice, and stays calm while a delivery is "pending consolidation," would serve a workflow the US leaders were not built around.
- **Hebrew/RTL invoices and Israeli VAT (17%)**: none of the 14 vendors shows evidence of Israeli market presence or Hebrew document support. Global leaders are a feature benchmark, not a direct local competitor. (Inference from absence; local competitors are outside this note's scope.)
- MCP connectors and chat copilots are already commodity at the top. Building one is parity, not differentiation.

### Gaps
- **Consolidated invoices vs delivery notes:** no vendor documentation was found on how any leader handles it.
- **Non-English invoice OCR accuracy:** no data for any vendor; no evidence of Hebrew, Arabic or RTL support at any of the 14 (Supy's GCC presence did not come with documented Arabic invoice support in the extracts).
- No source showed how MarketMan, R365 or xtraCHEF handle meat catch-weight variance on supplier invoices specifically.
- No source quantified how much money restaurants recover via any vendor's credit or claims features. That benchmark would be valuable for the ₪ North Star but was not found.
