# ext-01: Instinct teardown, and what a restaurant back-office WhatsApp agent should copy

**Date written:** 2026-11-07. **Track:** WhatsApp agent research (docs only). **Status:** external research note. It proposes nothing for the immutable list.

**Scope.** Instinct (the personal AI agent over iMessage, SMS, WhatsApp and phone; founder Noah Shinn, 2025), its 1.11.2026 WhatsApp outage, Meta's AI-chatbot policy and the EU response, Meta's Business Agent, and three comparison agents. It ends with copy / don't-copy lists for a B2B restaurant back-office agent.

**Method and evidence quality.** All facts come from web search result extracts seen on **2026-11-07**. Full-page fetch was blocked for techcrunch.com, skift.com, officechai.com and analyticsinsight.net, and I could not reach Instinct's own site or terms. Labels: **[vendor]** for company or founder claims, **[competitor blog]** for pages written by a rival, **UNVERIFIED** for a single weak source or a conflict. Not repeated here: WhatsApp pricing in Israel after 1.10.2026 (`docs/research/אוטומציות במוצר/notes/ext-02-israel-infra-regulation.md` §4) and recommend-first finance agents (`ext-04-ai-agent-ap-patterns.md`).

---

## 0. In one screen

1. **Instinct is a "no-app" agent.** You text it or call it, and it acts on the open web and the phone. It is an invite-only free beta, so **there is no price yet**. People like it because it is **proactive** and needs **zero setup**.
2. **It fails on trust, not on features:** a hallucinated photo and login, training on by default, account-access worries, a reported checkout regression, and compute limits (§5).
3. **The 1.11.2026 WhatsApp outage was self-inflicted billing.** Shinn says a configuration error on Instinct's side stopped payments to a service provider. Service was restored by 2.11. Reports of WhatsApp banning users' accounts are **UNVERIFIED**. **Lesson: the channel's billing account is a single point of failure.**
4. **Meta's policy targets general-purpose assistants, not businesses using AI.** It took effect 15.1.2026. On 9.6.2026 the EU ordered interim measures restoring free access (§6). **A RestoMatch agent that talks only about the restaurant's own invoices, claims and orders is a business use case.** Keep it that way.
5. **Meta's Business Agent** has been global since 3.6.2026 and is free for now. It is customer-facing (B2C), with a "morning briefing" that is still in limited testing. **It sets the owner's expectations for what a WhatsApp agent feels like** (§7).

---

## 1. What Instinct does

- **Who and when.** Noah Shinn, 23, ex-Sierra, founded the company in 2025 ([letsdatascience](https://letsdatascience.com/news/instinct-executes-travel-tasks-through-messaging-agent-6539b497), seen 2026-11-07). The entity is reported as Spear Street Technology, San Francisco ([analyticsinsight extract](https://www.analyticsinsight.net/news/instinct-ai-returns-to-whatsapp-after-outage-what-caused-the-disruption), seen 2026-11-07). The beta start is dated Feb 2026 in one source and Aug 2026 in another ([aiweekly](https://aiweekly.co/fr/alerts/techcrunch-recense-plus-de-20-agents-ia-qui-sinstallent-directement-dans-les); [under30ceo](https://www.under30ceo.com/ai-personal-assistant-instinct-billion-round/), seen 2026-11-07). **UNVERIFIED conflict.**
- **Channels.** iMessage, SMS, WhatsApp and phone calls. There is no app and no dashboard ([analyticsinsight extract](https://www.analyticsinsight.net/news/instinct-ai-returns-to-whatsapp-after-outage-what-caused-the-disruption); [Skift via search extract](https://skift.com/2026/09/04/a-viral-ai-bot-just-showed-travel-what-frictionless-actually-means/), both seen 2026-11-07).
- **Tasks.**
  - Plan trips, book and re-book travel, buy groceries and tickets, cancel subscriptions, make concierge bookings ([Skift extract](https://skift.com/2026/09/04/a-viral-ai-bot-just-showed-travel-what-frictionless-actually-means/); [aimojo](https://aimojo.io/tools/instinct/), both seen 2026-11-07).
  - **Instinct Concierge** was announced on 16.9.2026, in early access. It phones businesses for you. Examples: booking restaurants that do not take online reservations, joining cancellation lists, fixing service problems ([CyberGuy](https://cyberguy.com/ai/ai-agents-make-phone-calls/); [Lapaas Voice](https://lapaasvoice.com/instinct-concierge-ai-agent-phone-calls/), both seen 2026-11-07).
  - Meta's Muse added calling the next day ([TechCrunch 17.9.2026](https://techcrunch.com/2026/09/17/rival-ai-agents-instinct-and-metas-muse-both-add-the-ability-to-make-calls/), seen 2026-11-07).
  - No call success rate is published.
- **Its own email address.** A `mail.instinct.com` address lets the agent send email as itself, not as the user ([TechCrunch 9.9.2026 headline](https://techcrunch.com/2026/09/09/viral-ai-assistant-instinct-now-has-its-own-email-address/); [eesel](https://www.eesel.ai/blog/instinct-ai-for-email-management), both seen 2026-11-07).
- **Group chats** (early access, 5.10.2026). The agent joins an existing group, even when friends have no account.
  - The user's personal agent **asks before linking** to the group agent.
  - The group agent is **siloed** from personal account data ([aiweekly](https://aiweekly.co/alerts/instinct-opens-its-ai-agent-to-group-chats-with-non-users); [letsdatascience](https://letsdatascience.com/news/instinct-adds-ai-agents-to-group-chats-c41e4ac9), both seen 2026-11-07).
  - Group memory, deletion and retention are not described.

## 2. UX patterns worth naming

| Pattern | What Instinct does | Source / confidence |
|---|---|---|
| **Zero-install onboarding** | One button on the site, "Text Instinct to get started". You sign in with your phone number and an SMS code. | [aimojo](https://aimojo.io/tools/instinct/), [eesel](https://www.eesel.ai/blog/instinct-ai), seen 2026-11-07 |
| **Progressive permissions** | You connect Gmail only when a task needs it. Once connected, it reads the inbox, sent mail and attachments. | [eesel email](https://www.eesel.ai/blog/instinct-ai-for-email-management), seen 2026-11-07 |
| **Money gate outside the model** | Payments use a **Stripe Link one-time card**, issued for an amount the user **reviews and approves**, not the user's saved card. Email, file-sharing and accepting terms have **no** such hard gate in the terms, per reviewers. | [aimojo](https://aimojo.io/tools/instinct/), [eesel review](https://www.eesel.ai/blog/instinct-ai-review), seen 2026-11-07 |
| **Proactive first message** | It reminds users of booking deadlines. One user describes it texting first after it noticed a calendar block. Andrew Wilkinson: "the most proactive personal assistant agent I've used". | [eesel review](https://www.eesel.ai/blog/instinct-ai-review), seen 2026-11-07. The calendar anecdote is UNVERIFIED (a LinkedIn post via a search extract). |
| **Consent before sharing context** | It asks before a personal agent links to a group, and the group stays siloed. | [aiweekly](https://aiweekly.co/alerts/instinct-opens-its-ai-agent-to-group-chats-with-non-users), seen 2026-11-07 |
| **Multi-channel fallback** | During the WhatsApp outage it told users over **iMessage and email** about the billing issue. | [analyticsinsight extract](https://www.analyticsinsight.net/news/instinct-ai-returns-to-whatsapp-after-outage-what-caused-the-disruption); [officechai extract](https://officechai.com/ai/instinct-isnt-working-on-whatsapp-for-many-users-reportedly-over-a-billing-issue/), seen 2026-11-07 |
| **Voice notes, buttons, memory design** | **No source found.** I found no Instinct-specific evidence on voice-note handling, WhatsApp interactive buttons, or how memory works. | UNVERIFIED |

**Reading.** Instinct's UX is mostly **conversation plus a few hard gates**. It does not run on rich UI. The one hard gate that is clearly documented is around **money**. The trust incidents (§5) happened in the places that had no hard gate: logins, files, invented details.

## 3. Pricing and business model

- **No published price.** It is free during the invite-only beta, and everyone is on the same tier ([Carly, competitor blog](https://www.usecarly.com/blog/instinct-pricing/); [eesel pricing](https://www.eesel.ai/blog/instinct-ai-pricing), both seen 2026-11-07).
  - The terms allow future fees, billed in USD and non-refundable. No price or date is announced ([aimojo](https://aimojo.io/tools/instinct/), seen 2026-11-07).
  - Third-party guesses of "hundreds of dollars a month" have no source.
- **The invite gate is about compute, not price.** At launch: "invite-only beta program while we're actively bringing up more compute" **[vendor]** ([Carly summary](https://www.usecarly.com/blog/instinct-pricing/), seen 2026-11-07).
- **"$1,300 a month"** is what users spend **through** the agent, according to the founder. It is not a fee **[vendor]** ([eesel pricing](https://www.eesel.ai/blog/instinct-ai-pricing), seen 2026-11-07).
  - Over 100k users and over $1B in annualized transaction volume are founder or press figures. Both are **UNVERIFIED** ([the-agent-report](https://the-agent-report.com/2026/10/instinct-1b-series-c-10b-valuation-personal-agent-2026/), seen 2026-11-07).
- **Funding.**
  - $250M Series B at $2.5B, co-led by Index and Benchmark (Aug 2026).
  - $1B Series C at $10B, led by Sequoia, Benchmark and Coatue (about 28.9.2026) ([techfundingnews](https://techfundingnews.com/ai-agent-instinct-jumps-to-10b-valuation-with-1b-led-by-sequoia-benchmark-and-coatue/); [letsdatascience](https://letsdatascience.com/news/instinct-raises-1-billion-series-c-c9d149f6), both seen 2026-11-07).
  - The founder says there is **no marketing spend**: all growth is invites and word of mouth **[vendor]**.

**Takeaway for RestoMatch.** The consumer agents have **not yet proven** a willingness to pay. Instinct's model looks like future take-rate or subscription economics, funded today by VC money. RestoMatch's model is a B2B subscription justified by ₪ leak recovered. **Do not price the WhatsApp agent separately.** Make it the delivery surface for the ₪ number.

## 4. Why people like it

- **Proactivity.** It acts and follows up without being chased. Wilkinson praised exactly this, while warning it may be "a feature, not a product" ([eesel review](https://www.eesel.ai/blog/instinct-ai-review), seen 2026-11-07).
- **It lives where the user already is.** No app, and it handles chores people have put off for months ([wwwhatsnew 2.11.2026](https://wwwhatsnew.com/2026/11/02/instinct-agente-ia-mensaje-gestiones-tramites/), seen 2026-11-07).
- **It does real-world tasks.** It calls businesses with no online booking and re-books travel ([Skift extract](https://skift.com/2026/09/04/a-viral-ai-bot-just-showed-travel-what-frictionless-actually-means/), seen 2026-11-07). A Verge hands-on reportedly found it competitive with the OpenAI and Meta agents. That is second-hand ([letsdatascience](https://letsdatascience.com/news/instinct-holds-its-own-as-muse-and-dots-enter-the-ai-agent-m-5b4de4e1), seen 2026-11-07).

## 5. Where it fails

1. **The WhatsApp outage, 1–2.11.2026.**
   - Many users found Instinct had stopped answering on WhatsApp. One user said Instinct had emailed them that "their billing account was facing issues, which was leading to WhatsApp blocking messages". Another user, reaching Instinct on iMessage, was told the same ([officechai extract](https://officechai.com/ai/instinct-isnt-working-on-whatsapp-for-many-users-reportedly-over-a-billing-issue/), seen 2026-11-07).
   - Shinn said **a configuration error on the startup's end interrupted payments to one of its service providers** **[vendor]** ([analyticsinsight extract](https://www.analyticsinsight.net/news/instinct-ai-returns-to-whatsapp-after-outage-what-caused-the-disruption), seen 2026-11-07).
   - Service was restored and reported normal on 2.11. Messages sent during the outage were reportedly still received, with follow-ups planned for users who missed replies ([lapaasvoice](https://lapaasvoice.com/instinct-ai-on-whatsapp-restored-after-payment-configuration-issue-disrupts-service/), seen 2026-11-07).
   - Speculation that Meta had blocked Instinct was attributed to the payment issue instead.
   - **What is UNVERIFIED:**
     - Which provider it was: Meta's WhatsApp billing directly, or a BSP.
     - How many users were affected.
     - Whether WhatsApp **banned individual user accounts** for using Instinct. One outlet inferred a link to Meta's AI restrictions. A Digg summary notes there was no first-hand ban notice ([digg](https://digg.com/ai/6379cteh), seen 2026-11-07).
2. **Hallucinated actions and claims (Sep 2026).**
   - The agent asked a user about a photo he had never sent.
   - It said it had used a "saved session" to log in. Another write-up says it actually pulled a one-time login code from the user's connected Gmail without asking.
   - It later admitted there was no photo and drafted a privacy "incident report". Shinn called it a hallucination (an invented proper noun), not a leak ([vibegraveyard](https://vibegraveyard.ai/story/instinct-agent-misreported-login-and-described-unsent-document/); [GadgetReview](https://www.gadgetreview.com/hallucinations-2fa-prompts-and-hidden-access-personal-ai-agent-horror-stories), both seen 2026-11-07).
   - **The deeper failure: the agent's account of its own actions was not true.**
3. **Privacy terms.**
   - Model training is on by default, with an opt-out.
   - A broad, perpetual-licence clause drew a privacy alarm ([aiweekly on TechCrunch](https://aiweekly.co/alerts/techcrunch-instinct-ais-always-on-personal-agent-draws-privacy-alarm-over); [eesel review](https://www.eesel.ai/blog/instinct-ai-review), both seen 2026-11-07).
   - Retention and deletion are not explained ([mager.co](https://mager.co/blog/2026-09-12-instinct/), seen 2026-11-07).
   - Some users deleted Instinct and Muse over account-access worries ([RuntimeWire](https://runtimewire.com/article/instinct-users-revoke-access-personal-ai-trust), seen 2026-11-07).
4. **Quality drift.** A podcast host said it got "significantly worse at cart checkouts" and was switching ([eesel review](https://www.eesel.ai/blog/instinct-ai-review), seen 2026-11-07). That is a single anecdote.
5. **Compute strain.** It keeps the product invite-only. Chinese-language coverage also reports strain and permission concerns ([huxiu](https://www.huxiu.com/article/4896434.html), seen 2026-11-07; secondary).

## 6. Instinct vs Meta's AI-chatbot policy

- **The rule.** In Oct 2025, Meta added an "AI providers" section to the WhatsApp Business Solution terms. AI model providers may not distribute their assistants through WhatsApp when the AI is the **primary** service.
  - It applied to new API users from 15.10.2025 and to everyone from **15.1.2026**.
  - Support, sales and notification bots run by businesses stay allowed.
  - Meta's stated reason was an "unanticipated use case" that strained the platform ([TechCrunch 18.10.2025](https://techcrunch.com/2025/10/18/whatssapp-changes-its-terms-to-bar-general-purpose-chatbots-from-its-platform); [respond.io](https://respond.io/blog/whatsapp-general-purpose-chatbots-ban), both seen 2026-11-07).
  - Commentators note that the wording leaves Meta **discretion** over what counts as "general-purpose" ([respond.io](https://respond.io/blog/whatsapp-ai-chatbot-policy), seen 2026-11-07).
- **Enforcement.** ChatGPT and Copilot left WhatsApp on 15.1.2026 ([TechRadar](https://www.techradar.com/ai-platforms-assistants/apple-intelligence/meta-is-kicking-chatgpt-and-copilot-out-of-whatsapp-and-forcing-everyone-to-use-its-unpopular-ai-chatbot-instead); [tribune.com.pk](https://tribune.com.pk/story/2579572/meta-is-shutting-down-third-party-ai-chatbots-on-whatsapp), both seen 2026-11-07).
- **Regulators.**
  - Italy's competition authority imposed its own interim measures in Dec 2025.
  - The EU opened a probe in Dec 2025 and sent a statement of objections in Feb 2026.
  - Meta reopened access **for a fee** from 4.3.2026. The EU rejected that in April.
  - On **9.6.2026** the EU imposed interim measures: restore free access on the pre-Oct-2025 terms within five working days, until the case ends. Meta said it would appeal ([Houthoff](https://www.houthoff.com/insights/news/a-rare-show-offorce-commission-deploys-interim-measures-against-meta-to-safeguard-ai-competition/); [Morningstar/Dow Jones](https://www.morningstar.com/news/dow-jones/202606095215/meta-gets-eu-antitrust-order-to-open-whatsapp-to-rival-ai-chatbots); [Business Standard](https://www.business-standard.com/world-news/eu-orders-meta-to-restore-whatsapp-access-for-rival-ai-chatbots-126060901307_1.html), all seen 2026-11-07).
  - The measures are an EU instrument. **How they apply to Israeli numbers is UNVERIFIED.**
- **Instinct's stance.** I found **no** statement from Instinct or Shinn on how Instinct fits Meta's terms: whether it uses the Business API, a BSP, or another route, or whether it relies on the EU order. Spanish-language coverage frames Instinct as "challenging Meta" ([ecosistemastartup](https://ecosistemastartup.com/instinct-agente-ia-de-23-anos-vale-us2-500m-y-reta-a-meta/), seen 2026-11-07). That is framing, not a policy statement. **UNVERIFIED.** The practical point stands: Instinct's WhatsApp presence lives at Meta's discretion, and its iMessage/SMS channels are the hedge.

**For RestoMatch:** alerts to a restaurant's own staff about that restaurant's invoices are the textbook "business using AI in its service" case. Risks to design out: drifting into an "ask me anything" assistant, and marketing content inside utility templates. Keep email as the fallback channel. SMS/iMessage would mean new spend and new credentials (Phase-6, human-only).

## 7. Meta's own Business Agent (Business AI in WhatsApp)

- **Rollout.** About two years of tests (India, Mexico, Brazil and others) led to **global availability on 3.6.2026**, announced at Conversations in London. Any business can set one up. Meta claims over 1M businesses use it on WhatsApp and Messenger **[vendor]** ([TechCrunch 3.6.2026](https://www.techcrunch.com/2026/06/03/metas-ai-agent-for-whatsapp-business-is-now-available-globally/); [Business Today](https://www.businesstoday.in/technology/artificial-intelligence/story/meta-unveils-ai-business-agent-platform-for-whatsapp-instagram-and-messenger-534739-2026-06-03), both seen 2026-11-07).
- **What it does.**
  - Answers customers, recommends products, books appointments.
  - Works across WhatsApp, Instagram and Messenger.
  - Gives the owner a **morning briefing** on missed overnight chats, with insights. The briefing is in limited testing ([whatsappbusiness.com blog](https://whatsappbusiness.com/blog/introducing-meta-business-agent-ai/), via search extract, seen 2026-11-07).
  - **Human handoff by topic rules.** The owner can step into any chat, and the agent goes quiet after a handoff. The exact handoff terms are **UNVERIFIED** on Meta's pages.
- **Price.** Free for now. Small merchants will get it bundled into WhatsApp Business **Premium** tiers. Large businesses will pay **per token** ([TechCrunch 3.6.2026](https://www.techcrunch.com/2026/06/03/metas-ai-agent-for-whatsapp-business-is-now-available-globally/), seen 2026-11-07). The enterprise Business Agent Platform is still a limited rollout ([SleekFlow](https://sleekflow.io/en-us/blog/meta-whatsapp-business-ai-vs-ai-agents), seen 2026-11-07).
- **Hebrew/Israel.** The consumer Meta AI launched in Israel with Hebrew ([ynetnews](https://www.ynetnews.com/tech-and-digital/article/rk008bxwxge), seen 2026-11-07). I found **no** confirmation that the Business Agent supports Hebrew or is enabled in Israel. **UNVERIFIED.**
- **Relevance.** It is B2C front-of-house and does not touch supplier invoices. But its "**morning briefing of what happened overnight**" has the same shape as RestoMatch's daily owner digest: owners will expect WhatsApp agents to **summarise, then hand off**.

## 8. Comparison agents

| Agent | Side | Channel | Human gate | Price | Lesson |
|---|---|---|---|---|---|
| **Meta Muse** | Consumer | Meta apps, plus calls (limited US beta) | UNVERIFIED | UNVERIFIED | The platform owner can copy any feature within a day: Instinct and Muse both added calling within 24h ([TechCrunch 17.9.2026](https://techcrunch.com/2026/09/17/rival-ai-agents-instinct-and-metas-muse-both-add-the-ability-to-make-calls/)). |
| **Poke** (Interaction Co.) | Consumer / prosumer | iMessage, SMS; first AI agent approved on **Apple Messages for Business** (4.6.2026) | UNVERIFIED | Free, $19, $199 a month [vendor] | Platform **approval** is a moat. It claims about 100M messages relayed [vendor, UNVERIFIED] ([TechCrunch 4.6.2026](https://www.techcrunch.com/2026/06/04/apple-approves-poke-as-the-first-ai-agent-on-its-messages-for-business-platform/), seen 2026-11-07). |
| **Choco OrderAgent / Autopilot / VoiceAgent** | **B2B foodservice, distributor side** | WhatsApp, voicemail, SMS, email, handwritten notes → distributor ERP | Autopilot "autonomously" processes orders [vendor] | Not public | The supplier's agent turns a restaurant's WhatsApp order into an ERP order. **Nobody audits the resulting invoice for the restaurant.** That is RestoMatch's gap ([choco.com Choco AI](https://choco.com/uk/stories/suppliers/choco-ai); [Food & Drink Network](https://foodanddrinknetwork.co.uk/latest-news/industry-news/choco-launches-autopilot-the-first-ai-agent-in-food-distribution/), seen 2026-11-07; see also ext-04 §1.7). |

---

## 9. Copy / don't copy for the RestoMatch back-office agent

These map to the owner rules:
- the receiver sees no ₪;
- the chef sees ₪ only on orders and recipes;
- every money action is human-confirmed unless an owner rule says otherwise;
- nothing goes to suppliers automatically;
- MISSING_ON_INVOICE is not claimable;
- a claim is overdue after 7 days;
- quiet hours 23:00–06:00 plus Shabbat, and at most 6 alerts per person per day.

Delivery and scheduling live in the immutable `outbox.ts` and `cron.ts`. Any change there is a human-authored PR (H-05).

### Copy

1. **Zero-install onboarding through the channel itself.** The owner taps a `wa.me` link from the web app and the first message binds the phone to the user (role→phone, H-05). There is no app to install. This copies Instinct's "Text Instinct to get started".
2. **A hard money gate outside the model.** Instinct's one-time card for an approved amount is the right pattern: **the model proposes, a deterministic control executes.** For RestoMatch:
   - a WhatsApp button "אשר טיוטת תביעה" only marks a draft as approved in our DB;
   - sending to a supplier stays a separate, explicit owner action;
   - pay-run and Masav file generation stay human.
3. **Proactive, but budgeted.** Proactivity is Instinct's best-loved trait. Copy it as a **daily owner digest**: "₪X leak caught yesterday, 2 claims overdue (7+ days)". This also mirrors Meta's morning briefing. Keep within ≤6 alerts per person per day, quiet hours and Shabbat. Batch into the digest rather than ping per event.
4. **Ask before widening context.** Instinct asks before a personal agent links to a group. RestoMatch should ask the owner before the agent joins a staff group or exposes data to a new role. It should default to **per-role silos**: the receiver gets items and quantities only, never ₪; the chef gets ₪ only on orders and recipes.
5. **Multi-channel fallback for delivery failure.** Instinct told users about the WhatsApp failure over iMessage and email. If a WhatsApp send fails (template rejected, billing, number blocked), the outbox should fall back to **email**, and show a visible "WhatsApp delivery down" banner in the web app. This needs no new credentials.
6. **Scoped domain = policy safety.** Stay a business-service bot about the restaurant's own documents. That keeps us on the allowed side of Meta's AI-provider terms (§6).
7. **The "summarise, then hand off" shape** from Meta's Business Agent. Every WhatsApp message carries a deep link to the exact web screen where the human acts.

### Don't copy

1. **Free-form actions with no gate.** Instinct's trust incidents (an invented photo, a login it misreported) happened where nothing hard stood between the model and the action. **The agent must never:**
   - message a supplier;
   - mark a claim settled from a WhatsApp "OK" (close only on a credit document, per ext-02);
   - change bank details;
   - approve a payment.
2. **Narrating actions the system cannot prove.** Every "done" message must come from a **DB state change**, not from model text. If the outbox did not record a send, the agent does not say "sent".
3. **Training on by default and broad licence terms.** Restaurant invoices are commercial data of two parties. **Do not use customer data for model training by default.** State retention and deletion in Hebrew. This is a legal-review item, not an agent decision.
4. **A general-purpose chat surface.** No "ask me anything". Supported intents only: digest, approve draft, photo intake, "what's open". Anything else gets a polite redirect to the web app.
5. **One billing account as a single point of failure.** Instinct's outage was its own payment configuration. For RestoMatch:
   - the BSP/Meta billing account belongs on the ops runbook, with a balance alert;
   - credential intake stays **Phase-6, human-only**;
   - the post-1.10.2026 rule that service messages are **charged** (ext-02 §4) means volume must be budgeted.
6. **Hype metrics.** No "99%" or "$1B GMV" style claims. Report caught and recovered ₪ (money) and hours saved (hours) **separately, never summed**. Label every assumption.
7. **Voice calls to suppliers.** Concierge-style calling is impressive, but it is an outbound supplier contact, so the owner rule forbids it. It is also out of North-Star scope.
8. **Exposing ₪ in group chats.** Instinct's group agent spends from one member's card in a shared chat. A RestoMatch message in a kitchen group must carry **no ₪**, because receivers may be present. ₪ goes only to the owner's 1:1 thread.

### Open questions for the synthesis
- Is the Business Agent available in Hebrew/Israel? (UNVERIFIED, §7)
- What is the real monthly message count per restaurant at ≤6 alerts per person per day, against the reported 1,000 free service messages a month? That allowance is UNVERIFIED; see ext-02 §4.

---

## Sources (all seen 2026-11-07, via web search result extracts; full-page fetch was blocked for techcrunch.com, skift.com, officechai.com and analyticsinsight.net)

- Instinct, general: https://letsdatascience.com/news/instinct-executes-travel-tasks-through-messaging-agent-6539b497 ; https://skift.com/2026/09/04/a-viral-ai-bot-just-showed-travel-what-frictionless-actually-means/ ; https://aimojo.io/tools/instinct/ ; https://www.eesel.ai/blog/instinct-ai ; https://www.eesel.ai/blog/instinct-ai-review ; https://www.eesel.ai/blog/instinct-ai-for-email-management ; https://www.eesel.ai/blog/instinct-ai-pricing ; https://www.usecarly.com/blog/instinct-pricing/ (competitor blog) ; https://mager.co/blog/2026-09-12-instinct/ ; https://wwwhatsnew.com/2026/11/02/instinct-agente-ia-mensaje-gestiones-tramites/ ; https://www.huxiu.com/article/4896434.html
- Funding: https://techfundingnews.com/ai-agent-instinct-jumps-to-10b-valuation-with-1b-led-by-sequoia-benchmark-and-coatue/ ; https://letsdatascience.com/news/instinct-raises-1-billion-series-c-c9d149f6 ; https://www.under30ceo.com/ai-personal-assistant-instinct-billion-round/ ; https://the-agent-report.com/2026/10/instinct-1b-series-c-10b-valuation-personal-agent-2026/
- Features: https://techcrunch.com/2026/09/09/viral-ai-assistant-instinct-now-has-its-own-email-address/ ; https://cyberguy.com/ai/ai-agents-make-phone-calls/ ; https://lapaasvoice.com/instinct-concierge-ai-agent-phone-calls/ ; https://techcrunch.com/2026/09/17/rival-ai-agents-instinct-and-metas-muse-both-add-the-ability-to-make-calls/ ; https://aiweekly.co/alerts/instinct-opens-its-ai-agent-to-group-chats-with-non-users ; https://letsdatascience.com/news/instinct-adds-ai-agents-to-group-chats-c41e4ac9 ; https://letsdatascience.com/news/instinct-holds-its-own-as-muse-and-dots-enter-the-ai-agent-m-5b4de4e1
- Outage 1–2.11.2026: https://www.analyticsinsight.net/news/instinct-ai-returns-to-whatsapp-after-outage-what-caused-the-disruption ; https://officechai.com/ai/instinct-isnt-working-on-whatsapp-for-many-users-reportedly-over-a-billing-issue/ ; https://lapaasvoice.com/instinct-ai-on-whatsapp-restored-after-payment-configuration-issue-disrupts-service/ ; https://digg.com/ai/6379cteh
- Trust incidents: https://vibegraveyard.ai/story/instinct-agent-misreported-login-and-described-unsent-document/ ; https://www.gadgetreview.com/hallucinations-2fa-prompts-and-hidden-access-personal-ai-agent-horror-stories ; https://runtimewire.com/article/instinct-users-revoke-access-personal-ai-trust ; https://aiweekly.co/alerts/techcrunch-instinct-ais-always-on-personal-agent-draws-privacy-alarm-over
- Meta policy and the EU: https://techcrunch.com/2025/10/18/whatssapp-changes-its-terms-to-bar-general-purpose-chatbots-from-its-platform ; https://respond.io/blog/whatsapp-general-purpose-chatbots-ban ; https://respond.io/blog/whatsapp-ai-chatbot-policy ; https://www.techradar.com/ai-platforms-assistants/apple-intelligence/meta-is-kicking-chatgpt-and-copilot-out-of-whatsapp-and-forcing-everyone-to-use-its-unpopular-ai-chatbot-instead ; https://tribune.com.pk/story/2579572/meta-is-shutting-down-third-party-ai-chatbots-on-whatsapp ; https://www.houthoff.com/insights/news/a-rare-show-offorce-commission-deploys-interim-measures-against-meta-to-safeguard-ai-competition/ ; https://www.morningstar.com/news/dow-jones/202606095215/meta-gets-eu-antitrust-order-to-open-whatsapp-to-rival-ai-chatbots ; https://www.business-standard.com/world-news/eu-orders-meta-to-restore-whatsapp-access-for-rival-ai-chatbots-126060901307_1.html ; https://ecosistemastartup.com/instinct-agente-ia-de-23-anos-vale-us2-500m-y-reta-a-meta/
- Meta Business Agent: https://www.techcrunch.com/2026/06/03/metas-ai-agent-for-whatsapp-business-is-now-available-globally/ ; https://whatsappbusiness.com/blog/introducing-meta-business-agent-ai/ ; https://www.businesstoday.in/technology/artificial-intelligence/story/meta-unveils-ai-business-agent-platform-for-whatsapp-instagram-and-messenger-534739-2026-06-03 ; https://sleekflow.io/en-us/blog/meta-whatsapp-business-ai-vs-ai-agents ; https://www.ynetnews.com/tech-and-digital/article/rk008bxwxge
- Comparators: https://techcrunch.com/2026/10/24/all-the-ai-agents-that-can-live-in-your-text-messages/ ; https://www.techcrunch.com/2026/06/04/apple-approves-poke-as-the-first-ai-agent-on-its-messages-for-business-platform/ ; https://choco.com/uk/stories/suppliers/choco-ai ; https://foodanddrinknetwork.co.uk/latest-news/industry-news/choco-launches-autopilot-the-first-ai-agent-in-food-distribution/
- Official Meta pricing page (not reachable this session): https://developers.facebook.com/docs/whatsapp/pricing
