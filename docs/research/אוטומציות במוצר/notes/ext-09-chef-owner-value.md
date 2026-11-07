# ext-09 · Value for chefs and owners: what the market ships beyond the leak (2024–2026)

**Date:** 2026-11-07. **Scope:** recipe and per-dish cost auto-update, menu engineering, par/prep, ordering speed, price alerts with dish impact, waste logging, substitutions, negotiation leverage, cash, benchmarks, and Israeli specifics. The question is which of these give a chef or an owner real value, what the tools actually ship, and how each item fits the RestoMatch North Star, `docs/ICP.md` §5 and the owner rules.

**This note builds on, and does not repeat:** `ext-03` (MarginEdge, xtraCHEF and R365 AP features, price alerts), `ext-05` §3 (inventory-intelligence layer, the 1–3% vendor range, the setup tax), `ext-06` (MarketMan modules and user voice), `ext-01` (Zestt and its Plants Council link), `int-06` §7 (what the recipes router already does) and `10-catalogue-and-impact.md` (A18 price creep, A25 produce benchmark, A26 POS Z-report, §G dispositions). Where an item here maps onto an A-item, the A-item stays authoritative for its ₪.

**Method and limits.** Every finding comes from WebSearch result extracts seen on 2026-11-07. Page fetches failed for `www.globes.co.il`, `www.freshplaza.com`, `www.marginedge.com` and `plants.moonsite.co.il` (session network policy); those hosts must be allowed for a verification pass. No Reddit or Israeli Facebook-group post surfaced in four targeted searches, so user voice comes from Capterra, G2, Software Advice, the App Store and press quotes.

**Labels:**

| Label | Meaning |
|---|---|
| [V] | Vendor claim or vendor-published case study |
| [I] | Independent: research body, government or regulator |
| [P] | Press |
| [3P] | Third-party aggregator or blog; low authority |
| [U] | User review |
| **UNVERIFIED** | Could not be sourced, or the source is undated or second-hand |

---

## 1. Key findings

1. **Recipe re-costing from invoices is table stakes. The work is in the item link.**
   - meez, Galley, MarginEdge, xtraCHEF, Craftable, Restigo and MarketMan all re-cost dishes once an invoice line is tied to an ingredient [V].
   - Users praise the result. Their complaints are about upkeep: "product maintenance almost daily" (MarginEdge, Capterra [U]); no find-and-replace across recipes (Craftable, Software Advice [U]); about 2 months to implement (Apicbase, G2 aggregate [3P]).
   - RestoMatch already prices recipes from the latest **paid** price (`int-06` §7). The gap is the push, not the maths.
2. **The value chefs and owners name most is the plate-cost alert: "this dish crossed target because of this purchase".** MarginEdge shipped it in October 2025 with four suggested responses [V]. RestoMatch has the query (`dishPriceAlert`, pull-only); A18/AU-13 plans the push. It is the highest-value chef item and within the chef-₪-on-recipes rule.
3. **Menu engineering is blocked by sales data, and its lift evidence is weak** (one Cornell replication ≈10%, sales-or-profit unclear; vendors 8–20%). It depends on A26 (POS Z-report, ICP veto risk): **later**.
4. **Par, prep and forecast stay anti-ICP** (`docs/ICP.md` §5), even as MarginEdge SmartPrep ships (28 days of POS + manual pars, ±15% [V]).
5. **Ordering-speed figures are vendor-only** (Choco: 2 h/week, "85% fewer mistakes" [V]). The owner rule caps us at **drafts plus a one-tap human send** (A16); Zestt's auto-send cannot be copied.
6. **Waste logging has the best independent ROI evidence in this whole area, and it is the furthest from our North Star.**
   - Champions 12.3 study: 114 restaurants cut kitchen waste by 26% in a year, at about 7:1 ROI [I, 2019]. WRAP still cited a 1:14 hospitality ROI in Nov 2024 [I].
   - Winnow and Leanpath claim 2–8% of food purchasing [V].
   - It needs scales or a tablet habit. Do not build. At most, mention it in the owner report later.
7. **Negotiation leverage is the most on-mission "owner value" we can add.**
   - The ingredients: per-supplier price history, ₪/month of creep, volume, and our own claim and recovery record.
   - Cross-customer price benchmarks exist only at scale: MarginEdge price search covers 11,500+ restaurants, regional medians [V].
   - The cross-restaurant version is "later" (ICP §5, network value). The single-restaurant **supplier negotiation pack** is not.
8. **Israel adds three facts that matter.**
   - Fresh produce rose **16.3% from Jan 2023 to Jun 2025, against 6.2% CPI** (CBS via FreshPlaza [P/I]).
   - Importers report frozen meat up **~25% in 2025**. That is one industry voice, **UNVERIFIED**.
   - The produce "benchmark" (Plants Council *תקליט*) is an indication only. An audit found it ~32% above the Agriculture Ministry survey [P]. So A25 must show **two public references and a band**, never one "market price".
9. **Food-cost % benchmarks are consistent but soft.** Israeli consultants and vendors say ~30% (28–35%). A US NRA-attributed median is ~32% (second-hand). No Israeli peer dataset exists. An anonymised RestoMatch peer benchmark would be first-of-kind, but it is network value (later).

---

## 2. Topic by topic

### 2.1 Recipe and per-dish food cost auto-update

**Best practice (2024–2026).** The steps:
1. Every invoice line maps to an ingredient.
2. The ingredient carries a unit conversion and a yield or trim %.
3. Sub-recipes nest.
4. Plate cost = Σ (qty × current cost ÷ yield).
5. Food-cost % = plate cost ÷ menu price, compared with a per-dish or per-category target.

The "current cost" is either the last invoice price (meez: "assigns a cost from the most recent invoice" [V]) or an average.

| Tool | What ships | Numbers | Label |
|---|---|---|---|
| meez | Invoice lines linked to ingredients update recipe and food-cost %; invoice processing takes ~48 h; sub-recipes | "3–5% COGS reduction on average" | [V] [getmeez costing 2025](https://www.getmeez.com/2025/costing); [help: invoice processing](https://intercom.help/getmeez/en/articles/5725098-invoice-processing-service) |
| Galley | Live vendor pricing, EDI and scanned invoices update recipes; yield and trim %; per-location sales prices; SMB from $99/mo | "≈75% less manual recipe entry" | [V] [Galley recipes & food costs](https://www.galleysolutions.com/recipe-food-costing-software-for-foodservice); [Galley SMB](https://www.galleysolutions.com/galley-for-smb) |
| xtraCHEF (Toast) | Recipe costs "fueled by pricing data updated with each new invoice"; links Toast menu items to recipes | Underbelly Hospitality: $330k food-cost reduction, self-reported | [V] [Toast recipe costing](https://pos.toasttab.com/products/recipe-costing); [Underbelly story](https://d22ee908voahmo.cloudfront.net/blog/underbelly-hospitality) |
| Craftable | Ingredient price change reprices every dish; item price-variance reports with suggested price changes | From $99/user/mo | [3P] [Makerstack 2026](https://makerstack.co/reviews/craftable-review/); [U] [Capterra](https://www.capterra.com/p/200434/Craftable/reviews/?page=2) |
| Supy | Recipe costing, waste, ordering (Gulf/UK) | "25% food-cost reduction average"; Slims 40%→29% COGS; Shaka 39%→33% | [V] [Supy](https://supy.io/googlepage); [Slims](https://supy.io/de/customer-stories/slims) |
| Apicbase | Recipe and menu management, multi-unit push | Bright Kitchen "−8% food cost"; ~2 months to implement; ~€249–300/mo | [V] [case study](https://www.casestudies.com/company/apicbase/case-study/bright-kitchen-customer-case-study); [3P] [GetApp](https://www.getapp.com/all-software/a/apicbase-food-management) |
| Restigo (IL) | Supplier catalogue with one-click price update; recipe tree including delivery-platform fees | "Up to 8% savings on food and labour"; event hall −7% food cost | [V] [restigo.co.il](https://www.restigo.co.il/); App Store 3.0/5 from 30 ratings [U] [App Store](https://apps.apple.com/il/app/restigo/id1526293585?l=he) |

**Read-across.** Every reduction figure above is vendor before/after with no control group. The usable floor stays `ext-05`'s 1–3% of food cost (₪2,000–6,000/month at ₪200k), **only for restaurants that maintain recipes**, and it is avoided cost, never leak.

**For RestoMatch.** The recipes router already prices from the paid price (`int-06` §7); the gap is the push. Keep the setup tax away from first value (the leak must not depend on recipes, `ext-06` §6), and let one invoice-line → product mapping (W3-10 triage) feed both the leak and the dish cost.

### 2.2 Ingredient price alerts with dish impact

**What ships.**
- **MarginEdge plate-cost alerts.** Per-recipe threshold. Example: a dessert at 39% against a 30% alert fires. Release notes (Oct 2025) describe "real-time alerts when a dish's plate or pour cost goes outside your target range". Suggested responses: raise the price, reduce the portion, de-emphasise, or switch the ingredient [V] ([plate cost alerts](https://www.marginedge.com/lp/plate-cost-alerts); [Oct 2025 notes](https://help.marginedge.com/hc/en-us/articles/46438182100883-October-2025-Product-Release-Notes)).
- **Vendor-item price alerts** by email (`ext-03` §1.3).

**User voice [U].**
- A Chef de Cuisine on G2 tracks 180+ recipes, with "price changes flagged quickly".
- A Capterra reviewer likes that "prices update automatically so recipe costs stay current" ([G2](https://www.g2.com/products/MarginEdge/reviews); [Capterra](https://www.capterra.com/p/187718/MarginEdge/reviews/)).
- A Craftable reviewer calls the price-variance reports with suggested price changes "seriously cool" ([Capterra p.2](https://www.capterra.com/p/200434/Craftable/reviews/?page=2)).

**For RestoMatch.** This is A18/AU-13 (price creep ₪/month + dish alert push). Three refinements come from the market:
1. **Say which purchase moved the dish.** RestoMatch's `changes` already returns "the ingredient that drove the move". Put the supplier, the invoice and the date in the alert so the chef can act or ask the owner.
2. **Offer the four standard responses as copy, not as actions.**
   - Raising a menu price is a money action: owner only, human-confirmed.
   - The other three are kitchen decisions with no ₪ write.
3. **Two ₪ figures, never summed.**
   - The dish alert shows ₪ per plate and food-cost %. The chef may see these on recipes.
   - The owner digest shows ₪/month creep (A18's avoided-cost column).
   - Neither is added to the leak.

### 2.3 Menu engineering (stars / plowhorses / puzzles / dogs)

**Method.**
- Kasavana and Smith (Cornell HRA Quarterly, 1982): popularity (item mix ≥ 70% of a fair share) × contribution margin (≥ the menu's weighted average).
- Stars: protect. Plowhorses: re-cost or bundle. Puzzles: reposition. Dogs: test one change, then remove ([Toast explainer [V]](https://pos.toasttab.com/restaurant-management/restaurant-menu-engineering); [Loaded [V]](https://www.loadedhub.com/resources/menu-engineering-matrix-restaurant)).

**What ships.**
- R365: POS sales + recipe cost → Menu Item Analysis and Menu Price Analysis reports, placed into the matrix [V] ([R365 guide](https://www.restaurant365.com/blog/ultimate-guide-to-recipe-menu-engineering/); [6 reports](https://www.restaurant365.com/blog/6-key-restaurant-operational-reports-to-boost-your-menu-engineering/)).
- The input is the POS product-mix (PMIX) report.

**Evidence on value.**
- A 2014 Cornell replication is cited as "≈10% increase in profitability". Another write-up calls it a 10% *sales* increase. **UNVERIFIED which.**
- Vendor claims run 10–20%. A "Foundry 1,200 operators, 8–14%" benchmark could not be traced (**UNVERIFIED**) ([prostay 2026 [3P]](https://www.prostay.com/blog/menu-engineering-2026/)).

**For RestoMatch.**
- It needs per-dish sales counts. Today that means the POS file upload (`posVsTheory`, flag `integrations`) or A26's Z-report feed, which `10-catalogue` marks "later, ICP veto risk".
- It does not manufacture or protect the leak ₪.
- **Disposition: later.** If A26 ever lands, a read-only "menu matrix lite" on the recipes page is cheap: it reuses `recipes.list` costs. It would be a chef/owner convenience behind an icp-keeper gate, and it must never become the headline.

### 2.4 Par levels, prep lists, production planning

**What ships.**
- **MarginEdge SmartPrep** (Q4 2025 / H1 2026): forecast → daily prep plan, checklists and labels.
  - It needs ≥28 days of POS sales and ~2–3 days of manual PAR entry before predictions.
  - Forecast "within ~15% of actual on average".
  - Launch waitlist price $95/location/month (possibly outdated) [V] ([What is SmartPrep](https://help.marginedge.com/hc/en-us/articles/50084631021331-What-is-SmartPrep); [Getting started](https://help.marginedge.com/hc/en-us/articles/51105680555667-Getting-Started-with-SmartPrep); [waitlist](https://www.marginedge.com/smartprep-waitlist)).
- MarketMan's "Order by Recipe" and par-based suggestions (`ext-06`).

**For RestoMatch.**
- `docs/ICP.md` §5: par and forecast are "later (anti-ICP border)", and any core presentation is vetoed. Nothing found here argues otherwise.
- These tools need POS plus counts plus recipes, which 1–3 branch owner-operators rarely maintain (`ext-05` §3).
- **Disposition: veto as a feature.**
- The only allowed shape is "fuel for the GR": an expected quantity for the receiver. That already exists as `daily-expectations` / G-10 and is ₪-free.

### 2.5 Ordering speed: order guides, one-tap reorder, WhatsApp and voice

**What ships, and what is claimed.**

| Tool | Claim | Label / source |
|---|---|---|
| Choco | "2+ hours a week saved", orders "in three taps", "85% fewer mistakes"; converts orders to the supplier's channel (WhatsApp, SMS, fax) even for suppliers not on the platform | [V] [Twilio case](https://customers.twilio.com/en-us/choco); [choco.com UK](https://choco.com/uk/restaurants) |
| ChefsList | "Save 5 minutes per order, several times a day" | [V] (search extract, 2026-11-07) |
| Zestt (IL) | Order date → auto-send order + reminders | [V] (`ext-01` §2) |

**Gap.** No independent 2025 measurement of minutes per order exists. `ext-05` already concludes the time evidence is vendor-only.

**For RestoMatch.**
- A16 (order autopilot) and A5 (reminder truth) are the right scope: drafts from the last order or a supplier order guide, and the chef or manager sends.
- **Owner rule: nothing is sent to suppliers automatically.** So we cannot copy Zestt's auto-send or Choco's channel bridge as-is.
- The equivalent is a pre-filled WhatsApp/email draft with a one-tap human send.
- **Recurring orders (`source='recurring'`) remain "later" per ICP §5.** "Repeat last order as a draft" is a draft, not a recurring order, and is inside A16.
- Voice ordering: no 2024–2026 independent evidence found. It stays "later" (`10-catalogue` §G.3).
- The chef sees ₪ on orders (owner rule), so a draft may show line ₪. The receiver never sees it.

### 2.6 Waste logging and its ROI

**Independent evidence (the strongest in this note).**
- **Champions 12.3, "The Business Case for Reducing Food Loss and Waste: Restaurants"** (WRAP + WRI, Feb 2019).
  - 114 restaurants in 12 countries invested ≈0.4% of food sales.
  - They cut kitchen waste by **26%** in one year, at **≈7:1** ROI [I] ([WRAP](https://www.wrap.ngo/resources/business-case-reducing-food-loss-and-waste/restaurants); [Champions 12.3 release](https://champions123.org/release-new-report-finds-restaurants-save-significant-money-fighting-food-waste)).
  - Outside the 2024–2026 window, but it is the base study.
- **WRAP, Nov 2024 "Food Matters: make it count".** Re-cites a **1:14** average ROI across hospitality and food service. UK hospitality wastes ~1.1 Mt/yr, 75% of it edible, costing £3.2bn [I] ([WRAP press release](https://www.wrap.ngo/media-centre/press-releases/wrap-urges-hospitality-and-food-service-ceos-and-leaders-take-stand)).

**Vendor claims.**
- Winnow and Leanpath: ~50% waste reduction, **2–8% of food purchasing**. Waste is 4–13% of food cost (Winnow's 2019 EPA slides) [V] ([Unreasonable/Winnow](https://unreasonablegroup.com/companies/winnow); [EPA slides](https://www.epa.gov/sites/default/files/2019-12/documents/winnow_presentation_12_19_19.pdf)).
- Orbisk: "up to 70%", ROI in 4–8 months. ≈€7,000/yr per FAO page [3P]. Winnow Track (tablet-only) is quote-only [V/3P] ([Orbisk FAQ](https://orbisk.com/?p=249969); [FAO](https://agritechobservatory.review.fao.org/zh/orbisk)).

**For RestoMatch.**
- Waste is consumption-side. It does not touch supplier invoices, and the leak definition is supplier-side.
- Logging is an inventory habit (ICP drift risk), and the effective tools are hardware or tablet routines.
- **Disposition: do not build.**
- Acceptable later: market damaged-on-arrival claims (W2-05/W2-10) as "waste you did not pay for".

### 2.7 Substitutions and yield

**What ships.**
- Lavu "Marty" AI watches supplier prices and suggests cheaper substitutes [V] ([Lavu](https://lavu.com/ai-restaurant-ingredient-substitution/)).
- Kostly has AI ingredient matching and menu optimisation, from €15/mo [V/3P] ([Capterra](https://www.capterra.com/p/10037552/Kostly/)).
- MarginEdge's alert playbook lists "switch ingredients" (§2.2).
- Galley and meez carry yield and trim % in costing [V].

**Cautions.**
- Lavu's own operator article warns that a cheaper substitute can lower quality or raise labour [V] ([Lavu](https://lavu.com/how-to-handle-vendor-substitutions-without-hurting-quality/)).
- Craftable users complain they cannot mass-replace an ingredient across recipes [U] ([Software Advice](https://www.softwareadvice.com/ca/retail/craftable-profile/reviews/)).

**For RestoMatch.**
- A cross-supplier "cheaper equivalent" needs `product_group_id`, which is **"later, decision locked: not building now"** (ICP §5).
- A same-supplier swap within one catalogue ("the 5 kg tin is 9% cheaper per kg than the 2.5 kg") is unit-price arithmetic on the supplier's own price list. It needs no cross-supplier link.
- It could ride A18 as a chef hint, but it is avoided cost, not leak. Classify it **Phase C+, icp-keeper gate**.
- Yield % per recipe line is a recipes-editor field (W3-02's owner). It is not automation.
- Supplier-initiated substitutions *on the invoice* (wrong item delivered) are a matching concern. They belong to the engine owner, not to chef value.

### 2.8 Supplier negotiation leverage

**What ships.**
- **MarginEdge product price search.** Anonymised data from 11,500+ restaurants and 35,000+ vendors. It gives regional cost trends and says outright that figures may include fees or discounts and are "not exact vendor prices" [V] ([MarginEdge price search](https://www.marginedge.com/product-price-search)).
- **Orderly** compares like ingredients across the restaurant's own suppliers [V] ([FastCasual](https://www.fastcasual.com/news/software-update-to-help-restaurants-manage-food-costs/)).
- **Lightspeed Benchmark & Trends** compares *menu* prices with nearby peers [V] ([PDF](https://files.cdn.thinkific.com/file_uploads/966438/attachments/ae9/200/bd0/Benchmark___Trends_-_Enablement_-_Aug25.pdf)).
- Several "Network Benchmark Preview" pages for a "Pancho network" claim item-level peer price comparison. They look promotional and could not be verified. **UNVERIFIED** ([example](https://oliveiras-price-benchmark-report.pages.dev/)).

**For RestoMatch.** We already hold what a single owner needs to negotiate. The **supplier negotiation pack** (proposal, owner-only, read-only) per supplier, for the last 3/6/12 months, contains:
- Spend.
- Item-level price history (paid price).
- ₪/month creep (A18 method: Δ unit price × trailing quantity).
- Contract-price breaches, if `contracts` is on.
- Our record with this supplier: discrepancies found, claims sent, credited, and days-to-credit (A12/A24 data).

The owner prints or shares it **manually**. Nothing goes to the supplier automatically.

It protects and dramatises the ₪ (the recovery record is the stick), uses one restaurant's own data (not the network feature), and shows creep ₪ (avoided cost) beside claim/credit ₪ (leak) without summing them.

Recommended as a **Phase-B rider on AU-13**: same data, new view.

A cross-customer benchmark ("you pay 7% above the RestoMatch median for this SKU") is network value. It is **later** per ICP §5 and also needs `product_group_id`.

### 2.9 Cash: payment terms and cash forecast

**Best practice.**
- A 13-week rolling cash forecast, with the near weeks most accurate [3P] ([Venn 2025](https://www.venn.ca/resources/restaurant-cash-flow-management-in-canada-for-2025)).
- Negotiate longer terms or early-payment discounts (for example 2/5) [3P] ([Mindspace](https://www.mindspaceoutsourcing.com/?p=8103)).
- MarginEdge Bill Pay with approval thresholds (`ext-03`).
- No Toast or R365 cash-forecast documentation surfaced.

**Israel.**
- The Payment Ethics to Suppliers Law 2017 (*חוק מוסר תשלומים לספקים*) sets maximum payment periods. For public bodies: 45 days from the invoice, or *שוטף+30*. Late payment incurs linkage and interest, then late-payment interest after 30 days.
- For business-to-business, secondary sources describe a default of *שוטף+45* "unless agreed otherwise". **UNVERIFIED** against the statute text ([Kol Zchut](https://www.kolzchut.org.il/he/המועד_האחרון_לתשלום_תמורה_לספקים_עבור_סחורה_או_שירות); [Chamber of Commerce](https://www.chamber.org.il/serviceslobby/legal/1858/75560/)).

**For RestoMatch.** `10-catalogue` §G.3 already declined the 13-week forecast (fails the North Star). The on-mission cash item is **"blocked from payment this week, in ₪, and why"** (A19 + the W2-03 hold). A read-only due-date calendar can follow once W2-03/H-03 dates exist.

### 2.10 Benchmarks: food-cost % and price indices

| Benchmark | Value | Label / source |
|---|---|---|
| Israeli target food cost, restaurants | ~30% (fast food ~25%, bar ~15%) | [V] [Restigo food cost](https://www.restigo.co.il/%D7%A4%D7%95%D7%93-%D7%A7%D7%95%D7%A1%D7%98/); [Zestt blog](https://www.zestt.io/blog/%D7%AA%D7%9E%D7%97%D7%95%D7%A8-%D7%9E%D7%A0%D7%94-%D7%91%D7%95%D7%90%D7%95-%D7%A0%D7%A2%D7%A9%D7%94-%D7%90%D7%AA-%D7%96%D7%94-%D7%9B%D7%9E%D7%94-%D7%A9%D7%99%D7%95%D7%AA%D7%A8-%D7%A4%D7%A9%D7%95%D7%98) |
| Israeli range by type | Gourmet 28–32%, regular 30–35%, fast 25–30% | [3P] [Neaman consulting](https://neaman-c.co.il/%D7%AA%D7%9E%D7%97%D7%95%D7%A8-%D7%A0%D7%9B%D7%95%D7%9F-%D7%A9%D7%9C-%D7%9E%D7%A0%D7%95%D7%AA/); [Restomate](https://www.restomate.co.il/he/food-cost) |
| Food share of total costs (IL CPA) | 30–40% | [3P] [Shuminov-Levi CPA](https://oshcpa.co.il/%D7%97%D7%99%D7%A9%D7%95%D7%91-%D7%A2%D7%9C%D7%95%D7%99%D7%95%D7%AA-%D7%9E%D7%96%D7%95%D7%9F/) |
| US median F&B cost (NRA Operations Data Abstract, FY2024, attributed) | ~32% | [3P] second-hand, **UNVERIFIED** ([beancount 2026](https://beancount.io/blog/2026/07/08/menu-engineering-food-cost-percentage-stars-plowhorses-puzzles-dogs-matrix)) |
| MarginEdge network average | food + bev ≈28% of sales | [V] [MarginEdge blog](https://www.marginedge.com/blog/average-food-costs-for-restaurants-insights-from-industry-data) |

**Gaps and fit.** No Israeli peer dataset of actual food-cost % exists (CBS publishes consumer indices only). Our ICP band at a 30% norm implies ≈₪500k–1.3M monthly sales (sanity check only). The benchmark *ours to own* is leak/recovery (`ext-05` leapfrog #6); a peer food-cost % is network value, **later**.

### 2.11 Israeli specifics

**Produce prices and seasonality.**
- Fresh fruit and vegetables rose **16.3% from Jan 2023 to Jun 2025, against 6.2% for CPI** (CBS, as reported by FreshPlaza) [P citing I] ([FreshPlaza](https://www.freshplaza.com/article/9754229/israeli-fruit-and-vegetable-prices-rise-16-amid-reform-freeze-and-import-tariffs)).
- Tomatoes were reported up ~11% YoY on shortage. The date is unclear: **UNVERIFIED** ([Tridge](https://www.tridge.com/ko/data-insights/market-price-fresh-tomato-israel)).
- Produce is volatile and seasonal. That is exactly where "above last price" alerts produce noise and a market band helps.
- No 2024–2026 source on Israeli produce *seasonality patterns* for restaurant buying surfaced. **UNVERIFIED**; an agronomist or supplier interview could fill it.

**The produce "market price" is plural and contested.**
- The Plants Council *תקליט* is a daily average, collected by a surveyor at the Tzrifin wholesale market. The Council's own price page calls the figures "an indication only", with a table dated from 05/11/26 [V/I] ([price report](https://plants.moonsite.co.il/); [Zeraim explainer](https://www.zeraim.com/blog/taklit)).
- A press audit found the Council's grade-A survey **~32% above** the Agriculture Ministry survey [P] ([Israel Hayom](https://www.israelhayom.co.il/business/article/16127365)).
- The Ministry publishes weekly selected prices on gov.il [I] ([gov.il weekly prices](https://www.gov.il/he/Departments/DynamicCollectors/weekly-prices)).
- *Yerakom* (the New Market) claims actual-trade data [V] ([new-market.co.il](https://www.new-market.co.il/prices.php)).
- The State Comptroller (reported Jul 2024) found the Council's levies have a negligible price effect but that it shapes prices through the price information it supplies [P] ([Walla](https://finance.walla.co.il/item/3679800)).
- **Implication for A25:** show "paid X vs public band [Ministry … Council]" with both sources named, as a T4 neutral info chip. Never call it a claim, and never put it in the leak.

**Meat and kosher.**
- Importers report frozen meat up ~25% in 2025, with further rises expected in H1 2026. One industry voice: **UNVERIFIED** ([Kikar](https://www.kikar.co.il/economics/global-beef-prices-crisis)).
- CPI March 2025: frozen beef +1.6% for the month [P] ([Maariv](https://www.maariv.co.il/economy/israel/article-1191832)).
- ~70% of kosher beef comes from South America [P] (same source family).
- Supervision cost: a mashgiach at ~₪37/h, hours set by the local rabbinate. *Mehadrin* can require a supervisor on shift. The source is undated: **UNVERIFIED** ([Kipa](https://www.kipa.co.il/family/62876.html)).
- **Implication:** meat is the high-₪, high-volatility line for most ICP kitchens. Price-creep ₪/month (A18) will be dominated by meat and fish. Kosher certification limits substitution (supplier and *hechsher* must match), which is another reason not to push "cheaper equivalent" across suppliers.

**VAT 0% on fresh produce.**
- Section 30(a)(13) of the VAT Law with Regulation 8 zero-rates fruit and vegetables, under **cumulative conditions** (Tax Authority interpretation 6/2015).
- Packaged or processed produce has been litigated ([Capitax](https://www.capitax.co.il/content/2/1788)).
- **Implication:** produce lines are legitimately 0%. A VAT check that expects 18% on every line raises false alarms. This is already logged as a per-line VAT classification human-PR (`10-catalogue` §G.3, int-00 #3). Recipe ₪ for the chef should be **pre-VAT**, which RestoMatch already does via the paid price.

**Supplier price increases and the sector.**
- Restaurant-association head Tomer Mor described 10–20% raw-material increases (meat, cheese, fish, canned, imported dry goods). A restaurateur said suppliers announced 15–20% rises [P] ([Calcalist](https://www.calcalist.co.il/shopping/article/hyyrmm5ok)). The date is not shown in the extract: **UNVERIFIED** year.
- 2024: hundreds of closures, central bookings −30% (ynet via [ice.co.il](https://www.ice.co.il/consumerism/news/article/1045269)); CofaceBDI: ~15% of restaurants at risk ([Maariv](https://www.maariv.co.il/breaking-news/article-1363161)) [P]. Margin pressure makes "this supplier raised you ₪X/month" a sharp owner message.

---

## 3. User voice (paraphrased)

| Product | What users say | Source |
|---|---|---|
| MarginEdge | A chef tracks 180+ recipes with real-time costs; price changes flagged fast | [G2](https://www.g2.com/products/MarginEdge/reviews) [U] |
| MarginEdge | Invoices and recipes in one database is the win; but product upkeep is needed almost daily, and users cannot edit data MarginEdge maintains | [Capterra](https://www.capterra.com/p/187718/MarginEdge/reviews/) [U] |
| Craftable | Price-variance reports with suggested menu-price changes praised | [Capterra p.2](https://www.capterra.com/p/200434/Craftable/reviews/?page=2) [U] |
| Craftable | Changing one ingredient (for example a vermouth) means editing every recipe by hand; wants find-and-replace | [Software Advice](https://www.softwareadvice.com/ca/retail/craftable-profile/reviews/) [U] |
| Apicbase | Helped cut waste; setup time a drawback (~2 months) | [G2](https://www.g2.com/products/https-get-apicbase-com/reviews?page=2) [U/3P] |
| MarketMan | Recipe-builder glitches produced wrong pricing; setup "tedious" | `ext-06` §4 [U] |
| Restigo (IL) | App rated 3.0/5 (30 ratings); described as pricier than peers | [App Store](https://apps.apple.com/il/app/restigo/id1526293585?l=he) [U]; [softwarecompare.co.il](https://softwarecompare.co.il/blog/%D7%AA%D7%95%D7%9B%D7%A0%D7%94-%D7%9C%D7%A0%D7%99%D7%94%D7%95%D7%9C-%D7%9E%D7%A1%D7%A2%D7%93%D7%94/) [3P] |
| Israeli owners (press) | "Every significant raw-material rise hits profitability"; prices passed on in small steps | [Calcalist](https://www.calcalist.co.il/shopping/article/hyyrmm5ok) [P] |

**Pattern.**
- Chefs value seeing **which purchase moved which dish**, quickly.
- Owners value **₪ they can act on**.
- Both hate **maintenance**.
- No source shows owner-operators keeping par levels or waste logs up to date without staff dedicated to it.

---

## 4. Value map for RestoMatch (proposal; owner rules applied)

**Who sees what.**
- Chef: ₪ only on orders and recipes.
- Receiver: no ₪.
- Owner: everything.

**Two ₪ kinds, never summed:**
- **leak ₪** (one definition; MISSING_ON_INVOICE excluded).
- **avoided-cost ₪** (price creep, menu, waste).

Hours-₪ is a third, separate column.

| # | Value item | Role | ₪ kind | ICP / North Star | Maps to | Disposition |
|---|---|---|---|---|---|---|
| CV1 | Dish crossed target, pushed with the purchase that caused it + 4 standard responses as copy | chef (₪ on recipe), owner | avoided cost | Dramatises the ₪; chef-safe | A18 / AU-13 (+`dishPriceAlert`) | **Build with A18 (Phase B).** Add the "which invoice" link and the response copy |
| CV2 | Supplier negotiation pack (price history, ₪/month creep, claims/credits record) | owner only | creep = avoided cost; claims = leak, separate columns | Protects + dramatises | AU-13 data, A12/A24 data | **Phase-B rider on AU-13** (new view, no new job). Manual share only |
| CV3 | Order draft = last order or order guide, one-tap human send by WhatsApp/email | chef, manager | none counted | Neutral; time only | A16 / AU-11, A5 | **Already planned.** Keep "draft, human sends". Recurring stays later |
| CV4 | Public produce band on 0%-VAT produce lines | owner | avoided cost (speculative) | Weak; T4 info | A25 | **Keep as backlog, icp-keeper gate.** Two named sources + band; never a claim |
| CV5 | Same-supplier pack-size / unit-price hint | chef, owner | avoided cost | Weak | A18 rider | **Phase C+, icp-keeper gate** |
| CV6 | Menu matrix lite (stars…dogs) from recipe cost × Z-report counts | owner, chef | avoided cost | Not North Star | A26 dependency | **Later** (only if A26 passes the ICP gate) |
| CV7 | Payment-blocked-this-week ₪ + due-date calendar | owner, bookkeeper | leak-protected (A19 gross held) | Protects | A19, W2-03, H-03 | A19 planned; calendar **later** after due dates exist |
| CV8 | Peer benchmarks (food-cost %, SKU price vs network) | owner | n/a | Network value | — | **Later** (ICP §5: cross-supplier/network) |
| CV9 | Par / prep / forecast | chef | n/a | **Anti-ICP** | — | **Veto as a feature.** Only GR expectations (₪-free) |
| CV10 | Waste logging | chef | avoided cost | Off-mission | — | **Do not build.** Receiving damage → claims already covers "waste you did not pay for" |

---

## 5. Illustrative ₪ for the typical ICP restaurant

Every input below is an **ASSUMPTION** the owner can edit.

**Baseline** (`10-catalogue` §0): food spend ₪200,000/month before VAT.

**CV1/CV2 price creep (avoided cost, not leak).**
- Assume 20% of spend sits on items that creep 3% in a quarter.
- Assume the owner acts (renegotiates, switches pack, or reprices) on half.
- Result: ₪200,000 × 20% × 3% × 50% = **≈₪600/month**.
- This sits at the top of A18's existing ₪100–600 range, so it is consistent, not additive. Meat-heavy menus with ~25% meat inflation (**UNVERIFIED**) would sit higher.

**Recipe re-costing layer** (only if the chef maintains recipes).
- `ext-05`'s 1–3% vendor range gives ₪2,000–6,000/month avoided cost.
- Label it vendor-claimed. It is never shown next to the leak as one number.

**Waste (not built).** Vendor 2–8% = ₪4,000–16,000/month; Champions 12.3's 26% cut on a 4–13% base ≈1–3.4% of spend. Context only.

**Time (hours-₪, separate column).** Choco's 2 h/week [V] at ₪103/h would be ≈₪890/month; A16 already counts ₪135–385 from our own item lines. Do not import the vendor figure.

---

## 6. What remains UNVERIFIED or missing

Independent food-cost-reduction studies for recipe software (all figures are vendor before/after); whether the Cornell menu figure is profit or sales; the B2B default term in the Payment Ethics Law text; frozen meat +25% (one importer) and the kosher supervision rate (undated); the year of the 10–20% supplier-rise quote; Israeli produce seasonality for restaurant buying; Reddit and Israeli Facebook-group voice; page-level checks on the four blocked hosts.

---

## 7. Sources (all seen 2026-11-07)

**Recipe costing and food-cost tools**
- meez: https://www.getmeez.com/2025/costing · https://intercom.help/getmeez/en/articles/5725098-invoice-processing-service · https://intercom.help/getmeez/en/articles/5344988-how-to-get-your-recipe-costs
- Galley: https://www.galleysolutions.com/recipe-food-costing-software-for-foodservice · https://www.galleysolutions.com/galley-for-smb
- Toast / xtraCHEF: https://pos.toasttab.com/products/recipe-costing · https://pos.toasttab.com/products/xtrachef · https://d22ee908voahmo.cloudfront.net/blog/underbelly-hospitality
- Craftable: https://www.capterra.com/p/200434/Craftable/reviews/?page=2 · https://www.softwareadvice.com/ca/retail/craftable-profile/reviews/ · https://makerstack.co/reviews/craftable-review/
- Supy: https://supy.io/googlepage · https://supy.io/de/customer-stories/slims · https://uk.entrepreneur.com/business-news/supy-ai-restaurant-back-of-house-operations-cost-reduction
- Apicbase: https://www.casestudies.com/company/apicbase/case-study/bright-kitchen-customer-case-study · https://www.getapp.com/all-software/a/apicbase-food-management · https://www.g2.com/products/https-get-apicbase-com/reviews?page=2

**MarginEdge**
- Alerts and releases: https://www.marginedge.com/lp/plate-cost-alerts · https://help.marginedge.com/hc/en-us/articles/46438182100883-October-2025-Product-Release-Notes · https://www.marginedge.com/product-price-search
- SmartPrep: https://help.marginedge.com/hc/en-us/articles/50084631021331-What-is-SmartPrep · https://help.marginedge.com/hc/en-us/articles/51105680555667-Getting-Started-with-SmartPrep · https://www.marginedge.com/smartprep-waitlist
- Reviews and benchmark: https://www.g2.com/products/MarginEdge/reviews · https://www.capterra.com/p/187718/MarginEdge/reviews/ · https://www.marginedge.com/blog/average-food-costs-for-restaurants-insights-from-industry-data

**Menu engineering**
- Restaurant365: https://www.restaurant365.com/blog/ultimate-guide-to-recipe-menu-engineering/ · https://www.restaurant365.com/blog/6-key-restaurant-operational-reports-to-boost-your-menu-engineering/
- Other: https://pos.toasttab.com/restaurant-management/restaurant-menu-engineering · https://www.loadedhub.com/resources/menu-engineering-matrix-restaurant · https://www.prostay.com/blog/menu-engineering-2026/ · https://beancount.io/blog/2026/07/08/menu-engineering-food-cost-percentage-stars-plowhorses-puzzles-dogs-matrix

**Ordering**
- https://customers.twilio.com/en-us/choco · https://choco.com/uk/restaurants · https://ordermentum.com/start

**Waste**
- WRAP / Champions 12.3: https://www.wrap.ngo/resources/business-case-reducing-food-loss-and-waste/restaurants · https://champions123.org/release-new-report-finds-restaurants-save-significant-money-fighting-food-waste · https://www.wrap.ngo/media-centre/press-releases/wrap-urges-hospitality-and-food-service-ceos-and-leaders-take-stand
- Winnow: https://unreasonablegroup.com/companies/winnow · https://www.epa.gov/sites/default/files/2019-12/documents/winnow_presentation_12_19_19.pdf
- Orbisk: https://orbisk.com/?p=249969 · https://agritechobservatory.review.fao.org/zh/orbisk

**Substitutions**
- https://lavu.com/ai-restaurant-ingredient-substitution/ · https://lavu.com/how-to-handle-vendor-substitutions-without-hurting-quality/ · https://www.capterra.com/p/10037552/Kostly/

**Benchmarks and negotiation**
- https://www.fastcasual.com/news/software-update-to-help-restaurants-manage-food-costs/ · https://files.cdn.thinkific.com/file_uploads/966438/attachments/ae9/200/bd0/Benchmark___Trends_-_Enablement_-_Aug25.pdf · https://oliveiras-price-benchmark-report.pages.dev/ (UNVERIFIED)

**Cash**
- https://www.venn.ca/resources/restaurant-cash-flow-management-in-canada-for-2025 · https://www.mindspaceoutsourcing.com/?p=8103
- https://www.kolzchut.org.il/he/המועד_האחרון_לתשלום_תמורה_לספקים_עבור_סחורה_או_שירות · https://www.chamber.org.il/serviceslobby/legal/1858/75560/

**Israel: food cost**
- https://www.restigo.co.il/ · https://www.restigo.co.il/%D7%A4%D7%95%D7%93-%D7%A7%D7%95%D7%A1%D7%98/ · https://apps.apple.com/il/app/restigo/id1526293585?l=he · https://softwarecompare.co.il/blog/%D7%AA%D7%95%D7%9B%D7%A0%D7%94-%D7%9C%D7%A0%D7%99%D7%94%D7%95%D7%9C-%D7%9E%D7%A1%D7%A2%D7%93%D7%94/
- Zestt: https://www.zestt.io/blog/%D7%AA%D7%9E%D7%97%D7%95%D7%A8-%D7%9E%D7%A0%D7%94-%D7%91%D7%95%D7%90%D7%95-%D7%A0%D7%A2%D7%A9%D7%94-%D7%90%D7%AA-%D7%96%D7%94-%D7%9B%D7%9E%D7%94-%D7%A9%D7%99%D7%95%D7%AA%D7%A8-%D7%A4%D7%A9%D7%95%D7%98
- Consultants: https://neaman-c.co.il/%D7%AA%D7%9E%D7%97%D7%95%D7%A8-%D7%A0%D7%9B%D7%95%D7%9F-%D7%A9%D7%9C-%D7%9E%D7%A0%D7%95%D7%AA/ · https://www.restomate.co.il/he/food-cost · https://oshcpa.co.il/%D7%97%D7%99%D7%A9%D7%95%D7%91-%D7%A2%D7%9C%D7%95%D7%99%D7%95%D7%AA-%D7%9E%D7%96%D7%95%D7%9F/

**Israel: produce**
- Plants Council and alternatives: https://plants.moonsite.co.il/ · https://www.zeraim.com/blog/taklit · https://www.gov.il/he/Departments/DynamicCollectors/weekly-prices · https://www.new-market.co.il/prices.php
- Press and audits: https://www.israelhayom.co.il/business/article/16127365 · https://finance.walla.co.il/item/3679800 · https://www.freshplaza.com/article/9754229/israeli-fruit-and-vegetable-prices-rise-16-amid-reform-freeze-and-import-tariffs · https://www.tridge.com/ko/data-insights/market-price-fresh-tomato-israel

**Israel: meat and kosher**
- https://www.kikar.co.il/economics/global-beef-prices-crisis · https://www.maariv.co.il/economy/israel/article-1191832 · https://www.kipa.co.il/family/62876.html

**Israel: VAT**
- https://www.capitax.co.il/content/2/1788

**Israel: sector**
- https://www.calcalist.co.il/shopping/article/hyyrmm5ok · https://www.ice.co.il/consumerism/news/article/1045269 · https://www.maariv.co.il/breaking-news/article-1363161
