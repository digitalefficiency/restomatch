# The 2025-2026 frontier of AP automation and AI: what a restaurant invoice product could adopt to leapfrog incumbents

Scope note: cross-industry AP and fintech, 2025-2026. "Shipped" means generally available or in staged rollout to paying customers. "Announced" means a press release, beta, waitlist, or marketing page with no evidence of general availability. Almost every performance figure below is **vendor self-reported**. I found no independent audit of touchless or recovery rates. Internal RestoMatch context comes from `/home/user/restomatch/STATE.md` and `/home/user/restomatch/AGENTS.md`.

---

## 1. Agentic AP: who ships agents that read, reconcile, dispute, chase credit notes and post, and what results do they report?

### Takeaway
Between mid-2025 and early 2026 every major AP vendor shipped or announced "agents": Vic.ai (Jun 2025), Ramp (Oct 2025), BILL (Oct 2025), Basware (Nov 2025 and Feb 2026), Medius, and SAP. These agents do **coding, approval routing, payment, fraud flags, tax-form collection and answering supplier inquiries**. The full recovery loop (detect a price or quantity discrepancy → draft the dispute → send it to the supplier → chase until the credit note arrives → match the credit to the dispute) appears only on vendor agent pages (Spendflo, ChatFin) or as a beta (SAP Joule Dispute Resolution Agent). Every design keeps a human approval gate. Incumbents report efficiency metrics (touchless %, cost per invoice). **No vendor I found publishes a "₪/$ recovered from suppliers" metric.**

### Cited Findings
**Ramp (SMB/mid-market, US). Shipped in staged rollout.**
- Ramp launched "Agents for AP" on 7 Oct 2025. They automate invoice coding, invoice approval and payment processing inside Bill Pay, which can process, approve and pay an invoice "in as few as three clicks" — [CPA Practice Advisor](https://www.cpapracticeadvisor.com/2025/10/07/ramp-launches-accounts-payable-agents/170422/); [PYMNTS](https://www.pymnts.com/news/artificial-intelligence/2025/ramp-adds-ai-agents-invoice-coding-approval-payment-processing/)
- Ramp claims, from internal data, that the agents get 85% of accounting fields right the first time. Its CTO described cases nearing 100% automation. The agents recommend approvers and flag fraud, and early-access users reportedly flagged over $1M in fraudulent invoices in 90 days — [PYMNTS](https://www.pymnts.com/news/artificial-intelligence/2025/ramp-adds-ai-agents-invoice-coding-approval-payment-processing/); [CPA Practice Advisor](https://www.cpapracticeadvisor.com/2025/10/07/ramp-launches-accounts-payable-agents/170422/)
- The rollout was staged: customers could "enable or join the waitlist" for AP Agent — [Ramp blog](https://ramp.com/blog/bill-pay-guides)
- The AP agents followed Ramp's July 2025 agents for controllers. In June 2026 Ramp launched "Applied AI Solutions" to help enterprises deploy agents across finance operations — [Ramp press release via Cision](https://digital-release.wgnradio.com/business/press-releases/cision/20260610NY80159/ramp-launches-applied-ai-solutions-helping-enterprises-deploy-ai-agents-across-finance-operations); context headline "Ramp unveils AI finance tools as valuation hits $32bn" — [FinTech Global](https://fintech.global/?p=222247)

**BILL (SMB, "Fortune 5 Million"). Announced 28 Oct 2025, with rollout dates.**
- W-9 Agent: autonomously requests and pre-validates vendor W-9s and removes over 80% of manual steps. BILL says it can handle up to 3M W-9s and save about 650,000 hours — [BILL press release](https://www.bill.com/press-release/bill-launches-new-ai-agents); [Accounting Today](https://www.accountingtoday.com/news/bill-launches-agents-for-w-9s-and-reconciliations)
- Reconciliation (receipts) Agent: auto-codes transactions so receipts reconcile. In early rollout, BILL reports transactions processed entirely by AI rose 533%, at 92% accuracy. It is expected to reach 40,000+ businesses within six months. Agents for email and AP coding were flagged as future releases — [BusinessWire](https://secure.businesswire.com/news/home/20251028682021/en/BILL-Launches-New-AI-Agents-to-Power-Touchless-Transactions-for-the-Fortune-5-Million); [BILL](https://www.bill.com/press-release/bill-launches-new-ai-agents)
- Availability timing conflicts: "in the coming weeks" (BILL) versus "by Thanksgiving" (Accounting Today) — [BILL](https://www.bill.com/press-release/bill-launches-new-ai-agents); [Accounting Today](https://www.accountingtoday.com/news/bill-launches-agents-for-w-9s-and-reconciliations)

**Vic.ai (mid-market/enterprise). Q2 2025 release.**
- June 2025: VicPay 2.0, a Vendor Portal, and VicAgents, described as "task-specific, intelligent AI agents trained to autonomously execute finance workflows" — [Vic.ai news](https://www.vic.ai/news/vic-ai-launches-vicpay-vendor-portal-and-vicagents-accelerating-the-shift-to-autonomous-finance); [Vic.ai blog](https://vic.ai/blog/q2-product-launch-from-automation-to-agentic-ai)
- A "70%+ reduction in manual AP work" figure appears only on a third-party comparison site and is unverified — [aiagentrank](https://aiagentrank.io/compare/bland-ai-vs-vic-ai)
- Competitor Stampli says Vic.ai aims for "autonomous" processing that bypasses human review. This is promotional framing. Stampli's own agent "Billy" automates parts of procure-to-pay, but I found no 2025 metrics for it — [Stampli vs Vic.ai](https://www.stampli.com/stampli-vs-vic-ai/); [Indexator: Billy](https://indexator.ai/companies/billy-by-stampli)

**Medius (enterprise). Shipped. Vendor claims only.**
- Medius claims a 96.3% touchless rate on PO invoices and 99.5% on non-PO invoices, plus a supplier-email agent handling about 12,000 emails a month. It also says it was a Leader in Gartner's March 2025 Magic Quadrant for AP Applications — [Medius AI Advantage](https://medius.com/ai-innovation/medius-ai-advantage/)
- Medius Copilot (an assistant for approvers) and Supplier Conversations (handles supplier messages) are framed as part of the "Medius Agent" project. The launch date was not shown — [KMWorld](https://www.kmworld.com/Articles/News/News/Medius-introduces-two-new-solutions-to-expand-accounts-payable-efficiency-164761.aspx)

**Basware (enterprise). InvoiceAI shipped; agents announced Feb 2026, "rolling out throughout 2026".**
- InvoiceAI is a bundle of AI features that read, validate and match PO and non-PO invoices. The Paypers dates it 24 Nov 2025, but one Paypers article says Nov 2024, so the year is uncertain — [The Paypers](https://thepaypers.com/fintech/news/basware-launches-invoiceai); [Food Logistics](https://www.foodlogistics.com/home/news/22955524/basware-inc-baswares-invoiceai-to-autonomously-process-invoices)
- 24 Feb 2026: a **Supplier Agent** that handles invoice disputes and payment queries by automating supplier communications, summarising call outcomes and recording next steps, plus an AP Pro Agent. Every agent action passes a **central policy engine with "autonomy gates"** that apply the customer's business rules and risk thresholds — [CFO Dive (Basware press release)](https://www.cfodive.com/press-release/20260224-basware-launches-new-agentic-ai-capabilities-to-transform-intelligent-finan-1/); [The Paypers](https://thepaypers.com/fintech/news/basware-rolls-out-ai-agents-for-autonomous-invoice-processing)
- An FT Longitude survey of 200 finance leaders, commissioned by Basware, found 61% say their organisations rolled out AI agents "largely as an experiment" — [The Paypers](https://thepaypers.com/fintech/news/basware-rolls-out-ai-agents-for-autonomous-invoice-processing)
- A critical opinion piece notes the rollout is "throughout 2026" with no named case studies or ROI data, and argues the autonomy gates could become a bottleneck — [UC Strategies](https://ucstrategies.com/news/baswares-ai-agents-can-process-2-2b-invoices-but-cant-decide-which-to-approve/)
- Basware processed more than 2B invoices in 2024 — [Basware](https://news.basware.com/en/basware-reveals-future-of-intelligent-finance)

**Coupa (enterprise).** The only description I found is a competitor's: Coupa has "Navi AI and agentic spend management capabilities", and supplier participation is typically needed to unlock full automation — [Medius vs Coupa](https://www.medius.com/resources/software-comparisons/medius-vs-coupa/)

**Dispute / credit-memo agents, the closest match to "chase the credit note".**
- SAP's Dispute Resolution Agent scans invoices and contracts for errors and suggests fixes such as credit memos. The Joule version shown in SAP Learning is labelled **BETA** — [SAP](https://www.sap.com/products/erp/dispute-resolution-agent.html); [SAP Learning](https://learning.sap.com/courses/reviewing-the-use-of-sap-joule-agents-in-finance/streamlining-dispute-management-with-the-dispute-resolution-agent_b08c72ea-949d-42dd-9094-8e20038b256b)
- Spendflo markets three agents:
  - a credit-memo agent that reads incoming credit memos, finds the invoice or PO each one reverses, and checks the credit does not exceed what was billed; an AP analyst approves the posting — [Spendflo credit memo](https://www.spendflo.com/agents/ai-credit-memo-processing-agent)
  - a debit-memo agent that drafts the memo with supporting evidence and holds the payable adjustment until sign-off — [Spendflo debit memo](https://www.spendflo.com/agents/ai-debit-memo-processing-agent)
  - an invoice-dispute agent — [Spendflo dispute](https://www.spendflo.com/agents/ai-invoice-dispute-agent)
- ChatFin describes disputes as typically arising from price variances (invoice ≠ PO) or quantity mismatches (short shipments). Its agent approves the undisputed part of an invoice for payment and holds the disputed amount — [ChatFin](https://chatfin.ai/blog/how-ai-agents-handle-supplier-disputes-without-human-intervention)

**Restaurant-vertical incumbent: Ottimate (US).**
- Ottimate positions itself as "the AI-powered AP platform built for restaurants". It launched Ottimate Copilot in Aug 2025, a conversational AP assistant that flags unusual activity. It reports over 30,000 restaurants, hotels and grocery chains on the platform, and its VendorPay product pays 200,000+ vendors. It claims "only 4% of finance teams have fully automated AP" and published a Jan 2026 post on agentic AI, but I found no agent product details. A new CEO was named in Mar 2026 — [Ottimate blog](https://ottimate.com/?p=11989); [Ottimate](https://ottimate.com/?p=8201); [Welcome to the Jungle profile](https://app.welcometothejungle.com/jobs/3raJC1nn/company)

**Benchmarks (Ardent Partners, via secondary sources; figures conflict):**
- Best-in-class cost per invoice is **$2.78** with a **3.1-day** cycle time. The "average" is cited as $9.40, $10.89 (with 10.9 days) or $12.88 (State of ePayables 2024), depending on report edition and cohort — [Apex Analytix](https://www.apexanalytix.com/resources/blog/ardent-partners-key-ap-metrics-2025/); [Corpay](https://www.corpay.com/it/resources/blog/ap-team-productivity-benchmarks); [Ramp](https://ramp.com/blog/accounts-payable/accounts-payable-metrics); [Tipalti](https://tipalti.com/resources/learn/cost-per-invoice/)
- Best-in-class exception rate is 9% versus 22% for others. Best-in-class touchless processing is about 49.2%; a less authoritative source gives 52.8% for 2025 — [Corpay](https://www.corpay.com/it/resources/blog/ap-team-productivity-benchmarks); [Medius / Ardent report page](https://www.medius.com/resources/guides-reports/ardent-partners-accounts-payable-metrics-that-matter/); [StealthAgents](https://stealthagents.com/research/ai-accounts-payable-automation-statistics)

### Inferences
- **The leapfrog gap is a closed-loop recovery agent.** Incumbents' agents optimise the cost of processing (touchless %, $/invoice). None I found ships, as a mainstream feature, an agent that turns a food-specific discrepancy (price creep, short delivery, catch-weight shortfall, missing credit) into a supplier claim and tracks it until the credit note arrives and matches the claim. That is exactly RestoMatch's North Star: ₪ leak surfaced, then ₪ actually recovered. A new metric, "recovered ₪ / surfaced ₪", would be unique.
- **Design pattern to copy: autonomy gates.** Basware's policy engine with per-customer risk thresholds and Spendflo's "draft, then hold until sign-off" are the accepted model. For a 1-3 branch owner: the agent drafts the WhatsApp or email claim, the owner taps "send", and the agent auto-follows-up. This matches the human-in-the-loop posture already in RestoMatch's approvals engine (7 rules; `packages/api/src/approvals/engine.ts` is on the immutability list, so rule changes need a human PR).
- **Build sketch:**
  1. The existing 12-type discrepancy engine is the trigger.
  2. A dispute state machine: draft → approved → sent → acknowledged → credit-note received → credit matched → closed or escalated.
  3. Outbound channel templates (see §5).
  4. Credit-note ingestion and matching, i.e. negative-amount invoices linked to dispute IDs.
  5. Partial-payment hold: "pay the undisputed part".
  6. A ledger view (the monthly supplier ledger already in progress in task #26 is the natural home).
- **1-3 branches vs enterprise.** Medius, Basware, Coupa and SAP are enterprise and assume ERP plus supplier networks. Ramp and BILL are SMB but US-centric (W-9s, ACH, cards). Ottimate is restaurant-vertical but US. None targets Israeli Hebrew suppliers. For a small restaurant, "touchless %" matters less than "how many ₪ did you get back and how many minutes did it cost me".

### Gaps
- No independent, audited touchless, accuracy or recovery-rate data for any vendor. All figures are vendor claims.
- No vendor publishes a supplier-credit recovery rate or average days-to-credit. I found no benchmark for restaurant credit-note recovery.
- Tipalti's and Stampli's 2025-2026 agent metrics were not found. Coupa's agent capabilities were found only through a competitor's description.
- Whether Ottimate has shipped autonomous dispute or credit agents is unconfirmed.

---

## 2. Document AI state of the art for messy real-world invoices (multimodal LLMs, handwriting, Hebrew/RTL, catch-weight, confidence, human-in-the-loop)

### Takeaway
Multimodal LLMs are now the default extraction layer and cost fractions of a cent per document. But **no authoritative 2025-2026 benchmark covers handwritten, Hebrew or mixed-language invoices or delivery notes**. RTL and non-Latin script benchmarks (Arabic KITAB-Bench, GlotOCR) show vision-language models beat classic OCR yet remain far from solved. So field-level confidence, arithmetic self-checks and a human review queue are still required.

### Cited Findings
- A Sept 2025 academic benchmark (arXiv 2509.04469) compares multimodal-vision against text-based parsing strategies for invoice processing, including small models (gpt-5-nano, gemini-2.5-flash-lite, gemma-3-4b-it). The paper fetch failed (DNS), so its accuracy figures are not captured here — [arXiv 2509.04469](https://arxiv.org/html/2509.04469v1)
- An aggregator guide (updated Dec 2025) reports Qwen3-VL at 96.5% on DocVQA and Gemini 2.5 Pro at about 93% invoice accuracy for about $0.0006 per invoice. These are aggregated numbers, not a controlled invoice benchmark — [Codesota](https://www.codesota.com/guides/invoice-processing-vllm)
- AIMultiple's benchmark (tests run Dec 2024) compared Claude 3.5 Sonnet, Amazon Textract, Google Document AI, Azure and others. Most struggled with **pricing details on low-quality images** — [AIMultiple](https://aimultiple.com/invoice-ocr)
- A practitioner claim, unsourced, says OCR accuracy drops from 95%+ to 60-80% on handwritten text — [RaftLabs](https://raftlabs.com/blog/ocr-vs-llm-invoice-processing)
- Arabic is the closest RTL analogue. KITAB-Bench (ACL 2025) found VLMs beat traditional OCR on character error rate, but the best model (Gemini-2.0-Flash) reached only 65% on PDF-to-Markdown conversion. This comes via search summary only; the link is an ACL Anthology author page — [ACL Anthology](https://aclanthology.org/people/ghazi-shazan-ahmad/unverified/)
- GlotOCR Bench (2026, 100+ Unicode scripts) found even the strongest frontier models fail to generalise beyond about 30 scripts. Hebrew's score was not confirmed — [GlotOCR Bench summary](https://www.opentrain.ai/papers/glotocr-bench-ocr-models-still-struggle-beyond-a-handful-of-unicode-scripts--arxiv-2604.12978/)
- HebVL, a Qwen3-VL-8B fine-tune for historical Hebrew-script documents, reports aligned F1 0.807 against 0.730 for a Kraken specialist on Genizah handwriting. It is self-reported and its paper is under review — [HebVL model card](https://friendli.ai/models/isaacmg/qwen3-vl-8b-hebrew-v18a-ckpt)
- A Haifa/BGU study (pre-VLM) on medieval Hebrew handwriting found the implicit language model affects final word error by about 10%. This suggests language priors matter a lot for Hebrew handwriting — [University of Haifa](https://cris.haifa.ac.il/en/publications/linguistic-knowledge-within-handwritten-text-recognition-models-a/)
- A vendor claim says LLMWhisperer supports 300+ languages and handwritten invoices, with no accuracy numbers — [Unstract](https://unstract.com/?p=14190)
- Internal state of RestoMatch's OCR:
  - reconciler rule: Claude wins string conflicts, Document AI tie-breaks numerics; lines are matched by Dice bigram coefficient
  - products auto-link at ≥0.95 candidate confidence; the review threshold is set per restaurant (`restaurants.settings.ocrReviewThreshold`)
  - in production both provider slots are the same Claude Vision instance, so each scan costs two Opus calls (bug M11)

  — [STATE.md](/home/user/restomatch/STATE.md)

### Inferences
- **What frontier looks like for a Hebrew delivery note (תעודת משלוח) with pen corrections:**
  - a multimodal LLM extracts each field together with a bounding-box crop shown to the reviewer
  - **deterministic arithmetic cross-checks** act as a free confidence signal, independent of any model: qty × unit price = line total, Σ lines + 18% VAT = total, and allocation number present when the pre-VAT total is ≥ ₪5,000 (see §3)
  - a per-supplier layout memory learns from every human correction
  - only low-confidence fields go to review, never whole documents

  Because AIMultiple found price fields are the weak spot on poor images, numeric fields deserve the strictest gating.
- **Catch-weight lines** (e.g. "chicken, 12.4 kg × ₪/kg") are where handwriting and price-unit errors meet. They need unit normalisation (`packages/matching/src/units.ts` is immutable, so it needs a human PR) plus a tolerance band, not exact matching.
- **Cost is no longer the constraint.** At roughly $0.0006 to a few cents per document, a second model call for verification is affordable when it targets only low-confidence fields. The current waste is the duplicate full call (M11), not the per-call price.
- **Maturity:** extracting printed Hebrew invoices is shipped and good enough with review. Handwritten Hebrew corrections are experimental, with no benchmark. Mixed Hebrew/English/numeric SKU lines are workable but unmeasured. **RestoMatch would have to build its own Hebrew restaurant-invoice eval set** (e.g. 200-500 labelled pilot documents) to make any accuracy claim. That set would also be a moat.

### Gaps
- No Hebrew or Israeli invoice extraction benchmark exists in the sources found. No vendor publishes Hebrew accuracy.
- No benchmark for catch-weight line extraction or for handwritten corrections on delivery notes.
- The arXiv 2509.04469 numeric results were not retrieved (fetch failed).
- The KITAB-Bench figure is cited via a search summary, not the paper itself.

---

## 3. E-invoicing and structured data: Peppol, EU ViDA, continuous transaction controls (Israel), supplier networks; ingesting structured invoices instead of OCR

### Takeaway
Structured e-invoicing is becoming mandatory in the EU: Belgium (Jan 2026), Poland KSeF (Feb-Apr 2026), France (Sep 2026), and EU-wide intra-community B2B under ViDA by 1 Jul 2030. Israel is a live **clearance/CTC regime**: invoices at or above **₪10,000 pre-VAT from 1 Jan 2026, and ≥ ₪5,000 from 1 Jun 2026**, need a Tax Authority allocation number for the buyer to deduct input VAT. In Israel this gives a buyer-side compliance check, but I found no evidence that it gives the buyer structured line-item data, so OCR stays necessary for delivery notes and line detail.

### Cited Findings
**EU ViDA**
- The package was adopted 11 Mar 2025, with entry into force about 14 Apr 2025. Member states may now mandate domestic B2B/B2C e-invoicing without EC approval — [Grant Thornton](https://www.grantthornton.ie/insights/factsheets/vida-digital-reporting-e-invoicing/); [eConnect](https://econnect.eu/en/docs/knowledge/regulations/europe/vida/timeline)
- From 1 Jul 2030 every intra-EU B2B invoice must be a structured e-invoice (EN 16931) with digital reporting (DRR), which replaces EC Sales Lists. Summary invoices are allowed only under conditions. Member states without a national system align by 1 Jan 2035 — [TrueCommerce](https://www.truecommerce.com/blog/vida-e-invoicing-requirements/); [eConnect](https://econnect.eu/en/docs/knowledge/regulations/europe/vida/timeline); [PwC Switzerland](https://www.pwc.ch/en/insights/tax/vida-revolutionising-eu-vat-for-the-digital-era.html)
- The European Commission published a detailed DRR and e-invoicing work programme on 20 May 2026 — [Edicom](https://edicomgroup.com/it/blog/vida-la-ue-promuove-la-fatturazione-elettronica-b2b)

**Country mandates and Peppol** (mostly vendor blogs; not verified against government sites)
- Belgium: domestic B2B e-invoicing via Peppol has been mandatory since 1 Jan 2026, with a grace period to Mar 2026. Over 1M Peppol recipients registered early in the mandate, and continuous transaction reporting is planned from 2028 — [Fonoa](https://www.fonoa.com/resources/blog/peppol-adoption-europe-2026-mandates-vida); [Lleverage](https://www.lleverage.ai/blog/eu-e-invoicing-manufacturers-2026-guide)
- Poland KSeF clearance: large taxpayers from 1 Feb 2026, the rest from 1 Apr 2026, micro-enterprises from 1 Jan 2027. Sources differ on the phase-in — [Fintua](https://fintua.com/blog/einvoicing-mandate-watch-list-2026); [OriginStamp](https://originstamp.com/en/blog/reader/eu-e-invoicing-mandates-timeline-2026-2030)
- France: from 1 Sep 2026 all companies must receive e-invoices and large and mid-size firms must issue them; SMEs and micro-enterprises issue from 1 Sep 2027. DGFiP was designated national Peppol Authority in July 2025 — [Fonoa](https://www.fonoa.com/resources/blog/peppol-adoption-europe-2026-mandates-vida); [Vertex](https://www.vertexinc.com/resources/resource-library/navigating-urgent-global-e-invoicing-mandates-february-2026-regulatory-alert)
- Germany: all businesses must be able to receive EN 16931 e-invoices from 1 Jan 2025, with issuance phasing in during 2027-2028. Sources conflict, and Peppol use there is not officially confirmed — [Lleverage](https://www.lleverage.ai/blog/eu-e-invoicing-manufacturers-2026-guide)

**Israel CTC ("Invoices Israel" / allocation numbers)**
- Threshold schedule, excluding VAT: ₪25,000 (2024), ₪20,000 (2025), **₪10,000 from 1 Jan 2026**, **₪5,000 from 1 Jun 2026**. VAT Implementation Order 01/2025 confirmed the accelerated timeline and skipped the planned ₪15,000 step — [Sovos](https://sovos.com/regulatory-updates/vat/israel-tax-authority-confirms-accelerated-timeline-for-ctc-invoice-allocation-number/); [ecosio](https://ecosio.com/en/compliance/israel/e-invoicing/)
- A conflicting, apparently outdated source still lists ₪15,000 for 2026 — [Avalara](https://www.avalara.com/us/en/vatlive/country-guides/africa-and-middle-east/israel/israeli-e-invoicing.html)
- The allocation number is mandatory for the **recipient to claim the input VAT deduction**. Sellers obtain it through the ITA portal or accredited software or API — [VATit](https://vatit.com/e-invoicing-guide/israel/); [Beancount (Sep 2026)](https://beancount.io/blog/2026/09/22/israel-invoice-allocation-number-5000-nis-osek-murshe-b2b-guide); [Banqup](https://www.banqup.com/en-be/resources/blog/israel-s-clearance-regime-full-steam-ahead-despite-challenges)

**Supplier networks and portals**
- Vic.ai launched a Vendor Portal in June 2025 — [Vic.ai](https://www.vic.ai/news/vic-ai-launches-vicpay-vendor-portal-and-vicagents-accelerating-the-shift-to-autonomous-finance)
- Coupa's full automation typically requires supplier participation, per a competitor — [Medius vs Coupa](https://www.medius.com/resources/software-comparisons/medius-vs-coupa/)
- Medius describes Basware as tailored to large enterprises with a compliance focus, per a competitor — [Medius vs Basware](https://www.medius.com/resources/software-comparisons/medius-vs-basware/)

### Inferences
- **A cheap, high-value ₪ feature for Israel: an allocation-number guard.** Every supplier invoice at or above ₪5,000 pre-VAT that arrives without a valid allocation number means the restaurant risks losing 18% input VAT, about ₪900 or more on a ₪5,000 invoice. Flag it at intake and auto-draft the "please re-issue with allocation number" request to the supplier. This turns a compliance rule into a surfaced, recoverable ₪ amount, which fits the North Star.
- **Ingest abstraction.** Design intake so a structured source (supplier API or export, MarketMan/Zester sync already in `packages/procurement`, future UBL/Peppol-style XML, or an Israeli e-invoice payload) bypasses OCR and feeds the matching engine directly at confidence 1.0. Only images and PDFs go through document AI. EU Peppol does not apply to Israeli ICP restaurants, but it is the right architectural template, and Israel's CTC shows the regulatory direction.
- **1-3 branches vs enterprise.** Small restaurants will never run a Peppol access point or SHAAM integration themselves. The value is that the product does the checking invisibly. Supplier networks of the Coupa kind fail for small buyers because suppliers will not onboard for a 1-branch customer. Restaurant-side capture (WhatsApp photo, email-in) is the realistic channel.

### Gaps
- Whether the Israeli Tax Authority API lets a **buyer** validate an allocation number or pull invoice data programmatically was not established. The likely owner is the parallel `israel_regulation_tax.md` notes.
- No data on Peppol or e-invoice adoption by food-service distributors specifically.
- The EU country dates were not verified against official government sources.

---

## 4. Supplier statement reconciliation, duplicate and fraud detection (bank-account change / BEC, fake invoices), early-payment / dynamic discounting, cash-flow forecasting

### Takeaway
Two adjacent capabilities have clearly arrived as shipped products from 2024 to Jan 2026: **statement reconciliation** (Yooz, Oversight, SAP) and **AI fraud flagging** (Ramp). They map directly onto "₪ the owner believes": invoices billed but never received, promised credits never issued, duplicates, and paying a fraudster's account. Vendor impersonation and BEC fraud are the dominant attack vectors. The EU (PSD3/PSR) is moving toward mandatory payee-name/IBAN verification and PSP liability, but I found no Israeli equivalent. Dynamic discounting and cash-flow forecasting were not adequately researched here.

### Cited Findings
**Statement reconciliation**
- Yooz launched YoozVendorStatements in Nov 2024. It extracts line-level data from supplier statements in varied formats, matches them to internal invoices, and claims an 80% cut in investigation time — [Yooz](https://www.getyooz.com/en-gb/blog/yooz-unveils-yoozvendorstatements)
- Oversight launched a vendor-statement reconciliation module in Jan 2026 that flags missing invoices, missing credits and payment mismatches — [Oversight](https://www.oversight.com/news/oversight-unleashes-ai-power-to-eliminate-tedious-reconciliation-work)
- SAP's AP assistant lists reconciling statements and highlighting discrepancies among its agent tasks — [SAP](https://www.sap.com/use-cases/joule-assistant/accounts-payable-ai)
- A ChatFin agent compares statements to ERP open items and assembles evidence. A vendor blog estimates statement reconciliation is 10-20% of month-end close, with statements arriving as PDF, Excel, print and email — [ChatFin](https://chatfin.ai/blog/ai-vendor-statement-reconciliation-and-ap-control); [Peakflo](https://blog.peakflo.co/en/finance-news/ai-powered-vendor-reconciliation)
- A Northwestern student project (Sep 2025, prototype only) reports that Coca-Cola Consolidated receives about 100 vendor statements a month and that reconciling them takes about 7,000 person-hours. The period is not stated in the summary — [Northwestern McCormick](https://www.mccormick.northwestern.edu/industrial/academics/undergraduate/client-project-challenge/projects/ccc-cpc-2025.html)

**Fraud (AFP 2025 Payments Fraud and Control Survey, covering 2024)**
- 79% of organisations were targets of payments fraud attacks or attempts. BEC was the #1 avenue, cited by 63% — [AFP](https://financialprofessionals.org/training-resources/resources/survey-research-economic-data/details/payments-fraud); [NACM](https://www.nacmnc.org/news/701851/79-of-Organizations-Faced-Payment-Fraud-Attempts-in-2024.htm)
- Vendor-impostor fraud is **conflicting**: 45% (up from 34%) per the Truist-hosted highlights, against 60% per AFP's page — [Truist / AFP highlights](https://truist.com/content/dam/truist-bank/us/en/documents/info/cci/2025-afp-payments-fraud-control-survey-report-key-highlights.pdf); [AFP](https://financialprofessionals.org/training-resources/resources/survey-research-economic-data/details/payments-fraud)
- Executive impersonation fell 8 percentage points to 49%. Only 22% of organisations recovered 75% or more of lost funds — [AFP](https://financialprofessionals.org/training-resources/resources/survey-research-economic-data/details/payments-fraud)
- Ramp's AP agents flag fraud; early-access users flagged over $1M in fraudulent invoices in 90 days (vendor claim) — [PYMNTS](https://www.pymnts.com/news/artificial-intelligence/2025/ramp-adds-ai-agents-invoice-coding-approval-payment-processing/)

**Payee verification (EU)**
- PSD3/PSR reached provisional agreement on 27 Nov 2025. It extends payee-name/IBAN matching (in force for SEPA Instant since Oct 2025) to other credit transfers — [Vixio](https://vixio.com/insights/pc-eu-edges-closer-new-payments-framework-psd3-and-psr-agreement); [Digiteal](https://www.digiteal.eu/psd3-psr/)
- PSPs must refund customers deceived by fraudsters impersonating their bank (barring fraud or gross negligence), and PSPs are liable where a Verification-of-Payee failure contributes to a misdirected payment — [PwC](https://www.pwc.com/cz/cs/blog/rizeni-rizik/psd-3-the-psr-payments-reform.html)
- Timing differs by source: final texts in April 2026 with the PSR applying from mid-to-late 2027, or adoption expected in H2 2026 — [MoFo](https://www.mofo.com/resources/insights/260430-psd3-and-the-payment-services-regulation-key-developments); [PwC](https://www.pwc.com/cz/cs/blog/rizeni-rizik/psd-3-the-psr-payments-reform.html); [Trustpair](https://trustpair.com/gb/?p=14892)

**Internal**
- RestoMatch's approvals engine already has a duplicate-invoice rule at priority 100 — [STATE.md](/home/user/restomatch/STATE.md)

### Inferences
- **Statement reconciliation against the supplier ledger (כרטסת ספק) is the strongest 1-3 branch feature in this cluster.** Israeli suppliers routinely send monthly statements. Matching them line by line against received invoices and goods receipts surfaces:
  - invoices billed but not delivered or not received
  - credits promised but not applied
  - double billing across a consolidated monthly invoice (חשבונית ריכוז) and the individual delivery invoices

  Each is a hard ₪ number. It fits the in-flight "consolidated-invoice cross-match and monthly supplier ledger" work (task #26), and the "calm on חשבוניות ריכוז" design rule in AGENTS.md.
- **Bank-detail-change alert.** With no Israeli Verification-of-Payee regime found, a product-level check has standalone value. It would compare supplier bank details printed on invoices or statements against history and block or flag changes (the vendor-impostor/BEC pattern). It is cheap to build once bank fields are extracted.
- **Maturity:** duplicate detection is commodity, shipped everywhere. Statement reconciliation is shipped at Yooz, Oversight and SAP, but not restaurant-specific and not Hebrew. Fraud anomaly flagging is shipped at Ramp (US). Payee verification is regulated in the EU, absent in Israel as far as found.

### Gaps
- **Early-payment / dynamic discounting** (e.g. C2FO, Taulia) and **cash-flow forecasting** for AP were not researched in this pass. No cited findings; treat as open.
- No restaurant-specific data on duplicate-invoice or fake-invoice incidence, or on how often supplier statements disagree with restaurant records.
- No Israeli BEC/vendor-fraud statistics found.

---

## 5. Channels: WhatsApp Business API intake and supplier communication; email-in; mobile receiving with photo/voice; weigh-scale or computer-vision receiving

### Takeaway
WhatsApp is now a priced, per-message channel (since 1 Jul 2025), and replies inside a customer-opened 24h window are free. That makes "staff photographs the delivery note to a WhatsApp number" almost free to run. Outbound supplier messages that the business initiates, such as dispute claims or follow-ups, are paid template messages. On the supplier side, Choco's OrderAgent shows AI capture across email, WhatsApp, voicemail and handwritten notes is shipped in food service. I found **no product that does AI-scale or computer-vision verification of inbound deliveries**; existing AI scales check outgoing customer orders.

### Cited Findings
**WhatsApp Business Platform pricing**
- Meta switched from per-conversation to **per-message pricing effective 1 Jul 2025**. It charges for each delivered marketing, authentication and utility template. **Utility templates delivered inside an open customer-service window are free** — [Meta developer docs](https://developers.facebook.com/docs/whatsapp/pricing); [Gulf News](https://gulfnews.com/technology/whatsapp-announces-pricing-update-to-charge-per-message-on-business-platform-1.500142961)
- Rates vary by market-category pair. Utility and authentication rates have volume tiers that reset monthly and count across a portfolio's accounts. Only delivered messages are charged — [Zoho community](https://help.zoho.com/portal/en/community/topic/whatsapp-message-pricing-changes-effective-july-1-2025)
- Indicative Indian rates are ₹0.78 per marketing message and ₹0.11 per utility or authentication message, as low as ₹0.08 with volume. Not confirmed against Meta's rate card — [exchange4media](https://www.exchange4media.com/marketing-news/whatsapp-introduces-permessage-billing-for-business-messaging-144935.html)

**Supplier-side AI order capture (food service): Choco**
- Choco OrderAgent (formerly "Choco AI") processes orders from voicemail, SMS, email, WhatsApp, handwritten notes, voice messages and third-party channels into the distributor's ERP — [Choco press](https://choco.com/uk/press); [Choco UK](https://choco.com/uk/)
- A May 2025 VoiceAgent, built on OpenAI's Realtime API, replaces night-time voicemail ordering with live conversations and checks stock — [Choco OrderAgent](https://choco.com/uk/orderagent.md)
- Launch date conflict: introduced in 2023 per a Nov 2025 Choco story, against a launch release dated 16 Jan 2024 — [Choco story](https://choco.com/us/stories/suppliers/from-restaurant-app-to-ai-partner-for-distributors-the-evolution-of-choco.md); [Choco AI launch](https://choco.com/uk/stories/suppliers/choco-ai)
- A self-reported claim from a Choco-affiliated LinkedIn post: 98% accuracy and 5,000+ customers in the UK and Ireland — [LinkedIn](https://uk.linkedin.com/in/alexkiely)

**AP supplier-communication agents**
- Medius has a supplier-email agent handling about 12,000 emails a month (vendor claim) — [Medius](https://medius.com/ai-innovation/medius-ai-advantage/)
- Basware's Supplier Agent automates supplier communications and summarises call outcomes — [CFO Dive (Basware)](https://www.cfodive.com/press-release/20260224-basware-launches-new-agentic-ai-capabilities-to-transform-intelligent-finan-1/)

**Scale / computer-vision verification**
- No inbound-receiving AI scale product found.
- Outbound order-check scales exist. Acrelec Double-Check weighs an order and compares it to a predicted weight in under a second. A NEXA AI scale for a QSR group detected anomalies with over 99% accuracy and the vendor reports 50% fewer refunds and 30% fewer missing-item claims (vendor figures) — [Mann Report](https://www.mannpublications.com/mannreport/?p=22707); [NEXA](https://nexamobility.com/news/ai-scale-driving-order-accuracy-and-cost-savings)
- Research prototype: an RGB-D camera with YOLO and density models estimated cafeteria food weight with errors of 5.07% (rice) and 3.75% (chicken) — [AUT repository](https://openrepository.aut.ac.nz/items/921840b6-72d9-4594-9d66-758b46887401/full)

**Internal**
- RestoMatch already exports a `MockWhatsAppNotifier` from `@restomatch/api`, so WhatsApp is mocked, not live. Notifications are dispatched once per role per match run — [STATE.md](/home/user/restomatch/STATE.md)

### Inferences
- **WhatsApp economics favour intake, not broadcast.** Inbound photos from restaurant staff open a 24h service window, and free utility replies such as "got it, 14 lines, 2 price increases, ₪212 over" fit inside it. Outbound **supplier dispute** messages are business-initiated templates: paid per message, needing Meta template approval and an opted-in supplier contact. The cost is still trivial relative to a ₪ claim. Sending WhatsApp or email to suppliers is a human-gated action under AGENTS.md and needs credentials (Phase-6, human-only).
- **Mobile receiving with photo plus voice** ("short two boxes of tomatoes", recorded at the door, transcribed into a goods-receipt note) is the realistic leapfrog for 1-3 branches. It creates the receipt evidence the matching engine needs for QTY_SHORT-type claims without hardware.
- **Weigh-scale or CV receiving is an unoccupied niche** for inbound goods, but it needs hardware, so it fits an enterprise or chain play. For 1-3 branches the near-term version is "photograph the scale display next to the item", with the reading extracted by the same vision model.
- **Choco is a potential partner or competitor signal.** Distributors are adopting AI to digitise inbound orders. A restaurant-side product could reconcile against distributor-side order data where available.

### Gaps
- Israel-specific WhatsApp Business rate card (per-message ₪ prices) not retrieved.
- No benchmarks for email-in invoice capture rates or for voice-note receiving accuracy in Hebrew.
- No inbound-delivery AI scale or CV product found; this may exist under food-safety or receiving-hardware vendors I did not search.

---

## 6. Payments and open banking: paying suppliers from the AP tool, payment initiation (EU PSD2/PSD3, Israel), bank-feed reconciliation

### Takeaway
"Pay from the AP tool" is shipped at all the US SMB leaders: Ramp Bill Pay, BILL, Ottimate VendorPay, Vic.ai VicPay. In Israel the legal basis exists: the Payment Services and Payment Initiation Law (2023) has applied since June 2024, and Bank of Israel and Israel Securities Authority open-banking directives stage in payment initiation, with one ISA draft pointing to **6 Dec 2026** for advanced payment-initiation access. In-product supplier payment in Israel is therefore a **2026-2027 partnership play with a licensed initiator**, not something to build now.

### Cited Findings
**Pay-from-AP products (shipped)**
- Ramp Bill Pay: process, approve and pay invoices "in as few as three clicks" — [CPA Practice Advisor](https://www.cpapracticeadvisor.com/2025/10/07/ramp-launches-accounts-payable-agents/170422/)
- Ottimate VendorPay pays 200,000+ vendors from the AP platform — [Welcome to the Jungle](https://app.welcometothejungle.com/jobs/3raJC1nn/company)
- Vic.ai VicPay 2.0 shipped in June 2025 — [Vic.ai](https://www.vic.ai/news/vic-ai-launches-vicpay-vendor-portal-and-vicagents-accelerating-the-shift-to-autonomous-finance)

**Israel**
- The Payment Services and Payment Initiation Law (2023) took effect in June 2024, modelled partly on PSD2. Non-bank firms can connect directly to the central bank's settlement infrastructure. The Israel Securities Authority has licensed large international payment providers including Revolut — [Vixio](https://www.vixio.com/insights/pc-regulatory-influencer-israels-regulator-eyes-innovation-and)
- A Bank of Israel directive requires banks and credit-card companies to give licensed third parties, with explicit customer consent, access to obtain information or execute transactions. Payment initiation is the second stage, within 1.5 years of publication; the publication date was not given — [CPI](https://www.competitionpolicyinternational.com/israel-the-bank-of-israel-publishes-guidelines-for-the-banks-and-credit-card-companies-for-implementation-of-the-open-banking-standard-in-israel/)
- On 27 Jan 2026 the ISA published a draft open-banking standard directive for payment companies, based on the Berlin Group standard as adapted by the Bank of Israel. It includes a developer portal and sandbox, and a footnote points to 6 Dec 2026 for advanced payment-initiation services — [Herzog Fox & Neeman](https://herzoglaw.co.il/en/news-and-insights/draft-directive-for-payment-companies-regarding-the-implementation-of-an-open-banking-standard-published-for-public-comments/)
- A law firm expected the first payment-service licences in 2025 — [Barnea Jaffa Lande](https://barlaw.co.il/08mm)
- Headline: "Bank of Israel opens payment protocol to smaller players" (title only, not read) — [Central Banking](https://www.centralbanking.com/node/2465215)

**EU**
- PSD3/PSR provisional deal on 27 Nov 2025: Verification of Payee extended, APP or impersonation-fraud refund obligations, application around 2027 (details in §4) — [Vixio](https://vixio.com/insights/pc-eu-edges-closer-new-payments-framework-psd3-and-psr-agreement); [MoFo](https://www.mofo.com/resources/insights/260430-psd3-and-the-payment-services-regulation-key-developments)

### Inferences
- **Sequence for an Israeli 1-3 branch product:**
  1. **Now:** "pay-ready" output. A list of approved amounts with disputed portions held back, i.e. pay only the undisputed part, mirroring ChatFin's pattern in §1. This is the payment-side form of the leak number.
  2. **When information-access open banking is reachable:** bank-feed reconciliation (payments made against invoices approved) to close the loop and detect paying unapproved or duplicate invoices.
  3. **2027+:** in-app payment initiation through a licensed Israeli payment initiator.

  Any payment action is "spending money", which AGENTS.md reserves for humans and Phase-6 credentials.
- Masav (bulk bank transfer) file export may be a practical interim, but this is my assumption, not sourced here.
- **Enterprise vs small.** Enterprises pay from ERP or treasury. For a small restaurant, paying from the same screen that shows "₪ held back pending credit" is a strong retention hook, but it is not the wedge.

### Gaps
- Current live status of payment-initiation APIs at Israeli banks (which banks, which services, pricing) was not established. The dates above are from drafts and law-firm summaries.
- No source on Israeli AP tools that already pay suppliers in-app.
- Bank-feed (information-access) API availability for Israeli SMB accounts was not established.

---

## 7. POS integration: theoretical vs actual food cost, recipe-level margin alerts from invoice prices

### Takeaway
Combining POS sales with invoice prices to compute **theoretical vs actual food cost**, and updating recipe or plate costs as each invoice is processed, is **shipped** in US restaurant back-office tools (MarginEdge; xtraCHEF Pro adds recipe costing). It is the natural bridge from "invoice leak" to "menu margin erosion". I found no evidence of 2025-2026 AI-specific breakthroughs here. The frontier is automation of the data plumbing, not new math.

### Cited Findings
- MarginEdge combines POS sales data with invoice data to calculate theoretical against actual costs, including beverage and liquor. It says this surfaces waste and over-portioning, and that inventory and recipe prices update as invoices are processed so plate costs stay current — [MarginEdge menu analysis](https://www.marginedge.com/menu-analysis-made-simple); [TrustRadius](https://www.trustradius.com/products/MarginEdge); [SpotOn integration](https://www.spoton.com/integrations/margin-edge/)
- A vendor-authored comparison says xtraCHEF Pro adds recipe costing and inventory but lacks bill pay and sales forecasting. It also says xtraCHEF relies on users to categorise purchases, while MarginEdge maps by item rather than vendor — [MarginEdge vs xtraCHEF](https://www.marginedge.com/blog/marginedge-vs-xtrachef-which-one-is-right-for-independent-restaurant-operators)
- Ottimate says restaurant brands use AP to improve profit and cut invoice work by 90% (company blog) — [Ottimate](https://ottimate.com/?p=8201)
- Internal: `price_history` has no writer, so the leak detective is empty (bug M1). `@restomatch/charts` owns the KPI, leak, supplier and baseline SQL — [STATE.md](/home/user/restomatch/STATE.md)

### Inferences
- **The margin alert is the "dramatize" step for the ₪ number.** "Tomato price +18% from supplier X this month × 41 kg/week in recipes × POS volume = ₪1,140/month off your margin on 6 dishes" turns a price-variance discrepancy into an owner-believable ₪ figure tied to the menu.
- The prerequisite is a working price history (M1), then a recipe or bill-of-materials layer, then a POS sales feed. The first two are internal. The POS feed needs integrations with Israeli POS systems, which were not researched.
- **1-3 branches vs enterprise.** Full theoretical-vs-actual needs inventory counts, which small owners rarely do consistently. A lighter "price-to-plate" alert (invoice price change × recipe × POS sales, no inventory count) delivers most of the ₪ insight with far less operator effort, and it is the right first version.

#### Cross-cutting capability map (maturity → relevance for a 1-3 branch Israeli restaurant → build effort for RestoMatch)
| Capability | Maturity (2025-26) | 1-3 branch relevance | What it would take |
|---|---|---|---|
| Closed-loop dispute and credit-note agent | Announced/beta (SAP beta; Spendflo/ChatFin pages; Basware Supplier Agent 2026) | **Very high**: turns surfaced ₪ into recovered ₪ | Dispute state machine, outbound templates (WhatsApp/email, human tap-to-send), credit-note matching, recovered-₪ metric |
| Field-level-confidence Hebrew extraction with arithmetic self-checks | Extraction shipped; Hebrew/handwriting unbenchmarked | High | Own Hebrew eval set, per-field crops, deterministic checks, fix M11 duplicate call |
| Allocation-number guard (Israeli CTC) | Regulation live (₪5k from 1 Jun 2026) | High: VAT-deduction ₪ at risk | Extract allocation-number field, threshold rule, auto-request to supplier |
| Supplier statement / ledger reconciliation | Shipped (Yooz, Oversight, SAP), not Hebrew or restaurant | **Very high** | Statement ingest (PDF/Excel/photo), line matching vs invoices and goods receipts, consolidated-invoice handling (task #26) |
| Bank-detail-change / BEC alert | Shipped at Ramp (US); EU VoP regulated | Medium-high | Extract supplier bank fields, history diff, block or flag |
| WhatsApp photo intake | Platform mature; per-message pricing | Very high (habit fit) | Meta WABA, number, templates; replies inside 24h window are free |
| Photo/voice receiving notes | Ad hoc; no restaurant AP leader found | High | Speech-to-text (Hebrew) into goods-receipt discrepancy evidence |
| AI scale / CV inbound receiving | Not found (outbound order-check scales only) | Low-medium (hardware) | Hardware partner; later |
| In-app supplier payment | Shipped in US; Israel payment initiation staged 2026-27 | Medium (retention, not wedge) | Licensed Israeli initiator partner; interim "pay undisputed only" list |
| Price-to-plate margin alert (POS) | Shipped in US (MarginEdge, xtraCHEF) | High | Fix price_history writer (M1), recipe layer, Israeli POS feed |

### Gaps
- Israeli POS integration landscape (APIs, data access, which POS dominate small restaurants) was not researched.
- No quantitative evidence of how accurate theoretical-vs-actual food cost is, or how much margin restaurants recover with it. Only vendor claims.
- I found no 2025-2026 AI-specific innovation in recipe-margin alerting, which may itself be an opening.
