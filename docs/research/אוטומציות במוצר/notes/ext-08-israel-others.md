# ext-08: Other Israeli players chasing the same buyer, and what owners say in 2024–2026

> **Scope.** This note covers Israeli products, **other than Zestt (ext-07) and MarketMan (ext-06)**, that compete for the same buyer as RestoMatch. That buyer is the independent owner-operator or chef-owner with 1–3 branches and ₪150k–400k a month of food spend, buying back-office software for purchasing, invoices or food cost. I picked **at most three**, based on the evidence I could find. The note also collects what Israeli owners and chefs said in public about back-office pain in 2024–2026. It **builds on** ext-01 §3–§4 (SUMIT, VirtuAc, Priority, Hashavshevet, Tabit, Beecomm, Restigo stub) and does not repeat it.
>
> **Method caveat (same as ext-01 and ext-07).** WebFetch failed DNS resolution for `www.restigo.co.il` and `www.bestrestapp.com`, because those hosts are not in the session's allowed network domains. I did not try more vendor hosts after that. **Every finding below comes from search-engine extracts of the cited pages, not a full read.** To re-read them in full, `www.restigo.co.il`, `www.restomate.co.il` and `www.bestrestapp.com` have to be allowed in the session's network settings. "Date seen" for every source is **2026-11-07**.
>
> **Labels.** **[vendor]** = the company's claim about itself. **[press]** = Israeli news or trade press. **[consultant]** = an Israeli accountant or restaurant consultant's own site, written to sell a service. **[store]** = an app-store listing. **UNVERIFIED** = I could not source it. No personal ID numbers appear in this note. Hours-₪ and money-₪ are never added together here.

---

## 0. Bottom line (for the person who reads only this)

1. **The three picks are Restigo, Restomate and BestRest.** Restigo is the established Israeli restaurant ERP: purchasing, inventory, product trees, attendance and tips. Restomate is an AI-assistant newcomer that sends WhatsApp alerts on food cost and price rises, from ₪299 a month. BestRest is a thin-evidence AI expense app that does invoice scanning, supplier price tracking and recipes. Each one overlaps with a different slice of RestoMatch (§1–§3).
2. **Nobody sells "leak ₪ caught, ₪ recovered".** Restigo comes closest. It says it does "automatic product recognition and comparison to the order" and can **send a credit request to the supplier** [vendor]. It still frames its money claim as "up to 8% saving on food cost **and** labour cost" [vendor], a spend figure that mixes food and labour. No Israeli player I found states a supplier-invoice leak figure in ₪, a claim-ageing view, or recovery confirmed by a credit note (UNVERIFIED either way; absence of evidence, not proof).
3. **⚠ Name-collision risk: "Restomate" (רסטומייט) vs "RestoMatch".** An Israeli product aimed at the same owner, at `restomate.co.il`, is one letter-cluster away from our name and also sells "AI for restaurants". At least two unrelated foreign products also use "Restomate" or "RestoMate AI" (§2). This is a GTM and SEO risk to raise with a human (`growth-pmm-engineer` / `icp-keeper`). It is **not** a code task.
4. **Food-cost alerts are becoming table stakes in the owner's mind.** Restomate pushes "price of a raw material rose → WhatsApp alert with the impact on the dish, plus options: raise the menu price, switch supplier, change the dish" [vendor]. RestoMatch's A18 (price creep in ₪/month) is our version of this. We should **keep our own framing**: a creep against the *agreed* price, as a leak or a claim, owner-confirmed. We should **not** follow Restomate into "switch supplier" recommendations, which are cross-supplier price compare and **later** in `docs/ICP.md` §6 (§5 below).
5. **Owner voice, 2024–2026: costs up, covers down, closures up, and no one checks invoices.** About **4.6% of Israeli restaurants closed in 2025**, and new openings fell **41%** (Mako, citing Dun & Bradstreet) [press]. Restaurateurs report dish prices up **5–10%** because "the suppliers don't stop raising prices" (Calcalist) [press]. Israeli advisers say creeping supplier price rises "pass under the radar" because invoices aren't checked against agreed prices (Levy Finance; Shuminov-Levy CPA) [consultant]. That is RestoMatch's pitch, said by third parties.
6. **No real user reviews exist in public for any of the three.** I found no G2, Capterra or Google-Play review text, no Reddit thread and no indexed post from an Israeli Facebook owners' group about any of them (UNVERIFIED). The pilot is our review source. Ask pilot owners which of these tools they have tried.

---

## 1. Restigo (רסטיגו): the incumbent Israeli restaurant ERP

### What it does
- **Positioning:** "software for managing restaurants (orders, purchasing, inventory, attendance, tips)". That is the homepage title, *תוכנה לניהול מסעדות (הזמנות-רכש-מלאי-נוכחות-טיפים)* [vendor]. It covers restaurants, bars, catering and hotels, "all connected, synced and available online in real time" [vendor, via Brandfetch extract].
- **Purchasing and invoices:** a supplier catalogue, sending orders, "receiving invoices and managing credits online". The products page says that **automatic product recognition and comparison to the order** can **send a credit request to the supplier** [vendor].
- **Food cost:** recipe or **product trees (עצי מוצר)** and per-dish food cost. Its food-cost page puts the average restaurant food cost at "about 30%". It lists, as common monthly management problems, "no process for checking invoice intake into the system" and "no online credit management" [vendor].
- **Inventory:** counts, transfers between warehouses or branches, waste and write-offs [vendor].
- **Labour:** a labour-cost page (employer cost, not just gross pay), shift scheduling and attendance, tips. A payroll wizard with interfaces to the Michpal and Shekulit payroll systems [vendor].
- **Mobile:** iOS and Android apps by RESTIGO LTD (Petah Tikva), free to download, a companion to the desktop system [store].
- **Accounting link:** the Hashavshevet H-ERP site has a partner page for RESTIGO. The extract did not show what the interface does (UNVERIFIED) [vendor/partner].

### Price
- **Not public.** No price found on the vendor site, the stores or Israeli comparison sites (UNVERIFIED). ext-01 recorded "high for SMB" from an earlier note. I could not re-confirm that.

### Who buys it
- Owner or operations manager of a restaurant, bar, caterer or small hotel who wants **one system for purchasing, stock and staff**. The case study is a "Dizengoff restaurant" that cut food cost by **6%** through inventory management and product trees [vendor]. Headline claim: "savings of up to **8%** of food cost and labour cost" [vendor]. Both are marketing figures with no stated method.
- softwarecompare.co.il, an Israeli comparison blog, calls Restigo user-friendly with an "advanced inventory module, suited to customisation and detailed tracking" [press/blog]. It describes MarketMan as "expensive for small restaurants, mainly for large chains".

### Overlap with RestoMatch
| RestoMatch capability | Restigo | Comment |
|---|---|---|
| Order ↔ delivery ↔ invoice match | **Partial**: "compare to the order" → credit request [vendor] | Not shown: line-level 12-type discrepancies, consolidated-invoice (חשבונית ריכוז) handling, MISSING_ON_INVOICE kept out of leak |
| Leak ₪ hero number | **No**: "% saving on food + labour" | Our one leak definition (Σ\|deltaAmount\|) has no counterpart |
| Claim → follow-up → recovered | **Partial**: "credit management online" | No ageing, no 7-day overdue, no recovery confirmed by a credit note found (UNVERIFIED) |
| Allocation number / VAT at risk | Not found | UNVERIFIED |
| Approvals before payment | Not found | UNVERIFIED |
| Recipes / product trees | **Yes**, core | RestoMatch: chef sees ₪ only on orders and recipes. Recipes are not our wedge |
| Inventory, shifts, tips | **Yes**, core | Anti-ICP / out of scope for RestoMatch (`docs/ICP.md` §6) |

**Read:** Restigo is a **suite**, and RestoMatch is a **wedge**. Restigo's own food-cost page names our problem ("no process for checking invoice intake", "no online credit management") as a reason to buy Restigo. An owner who already runs Restigo will ask "isn't this already in my system?". The answer has to be the ₪ number, plus the claim loop Restigo doesn't show.

### Reviews
- **None found** on G2, Capterra, Google Play review text or Reddit (UNVERIFIED). No Facebook-group mention surfaced in search.

---

## 2. Restomate (רסטומייט): the AI-assistant newcomer

### What it does
- **"Tom" (טום)**, "an AI assistant built specifically for restaurant owners in Israel". It "analyses the data around the clock and sends alerts and reports straight to your phone, via WhatsApp, email or the app" [vendor, AI page].
- **Food cost:** "Restomate calculates the food cost of every dish on the menu automatically", from current supplier prices, the quantities in each dish and price changes over time [vendor, food-cost page].
- **Price-rise alert:** "when the price of a raw material rises and affects food cost, Tom sends you an immediate WhatsApp alert with an impact analysis and options for action". The options are **raise the price, switch supplier, or adjust the dish** [vendor].
- **Expected vs actual usage:** it "regularly compares expected consumption (by what was sold) with actual consumption (by what was ordered from suppliers)" to flag waste or portioning errors. That implies a POS feed [vendor].
- **Purchasing:** "analyses consumption patterns and generates smart orders to suppliers" [vendor].
- **Floor tasks:** sends tasks to staff on WhatsApp and "measures what actually worked" [vendor].
- **Invoices:** **no page found that confirms invoice scanning or OCR** (UNVERIFIED). Supplier prices appear to come from orders or price lists, not checked invoices. If so, Restomate's food cost uses the *price you were quoted*, not the *price you were charged*. That is exactly the gap RestoMatch closes.

### Price
- "Packages from **₪299 a month**, including a free trial period" [vendor, AI page]. This is the only Israeli list price I found among the three, and it is cheaper than anything in ext-06 (MarketMan) at list.

### Who buys it
- An owner who wants **answers on the phone** and doesn't want to run a system. Claimed outcome: "restaurant owners working with Restomate report savings of **4–7%** of business expenses" [vendor; method not stated]. Food-cost target on its page: **28–35%**, depending on the type of restaurant [vendor].
- Customer count, founding date and team: **not found** (UNVERIFIED).

### Name collision (flag for a human)
- `restomate.co.il` (Israeli, Hebrew, "Tom" assistant) is **separate** from `restomate.cloud` (POS, QR ordering, facial recognition) and from `restomateai.com` (English WhatsApp-ordering bot) [vendor pages]. Search results mix all three, and "RestoMatch" sits right next to them. **Proposal (not an action):** `growth-pmm-engineer` should check Hebrew search results for "רסטומאץ'"/"RestoMatch" against "רסטומייט", and decide whether the Hebrew brand or landing copy needs a clear way to tell them apart. Any trademark question goes to the owner.

### Overlap with RestoMatch
- **High on narrative, low on mechanism.** Restomate tells the same story ("costs creep, you find out too late, we ping you on WhatsApp"), but it starts from **menu food-cost %**, not from **supplier invoice vs agreed price and delivery**. It offers no claim, recovery, allocation-number or approval loop (UNVERIFIED either way).
- Its "switch supplier" option is cross-supplier price comparison. `docs/ICP.md` §6 marks `product_group_id` / cross-supplier compare as **later, locked decision: not building now**. **I do not argue to reopen this.** Restomate offers it with no evidence that it moves owner money. RestoMatch's version of the same alert is A18: "this supplier charged ₪X/month above the price you agreed". That alert is actionable as a **claim** without switching supplier.

### Reviews
- **None found** (UNVERIFIED).

---

## 3. BestRest: the thinnest-evidence direct overlap

### What it does
- The homepage title is "BestRest – expense management for restaurants". It describes an **AI-based** system that **scans invoices in seconds**, **tracks supplier costs in real time**, **builds recipes**, and **exports reports for the accountant** [vendor, via search extract].
- No help centre, no feature pages, no store listing, no company or founder page and no launch date surfaced (UNVERIFIED).

### Price
- **Not found** (UNVERIFIED).

### Who buys it
- From the copy: an owner who wants invoices off paper and to the accountant, with a cost view. That is also the **first job** RestoMatch does.

### Overlap with RestoMatch
- **Highest on surface features.** Invoice OCR, supplier price tracking and recipe cost are the three things a chef-owner sees first in RestoMatch too. No evidence of delivery or receiving checks, a discrepancy taxonomy, claims, consolidated invoices or approvals.
- ext-01's finding still holds: "photograph → OCR → fields filled" is **table stakes** in Israel (SUMIT, Rivhit, iCount, Morning, VirtuAc). BestRest is that table stake with a restaurant label. It competes for the owner's *first* "do I need another app?" decision. It does not compete with the leak ₪.

### Reviews
- **None found** (UNVERIFIED).

---

## 4. Considered and not picked

| Candidate | Why not in the top 3 | Source |
|---|---|---|
| **Tabit / Beecomm** back-office | POS-first. ext-01 found no supplier-invoice module, and this round's searches for Tabit and Beecomm inventory or supplier modules returned nothing new. Both sit with Zestt as cash-register partners | ext-01 §4; search 2026-11-07 |
| **Priority for restaurants** | A bookkeeper's ERP, bought by the accountant or by chains, not the owner-operator. Covered in ext-01 (24.1 allocation-number check) | ext-01 §3 |
| **SUMIT / VirtuAc / Payper** | General SMB bookkeeping capture. **Payper** has a restaurant expense page and plans from ₪9 to ₪119 a month before VAT, with OCR "for every receipt", smart categorisation and supplier-debt add-ons (₪9 and ₪29) [vendor]. Not restaurant-specific in mechanism, and it sells to the bookkeeping job, not to food cost | payper.co.il pricing and restaurant articles |
| **"Optimum / Rest"** | No Israeli product found under that name. Results were Optimum Control (US, from about $125/month on GetApp) [store/directory], not sold in Israel as far as I can tell. "Rest" (`rest.co.il`) is Zap's consumer restaurant guide, not back office | GetApp, Capterra listings; rest.co.il |
| **"Foodies" / Hebrew chef costing apps** | No Hebrew recipe-costing app surfaced. The nearest was MenuGauge, an English Google Sheets add-on (free for 3 recipes, Plus $29/month for 50) [vendor]. Not Israeli | Google Workspace Marketplace |

**Consultants are a quiet competitor.** Israeli CPAs and restaurant consultants sell food-cost work: Levy Finance, Shuminov-Levy CPA, Avi Hochman, 4ward [consultant]. Their own pages say "check every invoice against agreed prices". RestoMatch can be the tool they use. That is a channel idea, and it is UNVERIFIED as demand.

---

## 5. Owners' and chefs' voice, 2024–2026

### Closures and demand
- **2025: about 4.6% of all Israeli restaurants closed**, and **close to 9 in 10** of the closures were established places, not new ones. **New openings fell 41%** in 2025 (Mako, citing Dun & Bradstreet) [press].
- **About 61,000 companies and businesses closed in 2025**, the worst year of the decade, mostly small and medium businesses (Mako) [press]. In H1 2025 about **33,060 businesses closed against about 20,000 opened** (Maariv) [press].
- **Restaurants and pubs remain "the riskiest sector in the economy"** (Bizportal, citing Dun & Bradstreet; date of the piece not confirmed) [press].
- **Tel Aviv:** about **one restaurant closure a week** in early 2025, "the trend has slowed but not stopped" (Time Out Tel Aviv) [press]. Rest magazine ran a "10 beloved Tel Aviv restaurants that closed in 2025" farewell list [press]. Maariv reports restaurants and bars "running away from Tel Aviv" [press].
- **Half of the restaurants that closed in 2024 were veterans with 15+ years**. Owners cite food and staff costs that "rose markedly over the last three to four years", an acute staff shortage, and high financing and raw-material costs (Israel Hayom) [press].
- **Late 2024: more than 100 restaurants closed in a few months**, and central-Israel bookings fell **30%** (ice.co.il, summarising ynet's "סוף הסרוויס") [press]. Calcalist reported a **31%** drop in Tel Aviv occupancy "since the start of the year" and a **19%** drop in diners in a separate piece. The year in those extracts is unclear [press].
- **2026:** a restaurant group with about **₪10M** of debts asked for a stay of proceedings (Mako, Q4 2026) [press].

### Supplier prices and invoices (owners' own words, paraphrased)
- A restaurateur told Calcalist that dish prices rose **5–10%** "because the suppliers don't stop raising prices on restaurant owners". In an earlier Calcalist piece, an industry body said meat, cheese, fish, canned and imported dry goods had risen **10–20%** in the preceding months, and owners raised dishes "by a few shekels to protect margins that were already thin". Another said suppliers kept prices up even when a weaker dollar should have lowered them. These Calcalist items are likely **2022–2024**. Exact dates not confirmed from extracts [press].
- **The money flows both ways.** ynet reports suppliers left with **open invoices worth tens of thousands of shekels** from restaurants that closed, and owners describe turnover down "up to 50%" [press]. Owners whose cash flow is that tight are the ones who most need to stop paying for goods they didn't get.
- **Israeli advisers name the leak directly:**
  - Levy Finance: a common problem is **creeping supplier price rises that pass under the radar because invoices are not supervised**. Its advice is to supervise the invoices [consultant].
  - Shuminov-Levy CPA: **check every invoice against the agreed prices**, and keep comparing competing suppliers [consultant].
  - Avi Hochman (restaurant consulting, page updated about 40 days before 2026-11-07): "suppliers change prices, raw materials get dearer", and a dish can start losing money. Food-cost target ~**27–30%** [consultant].
- **Food-cost targets heard in Israel:** about 30% (Restigo), 28–35% (Restomate), 27–30% (Hochman). One café owner (Walla Food) aims for 32–38%, though that interview is about four years old, outside the 2024–2026 window [vendor/consultant/press].
- **Facebook owners' groups, Tapuz, Reddit:** **no indexed thread found** on supplier overcharge, missing credits or invoice checks (UNVERIFIED). The only owners' Facebook group surfaced in news was one formed around accessibility class actions (Time Out). This voice is not reachable by search. Collect it in pilot interviews.

### What this means for the pitch (assumptions explicit)
- **ASSUMED:** an owner who sees 5–10% supplier price rises and 4.6% of peers closing will listen to "₪X of your invoices didn't match what you agreed or received". Sources show pressure and the absence of invoice checks. **No source measures the leak itself in Israel.** RestoMatch's ≥1.5% North Star stays our hypothesis, to be proven in the pilot, not a market fact.
- Price-rise news is **not** leak. A supplier's announced, agreed price rise is not a discrepancy. Only a charge **above the agreed price**, **for goods not received**, or **billed twice** counts. Marketing must not blur this, or we break "one leak definition".

---

## 6. Gaps RestoMatch can exploit (and how, within owner rules)

1. **"Checked invoices, not quoted prices."** Restomate and BestRest compute cost from supplier prices or scans. None shows a check of the invoice against the agreed price and the delivery. RestoMatch's food cost and A18 price creep should state that they are **built from verified invoice lines**. For the chef this shows on orders and recipes only. Receivers see no ₪.
2. **The claim loop nobody shows.** Restigo has a "credit request". Nobody shows ageing, **overdue at 7 days**, or "recovered = credit note posted". A12 (recovery chase loop) and A22 (supplier communication loop) are the gap. **Drafts only. Nothing is sent to a supplier automatically**, and every send is human-confirmed.
3. **Consolidated invoices (חשבוניות ריכוז).** No Israeli player beyond Zestt (manual) and Priority (identical quantities only) handles them. A9 and A14 remain a moat. Show them as **T4 neutral** so they never raise a false alarm.
4. **VAT and allocation number.** None of the three mentions it. A13 is a differentiator against owner-facing tools, though only parity against Priority (ext-01).
5. **A single ₪ number vs "% saving".** All three competitors use spend-% claims: up to 8%, 4–7%, and Zestt's 6% (ext-07). RestoMatch should show **₪ caught / ₪ claimed / ₪ recovered**, labelled, never a "% saved" that mixes food and labour. Hours-₪ (A2 time ledger) are shown separately and never added to money-₪.
6. **Sit beside suites, don't replace them.** Restigo users keep Restigo for stock, shifts and tips. RestoMatch can take its orders or receipts as input if an export exists (UNVERIFIED; no Restigo API documentation found), the same "integrate, don't fight" stance as ext-07 for Zestt.

**Things we should not copy:** "switch supplier" advice (cross-supplier compare is **later** in ICP §6), "smart orders" and par levels (**later / anti-ICP border**), and an expected-vs-actual usage engine driven by POS (A26 is **later**, under ICP veto risk). All three are Restomate's or Restigo's turf and pull RestoMatch toward procurement and inventory.

---

## 7. Open questions (UNVERIFIED, for a human or a later run)
- Restigo price per branch, whether a Restigo export or API exists, and what the H-ERP (Hashavshevet) partner interface carries.
- Whether Restomate reads invoices at all, and its customer count, founding date and plans above ₪299.
- BestRest's company, price, launch date and whether it is live.
- Whether the "Restomate" mark is registered in Israel (owner and legal question).
- Real owner reviews of any of the three. Ask in pilot interviews: "which back-office app have you tried, and why did you stop?"

---

## Sources (all seen 2026-11-07; extracts via search, not full reads)

**Restigo**
- Homepage (title: הזמנות-רכש-מלאי-נוכחות-טיפים) — https://www.restigo.co.il/
- Products — https://www.restigo.co.il/%D7%94%D7%9E%D7%95%D7%A6%D7%A8%D7%99%D7%9D-%D7%A9%D7%9C%D7%A0%D7%95/
- Food cost — https://www.restigo.co.il/%D7%A4%D7%95%D7%93-%D7%A7%D7%95%D7%A1%D7%98/
- Labour cost — https://www.restigo.co.il/labor-cost/
- Staff management — https://www.restigo.co.il/%D7%A0%D7%99%D7%94%D7%95%D7%9C-%D7%A2%D7%95%D7%91%D7%93%D7%99%D7%9D/
- Suppliers — https://www.restigo.co.il/%D7%A1%D7%A4%D7%A7%D7%99%D7%9D/
- Inventory — https://www.restigo.co.il/xml-%D7%A9%D7%9C%D7%99%D7%97%D7%AA-%D7%94%D7%96%D7%9E%D7%A0%D7%94-%D7%9C%D7%A1%D7%A4%D7%A7/api4-2/
- Orders — https://www.restigo.co.il/xml-%D7%A9%D7%9C%D7%99%D7%97%D7%AA-%D7%94%D7%96%D7%9E%D7%A0%D7%94-%D7%9C%D7%A1%D7%A4%D7%A7/api2/
- LinkedIn — https://il.linkedin.com/company/restigo
- Brandfetch — https://brandfetch.com/restigo.co.il
- H-ERP partner page — https://www.h-erp.co.il/restigo/
- App Store — https://apps.apple.com/ae/app/restigo/id1526293585 ; Google Play — https://play.google.com/store/apps/details?id=restigo.application&hl=en_US
- softwarecompare.co.il guide — https://softwarecompare.co.il/blog/%D7%AA%D7%95%D7%9B%D7%A0%D7%94-%D7%9C%D7%A0%D7%99%D7%94%D7%95%D7%9C-%D7%9E%D7%A1%D7%A2%D7%93%D7%94/

**Restomate**
- AI for restaurants (Tom, ₪299/month, 4–7%) — https://www.restomate.co.il/he/ai-for-restaurants
- Food cost (WhatsApp price-rise alert, 28–35%) — https://www.restomate.co.il/he/food-cost
- Inventory — https://restomate.co.il/he/inventory-management
- Management guide — https://www.restomate.co.il/he/restaurant-management-guide
- Unrelated same-name products — https://restomate.cloud/ ; https://restomateai.com/

**BestRest**
- Homepage — https://www.bestrestapp.com/

**Considered, not picked**
- Payper pricing — https://payper.co.il/marketing/pricing ; restaurant expenses — https://payper.co.il/marketing/article/%D7%A0%D7%99%D7%94%D7%95%D7%9C_%D7%94%D7%95%D7%A6%D7%90%D7%95%D7%AA_%D7%9C%D7%9E%D7%A1%D7%A2%D7%93%D7%95%D7%AA
- Optimum Control — https://www.getapp.com/all-software/a/optimum-control/ ; https://www.capterra.com/p/12406/Optimum-Control/
- MenuGauge — https://workspace.google.com/marketplace/app/menugauge_ai_for_google_sheets/617025592886?hl=he
- Tabit (SourceForge) — https://sourceforge.net/software/product/Tabit/

**Press: closures, demand, prices**
- Mako, 4.6% closed in 2025, −41% openings — https://www.mako.co.il/food-restaurants/restaurant-news/Article-00b05b813b52391026.htm
- Mako, ~61,000 businesses closed in 2025 — https://www.mako.co.il/news-money/2025_q4/Article-597ccc2d0cf4b91027.htm
- Maariv, H1 2025 closures vs openings — https://www.maariv.co.il/economy/israel/article-1350420
- Maariv, bars and restaurants leaving Tel Aviv — https://www.maariv.co.il/breaking-news/article-1363161
- Maariv, "expenses eat you" — https://www.maariv.co.il/food/article-1154315
- Bizportal, D&B riskiest sector — https://www.bizportal.co.il/general/news/article/108747
- Time Out, Tel Aviv closures 2025 — https://timeout.co.il/%D7%A1%D7%92%D7%99%D7%A8%D7%95%D7%AA-%D7%9E%D7%A1%D7%A2%D7%93%D7%94-2025/
- Rest magazine, 10 closures 2025 — https://www.rest.co.il/magazine/foodnews/31426/
- Israel Hayom, veteran restaurants closing — https://www.israelhayom.co.il/food/food-news/article/18927084
- ynet, "סוף הסרוויס" — https://www.ynet.co.il/economy/article/yokra14206911
- ice.co.il summary of ynet numbers — https://www.ice.co.il/consumerism/news/article/1045269
- ynet, wave of closures — https://www.ynet.co.il/food/foodnews/article/s1oqm5v11kg
- ynet, suppliers' open invoices — https://www.ynet.co.il/food/foodnews/article/Hk5fB6JMP
- Mako Q4 2026, group with ~₪10M debts — https://www.mako.co.il/news-tip12/2026_q4/Article-df55b4ffb2b91a1026.htm
- Calcalist, occupancy −30%/−31% — https://www.calcalist.co.il/shopping/article/ryahnx1111ex
- Calcalist, −19% diners — https://www.calcalist.co.il/shopping/article/ryy8phcu2
- Calcalist, "time to raise prices" — https://www.calcalist.co.il/shopping/article/SJ8kLVHc00
- Calcalist, raw materials up, restaurant prices jump — https://www.calcalist.co.il/shopping/article/hyyrmm5ok
- Time Out, owners' Facebook group (accessibility suits) — https://timeout.co.il/%D7%AA%D7%91%D7%99%D7%A2%D7%95%D7%AA-%D7%99%D7%99%D7%A6%D7%95%D7%92%D7%99%D7%95%D7%AA-%D7%A0%D7%92%D7%99%D7%A9%D7%95%D7%AA/
- Walla Food, café owner on prices (about 4 years old) — https://food.walla.co.il/item/3544996?r=1

**Consultants**
- Levy Finance, food cost — https://www.levyfinance.co.il/%D7%A4%D7%95%D7%93-%D7%A7%D7%95%D7%A1%D7%98/
- Shuminov-Levy CPA — https://oshcpa.co.il/%D7%97%D7%99%D7%A9%D7%95%D7%91-%D7%A2%D7%9C%D7%95%D7%99%D7%95%D7%AA-%D7%9E%D7%96%D7%95%D7%9F/
- Avi Hochman — https://www.avihochman.com/services/restaurant-consulting/
- 4ward — https://4ward.co.il/%D7%94%D7%A7%D7%9E%D7%AA-%D7%9E%D7%A1%D7%A2%D7%93%D7%95%D7%AA-%D7%97%D7%99%D7%A9%D7%95%D7%91-%D7%A2%D7%9C%D7%95%D7%99%D7%95%D7%AA-%D7%9E%D7%96%D7%95%D7%9F/
