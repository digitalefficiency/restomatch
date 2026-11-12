# EXT-02 · Israel infrastructure and regulation for in-product automation

**Researcher date:** 2026-11-07. **Method:** WebSearch only (standard + extended). Every "seen" date below is **2026-11-07**. WebFetch could not reach any host from this session (`gov.il`, `developers.facebook.com`, `shibolet.com`, `mumble.co.il` all failed DNS: they are outside the session's network allowlist). So every claim here comes from search-result extracts, not from reading the primary document end to end. Anything I could not tie to a source is marked **UNVERIFIED**.

**Scope.** This note covers the Israeli rails an automation would run on: the Israel Invoices (חשבוניות ישראל) allocation-number layer and its API; open banking (account information and payment initiation); Masav (מס"ב) bulk supplier payments; WhatsApp Business Platform economics in Israel after the **1 October 2026** price change; Israeli POS systems as a sales/depletion feed; and the digital-document rules (computerized document, e-signature, archiving).

**What I did not repeat.** The earlier pass already covers the threshold schedule, section 38(א1), PCN874, the uniform file, Appendix ו/ז scanning, Directive 368 history and the July 2025 WhatsApp per-message switch: see `docs/research/ניהול חשבוניות ספקים במסעדות/report.md` §"מאז יוני 2026…" and `notes/israel_regulation_tax.md` §§1, 3, 6. This note only adds what is **new for designing automations**: who can call what, what a buyer can verify, what changed after the report was written (WhatsApp 1 Oct 2026, the ISA licensing switch, the Masav access opening), and the trigger → action design each fact implies.

---

## 0. Summary for the synthesis

1. **The allocation-number threshold is now ₪5,000 pre-VAT, and it is final for the foreseeable future.** The ladder was ₪25k (May 2024), ₪20k (Jan 2025), ₪10k (1 Jan to 31 May 2026), then ₪5k (from 1 Jun 2026). A 27 May 2026 ITA clarification says the ₪10k rule ran to 31 May 2026 ([cpa.co.il](https://www.cpa.co.il/2026-allocation-number/); [horizon.org.il](https://horizon.org.il/cfo-outsource/allocation-number-invoice-2026/)). Some secondary sources still print an old ladder (₪15k for 2026, ₪10k for 2027), for example [lookuptax](https://lookuptax.com/docs/einvoicing/israel-invoices-allocation-number-einvoicing-israel). **Lesson: hard-code ₪5,000 from 2026-06-01 with an effective-date table, and do not trust a blog's ladder.**
2. **A buyer can verify an allocation number today, by hand.** The ITA personal area has a free "אימות פרטי חשבונית" (verify invoice details) service. It checks that the business details, amount and VAT match what the supplier reported. The number is random and has no check digit, so **it can only be verified against the ITA** ([ops-excel](https://ops-excel.com/knowledge/allocation-number/); [billos](https://billos.co.il/guides/allocation-number/); [greeninvoice](https://www.greeninvoice.co.il/magazine/israel-invoice/)). A buyer-side **API** remains **UNVERIFIED**. One Israeli guide lists "retrieve details of an allocated invoice **from the customer side**" among the ITA Israel-Invoices services, and an `invoice-information/v1` production endpoint ([easybooks](https://easybooks.co.il/knowledge-center/%D7%A9%D7%99%D7%A8%D7%95%D7%AA%D7%99-%D7%94-api-%D7%A9%D7%9C-%D7%A8%D7%A9%D7%95%D7%AA-%D7%94%D7%9E%D7%A1%D7%99%D7%9D-%D7%9E%D7%93%D7%A8%D7%99%D7%9A-%D7%9E%D7%A2%D7%A9%D7%99-%D7%9C%D7%94%D7%AA%D7%9E/)). I could not open the official spec to confirm it.
3. **Open banking is legally live but not yet usable for SMB supplier payments.** Payment-company access to payment accounts became due **6 Jun 2026**. Banks owe advanced payment-initiation access from **6 Dec 2026**. Directive 368's advanced-initiation amendment (Berlin Group, strict API cyber rules) is only a **draft** of **24 Sep 2026**. The 2026 Arrangements Law gave payment companies **3 years from licensing** before their own open-banking duties apply ([Herzog](https://herzoglaw.co.il/en/news-and-insights/israel-securities-authority-publishes-directive-for-payment-companies-regarding-the-implementation-of-an-open-banking-standard/); [IsraelDefense](https://www.israeldefense.co.il/en/node/71075); search extract of [funder.co.il](https://www.funder.co.il/article/203286)). Payment licensing moved to the **Israel Securities Authority** on 6 Jun 2026, and about 37 firms (including Google and PayPal) were licensed ([Bizportal](https://www.bizportal.co.il/capitalmarket/news/article/20039545)). **Lesson: read-only bank feeds (AIS through a licensed aggregator such as Finanda) are 2027-realistic. In-app "pay the supplier" is a 2027+ partner play. Before then, a Masav file is the automation.**
4. **Masav is the real bulk-payment rail, and it is file-based.** You build a supplier-credit file, transmit it signed, and the bank approves the total debit. You can still edit the value date and amounts after the file is loaded ([masav.co.il – suppliers](https://www.masav.co.il/solution/payment-to-suppliers/); [masav.co.il – credits](https://www.masav.co.il/solution/credits/)). In April 2026 the BoI admitted **GAMA, Max-IT and Rapyd** to Masav and SHVA ([regxplora](https://platform.regxplora.com/updates/2f89f45838e450d4b67b6459af3db4ce215624b28fe51dc736d3cc54a03097a3/bank-of-israel-completes-accession-of-gama-max-it-and-rapyd-to-masav-and-shva-retail-payment-sys); [changeflow](https://changeflow.com/govping/banking-finance/three-companies-join-israel-s-payment-systems-26th-apr-2026-04-26)). **Lesson: "pay run → Masav file + remittance advice" is a buildable, credential-free automation today. The human still uploads and signs at the bank.**
5. **WhatsApp got more expensive on 1 Oct 2026, and the earlier report's "free inside 24h" premise is now wrong.** Service (free-form) replies and in-window utility templates, which had been free, are now billed at the utility rate. Multiple sources report a **1,000 free service messages per month per business number** allowance, but it is **not confirmed by Meta** in what I could reach ([YCloud](https://www.ycloud.com/blog/whatsapp-api-message-pricing-update-effective-october-1-2026); [Wati](https://www.wati.io/en/blog/whatsapp-service-message-pricing/); [Pepper Cloud](https://blog.peppercloud.com/whatsapp-api-pricing-everything-you-need-to-know/)). Israel rates seen in secondary sources: utility/authentication/service about **$0.0053**, marketing about **$0.0353** per message ([fullness.co.il](https://fullness.co.il/he/tools/whatsapp-api-pricing); search extract of [mumble.co.il](https://mumble.co.il/messages-pricing-calculator/)). One source gives utility at $0.0061 (UNVERIFIED conflict). **Lesson: the unit cost is still trivial against a credit claim (₪0.02 vs ₪100s), but budget per restaurant, and design to stay under the free allowance.**
6. **No Israeli POS publishes an open API.** Tabit integrates through a partner programme and integration requests, not a public developer portal ([apis.io](https://apis.io/providers/tabit/); [Tiphaus](https://www.tiphaus.com/integration/tabit/)). Beecomm lists "interfaces to external companies" with no public documentation ([beecomm.com](https://www.beecomm.com/)). Restigo publishes an inbound **Z-report revenue endpoint** keyed by POS provider ([restigo.co.il](https://www.restigo.co.il/xml-%D7%A9%D7%9C%D7%99%D7%97%D7%AA-%D7%94%D7%96%D7%9E%D7%A0%D7%94-%D7%9C%D7%A1%D7%A4%D7%A7/api5/)). **Lesson: copy Restigo. Accept a daily Z-report (totals by shift, channel and payment method) as the v1 sales feed. Do not wait for item-level depletion.**
7. **A "computerized document" (מסמך ממוחשב) under the bookkeeping instructions is a specific legal object.** It needs a secure or approved electronic signature, a visible "מסמך ממוחשב" marking, prior notice to the assessing officer, and the **recipient's written or electronic consent**, which the sender must keep ([gilui-naot](https://www.giluy-naot.org.il/laws/%D7%94%D7%95%D7%A8%D7%90%D7%95%D7%AA-%D7%9E%D7%A1-%D7%94%D7%9B%D7%A0%D7%A1%D7%94-(%D7%A0%D7%99%D7%94%D7%95%D7%9C-%D7%A4%D7%A0%D7%A7%D7%A1%D7%99-%D7%97%D7%A9%D7%91%D7%95%D7%A0%D7%95%D7%AA)-%E2%80%93-%D7%9E%D7%A1-%D7%A2%D7%A8%D7%9A-%D7%9E%D7%95%D7%A1%D7%A3); [PwC](https://www.pwc.com/il/he/tax-beyond/assets/nihol_sfarim.pdf)). Israel Invoices itself needs **no** signature, only JSON to the ITA ([Flowie](https://www.get-flowie.com/e-invoicing/israel), per the prior note). **Lesson: a signed PDF from a supplier is the original, and RestoMatch should store it byte-identical with a hash. A phone photo of paper is a scan (Appendix ו rules) and must be labelled as one.**

---

## 1. Israel Invoices (חשבוניות ישראל): what an automation can rely on

### 1.1 Threshold schedule (pre-VAT, B2B tax invoices)

| Period | Threshold | Source |
|---|---|---|
| 5 May 2024 to 31 Dec 2024 | > ₪25,000 | prior report (KPMG) |
| 1 Jan 2025 to 31 Dec 2025 | > ₪20,000 | prior report (KPMG) |
| 1 Jan 2026 to 31 May 2026 | > ₪10,000 | [cpa.co.il](https://www.cpa.co.il/2026-allocation-number/) (citing a 27 May 2026 ITA clarification); [horizon.org.il](https://horizon.org.il/cfo-outsource/allocation-number-invoice-2026/) |
| from 1 Jun 2026 | > ₪5,000 | [greeninvoice](https://www.greeninvoice.co.il/magazine/israel-invoice/); [apoint](https://www.apoint.co.il/he/services/israel-invoice-api/); [hl-cpa](https://www.hl-cpa.co.il/blog/allocation-number-2026) |

No step below ₪5,000 has been announced in any source I found (**UNVERIFIED** that none exists).

**Automation rule.** `requiresAllocation(invoice) = invoice.date >= step.from && preVatTotal > step.threshold`, evaluated against the **invoice date**, not the scan date. A consolidated invoice (חשבונית ריכוז) is measured on its own total, so a monthly meat invoice almost always crosses ₪5,000.

**Exception path.** One guide says section 7 of the ITA execution instruction lets the Director allow the deduction without a number in exceptional cases of technological failure ([search extract, horizon/cpa sources](https://www.capitax.co.il/content/2/3434)). That is an accountant's escalation, not something to automate.

**ITA refusal.** Since 2025 the ITA may **refuse** to allocate a number when it suspects the invoice was not issued lawfully ([shamaeim.org.il](https://shamaeim.org.il/%D7%97%D7%A9%D7%91%D7%95%D7%A0%D7%99%D7%95%D7%AA-%D7%99%D7%A9%D7%A8%D7%90%D7%9C-%D7%9E%D7%A1%D7%A4%D7%A8%D7%99-%D7%94%D7%A7%D7%A6%D7%90%D7%94); [BookedUp](https://bookedup.co.il/guides/mispar-haktzaa-cheshboniot-israel-2026)). I found no public statistics on allocations issued or refusal rates (**UNVERIFIED**).

### 1.2 The API surface

- The **issuer** obtains the number through its invoicing software. The software calls an ITA REST service, sending JSON and authenticating with OAuth2 on behalf of the user. Users of manual invoice books use an ITA web app. The official spec is "מודל חשבוניות ישראל – תיאור ה-API's", edition 1.0 (7.2023) and 2.0 (7.2024) ([gov.il v2.0](https://www.gov.il/BlobFolder/generalpage/hor-software-other/he/vat_software-houses-180724.pdf); [gov.il v1.0](https://www.gov.il/BlobFolder/generalpage/hor-software-other/he/IncomeTax_software-houses-040723.pdf); [lookuptax](https://lookuptax.com/docs/einvoicing/israel-invoices-allocation-number-einvoicing-israel)).
- The 2023 spec has a separate service for **retrieving the details of an allocated invoice**, next to the allocation service (search extract of the gov.il v1.0 PDF).
- easybooks lists "**שליפת פרטי חשבונית שהוקצתה מצד הלקוח**" (retrieving allocated invoice details from the customer side) as an ITA service. It names production endpoints, including `invoice-information/v1`. It also recommends a **queue** for allocation requests to absorb load and transient errors ([easybooks](https://easybooks.co.il/knowledge-center/%D7%A9%D7%99%D7%A8%D7%95%D7%AA%D7%99-%D7%94-api-%D7%A9%D7%9C-%D7%A8%D7%A9%D7%95%D7%AA-%D7%94%D7%9E%D7%A1%D7%99%D7%9D-%D7%9E%D7%93%D7%A8%D7%99%D7%9A-%D7%9E%D7%A2%D7%A9%D7%99-%D7%9C%D7%94%D7%AA%D7%9E/)). **UNVERIFIED** against the official spec: I don't know the inputs (allocation number plus buyer VAT ID?), the outputs, or whether a third-party software house may call it under the restaurant's OAuth consent.
- Integration middlewares exist for software houses. **A-Point** sells an "Israel Invoice API for software houses" that transmits customer **and supplier** invoices and returns the number ([apoint](https://www.apoint.co.il/he/services/israel-invoice-api/)). Linet ([linet](https://www.linet.org.il/invoice-api-israel-developers/)) and H-ERP/Hashavshevet ([h-erp](https://www.h-erp.co.il/israel-invoice/)) offer the same issuer-side flow. Green Invoice's own API is available from the "Best" tier up ([greeninvoice API](https://www.greeninvoice.co.il/help-center/api/)).
- The developer path (from the prior note): register on the ITA (SHAAM) developer portal, get approval, and end users authenticate with OAuth. That is a **Phase-6 human credential step** in RestoMatch terms (AGENTS.md: credential intake is human-only).

### 1.3 What a recipient can verify, and the automation ladder

| Rung | Trigger → action | Human confirms | Status |
|---|---|---|---|
| R0, format | OCR reads the invoice → is there an allocation-number field when pre-VAT > ₪5k (by invoice date)? | none | buildable now (the prior report says OCR already extracts the number) |
| R1, deep-link verify | Flagged invoice → "Verify at ITA" button deep-links to the personal-area **אימות פרטי חשבונית** with the number, supplier VAT ID and amount pre-copied | the owner or bookkeeper clicks and logs in | buildable now; the service exists per [ops-excel](https://ops-excel.com/knowledge/allocation-number/) and [billos](https://billos.co.il/guides/allocation-number/) |
| R2, API verify | Every invoice above the threshold → call the retrieve-details service → compare amount, VAT, VAT ID and date with OCR → mismatch = "number does not belong to this invoice" | none for a match; a mismatch goes to the VAT-at-risk queue | **UNVERIFIED** availability; needs the ITA developer approval and the restaurant's OAuth |
| R3, chase | Missing or mismatched number → pre-filled request to the supplier: "please re-issue with an allocation number" → reminders until a new document arrives → auto-close when a re-issued invoice with a valid number is ingested | owner presses send | buildable (WhatsApp/email); the prior report and int-05 §0.4 show it is not pushed today |
| R4, deadline | Countdown to the 6-month input-VAT deduction window (prior report) → escalation at T-30 days | bookkeeper | buildable |

**Competitive note.** I found no restaurant or AP vendor that advertises buyer-side allocation-number verification. All the API vendors above are **issuer-side** (A-Point, Linet, H-ERP, Green Invoice). That makes R2/R3 a **leapfrog** opportunity if the ITA service is open to the buyer side. Even if it is not, R1 + R3 already beat everyone.

---

## 2. Open banking: account information (AIS) and payment initiation (PIS)

### 2.1 Status as of Nov 2026

- **Law.** The Regulation of Payment and Payment Initiation Services Law (2023) has been in force since June 2024. The Financial Information Service Law (2021) governs AIS ([Herzog – law approved](https://herzoglaw.co.il/en/news-and-insights/the-regulation-of-payment-and-payment-initiation-services-law-is-approved-by-the-knesset-in-the-second-and-third-readings/); [Goldfarb](https://www.goldfarb.com/client-update-new-financial-regulation-in-israel-the-regulation-of-payment-and-payment-initiation-services-law/)).
- **Licensing switch.** The transition ended on **6 Jun 2026**. Payment companies (and payment initiation) are now supervised and licensed by the **Israel Securities Authority (ISA)**, which issued licences to about **37** firms, including Google and PayPal ([Bizportal 20039545](https://www.bizportal.co.il/capitalmarket/news/article/20039545); [Bizportal 20034820](https://www.bizportal.co.il/general/news/article/20034820)). The ISA has a directive on equity/insurance for **basic payment-initiation licence** holders ([ISA PDF](https://www.new.isa.gov.il/images/Fittings/isa-be/asset_library_pic/al_lobby/al_lobby-6267b530a26dd/order_equity.pdf)). The Capital Market Authority's 2026 regulation plan (31 Dec 2025) includes changes to how a firm applies for basic payment initiation or financial-information-service approval ([gov.il regulation plan](https://www.gov.il/BlobFolder/reports/report_0015/he/regulation_plan_26_1.pdf)). A draft temporary order would cut 2026 annual fees by 25% ([tazkirim](https://tazkirim.gov.il/s/legislativeworkactivity/a13Wn00000BgfenIAB/%D7%94%D7%A4%D7%A6%D7%94-%D7%9C%D7%94%D7%A2%D7%A8%D7%95%D7%AA-%D7%A6%D7%99%D7%91%D7%95%D7%A8%D7%99?language=en_US)).
- **Dates (search extract of a funder.co.il / ISA summary, UNVERIFIED in the primary text):** the duty to give payment companies access to a payment account applies from **6 Jun 2026**. The duty of a payment-account manager to give access to **advanced initiation** applies from **6 Dec 2026**. The information baskets for payment-company data sources apply from **1 Jun 2026** ([funder.co.il](https://www.funder.co.il/article/203286)).
- **Deferral.** The 2026 Arrangements Law pushes payment companies' own open-banking access duties to **3 years after licensing**. The ISA published its open-banking standard directive for payment companies on **7 Jun 2026** ([Herzog](https://herzoglaw.co.il/en/news-and-insights/israel-securities-authority-publishes-directive-for-payment-companies-regarding-the-implementation-of-an-open-banking-standard/)).
- **Banks.** The BoI's **24 Sep 2026 draft** amendment to Directive 368 adds advanced payment initiation on the **Berlin Group** standard with strict API cyber requirements, and leaves default transaction caps as an option for the user ([IsraelDefense](https://www.israeldefense.co.il/en/node/71075)). It is still a draft.
- **Providers.** **Finanda** presents itself as "ISA licensed" and the first open-banking aggregation provider ([finanda.com](https://www.finanda.com/en/)). An older report names RiseUp, Finanda, Family Biz and Green Invoice among the first licensees ([ThePaypers](https://thepaypers.com/fintech/news/the-israel-securities-authority-grants-initial-licenses-to-fintechs)); it predates the current regime. **RiseUp** cut 50% of its staff ([Calcalist Tech](https://www.calcalistech.com/ctechnews/article/sjhgncr11c)). For **Open-Finance.ai** (Nes Ziona, founded 2021) I found only a directory listing ([ensun](https://ensun.io/search/open-banking/israel)). I found no confirmation that any of them holds a **payment-initiation** licence (**UNVERIFIED**).

### 2.2 Automation patterns this enables (and when)

| Pattern | Trigger → action | Human confirms | Earliest realistic |
|---|---|---|---|
| **Payment detection (AIS)** | A new debit in the restaurant's business account matches supplier VAT ID, name or amount → mark the invoice paid → stop the pay-run reminder | none for exact matches; fuzzy matches go to a queue | 2027, through a licensed AIS aggregator (Finanda-type). Needs consent and a partner contract (Phase-6) |
| **Credit-landed detection (AIS)** | An incoming credit or reduced debit equals the claim amount → close the claim as "recovered ₪" | owner confirms the match | 2027. This is the measurement for "₪ recovered / ₪ found" |
| **Pay from app (PIS)** | Owner approves the pay run → initiate transfers for undisputed amounts only | owner, with strong customer authentication at the bank | 2027+ (advanced initiation is from 6 Dec 2026 on paper, the cyber rules are a draft, and partners are unconfirmed) |

**Lesson.** Do not build PIS. **Leapfrog with AIS-based "credit landed" detection.** It turns the North Star's last mile (₪ recovered) from self-reported into bank-evidenced. Until a partner exists, accept a bank-statement CSV/PDF upload as the stand-in feed, and match credits against open claims. That needs no licence.

---

## 3. Masav (מס"ב) bulk supplier payments

- **How it works.** The business generates a file in Masav format (from payroll or accounting software, or a supporting vendor). The signed file is transmitted to Masav and the bank approves the total debit. The value date and amounts can still be changed after loading ([masav.co.il – credits](https://www.masav.co.il/solution/credits/); [masav.co.il – suppliers](https://www.masav.co.il/solution/payment-to-suppliers/)). Accounting tools export the file: SUMIT "producing supplier payment files" ([help.sumit.co.il](https://help.sumit.co.il/he/articles/5833266-%D7%94%D7%A4%D7%A7%D7%AA-%D7%A7%D7%91%D7%A6%D7%99-%D7%AA%D7%A9%D7%9C%D7%95%D7%9E%D7%99%D7%9D-%D7%9C%D7%A1%D7%A4%D7%A7%D7%99%D7%9D-%D7%A0%D7%99%D7%94%D7%95%D7%9C-%D7%A2%D7%A1%D7%A7)); Odcanit ([od.co.il](https://www.od.co.il/masav/)); Abra BC (export, print a payments report, or cancel and re-export a Masav file: [bc-guide](https://bc-guide.abra.page/%D7%A2%D7%91%D7%95%D7%93%D7%94-%D7%91%D7%9E%D7%A2%D7%A8%D7%9B%D7%AA/%D7%A0%D7%99%D7%94%D7%95%D7%9C-%D7%A1%D7%A4%D7%A7%D7%99%D7%9D/%D7%AA%D7%A0%D7%95%D7%A2%D7%95%D7%AA-%D7%A1%D7%A4%D7%A7%D7%99%D7%9D/)). Rivhit emails a "payment confirmation to supplier" after a Masav payment, but cannot state the source account ([rivhit KB](https://www.rivhit.co.il/knowledgebase/%D7%9E%D7%A1%D7%91-%D7%90%D7%99%D7%A9%D7%95%D7%A8-%D7%AA%D7%A9%D7%9C%D7%95%D7%9D-%D7%9C%D7%A1%D7%A4%D7%A7-%D7%A9%D7%9C%D7%99%D7%97%D7%94-%D7%91%D7%9E%D7%99%D7%99%D7%9C/)).
- **Bank side.** Leumi Business offers multi-beneficiary supplier transfers, conditional on a third-party transfer authorization ([leumi.co.il](https://www.leumi.co.il/biz/Transfers-salaries)). Bank Otsar Hahayal's tariff exempts Masav-transmitting customers from a one-time fee ([bankotsar tariff PDF](https://www.bankotsar.co.il/media/jarlpmqq/%D7%AA%D7%A2%D7%A8%D7%99%D7%A4%D7%95%D7%9F-%D7%91%D7%99%D7%A0%D7%9C%D7%90%D7%95%D7%9E%D7%99-%D7%99%D7%97%D7%99%D7%93%D7%99%D7%9D-%D7%95%D7%A2%D7%A1%D7%A7%D7%99%D7%9D-%D7%A7%D7%98%D7%A0%D7%99%D7%9D.pdf)). I found no clean per-file SMB fee (**UNVERIFIED**).
- **Rails.** Masav runs the retail faster-payments service and had to adopt **ISO 20022** fully by end-2023 ([BoI payments overview 2024](https://www.boi.org.il/media/3pjpq0wa/overview-of-the-payments-system-in-israel-final.pdf)). Non-banks GAMA, Max-IT and Rapyd joined Masav/SHVA in April 2026 ([regxplora](https://platform.regxplora.com/updates/2f89f45838e450d4b67b6459af3db4ce215624b28fe51dc736d3cc54a03097a3/bank-of-israel-completes-accession-of-gama-max-it-and-rapyd-to-masav-and-shva-retail-payment-sys)). That opens a future route to a fintech partner with direct Masav access.
- **Tooling.** There is no official public Masav developer API. An unofficial Python `masav` file generator exists; its last release was 2020 ([GitHub](https://github.com/omrirz/masav); [PyPI](https://pypi.org/project/masav/)).
- **Adjacent player.** Procee is a procure-to-pay tool with invoice-scoped chat and an activity log, at a G2-listed $30/user/month (stale listing) ([G2](https://www.g2.com/products/procee/pricing)). Its Hebrew site advertises a supplier-payments module ([he.procee.com](https://he.procee.com/features/supplier-payments/)). Masav support is **UNVERIFIED**.

**Automation for RestoMatch (copy and leapfrog).** Trigger: the owner approves the pay run. Action: generate (a) a Masav credit file of **undisputed amounts only**, with each disputed line held back and a reason attached; (b) a Hebrew **remittance advice** per supplier ("paid X for invoices A, B; withheld ₪Y pending credit for claim #123"), sent through WhatsApp or email on the owner's click; and (c) an accounting export. The human uploads the file and signs it at the bank. This copies the incumbents' file export, and leapfrogs them on **dispute-aware withholding + remittance**: none of the accounting tools above ties a payment to an open claim. The money math stays outside the immutable engine. Payment execution stays human, which satisfies AGENTS.md "no spend money".

---

## 4. WhatsApp Business Platform in Israel (post-1 Oct 2026)

### 4.1 Pricing model as of today

- **Since 1 Jul 2025:** per-message billing by template category (marketing, utility, authentication). Inbound messages are free. Free-form service replies inside the 24h customer-service window are free. Utility templates sent **inside** an open window became free (prior report; [Zoho community](https://help.zoho.com/portal/zh/community/topic/whatsapp-pricing-changes-pay-per-message-starting-july-1-2025?page=11)).
- **Since 1 Oct 2026 (new):** service messages and in-window utility templates are **charged**, at the market's utility rate. Marketing templates, authentication templates and out-of-window utility templates are unchanged. Inbound stays free ([YCloud](https://www.ycloud.com/blog/whatsapp-api-message-pricing-update-effective-october-1-2026); [Wati](https://www.wati.io/en/blog/whatsapp-service-message-pricing/); [MyOperator](https://myoperator.com/blog/whatsapp-api-pricing-october-2026-update); [letsbot](https://letsbot.net/en/whatsapp-api-pricing-2026.html); [Pepper Cloud](https://blog.peppercloud.com/whatsapp-api-pricing-everything-you-need-to-know/)).
- **Free allowance.** Several sources say the first **1,000 delivered service messages per month per business number** are free, with no roll-over. YCloud and MyOperator do not mention it, and I could not reach Meta's page. **UNVERIFIED.** Volume tiers continue for utility and authentication; marketing is not tiered ([flowcall](https://flowcall.co/blog/whatsapp-business-api-pricing-2026); [sleekflow](https://sleekflow.io/en-us/blog/whatsapp-business-price)).
- **Israel rates (secondary):** utility/auth/service ≈ **$0.0053**, marketing ≈ **$0.0353** per message ([fullness.co.il calculator](https://fullness.co.il/he/tools/whatsapp-api-pricing); Mumble calculator via search extract). One source gives utility at $0.0061, a conflict. A Times of Israel blog claims Israeli utility rates were cut about 45% in Q2 2026 ([ToI blog](https://blogs.timesofisrael.com/israels-quiet-q2-2026-bot-pricing-reset/)), **UNVERIFIED**. Hebrew guides put a marketing message at about ₪0.12–0.15 ([spike.co.il](https://www.spike.co.il/blog/whatsapp-business-pricing); [otomation.io](https://www.otomation.io/blog/whatsapp-api-cost-israel/)).
- **BSPs used in Israel, and platform fees** (vendor blogs, so possibly biased): 360dialog at about ₪100–300/mo, "popular in Israel"; Twilio is usage-based; Pulseem (Israeli) at about ₪200/mo up to 10k messages; Gambot from ₪179/mo + VAT ([gambot price list](https://gambot.co.il/PriceList/)); Reepli from ₪275/mo per bot ([reepli](https://www.reepli.ai/he/resources/whatsapp-business-api-pricing/)). Typical all-in SMB budget is ₪150–420/mo ([nextbot](https://nextbot.co.il/blog/whatsapp-business-api-pricing-setup-guide); [topicpen](https://go.topicpen.com/he/guides/whatsapp-business-api-israel-guide-setup-pricing)). I found no data for Glassix or InforU (**UNVERIFIED**).

### 4.2 Design implications (trigger → action, cost)

| Flow | Category | Est. cost / msg | Human confirms |
|---|---|---|---|
| Staff sends an invoice or delivery-note photo → bot acknowledges and returns the parse result | inbound free; reply = service (billed after the free allowance) | ≈$0.0053 after 1k/mo (UNVERIFIED allowance) | none |
| Credit-claim request to a supplier | utility template (out of window unless the supplier wrote first) | ≈$0.0053 | **owner presses send** (AGENTS.md: no auto-send) |
| Reminder for a missing allocation number | utility template | ≈$0.0053 | owner approves the first send; cadence pre-approved |
| Weekly "₪ found / ₪ recovered" digest to the owner | utility (transactional report); **not** marketing | ≈$0.0053 | none (owner opted in) |
| Upsell or "try feature X" | marketing | ≈$0.0353 | avoid |

**Lessons.**
(a) The cost case is still overwhelming: a ₪400 credit claim costs about ₪0.02 to send.
(b) **Batch replies.** After 1 Oct 2026 every bot reply counts, so send one consolidated reply per batch of photos instead of a reply per photo, to stay under the (reported) 1,000 free service messages.
(c) Keep digests strictly **transactional**, so Meta classifies them as utility and not marketing (a 6.7× price difference).
(d) Use a **BSP-agnostic Cloud API** directly (Meta Cloud API, no BSP markup) once credentials are approved: the BSP fee (₪100–300/mo) is larger than the message cost at restaurant volumes.
(e) The earlier report's sentence "service replies within 24h are free" (report §WhatsApp, citing Meta) is **superseded as of 1 Oct 2026**. Flag this in the synthesis.

---

## 5. Israeli POS systems as a sales and depletion feed

| System | What is public | Lesson |
|---|---|---|
| **Tabit** | Cloud restaurant OS (POS, tables, delivery, payments, reports). **No public API reference or developer portal.** Access is through a partner programme and integration-request process ([apis.io](https://apis.io/providers/tabit/); [api-evangelist OpenAPI stub](https://raw.githubusercontent.com/api-evangelist/tabit/refs/heads/main/openapi/tabit-openapi.yml)). Partners pull sales and labor data, e.g. Tiphaus for tips ([tiphaus](https://www.tiphaus.com/integration/tabit/)). US integrations include R365/Compeat (prior note). | Apply to the partner programme early (a human/BD task). Ask for daily item-level sales export. Expect weeks or months |
| **Beecomm (ביקום)** | Cloud POS; the service page lists "interfaces to external companies", with no technical documentation ([beecomm.com](https://www.beecomm.com/)). Robotunnel claims an automatic sync with Beecomm among 20+ POS vendors ([robotunnel](https://www.robotunnel.com/%D7%90%D7%99%D7%A0%D7%98%D7%92%D7%A8%D7%A6%D7%99%D7%99%D7%AA-%D7%A7%D7%95%D7%A4%D7%94-%D7%A1%D7%9C%D7%99%D7%A7%D7%94-%D7%90%D7%95%D7%A0%D7%9C%D7%99%D7%99%D7%9F-%D7%97%D7%A9%D7%91%D7%95%D7%A0%D7%99/)) | Integrations exist but are bilateral. Ask Beecomm directly (UNVERIFIED terms) |
| **Restigo** | Publishes an **inbound** POS-revenue (Z-report) endpoint with a `Provider` parameter, taking totals by shift, sales channel and payment method ([restigo API](https://www.restigo.co.il/xml-%D7%A9%D7%9C%D7%99%D7%97%D7%AA-%D7%94%D7%96%D7%9E%D7%A0%D7%94-%D7%9C%D7%A1%D7%A4%D7%A7/api5/)). Claims "up to 8%" lower food and labor costs (vendor claim). Partnered with Hashavshevet/H-ERP ([h-erp](https://www.h-erp.co.il/restigo/)) | **Copy:** define our own inbound revenue contract and let the POS (or the owner) push to it. Z-report totals are enough for food-cost % |
| **MarketMan** | Actual-vs-theoretical report: POS sales deplete recipes ([MarketMan](https://marketman.com/actual-vs-theoretical-food-cost-report)). Supports 50+ mostly US POS systems; Tabit is not named in what I found ([sig.ai](https://geo.sig.ai/brands/marketman.md)) | Item-level depletion needs recipes and an item feed. Treat it as phase 2 |
| **Caspit (כספית)** | Accounting and invoicing software, not a POS. No public API found in this pass (**UNVERIFIED**) | Not a sales source; possibly an accounting-export target |
| **Lightspeed / others** | No Israeli-market evidence found in this pass (**UNVERIFIED**) | none |

**Automation design.**
v1 trigger: the daily Z-report arrives, by a CSV/photo upload or a pushed endpoint. Action: compute food-cost % = purchases (matched invoices) ÷ net sales, and alert on week-over-week drift. The owner confirms nothing; it is a report.
v2 (with an item feed): theoretical depletion vs purchases gives a "missing ₪ of product". That is a different leak class from supplier overcharge, so keep it **separate from the North Star leak figure** to keep the ₪ number believable.

---

## 6. Digital documents: signature, consent, archive

- **Computerized document (מסמך ממוחשב).** It is created, sent, received and stored electronically, signed with the taxpayer's **approved or secure electronic signature** (Electronic Signature Law 2001), and prominently marked "מסמך ממוחשב" ([gilui-naot](https://www.giluy-naot.org.il/laws/%D7%94%D7%95%D7%A8%D7%90%D7%95%D7%AA-%D7%9E%D7%A1-%D7%94%D7%9B%D7%A0%D7%A1%D7%94-(%D7%A0%D7%99%D7%94%D7%95%D7%9C-%D7%A4%D7%A0%D7%A7%D7%A1%D7%99-%D7%97%D7%A9%D7%91%D7%95%D7%A0%D7%95%D7%AA)-%E2%80%93-%D7%9E%D7%A1-%D7%A2%D7%A8%D7%9A-%D7%9E%D7%95%D7%A1%D7%A3); [nevo](https://www.nevo.co.il/law_html/law01/255_179.htm)). A secure signature is unique to the holder, identifies them, is under their sole control and detects later changes. An approved signature is also certified ([PwC](https://www.pwc.com/il/he/tax-beyond/assets/nihol_sfarim.pdf)).
- **Sending conditions (section 18B).** The sender notifies the assessing officer by **registered mail before the first send** (18B(b)). The sender may send only to a recipient who **consented in writing or electronically**, and must keep that consent in its books (18B(c)) (search extract of PwC and Ministry of Defence documents; [mod.gov.il](https://www.online.mod.gov.il/Online2016/Documents/Support/AttachmentE.doc)). Signing vendors (ComSign, ComDa) sell the signature and auto-email ([comsign](https://www.comsign.co.il/%D7%97%D7%A9%D7%91%D7%95%D7%A0%D7%99%D7%AA-%D7%93%D7%99%D7%92%D7%99%D7%98%D7%9C%D7%99%D7%AA/)). I found no 2024–2026 amendment to these rules (**UNVERIFIED** that none exists). [ronen-missim](https://www.ronen-missim.co.il/book/%D7%94%D7%95%D7%A8%D7%90%D7%95%D7%AA_%D7%A0%D7%99%D7%94%D7%95%D7%9C_%D7%A4%D7%A0%D7%A7%D7%A1%D7%99_%D7%97%D7%A9%D7%91%D7%95%D7%A0%D7%95%D7%AA_2024-13) lists a 2025 consolidated edition without detail.
- **Israel Invoices** needs no signature: only JSON to the ITA (prior note, Flowie).
- **Scanning and archive** (Appendix ו/ז, "מסמך סרוק", backup, technological continuity) are covered in the prior note §3.

**Automation implications.**
1. **Classify on ingest.** `original_digital` (a signed PDF from email, kept byte-identical, with a SHA-256 and the signature-validity status recorded) vs `scan` (a photo or paper scan, stamped "מסמך סרוק" per Appendix ו). A WhatsApp-forwarded PDF may lose its signature context. Keep the email original when one exists.
2. **The consent record is the restaurant's evidence** that it agreed to receive computerized documents from supplier X. Offer to store it per supplier: one checkbox plus a date. This is cheap and nobody does it (**UNVERIFIED** competitive gap).
3. **Credit notes.** A cancelled invoice requires a credit invoice (prior operations note). The claim-closure automation should only close a claim on a **document** (a credit invoice or a re-issued invoice), never on a WhatsApp "OK".

---

## 7. Copy / avoid / leapfrog (consolidated)

**Copy**
- Restigo's inbound Z-report endpoint, as the v1 POS feed.
- The accounting tools' Masav file export (SUMIT, Abra, Odcanit) and Rivhit's emailed payment confirmation.
- easybooks' advice to queue ITA calls with retry.

**Avoid**
- Building payment initiation before advanced-initiation rules are final and a licensed partner exists. That is 2027+, and in any case a human-only action under AGENTS.md.
- Assuming WhatsApp replies are free: the 1 Oct 2026 change.
- Classifying digests as marketing.
- Waiting on Tabit or Beecomm APIs to ship food-cost.
- Mixing POS-depletion "missing product ₪" into the supplier-leak North Star.

**Leapfrog**
- **Buyer-side allocation-number verification and chase.** R1 deep-link now, R2 API if the customer-side service is confirmed. No competitor does it.
- **Dispute-aware pay run.** A Masav file of undisputed amounts plus a Hebrew remittance that names the withheld claim.
- **Bank-evidenced "₪ recovered".** Match statement credits and short-pays to claims: statement upload now, AIS partner in 2027.
- **A per-supplier e-document consent ledger** plus original/scan classification. It makes RestoMatch the legal archive, not just a viewer.

---

## 8. Open questions (route to a human)

1. Can a third-party buyer-side software house call the ITA "retrieve allocated invoice details" service under the restaurant's OAuth? What are the inputs and outputs? (Needs the gov.il spec v2.0 and an ITA developer-portal inquiry. Phase-6 credential.)
2. Exact Meta Israel rates and whether the 1,000-free-service-messages allowance is real. (Needs developers.facebook.com, which is blocked in this session: the host must be allowed.)
3. Which ISA licensees hold **basic payment initiation** and offer an SMB API (Finanda? Green Invoice?).
4. Tabit and Beecomm partner terms for a read-only daily sales export.
5. Masav per-file fees at the four big banks for small businesses.

---

## Sources (all seen 2026-11-07, via WebSearch extracts)

- greeninvoice.co.il — Israel Invoice guide 2026: https://www.greeninvoice.co.il/magazine/israel-invoice/ ; API help: https://www.greeninvoice.co.il/help-center/api/
- lookuptax — Israel invoices allocation number: https://lookuptax.com/docs/einvoicing/israel-invoices-allocation-number-einvoicing-israel
- ITA spec v2.0 (7.2024): https://www.gov.il/BlobFolder/generalpage/hor-software-other/he/vat_software-houses-180724.pdf ; v1.0 (7.2023): https://www.gov.il/BlobFolder/generalpage/hor-software-other/he/IncomeTax_software-houses-040723.pdf
- easybooks — ITA API guide: https://easybooks.co.il/knowledge-center/%D7%A9%D7%99%D7%A8%D7%95%D7%AA%D7%99-%D7%94-api-%D7%A9%D7%9C-%D7%A8%D7%A9%D7%95%D7%AA-%D7%94%D7%9E%D7%A1%D7%99%D7%9D-%D7%9E%D7%93%D7%A8%D7%99%D7%9A-%D7%9E%D7%A2%D7%A9%D7%99-%D7%9C%D7%94%D7%AA%D7%9E/
- A-Point — Israel Invoice API: https://www.apoint.co.il/he/services/israel-invoice-api/
- Linet: https://www.linet.org.il/invoice-api-israel-developers/ ; H-ERP: https://www.h-erp.co.il/israel-invoice/ ; H-ERP Restigo: https://www.h-erp.co.il/restigo/
- ops-excel: https://ops-excel.com/knowledge/allocation-number/ ; billos: https://billos.co.il/guides/allocation-number/
- cpa.co.il: https://www.cpa.co.il/2026-allocation-number/ ; horizon: https://horizon.org.il/cfo-outsource/allocation-number-invoice-2026/ ; hl-cpa: https://www.hl-cpa.co.il/blog/allocation-number-2026
- capitax execution instruction: https://www.capitax.co.il/content/2/3434 ; shamaeim: https://shamaeim.org.il/%D7%97%D7%A9%D7%91%D7%95%D7%A0%D7%99%D7%95%D7%AA-%D7%99%D7%A9%D7%A8%D7%90%D7%9C-%D7%9E%D7%A1%D7%A4%D7%A8%D7%99-%D7%94%D7%A7%D7%A6%D7%90%D7%94 ; BookedUp: https://bookedup.co.il/guides/mispar-haktzaa-cheshboniot-israel-2026
- Herzog (ISA directive, Jun 2026): https://herzoglaw.co.il/en/news-and-insights/israel-securities-authority-publishes-directive-for-payment-companies-regarding-the-implementation-of-an-open-banking-standard/ ; Herzog (law): https://herzoglaw.co.il/en/news-and-insights/the-regulation-of-payment-and-payment-initiation-services-law-is-approved-by-the-knesset-in-the-second-and-third-readings/
- Goldfarb: https://www.goldfarb.com/client-update-new-financial-regulation-in-israel-the-regulation-of-payment-and-payment-initiation-services-law/
- IsraelDefense (BoI draft 24 Sep 2026): https://www.israeldefense.co.il/en/node/71075
- funder.co.il: https://www.funder.co.il/article/203286 ; Shibolet regulatory update Sep 2026 (not fetched): https://www.shibolet.com/?p=28070
- Bizportal (ISA licences): https://www.bizportal.co.il/capitalmarket/news/article/20039545 ; https://www.bizportal.co.il/general/news/article/20034820
- ISA equity directive: https://www.new.isa.gov.il/images/Fittings/isa-be/asset_library_pic/al_lobby/al_lobby-6267b530a26dd/order_equity.pdf
- CMA 2026 regulation plan: https://www.gov.il/BlobFolder/reports/report_0015/he/regulation_plan_26_1.pdf ; fee draft: https://tazkirim.gov.il/s/legislativeworkactivity/a13Wn00000BgfenIAB/%D7%94%D7%A4%D7%A6%D7%94-%D7%9C%D7%94%D7%A2%D7%A8%D7%95%D7%AA-%D7%A6%D7%99%D7%91%D7%95%D7%A8%D7%99?language=en_US
- Finanda: https://www.finanda.com/en/ ; ThePaypers: https://thepaypers.com/fintech/news/the-israel-securities-authority-grants-initial-licenses-to-fintechs ; Calcalist Tech (RiseUp): https://www.calcalistech.com/ctechnews/article/sjhgncr11c ; ensun: https://ensun.io/search/open-banking/israel
- Masav: https://www.masav.co.il/solution/payment-to-suppliers/ ; https://www.masav.co.il/solution/credits/
- SUMIT: https://help.sumit.co.il/he/articles/5833266 ; Odcanit: https://www.od.co.il/masav/ ; Abra BC: https://bc-guide.abra.page/ ; Rivhit KB: https://www.rivhit.co.il/knowledgebase/ (Masav payment confirmation)
- Leumi Business: https://www.leumi.co.il/biz/Transfers-salaries ; Bank Otsar tariff: https://www.bankotsar.co.il/media/jarlpmqq/
- BoI payments overview 2024: https://www.boi.org.il/media/3pjpq0wa/overview-of-the-payments-system-in-israel-final.pdf
- regxplora (GAMA/Max-IT/Rapyd): https://platform.regxplora.com/updates/2f89f45838e450d4b67b6459af3db4ce215624b28fe51dc736d3cc54a03097a3/ ; changeflow: https://changeflow.com/govping/banking-finance/three-companies-join-israel-s-payment-systems-26th-apr-2026-04-26
- masav Python lib: https://github.com/omrirz/masav ; https://pypi.org/project/masav/
- Procee: https://www.g2.com/products/procee/pricing ; https://he.procee.com/features/supplier-payments/
- WhatsApp Oct 2026: YCloud https://www.ycloud.com/blog/whatsapp-api-message-pricing-update-effective-october-1-2026 ; Wati https://www.wati.io/en/blog/whatsapp-service-message-pricing/ ; MyOperator https://myoperator.com/blog/whatsapp-api-pricing-october-2026-update ; letsbot https://letsbot.net/en/whatsapp-api-pricing-2026.html ; Pepper Cloud https://blog.peppercloud.com/whatsapp-api-pricing-everything-you-need-to-know/ ; flowcall https://flowcall.co/blog/whatsapp-business-api-pricing-2026 ; sleekflow https://sleekflow.io/en-us/blog/whatsapp-business-price ; Zoho https://help.zoho.com/portal/zh/community/topic/whatsapp-pricing-changes-pay-per-message-starting-july-1-2025?page=11 ; Meta (not reachable): https://developers.facebook.com/docs/whatsapp/pricing
- WhatsApp Israel: fullness.co.il https://fullness.co.il/he/tools/whatsapp-api-pricing ; Mumble https://mumble.co.il/messages-pricing-calculator/ ; ToI blog https://blogs.timesofisrael.com/israels-quiet-q2-2026-bot-pricing-reset/ ; spike https://www.spike.co.il/blog/whatsapp-business-pricing ; otomation https://www.otomation.io/blog/whatsapp-api-cost-israel/ ; gambot https://gambot.co.il/PriceList/ ; reepli https://www.reepli.ai/he/resources/whatsapp-business-api-pricing/ ; nextbot https://nextbot.co.il/blog/whatsapp-business-api-pricing-setup-guide ; topicpen https://go.topicpen.com/he/guides/whatsapp-business-api-israel-guide-setup-pricing
- Tabit: https://apis.io/providers/tabit/ ; https://raw.githubusercontent.com/api-evangelist/tabit/refs/heads/main/openapi/tabit-openapi.yml ; https://www.tiphaus.com/integration/tabit/
- Beecomm: https://www.beecomm.com/ ; Robotunnel: https://www.robotunnel.com/
- Restigo API: https://www.restigo.co.il/xml-%D7%A9%D7%9C%D7%99%D7%97%D7%AA-%D7%94%D7%96%D7%9E%D7%A0%D7%94-%D7%9C%D7%A1%D7%A4%D7%A7/api5/
- MarketMan AvT: https://marketman.com/actual-vs-theoretical-food-cost-report ; sig.ai: https://geo.sig.ai/brands/marketman.md
- Bookkeeping instructions: nevo https://www.nevo.co.il/law_html/law01/255_179.htm ; gilui-naot (link above) ; PwC https://www.pwc.com/il/he/tax-beyond/assets/nihol_sfarim.pdf ; MoD https://www.online.mod.gov.il/Online2016/Documents/Support/AttachmentE.doc ; ComSign https://www.comsign.co.il/%D7%97%D7%A9%D7%91%D7%95%D7%A0%D7%99%D7%AA-%D7%93%D7%99%D7%92%D7%99%D7%98%D7%9C%D7%99%D7%AA/ ; ronen-missim (2025 edition listing)
