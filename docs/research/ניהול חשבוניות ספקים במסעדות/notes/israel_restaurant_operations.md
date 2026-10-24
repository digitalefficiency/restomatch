# Israeli restaurant supplier ordering, receiving and invoices: workflow, leaks, market and software (as of Oct 2026)

> Method caveat (applies to every section): direct page fetches of Israeli domains (.co.il, gov.il, knesset.gov.il, ynet, globes, calcalist, zester, marketman.co.il) were refused by this environment's egress proxy. Every Israeli finding below comes from search-engine extracts of those pages, not a full read. Treat exact figures as "reported by the cited page, not re-read in full". Items marked **[anecdote]** come from one owner or one supplier. Items marked **[vendor claim]** are self-reported marketing.

## 1. End-to-end workflow: ordering → receiving → tax invoice → credits → כרטסת reconciliation → payment

### Takeaway
The legal and accounting backbone is well documented. The goods travel with a signed delivery note (תעודת משלוח). The tax invoice is either per delivery or a monthly consolidated invoice (חשבונית מרכזת) that must be linked to the delivery notes behind it. Shortages are corrected with a credit invoice (חשבונית זיכוי). A bookkeeper does the התאמת כרטסות, and payment runs on שוטף+30/60/90. The informal front end (WhatsApp or phone orders, who receives at the back door, whether goods are weighed, how often credits really arrive) is barely documented in public sources. It has to come from interviews.

### Cited Findings
**Ordering**
- Zester/Zestt (Israeli) markets "orders with suppliers from one place", "sent out by a quick click, automatic reminders and full synchronization with all your vendors". It runs as an app or on a computer and is built for restaurants and hospitality. — [Zestt EN site](https://www.zestt.io/en); [Zester login/site](https://zester.co.il/Account/Login)
- Restigo's procurement module covers sending new orders, receiving invoices and managing credits online, plus one-click catalog and price updates per supplier. — [Restigo – products](https://www.restigo.co.il/%D7%94%D7%9E%D7%95%D7%A6%D7%A8%D7%99%D7%9D-%D7%A9%D7%9C%D7%A0%D7%95/); [Restigo – suppliers](https://www.restigo.co.il/%D7%A1%D7%A4%D7%A7%D7%99%D7%9D/)
- I found no public source that documents WhatsApp or phone ordering to Israeli restaurant suppliers. An English B2B search returned nothing on WhatsApp order intake in Israel. — [search extract; e.g. SimpleOrder/TOI](https://www.timesofisrael.com/us-firm-buys-israel-restaurant-tech-startup-simpleorder-for-undisclosed-amount/)

**Receiving and the delivery note (תעודת משלוח)**
- A delivery note is proof of handover. It is not a tax invoice and does not create a payment obligation. A copy signed by the customer is evidence that the goods arrived in the stated quantity and on the stated date. Without it, a claim of "didn't receive" or "received less" "rests on the memory of both sides". — [ezbigboss – what a delivery note is](https://ezbigboss.com/%D7%9E%D7%94%D7%99-%D7%AA%D7%A2%D7%95%D7%93%D7%AA-%D7%9E%D7%A9%D7%9C%D7%95%D7%97/)
- Common delivery-note errors: a mismatch between the delivery note and the invoice, missing sequential numbering, and only partial recording of quantities. — [ezbigboss – how to issue a delivery note](https://ezbigboss.com/%D7%AA%D7%A2%D7%95%D7%93%D7%AA-%D7%9E%D7%A9%D7%9C%D7%95%D7%97/%D7%9E%D7%90%D7%9E%D7%A8%D7%99%D7%9D-%D7%A2%D7%9C-%D7%AA%D7%A2%D7%95%D7%93%D7%AA-%D7%9E%D7%A9%D7%9C%D7%95%D7%97/%D7%90%D7%99%D7%9A-%D7%9E%D7%A4%D7%99%D7%A7%D7%99%D7%9D-%D7%AA%D7%A2%D7%95%D7%93%D7%AA-%D7%9E%D7%A9%D7%9C%D7%95%D7%97)
- The Income Tax bookkeeping regulations (הוראות מס הכנסה – ניהול פנקסי חשבונות) require delivery notes for shipments of inventory, numbered in a sequential series. — [Wikisource – הוראות ניהול פנקסים](https://he.wikisource.org/wiki/%D7%94%D7%95%D7%A8%D7%90%D7%95%D7%AA_%D7%9E%D7%A1_%D7%94%D7%9B%D7%A0%D7%A1%D7%94_(%D7%A0%D7%99%D7%94%D7%95%D7%9C_%D7%A4%D7%A0%D7%A7%D7%A1%D7%99_%D7%97%D7%A9%D7%91%D7%95%D7%A0%D7%95%D7%AA))
- Weighing at receiving, the person who signs (chef, shift manager or owner), handling substitutions and returns: **no Israeli source found** (see Gaps).

**Tax invoice: per delivery or monthly consolidated**
- In the Israeli supplier-portal "invoice file 100" format, each invoice record must be accompanied by the delivery-note record(s) it covers. The delivery-note number travels under "אספקות". — [Segment – file 100 guidelines](https://www.segment.co.il/file100)
- Segment's supplier portal uses delivery-note data to validate the invoice against the order and the actual supply. The delivery note can reach the system before the goods arrive. — [Segment portal](https://www.segment.co.il/)
- Priority ERP: a final consolidated supplier invoice (חשבונית ספק מרכזת) can be linked to a goods-receipt line only when the quantity on the invoice line is identical to the quantity on the receipt line. Mismatches therefore surface at linking. — [Priority KB Q0001180](https://support.priority-software.com/he/kb/Q0001180_H/Hebrew)
- Hashavshevet in the cloud shows the money balance of **open delivery notes** next to the supplier account balance. Open notes are those not yet invoiced. — [WizCloud help](https://home.wizcloud.co.il/help/invoice/)
- Gafny accounting software can pull the delivery note into the invoice "to save typing and compare against the charge". — [Gafny AP](http://www.gafny.com/html/ap.html)

**Credits (זיכויים) for shortages and price errors**
- A credit invoice does not need an allocation number. If an invoice is returned to the supplier, it should be corrected the same day. An invoice error discovered only at the periodic VAT report can delay the input-VAT deduction. — [ezbigboss – Israel Invoices guide 2026](https://ezbigboss.com/%D7%9E%D7%A1%D7%A4%D7%A8-%D7%94%D7%A7%D7%A6%D7%90%D7%94-%D7%97%D7%A9%D7%91%D7%95%D7%A0%D7%99%D7%AA-%D7%99%D7%A9%D7%A8%D7%90%D7%9C/)
- If neither side holds the original, a tax invoice cannot be cancelled. The supplier issues a credit invoice and sends it by registered mail or gets a signed acknowledgement. — [Caspit](https://www.caspit.biz/Article.aspx?id=2)
- An Israeli cost-reduction consultant describes the audit loop: compare agreed terms with actual charges, flag the gaps, then raise them with the supplier. "Sometimes a credit is received, sometimes the charging mechanism is fixed, and sometimes it turns out the problem is in the agreement and not the invoice." — [Rami Shprinz – supplier invoice audit](https://shprinz.co.il/%D7%99%D7%93%D7%A2-%D7%9E%D7%A7%D7%A6%D7%95%D7%A2%D7%99/supplier-invoice-audit/)
- How often requested credits actually arrive in Israeli restaurants: **no data found**.

**Bookkeeper: supplier statement reconciliation (התאמת כרטסות)**
- Israeli AP and bookkeeper job ads list the same chores: intake and checking of supplier invoices, matching invoice to order or delivery note, supplier reconciliations (התאמות ספקים / התאמת כרטסות ספקים), preparing and tracking supplier payments, and petty cash. They ask for Priority or SAP experience and a class 2+ bookkeeping certificate. These ads are general, not restaurant-specific. — [Drushim – AP bookkeeper search](https://www.drushim.co.il/jobs/search/%D7%9E%D7%A0%D7%94%D7%9C%20%D7%97%D7%A9%D7%91%D7%95%D7%A0%D7%95%D7%AA%20%D7%A1%D7%A4%D7%A7%D7%99%D7%9D/)
- A 2026 extraction guide warns that in a VAT audit the inspector or CPA expects both the invoice number and the receipt number in the supplier card. It recommends keeping the receipt number, the supplier's tax ID and the payment date so bank reconciliation works when the bank line lacks detail. — [invoicedataextraction – חשבונית מס/קבלה to Excel (2026)](https://invoicedataextraction.com/blog/cheshbonit-mas-kabbalah-suppliers-to-excel)

**Payment terms**
- "שוטף+" is supplier credit, paid N days after the start of the next month. שוטף+60 and שוטף+90 are "very common", and most of the economy runs on שוטף+30. — [Bet Maor – what is שוטף פלוס](https://www.bet-maor.co.il/article/%D7%9E%D7%94-%D7%96%D7%94-%D7%A9%D7%95%D7%98%D7%A3-%D7%A4%D7%9C%D7%95%D7%A1-%D7%90%D7%95-%D7%90%D7%A9%D7%A8%D7%90%D7%99-%D7%A1%D7%A4%D7%A7%D7%99%D7%9D/)
- The Payment Ethics to Suppliers Law 2017 (חוק מוסר תשלומים לספקים, in force 30.07.2017) sets a latest payment date that the parties cannot extend by agreement, except in defined cases. — [Kol Zchut](https://www.kolzchut.org.il/he/%D7%94%D7%9E%D7%95%D7%A2%D7%93_%D7%94%D7%90%D7%97%D7%A8%D7%95%D7%9F_%D7%9C%D7%AA%D7%A9%D7%9C%D7%95%D7%9D_%D7%AA%D7%9E%D7%95%D7%A8%D7%94_%D7%9C%D7%A1%D7%A4%D7%A7%D7%99%D7%9D_%D7%A2%D7%91%D7%95%D7%A8_%D7%A1%D7%97%D7%95%D7%A8%D7%94_%D7%90%D7%95_%D7%A9%D7%99%D7%A8%D7%95%D7%AA); [Protocol – supplier payment deadline](https://protocol.co.il/deadline-payment-supplier/)
- **[anecdote, 2020]** A food supplier to restaurants said in COVID that "most customers stopped or delayed payments, and quite a few cheques bounced". He advised moving to cash on new deliveries. This confirms that cheques are used in the channel. — [ynet – restaurant suppliers: debts and damages](https://www.ynet.co.il/food/foodnews/article/Hk5fB6JMP)
- **[anecdote, 2020]** A supplier to restaurants working on שוטף+60 hit a cash-flow crisis when payments were late. — [ynet – suppliers help restaurateurs](https://www.ynet.co.il/food/foodnews/article/rk7vqAvMv)

**2026 regulatory change: "Israel Invoices" (חשבוניות ישראל)**
- The allocation-number (מספר הקצאה) threshold, pre-VAT, stepped down: ₪25,000 (May 2024), ₪20,000 (Jan 2025), ₪10,000 (Jan 2026), ₪5,000 (from June 2026). Without an allocation number the buyer cannot deduct the input VAT. — [Morning magazine – Israel invoice](https://www.greeninvoice.co.il/magazine/israel-invoice/); [Kipa – digital invoice from 2026](https://www.kipa.co.il/%D7%9B%D7%93%D7%90%D7%99-%D7%9C%D7%93%D7%A2%D7%AA/1232040-0/); [Capitax – VAT](https://www.capitax.co.il/content/2/3434)
- Conflict: a sponsored article from about April 2026 still described the ₪5,000 step as expected rather than in force. — [hon.co.il (sponsored)](https://www.hon.co.il/?p=273934)
- A transaction invoice (חשבונית עסקה) does not allow input-VAT deduction, so receivers have to distinguish it from a tax invoice. — [Eddie CPA – receiving a tax invoice 2026](https://www.eddiecpa.com/articles/%D7%A7%D7%91%D7%9C%D7%AA-%D7%97%D7%A9%D7%91%D7%95%D7%A0%D7%99%D7%AA-%D7%9E%D7%A1-%D7%9E%D7%94-%D7%A9%D7%90%D7%AA%D7%9D-%D7%97%D7%99%D7%99%D7%91%D7%99%D7%9D-%D7%9C%D7%93%D7%A2%D7%AA-%D7%9B%D7%93%D7%99/)

### Inferences
- The documentary chain is order (often none on paper) → signed delivery note → per-delivery tax invoice or monthly חשבונית מרכזת → supplier כרטסת → payment on שוטף+N. The **signed delivery note is the only contemporaneous evidence of what arrived**. If the receiver signs without counting or weighing, the leak is locked in before any software sees it.
- Monthly consolidated invoices push the moment of truth weeks after delivery. On שוטף+60/90 the money leaves 2–4 months after the goods arrived. That makes later disputes and credit-chasing weak, and gives a product a long window to catch errors **before payment**.
- ERP link rules (Priority needs identical quantities) mean shortages and partial deliveries already block the bookkeeper's linking step. This is a concrete pain point to target.
- The 2026 allocation-number regime (₪5,000 threshold) adds a new, verifiable ₪ leak: input VAT that cannot be deducted on a supplier invoice that lacks an allocation number. A monthly consolidated invoice from a mid-size supplier will often exceed ₪5,000.

### Gaps
- No public Israeli source on who orders (chef, owner or manager) or the channel mix (WhatsApp, phone, supplier app, Zester). This needs owner and chef interviews.
- No source on back-door practice: weighing, counting, who signs, or how substitutions and returns (תעודת החזרה) are recorded.
- No data on the **credit realization rate** (credits requested vs. received) in Israel or elsewhere.
- The exact Payment Ethics Law deadlines for private B2B payers (as opposed to public bodies) were not confirmed in the extracts.
- Full pages could not be read (proxy).

## 2. Leak sources and their magnitude

### Takeaway
No Israeli study of invoice error rates exists in public sources. The best comparable figure is US: in 2015, 35% of restaurant invoices carried at least one overcharge. Israeli evidence on price creep is press anecdote (supplier hikes of 10–30% around 2022). Israeli consultant benchmarks put food cost at about 30% of food revenue. So a leak of ≥1.5% of food spend is plausible, but in Israel it is unmeasured.

### Cited Findings
- **US benchmark (2015):** Consolidated Concepts analysed 11,000+ invoices from 400 restaurants and found at least one overcharge on **35%** of them. Causes were mostly process failures (contracts loaded late or only partly loaded), "not tricks or bad intentions" (Bruce Reinstein). This is a per-invoice incidence, not a ₪ magnitude. — [FSR Magazine](https://www.fsrmagazine.com/industry-news/overcharges-continue-show-restaurant-invoices/); same 35% for college foodservice: [FoodService Director](https://www.foodservicedirector.com/news-trends/analysis-35-college-food-invoices-have-overcharges)
- Cross-industry, second-hand: APQC puts the average error rate on manually processed invoices at about **2%**, and IOFM says 68% of businesses see errors on >1% of invoices. These are cited via a vendor blog. — [Phacet – cost of invoice errors](https://www.phacetlabs.com/blog/cost-of-invoice-errors)
- **[vendor claim]** "39% of vendor invoices contain billing errors" (attributed to IOFM, unverified). — [Vellum blog](https://www.vellum.ai/blog/how-to-catch-restaurant-vendor-price-creep)
- **[vendor case]** Astotel (hotel group) cut its invoice error rate from 7% to 2% by checking 100% of invoices before payment. — [Phacet – prevent overpayment](https://www.phacetlabs.com/blog/prevent-supplier-overpayment)
- Quantity discrepancies (short deliveries billed in full) are named as one of the two most common overcharge mechanisms. This restates the 35% source, so it is not independent. — [Supy blog](https://supy.io/blog/learn-supplier-overcharging-restaurants)
- **Israeli price creep [press, ~2020–2023; quote-to-article mapping not individually verified]:** the CEO of the "מסעדנים חזקים ביחד" association described 10%–20% rises across raw materials (meat, cheese, imports). A restaurateur said "all suppliers raised prices, not minor, 10%–30%". A Calcalist piece said large food suppliers made "exceptional increases of 10% to 25% on most products". — [Calcalist – "דחינו ודחינו"](https://www.calcalist.co.il/shopping/article/SJ8kLVHc00); [Calcalist – חומרי הגלם התייקרו](https://www.calcalist.co.il/shopping/article/hyyrmm5ok); [Calcalist – ספקיות המזון זיהו חלון הזדמנויות](https://www.calcalist.co.il/shopping/article/r1w3hxjmj)
- 2026: the Restaurant & Bar Association warned the PM that the kashrut reform will raise prices, because "every extra cost imposed on a restaurant… does not stay with the owner". — [Mako, 2026 Q2](https://www.mako.co.il/news-tip12/2026_q2/Article-ba90f46df288e91026.htm)
- **Food cost benchmarks (Israeli consultants and CPAs):** about 30% for restaurants, about 25% for fast food, about 15% for alcohol. Other ranges given are 25–35% and 27–30%. "Purchasing food cost" (פוד קוסט רכש) is total supplier purchases divided by revenue. Poor pantry control leads to buying pricier substitutes and to spoilage. — [Oshcpa – food cost calc](https://oshcpa.co.il/%D7%97%D7%99%D7%A9%D7%95%D7%91-%D7%A2%D7%9C%D7%95%D7%99%D7%95%D7%AA-%D7%9E%D7%96%D7%95%D7%9F/); [Restigo – פוד קוסט](https://www.restigo.co.il/%D7%A4%D7%95%D7%93-%D7%A7%D7%95%D7%A1%D7%98/); [Avi Hochman](https://www.avihochman.com/services/restaurant-consulting/); [EP Consulting](https://www.epconsulting.info/%D7%A4%D7%95%D7%93-%D7%A7%D7%95%D7%A1%D7%98-%D7%90%D7%99%D7%9A-%D7%9C%D7%AA%D7%9E%D7%97%D7%A8-%D7%A0%D7%9B%D7%95%D7%9F-%D7%9E%D7%A0%D7%94-%D7%91%D7%9E%D7%A1%D7%A2%D7%93%D7%94/)
- **[anecdote, 2025]** One restaurant's food purchases were about ₪3M, less than a third of its total expenses. — [ynet – סוף הסרוויס](https://www.ynet.co.il/economy/article/yokra14206911)
- **[vendor claims]** Zester: "average 6% monthly reduction in procurement" and "up to 4% saving in food costs". Restigo: savings "up to 8% of food cost and labor cost". — [Zestt](https://www.zestt.io/en); [Restigo](https://www.restigo.co.il/)
- VAT-specific leaks: a missing allocation number (above ₪10,000 from Jan 2026 and ₪5,000 from Jun 2026) or a חשבונית עסקה blocks input-VAT deduction (see §1). — [Morning magazine](https://www.greeninvoice.co.il/magazine/israel-invoice/); [Eddie CPA](https://www.eddiecpa.com/articles/%D7%A7%D7%91%D7%9C%D7%AA-%D7%97%D7%A9%D7%91%D7%95%D7%A0%D7%99%D7%AA-%D7%9E%D7%A1-%D7%9E%D7%94-%D7%A9%D7%90%D7%AA%D7%9D-%D7%97%D7%99%D7%99%D7%91%D7%99%D7%9D-%D7%9C%D7%93%D7%A2%D7%AA-%D7%9B%D7%93%D7%99/)

### Inferences
- Leak taxonomy for Israel, ranked by evidence: (1) **price creep** against an agreed price, documented by press and consultants; (2) **short or partial delivery billed in full**, with documentary hooks in the delivery note and ERP links but no Israeli rate; (3) **agreement vs. invoice mismatch**, per Shprinz; (4) **VAT and allocation-number deductibility**, new in 2026 and fully verifiable; (5) duplicates, unit or weight errors and missing credits, which are plausible but have no Israeli data.
- Rough arithmetic, not sourced: at 30% food cost, ₪1.5M yearly revenue gives about ₪450K of food spend, so 1.5% is about ₪6,750 a year (about ₪560 a month). Vendor savings claims of 4–8% are an order of magnitude above that and unverified. The "≥1.5%" target sits well below the vendor claims and near the APQC 2% cross-industry error rate.
- VAT note (known context, not re-verified in this search pass): Israel's VAT rate rose from 17% to 18% on 1 Jan 2025. Invoices or tools still computing 17% are a concrete VAT-error source.

### Gaps
- No Israeli measurement of invoice error incidence, duplicate rate, credit-note non-receipt or short-delivery frequency.
- No Israeli CBS or Restaurant Association figure for sector-wide food cost %.
- The 35% US figure is 11 years old and measures incidence, not shekel value.

## 3. The Israeli market: size, independents vs. chains, purchasing, supplier categories

### Takeaway
Israel has about 12,000–14,000 active food-service businesses. That is roughly 12,000 per the Knesset Research Center (June 2023) and about 14,000 pre-COVID per D&B (2021). About 42% are self-employed with no staff. Only about 2,000 are full-service restaurants (per Ontopo). The sector has the lowest 19-year business survival rate in CBS data. The supplier base is fragmented across specialists (produce, meat, fish, dairy) and general distributors.

### Cited Findings
- About 12,000 active businesses in the restaurant sector (June 2023). Of 12,130 active businesses, **42% are self-employed with no employees**. — [Knesset Research & Information Center – restaurant sector review (2023)](https://fs.knesset.gov.il/globaldocs/MMM/c5501278-cf1b-ee11-8159-005056aac6c3/2_c5501278-cf1b-ee11-8159-005056aac6c3_11_20235.pdf); related: [Knesset MMM – manpower shortage](https://fs.knesset.gov.il/globaldocs/MMM/ad6da6f3-c7ff-ed11-815c-005056aa4246/2_ad6da6f3-c7ff-ed11-815c-005056aa4246_11_20240.pdf)
- About 14,000 active businesses before COVID (restaurants, cafés, bars, food stands) and about 2,000 cafés in Q4 2021. — [Dun & Bradstreet Israel, Oct 2021](https://dbisrael.co.il/db-experts/editorial/restaurant_27102021/)
- About 2,000 full-service restaurants per Ontopo data. Ontopo serves about 1,200 restaurants and reported a 29% activity decline early in 2025, later followed by a "surprising recovery". — [Calcalist – 30% occupancy drop](https://www.calcalist.co.il/shopping/article/ryahnx1111ex); [Maariv – sharp decline](https://www.maariv.co.il/economy/israel/article-1196536) (which figure belongs to which article could not be confirmed)
- More than 100 restaurants closed in the year before the 2025 article. — [ynet – סוף הסרוויס](https://www.ynet.co.il/economy/article/yokra14206911)
- CBS business demography: **accommodation and food services has the lowest 19-year survival rate (9.4%)**. Israel had about 711K active businesses in 2024. — [CBS media release 2025](https://www.cbs.gov.il/he/mediarelease/DocLib/2025/250/29_25_250b.pdf)
- Israelis spend about ₪20B a year in cafés and restaurants. 55% of outlets are in the Center and Sharon (5,980 points of sale), which implies about 11K outlets nationally (derived; older article). — [Walla](https://finance.walla.co.il/item/3121784)
- An ERCG survey for the Restaurant & Bar Association (2023) found the sector employs 140K local workers. The industry asked for 30K foreign workers. — [Calcalist](https://www.calcalist.co.il/local_news/article/byao2z81a)
- Chains (June 2026): McDonald's 238 branches, Aroma 188, Café Greg 82. — [Israel Hayom](https://www.israelhayom.co.il/food/food-news/article/20939657)
- Supplier structure: general distributors carry thousands of branded SKUs, while specialist producers serve narrow niches. — [Yaday – food wholesale for restaurants](https://www.yaday.co.il/%D7%90%D7%99%D7%9A-%D7%A2%D7%95%D7%91%D7%93-%D7%A2%D7%95%D7%9C%D7%9D-%D7%A1%D7%99%D7%98%D7%95%D7%A0%D7%90%D7%95%D7%AA-%D7%94%D7%9E%D7%96%D7%95%D7%9F/). Examples: produce (peeled vegetables, mushrooms for restaurants and hotels) — [Tapuchan](https://www.tapuchan.co.il/); meat for restaurants — [Kafuzan](https://www.kafuzan.co.il/%D7%91%D7%A9%D7%A8-%D7%9C%D7%9E%D7%A1%D7%A2%D7%93%D7%95%D7%AA/); dairy distributing directly to businesses — [Tavor Dairy](https://www.tavordairy.com/wholesale-Food-suppliers); a directory of about 2,000 importers, wholesalers and meat, fish and veg suppliers — [sapakim-il.com](https://sapakim-il.com/); one directory lists 19 fish and 149 fruit-and-veg suppliers — [Cohen B – suppliers](https://www.cohenb.com/sapakim/)
- Tabit publishes an "Israel restaurant index" (מדד המסעדות), but no 2026 figures surfaced. — [madad-il.tabit.cloud](https://madad-il.tabit.cloud/)

### Inferences
- The addressable owner-operator ICP (independent, 1–3 branches, with staff and real supplier volume) is probably on the order of 5,000–7,000 businesses: about 12K minus the 42% with no staff, minus chain branches. This is an estimate, not a sourced figure.
- High churn (9.4% 19-year survival) means a constant flow of new owners setting up suppliers and workflows. It also argues for low-commitment pricing.
- A typical independent likely deals with 5–15 suppliers across produce, meat, fish, dairy, bakery, beverages, dry goods and cleaning, mixing per-delivery invoices (small specialists) with monthly consolidated invoices (large distributors and dairies). This is inferred from the supplier structure. No source counts suppliers per restaurant.

### Gaps
- No CBS 2024–2026 count for industry 561 (restaurants) and no turnover figure surfaced.
- No independents-vs-chains split by count or by purchasing volume.
- **No source for the typical monthly food purchasing of an owner-operator** (only the ₪3M/yr single-restaurant anecdote).
- No supplier-concentration data (e.g. top-3 supplier share of spend).

## 4. Israeli software landscape (procurement, POS, accounting, AP capture)

### Takeaway
Israeli restaurant back-office tools fall into three layers. Restaurant procurement and inventory: Zester/Zestt, MarketMan, Restigo. POS with inventory: Tabit, Beecomm. Bookkeeper accounting and ERP: Hashavshevet/H-ERP, Priority, plus Morning, iCount and Rivhit for invoicing. Generic AP-capture tools sit alongside (Dokka, YK, Segment). Restaurant procurement tools already claim OCR and delivery-vs-invoice matching. None publishes Israeli pricing, and none publishes an independent ₪-leak figure.

### Cited Findings
**Restaurant procurement and inventory**
- **Zester / Zestt** (Israeli): a procurement system built for restaurants and hospitality. It has a supplier side that "connects to ERP systems", with delivery notes sent and received through the system. It claims **15,000 restaurants and 2,000 vendors** [vendor claim] and lists Tabit and Beecomm among its partners, with cash-register interfaces. — [Zestt](https://www.zestt.io/en); [Zestt restaurants/partners](https://www.zestt.io/en/restaurants); [Zestt for vendors](https://zester.power.casa/en/zestt-for-vendors/). H-ERP (a Hashavshevet partner) lists Zester as an integration partner. — [H-ERP – Zester](https://www.h-erp.co.il/zester-%D7%A0%D7%99%D7%94%D7%95%D7%9C-%D7%9E%D7%A1%D7%A2%D7%93%D7%94-%D7%96%D7%A1%D7%98%D7%A8-%D7%97%D7%A9%D7%91%D7%A9%D7%91%D7%AA-erp/)
- **MarketMan** (Israeli-founded, Ra'anana address): cloud inventory and purchasing for restaurants. Its Israeli Facebook page claims **1,200+ restaurants, cafés and bars** served. US pricing: Starter $249/mo, Growth $299, Enterprise from $449. The FAQ markup elsewhere says $199/$249, and research.com lists Operator at $239. Starter includes 50 AI invoice scans a month, and Enterprise adds email invoice scanning. No ILS pricing was found. — [Globes](https://www.globes.co.il/news/article.aspx?did=1000994135); [marketman.co.il](https://marketman.co.il/); [MarketMan IL Facebook](https://www.facebook.com/marketmanisrael/); [MarketMan platform](https://www.marketman.com/platform); [research.com review 2026](https://research.com/software/reviews/market-man-review)
- **Restigo** (Herzliya, 1–10 employees per Crunchbase): a restaurant ERP covering orders, purchasing, inventory, attendance and tips. It offers "AI + OCR" supplier-invoice scanning, matches deliveries against invoices ("what was ordered, what arrived, what was paid"), and integrates with POS, accounting software and Wolt/10bis. Its supplier portal integrates with Priority, SAP and Hashavshevet. A third-party comparison rates its price "high" for small businesses. — [Crunchbase](https://www.crunchbase.com/organization/restigo); [restigo.biz modules](https://restigo.biz/?page_id=7); [restigo.co.il](https://www.restigo.co.il/); [Restigo suppliers](https://www.restigo.co.il/%D7%A1%D7%A4%D7%A7%D7%99%D7%9D/); [softwarecompare.co.il](https://softwarecompare.co.il/blog/%D7%AA%D7%95%D7%9B%D7%A0%D7%94-%D7%9C%D7%A0%D7%99%D7%94%D7%95%D7%9C-%D7%9E%D7%A1%D7%A2%D7%93%D7%94/)

**POS with inventory**
- **Tabit**: POS, orders, payments, inventory and reports in one system, "connected from the base" without intermediaries. It raised $35M. Its US integrations list includes Compeat and Restaurant365. — [Tabit IL](https://tabit.cloud/il/); [Geektime – $35M](https://www.geektime.co.il/tabit-raises-35-mm/); [Tabit US integrations](https://support-us.tabit.cloud/hc/en-us/articles/12570827573266-Overview-of-Tabit-s-Integrations)
- **Beecomm**: cloud POS for restaurants and counters, with iPad inventory synced to delivery channels, kiosks and online ordering. No supplier-invoice module was found. — [Beecomm cloud](https://www.beecomm.com/%D7%91%D7%99%D7%A7%D7%95%D7%9D-%D7%A2%D7%A0%D7%9F-1)
- Robotunnel (invoicing) says it syncs with 20+ POS vendors, including Verifone, Beecomm, Aviv, Autosoft and Arnet. — [Robotunnel](https://www.robotunnel.com/%D7%90%D7%99%D7%A0%D7%98%D7%92%D7%A8%D7%A6%D7%99%D7%99%D7%AA-%D7%A7%D7%95%D7%A4%D7%94-%D7%A1%D7%9C%D7%99%D7%A7%D7%94-%D7%90%D7%95%D7%A0%D7%9C%D7%99%D7%99%D7%9F-%D7%97%D7%A9%D7%91%D7%95%D7%A0%D7%99/)

**Accounting and ERP used by bookkeepers**
- **Hashavshevet ERP**: interfaces for sales documents (quote, order, delivery note, invoice) and purchasing, via ODBC or an ASCII file, with optional automatic import. The cloud version (WizCloud) shows the open delivery-note balance per account. — [H-ERP – Hashavshevet interfaces](https://www.h-erp.co.il/%D7%AA%D7%9E%D7%99%D7%9B%D7%94-%D7%91%D7%91%D7%AA%D7%99-%D7%AA%D7%95%D7%9B%D7%A0%D7%94/%D7%9E%D7%9E%D7%A9%D7%A7%D7%99%D7%9D-%D7%9C%D7%AA%D7%95%D7%9B%D7%A0%D7%AA-%D7%97%D7%A9%D7%91%D7%A9%D7%91%D7%AA/); [WizCloud](https://home.wizcloud.co.il/help/invoice/)
- **Priority**: links supplier consolidated invoices to goods receipts, which requires identical quantities. — [Priority KB](https://support.priority-software.com/he/kb/Q0001180_H/Hebrew); [Priority SOP – vendor invoices](https://cdn.priority-software.com/docs/SOP_VendInvs_22_1_H.pdf)
- **Morning (formerly חשבונית ירוקה)**: entry plan about ₪24–29/mo on annual billing, pre-VAT, for 20 documents, with a 30-day trial. One reviewer calls it pricey for what it offers. — [MSL guide](https://msl.org.il/guide/morning-green-invoice-review/); [Adir CPA comparison 2026](https://adircpa.com/guides/invoicing-software-israel)
- **iCount**: plans from ₪32/mo excluding VAT, by document volume, with a 45-day trial and ₪79/mo tax-authority representation. Third parties quote lower entry points. — [iCount pricing](https://www.icount.co.il/plans/); [iCount green invoice](https://www.icount.co.il/%D7%97%D7%A9%D7%91%D7%95%D7%A0%D7%99%D7%AA-%D7%99%D7%A8%D7%95%D7%A7%D7%94/)
- **Rivhit (רווחית)**, EZcount, Sumit and Big Boss are named as competitors. No Rivhit pricing was found. — [ezbigboss – alternatives to Morning 2026](https://ezbigboss.com/%D7%97%D7%9C%D7%95%D7%A4%D7%94-%D7%9C%D7%97%D7%A9%D7%91%D7%95%D7%A0%D7%99%D7%AA-%D7%99%D7%A8%D7%95%D7%A7%D7%94/)

**AP capture and supplier portals (generic, not restaurant-specific)**
- **Dokka**: pulls supplier invoices from email and keys them into bookkeeping entries, with claimed Hashavshevet support. — [Dokka HE](https://dokka.com/he/features/)
- **YK Systems**: supplier invoices sent to a dedicated mailbox are imported automatically. — [YK](https://yk.co.il/%D7%94%D7%9E%D7%95%D7%A6%D7%A8%D7%99%D7%9D-%D7%A9%D7%9C%D7%A0%D7%95/%D7%A7%D7%9C%D7%99%D7%98%D7%AA-%D7%97%D7%A9%D7%91%D7%95%D7%A0%D7%99%D7%95%D7%AA-%D7%A1%D7%A4%D7%A7%D7%99%D7%9D/); SPS DocReader — [SPS](https://sps.co.il/docreader/)
- **Segment**: a supplier portal with digital invoices and "file 100" (invoice plus delivery-note records). — [Segment](https://www.segment.co.il/)
- **Supplier-side ordering**: SimpleOrder (Tel Aviv) connected suppliers, retailers and food chains and was acquired by Upserve. It is the only Israeli supplier-to-restaurant ordering startup that surfaced besides Zestt's vendor side. — [Times of Israel](https://www.timesofisrael.com/us-firm-buys-israel-restaurant-tech-startup-simpleorder-for-undisclosed-amount/)

### Inferences
- The OCR and "delivery vs. invoice" claims are already table stakes in Israeli marketing (Restigo, MarketMan, Zester). Differentiation has to come from a **trusted ₪ leak number**, credit follow-through, and 2026 VAT/allocation-number checks, not from OCR alone.
- Integration surface: Hashavshevet (ODBC/ASCII import), Priority (API/ERP), file-100-style invoice and delivery-note records, and Zester/MarketMan as upstream sources of orders and delivery notes. Restaurants already on Zester or MarketMan have structured order data that a leak engine could consume.
- Tabit and Beecomm own the revenue side (POS). Food-cost % needs POS revenue, so a POS integration is the natural second integration.

### Gaps
- No Israeli ILS pricing for Zester, MarketMan IL, Restigo, Tabit or Beecomm.
- No public API documentation was found for Zester, Restigo or Tabit IL.
- Market share of Hashavshevet vs. Priority vs. Rivhit among restaurant bookkeepers is unknown.
- I could not verify whether Zester's 15,000-restaurant claim counts Israel only. It exceeds the Knesset's about 12K businesses, which suggests the number includes non-Israeli or non-restaurant accounts, or is inflated.

## 5. What Israeli owners and bookkeepers complain about

### Takeaway
Public complaints focus on supplier price hikes, thin margins, labor shortages and taxes and regulation (VAT on tips, kashrut reform). Complaints specific to invoices (shortages, missing credits, reconciliation pain) do not show up in indexed press. They probably live in closed Facebook groups and WhatsApp communities this research could not access.

### Cited Findings
- Restaurateurs blame suppliers raising prices 10–30% and say "we postponed and postponed, and the moment came to raise prices" (about 2022). — [Calcalist – "דחינו ודחינו"](https://www.calcalist.co.il/shopping/article/SJ8kLVHc00); [Calcalist – raw materials up, restaurant prices jump](https://www.calcalist.co.il/shopping/article/hyyrmm5ok)
- "Restaurants find it hard to survive": restaurateurs describe "suppliers who raise prices on us". A Knesset Economics Committee debate on curbing restaurant prices was held without the restaurateur associations. — [ynet – why restaurants struggle](https://www.ynet.co.il/economy/article/p72qere0l)
- "The restaurant business is not rewarding, not profitable and very risky" (headline quote). — [ynet foodnews](https://www.ynet.co.il/food/foodnews/article/bj2khgeci)
- Electricity, rent and raw-material prices are surging. — [ynet foodnews](https://www.ynet.co.il/food/foodnews/article/ryftavbh5)
- The Restaurant & Bar Association opposed the Tax Authority's VAT on waiter tips from Jan 2025. — [Walla](https://finance.walla.co.il/item/3686466)
- The association warned in 2026 that the kashrut reform will raise prices. — [Mako 2026 Q2](https://www.mako.co.il/news-tip12/2026_q2/Article-ba90f46df288e91026.htm)
- Supplier-side complaints (2020): restaurant debts, bounced cheques, goods "nobody wants to buy". — [ynet](https://www.ynet.co.il/food/foodnews/article/Hk5fB6JMP)
- Software complaints: Restigo is "relatively expensive" for small businesses, and Morning is "pricey for 20 documents". — [softwarecompare.co.il](https://softwarecompare.co.il/blog/%D7%AA%D7%95%D7%9B%D7%A0%D7%94-%D7%9C%D7%A0%D7%99%D7%94%D7%95%D7%9C-%D7%9E%D7%A1%D7%A2%D7%93%D7%94/); [ezbigboss](https://ezbigboss.com/%D7%97%D7%9C%D7%95%D7%A4%D7%94-%D7%9C%D7%97%D7%A9%D7%91%D7%95%D7%A0%D7%99%D7%AA-%D7%99%D7%A8%D7%95%D7%A7%D7%94/)

### Inferences
- The publicly voiced pain is **"suppliers raise prices and I can't see it in time"**. That maps directly onto price-creep detection against the last agreed or last paid price. Invoice-level pain such as short deliveries and missing credits is probably real but unvoiced in press, so it has to be validated through interviews with owners and bookkeepers.
- Price sensitivity (complaints about ₪29/mo invoicing tools and "expensive" Restigo) suggests that pricing must be justified by the ₪ leak found, e.g. a guarantee or a pay-from-savings model.

### Gaps
- Restaurant owners' Facebook groups (e.g. "מסעדנים בישראל"-type groups), WhatsApp communities and bookkeeper forums were not accessible or indexed. No verbatim complaints about invoices, shortages or credits were found.
- No interviews with Israeli restaurant bookkeepers (מנהלות חשבונות) about reconciliation time per supplier or per month were found.
- App-store review text for MarketMan, Zester and Restigo was not retrievable here.
