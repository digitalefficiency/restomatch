# ext-05: Ops automation and time benchmarks for impact estimates

**Date:** 2026-11-07. **Scope:** how much time restaurant people spend on back-office supplier work, how often supplier invoices go wrong, what "inventory intelligence" automations (par levels, theoretical vs actual, recipe cost auto-update, menu-price alerts) do, and what an hour costs in Israel in ₪. This gives RestoMatch defensible inputs for "hours saved → ₪" next to the leak ₪.

**What this note does not repeat.** The earlier report (`ניהול חשבוניות ספקים במסעדות/report.md`) already covers: Consolidated Concepts (35% of invoices with ≥1 overcharge, about 1% of invoice value), PRGX recovery audits (about 0.1% of spend comes back), NRA margin tables, and the competitor feature map. Sibling notes cover vendor "hours saved" headlines: ext-01 (SUMIT 72.8 h/month, Zestt about 30 h/month, MarketMan "100+ h"), ext-03 (R365 "650 h/yr", Plate IQ "530+ h/yr") and ext-04 (agent touchless claims). This note adds **time-and-motion baselines, error-rate benchmarks beyond Consolidated Concepts, the inventory-automation layer, and an Israeli wage table**.

**Method caveat.** WebFetch could not reach most target hosts in this session (toasttab.com, choco.com, drushim.co.il and synergysuite.com failed DNS under the session's network policy). Every figure below comes from WebSearch result snippets. I did not read the primary PDFs. "Date seen" is 2026-11-07 for all sources. Labels:
- **[V]**: vendor self-reported.
- **[S]**: secondhand citation of a third-party study.
- **[I]**: independent or official source.
- **UNVERIFIED**: no source found.

---

## 1. Time baselines: where the hours go

### 1.1 What exists (and what does not)

**No independent time-use study exists** that measures hours a week on invoices, ordering, receiving, counts and supplier disputes for independent restaurants, in the US or in Israel. Toast, 7shifts, the NRA and R365 publish no such hours-per-task figure that I could find. Toast's 2026 *Voice of the Restaurant* survey reports AI adoption (86% of operators "experimenting with AI"), not task hours ([Earnings Whispers on Toast survey](https://www.earningswhispers.com/article/TOST/2610068986)). Toast offers a "productivity calculator" spreadsheet for operators to log time on inventory and office work, but it publishes no benchmark ([Toast productivity calculator](https://pos.toasttab.com/vi-us/resources/productivity-calculator)). Treat every figure below as a **range from vendor estimates and case studies**, not a measured mean.

### 1.2 Task-by-task benchmark table

| Task | Benchmark | Who does it | Source / label |
|---|---|---|---|
| All back-office admin (manager) | 8–10 h/week on scheduling + admin; schedule building alone 3.7 h/week; 8.1 h/week average once compliance, reporting and problem-solving are added | Manager | Harri data via [QSR Magazine](https://www.qsrmagazine.com/story/why-ai-scheduling-has-become-a-restaurant-necessity/) [V, 2025–26] |
| Scheduling only | 3.14 h/week (spreadsheet), 2.21 h/week (pen and paper) | Manager | [Timeforge](https://timeforge.com/?p=2137) [V, undated] |
| Inventory counting | 4–6 h/week; 10–12 h/week with ordering included; 15–20 h/week "manual inventory" | Manager / chef | [SynergySuite "Manager Time Audit"](https://www.synergysuite.com/?p=13266) [V, no dataset] |
| Admin / purchasing / counting / invoices | About 6 h admin, about 4 h supplier purchasing and calls, about 2 h counting, about 2 h supplier invoices per week | Owner-operator | [KitchenNmbrs](https://kitchennmbrs.app/en/knowledge-base/kitchennmbrs-context/how-much-time-typing-copying-and-pasting-could-you-cut-from-your-week) [V, updated Mar 2026] |
| Ordering | About 3 h/day → under 1 h/day after MarketMan (one group) | Chef / manager | [MarketMan Pine State Biscuits](https://www.marketman.com/case-study/how-pine-state-biscuits-streamlined-operations-and-reclaimed-hours-each-day-with-marketman) [V] |
| Inventory count | 1.5 h/week → 20 min; −60% (Ashley Mac's); −85% (Café Crêpe) | Manager | [MarketMan](https://marketman.com/restaurant-inventory-management); [casestudies.com Ashley Mac's](https://www.casestudies.com/company/marketman/case-study/ashley-macs-reduces-inventory-counting-time-by-60-with-marketman); [Café Crêpe](https://www.casestudies.com/company/marketman/case-study/how-marketman-touchbistro-pos-helped-this-restaurant-reduce-time-spent-on-inventory-by-85) [V] |
| Receiving check per delivery | About 90 s (spot check) / 2–3 min (basic) / 20–30 min (rigorous); "5–8 deliveries a day → 30–40 min/day verification"; about 5 min per invoice once routine | Whoever is on shift | [Supy receiving guide](https://supy.io/blog/learn-restaurant-food-receiving-procedure), [nineguides](https://nineguides.pages.dev/operations/vendor-delivery-receiving), [KitchenNmbrs](https://kitchennmbrs.app/en/knowledge-base/daily-control/what-routine-helps-you-see-right-away-with-every-delivery-if-prices-match-your-agreement) [V, low authority] |
| Manual AP touch time | 10–15 min per invoice fully manual (IOFM average 12.5 min); a clerk does 5–10 invoices/hour; automated extraction under 2 min of human touch | Bookkeeper | IOFM via [imagetotable benchmark page](https://imagetotable.ai/references/invoice-processing-time-benchmark) [S, 2026] |
| Israeli paperwork guidance | Set aside "half an hour to an hour a day, or several times a week" for financial paperwork | Owner | [eastwest-food (HE)](https://eastwest-food.co.il/restaurant-transaction-invoice/) [V/advice] |
| Israeli typing time | "5 hours a week of typing vs 5 minutes" in its system | Owner / bookkeeper | [Payper (HE)](https://payper.co.il/) [V] |
| Small-business admin, general | 45% of small-business owners spend "nearly a day a week" on admin | Owner | [When I Work](https://wheniwork.com/blog/back-office-tips-for-restaurants) [S] |
| Which tasks feel worst | Ordering and inventory rank among the most time-consuming tasks next to cooking and cleaning. Two in three name inventory, ordering, scheduling, hiring or accounting as the biggest time sink (2021, n=140) | Operators | [Choco survey](https://choco.com/us/stories/time-management-restaurants-work-survey) [V-run survey, 2021] |

### 1.3 Synthesis for the RestoMatch ICP

For an Israeli owner-operator with 1–3 branches, the evidence supports a **working range** of:
- 2–5 h/week of invoice handling (entry, matching, filing);
- 2–6 h/week of inventory counting;
- 3–10 h/week of ordering (calls, WhatsApp, Zestt);
- 0.5–1 h/day of receiving checks.

That totals about **10–25 h/week of supplier-related back-office work, spread across owner, chef/manager and the external bookkeeper**. This range is **our synthesis of vendor estimates and is UNVERIFIED for Israel.** No Israeli survey measures it. Supplier-dispute time (calls, chasing credits) has **no benchmark at all**: UNVERIFIED.

**Lesson (copy/avoid/leapfrog).**
- *Avoid* quoting any of these as "industry averages". They are vendor estimates, and a skeptical owner (or the leak-economist gate) will see through them.
- *Leapfrog:* RestoMatch can **measure its own time baseline from telemetry**: minutes from upload to approval per document, minutes per receiving session, and how many lines needed human touch. It can then publish "your restaurant spent X min on supplier docs this month" as a measured number. No competitor publishes measured per-customer time. Everyone publishes testimonials.

---

## 2. Error and leak rates beyond Consolidated Concepts

### 2.1 Benchmarks found

| Error type | Rate | Notes | Source / label |
|---|---|---|---|
| Invoice line billed away from the agreed price | **22.7% of invoices** have ≥1 such line (1,265,531 invoices / 6.4M lines). By line: produce 10.0%, seafood 9.8%, meat/poultry 9.1%, all categories 6.6%. Overbilling is far more common than underbilling | Largest dataset found; platform data from Supy customers (multi-site, Gulf/UK-heavy) | [Supy "The Spread" 2026](https://supy.io/the-spread) [V, 2026] |
| Same product, same supplier, same month: price spread across buyers | Median gap **32%** | Shows that "agreed price" differs widely between customers, which supports per-customer contract-price checks | [Supy "The Spread"](https://supy.io/the-spread) [V, 2026] |
| Vendor invoices with billing errors (all industries) | About 39% | IOFM, cited secondhand; not restaurant-specific; not verified | via [Vellum blog](https://www.vellum.ai/blog/how-to-catch-restaurant-vendor-price-creep) [S] |
| Typical restaurant invoice discrepancy rate | 2–4% | xtraCHEF research cited secondhand; definition unclear | via [ustechautomations](https://ustechautomations.com/resources/blog/restaurant-inventory-automation-case-study-2026) [S, low authority] |
| Where discrepancies concentrate | 71% in proteins + produce (one group, 2-month audit) | Single anecdote, consistent with Supy's category split | [Phacet](https://www.phacetlabs.com/blog/restaurant-invoice-validation) [V] |
| Duplicate / erroneous payments | 0.8% of disbursements (top performers) to >2% (bottom quartile); median 1.5% (2024) | APQC Open Standards Benchmarking; **share of payment count, not ₪ value**; cross-industry | [CFO.com / APQC](https://www.cfo.com/news/metric-of-the-month-detect-and-prevent-duplicate-or-erroneous-payments/) [I]; median via [Corpay](https://www.corpay.com/resources/blog/duplicate-payment) [S] |
| AP exception rate (invoices that cannot auto-pass) | 2025: about 14% average / 9% best-in-class. 2026: **19.9% average / 11.8% best-in-class** | Ardent Partners, cross-industry | [Tungsten](https://www.tungstenautomation.com/blog/ai-in-accounts-payable-metrics-that-matter) [S]; [Medius / Ardent 2026](https://www.medius.com/resources/guides-reports/ardent-partners-accounts-payable-metrics-that-matter/) [S] |
| Touchless (straight-through) rate | About 49–53% best-in-class; about 25% average | Ardent Partners 2025 | [Tungsten](https://www.tungstenautomation.com/blog/ai-in-accounts-payable-metrics-that-matter); [StealthAgents](https://stealthagents.com/research/ai-accounts-payable-automation-statistics) [S] |
| Cost to process one invoice | $9.40 average / $2.78 best-in-class (2025). $9.90 / $2.67 (2026) | Fully loaded, cross-industry | [WEX](https://www.wexinc.com/resources/blog/what-does-it-cost-to-process-an-invoice-ap-benchmarks-every-finance-team-should-know/); [Medius](https://www.medius.com/resources/guides-reports/ardent-partners-accounts-payable-metrics-that-matter/) [S] |
| Short delivery (distributor fill rate) | Chain contracts set **99.5–99.7%** fill rate as the acceptable floor. That implies short-shipment under 1% of cases for *chains with contracts* | No survey of independents; the real rate for small Israeli suppliers is UNVERIFIED | [Law Insider distributor agreement](https://www.lawinsider.com/contracts/jgnbpdjkrQx); [Justia (CKE)](https://contracts.justia.com/companies/cke-restaurants-inc-32982/contract/817089) [I, contracts] |
| Credits never received / credit-claim recovery rate | **UNVERIFIED.** No source gives the share of vendor credits that never arrive. Supy claims "most groups recover meaningful credit notes within the first 60–90 days" [V] | Mechanism is documented: credits arrive as separate paperwork and get lost before the next pay run | [Supy invoices / credit notes](https://supy.io/product-features/invoices-credit-notes); [restaurant statement reconciliation guide](https://invoicedataextraction.com/blog/restaurant-supplier-statement-reconciliation) [V] |

### 2.2 What this means for the North-Star ₪

- The two large datasets point the same way: Consolidated Concepts (earlier report, 35% of invoices) and Supy (22.7% of invoices, 6.6% of lines). Price-off-agreement is common, and it is **concentrated in produce, fish and meat**. These are also the variable-weight categories (see the earlier report's catch-weight item 13).
- None of these sources gives a **₪-weighted leak %** for independents. The 1.5% North-Star remains a target, not a benchmark. Consolidated Concepts' "about 1% of invoice value" is still the only value-weighted restaurant figure.
- The gap between **found** and **recovered** stays unmeasured. RestoMatch's "found / blocked / credited" triple (earlier roadmap item 5) would be the first measured recovery rate for this segment. That is a publishable asset.

**Lesson.**
- *Copy* Supy's category breakdown as a **receiving priority rule**: check produce, seafood and meat lines first, and accept a spot check on dry goods.
- *Copy* Ardent's exception rate as an internal KPI. Target ≤12% of documents needing human touch (best-in-class 2026). Report it honestly.
- *Avoid* stacking secondhand rates (39%, 2–4%) into marketing.
- *Leapfrog:* nobody publishes a credit **recovery rate**. Measure and show it.

---

## 3. The inventory-intelligence automation layer

### 3.1 Patterns, triggers and human confirmation

| Pattern | Trigger → action | What humans still confirm | Claimed outcome (label) | Lesson for RestoMatch |
|---|---|---|---|---|
| **Vendor price alert** (MarginEdge) | Invoice processed → vendor-item unit price above a user threshold → email alert. Thresholds are set per *vendor item*, not per product | Threshold setup; whether to dispute | No outcome figure. Users complain that setup is tedious, alerts cannot be bulk-selected, and product mapping needs "almost daily" maintenance ([GetApp](https://www.getapp.co.uk/software/120387/marginedge)) | **Copy** the trigger. **Leapfrog** the setup: default thresholds come from contract price / last-3-invoice median, so the owner configures nothing. Route the alert into the claim flow, not just email. Source: [MarginEdge price alerts](https://www.marginedge.com/price-alerts) [V] |
| **Recipe cost auto-update** (MarginEdge, Toast IQ Inventory) | New invoice price → recipe/plate cost recalculated. Toast computes plate cost from current unit costs, with inventory value on FIFO | Recipe build (the expensive part); unit conversions | No time or ₪ figure published | **Copy later** (earlier roadmap item 12). Recipes are a large setup tax. Gate it behind the leak value. Sources: [MarginEdge](https://www.marginedge.com/how-it-works); [Toast IQ Inventory overview](https://support.toasttab.com/en/article/Toast-IQ-Inventory-Overview) [V] |
| **Plate / pour cost alert** (MarginEdge Q3 2025) | Dish plate cost leaves the target range → real-time alert | Target range; menu price decision | Not published | **Leapfrog**: express it as "this supplier's price rise costs you ₪X/month on dish Y at last month's sales". That ties price creep to the ₪ hero number. Source: [MarginEdge Q3 2025 release notes](https://www.marginedge.com/blog/q3-2025-product-release-notes) [V] |
| **Theoretical vs actual (AvT)** (R365, Toast, MarketMan) | POS sales × recipes = theoretical usage; minus (opening + purchases − closing count) → variance by item | Counts; recipe accuracy; investigating causes | Rule of thumb: within **2 percentage points** is "in line" ([Restaurant Business](https://restaurantbusinessonline.com/theory-relativity-part-two)) [I, trade press]. R365 sample gap 3.4% of sales ≈ $102k/yr on $3M ([R365](https://www.restaurant365.com/restaurant-inventory-software-food-cost-control)) [V]. California Fish Grill ≥1% food-cost saving ([R365 case](https://www.restaurant365.com/resources/california-fish-grill-save-1-in-food-costs-at-its-34-locations-thanks-to-restaurant365-reporting-tools/)) [V]. Eli's about 2.5–3% theoretical food cost improvement ([R365 case](https://www.restaurant365.com/resources/elis-restaurant-group-recoups-1-1-million-prime-cost-gap-during-pandemic-with-restaurant365/)) [V] | **Avoid for v1.** AvT needs counts, recipes and POS mapping: a heavy lift for a 1–3 branch owner. RestoMatch's supplier-side leak is upstream of AvT and needs none of that. Position as "the purchases number in your AvT is correct". |
| **Par-level / suggested ordering** (MarketMan, Supy, Toast) | Count or POS depletion + par → suggested PO; forecasts adjust pars (by day of week in better systems) | Approving the PO; editing quantities | Waste cut 18–31% *only once* costed recipes and pars exist ([hospitalidad.ai](https://hospitalidad.ai/EN/restaurant-inventory-automation-myth-vs-reality-2026.html)) [V, low authority]. "30–40%" AI forecasting claims ([ordering.co](https://www.ordering.co/blog/innovations-to-watch-new-ai-features-transform-restaurants/)) [V, no primary study]. Ordering time 3 h → <1 h/day (MarketMan case above) [V] | **Avoid building forecasting.** It competes with Zestt / Restigo on their home ground. **Copy the cheap part:** pars from order history, which give an expected quantity per line. That feeds the *receiving* check ("ordered 10, usual 10, delivered 8") and doesn't require us to place orders. |
| **Camera / scale waste tracking** (Winnow) | Bin weigh + camera → waste by item | Tagging edge cases | 21–38% kitchen waste reduction (WRAP 2025, cited); 53% average across 3,000+ kitchens (Frontiers in AI, Jan 2025, cited) | **Out of scope** (food waste ≠ supplier leak). It is evidence, though, that *weight* captured at a moment of truth changes behaviour. That supports a scale-photo receiving pattern. Source: via [Supy waste blog](https://supy.io/blog/using-ai-to-reduce-food-waste-real-results-from-multi-site-restaurant-operators) [S] |
| **Israeli food-cost tooling** (Restigo) | Supplier price list updated in real time; dish cost fields (with/without VAT) linked to supplier products in the API | Recipe link | "Up to 8% savings on FOOD COST and LABOR" [V]. No documented price-change → dish-cost alert found | **Leapfrog** in Israel: no Israeli tool documents an automatic "supplier raised price → ₪ impact per dish" alert. Sources: [Restigo food cost (HE)](https://www.restigo.co.il/%D7%A4%D7%95%D7%93-%D7%A7%D7%95%D7%A1%D7%98/); [Restigo API](https://www.restigo.co.il/xml-%D7%A9%D7%9C%D7%99%D7%97%D7%AA-%D7%94%D7%96%D7%9E%D7%A0%D7%94-%D7%9C%D7%A1%D7%A4%D7%A7/api4-2/) [V] |
| **Food cost % benchmark** | Restaurants about 30%, fast food about 25% (Restigo). General 28–35% | n/a | n/a | Use it only to sanity-check the onboarding food-spend estimate. Sources: [Restigo (HE)](https://www.restigo.co.il/%D7%A4%D7%95%D7%93-%D7%A7%D7%95%D7%A1%D7%98/); [Supy](https://supy.io/blog/learn-food-cost-percentage) [V] |

### 3.2 Design takeaway

The inventory-intelligence layer (AvT, pars, recipe costing) promises 1–3% of food cost in vendor case studies. It is the same order of magnitude as the supplier leak, but it carries a **large setup tax** (recipes, counts, POS mapping) and its evidence is vendor-only. Supplier-invoice leak detection needs only documents the owner already has. The automation sequencing that follows is:
1. Invoice / delivery-note leak (no setup).
2. Price-creep → ₪/month alert per supplier item (no recipes needed).
3. Price creep × recipe × POS sales = ₪ per dish (needs recipes; later).
4. AvT / pars (maybe never; partner with Zestt / Restigo instead).

---

## 4. Israeli labor cost per hour (to convert hours → ₪)

### 4.1 Wage inputs (2025–2026)

| Role | Monthly gross (₪) | Hourly (gross ÷ 182 h) | Source / label |
|---|---|---|---|
| Minimum wage (from 1 Apr 2026) | 6,443.85 | **35.40** (182 h basis; 34.64 on NII's 186 h basis) | [Bituach Leumi](https://www.btl.gov.il/MEDINIYUT/GENERALDATA/Pages/%D7%A9%D7%9B%D7%A8%20%D7%9E%D7%99%D7%A0%D7%99%D7%9E%D7%95%D7%9D.aspx); [Malam payroll](https://www.malam-payroll.com/%D7%A2%D7%93%D7%9B%D7%95%D7%9F-%D7%A9%D7%9B%D7%A8-%D7%9E%D7%99%D7%A0%D7%99%D7%9E%D7%95%D7%9D-%D7%91%D7%9E%D7%A9%D7%A7-%D7%9E%D7%90%D7%A4%D7%A8%D7%99%D7%9C-2026/) [I] |
| Accommodation & food services, average per *job* (heavily part-time) | 5,807 (Jun 2025) – 6,566 (Aug 2025); 2024 annual 6,307 | n/a (part-time skews it) | CBS via [Davar](https://www.davar1.co.il/637713/), [ICE](https://www.ice.co.il/research/news/article/1054136) [I] |
| Shift manager | Average 9,187 (AllJobs); job ads ₪40–45/h (cafés), ₪65–70/h (TLV chef restaurant) | ≈ 50 | [AllJobs shift manager](https://www.alljobs.co.il/User/SalaryCompound/position/?JobCategoryID=1346); [JobRest ad](https://www.jobrest.co.il/job/service/%D7%9E%D7%A0%D7%94%D7%9C%D7%99-%D7%95%D7%AA-%D7%9E%D7%A9%D7%9E%D7%A8%D7%AA-%D7%9C%D7%9E%D7%A1%D7%A2%D7%93%D7%AA-%D7%A9%D7%A3-%D7%9E%D7%A6%D7%9C%D7%99%D7%97%D7%94-%D7%91%D7%AA%D7%9C-%D7%90%D7%91%D7%99/) [V, ads] |
| Restaurant manager | Ads 15,000–18,000 (chain, Jerusalem); 16,000–17,000; a TLV ad "up to 28–30k, performance-based"; work.co.il table 11,500–12,500 | ≈ 66–99 (82 at ₪15k) | [AllJobs ad](https://www.alljobs.co.il/m/p/jobs/8763387); [work.co.il (Mar 2026)](https://work.co.il/salary/industries/restourant) [V] |
| Sous chef | Average 12,867 (AllJobs); TLV ad 18,000–20,000 | ≈ 71 | [AllJobs sous chef](https://www.alljobs.co.il/User/SalaryCompound/position/?JobCategoryID=1349) [V] |
| Chef | Average 18,519 (AllJobs); work.co.il 13,500–15,000 (≤1 yr) | ≈ 102 | [AllJobs chefs](https://www.alljobs.co.il/User/SalaryCompound/position/?JobCategoryID=843) [V] |
| Bookkeeper (salaried) | 9,000–11,000 (first 2 yrs); 13,000–16,000 (closes the month alone, 4–6 yrs); 21,000–25,000 (chief) | ≈ 49–88 (71 at ₪13k) | [Bizportal (2026 data)](https://www.bizportal.co.il/career/news/article/20039783) [V/press]; [study.co.il](https://www.study.co.il/%D7%A9%D7%9B%D7%A8-%D7%94%D7%A0%D7%94%D7%9C%D7%AA-%D7%97%D7%A9%D7%91%D7%95%D7%A0%D7%95%D7%AA/) |
| External bookkeeping (outsourced) | Package ₪300–800/month (small self-employed); ₪500–1,200/month (licensed dealer, no employees). Ad-hoc CPA advice ₪250–500/h | n/a | [financecheck](https://financecheck.co.il/self-employed/accountant-cost/); [infinityfinance](https://infinityfinance.co.il/blog/%D7%9B%D7%9E%D7%94-%D7%A2%D7%95%D7%9C%D7%94-%D7%94%D7%A0%D7%94%D7%9C%D7%AA-%D7%97%D7%A9%D7%91%D7%95%D7%A0%D7%95%D7%AA-%D7%9C%D7%A2%D7%A1%D7%A7-%D7%A7%D7%98%D7%9F-%D7%94%D7%9E%D7%93%D7%A8%D7%99%D7%9A) [V] |

The per-hour rate for an Israeli freelance bookkeeper billing a restaurant is **UNVERIFIED**. No published hourly rate card was found, and restaurant bookkeeping packages for businesses with employees are not published.

### 4.2 Employer on-cost

- **Pension, severance and disability:** 6.5% pension + 6% severance + 2.5% disability-insurance cover. On that basis total cost ≈ gross × **1.15–1.20**, excluding National Insurance ([olam-haavoda calculator](https://olam-haavoda.co.il/EmployerCostCalculator)).
- **National Insurance (employer):** 3.55% (some sources say 4.51%) up to ₪7,703, then 7.6% ([Bizportal employer cost 2026](https://www.bizportal.co.il/additives/395/employer-cost-2026.html)).
- **At minimum wage:** jobcalc puts total on-cost at 25–31% over gross ([jobcalc](https://jobcalc.co.il/salary/employer-cost/minimum-wage/)).

**Working multiplier: ×1.25** (our rounding, within the cited 1.15–1.31 band).

### 4.3 Loaded hourly rates to use in impact estimates (our arithmetic)

| Role | Gross base used | Gross ₪/h | Loaded ₪/h (×1.25) |
|---|---|---|---|
| Shift manager | 9,187 | 50 | ≈ 63 |
| Bookkeeper (mid) | 13,000 | 71 | ≈ 89 |
| Restaurant manager | 15,000 | 82 | ≈ 103 |
| Chef | 18,519 | 102 | ≈ 127 |
| Owner's own hour | n/a | n/a | **UNVERIFIED**. Use the manager rate (≈ ₪100/h) as a conservative floor |

### 4.4 Worked example: hours vs leak for the ICP

These figures illustrate method only; they are not claims.

- **Leak.** Food spend ₪250k/month × 1.5% = **₪3,750/month** of leak surfaced. At Consolidated Concepts' measured about 1%, it is ₪2,500.
- **Invoice-handling time.**
  - Document volume: assume 100 supplier documents a month (invoices + delivery notes). **UNVERIFIED for Israel.** The earlier notes did not measure it.
  - Touch time: 100 × 12.5 min (IOFM manual) ≈ 21 h. Automation to under 2 min/doc saves about 17–18 h.
  - Value: about 18 h × ₪89 (bookkeeper) ≈ **₪1,600/month**. But this is mostly *external bookkeeper* time, already paid as a flat ₪500–1,200 package. The owner may see no cash saving.
- **Receiving time.** 30 min/day × 26 days ≈ 13 h/month at shift-manager ₪63 ≈ ₪820. RestoMatch may *add* receiving time (evidence capture), not save it.

**Conclusion:** time savings in ₪ are **smaller than the leak and less bankable**. The time ₪ splits across people, and the bookkeeper's fee is often fixed. That backs AGENTS.md's North Star: lead with leak ₪ and show hours as secondary context. Never add the two together into one hero number. This also matches ext-01's lesson: Israeli "hours saved" headlines (72.8 h, 100+ h) are unverifiable.

---

## 5. Lessons for RestoMatch automation design

1. **Copy: receiving priority by category.** Supy's line-level data says produce (10%), seafood (9.8%) and meat (9.1%) are billed off-agreement 1.4–1.5× more often than average. Default the receiving wizard and the review queue to show these lines first. Keep the 90-second check for everything else. This turns the "receiving takes 20–30 min" objection into "about 3 minutes on the lines that matter".
2. **Copy: Ardent-style exception-rate KPI.** Track *% of documents needing human touch* and *median minutes per document* from telemetry. Benchmarks: best-in-class 11.8% exceptions (2026), 49–53% touchless. Show it on the admin dashboard, not to owners.
3. **Copy: duplicate guard as a cheap, high-trust win.** Even top-quartile AP shops have 0.8% duplicate or erroneous disbursements by count. A same-supplier, same-amount, ±N-day check before the payrun is near-zero setup.
4. **Avoid: vendor "hours saved" headlines and AvT / forecasting in v1.** The time evidence is vendor-only. AvT and pars need recipes, counts and POS mapping that 1–3 branch owners don't maintain (MarginEdge users report near-daily maintenance).
5. **Leapfrog: price-creep → ₪/month projection without recipes.** A delta of unit price × the trailing 3-month quantity for that supplier item = ₪/month impact. It needs only invoices we already parse. Add the per-dish view once recipes exist.
6. **Leapfrog: the first measured recovery rate.** No source publishes a credit-claim recovery rate (found → credited). RestoMatch's found / blocked / credited triple, aggregated anonymously, becomes a market-first benchmark and a sales asset.
7. **Leapfrog: measured time ledger in ₪.** Telemetry minutes × the Israeli loaded rate table (§4.3), shown as "this month RestoMatch handled N documents. Manual handling would have taken ≈ X h ≈ ₪Y". Label it as an estimate, keep it separate from leak ₪, and expose the rate table so the owner can edit it.
8. **Use pars only as expected quantities.** Order-history medians per supplier item give the receiving check an "expected" value even when no PO exists. That covers the WhatsApp-order gap without our building ordering.

---

## 6. UNVERIFIED / gaps

- Israeli hours per week on invoices, ordering, receiving, counts or supplier disputes. No survey found, only advice and vendor claims (eastwest-food, Payper, Zestt).
- Supplier-dispute and credit-chasing time: no benchmark anywhere.
- Credit-claim recovery rate (found vs credited): none.
- Short-delivery rate for independents or Israeli suppliers: none (only chain contract fill-rate floors of 99.5–99.7%).
- Israeli freelance bookkeeper hourly rate: none published.
- Monthly supplier-document volume for an Israeli 1–3 branch restaurant: none. The "100 docs" in §4.4 is an illustrative assumption.
- Toast IQ inventory / recipe time savings: none published. The product was still rolling out (May 2026 "first look", Aug 2026 demo).
- The primary APQC and Ardent reports were not read. Figures come from secondary vendor blogs, and some disagree (2025 average cost $9.40 vs $10.89; average exception rate 14% vs 22%).

## Sources (all seen 2026-11-07)

- Harri via QSR Magazine: https://www.qsrmagazine.com/story/why-ai-scheduling-has-become-a-restaurant-necessity/
- Timeforge scheduling stats: https://timeforge.com/?p=2137
- SynergySuite manager time audit: https://www.synergysuite.com/?p=13266
- KitchenNmbrs time estimate (Mar 2026): https://kitchennmbrs.app/en/knowledge-base/kitchennmbrs-context/how-much-time-typing-copying-and-pasting-could-you-cut-from-your-week
- Choco time-management survey (2021): https://choco.com/us/stories/time-management-restaurants-work-survey
- When I Work back-office: https://wheniwork.com/blog/back-office-tips-for-restaurants
- Toast survey via Earnings Whispers: https://www.earningswhispers.com/article/TOST/2610068986
- Toast productivity calculator: https://pos.toasttab.com/vi-us/resources/productivity-calculator
- Toast IQ Team (labor): https://www.qsrmagazine.com/news/toast-launches-iq-team-to-help-restaurants-manage-labor-costs/
- Toast IQ Inventory overview / FAQ: https://support.toasttab.com/en/article/Toast-IQ-Inventory-Overview ; https://support.toasttab.com/en/article/Toast-IQ-Inventory-FAQ
- MarketMan cases: https://www.marketman.com/case-study/how-pine-state-biscuits-streamlined-operations-and-reclaimed-hours-each-day-with-marketman ; https://marketman.com/restaurant-inventory-management ; https://www.casestudies.com/company/marketman/case-study/ashley-macs-reduces-inventory-counting-time-by-60-with-marketman ; https://www.casestudies.com/company/marketman/case-study/how-marketman-touchbistro-pos-helped-this-restaurant-reduce-time-spent-on-inventory-by-85
- Receiving time: https://supy.io/blog/learn-restaurant-food-receiving-procedure ; https://nineguides.pages.dev/operations/vendor-delivery-receiving ; https://kitchennmbrs.app/en/knowledge-base/daily-control/what-routine-helps-you-see-right-away-with-every-delivery-if-prices-match-your-agreement
- IOFM touch time via imagetotable: https://imagetotable.ai/references/invoice-processing-time-benchmark
- eastwest-food (HE): https://eastwest-food.co.il/restaurant-transaction-invoice/
- Payper (HE): https://payper.co.il/
- Supy The Spread (2026): https://supy.io/the-spread
- Supy credit notes: https://supy.io/product-features/invoices-credit-notes
- Vellum (IOFM 39%, secondhand): https://www.vellum.ai/blog/how-to-catch-restaurant-vendor-price-creep
- ustechautomations (xtraCHEF 2–4%, secondhand): https://ustechautomations.com/resources/blog/restaurant-inventory-automation-case-study-2026
- Phacet invoice validation: https://www.phacetlabs.com/blog/restaurant-invoice-validation
- APQC duplicates via CFO.com: https://www.cfo.com/news/metric-of-the-month-detect-and-prevent-duplicate-or-erroneous-payments/
- Corpay duplicate payments: https://www.corpay.com/resources/blog/duplicate-payment
- Ardent via Tungsten: https://www.tungstenautomation.com/blog/ai-in-accounts-payable-metrics-that-matter
- Ardent via WEX: https://www.wexinc.com/resources/blog/what-does-it-cost-to-process-an-invoice-ap-benchmarks-every-finance-team-should-know/
- Ardent 2026 via Medius: https://www.medius.com/resources/guides-reports/ardent-partners-accounts-payable-metrics-that-matter/
- StealthAgents AP stats: https://stealthagents.com/research/ai-accounts-payable-automation-statistics
- Fill-rate contracts: https://www.lawinsider.com/contracts/jgnbpdjkrQx ; https://contracts.justia.com/companies/cke-restaurants-inc-32982/contract/817089
- Statement reconciliation guide: https://invoicedataextraction.com/blog/restaurant-supplier-statement-reconciliation
- MarginEdge price alerts / how it works / Q3 2025 notes: https://www.marginedge.com/price-alerts ; https://www.marginedge.com/how-it-works ; https://www.marginedge.com/blog/q3-2025-product-release-notes
- MarginEdge reviews: https://www.getapp.co.uk/software/120387/marginedge
- Restaurant Business AvT: https://restaurantbusinessonline.com/theory-relativity-part-two
- R365 inventory / cases: https://www.restaurant365.com/restaurant-inventory-software-food-cost-control ; https://www.restaurant365.com/resources/california-fish-grill-save-1-in-food-costs-at-its-34-locations-thanks-to-restaurant365-reporting-tools/ ; https://www.restaurant365.com/resources/elis-restaurant-group-recoups-1-1-million-prime-cost-gap-during-pandemic-with-restaurant365/
- AI ordering / waste: https://hospitalidad.ai/EN/restaurant-inventory-automation-myth-vs-reality-2026.html ; https://www.ordering.co/blog/innovations-to-watch-new-ai-features-transform-restaurants/ ; https://supy.io/blog/using-ai-to-reduce-food-waste-real-results-from-multi-site-restaurant-operators
- Restigo (HE): https://www.restigo.co.il/%D7%A4%D7%95%D7%93-%D7%A7%D7%95%D7%A1%D7%98/ ; https://www.restigo.co.il/xml-%D7%A9%D7%9C%D7%99%D7%97%D7%AA-%D7%94%D7%96%D7%9E%D7%A0%D7%94-%D7%9C%D7%A1%D7%A4%D7%A7/api4-2/
- Supy food cost %: https://supy.io/blog/learn-food-cost-percentage
- Minimum wage 2026: https://www.btl.gov.il/MEDINIYUT/GENERALDATA/Pages/%D7%A9%D7%9B%D7%A8%20%D7%9E%D7%99%D7%A0%D7%99%D7%9E%D7%95%D7%9D.aspx ; https://www.malam-payroll.com/%D7%A2%D7%93%D7%9B%D7%95%D7%9F-%D7%A9%D7%9B%D7%A8-%D7%9E%D7%99%D7%A0%D7%99%D7%9E%D7%95%D7%9D-%D7%91%D7%9E%D7%A9%D7%A7-%D7%9E%D7%90%D7%A4%D7%A8%D7%99%D7%9C-2026/
- CBS sector wage via press: https://www.davar1.co.il/637713/ ; https://www.ice.co.il/research/news/article/1054136 ; https://www.btl.gov.il/About/newspapers/Pages/dovrotdohsachar2025.aspx
- AllJobs salary pages: https://www.alljobs.co.il/User/SalaryCompound/position/?JobCategoryID=1346 ; https://www.alljobs.co.il/User/SalaryCompound/position/?JobCategoryID=1349 ; https://www.alljobs.co.il/User/SalaryCompound/position/?JobCategoryID=843 ; https://www.alljobs.co.il/m/p/jobs/8763387
- work.co.il restaurant salaries (Mar 2026): https://work.co.il/salary/industries/restourant
- JobRest shift manager ad: https://www.jobrest.co.il/job/service/%D7%9E%D7%A0%D7%94%D7%9C%D7%99-%D7%95%D7%AA-%D7%9E%D7%A9%D7%9E%D7%A8%D7%AA-%D7%9C%D7%9E%D7%A1%D7%A2%D7%93%D7%AA-%D7%A9%D7%A3-%D7%9E%D7%A6%D7%9C%D7%99%D7%97%D7%94-%D7%91%D7%AA%D7%9C-%D7%90%D7%91%D7%99/
- Bizportal bookkeeper salary: https://www.bizportal.co.il/career/news/article/20039783
- study.co.il bookkeeper salary: https://www.study.co.il/%D7%A9%D7%9B%D7%A8-%D7%94%D7%A0%D7%94%D7%9C%D7%AA-%D7%97%D7%A9%D7%91%D7%95%D7%A0%D7%95%D7%AA/
- Outsourced bookkeeping prices: https://financecheck.co.il/self-employed/accountant-cost/ ; https://infinityfinance.co.il/blog/%D7%9B%D7%9E%D7%94-%D7%A2%D7%95%D7%9C%D7%94-%D7%94%D7%A0%D7%94%D7%9C%D7%AA-%D7%97%D7%A9%D7%91%D7%95%D7%A0%D7%95%D7%AA-%D7%9C%D7%A2%D7%A1%D7%A7-%D7%A7%D7%98%D7%9F-%D7%94%D7%9E%D7%93%D7%A8%D7%99%D7%9A
- Employer cost: https://olam-haavoda.co.il/EmployerCostCalculator ; https://www.bizportal.co.il/additives/395/employer-cost-2026.html ; https://jobcalc.co.il/salary/employer-cost/minimum-wage/
