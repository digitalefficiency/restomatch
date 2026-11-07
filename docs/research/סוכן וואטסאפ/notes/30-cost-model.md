# 30 · WhatsApp agent: verified cost model

**Date:** 2026-11-07. **Question (owner):** "Show me what our costs are for this."
**Scope:** the marginal monthly cost of the WhatsApp business-function agent per restaurant: Meta fees, LLM tokens, infra, BSP. OCR of WhatsApp photos stays in the existing OCR line of `docs/COSTS.md` and is not counted here. This is a cost line, never netted against the leak ₪.
**Calculator inputs and precomputed results:** `wa-cost-params.json` (session scratchpad; every number below comes from it).
**No model identifiers** are written here; tiers are named "small / mid / top tier of the latest Claude models"; prices are kept.

## 0. Headline

**A typical restaurant costs ≈ ₪24 a month, ≈ 4.1% of Pro's ₪590 (₪8–₪62 light→heavy at 10 restaurants; ₪15–₪65 at the 3-restaurant pilot; ₪7–₪61 at 100). Against the ₪2,250+ a month that the North Star leak surfaces for a Pro-sized restaurant, that is about 1:92.** The §E estimate (₪14 realistic) **rises to ≈ ₪24**, mainly because the tool-using answers now run on the mid tier at its verified price, and because the model now counts a fixed cost for the number. The worst case (≈ ₪65) still holds for a heavy restaurant on the default tiers. A heavy restaurant at every cap, on the top tier with no caching and with templates mis-billed as marketing, reaches ≈ ₪273. The Ask budget still caps model spend at ≈ ₪289.

## 1. Sources and verification status

Labels: **VERIFIED** = read on the vendor's own page this session. **VERIFIED (extract)** = the vendor's own page, read through a search-engine extract because `developers.facebook.com` is outside this session's network allowlist. WebFetch of that host failed with ENOTFOUND; it has to be allowed in the session's network settings before the page can be fetched directly. **SECONDARY** = third-party page. **UNVERIFIED** = single or conflicting claim. All were seen on 2026-11-07 unless stated.

| # | Fact | Value used | Status | Source |
|---|---|---|---|---|
| M1 | Billing per delivered message by category since **1 Jul 2025**, replacing conversation-based billing | — | VERIFIED (extract) + SECONDARY | https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing ; deprecated conversation page https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/conversation-based-pricing ; Twilio notice https://support.twilio.com/hc/en-us/articles/53100480177819 |
| M2 | From **1 Oct 2026**, service (non-template) messages are charged per message after **1,000 free per business phone number per month**. Free messages do not roll over; charging starts at the 1,001st. | 1,000 per number, 1 number | VERIFIED: Meta page via search extract, corroborated by Twilio (help article 53100480177819), 360dialog and the tobachat mirror | https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages |
| M3 | Service rate = the market's utility/authentication rate; **no volume tiers** on service | = utility | VERIFIED (extract) | same |
| M4 | From 1 Oct 2026, **utility templates sent inside the 24-h window are charged** | all templates billed | VERIFIED (extract) | same; Twilio's page agrees |
| M5 | Whether in-window utility messages count toward the 1,000 free | assumed **not** (conservative) | UNVERIFIED (Meta's pages are silent) | — |
| M6 | No payment method → service messages beyond the free tier are not delivered | go-live prerequisite | VERIFIED (extract) | M2 page |
| M7 | Free-entry-point window: all categories free, "up to 7 days" | not used (no ads) | VERIFIED (extract) | M2 page |
| M8 | **Israel (Meta rate card effective 1 Oct 2026, via the tobachat mirror; source: Meta pricing page, checked 27.10.2026):** marketing $0.0353, utility $0.0053, authentication $0.0053, service $0.0053. Israel is not among the Oct-2026 changed rates | base case | VERIFIED via mirror (tobachat CHANGELOG / USD.csv row Israel 0.0353/0.0053/0.0053/—/0.0053) + SECONDARY (Mumble, agentdeals, RichAutomate) | mirror of https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing |
| M9 | Conflicting Israel rows: **$0.0056 / $0.0371** ("rate card effective July 2026", GoHighLevel); **$0.0061 / $0.0406** (ManyChat table effective 1 Jan 2026, per search summary) | high-rate sensitivity uses $0.0061 | SECONDARY, conflicting | https://ideas.gohighlevel.com/changelog/updated-whatsapp-per-message-pricing-effective-july-2026 ; https://help.manychat.com/hc/en-us/articles/14281380243740 (superseded by M8; sensitivity only) |
| M10 | "Israel Q2 2026 repricing" blog (Times of Israel) | superseded: no Israel figures; Israel is not among the Oct-2026 changed rates | SUPERSEDED | https://blogs.timesofisrael.com/israels-quiet-q2-2026-bot-pricing-reset/ |
| M11 | Some BSPs pass the change on later (Salesforce: in-window utility and service charged from **1 Nov 2026**) | n/a for direct | SECONDARY | https://www.salesforce.com/en-us/wp-content/uploads/sites/4/WhatsApp-Business-Messaging-1000-Nov-2026.docx.pdf |
| B1 | **Twilio:** $0.005 per message, **inbound and outbound**, on top of Meta; ~$0.001 per failed message | $0.005 | SECONDARY (Twilio support notice + customer.io) | https://support.twilio.com/hc/en-us/articles/53100480177819 ; https://docs.customer.io/accounts/billing/whatsapp-billing/ |
| B2 | **360dialog:** flat licence per number, ~€49/$59 Regular, $99–119 Premium; no per-message markup | $59/month | SECONDARY (listing sites; no official price list found this session) | https://pricingsaas.com/companies/360dialog |
| B3 | **Gambot** from ₪179/month + VAT; **Reepli** from ₪275/month per bot; **Pulseem** ~₪200/month up to 10k messages | ₪179 | SECONDARY, carried from ext-02 (not re-checked; search returned nothing newer) | https://gambot.co.il/PriceList/ ; https://www.reepli.ai/he/resources/whatsapp-business-api-pricing/ |
| L1 | **Small tier:** $0.10 in / $0.50 out per MTok (prompts ≤ 100K tokens; $0.50/$2.50 beyond); 5-min cache write $0.125; cache read $0.01 | cheap tier | **VERIFIED** | https://platform.claude.com/docs/en/about-claude/pricing |
| L2 | **Mid tier:** $2 / $10; cache write $2.50 (5 min), $4 (1 h); **cache read $0.10 (0.05×)** | mid tier | **VERIFIED** | same |
| L3 | **Top tier:** $4 / $20; cache write $5; **cache read $0.20 (0.05×)** | top tier (never by default) | **VERIFIED** | same |
| L4 | Cache multipliers: 5-min write 1.25×, 1-h write 2×, read 0.1× on the small tier (0.05× on the mid and top tiers); Batch API −50% (not for live chat); `inference_geo: us` ×1.1 (not used) | — | **VERIFIED** | same |
| L5 | Tool-use system prompt adds 286 tokens per call (latest tiers, tool_choice auto) | in prefix | **VERIFIED** | same |
| I1 | Vercel Pro $20/seat/month with a $20 usage credit; invocations $0.60/M; Active CPU $0.128/CPU-h (iad1; region rates vary, prod runs in hnd1) | negligible marginal | SECONDARY (vercel.com not reached) | https://makerkit.dev/blog/saas/vercel-cost ; https://temps.sh/blog/vercel-pricing-2026-pro-plan-explained |
| I2 | Supabase Pro $25/org/month incl. $10 compute credit, 8 GB DB, 100 GB file storage, 250 GB egress | negligible marginal | SECONDARY (supabase.com not reached) | https://makerkit.dev/blog/saas/supabase-pricing ; https://www.jetadmin.io/blog/supabase-pricing-2026-guide-to-plans-limits-and-real-world-costs/ |
| F1 | FX: last Bank of Israel representative rate found **₪3.059/$ (5 Oct 2026)**; the dollar fell from 3.28 (Oct 2025) to 2.81 (May 2026) | model uses **₪3.7/$** (conservative, as briefed); sensitivity at 3.059 | SECONDARY | https://www.hon.co.il/ (investment guide citing BoI) |
| R1 | North Star ≥ 1.5% of food spend; ICP food spend ₪80k–₪400k/month; Pro fits ₪150k–₪400k → leak ₪2,250–₪6,000/month | — | repo | `docs/ICP.md` §1, S2; `docs/GTM.md` §2.1, pricing table; Pro = 59,000 agorot (`packages/db/src/plans.ts`) |

## 2. Assumptions (ASSUMPTION unless sourced above; replace with AU-07 telemetry within 30 days of go-live)

- **One RestoMatch number for the fleet**, direct Cloud API. The 1,000 free service messages are **shared by all tenants** (M2). With per-restaurant numbers, each would get its own 1,000 and the service line would be ≈ ₪0 below ~1,000 replies, but each number carries its own fixed cost, onboarding and quality rating. Not recommended for v1.
- **26 operating days a month.** Every template is **utility**, and every template is billed whether or not the window is open (M4).
- **Service replies:** 1.3 per free-text question, 1 per button tap, 1 per photo (acknowledgement). Inbound messages are free.
- **Model tiering:** the cheap tier routes every free-text inbound message and composes the daily brief. The mid tier answers every free-text question with tools (2 calls). **The top tier is never used by default.** Button taps, commands and photos need no model (deterministic router; photos go to the existing OCR pipeline).
- **Tokens per mid-tier answer** (2 calls): cached prefix 3,800 tokens per call (system prompt 2,000 + tool schemas 1,500 + the 286-token tool-use prompt). Dynamic input 5,150 in total (call 1: 1,500 of history and role context; call 2: 3,650, including a 2,000-token tool result). Output 800, including ~300 tokens of thinking.
- **Router call:** 1,200 cached + 300 dynamic input, 30 output. **Brief call:** 1,500 cached + 4,000 dynamic, 500 output.
- **Cache hit rate 0.7** on the static prefix. Misses pay the 5-minute write price (1.25×). The prefix is tenant-agnostic, so the whole fleet warms one cache; at pilot traffic, many requests arrive more than 5 minutes apart.
- **Infra:** the product already pays for Vercel Pro and Supabase Pro (STATE.md: production runs on both). Incremental fixed cost: **₪30/month for a dedicated Israeli number/eSIM**, amortised over the fleet. Incremental variable cost: **₪0.0005 per message** (in + out), a generous allowance covering webhook and status-callback invocations, Active CPU for the agent loop (mostly I/O wait, which Active CPU does not bill), and DB rows (~2 KB each). Media is ~300 KB per photo, so ~13.5 MB a month for a typical restaurant, far inside the 100 GB included.

### 2.1 Usage profiles (per restaurant per month)

| Profile | People | Templates (utility) | Inbound free text (→ model) | Inbound taps/commands | Inbound photos | Briefs (cheap tier) | Service replies out | All messages |
|---|---|---|---|---|---|---|---|---|
| **Light** (owner + receiver) | 2 | 50 | 40 | 40 | 15 | 26 | 107 | 252 |
| **Typical** | 5 | 119 | 148 | 120 | 45 | 26 | 357 | 789 |
| **Heavy** | 6 | 300 | 400 | 260 | 120 | 52 | 900 | 1,980 |

Typical by role:

| Role | Templates | Free text | Taps | Photos | What it is |
|---|---|---|---|---|---|
| Owner | 46 | 60 | 40 | 0 | 07:30 brief (26) + decision cards/alerts; "how much leaked from X?"; approve taps |
| Manager | 30 | 40 | 30 | 5 | blocking discrepancies, late trucks, approvals |
| Chef | 13 | 30 | 20 | 0 | cut-off reminders; "like last week" orders |
| Receiver | 26 | 10 | 26 | 40 | 06:00 trucks; delivery-note photo at the door (no ₪) |
| Bookkeeper | 4 | 8 | 4 | 0 | weekly close status, export link |

The template cap (6 per person per day) bounds templates at 6 × people × 26. Heavy at the cap is 936.

## 3. Formulas

```
serviceOut      = text × 1.3 + taps + photos
metaUsd/rest    = templates × utilityUsd + max(0, N × serviceOut − 1000 × numbers) × serviceUsd / N
callUsd         = calls × prefix × (h × cacheRead + (1−h) × cacheWrite5m) + dynamicIn × in + out × outPrice   (per 1M)
llmUsd/rest     = text × (midExchange + router) + briefs × brief
infraIls/rest   = fixedIlsMonth / N + allMsgs × perMsgIls
bspIls/rest     = direct 0 | Twilio allMsgs × $0.005 × fx | flat licence × fx / N
total₪          = (metaUsd + llmUsd) × fx + infraIls + bspIls
```

**Unit costs (base):** a mid-tier answer costs **$0.0245 ≈ ₪0.09**: prefix $0.0062 (of which cache misses $0.0057), dynamic input $0.0103, output $0.008. A router call costs $0.0001. A brief costs $0.0007. A Meta utility or service message costs $0.0053 ≈ ₪0.02.

## 4. Results: ₪ per restaurant per month (direct Cloud API, FX 3.7)

| Profile @ fleet size | Meta | LLM | Infra | BSP | **Total** | % of Pro |
|---|---|---|---|---|---|---|
| Light @ 3 (pilot) | 0.98 | 3.71 | 10.13 | 0 | **14.8** | 2.5% |
| Light @ 10 | 1.12 | 3.71 | 3.13 | 0 | **8.0** | 1.4% |
| Light @ 100 | 2.88 | 3.71 | 0.43 | 0 | **7.0** | 1.2% |
| Typical @ 3 (pilot) | 2.81 | 13.56 | 10.39 | 0 | **26.8** | 4.5% |
| Typical @ 10 | 7.38 | 13.56 | 3.39 | 0 | **24.3** | 4.1% |
| Typical @ 100 | 9.15 | 13.56 | 0.69 | 0 | **23.4** | 4.0% |
| Heavy @ 3 (pilot) | 17.00 | 36.59 | 10.99 | 0 | **64.6** | 10.9% |
| Heavy @ 10 | 21.57 | 36.59 | 3.99 | 0 | **62.2** | 10.5% |
| Heavy @ 100 | 23.34 | 36.59 | 1.29 | 0 | **61.2** | 10.4% |

**Fleet totals (all typical):** 3 restaurants ≈ **₪80/month**; 10 ≈ **₪243**; 100 ≈ **₪2,340** (against ₪59,000 of Pro revenue).
**Readings.** The LLM is the largest line in every profile from 10 restaurants up. At pilot, the ₪30 number dominates the light profile. The shared free tier covers the whole pilot when usage is light (3 × 107 < 1,000) but not when it is typical (3 × 357 = 1,072). By 100 restaurants, almost every service reply is paid, so Meta's line rises by ~₪6 per typical restaurant between pilot and scale.

## 5. Sensitivities (total ₪ per restaurant per month)

| Scenario | Light @10 | Typical @3 | Typical @10 | Typical @100 | Heavy @10 |
|---|---|---|---|---|---|
| **Base** | 8.0 | 26.8 | 24.3 | 23.4 | 62.2 |
| Every model call on the mid tier (router and brief too) | 9.5 | 29.0 | 26.6 | 25.7 | 67.4 |
| Cache always misses (h = 0, write premium paid) | 9.9 | 33.8 | 31.4 | 30.5 | 81.2 |
| Caching off (no write premium) | 9.3 | 31.7 | 29.3 | 28.4 | 75.5 |
| **Mid-tier output ×2 / ×3** | 9.1 / 10.3 | 31.1 / 35.5 | 28.7 / 33.1 | 27.8 / 32.2 | 74.0 / 85.8 |
| Service replies free (pre-1.10.2026 rule) | 7.8 | 26.3 | 19.3 | 16.6 | 46.5 |
| Every call on the top tier, uncached | 19.7 | 61.6 | 59.1 | 58.2 | 154.0 |
| **Templates billed as marketing by mistake** ($0.0353) | 13.5 | 40.0 | 37.5 | 36.6 | 95.5 |
| Meta high rates ($0.0061 utility/service) | 8.1 | 27.2 | 25.5 | 24.8 | 65.4 |
| FX ₪3.059/$ (last BoI rate found) | 7.1 | 23.9 | 20.7 | 19.5 | 52.1 |
| **BSP: Twilio** (+$0.005 per message in and out) | 12.6 | 41.4 | 38.9 | 38.0 | 98.8 |
| BSP: 360dialog ($59/number/month, fleet-shared) | 29.8 | 99.5 | 46.2 | 25.6 | 84.0 |
| BSP: Gambot (₪179/month, fleet-shared) | 25.9 | 86.4 | 42.2 | 25.2 | 80.1 |

**Extreme case:** a heavy restaurant at the template cap (936), every call on the top tier uncached, at pilot scale, costs **≈ ₪169**. If its templates are also mis-billed as marketing, it costs **≈ ₪273** (46% of Pro). It is bounded by the Ask budget (≈ $3/day ≈ ₪333/month over 30 days; the meter prices every token at the top-tier rate, `budget.ts:19-21`) and by the AU-07/WA-11 per-restaurant daily cap.

**Like-for-like worst case:** typical usage at the template cap (780 = 5 people × 6 × 26), every call on the top tier uncached: **≈ ₪72–75** (₪74.8 / 72.4 / 71.5 at 3 / 10 / 100). Heavy on default tiers (₪61–65) is a different scenario. Alert at ≈ ₪75 for typical, or per profile.

*Footnote:* if in-window utility templates were also free under the old rule, typical@10 would be ₪17.0.

What moves the number most, in order: **model tier** (top tier ≈ 2.4× the base), **template category** (marketing ≈ +₪13 for a typical restaurant), **a BSP at pilot scale** (a flat licence ≈ +₪60–73 per restaurant when only 3 share it), **mid-tier output length** (×2 → +₪4.4, ×3 → +₪8.8: pin effort low/medium on WA answer calls and measure output tokens in AU-07), **caching** (+₪5 to +₪7), FX (−15%). Meta rate drift between the conflicting secondary rows is noise (< ₪1.5 typical, ≈ ₪3 heavy).

## 6. Against the ₪ the product surfaces

North Star leak = 1.5% of food spend (`docs/ICP.md`, `docs/GTM.md`):

| Food spend / month | Leak surfaced | Light (₪8) | Typical (₪24) | Heavy (₪62) |
|---|---|---|---|---|
| ₪80k (ICP floor) | ₪1,200 | 1:151 | 1:49 | 1:19 |
| ₪150k (Pro floor) | ₪2,250 | 1:283 | 1:92 | 1:36 |
| ₪250k | ₪3,750 | 1:471 | 1:154 | 1:60 |
| ₪400k | ₪6,000 | 1:754 | 1:247 | 1:97 |

(Ratios at 10 restaurants. Heavy usage comes from bigger kitchens, so the heavy column mostly pairs with the larger spend rows.) As a share of Pro: **≈ 1–2.5% light, ≈ 4–4.5% typical, ≈ 10–11% heavy.** Pro stays ≥ 75% gross margin for light and typical; heavy (₪61–65) drops to ≈ 73–74% at `docs/COSTS.md`'s ~$25 midpoint, so watch heavy tenants in AU-07. `docs/COSTS.md` itself is stale (ARPU ₪400, a $1 WhatsApp line): flag for a leak-economist refresh.

## 7. Reconciliation with §E of 10-design-and-plan.md

| §E said | This model | Why |
|---|---|---|
| Realistic ≈ **₪14** at pilot, ≈ ₪21 at 100 | Typical ≈ **₪27 at pilot, ₪24 at 10, ₪23 at 100** | (1) Tool-using answers run on the **mid tier** at its verified $2/$10, not 80% on a "$1/$5 small tier" (that is an older small-tier price; the current small tier is $0.10/$0.50, so §E's small tier was really a mid-tier mix). (2) A **₪30 fixed number cost** is now counted, ₪10 per restaurant at pilot. (3) A thinking allowance in output. Partly offset by verified cache reads at **0.05×** (not 0.1×) on the 5.5 Sonnet and Opus tiers. The 100-restaurant figure barely moves because the fixed cost amortises. |
| ~200 model exchanges | 148 (typical) | Taps, commands and photos are routed deterministically. |
| LLM ≈ ₪9 | ₪13.6 typical | as above |
| Worst ≈ **₪65** (top tier, uncached, cap) | Like-for-like (typical, template cap 780, top tier uncached) **≈ ₪72–75**; heavy on default tiers ≈ ₪61–65 is a different scenario | §E's worst was understated |
| Hard ceiling = Ask budget ≈ ₪289 | **≈ ₪333** (30 days × $3 × 3.7; metered at the top-tier rate); the model's extreme case is ₪273 | §E used 26 days |
| 2–4% of Pro realistically | **≈ 4%** typical, 1–2.5% light | the realistic share moves to the top of §E's range |

**Recommended edit to §E** (for a human or the leak-economist, not made here): change "Realistic ≈ ₪14 … ≈ ₪21 at 100" to "Typical ≈ ₪24 (₪8–₪62 light→heavy at 10), ≈ 4.1% of Pro" (done: §E now points here). Replace the "$1/$5 small tier" with the verified tier prices. Note the 0.05× cache read on the mid and top tiers.

## 8. Recommendation

1. **Go direct Cloud API** (WD1 confirmed). A BSP adds +55% (Twilio) to +270% (360dialog) per restaurant at pilot scale. Twilio's per-message tax stays +55–62% at every scale. A flat licence only stops hurting near 100 restaurants.
2. **Tier strictly:** the cheap tier for routing and briefs, the mid tier for tool answers, the top tier off by default (escalation only, metered). Keep the tool-schema and system prefix **tenant-agnostic and byte-stable** so the fleet shares one warm cache. Consider the 1-hour cache write (2×) if AU-07 shows a hit rate below ~50% at pilot traffic.
3. **Keep templates strictly utility.** No promo line. Subscribe to `template_category_update`. This is the single cheapest risk to remove (+₪13 per typical restaurant).
4. **Put a payment method and a balance alert on the WhatsApp account before go-live.** The shared 1,000 free replies run out at about the third typical restaurant.
5. **Budget line for `docs/COSTS.md`** (leak-economist): ₪25 per restaurant per month (typical, rounded up), alert at ₪65, hard stop by the Ask budget. Re-price after 30 days of AU-07 telemetry.
6. **Open items:** the Israel row is now taken from Meta's 1.10.2026 card via the tobachat mirror (closed). Still open: whether in-window utility counts against the 1,000 free messages. Check the Vercel hnd1 regional rates and the current BoI rate.
