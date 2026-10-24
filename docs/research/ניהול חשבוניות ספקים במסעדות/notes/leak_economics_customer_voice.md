# Supplier-invoice leakage in restaurants: the economics, and what owners will pay for

_How this was researched (applies to every section): web search only. Full-page fetches were blocked in this session (WebFetch got DNS failures, and the egress proxy returned 403 for ottimate.com, prgx.com, restaurant.org and fsrmagazine.com). Every figure below therefore comes from search-engine extracts of the cited page, not from a full read of it. Each figure is tagged [source type | geography | data year]. VENDOR means the company sells the product or service the number supports._

---

## 1. How much money leaks between order, delivery and invoice (error rates, overbilling, short-shipment, price variance, duplicates, missed credits)?

### Takeaway
About a quarter to a third of foodservice and grocery invoices carry at least one discrepancy. The overcharge is usually worth about 1% of the invoice's value, and cross-industry estimates put erroneous spend at 0.8–3% of disbursements. Most of these numbers are vendor-claimed, though. The only restaurant-specific measured study I found (35% of invoices overcharged, about 1% of value) is from 2015. And what traditional recovery audits actually get back is far lower, about 0.1–0.15% of spend.

### Cited Findings
**Restaurant- and grocery-specific**
- In 2015, Consolidated Concepts (a US restaurant supply-chain partner/purchasing group serving 20,000+ restaurants) analysed more than 11,000 invoices from 400 restaurants. It found **at least one overcharge on 35% of invoices**, and the "typical overcharges amount to **about 1 percent of the total dollar amount of each invoice**." [Purchasing-services firm, so an interested party but not a software vendor | US | 2015 data] — [FSR Magazine](https://www.fsrmagazine.com/industry-news/overcharges-continue-show-restaurant-invoices/). Note: the extract doesn't make clear whether the 1% applies only to invoices that had an overcharge or to all invoices.
- Ottimate, Restaurant AP Automation Benchmark (Summer 2026), built from its own customers' invoice data rather than a survey: **duplicate invoices prevented $321M in overspending**; **51% of restaurant accounts had a flagged (duplicate) invoice**; **6,000 payment errors caught, more than $1M in potential losses**; invoice lifecycle cut from 11 days to 2.8 days. [VENDOR | US | 2026] — [Ottimate webinar page](https://ottimate.com/webinars/on-demand/the-restaurant-ap-automation-benchmark-report-summer-2026-edition/); [Ottimate report blog](https://ottimate.com/blog/the-restaurant-ap-automation-benchmark-report-summer-2026-edition/)
- One search extract credited the same Ottimate restaurant report with "$256.7M in credits … uncovered in the first half of 2026", and described an overcharge where "a case cost … moved eleven cents in March". [VENDOR | US | H1 2026] — [Ottimate report blog](https://ottimate.com/blog/the-restaurant-ap-automation-benchmark-report-summer-2026-edition/). **Conflict:** a second search found credit totals only in Ottimate's *hotel* report, so treat the $256.7M restaurant figure as unconfirmed.
- Ottimate hotel report: **$488.1M in credits uncovered in 2025, and $358M in H1 2026.** [VENDOR | US | 2025–26, hotels not restaurants] — [Ottimate hotel report](https://ottimate.com/blog/the-hotels-ap-automation-benchmark-report-summer-2026-edition/)
- Ottimate grocery benchmark (Summer 2026): **26% of invoices contain at least one discrepancy**, and **$37,600 per location per year** in overcharges. [VENDOR | US | 2026, grocery] — [Ottimate grocery webinar](https://ottimate.com/webinars/on-demand/the-grocery-ap-automation-benchmark-report-summer-2026-edition/). Ottimate's grocery page says grocery teams "save an average of **$250K per year** by identifying item cost discrepancies." [VENDOR] — [Ottimate grocery](https://ottimate.com/industry/grocery/)
- The Shelby Report (11 Sep 2026) describes small errors such as mispriced lines on a UNFI invoice and gradual produce price creep. They slip through because AP teams can't check every line. With grocery margins "between 2–3%" these errors "add up quickly," yet "most grocers don't have the data to quantify the impact." [Trade press | US | 2026] — [The Shelby Report](https://theshelbyreport.com/2026/09/11/small-discrepancies-real-dollars-a-look-at-grocery-invoice-data/)
- Supy's blog cites a "39% billing errors" figure attributed to IOFM. I could not verify this against IOFM. [VENDOR blog | n/a | undated] — [Supy](https://supy.io/blog/learn-supplier-overcharging-restaurants). Other vendor blogs model **2.5–4.5% leakage of monthly spend**. That is an assumption, not a measured figure. [VENDOR | modeled] — [Vellum](https://www.vellum.ai/blog/how-to-catch-restaurant-vendor-price-creep); [Phacet Labs](https://www.phacetlabs.com/blog/restaurant-invoice-validation)
- Mechanism example (illustrative only, not a measured rate): 40 units delivered but 42 billed is a 5% overcharge on that line. The supplier's billing system had not been updated to Monday's price list, so the invoice went out at the old price. — [Phacet Labs](https://www.phacetlabs.com/blog/restaurant-invoice-validation); [Vellum](https://www.vellum.ai/blog/how-to-catch-restaurant-vendor-price-creep)
- A 90-day case study of "Meridian Restaurant Group" (3 locations): **$4,200 in discrepancies flagged, of which $3,800 (~90%) was recovered** through supplier credits. The platform is not named, the company's existence is unverified, and it cites xtraCHEF research without a link. **Do not rely on it.** — [US Tech Automations blog](https://ustechautomations.com/resources/blog/restaurant-inventory-automation-case-study-2026)
- Israeli bookkeeping firm UNIT4 (restaurants and franchisees): restaurants almost never prepay suppliers, so any debit balance on suppliers ("ספקים בחובה") is usually an expense invoice that was never recorded. After a thorough supplier reconciliation, "we found **dozens of invoices from alcohol and meat suppliers** that simply never reached the system." [Accounting firm, anecdotal | Israel | undated] — [UNIT4](https://unit4.co.il/bookkeeping-restaurants/)

**Accounts payable in general (cross-industry)**
- PRGX (recovery-audit firm): duplicate payments, pricing errors and billing discrepancies come to **0.8% to over 2% of annual disbursements** across industries. [VENDOR | global | undated guide] — [PRGX AP recovery audit guide](https://www.prgx.com/guides/ap-recovery-audit-services-guide/)
- PRGX's CEO in 2020: **1–3%** of annual spend on services and supplies "is duplicative or incorrectly calculated." [VENDOR, interview | US | 2020] — [CFO Dive](https://www.cfodive.com/news/payment-recovery-working-capital/574954/)
- Realised recovery: AP recovery audits "typically recover **$1M for every $1B** in supplier spend" (≈0.1%). [VENDOR | global] — [PRGX guide](https://www.prgx.com/guides/ap-recovery-audit-services-guide/). A competitor puts it at "**0.1–0.15%** of annual AP spend." [Competitor VENDOR | ~2022] — [Xelix](https://xelix.com/recovery-audit)
- PRGX says duplicate-payment software covers only about **20%** of issues. About **80%** of recoveries come from statement audits and account reconciliation (missed credits, unapplied credits and the like). [VENDOR] — [PRGX pharma guide](https://www.prgx.com/guides/recover-protect-pharma-ap-spend/); [PRGX guide](https://www.prgx.com/guides/ap-recovery-audit-services-guide/)
- PRGX's business model is contingency: it earns "a specified percentage of the recoveries from our clients as our fee." [SEC filing | US] — [PRGX 10-K FY2019](https://www.sec.gov/Archives/edgar/data/1007330/000100733020000003/a201910kprgx.htm)
- Medius treats ≤5% as an acceptable invoice error rate. Its own clients average a 97.5% "First Time Right" rate, i.e. a **2.5% error rate**. [VENDOR | global] — [Medius](https://www.medius.com/blog/benchmarking-ap-accuracy-and-understanding-acceptable-invoice-error-rates/)
- Secondary AP benchmark summaries:
  - about **2%** error rate for manual invoice processing, and below 0.8% for top performers or automated processing (attributed to APQC);
  - **1–2%** of invoices with errors annually (attributed to APQC/IFMA);
  - **1–4%** (attributed to IOFM, which is gated);
  - Ardent Partners **exception** rate of **14%** industry-wide versus about **9%** best-in-class. Exceptions are invoices needing human handling, which is not the same as an error.

  [Secondary/vendor blogs | global | 2025–26] — [Ascend Software](https://www.ascendsoftware.com/blog/what-good-looks-like-ap-benchmarks-every-modern-team-should-know-in-2025); [DigiParser](https://www.digiparser.com/statistics/accounts-payable-error-rate). I could not tell which of these two pages carries which figure.
- "39% of manually processed invoices contain some form of error" is attributed to DocuClipper. It measures something different from the 1–4% figures and should not be compared with them. [VENDOR | 2025–26] — [DocuClipper](https://www.docuclipper.com/blog/accounts-payable-statistics/)

### Inferences
- **Frequency is reasonably triangulated:** 35% of invoices (restaurants, 2015) and 26% (grocery, 2026, vendor) both point to about **1 in 4 to 1 in 3 invoices carrying a discrepancy**. That supports a "you will see something every week" message.
- **Magnitude is less certain.** The 2015 restaurant study's ~1% of invoice value is the only measured restaurant figure. The 1.5% North Star sits inside the cross-industry vendor range (0.8–3%) but **above the best restaurant-specific evidence**. It is plausible for independents with no 3-way match, and it is not yet independently proven.
- **What is surfaced and what is recovered are very different.** Recovery audits get back only about 0.1–0.15% of spend, an order of magnitude below the 1–3% error estimates. Part of that gap is that their clients are enterprises that already have controls, and audits work on aged items after the fact. For RestoMatch this argues for two things:
  1. split "₪ surfaced" from "₪ blocked before payment" and "₪ credited", rather than presenting one "leak" number as cash in hand;
  2. sell **prevention before payment**, because chasing credits after payment is where value is lost.
- PRGX's 80/20 finding (most recoveries come from statement and credit reconciliation, not duplicates) matches UNIT4's Israeli anecdote about invoices that never reached the books. **Missed credits and supplier-statement reconciliation are likely a larger ₪ pool than duplicates.**

### Gaps
- No independent, recent (2022–26) measured study of restaurant invoice overcharge rates. The 2015 Consolidated Concepts study is the best available, and it comes from an interested party.
- No published rate for **short-shipment** or for **missed credit memos** in foodservice specifically.
- I could not read the primary IOFM, APQC or Ardent reports (gated, or blocked in this session). The AP error-rate figures are second-hand.
- No Israeli data at all on invoice error rates or on supplier overbilling of restaurants.
- The full Ottimate restaurant report (restaurant-specific price-increase and credit figures) could not be read.

---

## 2. Restaurant margin structure, and what a 1–2% purchasing leak means in profit terms (US / EU / Israel)

### Takeaway
US full-service restaurants keep a median of 2.8% of sales as pre-tax income (1.1% for those under $2M in sales), and food costs about 31–34% of sales. So a 1.5% leak on food spend is roughly **0.5% of sales, about one sixth of a typical full-service restaurant's profit and nearly half of a small one's**. Large UK groups are now near 1.5% margins. Israeli restaurants are described as running on single-digit margins after a wave of closures, but I found no reliable Israeli food-cost benchmark.

### Cited Findings
**US: National Restaurant Association, 2025 Restaurant Operations Data Abstract (2024 data, 900+ restaurants)**

| Segment | Median pre-tax income (% of sales) | Food & non-alcoholic beverage cost (% of sales) |
|---|---|---|
| Full-service, all | 2.8% | not given |
| Full-service, sales ≥$2M | 4.3% | 31.0% |
| Full-service, sales <$2M | 1.1% | 33.7% |
| Limited-service | 4.0% | 32.4% |

[Trade association | US | 2024 data] — [NRA, food-cost ratios 2024](https://restaurant.org/research-and-media/research/restaurant-economic-insights/analysis-commentary/restaurant-operators-kept-food-cost-ratios-in-check-in-2024/); [NRA, higher-volume restaurants](https://www.restaurant.org/research-and-media/research/restaurant-economic-insights/analysis-commentary/higher-volume-restaurants-reported-lower-food-cost-ratios-in-2024/). One third-party site gives 32.0% for full-service. It may be a different cut of the data. — [Bloom Intelligence](https://bloomintelligence.com/blog/restaurant-profit-margins/)

**US: other**
- NRA State of the Restaurant Industry 2026 (secondary citations): **42% of operators were not profitable last year, up from 29% the year before.** I could not verify this against the primary report text. [Trade association, secondary | US | 2025] — [SOI 2026 PDF (watermarked)](https://wtop.com/wp-content/uploads/2026/02/SOI-2026-Report-Watermarked.pdf)

**UK**
- UHY Hacker Young (accountancy firm), the UK's 100 largest restaurant groups: combined profits fell from **£365M to £204M** while turnover rose from **£12.9bn to £13.3bn**. A commentator puts the largest groups' margins at "around **1.5%**." [Independent accountancy | UK | year to ~mid-2026] — [The Caterer](https://www.thecaterer.com/news/profitability-nearly-halves-across-uks-top-100-restaurant-groups); [Restaurant Online, 24 Aug 2026](https://www.restaurantonline.co.uk/Article/2026/08/24/the-uks-top-100-restaurant-groups-see-profits-fall-by-nearly-half/)
- Toast UK: food cost benchmark of about 30% (a rule of thumb, not a survey). [VENDOR | UK] — [Toast UK](https://pos.toasttab.com/uk/blog/on-the-line/restaurant-monthly-expenses). UK food and non-alcoholic beverage inflation was 3.7% year on year by March 2026 (BRC data via the press). — [Startups.co.uk](https://startups.co.uk/news/food-price-inflation-may/)

**Israel**
- Globes (circa 2021–22, before the war): reaching profitability needs much higher turnover; profitability "is small and reaches no more than 15%," and the 15–20% of the past "will no longer be possible." The margin definition is unclear and is probably before owner pay. [Press | Israel | ~2022] — [Globes](https://www.globes.co.il/news/article.aspx?did=1001401562)
- One Israeli restaurant lost about **₪641k in 2022**. Its food purchases were about **₪3M, "less than a third of total expenses."** [Press, single case | Israel | 2022] — [Ynet](https://www.ynet.co.il/economy/article/yokra14206911)
- Restaurant association: the sector runs on **single-digit margins**; Ontopo reservations in central Israel were down about **30%**. Chair Yakir Lisitzky predicted in late 2024 that "**35%** will disappear by end of December." That was a projection, not an outcome. [Trade association via press | Israel | 2024] — [Mako](https://www.mako.co.il/news-business/news/Article-6d9756f568e5391027.htm); [Walla](https://finance.walla.co.il/item/3686466)
- **Restaurant closures in Tel Aviv rose more than 22% in 2025 versus 2024.** [Press | Israel | 2025] — [Israel Hayom](https://www.israelhayom.co.il/magazine/shishabat/article/14281062)
- During the June 2025 conflict, about **70%** of food and beverage service businesses reported minimal operations or temporary closure. [Press survey | Israel | Jun 2025] — [Mako](https://www.mako.co.il/finances-news/Article-e1b32fbe0b5c791027.htm)
- Knesset Research Center: the restaurant sector has high churn, with openings and closures common even outside crises. [Government research | Israel | ~2023–24] — [Knesset MMM](https://fs.knesset.gov.il/globaldocs/MMM/ad6da6f3-c7ff-ed11-815c-005056aa4246/2_ad6da6f3-c7ff-ed11-815c-005056aa4246_11_20240.pdf) (the extracted text was garbled, so no food-cost % could be pulled from it)

### Inferences
**A leak on food spend, translated into share of sales and share of pre-tax profit.** These are my calculations from the NRA medians above. Each cell shows the leak as a share of sales, then as a share of median pre-tax profit.

| Segment (food %, margin) | 1% leak | 1.5% leak | 2% leak |
|---|---|---|---|
| Full-service ≥$2M (31.0%, 4.3%) | 0.31% → **7%** | 0.47% → **11%** | 0.62% → **14%** |
| Full-service <$2M (33.7%, 1.1%) | 0.34% → **31%** | 0.51% → **46%** | 0.67% → **61%** |
| Limited-service (32.4%, 4.0%) | 0.32% → **8%** | 0.49% → **12%** | 0.65% → **16%** |
| Full-service median (2.8% margin, 31–33.7% food) | ≈0.32% → **11–12%** | ≈0.49% → **17–18%** | ≈0.65% → **22–24%** |

- At UK top-100 margins of about 1.53% (204/13,300) and a 30% food cost, a 1.5% leak is about 0.45% of sales, **roughly 29% of profit**.
- **Israeli ICP (from internal `docs/GTM.md`, not external data):**
  - At ₪80k–₪400k of food purchasing a month, a 1.5% leak is ₪1,200–₪6,000 a month (₪14.4k–₪72k a year).
  - If Israeli food cost resembles the US 31–34% (unverified), that spend implies about ₪240k–₪1.3M of monthly sales.
  - In a sector described as running on single-digit margins after a closure wave, this could be a meaningful share of an owner's profit.
- **Pitch implication:** frame the leak as a share of **profit**, not of purchasing. "1.5% of purchasing" sounds small. "About a fifth of your profit, and nearly half if you're a small full-service place" is the number that dramatizes the ₪.

### Gaps
- No reliable 2024–26 Israeli benchmark for food cost as a % of sales or for net margin. The best leads are CBS (הלמ"ס) service-industry surveys, the restaurant association (איגוד המסעדות והברים), and the Knesset MMM document (it couldn't be parsed here).
- No continental EU (e.g. Germany, France) restaurant margin or food-cost benchmark was found.
- NRA SOI 2026 "42% unprofitable" is second-hand.

---

## 3. Case studies and ROI claims from restaurant AP vendors and recovery-audit firms: vendor claims versus independent evidence

### Takeaway
Vendors argue mostly from aggregate customer-data "benchmarks" (Ottimate), testimonials (MarginEdge), or unexplained headline percentages (Back Office). **I found no independent, audited study of savings from restaurant AP or invoice-matching software.** The independent evidence covers only the size of the problem (NRA margins, the 2015 Consolidated Concepts invoice study, UHY margins), not whether the software solves it.

### Cited Findings
**Vendor-claimed**
- **Ottimate:** the restaurant, grocery and hotel figures in §1. All come from customer invoice data, with no external audit. [VENDOR | US | 2025–26] — [Ottimate restaurant report](https://ottimate.com/blog/the-restaurant-ap-automation-benchmark-report-summer-2026-edition/); [Ottimate grocery](https://ottimate.com/industry/grocery/). Ottimate also stresses that a small per-case price increase persists on every later invoice, which is its argument for line-item checks. — [Ottimate AP benefits guide](https://ottimate.com/blog/the-complete-guide-to-ap-automation-benefits/); [Ottimate food invoice data](https://ottimate.com/blog/how-invoice-data-hidden-insights-food-cost-savings/)
- **MarginEdge:** the homepage relies on testimonials, not numbers, e.g. "just loading and coding the invoices is worth the monthly spent." [VENDOR | US | 2026] — [MarginEdge](https://www.marginedge.com/). Reviewers see ROI as depending on volume: it "could save you more than it costs each month if you have a large restaurant," and you need "enough invoice volume for the time savings to actually cover the cost." [Third-party opinion] — [FitSmallBusiness](https://fitsmallbusiness.com/marginedge-review/); [Forbes Advisor](https://www.forbes.com/advisor/business/software/marginedge-review/)
- **Back Office (bepbackoffice):** customers see "an average **14% net profit increase** in year one and a **2–4% labor cost reduction**," with no methodology given. [VENDOR | US] — [Back Office](https://bepbackoffice.com/blog/save-time-and-money-with-back-office-restaurant-technology/)
- **xtraCHEF (Toast):** a feature description only. Applying a vendor credit to an invoice adjusts the invoice total automatically. No outcome data found. — [Insightful Accountant](https://insightfulaccountant.com/niche-markets/restaurants-accounting/vendor-management-best-practices-for-your-restaurant-account/)
- **Choco:** described as supporting invoice intake and matching to reduce receiving and procurement discrepancies. **No quantified results found.** — [WifiTalents roundup](https://wifitalents.com/best/restaurant-purchasing-software/)
- **PRGX (recovery audit):** 0.8–2%+ of disbursements are erroneous, and about $1M is recovered per $1B of spend (see §1). [VENDOR] — [PRGX](https://www.prgx.com/guides/ap-recovery-audit-services-guide/)
- **FinBot (Israel):** claims 97% AI scan accuracy with human review. [VENDOR | Israel] — [FinBot](https://www.fin-bot.co.il/)
- Unverified "Meridian" case: 90 days, $4.2k flagged, $3.8k recovered (see §1). — [US Tech Automations](https://ustechautomations.com/resources/blog/restaurant-inventory-automation-case-study-2026)

**Independent or less interested**
- NRA operations data (margins and food cost, §2). — [NRA](https://restaurant.org/research-and-media/research/restaurant-economic-insights/analysis-commentary/restaurant-operators-kept-food-cost-ratios-in-check-in-2024/)
- UHY Hacker Young UK margins (§2). — [The Caterer](https://www.thecaterer.com/news/profitability-nearly-halves-across-uks-top-100-restaurant-groups)
- Consolidated Concepts 2015 invoice study (§1). The firm is a purchasing partner rather than a software vendor, but it still benefits commercially from showing overcharges. — [FSR Magazine](https://www.fsrmagazine.com/industry-news/overcharges-continue-show-restaurant-invoices/)
- A 2019 Hospitality Technology study (supported by Restaurant365) found that many restaurant brands under-invest in technology for accounting, and that operators prefer a single view of their data. [Vendor-sponsored research | US | 2019] — [Restaurant365 blog](https://www.restaurant365.com/blog/what-restaurant-decision-makers-think-about-the-future-of-restaurant-accounting/)

### Inferences
- The category's evidence is weak: big aggregate dollar totals (e.g. $321M of duplicates prevented) without a denominator, so they can't be turned into a % of spend. **A transparent, per-restaurant figure that shows the denominator** ("₪X found out of ₪Y purchased, line by line, with the invoice image") would stand out against that.
- Recovery-audit pricing (a contingency share of what is recovered) is the established way to get paid for found money. It shows that "pay from what we find" is a buyer-familiar structure for a pilot or guarantee.
- Because Rivhit DOCS sells basic invoice scanning in Israel at about ₪30 a month (see §5), **OCR capture alone is commoditized**. The ₪ value has to come from line-level PO↔GR↔invoice matching and credit tracking.

### Gaps
- No independent, controlled or audited ROI study of any restaurant AP or invoice-matching tool (MarginEdge, R365, xtraCHEF, Ottimate, Choco, MarketMan).
- No named Israeli case study of invoice-leak recovery in restaurants.
- The full Ottimate restaurant report (price-variance and credit numbers for restaurants) could not be read.

---

## 4. Buying behaviour: independents versus small chains, price sensitivity, typical subscription prices, churn reasons, and what proof convinces

### Takeaway
US restaurant back-office and AP tools cost about **$150–$635+ per location per month** (MarginEdge lists $350). Operators feel cost pressure acutely, and fees are the most common complaint. I found **no rigorous willingness-to-pay, trial-conversion or churn-reason data** for this category. What vendors use as proof is testimonials, volume-based ROI and aggregate benchmarks. Recovery auditors use contingency fees.

### Cited Findings
**Prices (list or third-party, US)**
- **MarginEdge:** **$350 per location per month**, with unlimited invoice processing and no usage fees [VENDOR list price | US | 2026] — [MarginEdge](https://www.marginedge.com/).
  - About 10% off on annual billing, roughly $315 a month on a 12-month commitment. — [Cleo Pay](https://www.cleo-pay.com/blog/marginedge-vs-restaurant365-pricing-2026)
  - Older listings show $330. — [Tools for Humans](https://www.toolsforhumans.ai/ai-tools/marginedge)
  - A one-time setup fee of $250 per location is claimed by some sources and contradicted by others. — [DishCost](https://dishcost.com/blog/dishcost-vs-marginedge)
  - The Freepour (bar inventory) add-on is about $150 more, taking the total to roughly $500 per location. — [MenuForge](https://menuforge.ai/vs/marginedge.html); [DishCost](https://dishcost.com/blog/dishcost-vs-marginedge)
- **MarketMan:**
  - One Oct 2026 third-party source lists Starter **$249**, Growth **$299**, Enterprise from **$449** a month; it isn't clear whether these are per location. — [Restaurant Inventory Tools](https://restaurantinventorytools.com/restaurant-inventory-software-cost/)
  - Other sources give $199 and $239 starting prices and a **$500 onboarding fee**. — [FoodyOS](https://foodyos.com/us/blog/restaurant-inventory-management-software-2026); [RestroScout](https://restroscout.com/compare-restaurant-inventory-management-software)
- **xtraCHEF (Toast):** not publicly priced ("Available with add-on; additional fees may apply"). Third-party estimates run about **$149–$349 a month**. One G2 listing shows a rating of 2.4/5. — [RestaurantTools.ai](https://restauranttools.ai/tools/xtrachef); [Capterra](https://www.capterra.com/p/165935/xtraCHEF/)
- **Restaurant365:** custom quotes. Third-party estimates are about **$249–$635+ per location per month**, or $500–1,500+ a month. — [Restaurant Inventory Tools](https://restaurantinventorytools.com/best-restaurant-inventory-management-software/); [Cleo Pay](https://www.cleo-pay.com/blog/marginedge-vs-restaurant365-pricing-2026)
- **Toast POS:** a $69 plan "quietly becomes $200 to $400 a month" once the modules independents want are added, and **fees are the single most common complaint theme** in Capterra reviews. [Consultant blog | US | 2026] — [Certus AI](https://www.certus-ai.com/blogs/toast-pos-review)
- **Competitor positioning** (Cleo Pay, not neutral): per-location pricing "adds up quickly" for multi-unit groups. — [Cleo Pay vs MarginEdge](https://www.cleo-pay.com/compare/marginedge)

**Operator sentiment**
- Toast 2025 Voice of the Restaurant Industry: a blind survey of **712 US decision-makers running ≤16 locations**, 18 Apr – 13 May 2025, covering both Toast and non-Toast customers.
  - Inflation is the top pain point for **20%**.
  - Nearly half would raise menu prices if inflation keeps growing.
  - **86%** are comfortable using AI.
  - [VENDOR-commissioned survey | US | 2025] — [Toast 2025 VOI](https://pos.toasttab.com/blog/data/2025-voice-of-restaurant-industry-survey); [Restaurant Dive](https://www.restaurantdive.com/news/toast-survey-inflation-labor-traffic/802424/)
  - A secondary summary says 24% use AI forecasting daily and 41% are "extremely likely" to adopt it. — [Toast AI survey](https://pos.toasttab.com/blog/data/ai-in-restaurants)
- NRA, via a vendor blog: **52% of operators planned to add technology to back-office functions** (payroll, finance, compliance). This is secondary and the year is unclear. — [Back Office blog](https://bepbackoffice.com/blog/master-restaurant-accounting-with-technology/)
- Trials: most restaurant-specific platforms list no free plan or trial. Generic accounting tools (Wave, Zoho Books) do, and Dext offers a trial. — [Ramp](https://ramp.com/blog/accounting-software-for-restaurants); [SaaSRat](https://saasrat.com/blog/best-accounting-software-for-restaurants/)

**Independents versus chains**
- The R365 and MarginEdge pricing model is per location, and third parties note the cost rises steeply for multi-unit groups. — [Cleo Pay](https://www.cleo-pay.com/blog/marginedge-vs-restaurant365-pricing-2026)
- I found no source describing how the decision process differs between independents and chains.

### Inferences
- **Price positioning:** at any USD/ILS rate in the ₪3–4 range, MarginEdge's $350 is about ₪1,050–₪1,400 per location per month. RestoMatch Pro at ₪590 (internal `docs/GTM.md`) is therefore roughly 40–55% of the US category anchor. The local anchor is very different: basic Israeli invoice scanning costs about ₪30 a month (§5). The ₪590 has to be justified by the ₪ leak number, not by "we read invoices."
- **Proof that convinces:** the evidence suggests owners respond to concrete ₪ found more than to time saved. Reviewers tie MarginEdge's ROI to volume and time, which favours larger accounts, and Toast respondents list inflation and cost as their top pain. A "found ₪Z in six weeks" pilot, or contingency-style framing, is consistent with the recovery-audit precedent (see §3). This is an inference, not measured willingness to pay.
- **Structural churn risk:** in Israel the customer base itself churns (Tel Aviv closures up 22% in 2025, high sector turnover per the Knesset). In the US, 42% of operators were unprofitable (secondary). Some logo churn will be business failure, not product dissatisfaction, and should be tracked separately.

### Gaps
- No willingness-to-pay, conjoint or price-elasticity study for restaurant back-office or AP software.
- No churn-reason data (cancellation surveys, review mining) for MarginEdge, xtraCHEF, R365, MarketMan, Ottimate or Choco.
- No free-trial or pilot-to-paid conversion benchmarks for restaurant SaaS.
- No Israeli buying-behaviour data: who decides, how accountants influence the decision, typical Israeli SaaS spend per restaurant.
- No published Choco or Ottimate pricing found.

---

## 5. Accountants and bookkeepers as a channel: how AP tools partner with accounting firms, and evidence from Israel

### Takeaway
In the US, Restaurant365 runs a formal, certification-tiered accounting-partner programme, and MarginEdge markets itself to accountants as a way to "grow your client list without adding labor." In Israel, accountants' existing tools (Hashavshevet H-ERP, Rivhit DOCS, FinBot) already automate header-level invoice capture cheaply. At least one restaurant-focused bookkeeping firm sells supplier reconciliation as a service. So Israeli accountants are both the natural channel and a partial substitute.

### Cited Findings
**US**
- **Restaurant365:** has an accounting-partner programme with tiered training. Partners complete R365 Academy accounting courses, usually pass a core exam, and finish several full implementation cycles. The pitch is "growth insight without added overhead." [VENDOR | US | 2026] — [R365 accounting partners](https://www.restaurant365.com/request-demo-accounting-partners/)
  - Over Easy Office, a "certified Restaurant365 Partner with a dedicated team of R365 specialists," also lists **MarginEdge invoice-processing support** among its services. — [Over Easy Office](https://overeasyoffice.com/)
- **MarginEdge:** its accountant page says the platform lets accountants "grow their impact or client list without adding labor costs." It positions itself as the operational layer "between your POS and your accounting software," and integrates with QuickBooks, Xero, R365 and Sage Intacct. **No formal tiered partner or referral programme was found.** [VENDOR | US] — [MarginEdge for accountants](https://www.marginedge.com/lp/how-me-works-accountants)
- **Xero:** a broad accountant and bookkeeper partner programme, with a stated goal of 250,000 partners. This is the general-ledger precedent for channel scale. [VENDOR] — [Xero restaurants](https://www.xero.com/us/small-businesses/restaurants/)
- US accounting trade press runs content aimed at accountants serving restaurant clients, e.g. "Vendor management best practices for your restaurant accounting clients." — [Insightful Accountant](https://insightfulaccountant.com/niche-markets/restaurants-accounting/vendor-management-best-practices-for-your-restaurant-account/)

**Israel**
- **Hashavshevet H-ERP for practitioners (מייצגים):** an H-DOKKA module that automatically scans and enters purchase invoices with OCR/AI, decoding supplier details and amounts. [VENDOR | Israel] — [H-ERP CPA](https://www.h-erp.co.il/cpa/)
- **Rivhit DOCS:** **₪30 + VAT a month per company, for up to 150 expense documents a month**. It alerts when a document already exists in the journal entries (duplicate detection). [VENDOR list price | Israel] — [Rivhit DOCS](https://www.rivhit.co.il/%D7%9E%D7%95%D7%93%D7%95%D7%9C-%D7%94%D7%A0%D7%94%D7%9C%D7%AA-%D7%97%D7%A9%D7%91%D7%95%D7%A0%D7%95%D7%AA-%D7%9C%D7%9C%D7%90-%D7%A0%D7%99%D7%99%D7%A8%D7%AA/)
- **FinBot:** an AI-plus-human scanning SaaS for accounting firms, claiming 97% accuracy and linking to VAT reporting and advance payments. [VENDOR | Israel] — [FinBot](https://www.fin-bot.co.il/)
- Paperless and Webenfit are also named as offering remote scanning and automatic journal entries to accounting offices. [Blog | Israel | 2026] — [Achiya Automation](https://achiya-automation.com/blog/accounting-firm-automation/); [AutoDocs](https://autodocs.co.il/%D7%A1%D7%A8%D7%99%D7%A7%D7%AA-%D7%97%D7%A9%D7%91%D7%95%D7%A0%D7%99%D7%95%D7%AA-%D7%9C%D7%A8%D7%95%D7%90%D7%94-%D7%97%D7%A9%D7%91%D7%95%D7%9F-%D7%9B%D7%9A-%D7%A2%D7%95%D7%A9%D7%99%D7%9D-%D7%A1%D7%93/) (I couldn't confirm which of these two pages names them).
- **UNIT4** (Israeli bookkeeping for restaurants and franchisees) markets the following as its service:
  - monthly supplier reconciliations, which turned up dozens of unrecorded alcohol and meat invoices;
  - food-cost analysis;
  - full POS synchronisation.

  [Accounting firm | Israel] — [UNIT4](https://unit4.co.il/bookkeeping-restaurants/)
- Other Israeli SMB business-management and payments tools in the same space (not restaurant-specific). — [Payper](https://payper.co.il/); [Bluesky by MA](https://blueskybyma.co.il/online-bookkeeping-for-restaurants/)

### Inferences
- **What Israeli accountant tools already do:** header-level capture (supplier, totals, VAT) and duplicate detection, at about ₪30 a month. **What they don't appear to do** (per the extracts): line-level PO↔delivery-note↔invoice matching, price-versus-agreed-price checks, or blocking before payment. RestoMatch is complementary if it **exports into** Hashavshevet, Rivhit or Priority, rather than competing at the capture layer.
- **The channel offer:** R365's model (certification tiers, implementation track record) and MarginEdge's "more clients without more labor" show how US vendors recruit accountants. For an Israeli accountant handling 10–30 restaurants (the "מיכל" persona in internal `docs/ICP.md`), the matching offer is: full coverage instead of a monthly sample, plus a branded ₪ leak report the accountant can hand the owner.
- **Channel conflict risk:** firms like UNIT4 already bill for supplier reconciliation. The partner model has to let the accountant keep the advisory and billable layer, which internal `docs/GTM.md` §6.3 already anticipates.

### Gaps
- No found terms (revenue share, referral fee, reseller discount) for any restaurant AP vendor's accountant programme, including MarginEdge's.
- No evidence on how strongly an accountant's recommendation drives restaurant software purchases, in the US or Israel. No survey found.
- No data on the number of Israeli accounting firms that specialise in restaurants, or on how many restaurants each typically serves.
- Not researched in this pass: whether Israel's invoice reform (allocation numbers, "חשבוניות ישראל") or e-invoicing changes the supplier-invoice data available to accountants. It is worth a separate look.
